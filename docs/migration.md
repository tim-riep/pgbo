# Migration Engine

pgbo includes an automatic migration engine that keeps your PostgreSQL database in sync with your TypeScript schema definitions.

## Workflow

```typescript
import { createDatabase } from '@pgbo/core'
import { introspect, diff, migrate, type SchemaDefinitions } from '@pgbo/core/migration'

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
| `dropView` | Drop a view whose column set has drifted (issue #55) — always paired with `createView` to re-create it |
| `createView` | New view, or recreate of a view whose column set drifted |

### Dependency Ordering

Operations are ordered by dependency: **domains → enums → tables → indexes → views**. Translation tables declared via `.translations()` are automatically included.

### View column-set drift (issue #55)

Postgres has no `CREATE OR REPLACE VIEW` that allows column-list changes — only DROP + CREATE handles renaming, adding, or removing columns. The diff engine compares each managed view's expected output columns against `information_schema.columns`. If **any** managed view differs, the plan emits:

1. `DROP VIEW IF EXISTS <name> CASCADE` for every managed view in the snapshot.
2. `CREATE VIEW <name> AS …` for every view in the schema definitions.

`CASCADE` handles dependency ordering automatically. The trade-off: an **unmanaged** view that depends on a managed one is dropped silently (the schema doesn't know about it). Either register every view with the schema or recreate the unmanaged one out-of-band after migration.

When no managed view's column set has drifted, only newly-defined views get a `createView` — existing ones are left alone.

### Scope: additive-only (with the view-recreate exception)

The diff engine is **deliberately additive** for everything except views:

| Detected | Not detected |
|---|---|
| New domain / enum / table / column / index / view | Dropped column / table / index |
| Enum value added | Enum value removed (Postgres can't anyway) |
| Drifted view column set → drop + recreate | Column type change, default change, constraint change |
| | Renamed column / table / index |

Destructive changes (drops, renames, type changes) are intentionally out of scope — they require human review and downtime planning that an auto-diff can't infer. For those, write a hand-rolled migration script and run it before `migrate()`.

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
