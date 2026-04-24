# @pgbo/core

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
