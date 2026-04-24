// Composition auto-enrichment for read operations
// (issue #018 base + #019 nested children + #13 cardinality/where/merge)

import type { Database } from '../query/client.js'
import type { TableDef } from '../schema/definitions.js'
import type { BusinessObjectDef, CompositionDef, ActionContext } from './types.js'
import { toCamelCase } from '../query/select.js'
import type { WhereConditions } from '../query/where.js'

function resolveTable(compDef: CompositionDef): TableDef | undefined {
  return compDef.table ?? compDef.view?.source
}

const PLACEHOLDER_PATTERN = /^\$(locale|userId|tenantId|now)$/

/**
 * Replace `$locale` / `$userId` / `$tenantId` / `$now` string placeholders with
 * resolved values. Throws if a placeholder references ctx data that is missing —
 * failing loud is safer than silently returning unfiltered results.
 */
function resolvePlaceholder(value: unknown, ctx: ActionContext | undefined): unknown {
  if (typeof value !== 'string') return value
  const match = PLACEHOLDER_PATTERN.exec(value)
  const key = match?.[1]
  if (!key) return value
  if (key === 'now') return new Date()
  if (!ctx) {
    throw new Error(`Composition where uses "${value}" but enrichCompositions was called without a ctx`)
  }
  const resolved = (ctx as Record<string, unknown>)[key]
  if (resolved === undefined) {
    throw new Error(`Composition where uses "${value}" but ctx.${key} is undefined`)
  }
  return resolved
}

/** Recursively resolve placeholders in a WHERE clause (including nested operators). */
function resolveWhere(where: Record<string, unknown>, ctx: ActionContext | undefined): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(where)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      // Operator object like { lte: '$now' } or nested AND/OR
      resolved[key] = resolveWhere(value as Record<string, unknown>, ctx)
    } else if (Array.isArray(value)) {
      resolved[key] = value.map(v => resolvePlaceholder(v, ctx))
    } else {
      resolved[key] = resolvePlaceholder(value, ctx)
    }
  }
  return resolved
}

export interface EnrichOptions {
  /** Context used to resolve `$locale` / `$userId` / `$tenantId` placeholders in `where`. */
  readonly ctx?: ActionContext
}

async function loadCompositionLevel(
  db: Database,
  compositions: readonly (readonly [string, CompositionDef])[],
  parentKeyField: string,
  items: readonly Record<string, unknown>[],
  opts: EnrichOptions,
): Promise<Map<string, { def: CompositionDef; grouped: Map<unknown, Record<string, unknown>[]> }>> {
  const resultMap = new Map<string, { def: CompositionDef; grouped: Map<unknown, Record<string, unknown>[]> }>()
  if (compositions.length === 0 || items.length === 0) return resultMap

  const parentIds = items.map(item => item[parentKeyField])

  const results = await Promise.all(
    compositions.map(async ([compName, compDef]) => {
      const compTable = resolveTable(compDef)
      if (!compTable) return { compName, def: compDef, grouped: new Map<unknown, Record<string, unknown>[]>() }

      // Build WHERE: parent_key = ANY(ids), plus any resolved filter clause.
      const where: WhereConditions = {
        [compDef.parentKey]: { any: parentIds },
      }
      if (compDef.where) {
        const resolved = resolveWhere(compDef.where, opts.ctx)
        for (const [k, v] of Object.entries(resolved)) where[k] = v
      }

      const rows = await db._table.from(compTable).where(where).execute()
      const camelRows = rows as unknown as Record<string, unknown>[]

      // Group by parent key
      const grouped = new Map<unknown, Record<string, unknown>[]>()
      for (const row of camelRows) {
        const parentValue = row[compDef.parentKey]
        const existing = grouped.get(parentValue)
        if (existing) {
          existing.push(row)
        } else {
          grouped.set(parentValue, [row])
        }
      }

      // Recursively load sub-children
      if (compDef.children && Object.keys(compDef.children).length > 0 && camelRows.length > 0) {
        const childPK = compTable.primaryKey[0]
        if (childPK) {
          const childPKCamel = toCamelCase(childPK)
          const childCompositions = Object.entries(compDef.children) as (readonly [string, CompositionDef])[]

          const subResults = await loadCompositionLevel(db, childCompositions, childPKCamel, camelRows, opts)

          for (const row of camelRows) {
            const childId = row[childPKCamel]
            for (const [subName, { def: subDef, grouped: subGrouped }] of subResults) {
              row[subName] = shapeChildren(subDef, subGrouped.get(childId) ?? [])
            }
          }
        }
      }

      return { compName, def: compDef, grouped }
    }),
  )

  for (const { compName, def, grouped } of results) {
    resultMap.set(compName, { def, grouped })
  }
  return resultMap
}

/** Apply cardinality + merge semantics to the children for one parent row. */
function shapeChildren(def: CompositionDef, children: Record<string, unknown>[]): unknown {
  if (def.cardinality === 'one') {
    return children[0] ?? null
  }
  return children
}

/**
 * Batch-load composition children (and sub-children) and attach them to parent rows.
 *
 * For each composition defined on the BO:
 * 1. Collect parent key values from `items` using `bo.paramField`
 * 2. SELECT from comp table WHERE parent_key = ANY($1) [AND <resolved where>]
 * 3. If `children`, recursively load sub-children
 * 4. Apply `cardinality` / `merge` / attach to parent
 *
 * Returns new objects — does not mutate the input array.
 */
export async function enrichCompositions<T extends Record<string, unknown>>(
  db: Database,
  bo: BusinessObjectDef,
  items: readonly T[],
  opts: EnrichOptions = {},
): Promise<T[]> {
  const compositions = Object.entries(bo.compositions) as (readonly [string, CompositionDef])[]
  if (compositions.length === 0 || items.length === 0) {
    return items.map(item => ({ ...item }))
  }

  const resultMap = await loadCompositionLevel(
    db,
    compositions,
    bo.paramField,
    items as readonly Record<string, unknown>[],
    opts,
  )

  return items.map(item => {
    const enriched: Record<string, unknown> = { ...item }
    const parentValue = item[bo.paramField]
    for (const [compName, { def, grouped }] of resultMap) {
      const children = grouped.get(parentValue) ?? []
      if (def.cardinality === 'one' && def.merge && def.merge.length > 0) {
        // Lift merge fields onto parent instead of attaching as an object
        const match = children[0]
        if (match) {
          for (const field of def.merge) enriched[field] = match[field]
        } else {
          for (const field of def.merge) enriched[field] = null
        }
      } else {
        enriched[compName] = shapeChildren(def, children)
      }
    }
    return enriched as T
  })
}
