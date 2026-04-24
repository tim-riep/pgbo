---
"@pgbo/core": minor
---

Add `.translatedJoin()` view helper (closes #14 — last remaining part).

Declare a locale-resolved view in the schema instead of writing `current_setting()` SQL by hand:

```ts
const areaLocalizedView = view('area_localized')
  .from(areaTable)
  .translatedJoin(areaTranslationTable, {
    parentKey: 'areaId',
    localeColumn: 'locale',
    localeParam: 'app.locale',
    fallbackLocale: 'en',           // optional — COALESCE'd into missing translations
    fields: ['name', 'description'],
  })
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
