# Testing Utilities

pgbo includes built-in testing utilities for creating disposable databases, managing fixtures, and asserting schema state.

## Test Database

`createTestDatabase()` creates a temporary PostgreSQL database, applies schema DDL, and optionally seeds data. On dispose, it drops the database.

```typescript
import { createTestDatabase } from '@pgbo/core/testing'

const testDb = await createTestDatabase({
  connectionString: 'postgresql://localhost:5432/postgres',
  schema: [warehouseTable, productTable],
  seed: [
    "INSERT INTO warehouse (slug, name) VALUES ('main', 'Main')",
  ],
})

// Use testDb.db for queries (same API as production)
const rows = await testDb.db.from(warehouseView).execute()

// Raw SQL for assertions
const result = await testDb.raw<{ count: string }>('SELECT COUNT(*) AS count FROM warehouse')

// Reset: truncate all tables, re-apply seed
await testDb.reset()

// Cleanup: drop database
await testDb.dispose()
```

### Configuration

```typescript
interface TestDatabaseConfig {
  connectionString: string                          // PG server connection
  schema: readonly (TableDef | DomainDef | EnumDef)[] // Schema to migrate
  seed?: readonly string[]                          // SQL statements to run after migration
  prefix?: string                                   // DB name prefix (default: 'pgbo_test_')
}
```

### With Vitest

```typescript
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@pgbo/core/testing'

describe('Warehouse', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString: process.env.PGBO_TEST_URL!,
      schema: [warehouseTable],
      seed: ['CREATE OR REPLACE VIEW warehouse_view AS SELECT * FROM warehouse'],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  beforeEach(async () => {
    await testDb.reset()
  })

  it('creates a warehouse', async () => {
    await testDb.db.into(warehouseView).values({ slug: 'test', name: 'Test' }).execute()
    const rows = await testDb.db.from(warehouseView).execute()
    expect(rows).toHaveLength(1)
  })
})
```

## Fixtures

Typed seed data with insert and cleanup helpers:

```typescript
import { fixture } from '@pgbo/core/testing'

const warehouses = fixture(warehouseTable, [
  { slug: 'wh1', name: 'Warehouse 1' },
  { slug: 'wh2', name: 'Warehouse 2' },
])

// Insert all fixture data
await warehouses.insert(testDb.db)

// Clean up
await warehouses.cleanup(testDb.db)
```

## Schema Assertions

### assertMigration

Verify that expected database objects exist:

```typescript
import { assertMigration } from '@pgbo/core/testing'

await assertMigration(testDb, {
  tables: ['warehouse', 'product'],
  views: ['warehouse_view'],
  domains: ['slug'],
  enums: ['stock_type'],
})
```

### assertSchema

Verify table structure:

```typescript
import { assertSchema } from '@pgbo/core/testing'

await assertSchema(testDb, 'warehouse', {
  columns: { slug: 'text', name: 'text', created_at: 'timestamp' },
  primaryKey: ['slug'],
})
```
