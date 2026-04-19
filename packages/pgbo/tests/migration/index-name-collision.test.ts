import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { text, integer } from '../../src/schema/types.js'
import { index } from '../../src/schema/constraints.js'
import { diff } from '../../src/migration/diff.js'
import { migrate } from '../../src/migration/execute.js'
import { introspect } from '../../src/migration/introspect.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

describe('Index name collision (issue 003)', () => {
  it('generated index name is truncated to 63 chars in DDL', () => {
    const longTable = table('storage_location_translation', {
      columns: {
        locationSlug: text().notNull(),
        warehouseSlug: text().notNull(),
        tenantId: text().notNull(),
        locale: text().notNull(),
        name: text().notNull(),
      },
      primaryKey: ['locationSlug', 'warehouseSlug', 'tenantId', 'locale'],
      indexes: [
        index('locationSlug', 'warehouseSlug', 'tenantId', 'locale'),
      ],
    })

    const ddl = longTable.toSQL()
    // Extract index name from DDL
    const match = ddl.match(/CREATE INDEX (\S+)/)
    expect(match).toBeDefined()
    const idxName = match![1]!
    expect(idxName.length).toBeLessThanOrEqual(63)
  })

  it('diff does not re-create an index that already exists (by column set)', async () => {
    const longTable = table('storage_location_translation', {
      columns: {
        locationSlug: text().notNull(),
        warehouseSlug: text().notNull(),
        tenantId: text().notNull(),
        locale: text().notNull(),
        name: text().notNull(),
      },
      primaryKey: ['locationSlug', 'warehouseSlug', 'tenantId', 'locale'],
      indexes: [
        index('locationSlug', 'warehouseSlug', 'tenantId', 'locale'),
      ],
    })

    // Simulate snapshot with a truncated index name but same columns
    const snapshot = {
      domains: [],
      enums: [],
      tables: [{
        name: 'storage_location_translation',
        columns: [
          { name: 'location_slug', camelName: 'locationSlug', type: 'text', isNullable: false, defaultValue: undefined },
          { name: 'warehouse_slug', camelName: 'warehouseSlug', type: 'text', isNullable: false, defaultValue: undefined },
          { name: 'tenant_id', camelName: 'tenantId', type: 'text', isNullable: false, defaultValue: undefined },
          { name: 'locale', camelName: 'locale', type: 'text', isNullable: false, defaultValue: undefined },
          { name: 'name', camelName: 'name', type: 'text', isNullable: false, defaultValue: undefined },
        ],
        primaryKey: ['location_slug', 'warehouse_slug', 'tenant_id', 'locale'],
        foreignKeys: [],
        indexes: [{
          name: 'idx_storage_location_translation_location_slug_warehouse_slug_t', // PG truncated
          columns: ['location_slug', 'warehouse_slug', 'tenant_id', 'locale'],
          isUnique: false,
        }],
      }],
      views: [],
    } as const

    const plan = diff(
      { domains: [], enums: [], tables: [longTable], views: [] },
      snapshot,
    )

    // Should NOT emit a createIndex — the index already exists
    const indexOps = plan.operations.filter(op => op.type === 'createIndex')
    expect(indexOps).toHaveLength(0)
  })

  it('integration: migrate + re-migrate does not fail on long index names', async () => {
    const testDb = await createTestDatabase({ connectionString, schema: [] })

    try {
      const longTable = table('long_name_table_for_testing', {
        columns: {
          firstColumn: text().notNull(),
          secondColumn: text().notNull(),
          thirdColumn: text().notNull(),
          fourthColumn: text().notNull(),
        },
        primaryKey: ['firstColumn'],
        indexes: [
          index('firstColumn', 'secondColumn', 'thirdColumn', 'fourthColumn'),
        ],
      })

      // First migrate
      const snap1 = await introspect(testDb.db)
      const plan1 = diff({ domains: [], enums: [], tables: [longTable], views: [] }, snap1)
      await migrate(testDb.db, plan1)

      // Second migrate — should be a no-op
      const snap2 = await introspect(testDb.db)
      const plan2 = diff({ domains: [], enums: [], tables: [longTable], views: [] }, snap2)
      const indexOps = plan2.operations.filter(op => op.type === 'createIndex')
      expect(indexOps).toHaveLength(0)
    } finally {
      await testDb.dispose()
    }
  })
})
