# Metadata

pgbo extracts structured metadata from view annotations for use by consuming applications (API frameworks, frontends). No hand-written metadata — everything derives from the schema DSL.

## viewMeta

Extracts field metadata from a view definition:

```typescript
import { viewMeta } from 'pgbo/metadata'

const meta = viewMeta(areaView)
// {
//   name: 'area_view',
//   fields: [
//     { key: 'slug', kind: 'slug', label: 'area.slug', searchable: true, filterable: { type: 'text' }, immutable: true, ... },
//     { key: 'sortOrder', kind: 'number', label: 'area.sortOrder', ... },
//     { key: 'name', kind: 'translation', ... },
//   ]
// }
```

`viewMeta` also accepts a `TableDef` directly (infers fields from the table's columns).

### Field Kind Inference

| Condition | Kind |
|-----------|------|
| Has `.valueHelp()` | `'relation'` |
| `.immutable()` + `.searchable()` + label contains "slug" | `'slug'` |
| Integer / serial / numeric / real / bigint | `'number'` |
| Timestamp / date | `'date'` |
| Boolean | `'boolean'` |
| `translated()` column | `'translation'` |
| Default | `'text'` |

Override with `.kind('date')` for explicit control.

### Filterable Expansion

When a column has `.filterable()`, the metadata expands it based on kind:

```typescript
// kind: 'text' / 'slug'  → { type: 'text' }
// kind: 'date'            → { type: 'date' }
// kind: 'relation'        → { type: 'relation', endpoint, valueField, labelField }
```

Override with `.filterType('select').filterOptions([...])`.

## boMeta

Extends `viewMeta` with BO-specific information:

```typescript
import { boMeta } from 'pgbo/metadata'

const meta = boMeta(areaBO, {
  translations: { table: areaTranslationTable, parentKey: 'areaId', fields: ['name'] },
  valueHelps: [{ name: 'warehouse', view: warehouseView }],
})
// {
//   name: 'area',
//   paramField: 'id',
//   readOnly: false,
//   fields: [...viewMeta fields + injected translation fields...],
//   compositions: [{ name: 'translations', fields: ['areaId', 'locale', 'name'] }],
//   valueHelps: [{ name: 'warehouse', fields: [...] }],
// }
```

Translation fields are injected as `kind: 'translation'` with `searchable: true` and `filterable: { type: 'text' }` by default.

## searchWhere

Builds a parameterized OR clause over all `.searchable()` columns:

```typescript
import { searchWhere } from 'pgbo/metadata'

const result = searchWhere(areaView, 'admin')
// result.text:   '(slug ILIKE $1)'
// result.values: ['%admin%']

// With multiple searchable columns:
// result.text:   '(slug ILIKE $1 OR name ILIKE $2)'
// result.values: ['%admin%', '%admin%']
```

Use in a raw query or combine with the query builder:

```typescript
const { text: searchClause, values: searchValues } = searchWhere(areaView, query)
if (searchClause) {
  const rows = await db.query(`SELECT * FROM area_view WHERE ${searchClause}`, searchValues)
}
```

## filterWhere

Strips non-filterable keys from user-provided filter params:

```typescript
import { filterWhere } from 'pgbo/metadata'

const safe = filterWhere(areaView, {
  slug: 'admin',     // filterable → kept
  sortOrder: 5,      // NOT filterable → stripped
  unknown: 'x',      // not in view → stripped
})
// { slug: 'admin' }
```

Respects `.filterKey()` overrides — if a column has `.filterKey('otherCol')`, the filter applies to `otherCol`.

## enrichItems

Batch-resolves translations for a list of items in a single SQL query:

```typescript
import { enrichItems } from 'pgbo/metadata'

const enriched = await enrichItems(db, rawItems, {
  translationTable: 'area_translation',
  parentKey: 'areaId',
  idField: 'id',
  fields: ['name'],
  locale: 'de',
  fallbackLocale: 'en',
})
```

Each item gets:
- Resolved translation fields (`name`) for the requested locale, with fallback
- A `translations` array containing all available translations

```typescript
// enriched[0]:
// {
//   ...originalItem,
//   name: 'Nordzone',              // resolved from 'de' translation
//   translations: [
//     { locale: 'de', name: 'Nordzone', areaId: 1 },
//     { locale: 'en', name: 'North Zone', areaId: 1 },
//   ],
// }
```

## Extended Annotations (R5)

New annotation methods available on `col()`:

```typescript
col('slug')
  .required()                     // marks field as required for create
  .kind('slug')                   // explicit kind override
  .filterType('relation')         // explicit filter type
  .filterOptions([                // for 'select' filter type
    { value: 'ACTIVE', label: 'Active' },
    { value: 'ARCHIVED', label: 'Archived' },
  ])
  .filterKey('statusCode')        // filter on a different column
  .quick()                        // show as quick-filter in list header
```
