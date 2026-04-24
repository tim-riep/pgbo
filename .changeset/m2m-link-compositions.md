---
"@pgbo/core": minor
---

Many-to-many compositions via link tables (closes #25, read path).

A new `LinkCompositionDef` shape resolves parent → link table → target entity:

```ts
const productBO = defineBO(productTable, {
  compositions: {
    warehouses: {
      linkTable: productWarehouseTable,
      linkParentKey: 'wku',
      linkTargetKey: 'warehouseSlug',
      target: warehouseBO,
      columns: ['slug', 'name'],
      linkWhere: { archived: { isNull: true } },
      where: { active: true },
    },
  },
})
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
