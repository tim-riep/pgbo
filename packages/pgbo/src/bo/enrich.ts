// Composition auto-enrichment for read operations
// (issue #018 base + #019 nested children + #13 cardinality/where/merge + #25 link-table M2M)

import type { Database } from '../query/client.js'
import type { TableDef, ViewDef } from '../schema/definitions.js'
import type { BusinessObjectDef, CompositionDef, AnyCompositionDef, LinkCompositionDef, BoTarget, ActionContext } from './types.js'
import { isLinkComposition } from './types.js'
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
      resolved[key] = resolveWhere(value as Record<string, unknown>, ctx)
    } else if (Array.isArray(value)) {
      resolved[key] = value.map(v => resolvePlaceholder(v, ctx))
    } else {
      resolved[key] = resolvePlaceholder(value, ctx)
    }
  }
  return resolved
}

function isBoTarget(value: unknown): value is BoTarget {
  return typeof value === 'object' && value !== null
    && 'compositions' in value && 'paramField' in value && 'root' in value
}

function isViewDefTarget(value: unknown): value is ViewDef {
  return typeof value === 'object' && value !== null
    && 'source' in value && !('compositions' in value)
}

function narrowColumns(row: Record<string, unknown>, columns: readonly string[] | undefined): Record<string, unknown> {
  if (!columns) return row
  const result: Record<string, unknown> = {}
  for (const c of columns) {
    if (c in row) result[c] = row[c]
  }
  return result
}

export interface EnrichOptions {
  /** Context used to resolve `$locale` / `$userId` / `$tenantId` placeholders in `where`. */
  readonly ctx?: ActionContext
}

type LevelResult = Map<string, { def: AnyCompositionDef; grouped: Map<unknown, Record<string, unknown>[]> }>

/**
 * Load link-table composition results for all parent rows.
 *
 * Two batched queries:
 *   1. `SELECT link_parent_key, link_target_key FROM linkTable WHERE link_parent_key = ANY(parentIds) [AND linkWhere]`
 *   2. `SELECT * FROM target WHERE targetPK = ANY(targetKeys) [AND where]`
 * (with target BO compositions running on the target rows afterwards)
 *
 * Returns a Map<parentValue, targetRow[]> with columns already narrowed per `columns`.
 */
async function loadLinkComposition(
  db: Database,
  def: LinkCompositionDef,
  parentIds: unknown[],
  opts: EnrichOptions,
): Promise<Map<unknown, Record<string, unknown>[]>> {
  const grouped = new Map<unknown, Record<string, unknown>[]>()
  if (parentIds.length === 0) return grouped

  // 1. Load link rows
  const linkWhere: WhereConditions = { [def.linkParentKey]: { any: parentIds } }
  if (def.linkWhere) {
    for (const [k, v] of Object.entries(resolveWhere(def.linkWhere, opts.ctx))) linkWhere[k] = v
  }
  const linkRows = await db._table.from(def.linkTable).where(linkWhere).execute() as unknown as Record<string, unknown>[]
  if (linkRows.length === 0) return grouped

  // 2. Collect distinct target keys
  const targetKeys = [...new Set(
    linkRows.map(r => r[def.linkTargetKey]).filter(v => v !== null && v !== undefined),
  )]
  if (targetKeys.length === 0) return grouped

  // 3. Load target rows + optionally run target BO compositions
  const target = def.target
  let targetPKField: string
  let targetRows: Record<string, unknown>[]

  if (isBoTarget(target)) {
    targetPKField = target.paramField
    const where: WhereConditions = { [targetPKField]: { any: targetKeys } }
    if (def.where) {
      for (const [k, v] of Object.entries(resolveWhere(def.where, opts.ctx))) where[k] = v
    }
    const root = target.root
    const rawRows = 'source' in root
      ? await db.from(root).where(where).execute() as Record<string, unknown>[]
      : await db._table.from(root).where(where).execute() as unknown as Record<string, unknown>[]

    // Run target BO's own compositions (e.g. translation resolution)
    const targetBO = target as unknown as BusinessObjectDef
    targetRows = Object.keys(targetBO.compositions).length > 0
      ? await enrichCompositions(db, targetBO, rawRows, { ctx: opts.ctx })
      : rawRows
  } else if (isViewDefTarget(target)) {
    const pk = target.source.primaryKey[0]
    if (!pk) {
      throw new Error(`Link composition target view "${target.name}" has no primary key`)
    }
    targetPKField = pk
    const where: WhereConditions = { [pk]: { any: targetKeys } }
    if (def.where) {
      for (const [k, v] of Object.entries(resolveWhere(def.where, opts.ctx))) where[k] = v
    }
    targetRows = await db.from(target).where(where).execute() as Record<string, unknown>[]
  } else {
    // Plain TableDef target
    const targetTable = target as TableDef
    const pk = targetTable.primaryKey[0]
    if (!pk) {
      throw new Error(`Link composition target table "${targetTable.name}" has no primary key`)
    }
    targetPKField = pk
    const where: WhereConditions = { [pk]: { any: targetKeys } }
    if (def.where) {
      for (const [k, v] of Object.entries(resolveWhere(def.where, opts.ctx))) where[k] = v
    }
    targetRows = await db._table.from(targetTable).where(where).execute() as unknown as Record<string, unknown>[]
  }

  // 4. Build target-key → row map, then group by parent via link rows
  const byTargetKey = new Map<unknown, Record<string, unknown>>()
  for (const row of targetRows) byTargetKey.set(row[targetPKField], row)

  for (const link of linkRows) {
    const parentValue = link[def.linkParentKey]
    const targetKey = link[def.linkTargetKey]
    const targetRow = targetKey !== null && targetKey !== undefined ? byTargetKey.get(targetKey) : undefined
    if (!targetRow) continue
    const narrowed = narrowColumns(targetRow, def.columns)
    const existing = grouped.get(parentValue)
    if (existing) existing.push(narrowed)
    else grouped.set(parentValue, [narrowed])
  }

  return grouped
}

async function loadCompositionLevel(
  db: Database,
  compositions: readonly (readonly [string, AnyCompositionDef])[],
  parentKeyField: string,
  items: readonly Record<string, unknown>[],
  opts: EnrichOptions,
): Promise<LevelResult> {
  const resultMap: LevelResult = new Map()
  if (compositions.length === 0 || items.length === 0) return resultMap

  const parentIds = items.map(item => item[parentKeyField])

  const results = await Promise.all(
    compositions.map(async ([compName, compDef]) => {
      if (isLinkComposition(compDef)) {
        const grouped = await loadLinkComposition(db, compDef, parentIds, opts)
        return { compName, def: compDef, grouped }
      }

      const plainDef: CompositionDef = compDef
      const compTable = resolveTable(plainDef)
      if (!compTable) return { compName, def: plainDef, grouped: new Map<unknown, Record<string, unknown>[]>() }

      const where: WhereConditions = { [plainDef.parentKey]: { any: parentIds } }
      if (plainDef.where) {
        const resolved = resolveWhere(plainDef.where, opts.ctx)
        for (const [k, v] of Object.entries(resolved)) where[k] = v
      }

      const rows = await db._table.from(compTable).where(where).execute()
      const camelRows = rows as unknown as Record<string, unknown>[]

      const grouped = new Map<unknown, Record<string, unknown>[]>()
      for (const row of camelRows) {
        const parentValue = row[plainDef.parentKey]
        const existing = grouped.get(parentValue)
        if (existing) existing.push(row)
        else grouped.set(parentValue, [row])
      }

      // Recursively load sub-children
      if (plainDef.children && Object.keys(plainDef.children).length > 0 && camelRows.length > 0) {
        const childPK = compTable.primaryKey[0]
        if (childPK) {
          const childPKCamel = toCamelCase(childPK)
          const childCompositions = Object.entries(plainDef.children) as (readonly [string, CompositionDef])[]

          const subResults = await loadCompositionLevel(db, childCompositions, childPKCamel, camelRows, opts)

          for (const row of camelRows) {
            const childId = row[childPKCamel]
            for (const [subName, { def: subDef, grouped: subGrouped }] of subResults) {
              row[subName] = shapeChildren(subDef, subGrouped.get(childId) ?? [])
            }
          }
        }
      }

      return { compName, def: plainDef, grouped }
    }),
  )

  for (const { compName, def, grouped } of results) {
    resultMap.set(compName, { def, grouped })
  }
  return resultMap
}

/** Apply cardinality + merge semantics to the children for one parent row. */
function shapeChildren(def: AnyCompositionDef, children: Record<string, unknown>[]): unknown {
  if (isLinkComposition(def)) return children  // link comps are always many
  if (def.cardinality === 'one') return children[0] ?? null
  return children
}

/**
 * Batch-load composition children (plain, link-through, and sub-children) and
 * attach them to parent rows. Returns new objects — does not mutate input.
 */
export async function enrichCompositions<T extends Record<string, unknown>>(
  db: Database,
  bo: BusinessObjectDef,
  items: readonly T[],
  opts: EnrichOptions = {},
): Promise<T[]> {
  const compositions = Object.entries(bo.compositions) as (readonly [string, AnyCompositionDef])[]
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
      if (!isLinkComposition(def) && def.cardinality === 'one' && def.merge && def.merge.length > 0) {
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
