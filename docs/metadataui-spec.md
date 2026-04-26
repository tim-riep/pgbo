# Contract — `@metadataui/spec`

`@metadataui/spec` is the **metadata-driven UI contract**: the wire-protocol types, URL conventions, and status-code semantics any HTTP server can implement to be auto-rendered by a metadata-driven frontend.

The contract is independent of any specific backend. `@pgbo/core` + `@pgbo/fastify` happen to be the easiest way to fulfil it, but other backends (Spring, Go, hand-rolled REST) become valid implementations as long as they conform.

```bash
npm install @metadataui/spec
```

Pure types + small pure URL helpers. Zero runtime dependencies, server-and-browser compatible.

## URL convention

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

URL builders for each pattern are exported by the spec — clients and codegen tools reference them directly so URL changes propagate in one place:

```ts
import { urlForProjection, urlForDetail, urlForValueHelp, buildQueryString } from '@metadataui/spec'

urlForProjection('http://api', 'warehouse')             // → http://api/bo/warehouse
urlForDetail   ('http://api', 'warehouse', 'main')      // → http://api/bo/warehouse/main
urlForValueHelp('http://api', 'product', 'uom')         // → http://api/bo/product/valueHelp/uom

buildQueryString({ page: 2, search: 'foo', filters: { active: true } })
// → ?page=2&search=foo&filter.active=true
```

## Status code semantics

| Status | Meaning |
|---|---|
| `200` / `201` / `204` | Success. Create returns 201, null/undefined returns 204, others 200. |
| `401` | Auth required. Clients should call `refreshAuth` once and retry. |
| `403` | Forbidden. E.g. tenant trying to write a global record. |
| `404` | Not found, or filtered out by the projection's WHERE clause. |

## List query contract

`GET /bo/{name}` (and value-help / view-route GETs) accept:

| Param | Type | Default | Meaning |
|---|---|---|---|
| `page` | int | `1` | 1-based page number |
| `limit` | int | `25` (max 250) | Items per page |
| `search` | string | `''` | ILIKE across `searchable` fields |
| `sort` | string | `null` | Column to sort by |
| `order` | `asc` / `desc` | `asc` | |
| `filter.<col>` | string | — | Equality filter for column `col` |
| `locale` | string | `'en'` | Locale for translation lookups |
| `fields` | comma-joined | `null` | Subset of columns to return |

Response envelope (`PaginatedResult<T>`):

```ts
{ items: T[], total: number, page: number, limit: number }
```

## Metadata contract — what `/meta/{name}` returns

```ts
import type { PublicBoMeta, PublicFieldMeta, PublicValueHelpRef } from '@metadataui/spec'
```

```ts
interface PublicBoMeta {
  name: string                          // projection name (= URL segment)
  paramField: string                    // 'slug' / 'id' — names the URL param
  readOnly: boolean
  fields: PublicFieldMeta[]
  associations: AssociationMeta[]
  compositions: CompositionMeta[]
  valueHelps: { name: string; fields: PublicFieldMeta[] }[]
  orderBy?: string
  orderDir?: 'asc' | 'desc'
  cacheTags?: string[]
}

interface PublicFieldMeta {
  key: string
  kind: 'text' | 'number' | 'date' | 'boolean' | 'slug' | 'relation' | 'translation'
  labelKey: string                      // i18n key, always set
  hidden: boolean
  immutable: boolean
  searchable: boolean
  filterable: false | PublicFilterMeta
  valueHelp?: PublicValueHelpRef
  inList: boolean
  inForm: boolean
  required: boolean
  quick: boolean
}

interface PublicValueHelpRef {
  name: string                          // URL segment for /bo/{bo}/valueHelp/{name}
  endpoint: string                      // absolute URL
  keyField: string                      // column on the vh view that holds the id
  displayField: string                  // column shown to the user
}
```

A frontend that consumes this shape can render lists, forms, filters, and dropdowns without any per-BO wiring.

## Custom action returns

Custom actions can return JSON, `null`/`undefined` (→ 204), or a `FileResponse`:

```ts
interface FileResponse {
  data: Uint8Array                      // Node's Buffer is structurally compatible
  contentType: string                   // 'application/pdf', 'text/csv', etc.
  filename?: string                     // sets Content-Disposition
  inline?: boolean                      // false (default) → attachment
}
```

`@metadataui/client` recognises blob responses via `responseType: 'blob'`.

## Implementations

- **Server**: [`@pgbo/fastify`](fastify) — Fastify route factory backed by [`@pgbo/core`](bo). Routes derive from view annotations + projection whitelist; metadata is auto-generated.
- **Client**: [`@metadataui/client`](metadataui-client) — framework-agnostic HTTP client.

Other servers can implement the contract without any pgbo dependency: emit the URL schema, return the `PublicBoMeta` shape from `/meta/{name}`, and follow the status-code semantics.

## Versioning

`@metadataui/spec@1.x` is the stable contract. Breaking changes to URLs, response shapes, or status semantics will bump the major. The contract is intentionally small — most additions are backwards-compatible new optional fields on existing types.
