---
"@pgbo/core": minor
---

Migrate value help views end-to-end (fixes #31).

`valueHelpView()` used to declare a DB view via `toSQL()` but nothing ever executed the DDL — `SchemaDefinitions` only accepted `ViewDef[]`. Result: `@pgbo/fastify` 500s with `relation "foo_vh" does not exist` on every value-help endpoint.

`SchemaDefinitions` now accepts an optional `valueHelps` array, and `diff()` emits `CREATE VIEW` for each entry that isn't already in the snapshot:

```ts
const warehouseVh = valueHelpView('warehouse_vh').from(warehouseTable).key('slug').display('name')

migrate(db, {
  domains: [...],
  enums: [...],
  tables: [warehouseTable],
  views: [...],
  valueHelps: [warehouseVh], // ← new
})
```

The field is optional, so existing callers don't need to change.
