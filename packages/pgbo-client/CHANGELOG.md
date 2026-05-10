# @pgbo/client

## 0.3.1

### Patch Changes

- Updated dependencies [1f804c1]
  - @metadataui/client@1.1.0

## 0.3.0

### Minor Changes — DEPRECATED

- 49c44b6: **`@pgbo/client` is renamed to `@metadataui/client`** (closes #52). This release is a deprecation shim: it re-exports everything from `@metadataui/client` and aliases `PgboClientError → MetadataUiClientError`. A one-time `console.warn` fires at module load. **The next major will remove this package.**

  ### Migration (one find-and-replace)

  ```diff
  - import { createClient, PgboClientError } from '@pgbo/client'
  + import { createClient, MetadataUiClientError } from '@metadataui/client'
  ```

  The runtime API is identical. After upgrading, drop `@pgbo/client` from `package.json` and add `@metadataui/client`.

  ### Why the rename

  The metadata-driven UI contract — URL conventions, response shapes, status-code semantics — is independent of pgbo. It now lives under a vendor-neutral namespace so other backends (Spring, Go, hand-rolled REST) can implement it without taking pgbo as a dependency.

## 0.2.0

### Minor Changes

- d8ec492: New package `@pgbo/client` — framework-agnostic HTTP client (closes #46).

  Before, every frontend that talked to a `@pgbo/fastify` server re-implemented the same plumbing: URL builders, pagination unwrap, metadata cache, auth refresh, locale handling. That logic now lives in one place, owned and tested by the framework.

  ```typescript
  import { createClient } from "@pgbo/client";

  const pgbo = createClient({
    baseUrl: "http://localhost:3000",
    locale: () => i18n.language,
    getAuthHeader: () => `Bearer ${token}`,
    refreshAuth: async () => `Bearer ${await refresh()}`,
  });

  await pgbo.list("warehouse", { search: "main" });
  await pgbo.detail("warehouse", "main");
  await pgbo.create("warehouse", { name: "X" });
  await pgbo.update("warehouse", "main", { name: "Renamed" });
  await pgbo.action<Blob>("doc", "pdf", { id: 1 }, { responseType: "blob" });

  const meta = await pgbo.meta("warehouse"); // cached after first call
  const uoms = await pgbo.valueHelp("product", "uom"); // unwrapped — already an array
  ```

  ### What's in the box

  - `createClient(config)` — full client with `meta`, `list`, `detail`, `create`, `update`, `delete`, `action`, `valueHelp`, `valueHelpPaged`, `view`, `viewPaged`, `viewMeta`, `invalidateMeta`
  - URL builders (`urlForProjection`, `urlForDetail`, `urlForAction`, `urlForValueHelp`, `urlForMeta`, `urlForView`, `urlForViewMeta`) + `buildQueryString`
  - Re-exported metadata/query types (`FieldMeta`, `BOMeta`, `ValueHelpRef`, `ListParams`, `PaginatedResult`, …) so frontends don't import the server package
  - `PublicBoMeta` / `PublicFieldMeta` / `PublicValueHelpRef` — typed response shapes after `@pgbo/fastify`'s `/meta` transform (labelKey populated, endpoints resolved to absolute URLs)
  - `PgboClientError` — thrown on non-2xx, with `status`, `url`, and parsed `body`
  - 401 retry once via `refreshAuth` callback
  - Per-projection metadata cache with `invalidateMeta(name?)` to bust

  ### What's not in the box

  - Framework hooks (React / Vue / Svelte) — separate packages on top
  - UI components — app concern
  - Code-generated types — build-step concern

  ### Companion change in `@pgbo/core`

  `@pgbo/core/metadata` now re-exports `AssociationMeta`, `CompositionMeta`, `ValueHelpMeta`, `FieldKind`, and `FilterOption` so `@pgbo/client` can re-export them cleanly.

### Patch Changes

- Updated dependencies [0ddf3fd]
- Updated dependencies [61a6bb0]
- Updated dependencies [d8ec492]
  - @pgbo/core@1.0.0
