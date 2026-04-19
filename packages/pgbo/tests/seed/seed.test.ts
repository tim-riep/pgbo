import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import { table } from '../../src/schema/table.js'
import { text, integer } from '../../src/schema/types.js'
import { foreignKey } from '../../src/schema/constraints.js'
import { seed, tableSeed, type SeedOptions } from '../../src/seed/index.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const tenants = table('tenants', {
  columns: {
    id: integer().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['id'],
})

const warehouses = table('warehouses', {
  columns: {
    slug: text().notNull(),
    tenantId: integer().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['slug'],
  foreignKeys: [
    foreignKey(['tenantId']).references('tenants', ['id']),
  ],
})

const warehouseTranslations = table('warehouse_translations', {
  columns: {
    warehouseSlug: text().notNull(),
    locale: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['warehouseSlug', 'locale'],
  foreignKeys: [
    foreignKey(['warehouseSlug']).references('warehouses', ['slug']).onDelete('CASCADE'),
  ],
})

describe('Seed system', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [tenants, warehouses, warehouseTranslations],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  beforeEach(async () => {
    await testDb.reset()
  })

  it('seed() inserts data via table definition', async () => {
    await seed(testDb.db, [
      tableSeed(tenants, [
        { id: 1, name: 'Acme Corp' },
      ]),
    ])

    const rows = await testDb.raw<{ id: number; name: string }>('SELECT id, name FROM tenants')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('Acme Corp')
  })

  it('idempotent: re-running seed upserts, does not duplicate', async () => {
    const seedDef = [
      tableSeed(tenants, [
        { id: 1, name: 'Acme Corp' },
      ]),
    ]

    await seed(testDb.db, seedDef)
    await seed(testDb.db, seedDef)

    const rows = await testDb.raw<{ id: number }>('SELECT id FROM tenants')
    expect(rows).toHaveLength(1)
  })

  it('upsert updates existing records', async () => {
    await seed(testDb.db, [
      tableSeed(tenants, [{ id: 1, name: 'Acme Corp' }]),
    ])
    await seed(testDb.db, [
      tableSeed(tenants, [{ id: 1, name: 'Acme Inc' }]),
    ])

    const rows = await testDb.raw<{ name: string }>('SELECT name FROM tenants WHERE id = 1')
    expect(rows[0]!.name).toBe('Acme Inc')
  })

  it('respects FK ordering (parents before children)', async () => {
    // Provide child before parent — seed should reorder
    await seed(testDb.db, [
      tableSeed(warehouses, [
        { slug: 'MAIN', tenantId: 1, name: 'Main' },
      ]),
      tableSeed(tenants, [
        { id: 1, name: 'Acme Corp' },
      ]),
    ])

    const tenantRows = await testDb.raw<{ id: number }>('SELECT id FROM tenants')
    expect(tenantRows).toHaveLength(1)
    const whRows = await testDb.raw<{ slug: string }>('SELECT slug FROM warehouses')
    expect(whRows).toHaveLength(1)
  })

  it('handles compositions (child records inserted with parent)', async () => {
    await seed(testDb.db, [
      tableSeed(tenants, [{ id: 1, name: 'Acme' }]),
      tableSeed(warehouses, [{ slug: 'MAIN', tenantId: 1, name: 'Main' }]),
      tableSeed(warehouseTranslations, [
        { warehouseSlug: 'MAIN', locale: 'en', name: 'Main Warehouse' },
        { warehouseSlug: 'MAIN', locale: 'de', name: 'Hauptlager' },
      ]),
    ])

    const rows = await testDb.raw<{ locale: string; name: string }>(
      'SELECT locale, name FROM warehouse_translations ORDER BY locale',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]!.name).toBe('Hauptlager')      // de
    expect(rows[1]!.name).toBe('Main Warehouse')   // en
  })

  it('stale cleanup removes DB records not in seed definition', async () => {
    // First seed with 2 tenants
    await seed(testDb.db, [
      tableSeed(tenants, [
        { id: 1, name: 'Acme' },
        { id: 2, name: 'Other' },
      ]),
    ])

    // Re-seed with only 1 tenant + cleanup enabled
    await seed(testDb.db, [
      tableSeed(tenants, [
        { id: 1, name: 'Acme' },
      ]),
    ], { cleanup: true })

    const rows = await testDb.raw<{ id: number }>('SELECT id FROM tenants')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(1)
  })

  it('protected records are excluded from cleanup', async () => {
    await seed(testDb.db, [
      tableSeed(tenants, [
        { id: 1, name: 'Acme' },
        { id: 2, name: 'System' },
      ]),
    ])

    // Re-seed with cleanup but protect id=2
    await seed(testDb.db, [
      tableSeed(tenants, [
        { id: 1, name: 'Acme' },
      ], { protectedKeys: [{ id: 2 }] }),
    ], { cleanup: true })

    const rows = await testDb.raw<{ id: number }>('SELECT id FROM tenants ORDER BY id')
    expect(rows).toHaveLength(2)
  })
})
