# @metadataui/client

## 1.1.0

### Minor Changes

- 1f804c1: First-class composite-key support across the metadata-driven UI contract (closes #51).

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

### Patch Changes

- Updated dependencies [1f804c1]
- Updated dependencies [ce7b65e]
- Updated dependencies [77c99d6]
  - @metadataui/spec@1.1.0

## 1.0.0

### Major Changes

- 49c44b6: Initial release. Framework-agnostic HTTP client for the [metadata-driven UI contract](https://www.npmjs.com/package/@metadataui/spec) — drop-in replacement for `@pgbo/client` (closes #52).

  ### What's in the box

  - `createClient(config)` — `meta`, `list`, `detail`, `create`, `update`, `delete`, `action`, `valueHelp`, `valueHelpPaged`, `view`, `viewPaged`, `viewMeta`, `invalidateMeta`
  - URL builders re-exported from [`@metadataui/spec`](https://www.npmjs.com/package/@metadataui/spec) (`urlForProjection`, `urlForDetail`, `urlForAction`, `urlForValueHelp`, `urlForMeta`, `urlForView`, `urlForViewMeta`, `buildQueryString`)
  - `MetadataUiClientError` — thrown on non-2xx with `status`, `url`, parsed `body`
  - Per-projection metadata cache with `invalidateMeta(name?)` to bust
  - 401 retry once via configurable `refreshAuth` callback
  - Pluggable `getAuthHeader`, locale, custom headers
  - All wire-protocol types re-exported from `@metadataui/spec` so apps use a single import path

  ### Migration from `@pgbo/client`

  ```diff
  - import { createClient, PgboClientError } from '@pgbo/client'
  + import { createClient, MetadataUiClientError } from '@metadataui/client'
  ```

  Runtime API is identical. The only differences from `@pgbo/client@0.2.0`:

  - Imports types from `@metadataui/spec` instead of `@pgbo/core/metadata` — frontend installs no `pg`, no `@types/pg`, no migration engine.
  - Renamed `PgboClientError` → `MetadataUiClientError`.
  - No pgbo branding in error messages or comments.

  ### Why a separate package

  - The contract is independent of pgbo. Other backends (Spring, Go, hand-rolled REST) can serve it; this client works against any of them.
  - Frontend bundles never need a transitive `@pgbo/core` dependency (which pulls `pg`).
  - Adoption is per-environment: backends use `@pgbo/core` + `@pgbo/fastify`; frontends use `@metadataui/client`.

  ### Pagination unwrap

  | Method             | Returns                                          |
  | ------------------ | ------------------------------------------------ |
  | `list()`           | `PaginatedResult<T>` (UIs need `total`)          |
  | `detail()`         | `T`                                              |
  | `valueHelp()`      | `T[]` (unwrapped — dropdowns rarely need totals) |
  | `valueHelpPaged()` | `PaginatedResult<T>`                             |
  | `view()`           | `T[]`                                            |
  | `viewPaged()`      | `PaginatedResult<T>`                             |
