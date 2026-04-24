---
"@pgbo/core": minor
"@pgbo/fastify": major
---

Introduce BO projections as the HTTP surface (closes #15 core).

**Breaking change in `@pgbo/fastify`**: `registerBoRoutes` is replaced by `registerProjection`. BOs are no longer directly exposed to HTTP — you must first wrap them in a projection that explicitly whitelists which actions and columns are reachable.

### New in `@pgbo/core`

- `defineProjection(bo, { name, actions, columns?, where? })` — declare an HTTP surface over a BO
- `projectRow(projection, row)` / `projectionExposes(projection, action)` — helpers
- `ProjectionDef` / `ProjectionConfig` types exported from `@pgbo/core/bo`

### New in `@pgbo/fastify`

- `registerProjection(app, db, config)` replaces `registerBoRoutes`
- `ProjectionRouteConfig` replaces `BoRouteConfig` (same fields but takes `projection` instead of `bo`)
- Only whitelisted actions produce routes — missing an action from the projection means missing routes, not forbidden routes
- Root WHERE on the projection applies to every list / detail / update / delete; out-of-scope rows 404
- `columns` narrows both response bodies and the metadata endpoint

### Migration

Wrap every BO in a one-shot projection that reproduces today's behaviour, then refine per surface:

```ts
// Before
registerBoRoutes(app, db, { bo: warehouseBO, view: warehouseView, extractContext })

// After — full surface
const warehouseAll = defineProjection(warehouseBO, {
  name: 'warehouse',
  actions: { read: true, create: true, update: true, delete: true },
})
registerProjection(app, db, { projection: warehouseAll, view: warehouseView, extractContext })

// Or split by audience — admin vs public
const warehousePublic = defineProjection(warehouseBO, { name: 'warehousePublic', actions: { read: true }, columns: ['id', 'slug', 'name'] })
const warehouseAdmin  = defineProjection(warehouseBO, { name: 'warehouseAdmin',  actions: { read: true, create: true, update: true, delete: true } })
```

### Deferred to follow-up PRs

- Filtered compositions/associations overrides on the projection (depends on PR #16 already-merged vocabulary)
- Locked context values (`lock: { locale: '$locale' }`)
- Projection-of-projection composability
