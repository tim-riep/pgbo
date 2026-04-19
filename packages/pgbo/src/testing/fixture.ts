// Test fixtures — typed seed data for test scenarios

import type { Database } from '../query/client.js'
import type { TableDef } from '../schema/definitions.js'
import { toSnakeCase } from '../schema/table.js'

export interface Fixture<T> {
  data: T[]
  insert: (db: Database) => Promise<void>
  cleanup: (db: Database) => Promise<void>
}

export function fixture<T extends Record<string, unknown>>(
  tableDef: TableDef,
  data: T[],
): Fixture<T> {
  return {
    data,

    async insert(db: Database): Promise<void> {
      for (const row of data) {
        const keys = Object.keys(row)
        const snakeKeys = keys.map(toSnakeCase)
        const values = keys.map(k => row[k])
        const placeholders = keys.map((_, i) => `$${i + 1}`)
        const sql = `INSERT INTO ${tableDef.name} (${snakeKeys.join(', ')}) VALUES (${placeholders.join(', ')})`
        await db._table.query(sql, values)
      }
    },

    async cleanup(db: Database): Promise<void> {
      await db._table.query(`DELETE FROM ${tableDef.name}`)
    },
  }
}
