// Table builder — Phase 1c

import type {
  AnyColumnBuilder, TableDef, TableInput,
  ForeignKeyDef, IndexDef, CheckConstraintDef,
} from './definitions.js'
import { makeBuilder } from './types.js'

/** Convert camelCase to snake_case */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/** Generate an index name, truncated to PG's 63-char identifier limit */
export function generateIndexName(tableName: string, columns: readonly string[]): string {
  const raw = `idx_${tableName}_${columns.join('_')}`
  return raw.length > 63 ? raw.slice(0, 63) : raw
}

class TableDefImpl<C extends Record<string, AnyColumnBuilder>> implements TableDef<C> {
  readonly name: string
  readonly columns: C
  readonly primaryKey: readonly string[]
  readonly foreignKeys: readonly ForeignKeyDef[]
  readonly indexes: readonly IndexDef[]
  readonly checks: readonly CheckConstraintDef[]
  readonly translations?: readonly string[]
  readonly translationTable?: TableDef

  constructor(
    name: string,
    columns: C,
    primaryKey: readonly string[],
    foreignKeys: readonly ForeignKeyDef[],
    indexes: readonly IndexDef[],
    checks: readonly CheckConstraintDef[],
    translations?: readonly string[],
    translationTable?: TableDef,
  ) {
    this.name = name
    this.columns = columns
    this.primaryKey = primaryKey
    this.foreignKeys = foreignKeys
    this.indexes = indexes
    this.checks = checks
    this.translations = translations
    this.translationTable = translationTable
  }

  toSQL(): string {
    const lines: string[] = []

    // Column definitions
    for (const [camelName, col] of Object.entries(this.columns)) {
      const snakeName = toSnakeCase(camelName)
      lines.push(`  ${col.toSQL(snakeName)}`)
    }

    // Primary key
    const pkCols = this.primaryKey.map(toSnakeCase).join(', ')
    lines.push(`  PRIMARY KEY (${pkCols})`)

    // Foreign keys
    for (const fk of this.foreignKeys) {
      const cols = fk.columns.map(toSnakeCase).join(', ')
      const refCols = fk.refColumns.join(', ')
      let line = `  FOREIGN KEY (${cols}) REFERENCES ${fk.refTable}(${refCols})`
      if (fk.onDelete) line += ` ON DELETE ${fk.onDelete}`
      if (fk.onUpdate) line += ` ON UPDATE ${fk.onUpdate}`
      lines.push(line)
    }

    // Check constraints
    for (const c of this.checks) {
      lines.push(`  CHECK (${c.sql})`)
    }

    const parts: string[] = []
    parts.push(`CREATE TABLE ${this.name} (\n${lines.join(',\n')}\n);`)

    // Indexes (separate statements)
    for (const idx of this.indexes) {
      const cols = idx.columns.map(toSnakeCase).join(', ')
      const uniqueStr = idx.isUnique ? 'UNIQUE ' : ''
      const methodStr = idx.method ? ` USING ${idx.method}` : ''
      const idxName = generateIndexName(this.name, idx.columns.map(toSnakeCase))
      let stmt = `CREATE ${uniqueStr}INDEX ${idxName} ON ${this.name}${methodStr} (${cols})`
      if (idx.condition) stmt += ` WHERE ${idx.condition}`
      stmt += ';'
      parts.push(stmt)
    }

    return parts.join('\n')
  }
}

export function table<C extends Record<string, AnyColumnBuilder>>(
  name: string,
  input: TableInput & { columns: C },
): TableDef<C> {
  // Resolve foreign keys
  const foreignKeys: ForeignKeyDef[] = []

  // Auto-infer FKs from domains
  if (input.domains) {
    for (const [colName, domainDef] of Object.entries(input.domains)) {
      if (domainDef.reference) {
        foreignKeys.push({
          columns: [colName],
          refTable: domainDef.reference.table,
          refColumns: [domainDef.reference.column],
          onDelete: domainDef.reference.onDelete,
          onUpdate: undefined,
        })
      }
    }
  }

  // Explicit foreign keys
  if (input.foreignKeys) {
    for (const fkBuilder of input.foreignKeys) {
      foreignKeys.push(fkBuilder._build())
    }
  }

  // Resolve indexes
  const indexes: IndexDef[] = (input.indexes ?? []).map((idx) => ({
    columns: idx.columns,
    isUnique: idx.isUnique,
    condition: idx.condition,
    method: idx.method,
  }))

  // Resolve check constraints
  const checks: CheckConstraintDef[] = (input.checks ?? []).map((c) => ({
    column: c.column,
    sql: c.sql,
  }))

  // Generate translation table if needed
  let translationTable: TableDef | undefined
  if (input.translations && input.translations.length > 0) {
    const translationColumns: Record<string, AnyColumnBuilder> = {}

    // Copy parent PK columns
    for (const pkCol of input.primaryKey) {
      const parentCol = input.columns[pkCol]
      if (parentCol) {
        translationColumns[pkCol] = parentCol
      }
    }

    // Add locale column
    translationColumns['locale'] = makeBuilder<string>('locale_code').notNull()

    // Add translated fields
    for (const field of input.translations) {
      translationColumns[field] = makeBuilder<string>('text').notNull()
    }

    // PK = parent PK + locale
    const translationPK = [...input.primaryKey, 'locale']

    // FK = composite FK to parent
    const translationFK: ForeignKeyDef = {
      columns: [...input.primaryKey],
      refTable: name,
      refColumns: [...input.primaryKey],
      onDelete: 'CASCADE',
      onUpdate: undefined,
    }

    translationTable = new TableDefImpl(
      `${name}_translation`,
      translationColumns,
      translationPK,
      [translationFK],
      [],
      [],
    )
  }

  return new TableDefImpl(
    name,
    input.columns,
    input.primaryKey,
    foreignKeys,
    indexes,
    checks,
    input.translations,
    translationTable,
  )
}
