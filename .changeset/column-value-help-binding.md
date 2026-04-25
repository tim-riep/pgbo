---
"@pgbo/core": minor
---

Column-to-value-help binding via metadata (closes #35).

`col(...).valueHelp(vhView)` was already accepted, but `boMeta()` didn't surface a top-level reference on the field — frontends had to read `meta.valueHelps` separately, hard-code which column uses which value help, and hand-write the fetch boilerplate.

Two changes:

1. **`FieldMeta.valueHelp`** — `viewMeta` / `boMeta` now emit a `ValueHelpRef` on every field annotated with `.valueHelp(...)`:

```typescript
{
  key: 'uomSlug',
  kind: 'relation',
  valueHelp: {
    name: 'uom',                   // BO key (the URL segment Fastify uses)
    keyField: 'slug',
    displayField: 'name',
    endpoint: '/bo/product/valueHelp/uom',  // populated by @pgbo/fastify
  },
}
```

`@pgbo/fastify` resolves `endpoint` against the projection prefix in its `/meta/:name` transform; reading the raw `boMeta(bo)` (no projection context) gives the ref without `endpoint`.

2. **`defineBO()` validation** — every column-level `.valueHelp(vhView)` must reference a view also registered under `valueHelps`. Throws at definition time with a suggestion of known keys instead of letting forms 404 at request time.

Top-level `meta.valueHelps[].name` and `filterable.endpoint` now also use the BO key (the URL segment) instead of the underlying view name — `filterable.endpoint` was previously the view name, which didn't match the actual route URL.
