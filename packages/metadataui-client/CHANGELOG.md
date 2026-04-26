# @metadataui/client

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

  | Method | Returns |
  |---|---|
  | `list()` | `PaginatedResult<T>` (UIs need `total`) |
  | `detail()` | `T` |
  | `valueHelp()` | `T[]` (unwrapped — dropdowns rarely need totals) |
  | `valueHelpPaged()` | `PaginatedResult<T>` |
  | `view()` | `T[]` |
  | `viewPaged()` | `PaginatedResult<T>` |
