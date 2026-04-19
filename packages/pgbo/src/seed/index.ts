// Seed system — Phase 6 (Step 16)

import type { TableDef } from '../schema/definitions.js'
import type { Database } from '../query/client.js'
import { toSnakeCase } from '../schema/table.js'

export interface TableSeedDef {
  readonly tableDef: TableDef
  readonly data: readonly Record<string, unknown>[]
  readonly protectedKeys?: readonly Record<string, unknown>[]
}

export interface SeedOptions {
  /** Remove DB records not present in the seed definition */
  cleanup?: boolean
}

export function tableSeed(
  tableDef: TableDef,
  data: Record<string, unknown>[],
  options?: { protectedKeys?: Record<string, unknown>[] },
): TableSeedDef {
  return {
    tableDef,
    data,
    protectedKeys: options?.protectedKeys,
  }
}

/**
 * Apply seed data to the database.
 * - Upserts rows (INSERT ... ON CONFLICT DO UPDATE)
 * - Optionally cleans up stale records not in the seed definition
 * - Resolves FK ordering: seeds tables whose FKs are referenced first
 */
export async function seed(
  db: Database,
  definitions: readonly TableSeedDef[],
  options?: SeedOptions,
): Promise<void> {
  // Topological sort by FK dependencies
  const sorted = topologicalSort(definitions)

  for (const def of sorted) {
    await upsertRows(db, def)
  }

  if (options?.cleanup) {
    // Cleanup in reverse order (children before parents)
    for (const def of [...sorted].reverse()) {
      await cleanupStale(db, def)
    }
  }
}

async function upsertRows(db: Database, def: TableSeedDef): Promise<void> {
  const { tableDef, data } = def
  if (data.length === 0) return

  const pkColumns = tableDef.primaryKey.map(toSnakeCase)

  for (const row of data) {
    const keys = Object.keys(row)
    const snakeKeys = keys.map(toSnakeCase)
    const values = keys.map(k => row[k])
    const placeholders = keys.map((_, i) => `$${i + 1}`)

    // Non-PK columns for the UPDATE SET clause
    const nonPkKeys = keys.filter(k => !tableDef.primaryKey.includes(k))
    const updateSet = nonPkKeys.length > 0
      ? nonPkKeys.map(k => {
          const idx = keys.indexOf(k) + 1
          return `${toSnakeCase(k)} = $${idx}`
        }).join(', ')
      : undefined

    let sql = `INSERT INTO ${tableDef.name} (${snakeKeys.join(', ')}) VALUES (${placeholders.join(', ')})`
    sql += ` ON CONFLICT (${pkColumns.join(', ')})`

    if (updateSet) {
      sql += ` DO UPDATE SET ${updateSet}`
    } else {
      sql += ' DO NOTHING'
    }

    await db.query(sql, values)
  }
}

async function cleanupStale(db: Database, def: TableSeedDef): Promise<void> {
  const { tableDef, data, protectedKeys } = def
  if (data.length === 0 && (!protectedKeys || protectedKeys.length === 0)) {
    // No seed data and no protected keys — delete everything
    await db.query(`DELETE FROM ${tableDef.name}`)
    return
  }

  // Collect all PK values from seed data + protected keys
  const allKeptKeys = [...data]
  if (protectedKeys) {
    allKeptKeys.push(...protectedKeys)
  }

  if (allKeptKeys.length === 0) return

  const pkColumns = tableDef.primaryKey

  const [firstPk] = pkColumns
  if (pkColumns.length === 1 && firstPk) {
    // Simple single-column PK
    const pkCol = toSnakeCase(firstPk)
    const values = allKeptKeys.map(row => row[firstPk])
    const placeholders = values.map((_, i) => `$${i + 1}`)
    await db.query(
      `DELETE FROM ${tableDef.name} WHERE ${pkCol} NOT IN (${placeholders.join(', ')})`,
      values,
    )
  } else {
    // Composite PK — use ROW() NOT IN
    const snakePkCols = pkColumns.map(toSnakeCase)
    const rowExprs: string[] = []
    const values: unknown[] = []
    for (const row of allKeptKeys) {
      const placeholders = pkColumns.map(col => {
        values.push(row[col])
        return `$${values.length}`
      })
      rowExprs.push(`(${placeholders.join(', ')})`)
    }
    await db.query(
      `DELETE FROM ${tableDef.name} WHERE (${snakePkCols.join(', ')}) NOT IN (${rowExprs.join(', ')})`,
      values,
    )
  }
}

/**
 * Topological sort: tables that are referenced by FKs come first.
 * Simple approach: for each definition, check if its table is referenced by another definition's FK.
 */
function topologicalSort(definitions: readonly TableSeedDef[]): TableSeedDef[] {
  const nameToIdx = new Map<string, number>()
  definitions.forEach((d, i) => nameToIdx.set(d.tableDef.name, i))

  // Build adjacency: if table A has FK to table B, B must come before A
  const deps = new Map<number, Set<number>>()
  const reverseAdj = new Map<number, number[]>()
  for (let i = 0; i < definitions.length; i++) {
    deps.set(i, new Set())
    reverseAdj.set(i, [])
  }

  definitions.forEach((d, i) => {
    const fks = d.tableDef.foreignKeys
    const iDeps = deps.get(i)
    if (!iDeps) return
    for (const fk of fks) {
      const refIdx = nameToIdx.get(fk.refTable)
      if (refIdx !== undefined && refIdx !== i) {
        iDeps.add(refIdx)
        const rev = reverseAdj.get(refIdx)
        if (rev) rev.push(i)
      }
    }
  })

  // Kahn's algorithm
  const inDegree = new Map<number, number>()
  for (let i = 0; i < definitions.length; i++) {
    inDegree.set(i, deps.get(i)?.size ?? 0)
  }

  const queue: number[] = []
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node)
  }

  const result: TableSeedDef[] = []
  while (queue.length > 0) {
    const node = queue.shift()
    if (node === undefined) break
    const def = definitions[node]
    if (!def) continue
    result.push(def)
    for (const dependent of reverseAdj.get(node) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 0) - 1
      inDegree.set(dependent, newDegree)
      if (newDegree === 0) queue.push(dependent)
    }
  }

  // If some nodes weren't reached (cycle), append them
  if (result.length < definitions.length) {
    for (const def of definitions) {
      if (!result.includes(def)) result.push(def)
    }
  }

  return result
}
