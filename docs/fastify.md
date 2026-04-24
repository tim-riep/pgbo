# Fastify Adapter — `@pgbo/fastify`

The Fastify adapter turns a BO **projection** into a complete HTTP surface: list, detail, create, update, delete, custom actions, metadata endpoint, and value-help dropdowns. Nothing is hand-wired — pagination, search, filters, tenant scoping, and column narrowing all derive from the projection + view annotations.

`@pgbo/core` stays framework-agnostic; `@pgbo/fastify` is the thin layer that wires projections to Fastify routes.

## Install

```bash
npm install @pgbo/fastify fastify
```

## Minimal end-to-end example

```typescript
import Fastify from 'fastify'
import { createDatabase } from '@pgbo/core'
import { table, view, col, text, integer } from '@pgbo/core/schema'
import { defineBO, defineProjection } from '@pgbo/core/bo'
import { registerProjection } from '@pgbo/fastify'

// 1. Schema
const warehouseTable = table('warehouse', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    tenantId: text(),
  },
  primaryKey: ['id'],
})

const warehouseView = view('warehouse_view').from(warehouseTable).columns({
  id: col('id'),
  slug: col('slug').searchable().label('warehouse.slug'),
  name: col('name').searchable().filterable(),
  tenantId: col('tenantId').hidden(),
})

// 2. BO + projection
const warehouseBO = defineBO(warehouseTable, {
  paramField: 'slug',
  actions: { create: {}, update: {}, delete: {} },
})

const warehouseProjection = defineProjection(warehouseBO, {
  name: 'warehouse',
  actions: { read: true, create: true, update: true, delete: true },
  // Narrow the public surface — tenantId never leaves the server
  columns: ['id', 'slug', 'name'],
})

// 3. Wire to Fastify
const app = Fastify()
const db = createDatabase({ connectionString: process.env.DATABASE_URL! })

registerProjection(app, db, {
  projection: warehouseProjection,
  view: warehouseView,
  extractContext: async (req) => ({
    app, db,
    tenantId: (req.headers['x-tenant-id'] as string) ?? undefined,
    userId:   (req.headers['x-user-id']   as string) ?? undefined,
    locale:   (req.headers['accept-language'] as string)?.slice(0, 2) ?? 'en',
  }),
})

await app.listen({ port: 3000 })
```

This produces, under `/bo/warehouse` (the default prefix):

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/bo/warehouse`               | Paginated list (search, filter, sort) |
| `GET`    | `/bo/warehouse/:slug`         | Detail |
| `POST`   | `/bo/warehouse`               | Create |
| `PUT`    | `/bo/warehouse/:slug`         | Update |
| `DELETE` | `/bo/warehouse/:slug`         | Delete |
| `GET`    | `/meta/warehouse`             | Frontend-consumable field metadata |

The `:param` segment is driven by `bo.paramField`, not hardcoded to `id`.

## `registerProjection`

```typescript
function registerProjection(app: FastifyInstance, db: Database, config: ProjectionRouteConfig): void

interface ProjectionRouteConfig {
  /** The projection — defines the HTTP surface (whitelist, columns, WHERE). */
  readonly projection: ProjectionDef
  /** The view to query. Defaults to projection.bo.root if it's a ViewDef. */
  readonly view?: ViewDef
  /** Route prefix override. Defaults to projection.bo.routePrefix or `/bo/${projection.name}`. */
  readonly prefix?: string
  /** Include global (tenant-less) rows alongside tenant-scoped rows. */
  readonly includeGlobal?: boolean
  /** Tenant column name. Default: 'tenantId'. */
  readonly tenantColumn?: string
  /** Extract context per request. Called on every route. */
  readonly extractContext: (req: FastifyRequest) => RouteContext | Promise<RouteContext>
  /** Hook called after a successful create/update/delete — cache invalidation etc. */
  readonly afterWrite?: (ctx: RouteContext, action: 'create' | 'update' | 'delete') => void | Promise<void>
  /** Value-help views keyed by name. Defaults to projection.bo.valueHelps. */
  readonly valueHelps?: Readonly<Record<string, ViewDef>>
}

interface RouteContext {
  readonly app: FastifyInstance
  readonly db: Database
  readonly tenantId?: string
  readonly userId?: string
  readonly locale: string
}
```

### What gets registered

Only whitelisted actions produce routes. `projection.actions.<name>: true` is the only way an action becomes reachable over HTTP — accidental exposure is impossible.

**If `read: true`:**

- `GET {prefix}` — paginated list. Runs composition + association enrichment, applies `transformItems`, attaches `global: true` flag when `includeGlobal`, then narrows to `projection.columns`.
- `GET {prefix}/:param` — single row by `bo.paramField`. 404 if not found (also 404 if the projection's `where` clause filters it out — invisible rows can't be detail-fetched).
- `GET /meta/{projection.name}` — field metadata transformed for the frontend (see [Metadata](metadata#meta-name-response-shape)).
- `GET /bo/{projection.name}/valueHelp/{vhName}` — paginated value help for each entry in `bo.valueHelps`.

**If `create: true`** (and `bo.actions.create` is defined): `POST {prefix}` → 201 on success.

**If `update: true`**: `PUT {prefix}/:param`. Body + `paramField` are merged before dispatching to `bo.update`. 404 for invisible rows; 403 when `includeGlobal` is on and the target row is global.

**If `delete: true`**: `DELETE {prefix}/:param`. Same 404 / 403 semantics as update.

**Custom actions** (`projection.actions.<custom>: true` + `bo.actions.<custom>` handler): `POST /bo/{projection.name}/{custom}`. Body goes straight to the handler. Return `null`/`undefined` → 204; return a `FileResponse` → binary stream; anything else → JSON.

### Tenant scoping + `includeGlobal`

Set `extractContext` to populate `tenantId` from the request (typically a header or JWT claim). The adapter then applies `tenantId = $ctx.tenantId` to every list/detail query — tenant isolation is automatic:

```typescript
registerProjection(app, db, {
  projection: warehouseProjection,
  extractContext: (req) => ({
    app, db,
    tenantId: (req.headers['x-tenant-id'] as string),
    locale: 'en',
  }),
})
```

With `includeGlobal: true`, the WHERE relaxes to `tenantId = $ctx OR tenantId IS NULL`. Rows with null tenant are attached with `global: true` so the frontend can distinguish them. Writes against a global row return **403** — tenants can read globals but not mutate them.

### `afterWrite` hook

Fires after a successful `POST` / `PUT` / `DELETE` (not after custom actions — those own their own side effects). Typical use:

```typescript
registerProjection(app, db, {
  projection: warehouseProjection,
  extractContext: /* ... */,
  afterWrite: async (ctx, action) => {
    await cacheInvalidate(ctx.tenantId, 'warehouse')
    await audit.log({ user: ctx.userId, entity: 'warehouse', action })
  },
})
```

The hook fires *after* the response is computed but *before* the reply is sent, so it can safely await slow side effects.

### Binary responses — `FileResponse`

Custom actions can return a `FileResponse` instead of JSON:

```typescript
interface FileResponse {
  readonly data: Buffer | Uint8Array
  readonly contentType: string
  readonly filename?: string
  /** false (default) → attachment; true → inline */
  readonly inline?: boolean
}
```

```typescript
const docBO = defineBO(docTable, {
  paramField: 'id',
  actions: {
    pdf: {
      handler: async (ctx, data) => ({
        data: await renderPdf(data.id),
        contentType: 'application/pdf',
        filename: `doc-${data.id}.pdf`,
      }),
    },
  },
})
```

`Content-Length` is set from `data.byteLength`. If `filename` is set, `Content-Disposition` gets written with `inline` or `attachment` depending on `inline`. Filename quotes are escaped per RFC 6266.

## `registerViewRoute`

Read-only view routes without a BO. Use this for reporting surfaces that don't need write actions, permissions, or compositions.

```typescript
function registerViewRoute(app: FastifyInstance, db: Database, config: ViewRouteConfig): void

interface ViewRouteConfig {
  readonly view: ViewDef
  /** Default: `/view/${view.name}` */
  readonly prefix?: string
  readonly extractContext: (req: FastifyRequest) => RouteContext | Promise<RouteContext>
}
```

Produces:

- `GET {prefix}` — paginated list (same query params as projection list — see below)
- `GET {prefix}/meta` — `viewMeta(view)` output (note: `/meta` *suffix*, not a separate namespace, because there's no projection to disambiguate)

## Pagination + list query params

All list routes (projection list, view route, value-help endpoints) share the same query-string contract, parsed by `parseListParams` from `@pgbo/core/query`:

| Param | Type | Default | Behavior |
|---|---|---|---|
| `page`        | int    | `1`     | 1-based |
| `limit`       | int    | `25`    | Clamped to `[1, 250]` |
| `search`      | string | `''`    | Applies ILIKE across columns marked `.searchable()` on the view |
| `sort`        | string | `null`  | Column name — maps to ORDER BY |
| `order`       | `asc` / `desc` | `asc` | |
| `filter.<col>`| string | —       | Equality filter on `<col>` — only applied for columns allowed by the view's metadata |
| `locale`      | string | `'en'`  | Passed into ctx for locale-aware queries |
| `fields`      | comma-separated | `null` | Subset of columns to return |

Example:

```
GET /bo/warehouse?search=ship&filter.active=true&sort=name&order=asc&page=2&limit=10
```

Response shape (`PaginatedResult<T>`):

```typescript
{
  items: T[],
  total: number,   // COUNT(*) with the same WHERE
  page:  number,
  limit: number,
}
```

### `paginateView` (reusable helper)

If you need pagination inside a custom route, reuse the helper directly:

```typescript
import { paginateView } from '@pgbo/fastify'
import { parseListParams } from '@pgbo/core/query'

app.get('/custom/endpoint', async (req) => {
  const params = parseListParams(req.query as Record<string, unknown>)
  return paginateView({
    db,
    view: myView,
    params,
    baseWhere: { status: 'active' },     // AND-combined with filters + search
    userId: (req.headers['x-user-id'] as string),  // forwarded to .as() for auth
  })
})
```

## `buildTenantWhere`

Manual tenant scoping when you can't use `registerProjection`:

```typescript
import { buildTenantWhere } from '@pgbo/fastify'

// Strict tenant match
buildTenantWhere('t1')
// → { tenantId: 't1' }

// Include global rows (IS NULL)
buildTenantWhere('t1', 'tenantId', true)
// → { OR: [{ tenantId: { isNull: true } }, { tenantId: 't1' }] }
```

Feed the result into `db.from(view).where(...)` or `paginateView({ baseWhere: ... })`.

## Value help endpoints

Any BO with `valueHelps` gets a dropdown endpoint per entry. Value helps are regular views annotated with `.vh({ key, display })` (see [Value Help Views](schema#value-help-views)) — so `search`, `limit`, `page` all work out of the box, and `translatedJoin` / `restrict` / `where` compose naturally:

```typescript
const uomVh = view('uom_vh').from(uomTable)
  .translatedJoin(uomTranslationTable, { parentKey: 'uomSlug', localeColumn: 'locale', localeParam: 'app.locale', fallbackLocale: 'en', fields: ['name', 'symbol'] })
  .vh({ key: 'slug', display: 'name' })

const productBO = defineBO(productTable, {
  paramField: 'sku',
  valueHelps: { uom: uomVh },
})
```

Request:

```
GET /bo/product/valueHelp/uom?search=kg&limit=20
```

Returns the standard `PaginatedResult` shape. The frontend wires each `FilterMeta.endpoint` (see [Metadata](metadata)) to one of these endpoints.

## Complete reference: what routes a projection produces

Given `projection.name = 'warehouse'`, `bo.paramField = 'slug'`, actions `{ read, create, update, delete, pdf }` all whitelisted, and `valueHelps: { region: regionVh }`:

```
GET    /bo/warehouse                       # list
GET    /bo/warehouse/:slug                 # detail
POST   /bo/warehouse                       # create
PUT    /bo/warehouse/:slug                 # update
DELETE /bo/warehouse/:slug                 # delete
POST   /bo/warehouse/pdf                   # custom action
GET    /meta/warehouse                     # metadata
GET    /bo/warehouse/valueHelp/region      # value help
```

The metadata endpoint lives under `/meta/` rather than `/bo/warehouse/meta` so it never collides with a `:slug` that happens to be literally `meta` (issue #24).

## What stays your responsibility

- **Auth**: `extractContext` is where you parse JWTs / session cookies / headers. The adapter never invents a `userId` or `tenantId`.
- **Schema validation**: use the Zod schemas from [Validation](validation) to validate `req.body` before it reaches `bo.create` / `bo.update`.
- **Error handling**: Fastify's standard `setErrorHandler` applies. The adapter throws plain `Error`s with descriptive messages — translate them to HTTP responses in your error handler.
- **CORS, rate limiting, logging, request IDs** — regular Fastify plugins.
