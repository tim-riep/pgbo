# @pgbo/core

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
