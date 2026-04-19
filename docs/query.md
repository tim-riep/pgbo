# Query Builder

All queries go through **views**, never tables. pgbo automatically converts camelCase column names to snake_case in SQL, and snake_case results back to camelCase. Result types are fully inferred from the view definition — no manual casts.

## Connection

```typescript
import { createDatabase } from 'pgbo'

const db = createDatabase({
  connectionString: 'postgresql://user@localhost:5432/mydb',
  pool: {
    min: 2,
    max: 10,
    idleTimeoutMs: 30000,
    connectionTimeoutMs: 5000,
  },
})

// When done:
await db.close()
```

## SELECT

```typescript
// All rows — rows are typed as InferViewRow<typeof warehouseView>
const rows = await db.from(warehouseView).execute()

// With conditions
const active = await db.from(warehouseView)
  .where({ status: 'ACTIVE' })
  .orderBy('name', 'asc')
  .limit(25)
  .offset(0)
  .execute()

// Multi-column ORDER BY — chain or pass an array
await db.from(docView)
  .orderBy('postedAt', 'desc')
  .orderBy('documentNumber', 'asc')
  .execute()
// → ORDER BY posted_at DESC, document_number ASC

await db.from(docView)
  .orderBy([
    { column: 'postedAt', direction: 'desc' },
    { column: 'documentNumber', direction: 'asc' },
  ])
  .execute()

// Count
const total = await db.from(warehouseView).count()
const filtered = await db.from(warehouseView).where({ status: 'ACTIVE' }).count()

// COUNT(DISTINCT col) — for queries where JOINs or translations duplicate parent rows
const distinctSlugs = await db.from(locationView).count({ distinct: 'slug' })
const distinctPairs = await db.from(locationView).count({ distinct: ['slug', 'warehouseSlug'] })
```

The `distinct` key is type-checked against the view's row type.

### Runtime JOINs

`SelectBuilder` supports ad-hoc JOINs when a predefined PG view isn't enough:

```typescript
import { view } from 'pgbo/schema'

const tileView = view('tile_view').from(tileTable)

const rows = await db.from(tileView)
  .join(appTable, { appId: 'id' })         // tile.app_id = app.id
  .select({
    tileSlug: 'tile_view.slug',
    appSlug: 'app.slug',
    appName: 'app.name',
  })
  .where({ action: 'nav' })
  .execute()
```

- `.join(table, { localCol: foreignCol })` — INNER JOIN
- `.leftJoin(table, { localCol: foreignCol })` — LEFT JOIN
- `.select({ outputKey: 'table.column' })` — explicit column list with table qualification, output aliased in snake_case
- JOINs are also included in `.count()`

For static JOINs that should live in the schema, define a proper PG view with `.join()` in the [view builder](schema.md#joined-views) instead.

## WHERE

### Operators

Plain values are shorthand for equality. For other operators, pass an object:

```typescript
.where({ name: 'Alice' })                       // name = 'Alice'
.where({ name: { eq: 'Alice' } })               // name = 'Alice'
.where({ name: { like: '%ali%' } })             // name LIKE '%ali%'
.where({ name: { ilike: '%ali%' } })            // name ILIKE '%ali%' (case-insensitive)
.where({ id: { in: [1, 2, 3] } })              // id IN (1, 2, 3)
.where({ slug: { any: allowedSlugs } })         // slug = ANY($1) — single bound param
.where({ slug: { notAny: seededSlugs } })       // slug != ALL($1) — single bound param
.where({ age: { gt: 18 } })                     // age > 18
.where({ age: { lt: 65 } })                     // age < 65
.where({ age: { gte: 18 } })                    // age >= 18
.where({ age: { lte: 65 } })                    // age <= 65
.where({ age: { between: [18, 65] } })          // age BETWEEN 18 AND 65
.where({ deletedAt: { isNull: true } })         // deleted_at IS NULL
.where({ email: { isNotNull: true } })          // email IS NOT NULL
```

Multiple keys in a single `.where()` are joined with `AND`:

```typescript
.where({ status: 'ACTIVE', tenantId: 1 })
// WHERE status = $1 AND tenant_id = $2
```

### `in` vs `any` / `notAny`

- Use `in` for **static, small, inline** lists (e.g. enum values): `{ status: { in: ['ACTIVE', 'PENDING'] } }` compiles to `col IN ($1, $2)`.
- Use `any` / `notAny` for **dynamic, runtime-computed arrays**: they bind a single parameter (`col = ANY($1)`) regardless of array length. This keeps the prepared-statement cache hot, avoids PG's ~65k parameter cap, and has correct NULL semantics for `!= ALL`.

Empty array behavior:
- `any: []` → `FALSE` (no matches)
- `notAny: []` → `TRUE` (all rows match)

### Logical Operators: OR / AND / NOT

```typescript
// Tenant scoping with global records
.where({
  OR: [
    { tenantId: { isNull: true } },
    { tenantId: currentTenant },
  ],
})
// WHERE (tenant_id IS NULL OR tenant_id = $1)

// Combined with regular conditions (AND between top-level keys)
.where({
  status: 'ACTIVE',
  OR: [
    { tenantId: { isNull: true } },
    { tenantId: currentTenant },
  ],
})
// WHERE status = $1 AND (tenant_id IS NULL OR tenant_id = $2)

// Nested logical operators
.where({
  AND: [
    { status: 'ACTIVE' },
    {
      OR: [
        { slug: { ilike: '%test%' } },
        { name: { ilike: '%test%' } },
      ],
    },
  ],
})

// NOT
.where({ NOT: { status: 'ARCHIVED' } })
// WHERE NOT (status = $1)
```

## INSERT

```typescript
// Single row
await db.into(warehouseView)
  .values({ slug: 'main', name: 'Main Warehouse' })
  .execute()

// Batch insert
await db.into(warehouseView)
  .values([
    { slug: 'main', name: 'Main' },
    { slug: 'returns', name: 'Returns' },
  ])
  .execute()

// With RETURNING
const [created] = await db.into(warehouseView)
  .values({ slug: 'main', name: 'Main' })
  .returning('*')
  .execute()
```

### Upsert (ON CONFLICT)

```typescript
// ON CONFLICT DO NOTHING
await db.into(userMenuGroupView)
  .values({ userId, menuGroupId })
  .onConflict(['userId', 'menuGroupId']).doNothing()
  .execute()

// ON CONFLICT DO UPDATE with literals
await db.into(countryView)
  .values({ code: 'DE', alpha3: 'DEU', numericCode: '276' })
  .onConflict(['code']).doUpdate({
    alpha3: 'DEU',
    numericCode: '276',
  })
  .execute()

// Use incoming values from EXCLUDED row
await db.into(translationView)
  .values({ parentId, locale, name })
  .onConflict(['parentId', 'locale']).doUpdate({
    name: { excluded: true },  // → name = EXCLUDED.name
  })
  .execute()

// Increment existing value (e.g. stock quantity)
const [updated] = await tx.into(stockLevelView)
  .values({ tenantId, wku, warehouseSlug, quantity: baseQty })
  .onConflict(['tenantId', 'wku', 'warehouseSlug']).doUpdate({
    quantity: { increment: baseQty },  // → quantity = stock_level.quantity + $n
  })
  .returning('*')
  .execute()

// Decrement
.onConflict(['id']).doUpdate({
  balance: { decrement: amount },    // → balance = table.balance - $n
})
```

**Assignment types for `.doUpdate()`:**

| Form | SQL |
|------|-----|
| `col: value` | `col = $n` (plain literal) |
| `col: { excluded: true }` | `col = EXCLUDED.col` |
| `col: { increment: N }` | `col = table.col + $n` |
| `col: { decrement: N }` | `col = table.col - $n` |

Alternative conflict target: `.onConflict({ constraint: 'my_unique' })` to target a named unique constraint.

The assignments are typed — `col` must be a valid key of the view's row type, and `value` must match the column's type.

## UPDATE

```typescript
await db.update(warehouseView)
  .set({ name: 'Updated Name' })
  .where({ slug: 'main' })
  .execute()

// With RETURNING
const [updated] = await db.update(warehouseView)
  .set({ name: 'New Name' })
  .where({ slug: 'main' })
  .returning('*')
  .execute()
```

Only the keys provided to `.set()` are included in the `SET` clause.

## DELETE

```typescript
await db.deleteFrom(warehouseView)
  .where({ slug: 'old' })
  .execute()

// With RETURNING
const [deleted] = await db.deleteFrom(warehouseView)
  .where({ slug: 'old' })
  .returning('*')
  .execute()

// Stale cleanup using notAny
await db.deleteFrom(areaView)
  .where({ slug: { notAny: keptSlugs } })
  .execute()
```

**Safety guard:** calling `.execute()` without `.where()` throws an error. To delete all rows, explicitly call `.all()`:

```typescript
await db.deleteFrom(warehouseView).all().execute()
```

## Transactions

```typescript
const result = await db.transaction(async (tx) => {
  await tx.into(warehouseView).values({ slug: 'new', name: 'New' }).execute()
  await tx.update(warehouseView).set({ name: 'Renamed' }).where({ slug: 'new' }).execute()

  const [row] = await tx.from(warehouseView).where({ slug: 'new' }).execute()
  return row
})
// result is the returned row
```

`tx` has the same API as `db` (`from`, `into`, `update`, `deleteFrom`, `transaction`, plus `savepoint`). All operations in the callback run on a single connection.

Transactions auto-rollback on error:

```typescript
try {
  await db.transaction(async (tx) => {
    await tx.into(warehouseView).values({ slug: 'a', name: 'A' }).execute()
    throw new Error('abort')  // rolls back automatically
  })
} catch (e) {
  // row 'a' was NOT inserted
}
```

### Savepoints

```typescript
await db.transaction(async (tx) => {
  await tx.into(warehouseView).values({ slug: 'a', name: 'A' }).execute()

  try {
    await tx.savepoint('sp1', async (sp) => {
      await sp.into(warehouseView).values({ slug: 'b', name: 'B' }).execute()
      throw new Error('rollback savepoint only')
    })
  } catch {
    // 'b' rolled back, 'a' still pending
  }

  // Outer transaction commits with just 'a'
})
```

## Raw SQL

For queries that don't fit the builder pattern:

```typescript
const stats = await db.raw<{ status: string; total: number }>`
  SELECT status, COUNT(*) AS total
  FROM warehouse
  WHERE tenant_id = ${tenantId}
  GROUP BY status
`
```

Values are automatically parameterized (`$1`, `$2`, etc.) — no SQL injection risk.

## SQL Inspection

Use `.toQuery()` on any builder to get the generated SQL without executing:

```typescript
const { text, values } = db.from(warehouseView)
  .where({ status: 'ACTIVE' })
  .orderBy('name', 'asc')
  .toQuery()

// text: 'SELECT * FROM warehouse_view WHERE status = $1 ORDER BY name ASC'
// values: ['ACTIVE']
```

## Type Inference

Query results are typed via `InferViewRow<typeof view>`:

- **Simple view** (`view('x').from(table)`) — row type matches the source table's columns
- **View with `.columns({...})`** — row type is computed from the columns map:
  - Unqualified `col('name')` resolves against the view's source table
  - Qualified `col('slug', appTable)` infers type from the joined table's column
  - `translated('name')` → `string | null`
- **Custom override** via `.as<T>()` — escape hatch for complex cases

```typescript
const rows = await db.from(tileDetailView).execute()
rows[0].appSlug   // ✅ string — no cast needed
rows[0].typo      // ❌ compile error — property doesn't exist
```
