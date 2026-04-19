// Disposable test database management
//
// Creates a temporary PostgreSQL database per test suite,
// runs migrations, and drops it on teardown.

import pg from 'pg'
import { createDatabase, type Database } from '../query/client.js'
import type { TableDef, DomainDef, EnumDef } from '../schema/definitions.js'

export interface TestDatabaseConfig {
  /** Connection string to PG server (the test DB is created as a new database on this server) */
  connectionString: string
  /** Schema definitions to migrate into the test DB */
  schema: readonly (TableDef | DomainDef | EnumDef)[]
  /** Optional: seed SQL statements to run after migration */
  seed?: readonly string[]
  /** Optional: custom database name prefix (default: 'pgbo_test_') */
  prefix?: string
}

export interface TestDatabase {
  /** The database client — same API as production */
  db: Database
  /** The generated database name */
  name: string
  /** Drop the test database and close all connections */
  dispose: () => Promise<void>
  /** Reset: truncate all tables and re-apply seed data */
  reset: () => Promise<void>
  /** Execute raw SQL (for test assertions) */
  raw: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<T[]>
}

function isDomainDef(obj: unknown): obj is DomainDef {
  return typeof obj === 'object' && obj !== null && 'baseDomain' in obj
}

function isEnumDef(obj: unknown): obj is EnumDef {
  return typeof obj === 'object' && obj !== null && 'values' in obj && !('columns' in obj)
}

function isTableDef(obj: unknown): obj is TableDef {
  return typeof obj === 'object' && obj !== null && 'columns' in obj && 'primaryKey' in obj
}

export async function createTestDatabase(config: TestDatabaseConfig): Promise<TestDatabase> {
  const prefix = config.prefix ?? 'pgbo_test_'
  const suffix = Math.random().toString(36).slice(2, 10)
  const dbName = `${prefix}${suffix}`

  // Connect to the server to create the test database
  const adminClient = new pg.Client({ connectionString: config.connectionString })
  await adminClient.connect()

  try {
    await adminClient.query(`CREATE DATABASE ${dbName}`)
  } finally {
    await adminClient.end()
  }

  // Build connection string to the new database
  const url = new URL(config.connectionString)
  url.pathname = `/${dbName}`
  const testConnectionString = url.toString()

  // Connect to the test database
  const db = createDatabase({ connectionString: testConnectionString })

  // Apply schema DDL in dependency order: domains -> enums -> tables
  const domains = config.schema.filter(isDomainDef)
  const enums = config.schema.filter(isEnumDef)
  const tables = config.schema.filter(isTableDef)

  for (const d of domains) {
    await db.query(d.toSQL())
  }
  for (const e of enums) {
    await db.query(e.toSQL())
  }
  for (const t of tables) {
    await db.query(t.toSQL())
  }

  // Apply seed data
  if (config.seed) {
    for (const sql of config.seed) {
      await db.query(sql)
    }
  }

  // Collect table names for reset
  const tableNames = tables.map(t => t.name)
  // Include translation tables
  for (const t of tables) {
    if (t.translationTable) {
      tableNames.push(t.translationTable.name)
    }
  }

  return {
    db,
    name: dbName,

    async dispose(): Promise<void> {
      await db.close()
      const dropClient = new pg.Client({ connectionString: config.connectionString })
      await dropClient.connect()
      try {
        await dropClient.query(`DROP DATABASE ${dbName}`)
      } finally {
        await dropClient.end()
      }
    },

    async reset(): Promise<void> {
      if (tableNames.length > 0) {
        await db.query(`TRUNCATE ${tableNames.join(', ')} CASCADE`)
      }
      if (config.seed) {
        for (const sql of config.seed) {
          await db.query(sql)
        }
      }
    },

    async raw<T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<T[]> {
      return db.query<T>(sql, params)
    },
  }
}
