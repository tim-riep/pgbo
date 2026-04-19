// PostgreSQL introspection — Phase 4 (Step 12)

import type { Queryable } from '../query/types.js'

/** Convert snake_case to camelCase */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

// --- Snapshot types ---

export interface SnapshotColumn {
  readonly name: string
  readonly camelName: string
  readonly type: string
  readonly isNullable: boolean
  readonly defaultValue: string | undefined
}

export interface SnapshotForeignKey {
  readonly columns: readonly string[]
  readonly camelColumns: readonly string[]
  readonly refTable: string
  readonly refColumns: readonly string[]
  readonly onDelete: string | undefined
  readonly onUpdate: string | undefined
}

export interface SnapshotIndex {
  readonly name: string
  readonly columns: readonly string[]
  readonly isUnique: boolean
}

export interface SnapshotTable {
  readonly name: string
  readonly columns: readonly SnapshotColumn[]
  readonly primaryKey: readonly string[]
  readonly foreignKeys: readonly SnapshotForeignKey[]
  readonly indexes: readonly SnapshotIndex[]
}

export interface SnapshotDomain {
  readonly name: string
  readonly baseType: string
  readonly checks: readonly string[]
}

export interface SnapshotEnum {
  readonly name: string
  readonly values: readonly string[]
}

export interface SnapshotView {
  readonly name: string
  readonly definition: string
}

export interface DatabaseSnapshot {
  readonly domains: readonly SnapshotDomain[]
  readonly enums: readonly SnapshotEnum[]
  readonly tables: readonly SnapshotTable[]
  readonly views: readonly SnapshotView[]
}

// --- Query result types ---

type DomainRow = { domain_name: string; data_type: string; domain_default: string | null; [key: string]: unknown }
type EnumRow = { typname: string; enumlabel: string; [key: string]: unknown }
type ColumnRow = {
  table_name: string; column_name: string; udt_name: string; domain_name: string | null
  is_nullable: string; column_default: string | null
  [key: string]: unknown
}
type PkRow = { table_name: string; column_name: string; [key: string]: unknown }
type FkRow = {
  constraint_name: string; table_name: string; column_name: string
  foreign_table_name: string; foreign_column_name: string
  delete_rule: string; update_rule: string
  [key: string]: unknown
}
type IndexRow = {
  tablename: string; indexname: string; indexdef: string
  [key: string]: unknown
}
type ViewRow = { table_name: string; view_definition: string; [key: string]: unknown }
type TableNameRow = { table_name: string; [key: string]: unknown }

export async function introspect(db: Queryable): Promise<DatabaseSnapshot> {
  // --- Domains ---
  const domainRows = await db.query<DomainRow>(
    `SELECT domain_name, data_type, domain_default
     FROM information_schema.domains
     WHERE domain_schema = 'public'`,
  )

  const domains: SnapshotDomain[] = domainRows.map(r => ({
    name: r.domain_name,
    baseType: r.data_type,
    checks: [],
  }))

  // --- Enums ---
  const enumRows = await db.query<EnumRow>(
    `SELECT t.typname, e.enumlabel
     FROM pg_type t
     JOIN pg_enum e ON t.oid = e.enumtypid
     JOIN pg_namespace n ON t.typnamespace = n.oid
     WHERE n.nspname = 'public'
     ORDER BY t.typname, e.enumsortorder`,
  )

  const enumMap = new Map<string, string[]>()
  for (const r of enumRows) {
    const existing = enumMap.get(r.typname)
    if (existing) {
      existing.push(r.enumlabel)
    } else {
      enumMap.set(r.typname, [r.enumlabel])
    }
  }

  const enums: SnapshotEnum[] = [...enumMap.entries()].map(([name, values]) => ({
    name,
    values,
  }))

  // --- Tables ---
  const tableNameRows = await db.query<TableNameRow>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  )

  // Columns
  const columnRows = await db.query<ColumnRow>(
    `SELECT table_name, column_name, udt_name, domain_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`,
  )

  const columnsByTable = new Map<string, SnapshotColumn[]>()
  for (const r of columnRows) {
    const cols = columnsByTable.get(r.table_name) ?? []
    cols.push({
      name: r.column_name,
      camelName: toCamelCase(r.column_name),
      type: r.domain_name ?? r.udt_name,
      isNullable: r.is_nullable === 'YES',
      defaultValue: r.column_default ?? undefined,
    })
    columnsByTable.set(r.table_name, cols)
  }

  // Primary keys
  const pkRows = await db.query<PkRow>(
    `SELECT tc.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY tc.table_name, kcu.ordinal_position`,
  )

  const pkByTable = new Map<string, string[]>()
  for (const r of pkRows) {
    const pk = pkByTable.get(r.table_name) ?? []
    pk.push(r.column_name)
    pkByTable.set(r.table_name, pk)
  }

  // Foreign keys
  const fkRows = await db.query<FkRow>(
    `SELECT
       tc.constraint_name,
       tc.table_name,
       kcu.column_name,
       ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name,
       rc.delete_rule,
       rc.update_rule
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     JOIN information_schema.referential_constraints rc
       ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
     WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
  )

  // Group FK rows by constraint name
  const fkByConstraint = new Map<string, { tableName: string; columns: string[]; refTable: string; refColumns: string[]; onDelete: string; onUpdate: string }>()
  for (const r of fkRows) {
    const existing = fkByConstraint.get(r.constraint_name)
    if (existing) {
      existing.columns.push(r.column_name)
      existing.refColumns.push(r.foreign_column_name)
    } else {
      fkByConstraint.set(r.constraint_name, {
        tableName: r.table_name,
        columns: [r.column_name],
        refTable: r.foreign_table_name,
        refColumns: [r.foreign_column_name],
        onDelete: r.delete_rule,
        onUpdate: r.update_rule,
      })
    }
  }

  const fkByTable = new Map<string, SnapshotForeignKey[]>()
  for (const fk of fkByConstraint.values()) {
    const fks = fkByTable.get(fk.tableName) ?? []
    fks.push({
      columns: fk.columns,
      camelColumns: fk.columns.map(toCamelCase),
      refTable: fk.refTable,
      refColumns: fk.refColumns,
      onDelete: fk.onDelete === 'NO ACTION' ? undefined : fk.onDelete,
      onUpdate: fk.onUpdate === 'NO ACTION' ? undefined : fk.onUpdate,
    })
    fkByTable.set(fk.tableName, fks)
  }

  // Indexes (exclude PK indexes)
  const indexRows = await db.query<IndexRow>(
    `SELECT tablename, indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = 'public'
     ORDER BY tablename, indexname`,
  )

  const pkConstraintNames = new Set(pkRows.map(r => r.table_name + '_pkey'))
  // Also collect actual PK constraint names
  const pkConstraintRows = await db.query<{ constraint_name: string; [key: string]: unknown }>(
    `SELECT constraint_name FROM information_schema.table_constraints
     WHERE table_schema = 'public' AND constraint_type = 'PRIMARY KEY'`,
  )
  for (const r of pkConstraintRows) {
    pkConstraintNames.add(r.constraint_name)
  }

  const indexByTable = new Map<string, SnapshotIndex[]>()
  for (const r of indexRows) {
    // Skip PK indexes
    if (pkConstraintNames.has(r.indexname)) continue

    const idxs = indexByTable.get(r.tablename) ?? []

    // Parse columns from indexdef: ... (col1, col2)
    const colMatch = /\(([^)]+)\)/.exec(r.indexdef)
    const columnList = colMatch?.[1]
    const columns = columnList
      ? columnList.split(',').map((c: string) => c.trim())
      : []

    const isUnique = r.indexdef.includes('UNIQUE')

    idxs.push({ name: r.indexname, columns, isUnique })
    indexByTable.set(r.tablename, idxs)
  }

  // Build table snapshots
  const tables: SnapshotTable[] = tableNameRows.map(r => ({
    name: r.table_name,
    columns: columnsByTable.get(r.table_name) ?? [],
    primaryKey: pkByTable.get(r.table_name) ?? [],
    foreignKeys: fkByTable.get(r.table_name) ?? [],
    indexes: indexByTable.get(r.table_name) ?? [],
  }))

  // --- Views ---
  const viewRows = await db.query<ViewRow>(
    `SELECT table_name, view_definition
     FROM information_schema.views
     WHERE table_schema = 'public'`,
  )

  const views: SnapshotView[] = viewRows.map(r => ({
    name: r.table_name,
    definition: r.view_definition,
  }))

  return { domains, enums, tables, views }
}
