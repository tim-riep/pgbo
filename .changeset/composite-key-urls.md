---
"@metadataui/spec": minor
"@metadataui/client": minor
"@pgbo/core": minor
"@pgbo/fastify": minor
---

First-class composite-key support across the metadata-driven UI contract (closes #51).

A BO whose primary key spans multiple columns (e.g. `(warehouseSlug, slug)`) can now be defined, served, and consumed end-to-end without per-app workarounds.

### What's new

1. **`BOMeta.paramField` widened to `string | readonly string[]`** in `@metadataui/spec`. Single string for the common case (`'id'`, `'slug'`); a tuple of column names for composite keys.

2. **`urlForDetail` accepts composite-key objects** — `urlForDetail(base, 'storageLocation', { warehouseSlug: 'WH-1', slug: 'A1' })` produces `/bo/storageLocation/(warehouseSlug='WH-1',slug='A1')` (OData-style segment).

3. **`formatCompositeKey` / `parseCompositeKey` helpers** in `@metadataui/spec` for round-tripping the OData segment. String values are single-quoted with embedded `'` doubled (`O''Brien`) and URL-encoded; numeric values are emitted bare.

4. **`defineBO({ paramField: ['warehouseSlug', 'slug'] })`** is type-checked and validated at definition time — every entry must be a real column on the root, and the array can't be empty.

5. **Fastify routes parse `:param` automatically** — when the BO uses a composite key the handler detects the leading `(` and decodes the segment via `parseCompositeKey`, builds the WHERE clause via `keyToWhere`, and feeds the right object into `bo.update` / `bo.delete`.

6. **OpenAPI schemas widen accordingly** — the `:param` schema describes the OData syntax, and the `/meta` response permits both the string and array forms of `paramField`.

### Out of scope for this change

- **Composite-key targets in associations / link-table compositions** — these throw a clear error directing you to flatten the target's key. Single-column associations from a composite-key BO still work fine.
- **Compositions hanging off a composite-key parent** use the first key column as the parent join column. Multi-column joins are uncommon and would need a richer composition definition.

### Backward compatibility

- Single-string `paramField` keeps working unchanged — the contract widens but doesn't break existing consumers.
- The `parseCompositeKey` helper is the only new runtime symbol clients need; existing `urlForDetail(base, name, 'main')` calls keep their behaviour.
