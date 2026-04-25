import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import { diff } from '../../src/migration/diff.js'
import { migrate } from '../../src/migration/execute.js'
import { introspect } from '../../src/migration/introspect.js'
import { table } from '../../src/schema/table.js'
import { text, integer, timestamp } from '../../src/schema/types.js'
import { domain } from '../../src/schema/domain.js'
import { pgEnum } from '../../src/schema/enum.js'
import { view } from '../../src/schema/view.js'
import { col } from '../../src/schema/column.js'
import { index } from '../../src/schema/constraints.js'
import { defineBO } from '../../src/bo/index.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

describe('Migration execution', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({ connectionString, schema: [] })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('end-to-end: empty DB → full schema from definitions', async () => {
    const slug = domain('slug', text().minLength(1).maxLength(128))
    const stockType = pgEnum('stock_type', ['RECEIPT', 'ADJUSTMENT', 'TRANSFER'])
    const warehouse = table('warehouse', {
      columns: {
        slug: text().notNull(),
        name: text().notNull(),
        createdAt: timestamp().withTimeZone().defaultNow(),
      },
      primaryKey: ['slug'],
      indexes: [index('name')],
    })
    const warehouseView = view('warehouse_view').from(warehouse)

    const snapshot = await introspect(testDb.db)
    const plan = diff(
      { domains: [slug], enums: [stockType], tables: [warehouse], views: [warehouseView] },
      snapshot,
    )

    expect(plan.operations.length).toBeGreaterThan(0)

    await migrate(testDb.db, plan)

    // Verify everything was created
    const after = await introspect(testDb.db)
    expect(after.domains.find(d => d.name === 'slug')).toBeDefined()
    expect(after.enums.find(e => e.name === 'stock_type')).toBeDefined()
    expect(after.tables.find(t => t.name === 'warehouse')).toBeDefined()
    expect(after.views.find(v => v.name === 'warehouse_view')).toBeDefined()

    const whTable = after.tables.find(t => t.name === 'warehouse')!
    expect(whTable.primaryKey).toEqual(['slug'])
    expect(whTable.indexes.find(i => i.columns.includes('name'))).toBeDefined()
  })

  it('applies ALTER TABLE ADD COLUMN on second migration', async () => {
    // Add a column to the existing warehouse table
    const warehouse = table('warehouse', {
      columns: {
        slug: text().notNull(),
        name: text().notNull(),
        description: text(),
        createdAt: timestamp().withTimeZone().defaultNow(),
      },
      primaryKey: ['slug'],
      indexes: [index('name')],
    })

    const snapshot = await introspect(testDb.db)
    const plan = diff(
      { domains: [], enums: [], tables: [warehouse], views: [] },
      snapshot,
    )

    const addColOps = plan.operations.filter(op => op.type === 'addColumn')
    expect(addColOps.length).toBeGreaterThanOrEqual(1)

    await migrate(testDb.db, plan)

    const after = await introspect(testDb.db)
    const whTable = after.tables.find(t => t.name === 'warehouse')!
    expect(whTable.columns.find(c => c.name === 'description')).toBeDefined()
  })

  it('wraps all DDL in a transaction', async () => {
    // Create a plan with an intentionally bad SQL to verify rollback
    const badPlan = {
      operations: [
        { type: 'createTable' as const, sql: 'CREATE TABLE _test_tx (id integer PRIMARY KEY)', tableName: '_test_tx' },
        { type: 'createTable' as const, sql: 'INVALID SQL HERE', tableName: 'bad' },
      ],
    }

    await expect(migrate(testDb.db, badPlan)).rejects.toThrow()

    // The first table should NOT exist (rolled back)
    const after = await introspect(testDb.db)
    expect(after.tables.find(t => t.name === '_test_tx')).toBeUndefined()
  })

  it('materialises value help views discovered via registered BOs (issue #31)', async () => {
    const vhDb = await createTestDatabase({ connectionString, schema: [] })
    try {
      const warehouseTable = table('warehouse', {
        columns: {
          id: integer().notNull(),
          slug: text().notNull(),
          name: text().notNull(),
        },
        primaryKey: ['id'],
      })
      const warehouseView = view('warehouse_view').from(warehouseTable)
      const warehouseVh = view('warehouse_vh').from(warehouseTable)
        .columns({ slug: col('slug'), name: col('name') })
        .vh({ key: 'slug', display: 'name' })
      const warehouseBO = defineBO(warehouseView, {
        name: 'warehouse',
        paramField: 'id',
        valueHelps: { warehouse: warehouseVh },
      })

      const snapshot = await introspect(vhDb.db)
      const plan = diff(
        {
          domains: [], enums: [],
          tables: [warehouseTable],
          views: [warehouseView],
          bos: [warehouseBO],
        },
        snapshot,
      )
      await migrate(vhDb.db, plan)

      const after = await introspect(vhDb.db)
      expect(after.views.find(v => v.name === 'warehouse_vh')).toBeDefined()

      // And it's queryable end-to-end
      await vhDb.db.query("INSERT INTO warehouse (id, slug, name) VALUES (1, 'main', 'Main')")
      const rows = await vhDb.db.query<{ slug: string; name: string }>('SELECT * FROM warehouse_vh')
      expect(rows).toEqual([{ slug: 'main', name: 'Main' }])
    } finally {
      await vhDb.dispose()
    }
  })

  it('records migration in _pgbo_migrations table', async () => {
    const rows = await testDb.db.query<{ id: number; applied_at: Date; [key: string]: unknown }>(
      'SELECT id, applied_at FROM _pgbo_migrations ORDER BY id',
    )
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]!.applied_at).toBeInstanceOf(Date)
  })
})
