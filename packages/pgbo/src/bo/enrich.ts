// Composition auto-enrichment for read operations (issue 018 + 019 nested)

import type { Database } from '../query/client.js'
import type { TableDef } from '../schema/definitions.js'
import type { BusinessObjectDef, CompositionDef } from './types.js'
import { toSnakeCase } from '../schema/table.js'
import { toCamelCase } from '../query/select.js'

function rowToCamelCase(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    result[toCamelCase(key)] = value
  }
  return result
}

function resolveTable(compDef: CompositionDef): TableDef | undefined {
  return compDef.table ?? compDef.view?.source
}

/**
 * Load children for a set of parent rows, then recursively load sub-children.
 */
async function loadCompositionLevel(
  db: Database,
  compositions: readonly (readonly [string, CompositionDef])[],
  parentKeyField: string,
  items: readonly Record<string, unknown>[],
): Promise<Map<string, Map<unknown, Record<string, unknown>[]>>> {
  if (compositions.length === 0 || items.length === 0) {
    return new Map()
  }

  const parentIds = items.map(item => item[parentKeyField])

  const results = await Promise.all(
    compositions.map(async ([compName, compDef]) => {
      const compTable = resolveTable(compDef)
      if (!compTable) return { compName, grouped: new Map<unknown, Record<string, unknown>[]>() }

      const snakeParentKey = toSnakeCase(compDef.parentKey)
      const sql = `SELECT * FROM ${compTable.name} WHERE ${snakeParentKey} = ANY($1)`
      const rows = await db.query(sql, [parentIds])

      const camelRows = rows.map(rowToCamelCase)

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
        // Determine the child's primary key — use the child table's primaryKey[0]
        const childPK = compTable.primaryKey[0]
        if (childPK) {
          const childPKCamel = toCamelCase(childPK)
          const childCompositions = Object.entries(compDef.children) as (readonly [string, CompositionDef])[]

          const subResults = await loadCompositionLevel(db, childCompositions, childPKCamel, camelRows)

          // Attach sub-children to child rows
          for (const row of camelRows) {
            const childId = row[childPKCamel]
            for (const [subName, subGrouped] of subResults) {
              row[subName] = subGrouped.get(childId) ?? []
            }
          }
        }
      }

      return { compName, grouped }
    }),
  )

  const resultMap = new Map<string, Map<unknown, Record<string, unknown>[]>>()
  for (const { compName, grouped } of results) {
    resultMap.set(compName, grouped)
  }
  return resultMap
}

/**
 * Batch-load composition children (and sub-children) and attach them to parent rows.
 *
 * For each composition defined on the BO:
 * 1. Collect parent key values from `items` using `bo.paramField`
 * 2. SELECT * FROM comp_table WHERE parent_key = ANY($1)
 * 3. If the composition has `children`, recursively load sub-children
 * 4. Group by parent key, attach as nested array under the composition name
 *
 * Returns new objects — does not mutate the input array.
 */
export async function enrichCompositions<T extends Record<string, unknown>>(
  db: Database,
  bo: BusinessObjectDef,
  items: readonly T[],
): Promise<(T & Record<string, unknown[]>)[]> {
  const compositions = Object.entries(bo.compositions) as (readonly [string, CompositionDef])[]
  if (compositions.length === 0 || items.length === 0) {
    return items.map(item => ({ ...item }) as T & Record<string, unknown[]>)
  }

  const resultMap = await loadCompositionLevel(db, compositions, bo.paramField, items as readonly Record<string, unknown>[])

  return items.map(item => {
    const enriched: Record<string, unknown> = { ...item }
    const parentValue = item[bo.paramField]
    for (const [compName, grouped] of resultMap) {
      enriched[compName] = grouped.get(parentValue) ?? []
    }
    return enriched as T & Record<string, unknown[]>
  })
}
