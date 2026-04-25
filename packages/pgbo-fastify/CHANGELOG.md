# @pgbo/fastify

## 2.1.0

### Minor Changes

- a9030b0: OpenAPI / Swagger schema generation for every auto-registered route (closes #38).

  `@pgbo/fastify` now attaches a Fastify `schema` block to every route it registers — `@fastify/swagger` picks them up automatically and the generated `/docs` UI shows every reachable endpoint with the right shapes, no per-route boilerplate.

  ### What gets emitted per route

  | Route                             | tags                  | summary                  | body / response                                                                                    |
  | --------------------------------- | --------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
  | `GET {prefix}` (list)             | `[name]`              | `List {name}`            | querystring: page/limit/search/sort/order/locale/fields. Response: `{ items, total, page, limit }` |
  | `GET {prefix}/:param` (detail)    | `[name]`              | `Get {name}`             | params: `{ param: <PK type> }`. Response: row schema                                               |
  | `POST {prefix}`                   | `[name]`              | `Create {name}`          | body: required + writable fields                                                                   |
  | `PUT {prefix}/:param`             | `[name]`              | `Update {name}`          | body: writable fields, all optional                                                                |
  | `DELETE {prefix}/:param`          | `[name]`              | `Delete {name}`          | params + row response                                                                              |
  | `GET /meta/{name}`                | `[name, 'meta']`      | `Metadata for {name}`    | response: `BOMeta` shape                                                                           |
  | `GET /bo/{name}/valueHelp/{vh}`   | `[name, 'valueHelp']` | `Value help: {vh}`       | list params + paginated rows                                                                       |
  | `POST /bo/{name}/{action}`        | `[name, 'action']`    | from `ActionDef.summary` | body from `ActionDef.inputSchema` (when set)                                                       |
  | View routes (`registerViewRoute`) | `[view.name, 'view']` | `View: {name}`           | list params + paginated rows                                                                       |

  ### New API surface

  - **`ActionDef.inputSchema`** — JSON Schema describing the action's request body. Used as the route `body` schema. Skip it and the route accepts any object (Fastify doesn't validate).
  - **`ActionDef.summary` / `ActionDef.description`** — propagate into the OpenAPI spec. Use these when the description belongs with the BO (reusable across projections) rather than the per-projection `swagger.descriptions`.
  - **`ProjectionRouteConfig.swagger`** + **`ViewRouteConfig.swagger`** — `{ enabled?, tag?, descriptions?, securityScheme? }`. Defaults are sensible (on, with `projection.name` as tag, `bearerAuth` security).
  - **Auth integration** — when the projection's view has `.restrict()` (and not `.noAuth()`), routes get `security: [{ bearerAuth: [] }]`. Override the scheme name with `swagger.securityScheme: 'apiKey'`.

  ### Field type → JSON Schema mapping

  | `FieldMeta.kind`             | JSON Schema                               |
  | ---------------------------- | ----------------------------------------- |
  | `text` / `slug` / `relation` | `{ type: 'string' }`                      |
  | `number`                     | `{ type: 'number' }`                      |
  | `boolean`                    | `{ type: 'boolean' }`                     |
  | `date`                       | `{ type: 'string', format: 'date-time' }` |
  | `translation`                | `{ type: 'string', nullable: true }`      |

  All row schemas use `additionalProperties: true` so dynamically-attached fields (the `global` flag, composition arrays, association merges, virtual fields) pass through unchanged.

  ### Opt out

  `swagger.enabled: false` falls back to the pre-#38 behaviour — routes registered without any schema block.

- da6659e: Replace `ValueHelpViewDef` with a `.vh({ key, display })` annotation on regular views (closes #34). **Breaking change.**

  `valueHelpView()` could only express `SELECT key, display FROM source` — the moment a value help needed a JOIN, a translated label, or a WHERE, it had to be hand-written in Fastify, bypassing the framework. The new shape: a value help is just a regular view with an annotation, so every view feature applies.

  ### Before

  ```ts
  const warehouseVH = valueHelpView("warehouse_vh")
    .from(warehouseTable)
    .key("slug")
    .display("name");
  ```

  ### After

  ```ts
  const warehouseVH = view("warehouse_vh")
    .from(warehouseTable)
    .columns({ slug: col("slug"), name: col("name") })
    .vh({ key: "slug", display: "name" });
  ```

  Unlocks use cases that were impossible before — translated labels via `translatedJoin`, tenant-scoped value helps via `.where()`, auth-restricted value helps via `.restrict()`, etc.:

  ```ts
  const uomVh = view("uom_vh")
    .from(unitOfMeasureTable)
    .translatedJoin(unitOfMeasureTranslationTable, {
      parentKey: "uomSlug",
      localeColumn: "locale",
      localeParam: "app.locale",
      fallbackLocale: "en",
      fields: ["name", "symbol"],
    })
    .vh({ key: "slug", display: "name" });
  ```

  ### Rules

  - Value helps must stay flat: `.vh()` and `.associations()` are mutually exclusive — calling one after the other throws at builder time.
  - `defineBO()` throws if any entry in `valueHelps` is a view without a `.vh()` annotation.
  - `col(...).valueHelp(view)` throws if the view isn't `.vh()` annotated.

  ### Removed

  - `valueHelpView()` function
  - `ValueHelpViewDef` type
  - The raw-SQL fallback in `@pgbo/fastify`'s value-help route (it's always a view now → always goes through `paginateView`, so `search`/`limit`/`page` query params just work)

  ### Migration

  Replace each `valueHelpView(name).from(t).key(k).display(d)` with:

  ```ts
  view(name)
    .from(t)
    .columns({ [k]: col(k), [d]: col(d) })
    .vh({ key: k, display: d });
  ```

  ### Migration/diff

  No change to `SchemaDefinitions.bos` — migrate still walks BO `valueHelps` and emits `CREATE VIEW`. Additionally, if a vh view is registered directly in `views: []`, migrate dedupes it against the `bos` walk so you don't get two identical CREATE VIEW statements.

### Patch Changes

- Updated dependencies [ff180b9]
- Updated dependencies [a9030b0]
- Updated dependencies [da6659e]
  - @pgbo/core@0.6.0

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
