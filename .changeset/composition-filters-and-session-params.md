---
"@pgbo/core": minor
---

Filtered composition children + request-scoped session parameters (closes #13, #14 core).

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
