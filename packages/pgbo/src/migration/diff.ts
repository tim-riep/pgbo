// Schema diff algorithm — Phase 4 (Step 13)

import type { DatabaseSnapshot } from './introspect.js'
import type { TableDef, DomainDef, EnumDef, ViewDef, ColumnRef } from '../schema/definitions.js'
import type { BusinessObjectDef } from '../bo/types.js'
import { toSnakeCase, generateIndexName } from '../schema/table.js'
import { isTranslatedRef } from '../schema/i18n.js'
import { isSubqueryCountRef } from '../schema/subquery.js'

export interface MigrationOperation {
  readonly type:
    | 'createDomain'
    | 'createEnum'
    | 'alterEnum'
    | 'createTable'
    | 'addColumn'
    | 'createIndex'
    | 'dropView'
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
  /**
   * Business Objects registered with the schema. migrate() walks `bo.valueHelps`
   * for each BO, dedupes by name, and emits CREATE VIEW for each unique value help
   * that doesn't already exist in the database — so declaring a value help on a BO
   * is all the wiring needed (issue #31).
   */
  readonly bos?: readonly BusinessObjectDef[]
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

  // --- 5. Views (explicit + value-help views discovered via registered BOs, issue #31) ---
  // Value helps are just regular ViewDefs annotated with .vh() (issue #34), so we
  // union both sources and dedupe by name — users can put vh views in `views:` or
  // let them flow in via `bos:`, but never both (would be a duplicate CREATE VIEW).
  const seenViews = new Set<string>()
  const allViews: ViewDef[] = []
  for (const v of definitions.views) {
    if (!seenViews.has(v.name)) {
      seenViews.add(v.name)
      allViews.push(v)
    }
  }
  for (const vh of collectValueHelps(definitions.bos ?? [])) {
    if (!seenViews.has(vh.name)) {
      seenViews.add(vh.name)
      allViews.push(vh)
    }
  }
  // Detect column-set drift between schema-defined views and the live database.
  // When ANY managed view has changed columns we drop ALL managed views (CASCADE
  // handles dependent-view ordering) and re-create them all from the definitions
  // (issue #55). Postgres has no `CREATE OR REPLACE VIEW` that allows column-list
  // changes — only DROP + CREATE works for renaming/adding/removing columns.
  const liveViewNames = new Set(snapshot.views.map(v => v.name))
  let anyStale = false
  for (const viewDef of allViews) {
    if (!liveViewNames.has(viewDef.name)) continue
    const existing = snapshot.views.find(v => v.name === viewDef.name)
    if (!existing) continue
    // Snapshot fixtures from older callers may not populate `columns` —
    // treat that as "skip drift detection for this view" (matches old
    // additive-only behaviour rather than spuriously marking it stale).
    if (!existing.columns) continue
    const expected = expectedViewColumns(viewDef)
    if (!columnArraysEqual(expected, existing.columns)) {
      anyStale = true
      break
    }
  }

  if (anyStale) {
    // CASCADE drops dependent views too — managed views that depend on stale ones
    // get re-created from `allViews` below. Unmanaged views that depend on managed
    // ones are silently dropped — register them with the schema or expect to
    // recreate them out-of-band.
    for (const viewDef of allViews) {
      if (liveViewNames.has(viewDef.name)) {
        operations.push({
          type: 'dropView',
          sql: `DROP VIEW IF EXISTS ${viewDef.name} CASCADE`,
        })
      }
    }
    for (const viewDef of allViews) {
      operations.push({
        type: 'createView',
        sql: viewDef.toSQL(),
      })
    }
  } else {
    // No drift — only create views that don't exist yet.
    for (const viewDef of allViews) {
      if (!liveViewNames.has(viewDef.name)) {
        operations.push({
          type: 'createView',
          sql: viewDef.toSQL(),
        })
      }
    }
  }

  return { operations }
}

/** Strict equality on ordered string arrays — used for view column-set comparison. */
function columnArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** Compute the output column names a view would emit, mirroring the logic in
 * `view.ts`'s `toSQL()`. Used to detect column-set drift against the live schema. */
function expectedViewColumns(viewDef: ViewDef): string[] {
  const cols: string[] = []
  const selected = viewDef.selectedColumns

  if (selected) {
    for (const [outputName, entry] of Object.entries(selected)) {
      if (isTranslatedRef(entry)) {
        // toSQL emits `<translation_table>.<ref>` with no AS — column name is `ref`.
        cols.push(toSnakeCase(entry.ref))
      } else if (isSubqueryCountRef(entry)) {
        cols.push(toSnakeCase(outputName))
      } else {
        const colRef = entry as ColumnRef
        // toSQL: with sourceTable → `... AS <outputName>`; without → just the ref.
        cols.push(toSnakeCase(colRef.sourceTable ? outputName : colRef.ref))
      }
    }
  } else {
    // No `.columns()` → all source-table columns.
    for (const colName of Object.keys(viewDef.source.columns)) {
      cols.push(toSnakeCase(colName))
    }
  }

  // `.translatedJoin()` appends each field as a top-level column.
  if (viewDef.translatedJoinSpec) {
    for (const field of viewDef.translatedJoinSpec.fields) {
      cols.push(toSnakeCase(field))
    }
  }

  return cols
}

/** Walk BOs, collect unique value-help views by name. Multiple BOs can share a value
 * help (e.g. both `warehouseProduct` and `stockJournal` reuse `warehouseValueHelp`) — we
 * emit CREATE VIEW only once per name. First occurrence wins. */
function collectValueHelps(bos: readonly BusinessObjectDef[]): ViewDef[] {
  const seen = new Map<string, ViewDef>()
  for (const bo of bos) {
    for (const vh of Object.values(bo.valueHelps)) {
      if (!seen.has(vh.name)) seen.set(vh.name, vh)
    }
  }
  return [...seen.values()]
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
