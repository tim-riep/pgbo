// Auto-migration engine — Phase 4
export { introspect, type DatabaseSnapshot, type SnapshotTable, type SnapshotColumn, type SnapshotForeignKey, type SnapshotIndex, type SnapshotDomain, type SnapshotEnum, type SnapshotView } from './introspect.js'
export { diff, type MigrationPlan, type MigrationOperation, type SchemaDefinitions } from './diff.js'
export { migrate } from './execute.js'
