# @metadataui/spec

## 1.0.0

### Major Changes

- 49c44b6: Initial release. The metadata-driven UI contract — pure types, URL builders, and the conventions any HTTP server can implement to be auto-rendered by a metadata-driven frontend.

  Extracted from `@pgbo/core/metadata`, `@pgbo/core/query`, and `@pgbo/fastify` to live under a vendor-neutral namespace (closes #52).

  ### What's in the contract

  - **Wire-protocol types**: `BOMeta`, `FieldMeta`, `ViewMeta`, `FilterMeta`, `ValueHelpRef`, `ValueHelpMeta`, `CompositionMeta`, `AssociationMeta`, `FieldKind`, `FilterOption`
  - **Public response shapes** (post-transform on the server): `PublicBoMeta`, `PublicFieldMeta`, `PublicValueHelpRef`, `PublicFilterMeta`
  - **List query contract**: `ListParams`, `PaginatedResult`
  - **Custom action returns**: `FileResponse` (typed as `Uint8Array` so it's platform-neutral; Node `Buffer` is structurally compatible)
  - **Translation enrichment**: `TranslationConfig`, `EnrichConfig`

  ### URL convention (single source of truth)

  ```
  GET    /bo/{name}                       list
  GET    /bo/{name}/{paramValue}          detail
  POST   /bo/{name}                       create
  PUT    /bo/{name}/{paramValue}          update
  DELETE /bo/{name}/{paramValue}          delete
  GET    /meta/{name}                     metadata
  GET    /bo/{name}/valueHelp/{vh}        value help
  POST   /bo/{name}/{action}              custom action
  GET    /view/{name}                     read-only view
  GET    /view/{name}/meta                view metadata
  ```

  Each pattern has a builder helper (`urlForProjection`, `urlForDetail`, `urlForAction`, `urlForValueHelp`, `urlForMeta`, `urlForView`, `urlForViewMeta`) plus `buildQueryString` for the list query convention (`page`, `limit`, `search`, `sort`, `order`, `locale`, `filter.<col>`, `fields`).

  ### Status code semantics

  | Status | Meaning |
  |---|---|
  | `200` / `201` / `204` | Success. Create returns 201, null/undefined returns 204, others 200. |
  | `401` | Auth required. Clients should call `refreshAuth` once and retry. |
  | `403` | Forbidden. E.g. tenant trying to write a global record. |
  | `404` | Not found, or filtered out by the projection's WHERE clause. |

  ### Implementations

  - **Server**: [`@pgbo/fastify`](https://www.npmjs.com/package/@pgbo/fastify) — Fastify route factory backed by [`@pgbo/core`](https://www.npmjs.com/package/@pgbo/core).
  - **Client**: [`@metadataui/client`](https://www.npmjs.com/package/@metadataui/client) — framework-agnostic HTTP client.

  Other backends are valid implementations as long as they conform to this contract.
