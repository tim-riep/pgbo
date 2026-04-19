// Schema diff algorithm — Phase 4 (Step 13)

import type { DatabaseSnapshot } from './introspect.js'
import type { TableDef, DomainDef, EnumDef, ViewDef } from '../schema/definitions.js'
import { toSnakeCase, generateIndexName } from '../schema/table.js'

export interface MigrationOperation {
  readonly type:
    | 'createDomain'
    | 'createEnum'
    | 'alterEnum'
    | 'createTable'
    | 'addColumn'
    | 'createIndex'
    | 'createView'
  readonly sql: string
  readonly tableName?: string
}

export interface MigrationPlan {
  readonly operations: readonly MigrationOperation[]
}

export interface SchemaDefinitions {
  readonly domains: readonly DomainDef[]
  readonly enums: readonly EnumDef[]
  readonly tables: readonly TableDef[]
  readonly views: readonly ViewDef[]
}

export function diff(definitions: SchemaDefinitions, snapshot: DatabaseSnapshot): MigrationPlan {
  const operations: MigrationOperation[] = []

  // --- 1. Domains ---
  for (const domainDef of definitions.domains) {
    const existing = snapshot.domains.find(d => d.name === domainDef.name)
    if (!existing) {
      operations.push({
        type: 'createDomain',
        sql: domainDef.toSQL(),
      })
    }
  }

  // --- 2. Enums ---
  for (const enumDef of definitions.enums) {
    const existing = snapshot.enums.find(e => e.name === enumDef.name)
    if (!existing) {
      operations.push({
        type: 'createEnum',
        sql: enumDef.toSQL(),
      })
    } else {
      // Check for new values (PG only supports adding, not removing)
      for (const val of enumDef.values) {
        if (!existing.values.includes(val)) {
          operations.push({
            type: 'alterEnum',
            sql: `ALTER TYPE ${enumDef.name} ADD VALUE '${val}'`,
          })
        }
      }
    }
  }

  // --- 3. Tables ---
  const allTables = collectTables(definitions.tables)

  for (const tableDef of allTables) {
    const existing = snapshot.tables.find(t => t.name === tableDef.name)
    if (!existing) {
      operations.push({
        type: 'createTable',
        sql: tableDef.toSQL(),
        tableName: tableDef.name,
      })
    } else {
      // Check for new columns
      for (const [camelName, colBuilder] of Object.entries(tableDef.columns)) {
        const snakeName = toSnakeCase(camelName)
        const existingCol = existing.columns.find(c => c.name === snakeName)
        if (!existingCol) {
          operations.push({
            type: 'addColumn',
            sql: `ALTER TABLE ${tableDef.name} ADD COLUMN ${colBuilder.toSQL(snakeName)}`,
            tableName: tableDef.name,
          })
        }
      }
    }
  }

  // --- 4. Indexes (for existing tables that didn't get CREATE TABLE) ---
  for (const tableDef of allTables) {
    const existingTable = snapshot.tables.find(t => t.name === tableDef.name)
    if (!existingTable) continue // new table — indexes are in CREATE TABLE

    for (const idxDef of tableDef.indexes) {
      const idxCols = idxDef.columns.map(toSnakeCase)
      // Compare by column set — immune to name truncation
      const colSetMatch = existingTable.indexes.find(i => {
        if (i.columns.length !== idxCols.length) return false
        return idxCols.every((col, j) => col === i.columns[j])
      })
      if (!colSetMatch) {
        const idxName = generateIndexName(tableDef.name, idxCols)
        const uniqueStr = idxDef.isUnique ? 'UNIQUE ' : ''
        const methodStr = idxDef.method ? ` USING ${idxDef.method}` : ''
        let sql = `CREATE ${uniqueStr}INDEX ${idxName} ON ${tableDef.name}${methodStr} (${idxCols.join(', ')})`
        if (idxDef.condition) sql += ` WHERE ${idxDef.condition}`
        operations.push({ type: 'createIndex', sql })
      }
    }
  }

  // --- 5. Views ---
  for (const viewDef of definitions.views) {
    const existing = snapshot.views.find(v => v.name === viewDef.name)
    if (!existing) {
      operations.push({
        type: 'createView',
        sql: viewDef.toSQL(),
      })
    }
  }

  return { operations }
}

/** Collect all tables including auto-generated translation tables */
function collectTables(tables: readonly TableDef[]): TableDef[] {
  const result: TableDef[] = []
  for (const t of tables) {
    result.push(t)
    if (t.translationTable) {
      result.push(t.translationTable)
    }
  }
  return result
}
