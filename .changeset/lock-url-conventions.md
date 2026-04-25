---
"@pgbo/core": major
"@pgbo/fastify": major
---

Lock URL conventions in `@pgbo/fastify` — no manual route prefix overrides (closes #44). **Breaking change.**

Every projection's HTTP surface now lives at exactly one URL pattern derived from the projection name, with no per-BO or per-route knob to override it:

```
GET    /bo/{projection}                     list
GET    /bo/{projection}/{paramValue}        detail
POST   /bo/{projection}                     create
PUT    /bo/{projection}/{paramValue}        update
DELETE /bo/{projection}/{paramValue}        delete
GET    /meta/{projection}                   metadata
GET    /bo/{projection}/valueHelp/{vh}      value help
POST   /bo/{projection}/{action}            custom action
GET    /view/{view}                         view route
GET    /view/{view}/meta                    view metadata
```

### Removed

- `BOConfig.routePrefix` and `BusinessObjectDef.routePrefix`
- `ProjectionRouteConfig.prefix`
- `ViewRouteConfig.prefix`
- `BOMeta.routePrefix`

### Why

- **Frontend simplicity** — with only the projection name in hand the UI can build any URL. No catalog lookup needed for the URL part.
- **Refactor safety** — renaming a projection rewrites every URL automatically; the frontend can't lag behind.
- **Multi-tenant routing stays in middleware** — API versioning, tenant prefixes, etc. belong in Fastify's encapsulation layer (`app.register(routes, { prefix: '/v1' })`), not on each BO.

### Migration

Replace per-BO / per-projection prefix configs with the canonical layout. URLs the frontend used to call:

```
/api/warehouses           → /bo/warehouse
/api/admin/areas          → /bo/areaAdmin   (rename projection 'area' → 'areaAdmin')
/api/public/areas         → /bo/areaPublic
```

Two projections over the same BO that previously shared a prefix must now pick distinct projection names. For tenant or version prefixes, wrap `registerProjection` calls in a Fastify plugin and use Fastify's `prefix` at registration time:

```ts
app.register(async (api) => {
  registerProjection(api, db, { projection: warehouseProjection, ... })
}, { prefix: '/v1' })
// → /v1/bo/warehouse, /v1/meta/warehouse, etc.
```
