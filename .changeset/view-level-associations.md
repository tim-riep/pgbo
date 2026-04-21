---
"@pgbo/core": minor
---

Add view-level associations (issue #4).

`ViewDef` now supports `.associations({ name: { foreignKey, target } })`. BOs inherit view-declared associations automatically — no need to redeclare them on every BO that shares a view. BO-level `associations` still work and take precedence on key collision.

`viewMeta()` surfaces associations in its output (new `associations: AssociationMeta[]` field), so metadata endpoints and low-level consumers can resolve relations without BO context.

Compositions stay BO-only (they carry write-time cascade semantics).
