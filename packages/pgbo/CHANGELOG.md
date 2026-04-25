# @pgbo/core

## 1.0.0

### Major Changes

- 61a6bb0: Lock URL conventions in `@pgbo/fastify` — no manual route prefix overrides (closes #44). **Breaking change.**

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

### Minor Changes

- 0ddf3fd: Auto-wrap Fastify routes with `db.withContext` when sessionParams are configured (closes #42).

  Views with `.translatedJoin()` rely on `current_setting('app.locale', true)` to filter by locale. Until now, hitting one through `registerProjection` always returned the fallback locale because the route never called `db.withContext` to emit the per-request `SET LOCAL`. Now every read handler is wrapped automatically when `sessionParams` is configured:

  - `GET {prefix}` (list), `GET {prefix}/:param` (detail), value-help routes, and `registerViewRoute` reads — wrapped
  - `PUT` / `DELETE` — the projection-visibility pre-fetch is wrapped (so projection scope sees the locale); the actual write runs unwrapped
  - `POST` / custom actions — unwrapped (writes don't depend on `current_setting`; locale-aware custom actions call `db.withContext` inside the handler)

  When no `sessionParams` are configured, the wrap is a no-op — apps without them don't pay an extra transaction per request.

  ### New API

  - `Database.hasSessionParams: boolean` — true when `DatabaseConfig.sessionParams` was set with at least one resolver. The Fastify adapter reads this to decide whether to wrap.

  ### Internal type widening (compatible)

  `paginateView`, `enrichCompositions`, `enrichAssociations`, and the new `DbOrTx` exported from `@pgbo/fastify` accept `Database | TransactionClient`. Existing consumers passing `Database` still work — only callers that need to receive a scoped tx benefit from the widening.

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

## 0.6.0

### Minor Changes

- ff180b9: Column-to-value-help binding via metadata (closes #35).

  `col(...).valueHelp(vhView)` was already accepted, but `boMeta()` didn't surface a top-level reference on the field — frontends had to read `meta.valueHelps` separately, hard-code which column uses which value help, and hand-write the fetch boilerplate.

  Two changes:

  1. **`FieldMeta.valueHelp`** — `viewMeta` / `boMeta` now emit a `ValueHelpRef` on every field annotated with `.valueHelp(...)`:

  ```typescript
  {
    key: 'uomSlug',
    kind: 'relation',
    valueHelp: {
      name: 'uom',                   // BO key (the URL segment Fastify uses)
      keyField: 'slug',
      displayField: 'name',
      endpoint: '/bo/product/valueHelp/uom',  // populated by @pgbo/fastify
    },
  }
  ```

  `@pgbo/fastify` resolves `endpoint` against the projection prefix in its `/meta/:name` transform; reading the raw `boMeta(bo)` (no projection context) gives the ref without `endpoint`.

  2. **`defineBO()` validation** — every column-level `.valueHelp(vhView)` must reference a view also registered under `valueHelps`. Throws at definition time with a suggestion of known keys instead of letting forms 404 at request time.

  Top-level `meta.valueHelps[].name` and `filterable.endpoint` now also use the BO key (the URL segment) instead of the underlying view name — `filterable.endpoint` was previously the view name, which didn't match the actual route URL.

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

## 0.5.0

### Minor Changes

- 7f96a57: Migrate value help views automatically via registered BOs (fixes #31).

  `valueHelpView()` used to declare a DB view via `toSQL()` but nothing ever executed the DDL — `SchemaDefinitions` had no slot that accepted value helps. Result: `@pgbo/fastify` 500s with `relation "foo_vh" does not exist` on every value-help endpoint.

  `SchemaDefinitions` now accepts an optional `bos` array. `diff()` walks each BO's `valueHelps`, dedupes by view name (two BOs sharing the same value help produce one `CREATE VIEW`), and emits the DDL for each unique value help that isn't already in the snapshot:

  ```ts
  const warehouseVh = valueHelpView('warehouse_vh').from(warehouseTable).key('slug').display('name')

  const warehouseBO = defineBO(warehouseView, {
    name: 'warehouse',
    paramField: 'id',
    valueHelps: { warehouse: warehouseVh },
  })

  migrate(db, {
    domains: [...],
    enums: [...],
    tables: [warehouseTable],
    views: [warehouseView],
    bos: [warehouseBO], // ← new
  })
  ```

  Declaring the value help on the BO is now the only wiring needed — no separate registration list. The field is optional, so existing migrate callers don't need to change.

## 0.4.0

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

- c128a4a: Many-to-many compositions via link tables (closes #25, read path).

  A new `LinkCompositionDef` shape resolves parent → link table → target entity:

  ```ts
  const productBO = defineBO(productTable, {
    compositions: {
      warehouses: {
        linkTable: productWarehouseTable,
        linkParentKey: "wku",
        linkTargetKey: "warehouseSlug",
        target: warehouseBO,
        columns: ["slug", "name"],
        linkWhere: { archived: { isNull: true } },
        where: { active: true },
      },
    },
  });
  ```

  ### Behaviour on read

  `enrichCompositions` batches three queries per parent group:

  1. `SELECT FROM linkTable WHERE linkParentKey = ANY($1) [AND linkWhere]`
  2. `SELECT FROM target WHERE target.paramField = ANY(targetKeys) [AND where]`
  3. If `target` is a BO, its own compositions run (e.g. translation resolution — `$locale` placeholders supported via `ctx`).

  Each parent gets an array of target rows under the composition name. `columns` narrows the exposed fields per element.

  ### New exports from `@pgbo/core/bo`

  - `LinkCompositionDef` — the M2M shape
  - `AnyCompositionDef` — union of the plain + link-through variants
  - `BoTarget` — structural type for BOs used as composition targets
  - `isLinkComposition(def)` — discriminator helper

  ### Scope

  **Read-only for now.** Write-through support (replace / add / remove semantics for M2M payloads in `bo.create()` / `bo.update()`) is deferred to a follow-up PR — link-data passed in write calls is currently ignored.

- fe95446: Add `.translatedJoin()` view helper (closes #14 — last remaining part).

  Declare a locale-resolved view in the schema instead of writing `current_setting()` SQL by hand:

  ```ts
  const areaLocalizedView = view("area_localized")
    .from(areaTable)
    .translatedJoin(areaTranslationTable, {
      parentKey: "areaId",
      localeColumn: "locale",
      localeParam: "app.locale",
      fallbackLocale: "en", // optional — COALESCE'd into missing translations
      fields: ["name", "description"],
    });
  ```

  ### Generated SQL

  Without fallback: one `LEFT JOIN translation t_req ON t_req.<parentKey> = parent.<pk> AND t_req.<localeCol> = current_setting('<param>', true)` plus `t_req.<field>` columns.

  With fallback: adds a second `LEFT JOIN translation t_fb ON ... AND t_fb.<localeCol> = '<fallback>'` plus `COALESCE(t_req.<field>, t_fb.<field>) AS <field>` columns so missing translations still return something.

  ### Pairs with `db.withContext` + `sessionParams`

  The locale is resolved per-request via the session-params infrastructure (from PR #16). `db.withContext({ locale: 'de' }, tx => tx.from(view).execute())` transparently filters translations across every query in the scope.

  ### Constraints

  - `.translatedJoin()` cannot be combined with `.columns()` — they both own the output column list. Throws at builder time with a clear message.
  - Source table must have a primary key; the first PK column is used for the join.

  ### Exports

  `TranslatedJoinSpec` type is now exported from `@pgbo/core/schema`.

## 0.3.0

### Minor Changes

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

- d538b0b: Bump minimum supported Node version from 20 to 22.

  CI matrix now runs against Node 22 and 24 (was 20 and 22). Node 20 is in maintenance LTS; Node 22 is the current active LTS. This aligns the supported range with npm's Trusted Publishing requirement (npm 11.5+, bundled with Node 22+) and lets us use modern features without polyfills.

- 7ef1b83: Filtered composition children + request-scoped session parameters (closes #13, #14 core).

  ### Issue #13 — Composition filters

  `CompositionDef` gains three new fields:

  - **`cardinality: 'many' | 'one'`** (default `'many'`). `'one'` returns a single object or `null`.
  - **`where`** — a WHERE clause applied to the composition query. Supports the same operators as `db.where()` plus context placeholders:
    - `$locale` → `ctx.locale`
    - `$userId` → `ctx.userId`
    - `$tenantId` → `ctx.tenantId`
    - `$now` → `new Date()`
  - **`merge: string[]`** — with `cardinality: 'one'`, lifts the matched child's fields onto the parent instead of attaching a nested object. Ideal for translations.

  `enrichCompositions(db, bo, items, { ctx })` gains an optional `ctx` option for placeholder resolution. If a placeholder references missing ctx data, enrichment throws (fail loud vs. silently returning unfiltered results).

  ### Issue #14 — Request-scoped session parameters (Path B)

  - **`createDatabase({ sessionParams })`** — declare Postgres session parameters resolved from per-request `ctx`.
  - **`db.withContext(ctx, async tx => …)`** — open a scoped connection, emit `SET LOCAL <key> = <value>` for each configured param, run `fn` with a TransactionClient bound to that connection, commit on success (rolls back on error). Views can read the params via `current_setting('app.locale', true)`.

  Parameter names validated against `/^[A-Za-z][A-Za-z0-9_.]*$/` (injection guard). Values are escaped. Resolvers returning `undefined` / `null` are silently skipped (setting remains unset).

  ### Deferred

  - The `.translatedJoin()` view helper from issue #14 is deferred to a follow-up — not needed for the core value prop (you can write the COALESCE JOIN SQL directly in a raw view for now).

## 0.2.0

### Minor Changes

- bd7cca3: Add pluggable cache layer with automatic BO invalidation (closes #8 core parts).

  New exports from `@pgbo/core/query`:

  - `CacheProvider` interface — `get / set / invalidateByTags / invalidateByKey / clear?`
  - `memoryCache({ maxEntries, defaultTtl })` — in-process LRU with per-entry TTL
  - `deriveCacheKey(prefix, sql, values)` — for custom providers

  New on `Database`:

  - `createDatabase({ cache })` — register a provider
  - `db.cache` — direct access for custom invalidation from action handlers

  New on `SelectBuilder`:

  - `.cached({ tags, ttl?, key? })` — read-through cache. On hit, skips SQL and returns cached result. On miss, executes, stores under the auto-derived key, and returns.

  Auto-invalidation: `bo.create` / `bo.update` / `bo.delete` call `cache.invalidateByTags(bo.cacheTags)` after a successful write. Custom actions do NOT auto-invalidate — they must call `db.cache.invalidateByTags(...)` in their handler if they mutate state.

  Without a configured cache, `.cached()` is a silent no-op. Redis and other distributed backends live in app code: implement `CacheProvider` (~30 LOC) and pass it to `createDatabase`.

  Also exposes `testDb.connectionString` on `TestDatabase` so cache-aware databases can be created in tests against isolated test DBs.

- a23904b: Add view-level associations (issue #4).

  `ViewDef` now supports `.associations({ name: { foreignKey, target } })`. BOs inherit view-declared associations automatically — no need to redeclare them on every BO that shares a view. BO-level `associations` still work and take precedence on key collision.

  `viewMeta()` surfaces associations in its output (new `associations: AssociationMeta[]` field), so metadata endpoints and low-level consumers can resolve relations without BO context.

  Compositions stay BO-only (they carry write-time cascade semantics).
