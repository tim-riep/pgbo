# Migration Engine

pgbo includes an automatic migration engine that keeps your PostgreSQL database in sync with your TypeScript schema definitions.

## Workflow

```typescript
import { createDatabase } from 'pgbo'
import { introspect, diff, migrate, type SchemaDefinitions } from 'pgbo/migration'

const db = createDatabase({ connectionString: '...' })

// 1. Read current database state
const snapshot = await introspect(db)

// 2. Compare against desired schema
const schema: SchemaDefinitions = {
  domains: [slug, tenantId],
  enums: [stockType],
  tables: [warehouse, product],
  views: [warehouseView, productView],
}
const plan = diff(schema, snapshot)

// 3. Apply changes
if (plan.operations.length > 0) {
  await migrate(db, plan)
}
```

## Introspect

`introspect(db)` reads the current database schema from system catalogs and returns a `DatabaseSnapshot`:

```typescript
const snapshot = await introspect(db)

snapshot.domains   // [{ name, baseType, checks }]
snapshot.enums     // [{ name, values }]
snapshot.tables    // [{ name, columns, primaryKey, foreignKeys, indexes }]
snapshot.views     // [{ name, definition }]
```

Each column includes both the original `name` (snake_case) and a `camelName` conversion. Foreign keys include `camelColumns` alongside `columns`.

## Diff

`diff(definitions, snapshot)` compares your schema definitions against the introspected state and produces a `MigrationPlan`:

```typescript
const plan = diff(schema, snapshot)

for (const op of plan.operations) {
  console.log(`[${op.type}] ${op.sql}`)
}
```

### Detected Changes

| Operation | Description |
|-----------|-------------|
| `createDomain` | New domain |
| `createEnum` | New enum type |
| `alterEnum` | New values added to existing enum |
| `createTable` | New table (includes translation tables) |
| `addColumn` | New column on existing table |
| `createIndex` | New index on existing table |
| `createView` | New view |

### Dependency Ordering

Operations are ordered by dependency: **domains -> enums -> tables -> indexes -> views**. Translation tables declared via `.translations()` are automatically included.

## Migrate

`migrate(db, plan)` executes the migration plan:

- All DDL is wrapped in a **transaction** — on failure, everything rolls back
- Records each migration in the `_pgbo_migrations` table with timestamp, operation count, and full operation log

```typescript
await migrate(db, plan)
```

## CLI

```bash
pgbo migrate --schema ./schema.ts --db postgresql://localhost:5432/mydb
pgbo status --db postgresql://localhost:5432/mydb
pgbo introspect --db postgresql://localhost:5432/mydb
```

The `--db` flag defaults to `$DATABASE_URL` if not provided.
