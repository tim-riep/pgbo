# Business Objects

A Business Object (BO) is a managed entity that wraps a view with CRUD lifecycle, permission checks, and hooks. BOs are **read-only by default** — you must explicitly define actions to enable writes.

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
