---
"@pgbo/core": minor
"@pgbo/fastify": minor
---

Auto-enrich associations on reads with optional merge + attach (closes #23).

`AssociationDef` gains read-time enrichment vocabulary symmetric to compositions:

- `cardinality: 'one' | 'many'` — default `'one'`; `'many'` reserved for a follow-up
- `merge: readonly string[]` + `prefix?: string` — lift target fields onto the parent (`merge: ['name'], prefix: 'area'` → `parent.areaName`)
- `attach: string` + `columns?: readonly string[]` — attach target as a nested object, optionally narrowed
- `where?: Record<string, unknown>` — additional filter on the target query (context placeholders supported)
- `target` type widened to `ViewDef | TableDef | BusinessObjectDef` — BO targets run their own compositions (translations), so `merge: ['name']` picks the resolved locale-specific name automatically

### New exports in `@pgbo/core`

- `enrichAssociations(db, bo, items, { ctx? })` from `@pgbo/core/bo`
- `EnrichAssociationsOptions` type
- `AssociationTargetBO` structural type (re-exported from `@pgbo/core/schema`)

### `@pgbo/fastify`

`registerProjection`'s GET list and GET detail handlers now call `enrichAssociations` after `enrichCompositions`, forwarding the request ctx. No API change — existing code keeps working.

Associations without `merge` or `attach` remain metadata-only (no DB hit).

Deferred: `cardinality: 'many'` reverse-FK associations; projection-level per-association overrides (part of #15 composability follow-up).
