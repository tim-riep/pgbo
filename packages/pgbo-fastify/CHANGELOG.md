# @pgbo/fastify

## 2.0.1

### Patch Changes

- Updated dependencies [7f96a57]
  - @pgbo/core@0.5.0

## 2.0.0

### Major Changes

- 2f6a436: Fix metadata route collision when `routePrefix` is not set (closes #24).

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

### Minor Changes

- c8b1a44: Auto-enrich associations on reads with optional merge + attach (closes #23).

  `AssociationDef` gains read-time enrichment vocabulary symmetric to compositions:

  - `cardinality: 'one' | 'many'` — default `'one'`; `'many'` reserved for a follow-up
  - `merge: readonly string[]` + `prefix?: string` — lift target fields onto the parent (`merge: ['name'], prefix: 'area'` → `parent.areaName`)
  - `attach: string` + `columns?: readonly string[]` — attach target as a nested object, optionally narrowed
  - `where?: Record<string, unknown>` — additional filter on the target query (context placeholders supported)
  - `target` type widened to `ViewDef | TableDef | BusinessObjectDef` — BO targets run their own compositions (translations), so `merge: ['name']` picks the resolved locale-specific name automatically

  ### New exports in `@pgbo/core`

  - `enrichAssociations(db, bo, items, { ctx? })` from `@pgbo/core/bo`
  - `EnrichAssociationsOptions` type
  - `AssociationTargetBO` structural type (re-exported from `@pgbo/core/schema`)

  ### `@pgbo/fastify`

  `registerProjection`'s GET list and GET detail handlers now call `enrichAssociations` after `enrichCompositions`, forwarding the request ctx. No API change — existing code keeps working.

  Associations without `merge` or `attach` remain metadata-only (no DB hit).

  Deferred: `cardinality: 'many'` reverse-FK associations; projection-level per-association overrides (part of #15 composability follow-up).

### Patch Changes

- Updated dependencies [c8b1a44]
- Updated dependencies [c128a4a]
- Updated dependencies [fe95446]
  - @pgbo/core@0.4.0

## 1.0.1

### Patch Changes

- 38798b9: Fix `registerProjection` not forwarding `ctx` to `enrichCompositions` (closes #20).

  Compositions that use context placeholders in their `where` clause (`$locale`, `$userId`, `$tenantId`, `$now`) threw at request time — e.g. translation compositions using `where: { locale: '$locale' }`. Both GET list and GET detail handlers now pass the extracted `RouteContext` through as the enrichment ctx.

## 1.0.0

### Major Changes

- ac74117: Introduce BO projections as the HTTP surface (closes #15 core).

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
  registerBoRoutes(app, db, {
    bo: warehouseBO,
    view: warehouseView,
    extractContext,
  });

  // After — full surface
  const warehouseAll = defineProjection(warehouseBO, {
    name: "warehouse",
    actions: { read: true, create: true, update: true, delete: true },
  });
  registerProjection(app, db, {
    projection: warehouseAll,
    view: warehouseView,
    extractContext,
  });

  // Or split by audience — admin vs public
  const warehousePublic = defineProjection(warehouseBO, {
    name: "warehousePublic",
    actions: { read: true },
    columns: ["id", "slug", "name"],
  });
  const warehouseAdmin = defineProjection(warehouseBO, {
    name: "warehouseAdmin",
    actions: { read: true, create: true, update: true, delete: true },
  });
  ```

  ### Deferred to follow-up PRs

  - Filtered compositions/associations overrides on the projection (depends on PR #16 already-merged vocabulary)
  - Locked context values (`lock: { locale: '$locale' }`)
  - Projection-of-projection composability

### Minor Changes

- d538b0b: Bump minimum supported Node version from 20 to 22.

  CI matrix now runs against Node 22 and 24 (was 20 and 22). Node 20 is in maintenance LTS; Node 22 is the current active LTS. This aligns the supported range with npm's Trusted Publishing requirement (npm 11.5+, bundled with Node 22+) and lets us use modern features without polyfills.

### Patch Changes

- Updated dependencies [ac74117]
- Updated dependencies [d538b0b]
- Updated dependencies [7ef1b83]
  - @pgbo/core@0.3.0

## 0.2.0

### Minor Changes

- 15832be: Auto-expose BO custom actions as HTTP routes, with support for binary file responses (closes #5, #7).

  Every non-standard action on a BO (anything besides `create` / `update` / `delete`) is now auto-registered as `POST /bo/{boName}/{actionName}`. The request body is passed as the action's `data` argument. Standard CRUD actions keep their existing REST routes — no duplication.

  Return-value handling:

  - Any value → JSON body, 200
  - `undefined` or `null` → 204 no body
  - New `FileResponse` shape (`{ data: Buffer | Uint8Array, contentType, filename?, inline? }`) → binary body with `Content-Type` and `Content-Disposition` headers

  This eliminates the need for hand-written Fastify wrapper routes around `bo.execute(...)` and enables PDF / XLSX / CSV generation from BO actions without glue code.

### Patch Changes

- Updated dependencies [bd7cca3]
- Updated dependencies [a23904b]
  - @pgbo/core@0.2.0
