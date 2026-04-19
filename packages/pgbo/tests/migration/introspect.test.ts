import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import { introspect } from '../../src/migration/introspect.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

describe('PostgreSQL introspection', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [],
      seed: [
        // Create domain
        "CREATE DOMAIN slug AS text CHECK (length(VALUE) >= 1 AND length(VALUE) <= 128)",
        // Create enum
        "CREATE TYPE stock_type AS ENUM ('RECEIPT', 'ADJUSTMENT', 'TRANSFER')",
        // Create tables
        `CREATE TABLE warehouse (
          slug slug NOT NULL,
          tenant_id integer,
          name text NOT NULL,
          created_at timestamptz DEFAULT now(),
          PRIMARY KEY (slug)
        )`,
        `CREATE TABLE warehouse_product (
          wku text NOT NULL,
          warehouse_slug slug NOT NULL,
          stock_type stock_type,
          PRIMARY KEY (wku),
          FOREIGN KEY (warehouse_slug) REFERENCES warehouse(slug) ON DELETE CASCADE
        )`,
        // Create index
        'CREATE INDEX idx_warehouse_name ON warehouse (name)',
        'CREATE UNIQUE INDEX idx_wp_slug ON warehouse_product (warehouse_slug)',
        // Create view
        'CREATE VIEW warehouse_view AS SELECT slug, name, created_at FROM warehouse',
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('reads domains from information_schema', async () => {
    const snapshot = await introspect(testDb.db)
    const domain = snapshot.domains.find(d => d.name === 'slug')
    expect(domain).toBeDefined()
    expect(domain!.baseType).toBe('text')
  })

  it('reads enums from pg_type + pg_enum', async () => {
    const snapshot = await introspect(testDb.db)
    const enumDef = snapshot.enums.find(e => e.name === 'stock_type')
    expect(enumDef).toBeDefined()
    expect(enumDef!.values).toEqual(['RECEIPT', 'ADJUSTMENT', 'TRANSFER'])
  })

  it('reads tables with columns, types, nullability, defaults', async () => {
    const snapshot = await introspect(testDb.db)
    const table = snapshot.tables.find(t => t.name === 'warehouse')
    expect(table).toBeDefined()

    const slugCol = table!.columns.find(c => c.name === 'slug')
    expect(slugCol).toBeDefined()
    expect(slugCol!.type).toBe('slug')  // domain type
    expect(slugCol!.isNullable).toBe(false)

    const nameCol = table!.columns.find(c => c.name === 'name')
    expect(nameCol!.type).toBe('text')
    expect(nameCol!.isNullable).toBe(false)

    const createdCol = table!.columns.find(c => c.name === 'created_at')
    expect(createdCol!.isNullable).toBe(true)
    expect(createdCol!.defaultValue).toContain('now()')
  })

  it('reads primary keys', async () => {
    const snapshot = await introspect(testDb.db)
    const table = snapshot.tables.find(t => t.name === 'warehouse')
    expect(table!.primaryKey).toEqual(['slug'])

    const wpTable = snapshot.tables.find(t => t.name === 'warehouse_product')
    expect(wpTable!.primaryKey).toEqual(['wku'])
  })

  it('reads foreign keys (single and composite)', async () => {
    const snapshot = await introspect(testDb.db)
    const wpTable = snapshot.tables.find(t => t.name === 'warehouse_product')
    expect(wpTable!.foreignKeys).toHaveLength(1)
    const fk = wpTable!.foreignKeys[0]!
    expect(fk.columns).toEqual(['warehouse_slug'])
    expect(fk.refTable).toBe('warehouse')
    expect(fk.refColumns).toEqual(['slug'])
    expect(fk.onDelete).toBe('CASCADE')
  })

  it('reads indexes', async () => {
    const snapshot = await introspect(testDb.db)
    const table = snapshot.tables.find(t => t.name === 'warehouse')
    const idx = table!.indexes.find(i => i.name === 'idx_warehouse_name')
    expect(idx).toBeDefined()
    expect(idx!.columns).toEqual(['name'])
    expect(idx!.isUnique).toBe(false)

    const wpTable = snapshot.tables.find(t => t.name === 'warehouse_product')
    const uidx = wpTable!.indexes.find(i => i.name === 'idx_wp_slug')
    expect(uidx).toBeDefined()
    expect(uidx!.isUnique).toBe(true)
  })

  it('reads views with definitions', async () => {
    const snapshot = await introspect(testDb.db)
    const v = snapshot.views.find(v => v.name === 'warehouse_view')
    expect(v).toBeDefined()
    expect(v!.definition).toContain('SELECT')
  })

  it('maps snake_case PG names to camelCase', async () => {
    const snapshot = await introspect(testDb.db)
    const table = snapshot.tables.find(t => t.name === 'warehouse')
    const col = table!.columns.find(c => c.name === 'created_at')
    expect(col!.camelName).toBe('createdAt')

    const wpTable = snapshot.tables.find(t => t.name === 'warehouse_product')
    const fk = wpTable!.foreignKeys[0]!
    expect(fk.camelColumns).toEqual(['warehouseSlug'])
  })
})
