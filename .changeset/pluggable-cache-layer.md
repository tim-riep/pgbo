---
"@pgbo/core": minor
---

Add pluggable cache layer with automatic BO invalidation (closes #8 core parts).

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
