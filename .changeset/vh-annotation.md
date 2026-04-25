---
"@pgbo/core": minor
"@pgbo/fastify": minor
---

Replace `ValueHelpViewDef` with a `.vh({ key, display })` annotation on regular views (closes #34). **Breaking change.**

`valueHelpView()` could only express `SELECT key, display FROM source` — the moment a value help needed a JOIN, a translated label, or a WHERE, it had to be hand-written in Fastify, bypassing the framework. The new shape: a value help is just a regular view with an annotation, so every view feature applies.

### Before

```ts
const warehouseVH = valueHelpView('warehouse_vh')
  .from(warehouseTable)
  .key('slug')
  .display('name')
```

### After

```ts
const warehouseVH = view('warehouse_vh')
  .from(warehouseTable)
  .columns({ slug: col('slug'), name: col('name') })
  .vh({ key: 'slug', display: 'name' })
```

Unlocks use cases that were impossible before — translated labels via `translatedJoin`, tenant-scoped value helps via `.where()`, auth-restricted value helps via `.restrict()`, etc.:

```ts
const uomVh = view('uom_vh')
  .from(unitOfMeasureTable)
  .translatedJoin(unitOfMeasureTranslationTable, {
    parentKey: 'uomSlug', localeColumn: 'locale',
    localeParam: 'app.locale', fallbackLocale: 'en',
    fields: ['name', 'symbol'],
  })
  .vh({ key: 'slug', display: 'name' })
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
view(name).from(t).columns({ [k]: col(k), [d]: col(d) }).vh({ key: k, display: d })
```

### Migration/diff

No change to `SchemaDefinitions.bos` — migrate still walks BO `valueHelps` and emits `CREATE VIEW`. Additionally, if a vh view is registered directly in `views: []`, migrate dedupes it against the `bos` walk so you don't get two identical CREATE VIEW statements.
