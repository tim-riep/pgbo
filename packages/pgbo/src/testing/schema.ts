// Schema assertions — verify DB state matches expectations

import type { TestDatabase } from './database.js'

type ColumnInfo = { column_name: string; data_type: string; [key: string]: unknown }

type PkInfo = { column_name: string; [key: string]: unknown }

export async function assertSchema(
  testDb: TestDatabase,
  tableName: string,
  expected: { columns?: Record<string, string>; primaryKey?: string[] },
): Promise<void> {
  if (expected.columns) {
    const rows = await testDb.raw<ColumnInfo>(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = $1 AND table_schema = 'public'
       ORDER BY ordinal_position`,
      [tableName],
    )
    const actual: Record<string, string> = {}
    for (const row of rows) {
      actual[row.column_name] = row.data_type
    }
    for (const [col, type] of Object.entries(expected.columns)) {
      if (!actual[col]) {
        throw new Error(`Column "${col}" not found in table "${tableName}"`)
      }
      if (!actual[col].includes(type)) {
        throw new Error(
          `Column "${col}" in "${tableName}": expected type containing "${type}", got "${actual[col]}"`,
        )
      }
    }
  }

  if (expected.primaryKey) {
    const rows = await testDb.raw<PkInfo>(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
       WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
      [tableName],
    )
    const actualPk = rows.map(r => r.column_name)
    const expectedPk = [...expected.primaryKey].sort()
    const sortedActual = [...actualPk].sort()
    if (JSON.stringify(sortedActual) !== JSON.stringify(expectedPk)) {
      throw new Error(
        `Primary key of "${tableName}": expected [${expectedPk.join(', ')}], got [${sortedActual.join(', ')}]`,
      )
    }
  }
}
