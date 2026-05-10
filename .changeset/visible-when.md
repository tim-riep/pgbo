---
"@pgbo/core": minor
"@metadataui/spec": minor
---

Discriminator-aware field visibility via `.visibleWhen()` (closes #62).

Polymorphic tables typically have one discriminator column (`kind`, `type`, `status`) and other columns that only apply to specific values of it. Until now, `/meta/{name}` returned every field with the same `inForm: true`, with no signal that some are conditional — every metadata-driven UI had to hard-code per-table dispatch logic.

### New API

`@pgbo/core/schema`:

- **`col(...).visibleWhen(predicate)`** column annotation. Three predicate shapes:

  | Shape | Semantics |
  |---|---|
  | `{ kind: 'iframe' }` | Equality |
  | `{ kind: ['iframe', 'esm_upload'] }` | OR over the array |
  | `{ kind: 'iframe', requiresAuth: true }` | AND across keys |

  Throws on empty predicates so accidentally-empty calls fail at definition time.

`@metadataui/spec`:

- **`VisibleWhen`** type — `Readonly<Record<string, unknown | readonly unknown[]>>`.
- **`FieldMeta.visibleWhen?: VisibleWhen`** + same on `PublicFieldMeta`. Frontends evaluate it against the current form state on every change to show/hide the field.

### Example

```ts
const appView = view('app_view').from(apps).columns({
  slug:      col('slug').required().immutable(),
  kind:      col('kind').required(),                     // discriminator
  name:      col('name').required(),
  version:   col('version').required().visibleWhen({ kind: 'esm_upload' }),
  bundleRef: col('bundleRef').visibleWhen({ kind: 'esm_upload' }),
  iframeUrl: col('iframeUrl').visibleWhen({ kind: 'iframe' }),
})
```

`/meta/app` now emits `version.visibleWhen = { kind: 'esm_upload' }`. A metadata-driven form hides the field unless `formState.kind === 'esm_upload'`.

### `required` composes

`.required().visibleWhen({...})` means *required when visible*. The frontend skips required validation while the field is hidden, and strips hidden fields from the submit payload so toggling the discriminator doesn't carry stale data.

### Server-side enforcement (out of scope)

Stripping hidden columns server-side is a v1.5 follow-up. For now the frontend is responsible — a malicious client can still submit irrelevant fields. The metadata-driven UI benefit lands first; defensive server-side stripping later.

### Backward compatibility

Purely additive — fields without `.visibleWhen()` keep `visibleWhen: undefined` and are always visible.
