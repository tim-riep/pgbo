---
"@pgbo/core": minor
"@pgbo/fastify": minor
---

Auto-wrap Fastify routes with `db.withContext` when sessionParams are configured (closes #42).

Views with `.translatedJoin()` rely on `current_setting('app.locale', true)` to filter by locale. Until now, hitting one through `registerProjection` always returned the fallback locale because the route never called `db.withContext` to emit the per-request `SET LOCAL`. Now every read handler is wrapped automatically when `sessionParams` is configured:

- `GET {prefix}` (list), `GET {prefix}/:param` (detail), value-help routes, and `registerViewRoute` reads — wrapped
- `PUT` / `DELETE` — the projection-visibility pre-fetch is wrapped (so projection scope sees the locale); the actual write runs unwrapped
- `POST` / custom actions — unwrapped (writes don't depend on `current_setting`; locale-aware custom actions call `db.withContext` inside the handler)

When no `sessionParams` are configured, the wrap is a no-op — apps without them don't pay an extra transaction per request.

### New API

- `Database.hasSessionParams: boolean` — true when `DatabaseConfig.sessionParams` was set with at least one resolver. The Fastify adapter reads this to decide whether to wrap.

### Internal type widening (compatible)

`paginateView`, `enrichCompositions`, `enrichAssociations`, and the new `DbOrTx` exported from `@pgbo/fastify` accept `Database | TransactionClient`. Existing consumers passing `Database` still work — only callers that need to receive a scoped tx benefit from the widening.
