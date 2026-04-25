# HTTP Client — `@pgbo/client`

`@pgbo/client` is the framework-agnostic HTTP layer for pgbo. It owns the URL schema, pagination contract, metadata cache, and auth integration — so frontend code stops re-implementing them per project.

No React, no Vue, no UI components — just `fetch` wrapped with the things every pgbo frontend needs.

## Install

```bash
npm install @pgbo/client
```

The package re-exports the structural types from `@pgbo/core`, so frontends never import the server package (which pulls in `pg`).

## Quick start

```typescript
import { createClient } from '@pgbo/client'

const pgbo = createClient({
  baseUrl: 'http://localhost:3000',
  locale:  () => i18n.language,                    // appended as ?locale=...
  getAuthHeader: () => `Bearer ${currentToken()}`,
  refreshAuth:   async () => {
    await refreshTokens()
    return `Bearer ${currentToken()}`
  },
})

// Metadata (cached after first call)
const meta = await pgbo.meta('warehouseProduct')

// CRUD
const list = await pgbo.list('warehouseProduct', { page: 1, limit: 25, search: 'foo' })
const item = await pgbo.detail('warehouseProduct', 'BB-8005')
await pgbo.create('warehouseProduct', { wku: 'X', baseUomSlug: 'EA' })
await pgbo.update('warehouseProduct', 'BB-8005', { baseUomSlug: 'PCS' })
await pgbo.delete('warehouseProduct', 'BB-8005')

// Custom action — JSON
const result = await pgbo.action('stockDocument', 'post', { items: [/* … */] })

// Custom action — binary (PDF / XLSX from a FileResponse)
const blob = await pgbo.action<Blob>('stockDocument', 'pdf', { id }, { responseType: 'blob' })

// Value-help dropdown — items unwrapped for direct use
const uoms = await pgbo.valueHelp('warehouseProduct', 'uom')
//   ↑ already an array of rows, no { items: [...] } wrapper
```

## URL schema (single source of truth)

Every URL the client constructs flows through one of these helpers — when `@pgbo/fastify`'s URL layout changes (issue #44 locked it), the client follows automatically:

| Helper | Pattern |
|---|---|
| `urlForProjection(base, name)` | `{base}/bo/{name}` |
| `urlForDetail(base, name, paramValue)` | `{base}/bo/{name}/{paramValue}` |
| `urlForAction(base, name, action)` | `{base}/bo/{name}/{action}` |
| `urlForValueHelp(base, name, vh)` | `{base}/bo/{name}/valueHelp/{vh}` |
| `urlForMeta(base, name)` | `{base}/meta/{name}` |
| `urlForView(base, name)` | `{base}/view/{name}` |
| `urlForViewMeta(base, name)` | `{base}/view/{name}/meta` |
| `buildQueryString(params)` | `?key=value&filter.col=v&fields=a,b` |

Param values get URL-encoded; `filters: { col: 'val' }` expands to `?filter.col=val`; arrays serialise as comma-joined values (matches `?fields=a,b,c`).

## `createClient(config)` — full config reference

```typescript
interface ClientConfig {
  /** API root, e.g. 'http://localhost:3000'. Trailing slash is fine. */
  baseUrl: string
  /** Override the global fetch — for testing, custom timeouts, mocks, etc. */
  fetch?: typeof globalThis.fetch
  /** Resolves the current locale on every request → ?locale=... */
  locale?: () => string
  /** Returns a value for the Authorization header on every request. */
  getAuthHeader?: () => string | null | undefined | Promise<string | null | undefined>
  /** Called once on a 401 response to refresh tokens; the request then retries with the new header. */
  refreshAuth?: () => Promise<string | null | undefined>
  /** Extra headers attached to every request (e.g. tenant ID, request ID). */
  headers?: () => Record<string, string> | Promise<Record<string, string>>
}
```

## `PgboClient` — methods

```typescript
interface PgboClient {
  meta(projection: string): Promise<PublicBoMeta>
  invalidateMeta(projection?: string): void

  list<T>(projection: string, query?: ListQuery): Promise<PaginatedResult<T>>
  detail<T>(projection: string, paramValue: string | number): Promise<T>
  create<T>(projection: string, data: Record<string, unknown>): Promise<T>
  update<T>(projection: string, paramValue: string | number, data: Record<string, unknown>): Promise<T>
  delete<T>(projection: string, paramValue: string | number): Promise<T>

  action<TOut>(projection: string, action: string, data?: Record<string, unknown>, options?: { responseType?: 'json' | 'blob' }): Promise<TOut>

  valueHelp<T>(projection: string, vh: string, query?: ListQuery): Promise<T[]>          // unwrapped
  valueHelpPaged<T>(projection: string, vh: string, query?: ListQuery): Promise<PaginatedResult<T>>

  view<T>(view: string, query?: ListQuery): Promise<T[]>                                  // unwrapped
  viewPaged<T>(view: string, query?: ListQuery): Promise<PaginatedResult<T>>
  viewMeta(view: string): Promise<unknown>
}
```

`ListQuery` mirrors the pgbo Fastify list contract:

```typescript
interface ListQuery {
  page?: number                              // 1-based, default 1
  limit?: number                             // default 25, max 250
  search?: string                            // ?search= against searchable fields
  sort?: string                              // ?sort=column
  order?: 'asc' | 'desc'                     // default 'asc'
  filters?: Record<string, string | number | boolean>  // ?filter.<col>=value
  locale?: string                            // overrides config.locale()
  fields?: readonly string[]                 // ?fields=a,b,c
}
```

## Metadata cache

`pgbo.meta(name)` returns a Promise; the resolved value is cached per BO name and shared between callers. Subsequent `pgbo.meta('warehouse')` calls hit the same Promise — no duplicate `/meta/warehouse` requests during a session.

```typescript
const a = await pgbo.meta('warehouse')
const b = await pgbo.meta('warehouse')
console.log(a === b)   // true — same object reference
```

Failed fetches are not cached — the next call retries.

```typescript
// Drop one entry — next .meta() refetches
pgbo.invalidateMeta('warehouse')

// Drop everything — useful after a logout/login cycle
pgbo.invalidateMeta()
```

## Auth integration — `getAuthHeader` + `refreshAuth`

```typescript
const pgbo = createClient({
  baseUrl,
  getAuthHeader: () => `Bearer ${tokenStore.access}`,
  refreshAuth:   async () => {
    await refreshAccessToken()
    return `Bearer ${tokenStore.access}`
  },
})
```

Flow:

1. Every request reads `Authorization` from `getAuthHeader()`.
2. If the response is **401**, the client calls `refreshAuth()` once.
3. The original request is retried with the new header.
4. If the retry also returns 401, the error propagates — no infinite loops.

Refresh-token storage and expiry handling stay in the app (auth schemes vary too widely). The client just provides the retry-once hook.

## Locale handling

When `config.locale()` is set, every request appends `?locale=<value>`. Callers can override per-request:

```typescript
const pgbo = createClient({ baseUrl, locale: () => 'en' })

await pgbo.list('warehouse')                    // /bo/warehouse?locale=en
await pgbo.list('warehouse', { locale: 'de' })  // /bo/warehouse?locale=de
```

## Pagination unwrap

| Method | Returns |
|---|---|
| `list()` | `PaginatedResult<T>` — UIs need `total` for paging widgets |
| `detail()` | `T` |
| `valueHelp()` | `T[]` — unwrapped, dropdowns rarely need totals |
| `valueHelpPaged()` | `PaginatedResult<T>` — when a dropdown does need pagination (huge value helps) |
| `view()` | `T[]` — unwrapped |
| `viewPaged()` | `PaginatedResult<T>` |

## Errors — `PgboClientError`

Non-2xx responses throw `PgboClientError` with the parsed body attached:

```typescript
import { PgboClientError } from '@pgbo/client'

try {
  await pgbo.detail('warehouse', 'nonexistent')
} catch (e) {
  if (e instanceof PgboClientError) {
    console.error(e.status, e.url, e.body)   // 404, full URL, parsed JSON body
  }
}
```

`PgboClientError.body` is whatever the server returned — for pgbo's standard 404/403 it's `{ error: 'Not found' }`; for custom action errors it's whatever your handler threw.

## Re-exported types

`@pgbo/client` re-exports the metadata/query types from `@pgbo/core` so frontends use a single import path:

```typescript
import type {
  FieldMeta, FilterMeta, ValueHelpRef, ValueHelpMeta,
  CompositionMeta, AssociationMeta, ViewMeta, BOMeta,
  FieldKind, FilterOption,
  ListParams, PaginatedResult,
  PublicBoMeta, PublicFieldMeta, PublicFilterMeta, PublicValueHelpRef,
} from '@pgbo/client'
```

The `Public*` variants are the response shapes after `@pgbo/fastify`'s `/meta/:name` transform (i.e. with `labelKey` populated and `valueHelp.endpoint` resolved to absolute URLs).

## What `@pgbo/client` deliberately does NOT do

- **No framework-specific bindings** — React hooks, Vue composables, Svelte stores belong in separate packages on top of this one.
- **No UI components** — tables, forms, dropdowns are app concerns.
- **No global state** — apps choose their own (Zustand, signals, query libraries, etc.). The metadata cache is local to each client instance.
- **No code-generated types per BO** — that's a build-step concern and lives outside this package.

The client is the wire layer. Everything above it is the app's call.
