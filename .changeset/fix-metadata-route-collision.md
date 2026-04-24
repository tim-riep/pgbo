---
"@pgbo/fastify": major
---

Fix metadata route collision when `routePrefix` is not set (closes #24).

**Breaking change**: BO metadata moves from `GET /bo/{projection.name}` to `GET /meta/{projection.name}`.

### Why

With no explicit `routePrefix` on the BO or `prefix` in the route config, the list route defaulted to `/bo/{projection.name}` — the same path used for metadata. Fastify refused to boot:

> FastifyError: Method 'GET' already declared for route '/bo/warehouseProduct'

This meant every BO without a custom `routePrefix` broke the app at startup.

### Fix

Metadata now lives in a dedicated `/meta/{projection.name}` namespace, sidestepping any path collision with list or detail routes. Value help endpoints (`/bo/{projection.name}/valueHelp/{vh}`) and custom actions (`POST /bo/{projection.name}/{actionName}`) stay unchanged.

### Migration

Frontend clients that fetched BO metadata must update the URL:

```diff
- GET /bo/warehouse
+ GET /meta/warehouse
```

The response shape is unchanged.
