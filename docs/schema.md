# Schema Definition

pgbo uses a TypeScript DSL to define your database schema. No raw SQL strings, no code generation — types flow at compile time.

## Column Types

Every column starts with a type builder function:

```typescript
import {
  text, integer, bigint, serial, bigserial,
  numeric, real, doublePrecision,
  boolean, uuid, timestamp, date, time, interval,
  jsonb, json, bytea, array,
  daterange, int4range, numrange, tsrange, tstzrange,
} from '@pgbo/core/schema'
```

### Type Mapping

| Builder | PostgreSQL | TypeScript |
|---------|-----------|------------|
| `text()` | `text` | `string` |
| `integer()` | `integer` | `number` |
| `bigint()` | `bigint` | `string` |
| `serial()` | `serial` | `number` |
| `bigserial()` | `bigserial` | `string` |
| `numeric()` | `numeric` | `number` |
| `real()` | `real` | `number` |
| `doublePrecision()` | `double precision` | `number` |
| `boolean()` | `boolean` | `boolean` |
| `uuid()` | `uuid` | `string` |
| `timestamp()` | `timestamp` | `Date` |
| `date()` | `date` | `string` |
| `time()` | `time` | `string` |
| `interval()` | `interval` | `string` |
| `jsonb()` | `jsonb` | `unknown` |
| `json()` | `json` | `unknown` |
| `bytea()` | `bytea` | `Buffer` |
| `array(text())` | `text[]` | `string[]` |

### Constraint Methods

All column builders support chainable constraints:

```typescript
// Nullability & defaults
text().notNull()                    // NOT NULL
text().nullable()                   // removes NOT NULL
text().default('hello')             // DEFAULT 'hello'
timestamp().defaultNow()            // DEFAULT now()
uuid().defaultRandom()              // DEFAULT gen_random_uuid()
text().unique()                     // UNIQUE

// Text constraints
text().length(255)                  // varchar(255)
text().minLength(1)                 // CHECK (length(col) >= 1)
text().maxLength(100)               // CHECK (length(col) <= 100)
text().pattern(/^[a-z]+$/)          // CHECK (col ~ '^[a-z]+$')

// Numeric constraints
integer().min(0)                    // CHECK (col >= 0)
integer().max(100)                  // CHECK (col <= 100)
integer().between(1, 10)            // CHECK (col >= 1 AND col <= 10)
integer().positive()                // CHECK (col > 0)

// Type-specific
numeric().precision(10, 2)          // numeric(10,2)
timestamp().withTimeZone()          // timestamptz
```

## Tables

```typescript
import { table, text, integer, timestamp, index, foreignKey, check } from '@pgbo/core/schema'

const warehouse = table('warehouse', {
  columns: {
    slug: text().notNull(),
    tenantId: integer().notNull(),
    name: text().notNull().minLength(1),
    capacity: integer().min(0),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['slug', 'tenantId'],
  indexes: [
    index('name'),
    index('slug', 'tenantId').unique(),
    index('status').where("status != 'ARCHIVED'"),  // partial index
    index('data').using('gin'),                      // GIN index
  ],
  foreignKeys: [
    foreignKey(['tenantId']).references('tenant', ['id']).onDelete('CASCADE'),
  ],
  checks: [
    check('capacity').greaterThanOrEqual(0),
  ],
})
```

Column names are written in **camelCase** in TypeScript. pgbo automatically converts them to **snake_case** in the generated DDL:

```
tenantId  → tenant_id
createdAt → created_at
```

### Translation Tables

Declare translated fields on a table to auto-generate a translation table:

```typescript
const area = table('area', {
  columns: {
    slug: text().notNull(),
    sortOrder: integer().default(0),
  },
  primaryKey: ['slug'],
  translations: ['name'],  // generates area_translation table
})
```

This auto-generates:

```sql
CREATE TABLE area_translation (
  slug text NOT NULL,
  locale locale_code NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (slug, locale),
  FOREIGN KEY (slug) REFERENCES area(slug) ON DELETE CASCADE
);
```

## Domains

Reusable constrained types. A domain wraps a column type with validation and optional FK references:

```typescript
import { domain, text, integer } from '@pgbo/core/schema'

const slug = domain('slug', text().minLength(1).maxLength(128).pattern(/^[a-z0-9-]+$/))
const tenantId = domain('tenant_id', integer()).references('tenant', 'id', 'CASCADE')

// Inherit from another domain
const warehouseSlug = domain('warehouse_slug', slug)
```

DDL output:
```sql
CREATE DOMAIN slug AS text CHECK (length(VALUE) >= 1) CHECK (length(VALUE) <= 128) CHECK (VALUE ~ '^[a-z0-9-]+$')
CREATE DOMAIN warehouse_slug AS slug
```

## Enums

```typescript
import { pgEnum } from '@pgbo/core/schema'

const stockType = pgEnum('stock_type', ['RECEIPT', 'ADJUSTMENT', 'TRANSFER'])

// Use in a table column:
const doc = table('stock_document', {
  columns: {
    type: stockType.column().notNull(),
    // ...
  },
  primaryKey: ['id'],
})
```

DDL: `CREATE TYPE stock_type AS ENUM ('RECEIPT', 'ADJUSTMENT', 'TRANSFER')`

## Views

Views are the **only interface** between application code and the database:

```typescript
import { view, valueHelpView, col, translated } from '@pgbo/core/schema'

const warehouseView = view('warehouse_view')
  .from(warehouseTable)
  .columns({
    slug: col('slug').label('crud.slug').filterable().immutable(),
    name: col('name').label('crud.name').searchable(),
    description: translated('description'),  // auto-joins translation table
  })
```

### Joined Views

Views can JOIN multiple tables. Use `col('colName', sourceTable)` to reference a column from a joined table:

```typescript
const tileDetailView = view('tile_detail_view')
  .from(tileTable)
  .join(appTable, { appId: 'id' })        // tile.app_id = app.id
  .columns({
    id: col('id'),                          // from tileTable (default)
    slug: col('slug'),                      // from tileTable
    appSlug: col('slug', appTable),         // from appTable — aliased as app_slug
    appName: col('name', appTable),         // from appTable — aliased as app_name
  })
```

Generated DDL:
```sql
CREATE VIEW tile_detail_view AS
SELECT tile.id, tile.slug, app.slug AS app_slug, app.name AS app_name
FROM tile
JOIN app ON tile.app_id = app.id
```

Use `.leftJoin()` for optional relationships:

```typescript
const view = view('orders_view')
  .from(ordersTable)
  .leftJoin(customersTable, { customerId: 'id' })
  .columns({ ... })
```

### Simple Views

A view without `.columns()` selects all columns from the source table:

```typescript
const warehouseView = view('warehouse_view')
  .from(warehouseTable)
  // SELECT * equivalent
```

### Subquery Count Columns

Count related child rows as a scalar view column — no raw SQL, no second query:

```typescript
import { view, col, subqueryCount } from '@pgbo/core/schema'

const stockDocumentListView = view('stock_document_list_view')
  .from(stockDocumentTable)
  .columns({
    id: col('id'),
    documentNumber: col('documentNumber'),
    itemCount: subqueryCount(stockDocumentItemTable, { id: 'documentId' }),
    //                       ^ child table         ^ { parentCol: childCol }
    activeItems: subqueryCount(stockDocumentItemTable, { id: 'documentId' }, {
      where: "stock_document_item.status = 'active'",
    }),
  })
```

Generated DDL:
```sql
CREATE VIEW stock_document_list_view AS SELECT
  stock_document.id,
  stock_document.document_number,
  (SELECT COUNT(*) FROM stock_document_item
     WHERE stock_document_item.document_id = stock_document.id)::integer AS item_count,
  (SELECT COUNT(*) FROM stock_document_item
     WHERE stock_document_item.document_id = stock_document.id
       AND (stock_document_item.status = 'active'))::integer AS active_items
FROM stock_document
```

- Row type: `itemCount` is inferred as `number`.
- Composite parent keys: `{ parentCol1: 'childCol1', parentCol2: 'childCol2' }`.
- Optional `where` is raw SQL — qualify columns with the child table name.

### Value Help Views

Flat read-only views for dropdowns:

```typescript
const warehouseValueHelp = valueHelpView('warehouse_vh')
  .from(warehouseTable)
  .key('slug')
  .display('name')
```

### Associations

Declare read-time navigation relations on the view. BOs built on this view inherit them automatically — no need to redeclare in `defineBO()`.

```typescript
const pageView = view('page_view')
  .from(pageTable)
  .associations({
    area: { foreignKey: 'areaId', target: areaView },
    author: { foreignKey: 'authorId', target: userView },
  })
  .columns({ /* ... */ })
```

The `target` is optional but recommended — `viewMeta().associations` surfaces it so metadata endpoints and enrichment utilities can resolve relations without BO context.

BO-level `associations` still work and take precedence on key collision:

```typescript
const pageBO = defineBO(pageView, {
  paramField: 'id',
  // Inherits { area, author } from the view.
  // Can override or add more:
  associations: {
    area: { foreignKey: 'customAreaId' },  // overrides view's
    extra: { foreignKey: 'extraId' },       // adds a new one
  },
})
```

Compositions (write-time cascade semantics) stay BO-only — they aren't inherited from the view.

### Auth Restrictions

Views carry declarative auth annotations. pgbo enforces them via a pluggable handler before query execution:

```typescript
const warehouseView = view('warehouse_view')
  .from(warehouseTable)
  .restrict({ grant: 'READ', to: 'MANAGE_WAREHOUSE' })
  .restrict({ grant: 'WRITE', to: 'MANAGE_WAREHOUSE' })
  .columns({ ... })

// Value help — no auth required
const warehouseVH = valueHelpView('warehouse_vh')
  .from(warehouseTable)
  .noAuth()
  .key('slug').display('name')

// Additional context (opaque to pgbo — passed to handler as-is)
const pageView = view('page_view')
  .from(pageTable)
  .restrict({ grant: 'READ', to: 'FRONTEND_DESIGN', where: { FRONTEND_OBJECT: 'PAGES' } })
```

Register the handler at startup:

```typescript
db.setAuthHandler(async (userId, restriction) => {
  // Your app's auth logic — pgbo does NOT interpret 'to' or 'where'
  return hasPermission(userId, restriction.to, restriction.where)
})
```

Queries enforce auth via `.as(userId)`:

```typescript
const rows = await db.from(warehouseView).as(req.user.sub).execute()
// → handler called with ('user-123', { grant: 'READ', to: 'MANAGE_WAREHOUSE' })
// → throws if denied
```

Grant mapping:
- `db.from()` → `READ`
- `db.into()` / `db.update()` → `WRITE`
- `db.deleteFrom()` → `DELETE`, falls back to `WRITE` if no DELETE-specific restriction

Views with `.noAuth()` skip all checks. Views without annotations are fail-open (no check).

### View with WHERE

```typescript
const activeView = view('active_warehouses')
  .from(warehouseTable)
  .where("status = 'ACTIVE'")
```

### Type Inference

Views are fully typed through `InferViewRow<typeof view>`. When `.columns()` is used, the row type is computed from the columns map:

- `col('name')` — unqualified, type resolved from the view's source table
- `col('slug', appTable)` — qualified, type inferred from `appTable.columns.slug`
- `translated('name')` — resolves to `string | null`

Example:
```typescript
const tileDetailView = view('tile_detail_view')
  .from(tileTable)
  .join(appTable, { appId: 'id' })
  .columns({
    id: col('id'),                   // number (from tileTable)
    appSlug: col('slug', appTable),  // string (from appTable.columns.slug)
    appName: col('name', appTable),  // string
  })

const rows = await db.from(tileDetailView).execute()
rows[0].appSlug   // ✅ typed as string — no cast
rows[0].typo      // ❌ compile error
```

For cases where automatic inference isn't enough, use `.as<T>()` as an explicit escape hatch:

```typescript
const v = view('custom').from(someTable).as<{ id: number; label: string }>()
```

### Field Annotations

Annotations control UI behavior in the BO framework:

```typescript
col('slug')
  .label('crud.slug')          // i18n key for display label
  .searchable()                // included in full-text search
  .filterable()                // shows filter in UI
  .immutable()                 // can't change after creation
  .hidden()                    // excluded from metadata
  .inList(false)               // hidden from list view
  .inForm(false)               // hidden from form view
  .valueHelp(warehouseVH)      // links to dropdown source
```

## Type Inference

Types are inferred from definitions at compile time — no code generation:

```typescript
import type { InferRow, InferInsert, InferUpdate } from '@pgbo/core/schema'

type WarehouseRow = InferRow<typeof warehouseTable>
// { slug: string; tenantId: number; name: string; capacity: number | null; createdAt: Date | null }

type WarehouseInsert = InferInsert<typeof warehouseTable>
// { slug: string; tenantId: number; name: string; capacity?: number | null; createdAt?: Date | null }

type WarehouseUpdate = InferUpdate<typeof warehouseTable>
// { slug?: string; tenantId?: number; name?: string; capacity?: number | null; createdAt?: Date | null }
```

Rules:
- `InferRow`: all columns mapped to TS types, nullable columns get `| null`
- `InferInsert`: nullable and default columns are optional, the rest required
- `InferUpdate`: all columns optional
