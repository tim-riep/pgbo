import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const warehouseTable = table('warehouse', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['id'],
})

const warehouseView = view('warehouse_view').from(warehouseTable)

describe('SelectBuilder.pick() — typed column projection (issue 023)', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [warehouseTable],
      seed: [
        'CREATE OR REPLACE VIEW warehouse_view AS SELECT * FROM warehouse',
        "INSERT INTO warehouse (id, slug, name) VALUES (1, 'main', 'Main WH')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('SQL selects only picked columns', () => {
    const { text } = testDb.db.from(warehouseView).pick(['slug', 'name']).toQuery()
    expect(text).toBe('SELECT slug, name FROM warehouse_view')
  })

  it('returns only picked columns from DB', async () => {
    const rows = await testDb.db.from(warehouseView).pick(['slug', 'name']).execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.slug).toBe('main')
    expect(rows[0]!.name).toBe('Main WH')
    expect((rows[0] as any).id).toBeUndefined()
  })

  it('narrows result type (compile-time check)', () => {
    const builder = testDb.db.from(warehouseView).pick(['slug'])
    // This is a compile-time test — if it compiles, the type is correct
    type Result = Awaited<ReturnType<typeof builder.execute>>[number]
    const _check: Result = { slug: 'test' }
    expect(_check).toBeDefined()
  })

  it('composes with .where() and .orderBy()', async () => {
    const rows = await testDb.db.from(warehouseView)
      .pick(['slug'])
      .where({ id: 1 })
      .orderBy('slug', 'asc')
      .execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.slug).toBe('main')
  })
})
