# Metadata

pgbo extracts structured metadata — field types, labels, filter configs, value-help endpoints — directly from the schema DSL. The same annotations that drive migrations and queries also drive the UI: **the frontend renders lists, forms, and filters from metadata, without a hand-written schema on either side.**

```
view annotations → viewMeta / boMeta → /meta/:name → frontend UI
```

## Why metadata?

In a typical CRUD stack you declare each field three times: once in the migration, once in a TypeScript model, once in the frontend form. pgbo collapses this to a single declaration on the column:

```typescript
import { col } from '@pgbo/core/schema'

col('slug')
  .label('warehouse.slug')   // i18n key the frontend resolves
  .searchable()              // appears in the list search box
  .filterable()              // shows a text filter in the list header
  .immutable()               // read-only after create
  .required()                // required in the create form
```

`viewMeta(view)` walks the column refs and emits the same information as structured data, ready for any UI renderer.

## The flow end-to-end

1. **Column annotations** — `.label()`, `.searchable()`, `.filterable()`, `.valueHelp()`, `.kind()`, etc.
2. **`viewMeta(view)`** — traverses the view's `columns` + joined tables, infers field kinds from the PG types, returns a `ViewMeta` with typed `FieldMeta[]` entries.
3. **`boMeta(bo, { translations? })`** — wraps `viewMeta`, plus: injects translation fields, virtual fields, compositions, and value-help references from the BO definition.
4. **`GET /meta/:projectionName`** — [`@pgbo/fastify`](fastify) transforms the BO meta through the projection: narrows columns to the public whitelist, converts `label` → `labelKey` with fallback, flips `hidden` to `inList: false, inForm: false`.
5. **Frontend** — fetches the metadata, renders the form/list/filter UI driven purely by the response.

## Fetching metadata

Wire it up once on the server:

```typescript
// Produces GET /meta/warehouse (plus all CRUD routes)
registerProjection(app, db, { projection: warehouseProjection, /* ... */ })
```

Then on the client:

```typescript
const meta = await fetch('/meta/warehouse').then(r => r.json())
```

### `/meta/:name` response shape

```typescript
interface PublicBoMeta {
  name: string                                  // projection name, not bo.name
  paramField: string                            // 'slug' → URL param name
  readOnly: boolean                             // bo.actions empty
  fields: PublicFieldMeta[]                     // narrowed + transformed
  associations: AssociationMeta[]               // foreign-key navigations
  compositions: CompositionMeta[]               // nested children
  valueHelps: ValueHelpMeta[]                   // dropdown sources
  routePrefix?: string
  orderBy?: string
  orderDir?: 'asc' | 'desc'
  cacheTags?: string[]
}

interface PublicFieldMeta {
  key: string                                   // camelCase, matches JSON payloads
  kind: 'text' | 'number' | 'date' | 'boolean' | 'slug' | 'relation' | 'translation'
  labelKey: string                              // always set — fallback to `${projection.name}.${key}`
  hidden: boolean
  immutable: boolean                            // disable input in the form
  searchable: boolean                           // hits the list `?search=` param
  filterable: false | FilterMeta                // false, or config for the filter widget
  valueHelp?: ValueHelpRef                      // dropdown source for forms (issue #35)
  inList: boolean                               // column visible in list view (false if hidden)
  inForm: boolean                               // field visible in form view (false if hidden)
  required: boolean
  quick: boolean                                // show as a quick filter in the list header
}

interface FilterMeta {
  type: 'text' | 'date' | 'select' | 'relation'
  endpoint?: string                             // absolute value-help URL for 'relation'/'select'
  valueField?: string                           // column on the target that holds the id
  labelField?: string                           // column shown to the user
  options?: { value: string; label: string }[]  // static options for 'select'
}

interface ValueHelpRef {
  name: string                                  // BO key (the URL segment)
  endpoint: string                              // e.g. '/bo/product/valueHelp/uom'
  keyField: string                              // from the vh view's .vh({ key })
  displayField: string                          // from the vh view's .vh({ display })
}
```

### Column-to-value-help binding (issue #35)

`col(...).valueHelp(vhView)` binds a column to a value-help view. When the BO registers the same view in `valueHelps`, metadata emits a `valueHelp` reference on the field, ready for a metadata-driven form to render the column as a dropdown without per-app wiring:

```typescript
const uomVh = view('uom_vh').from(uomTable)
  .columns({ slug: col('slug'), name: col('name') })
  .vh({ key: 'slug', display: 'name' })

const productView = view('product_view').from(productTable).columns({
  sku: col('sku').label('product.sku'),
  uomSlug: col('uomSlug').label('product.uom').valueHelp(uomVh),
})

const productBO = defineBO(productView, {
  paramField: 'id',
  valueHelps: { uom: uomVh },        // key 'uom' is the URL segment
})
```

`/meta/product` returns:

```json
{
  "fields": [
    { "key": "uomSlug", "kind": "relation",
      "valueHelp": {
        "name": "uom",
        "endpoint": "/bo/product/valueHelp/uom",
        "keyField": "slug",
        "displayField": "name"
      }
    }
  ]
}
```

`defineBO()` validates that every column-level `.valueHelp(vhView)` references a view that's also registered under `valueHelps` — typos and missed wiring throw at definition time, not at request time when the form would otherwise hit a non-existent endpoint.

### `label` → `labelKey` — the i18n contract

`boMeta().fields[i].label` holds whatever you passed to `.label('some.key')` on the column (or `undefined`). The Fastify layer renames it to `labelKey` and substitutes `${projection.name}.${key}` when it's missing — so **every field always has a labelKey**. The frontend does the actual translation:

```typescript
// Frontend
const labelText = i18n.t(field.labelKey)  // 'warehouse.slug' or 'warehouse.createdAt'
```

This is why labels in metadata look like `"warehouse.slug"`, not `"Slug"`.

## Field kind inference

Kinds are inferred from the column annotations and underlying PG type. The first matching rule wins:

| Condition | `kind` |
|---|---|
| `col(...).kind('foo')` | explicit override |
| `translated('...')` column | `'translation'` |
| `col(...).valueHelp(vh)` | `'relation'` |
| `.immutable()` + `.searchable()` + label contains `"slug"` | `'slug'` |
| PG type is integer / serial / numeric / real / double / bigint | `'number'` |
| PG type is timestamp / timestamptz / date | `'date'` |
| PG type is boolean | `'boolean'` |
| fallback | `'text'` |

The frontend switches on `kind` to pick an input widget (text input, date picker, boolean switch, dropdown, etc.).

## Filterable expansion

`.filterable()` expands into a `FilterMeta` based on `kind`:

- `text` / `slug` → `{ type: 'text' }` (ILIKE search in the filter bar)
- `date` → `{ type: 'date' }` (date range picker)
- `relation` → `{ type: 'relation', endpoint, valueField, labelField }` (dropdown fed by the value help)

Override by declaring the filter type explicitly:

```typescript
col('status')
  .filterable()
  .filterType('select')
  .filterOptions([
    { value: 'ACTIVE',   label: 'status.active' },
    { value: 'ARCHIVED', label: 'status.archived' },
  ])
```

Or point a filter at a different column (e.g. you filter by `statusCode` but display `statusLabel`):

```typescript
col('statusLabel').filterable().filterKey('statusCode')
```

## Driving a list page from metadata

```typescript
const meta = await fetch('/meta/warehouse').then(r => r.json())

// 1. Column headers
const columns = meta.fields
  .filter(f => f.inList)
  .map(f => ({ key: f.key, label: i18n.t(f.labelKey), sortable: f.kind !== 'relation' }))

// 2. Search box — show only if any field is searchable
const hasSearch = meta.fields.some(f => f.searchable)

// 3. Quick filters — show in the list header
const quickFilters = meta.fields.filter(f => f.quick && f.filterable)

// 4. Fetch rows
const qs = new URLSearchParams({ page: '1', limit: '25', search: searchText })
for (const [key, value] of Object.entries(activeFilters)) qs.set(`filter.${key}`, value)
const { items, total } = await fetch(`/bo/warehouse?${qs}`).then(r => r.json())
```

## Driving a form from metadata

```typescript
const meta = await fetch('/meta/warehouse').then(r => r.json())

const formFields = meta.fields
  .filter(f => f.inForm)
  .map(f => ({
    key:        f.key,
    label:      i18n.t(f.labelKey),
    type:       kindToInputType(f.kind),     // 'text' | 'number' | 'date' | ...
    required:   f.required,
    disabled:   f.immutable && mode === 'edit',  // immutable fields locked on edit
    // For relations, hydrate the dropdown:
    optionsUrl: f.filterable && f.filterable.type === 'relation'
      ? f.filterable.endpoint                // e.g. '/bo/warehouse/valueHelp/region'
      : undefined,
  }))
```

Submit the form straight to the CRUD route:

```typescript
await fetch('/bo/warehouse', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(formValues),
})
```

## Value helps & the relation flow

When a column is `.valueHelp(someVhView)`, metadata emits `filterable.endpoint` pointing at the Fastify route that serves the vh. The frontend renders an autocomplete / dropdown that hits:

```
GET /bo/warehouse/valueHelp/region?search=north&limit=20
```

and uses `valueField` + `labelField` from the `FilterMeta` (or the vh's `fields`) to render each option. Because value helps are regular views, they support [`translatedJoin`](schema#translated-views-—-translatedjoin), [auth restrictions](schema#auth-restrictions), and arbitrary `where` clauses — all transparent to the frontend.

See [Value Help Views](schema#value-help-views) for the declaration side and [Fastify → Value help endpoints](fastify#value-help-endpoints) for the route contract.

## Column narrowing via projections

If `projection.columns` is set, `/meta/:name` **only** returns those fields — metadata, list responses, and detail responses are all narrowed in lockstep. That's the only supported way to hide a column from the public API while keeping it available to internal writes (hooks, actions, custom handlers):

```typescript
const projection = defineProjection(warehouseBO, {
  name: 'warehouse',
  actions: { read: true },
  columns: ['id', 'slug', 'name'],           // tenantId stays server-only
})
```

## Server-side helpers

`viewMeta` / `boMeta` are also useful directly on the server — e.g. from CLI scripts or custom routes — and `searchWhere`, `filterWhere`, `enrichItems` cover three common building blocks.

### `viewMeta(source)`

```typescript
import { viewMeta } from '@pgbo/core/metadata'

const meta = viewMeta(warehouseView)
// {
//   name: 'warehouse_view',
//   fields: [
//     { key: 'slug', kind: 'slug', label: 'warehouse.slug', searchable: true, filterable: { type: 'text' }, immutable: true, ... },
//     ...
//   ],
//   associations: [{ name: 'region', foreignKey: 'regionId', target: 'region_view' }],
// }
```

Accepts a `ViewDef` *or* a `TableDef` (useful for infra scripts that don't need a view). For tables without annotations you still get every column with inferred kind — no labels, no searchable, no filterable.

### `boMeta(bo, config?)`

```typescript
import { boMeta } from '@pgbo/core/metadata'

const meta = boMeta(warehouseBO, {
  translations: { table: warehouseTranslationTable, parentKey: 'warehouseId', fields: ['name'] },
})
// Extends viewMeta with:
//   paramField, readOnly, compositions, valueHelps, routePrefix, orderBy, orderDir, cacheTags
//   + injected translation fields (kind: 'translation', searchable: true, filterable: { type: 'text' })
//   + injected virtual fields (from bo.virtualFields)
```

`valueHelps` are picked up directly from `bo.valueHelps` — each entry is a `ViewDef` with a `.vh({ key, display })` annotation (issue #34) — so you don't pass them to `boMeta` explicitly.

### `searchWhere(view, query)`

Build a parameterised OR clause over every `.searchable()` column in the view:

```typescript
import { searchWhere } from '@pgbo/core/metadata'

const { text, values } = searchWhere(warehouseView, 'main')
// text:   '(slug ILIKE $1 OR name ILIKE $2)'
// values: ['%main%', '%main%']

const rows = await db.query(`SELECT * FROM warehouse_view WHERE ${text}`, values)
```

Returns `{ text: '', values: [] }` when the query is empty or no fields are searchable — safe to inline in a WHERE without guarding.

### `filterWhere(view, params)`

Strip unknown / non-filterable keys from user-provided filter params — guards against arbitrary column filtering via query-string injection:

```typescript
import { filterWhere } from '@pgbo/core/metadata'

const safe = filterWhere(warehouseView, {
  slug: 'admin',     // .filterable() → kept
  sortOrder: 5,      // not filterable → stripped
  tenantId: 't1',    // not exposed in the view → stripped
})
// → { slug: 'admin' }
```

Respects `.filterKey()` overrides — if a column declares `filterKey('statusCode')`, the user-supplied key gets rewritten to the target column before reaching the query.

### `enrichItems(db, items, config)`

Batch-load translations for a list of items in a single SQL query — skips per-row joins when you can't shape the query that way:

```typescript
import { enrichItems } from '@pgbo/core/metadata'

const enriched = await enrichItems(db, rawItems, {
  translationTable: 'area_translation',
  parentKey: 'areaId',        // FK column on the translation table
  idField: 'id',              // PK on each item
  fields: ['name'],           // translation fields to lift onto each item
  locale: 'de',
  fallbackLocale: 'en',
})

// enriched[0]:
// {
//   ...originalItem,
//   name: 'Nordzone',                      // from 'de' translation
//   translations: [
//     { locale: 'de', name: 'Nordzone', areaId: 1 },
//     { locale: 'en', name: 'North Zone', areaId: 1 },
//   ],
// }
```

Falls back to `fallbackLocale` when a requested-locale translation is missing. Attaches the full `translations` array so the UI can show per-locale editors inline.

For views built with [`.translatedJoin()`](schema#translated-views-—-translatedjoin), you don't need `enrichItems` — the LEFT JOIN resolves translations at query time. Use `enrichItems` when you're composing data the view builder can't express.
