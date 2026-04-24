# Business Objects

A Business Object (BO) is a managed entity that wraps a view with CRUD lifecycle, permission checks, and hooks. BOs are **read-only by default** — you must explicitly define actions to enable writes.

**BOs are not exposed to HTTP directly.** Any HTTP surface goes through a [**Projection**](#projections) — an explicit whitelist of actions and columns. BOs stay importable for custom action handlers, CLI scripts, and internal use; projections are the only thing wired to `registerProjection` in `@pgbo/fastify`.

## Defining a BO

```typescript
import { defineBO } from '@pgbo/core/bo'

const warehouseBO = defineBO(warehouseTable, {
  paramField: 'slug',
  actions: {
    create: {},
    update: {},
    delete: {},
  },
})
```

With no `actions`, the BO is read-only:

```typescript
const readOnlyBO = defineBO(warehouseTable, {})
readOnlyBO.isReadOnly  // true
```

## BO Name

`bo.name` defaults to the **camelCase** form of the root table/view name, matching pgbo's camelCase-everywhere convention on the query side. The SQL identifier (`root.name`) stays snake_case.

```typescript
const bo = defineBO(stockJournalTable, { paramField: 'id' })
bo.name       // 'stockJournal'
bo.root.name  // 'stock_journal'
```

Override with `config.name` when needed:

```typescript
const bo = defineBO(stockJournalTable, {
  name: 'stockJournalEntries',
  paramField: 'id',
})
```

## List & Route Metadata

BOs carry route-level metadata so consuming apps don't need per-BO config duplication:

```typescript
const areaBO = defineBO(areaTable, {
  paramField: 'id',
  routePrefix: '/api/areas',
  orderBy: 'sortOrder',
  orderDir: 'asc',
  cacheTags: ['area', 'navigation'],
  virtualFields: [
    { key: 'childCount', kind: 'number', label: 'crud.childCount' },
  ],
  transformItems: async (rows, locale, db) => {
    // Custom post-processing after enrichCompositions
    return rows
  },
})
```

- `routePrefix` — default route path for the consuming framework
- `orderBy` / `orderDir` — default sort for list queries
- `cacheTags` — cache invalidation tags
- `virtualFields` — fields populated by `transformItems`, merged into `boMeta()` output
- `transformItems` — batch transform that runs after `enrichCompositions`

`searchColumns` and `filterColumns` are derived from the view's column annotations (`.searchable()`, `.filterable()`) — not from BO config. Read them from `boMeta().fields`.

## Actions

### Standard CRUD

BO methods are fully typed based on the root table/view:

- `create(db, ctx, data)` — `data` is `InferInsert<typeof table>` (required columns + optional defaults/nullables, plus composition keys)
- `update(db, ctx, data)` — `data` requires the `paramField` + any optional column updates
- `delete(db, ctx, data)` — `data` only needs the `paramField`
- Return types are `InferRow<typeof table>` so callers get typed results

```typescript
// Create — name is required (notNull, no default); extra keys caught at compile time
const created = await warehouseBO.create(db, ctx, {
  slug: 'new-wh', name: 'New Warehouse',
})

// Update (paramField identifies the record)
const updated = await warehouseBO.update(db, ctx, {
  slug: 'new-wh', name: 'Renamed',
})

// Delete
await warehouseBO.delete(db, ctx, { slug: 'new-wh' })
```

### Permission Checks

```typescript
const warehouseBO = defineBO(warehouseTable, {
  paramField: 'slug',
  actions: {
    create: {
      permission: (ctx) => ctx.role === 'admin',  // return false to deny
    },
    update: {
      permission: (ctx) => {
        if (ctx.role !== 'admin') return 'Admin access required'  // return string for error message
        return true
      },
    },
  },
})
```

### Before/After Hooks

```typescript
const warehouseBO = defineBO(warehouseTable, {
  paramField: 'slug',
  actions: {
    create: {
      before: async (ctx, data) => {
        // Validate or transform data before insert
        if (data.slug.includes(' ')) return 'Slug cannot contain spaces'
      },
      after: async (ctx, result) => {
        // Side effects after successful insert
        console.log('Created:', result.slug)
      },
    },
  },
})
```

### Custom Actions

```typescript
const docBO = defineBO(docTable, {
  paramField: 'id',
  actions: {
    reverse: {
      permission: (ctx) => hasPermission(ctx, 'MANAGE_STOCK'),
      handler: async (ctx, data) => {
        // Custom logic — framework doesn't do standard CRUD
        return await reverseDocument(data.id)
      },
    },
  },
})

await docBO.execute(db, 'reverse', ctx, { id: 123 })
```

## Compositions

Compositions define deeply owned child entities. On create, the BO inserts the parent then the children:

```typescript
const warehouseBO = defineBO(warehouseTable, {
  paramField: 'slug',
  actions: { create: {}, update: {}, delete: {} },
  compositions: {
    translations: {
      table: warehouseTranslationTable,
      parentKey: 'warehouseSlug',  // FK column on the child
    },
  },
})

// Create parent + children in one call
await warehouseBO.create(db, ctx, {
  slug: 'main',
  name: 'Main Warehouse',
  translations: [
    { locale: 'en', name: 'Main Warehouse' },
    { locale: 'de', name: 'Hauptlager' },
  ],
})
```

On delete, PostgreSQL FK cascades handle child cleanup automatically.

### Auto-enrichment on Read

Compositions are also batch-loaded on reads via `enrichCompositions()`:

```typescript
import { enrichCompositions } from '@pgbo/core/bo'

const items = await db.from(menuGroupView).execute()
const enriched = await enrichCompositions(db, menuGroupBO, items)

// enriched[0]:
// {
//   id: 1, slug: 'nav',
//   translations: [{ locale: 'en', name: 'Navigation' }, ...],
//   pages: [{ menuGroupId: 1, pageSlug: 'home' }, ...],
// }
```

The function:
1. Collects parent IDs from `items` using `bo.paramField`
2. Runs one `WHERE parent_key = ANY($1)` query per composition (in parallel)
3. Groups results and attaches as nested arrays
4. Returns new objects — does not mutate the input
5. Snake_case keys in child rows are converted to camelCase

### Filtered compositions — cardinality, where, merge

Compositions default to returning every matching child as an array (`cardinality: 'many'`). Three options change this:

```typescript
const areaBO = defineBO(areaTable, {
  paramField: 'id',
  compositions: {
    // The one translation row matching the caller's locale
    translation: {
      table: areaTranslationTable,
      parentKey: 'areaId',
      cardinality: 'one',
      where: { locale: '$locale' },
    },
    // Current contract — filter by validity window
    currentContract: {
      table: contractTable,
      parentKey: 'customerId',
      cardinality: 'one',
      where: {
        validFrom: { lte: '$now' },
        validTo:   { gte: '$now' },
      },
    },
    // Primary address — literal filter, no placeholder
    primaryAddress: {
      table: addressTable,
      parentKey: 'customerId',
      cardinality: 'one',
      where: { isPrimary: 'yes' },
    },
  },
})
```

**`cardinality`** — `'many'` (default, array) or `'one'` (single object or `null`).

**`where`** — a WHERE clause applied to the composition query. Supports the same operators as `db.where()` (`lte`, `gte`, `ilike`, `any`, `in`, etc.) plus context placeholders:

| Placeholder  | Resolved to   |
|--------------|---------------|
| `$locale`    | `ctx.locale`  |
| `$userId`    | `ctx.userId`  |
| `$tenantId`  | `ctx.tenantId`|
| `$now`       | `new Date()`  |

Pass `ctx` via `enrichCompositions(db, bo, items, { ctx })`. If a placeholder references ctx data that's missing, enrichment **throws** — failing loud beats silently returning unfiltered results.

**`merge`** — with `cardinality: 'one'`, lifts the matched child's fields onto the parent instead of attaching a nested object. Common for translations:

```typescript
compositions: {
  translation: {
    table: areaTranslationTable,
    parentKey: 'areaId',
    cardinality: 'one',
    where: { locale: '$locale' },
    merge: ['name', 'description'],
  },
}

// Result: { id, slug, name, description } — no nested 'translation' object
```

### Nested Sub-Children

Compositions can declare their own `children` for multi-level loading:

```typescript
const roleBO = defineBO(roleView, {
  paramField: 'id',
  compositions: {
    fragments: {
      table: roleFragmentTable,
      parentKey: 'roleId',
      children: {
        values: {
          table: roleFragmentValueTable,
          parentKey: 'roleFragmentId',
        },
      },
    },
  },
})

const enriched = await enrichCompositions(db, roleBO, items)
// enriched[0]:
// {
//   id: 1, slug: 'admin',
//   fragments: [
//     { fragmentSlug: 'MANAGE_STOCK', values: [
//       { fieldSlug: 'ACTION', value: '*' },
//       { fieldSlug: 'WAREHOUSE', value: '*' },
//     ]},
//   ],
// }
```

`enrichCompositions` recursively loads each `children` level. Sub-children use the child table's primary key to collect IDs for the next level.

## Associations

Associations are loose references to other entities (the referenced entity has its own lifecycle):

```typescript
const productBO = defineBO(productTable, {
  paramField: 'sku',
  actions: { create: {}, update: {}, delete: {} },
  associations: {
    warehouse: { foreignKey: 'warehouseSlug' },
  },
})
```

## Value Helps

Link dropdown sources to a BO:

```typescript
const productBO = defineBO(productTable, {
  paramField: 'sku',
  actions: { create: {} },
  valueHelps: {
    warehouse: warehouseValueHelp,
  },
})
```

## Projections

A projection is the HTTP surface layered on top of a BO. The BO holds the data model and write logic; the projection declares **exactly** what is reachable over HTTP — which actions are whitelisted, which columns are visible, and what root-level WHERE applies to every query.

```typescript
import { defineBO, defineProjection } from '@pgbo/core/bo'

const areaBO = defineBO(areaTable, {
  paramField: 'id',
  actions: {
    create: {}, update: {}, delete: {},
    rebuildCache: { handler: async () => { /* ... */ } },
    internalExport: { handler: async () => { /* ... */ } },
  },
})

// Public read-only surface
const areaPublic = defineProjection(areaBO, {
  name: 'areaPublic',
  actions: { read: true },
  columns: ['id', 'slug', 'name'],  // internal columns hidden
})

// Admin surface — CRUD + one custom action, but NOT internalExport
const areaAdmin = defineProjection(areaBO, {
  name: 'areaAdmin',
  actions: { read: true, create: true, update: true, delete: true, rebuildCache: true },
})
```

### Explicit action whitelist

Only actions listed with `true` produce routes. Standard keys:

| Key        | Routes registered                         |
|------------|-------------------------------------------|
| `read`     | `GET {prefix}`, `GET {prefix}/:param`, `GET /bo/{name}` |
| `create`   | `POST {prefix}`                           |
| `update`   | `PUT {prefix}/:param`                     |
| `delete`   | `DELETE {prefix}/:param`                  |
| `<custom>` | `POST /bo/{name}/{custom}`                |

Actions not mentioned in the whitelist produce no routes. Accidentally adding an action to the BO **does not** expose it — it must be explicitly whitelisted on every projection.

### Column narrowing

When `columns` is set, responses and the metadata endpoint return only those fields. Fields absent from the projection are invisible to the consumer.

### Root WHERE

`where` applies to every list, detail, update, and delete through the projection. Rows that don't match are invisible — detail returns `404`, updates/deletes on out-of-scope rows also return `404`.

```typescript
const activeCustomer = defineProjection(customerBO, {
  name: 'activeCustomer',
  actions: { read: true, update: true },
  where: { status: 'ACTIVE' },
})
```

### Registering the projection with Fastify

```typescript
import { registerProjection } from '@pgbo/fastify'

registerProjection(app, db, {
  projection: areaPublic,
  view: areaView,
  extractContext: req => ({ app, db, locale: 'en' }),
})

registerProjection(app, db, {
  projection: areaAdmin,
  view: areaView,
  prefix: '/api/admin/areas',
  extractContext: /* ... */,
})
```

Multiple projections over the same BO coexist — you can surface a read-only public API, a CRUD admin API, and a reporting projection side-by-side without duplicating the BO.

### Validation

`defineProjection` throws at definition time if:
- A whitelisted action doesn't exist on the underlying BO
- A listed column doesn't exist on the BO's root table/view

Fail-fast prevents broken projections from shipping.
