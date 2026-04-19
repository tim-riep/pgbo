import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import { table } from '../../src/schema/table.js'
import { text, integer, timestamp } from '../../src/schema/types.js'
import { domain } from '../../src/schema/domain.js'
import { view } from '../../src/schema/view.js'
import { col } from '../../src/schema/column.js'
import { index } from '../../src/schema/constraints.js'
import { introspect } from '../../src/migration/introspect.js'
import { diff } from '../../src/migration/diff.js'
import { migrate } from '../../src/migration/execute.js'
import { zodSchemas } from '../../src/validation/index.js'
import { seed, tableSeed } from '../../src/seed/index.js'
import { defineBO } from '../../src/bo/index.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

// --- Schema definitions ---

const slug = domain('slug', text().minLength(1).maxLength(128))

const warehouseTable = table('warehouse', {
  columns: {
    slug: text().notNull(),
    tenantId: integer().notNull(),
    name: text().notNull(),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['slug'],
  indexes: [index('name')],
})

const warehouseTranslationTable = table('warehouse_translation', {
  columns: {
    warehouseSlug: text().notNull(),
    locale: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['warehouseSlug', 'locale'],
})

const warehouseView = view('warehouse_view').from(warehouseTable)

// --- Tests ---

describe('Full stack integration', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({ connectionString, schema: [] })

    // Migrate from empty
    const snapshot = await introspect(testDb.db)
    const plan = diff(
      { domains: [slug], enums: [], tables: [warehouseTable, warehouseTranslationTable], views: [warehouseView] },
      snapshot,
    )
    await migrate(testDb.db, plan)
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('define table with domains → migrate → verify PG schema matches', async () => {
    const snapshot = await introspect(testDb.db)
    const whTable = snapshot.tables.find(t => t.name === 'warehouse')
    expect(whTable).toBeDefined()
    expect(whTable!.primaryKey).toEqual(['slug'])
    expect(whTable!.columns.find(c => c.name === 'name')).toBeDefined()
    expect(snapshot.domains.find(d => d.name === 'slug')).toBeDefined()
  })

  it('define view → migrate → SELECT through view returns typed rows', async () => {
    // Use _table for setup (internal framework operation)
    await testDb.db._table.into(warehouseTable).values({ slug: 'WH1', tenantId: 1, name: 'Warehouse 1' }).execute()

    // Application code reads through the view
    const rows = await testDb.db.from(warehouseView).where({ slug: 'WH1' }).execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('Warehouse 1')
    expect(rows[0]!.tenantId).toBe(1)

    const snapshot = await introspect(testDb.db)
    expect(snapshot.views.find(v => v.name === 'warehouse_view')).toBeDefined()
  })

  it('INSERT through simple view → data in table', async () => {
    // Simple views (SELECT * FROM table) are auto-updatable in PG
    await testDb.db.into(warehouseView).values({ slug: 'WH2', tenantId: 1, name: 'Warehouse 2' }).execute()
    const rows = await testDb.db.from(warehouseView).where({ slug: 'WH2' }).execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.slug).toBe('WH2')
  })

  it('define BO with composition → create parent + children → verify both written', async () => {
    const warehouseBO = defineBO(warehouseTable, {
      paramField: 'slug',
      actions: {
        create: {},
        update: {},
        delete: {},
      },
      compositions: {
        translations: { table: warehouseTranslationTable, parentKey: 'warehouseSlug' },
      },
    })

    await warehouseBO.create(testDb.db, {}, {
      slug: 'COMP1',
      tenantId: 1,
      name: 'Composite WH',
      translations: [
        { locale: 'en', name: 'Composite Warehouse' },
        { locale: 'de', name: 'Zusammengesetztes Lager' },
      ],
    })

    const parent = await testDb.db.from(warehouseView).where({ slug: 'COMP1' }).execute()
    expect(parent).toHaveLength(1)

    const children = await testDb.raw<{ locale: string; name: string }>(
      "SELECT locale, name FROM warehouse_translation WHERE warehouse_slug = 'COMP1' ORDER BY locale",
    )
    expect(children).toHaveLength(2)
    const names = children.map(c => c.name).sort()
    expect(names).toEqual(['Composite Warehouse', 'Zusammengesetztes Lager'])
  })

  it('define BO with actions → create/update/delete work, no-action → read-only', async () => {
    const crudBO = defineBO(warehouseTable, {
      paramField: 'slug',
      actions: {
        create: {},
        update: {},
        delete: {},
      },
    })

    expect(crudBO.isReadOnly).toBe(false)

    // Create
    await crudBO.create(testDb.db, {}, { slug: 'ACT1', tenantId: 1, name: 'Action WH' })
    let rows = await testDb.db.from(warehouseView).where({ slug: 'ACT1' }).execute()
    expect(rows).toHaveLength(1)

    // Update
    await crudBO.update(testDb.db, {}, { slug: 'ACT1', name: 'Updated WH' })
    rows = await testDb.db.from(warehouseView).where({ slug: 'ACT1' }).execute()
    expect(rows[0]!.name).toBe('Updated WH')

    // Delete
    await crudBO.delete(testDb.db, {}, { slug: 'ACT1' })
    rows = await testDb.db.from(warehouseView).where({ slug: 'ACT1' }).execute()
    expect(rows).toHaveLength(0)

    // Read-only BO
    const readOnlyBO = defineBO(warehouseTable, {})
    expect(readOnlyBO.isReadOnly).toBe(true)
    await expect(readOnlyBO.create(testDb.db, {}, { slug: 'X', tenantId: 1, name: 'X' }))
      .rejects.toThrow('not defined')
  })

  it('zodSchemas() → validate insert data → reject invalid, accept valid', () => {
    const schemas = zodSchemas(warehouseTable)

    const valid = schemas.insert.parse({ slug: 'WH', tenantId: 1, name: 'Test' })
    expect(valid.slug).toBe('WH')

    expect(() => schemas.insert.parse({ slug: 'WH' })).toThrow()
  })

  it('seed → apply → verify data → re-apply (idempotent) → same data', async () => {
    const seedDef = [
      tableSeed(warehouseTable, [
        { slug: 'SEED1', tenantId: 1, name: 'Seed WH 1' },
        { slug: 'SEED2', tenantId: 1, name: 'Seed WH 2' },
      ]),
    ]

    await seed(testDb.db, seedDef)
    let rows = await testDb.db.from(warehouseView).where({ slug: { like: 'SEED%' } }).execute()
    expect(rows).toHaveLength(2)

    await seed(testDb.db, seedDef)
    rows = await testDb.db.from(warehouseView).where({ slug: { like: 'SEED%' } }).execute()
    expect(rows).toHaveLength(2)
  })

  it('schema change → diff → migrate → verify column added', async () => {
    const warehouseV2 = table('warehouse', {
      columns: {
        slug: text().notNull(),
        tenantId: integer().notNull(),
        name: text().notNull(),
        description: text(),
        createdAt: timestamp().withTimeZone().defaultNow(),
      },
      primaryKey: ['slug'],
      indexes: [index('name')],
    })

    const snapshot = await introspect(testDb.db)
    const plan = diff(
      { domains: [slug], enums: [], tables: [warehouseV2, warehouseTranslationTable], views: [warehouseView] },
      snapshot,
    )

    const addColOps = plan.operations.filter(op => op.type === 'addColumn')
    expect(addColOps.length).toBeGreaterThanOrEqual(1)

    await migrate(testDb.db, plan)

    const after = await introspect(testDb.db)
    const whTable = after.tables.find(t => t.name === 'warehouse')!
    expect(whTable.columns.find(c => c.name === 'description')).toBeDefined()
  })

  it('camelCase in TS ↔ snake_case in PG throughout entire flow', async () => {
    // Insert through view
    await testDb.db.into(warehouseView)
      .values({ slug: 'CASE1', tenantId: 99, name: 'Case Test' })
      .execute()

    // SELECT returns camelCase
    const rows = await testDb.db.from(warehouseView).where({ slug: 'CASE1' }).execute()
    expect(rows[0]).toHaveProperty('tenantId', 99)
    expect(rows[0]).toHaveProperty('createdAt')
    expect(rows[0]).not.toHaveProperty('tenant_id')
    expect(rows[0]).not.toHaveProperty('created_at')

    // WHERE uses camelCase keys → snake_case in SQL
    const filtered = await testDb.db.from(warehouseView).where({ tenantId: 99 }).execute()
    expect(filtered.length).toBeGreaterThanOrEqual(1)

    // DDL uses snake_case
    const ddl = warehouseTable.toSQL()
    expect(ddl).toContain('tenant_id')
    expect(ddl).toContain('created_at')
  })
})
