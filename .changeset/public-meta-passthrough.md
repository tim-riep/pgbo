---
"@pgbo/fastify": patch
---

Fix `/meta/{name}` dropping `systemManaged` and `visibleWhen` from the response (closes #68).

`transformProjectionMeta` rebuilds each `PublicFieldMeta` as a strict object literal, and the field for `systemManaged` (issue #61) and `visibleWhen` (issue #62) was never copied through. Both are now spread conditionally so they surface on the wire when set, and stay absent when not — matching how `valueHelp` / `filterable` are already handled.

This unblocks frontends that wanted to render `updatedAt` columns differently from regular fields, or hide fields based on a discriminator value (the headline use-case for `.visibleWhen()`).

For composition with `.visibleWhen()` to flow end-to-end the BO's root must be the view that carries the annotated `col(...).visibleWhen(...)` reference (`defineBO(myView, ...)`). When the BO root is the underlying table, view-column annotations don't reach metadata — that's by design, the same constraint that already applies to `.searchable()` / `.label()`.
