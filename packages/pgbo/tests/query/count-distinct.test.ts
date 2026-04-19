import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const locationTable = table('location', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    warehouseSlug: text().notNull(),
  },
  primaryKey: ['id'],
})

const locationView = view('location_view').from(locationTable)

describe('SelectBuilder.count({ distinct }) — issue 015', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [locationTable],
      seed: [
        'CREATE OR REPLACE VIEW location_view AS SELECT * FROM location',
        "INSERT INTO location (id, slug, warehouse_slug) VALUES (1, 'a', 'main')",
        "INSERT INTO location (id, slug, warehouse_slug) VALUES (2, 'a', 'main')",
        "INSERT INTO location (id, slug, warehouse_slug) VALUES (3, 'b', 'main')",
        "INSERT INTO location (id, slug, warehouse_slug) VALUES (4, 'b', 'returns')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('count() without args → COUNT(*)', async () => {
    expect(await testDb.db.from(locationView).count()).toBe(4)
  })

  it('count({ distinct: "slug" }) → COUNT(DISTINCT slug)', async () => {
    expect(await testDb.db.from(locationView).count({ distinct: 'slug' })).toBe(2)
  })

  it('count({ distinct: "warehouseSlug" }) snake-cases column', async () => {
    expect(await testDb.db.from(locationView).count({ distinct: 'warehouseSlug' })).toBe(2)
  })

  it('count({ distinct: ["slug", "warehouseSlug"] }) → tuple distinct', async () => {
    expect(await testDb.db.from(locationView).count({ distinct: ['slug', 'warehouseSlug'] })).toBe(3)
  })

  it('composes with .where()', async () => {
    const n = await testDb.db.from(locationView)
      .where({ warehouseSlug: 'main' })
      .count({ distinct: 'slug' })
    expect(n).toBe(2)
  })
})
