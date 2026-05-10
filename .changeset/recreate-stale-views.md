---
"@pgbo/core": minor
---

`diff()` now detects view column-set drift and emits `dropView` + `createView` to recreate stale views (closes #55).

Before this change, adding/renaming/removing a column on a `view().columns({...})` definition produced no migration operation — the live view was never updated, and queries silently returned missing columns. The workaround was to manually `DROP VIEW … CASCADE` before every migrate.

### What's new

1. **`SnapshotView.columns`** — `introspect()` now captures the output column names of every view from `information_schema.columns`. Optional for backward compat with hand-built fixtures.

2. **Drift detection in `diff()`** — for each managed view, the diff compares the snapshot's columns against the expected columns the view definition would emit (`expectedViewColumns`). If **any** managed view differs:

   - Emits `DROP VIEW IF EXISTS <name> CASCADE` for every managed view in the snapshot.
   - Emits `CREATE VIEW <name> AS …` for every view in the schema definitions.

   `CASCADE` handles dependency ordering automatically; managed dependent views get re-created from the schema. Unmanaged views that depend on managed ones are dropped silently — either register them with the schema or recreate them out-of-band.

3. **New `dropView` operation type** added to `MigrationOperation`.

4. **Docs** — `docs/migration.md` updated with the view-recreate behaviour and a new "Scope: additive-only" section calling out what the diff engine deliberately doesn't detect (column drops, type changes, renames, etc.).

### Backward compatibility

- Existing migrations that don't touch view definitions produce identical plans — drift detection is skipped when no view has changed.
- `SnapshotView.columns` is optional; older callers that construct snapshots by hand keep working (drift detection is skipped for views without a `columns` field).
