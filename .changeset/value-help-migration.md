---
"@pgbo/core": minor
---

Migrate value help views automatically via registered BOs (fixes #31).

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
