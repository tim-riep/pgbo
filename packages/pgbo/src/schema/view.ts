// View builder — Phase 3 (Step 11) + i18n + JOIN support + typed columns

import type { TableDef, ViewDef, ValueHelpViewDef, ColumnRef, JoinDef, SubqueryCountRef, Restriction, AssociationDef } from './definitions.js'
import type { TranslatedRef } from './i18n.js'
import { isTranslatedRef } from './i18n.js'
import { isSubqueryCountRef } from './subquery.js'
import { toSnakeCase } from './table.js'

type ColumnEntry = ColumnRef | TranslatedRef | SubqueryCountRef

function requireSource(source: TableDef | undefined, viewName: string): TableDef {
  if (!source) throw new Error(`View "${viewName}" has no source — call .from(table) before using this view`)
  return source
}

function createViewDef(
  name: string,
  source?: TableDef,
  joins?: readonly JoinDef[],
  selectedColumns?: Record<string, ColumnEntry>,
  whereClause?: string,
  restrictions?: readonly Restriction[],
  isNoAuth?: boolean,
  viewAssociations?: Readonly<Record<string, AssociationDef>>,
): ViewDef<any, any> {
  const self: ViewDef = {
    name,
    get source(): TableDef { return requireSource(source, name) },
    joins,
    selectedColumns,
    whereClause,
    restrictions,
    isNoAuth,
    viewAssociations,

    from(table: TableDef) {
      return createViewDef(name, table, joins, selectedColumns, whereClause, restrictions, isNoAuth, viewAssociations)
    },

    join(table: TableDef, on: Record<string, string>) {
      const newJoin: JoinDef = { table, on, type: 'JOIN' }
      return createViewDef(name, source, [...(joins ?? []), newJoin], selectedColumns, whereClause, restrictions, isNoAuth, viewAssociations)
    },

    leftJoin(table: TableDef, on: Record<string, string>) {
      const newJoin: JoinDef = { table, on, type: 'LEFT JOIN' }
      return createViewDef(name, source, [...(joins ?? []), newJoin], selectedColumns, whereClause, restrictions, isNoAuth, viewAssociations)
    },

    columns(cols: Record<string, ColumnEntry>) {
      return createViewDef(name, source, joins, cols, whereClause, restrictions, isNoAuth, viewAssociations)
    },

    where(condition: string) {
      return createViewDef(name, source, joins, selectedColumns, condition, restrictions, isNoAuth, viewAssociations)
    },

    restrict(r: Restriction) {
      return createViewDef(name, source, joins, selectedColumns, whereClause, [...(restrictions ?? []), r], isNoAuth, viewAssociations)
    },

    noAuth() {
      return createViewDef(name, source, joins, selectedColumns, whereClause, restrictions, true, viewAssociations)
    },

    associations(assocs: Record<string, AssociationDef>) {
      return createViewDef(name, source, joins, selectedColumns, whereClause, restrictions, isNoAuth, { ...viewAssociations, ...assocs })
    },

    as<T extends Record<string, unknown>>() {
      return self as unknown as ViewDef<T>
    },

    toSQL(): string {
      const src = requireSource(source, name)
      const tableName = src.name
      const translationTableName = `${tableName}_translation`
      const hasTranslations = src.translations && src.translations.length > 0

      let hasTranslatedCols = false
      const colParts: string[] = []

      if (selectedColumns) {
        for (const [outputName, entry] of Object.entries(selectedColumns)) {
          if (isTranslatedRef(entry)) {
            hasTranslatedCols = true
            colParts.push(`${translationTableName}.${toSnakeCase(entry.ref)}`)
          } else if (isSubqueryCountRef(entry)) {
            const childName = entry.childTable.name
            const joinClauses = Object.entries(entry.on)
              .map(([parentCol, childCol]) => `${childName}.${toSnakeCase(childCol)} = ${tableName}.${toSnakeCase(parentCol)}`)
              .join(' AND ')
            const where = entry.whereSQL ? ` AND (${entry.whereSQL})` : ''
            const snakeOutput = toSnakeCase(outputName)
            colParts.push(`(SELECT COUNT(*) FROM ${childName} WHERE ${joinClauses}${where})::integer AS ${snakeOutput}`)
          } else {
            const colRef = entry as ColumnRef
            const sourceTableName = colRef.sourceTable ? colRef.sourceTable.name : tableName
            const snakeRef = toSnakeCase(colRef.ref)
            const snakeOutput = toSnakeCase(outputName)

            if (colRef.sourceTable) {
              colParts.push(`${sourceTableName}.${snakeRef} AS ${snakeOutput}`)
            } else {
              colParts.push(`${sourceTableName}.${snakeRef}`)
            }
          }
        }
      } else {
        for (const colName of Object.keys(src.columns)) {
          colParts.push(`${tableName}.${toSnakeCase(colName)}`)
        }
      }

      let sql = `CREATE VIEW ${name} AS SELECT ${colParts.join(', ')} FROM ${tableName}`

      if (joins && joins.length > 0) {
        for (const joinDef of joins) {
          const joinTable = joinDef.table.name
          const onClauses = Object.entries(joinDef.on)
            .map(([localCol, foreignCol]) => `${tableName}.${toSnakeCase(localCol)} = ${joinTable}.${toSnakeCase(foreignCol)}`)
            .join(' AND ')
          sql += ` ${joinDef.type} ${joinTable} ON ${onClauses}`
        }
      }

      if (hasTranslatedCols && hasTranslations) {
        const pkCols = src.primaryKey.map(toSnakeCase)
        const joinConditions = pkCols
          .map(pk => `${tableName}.${pk} = ${translationTableName}.${pk}`)
          .join(' AND ')
        sql += ` LEFT JOIN ${translationTableName} ON ${joinConditions}`
      }

      if (whereClause) {
        sql += ` WHERE ${whereClause}`
      }

      return sql
    },
  }

  return self
}

export function view(name: string): ViewDef<any, any> {
  return createViewDef(name)
}

export function valueHelpView(name: string): ValueHelpViewDef {
  const self: ValueHelpViewDef = {
    name,
    source: undefined,
    keyField: undefined,
    displayField: undefined,

    from(table: TableDef) {
      return createValueHelpViewDef(name, table, self.keyField, self.displayField)
    },
    key(field: string) {
      return createValueHelpViewDef(name, self.source, field, self.displayField)
    },
    display(field: string) {
      return createValueHelpViewDef(name, self.source, self.keyField, field)
    },
    toSQL() {
      const src = self.source
      if (!src) throw new Error(`Value help view "${name}" has no source — call .from(table) first`)
      const cols = [self.keyField, self.displayField]
        .filter((f): f is string => Boolean(f))
        .map(f => toSnakeCase(f))
        .join(', ')
      return `CREATE VIEW ${name} AS SELECT ${cols} FROM ${src.name}`
    },
  }
  return self
}

function createValueHelpViewDef(
  name: string,
  source?: TableDef,
  keyField?: string,
  displayField?: string,
): ValueHelpViewDef {
  return {
    name,
    source,
    keyField,
    displayField,
    from(table: TableDef) {
      return createValueHelpViewDef(name, table, keyField, displayField)
    },
    key(field: string) {
      return createValueHelpViewDef(name, source, field, displayField)
    },
    display(field: string) {
      return createValueHelpViewDef(name, source, keyField, field)
    },
    toSQL() {
      if (!source) throw new Error(`Value help view "${name}" has no source — call .from(table) first`)
      const cols = [keyField, displayField]
        .filter((f): f is string => Boolean(f))
        .map(f => toSnakeCase(f))
        .join(', ')
      return `CREATE VIEW ${name} AS SELECT ${cols} FROM ${source.name}`
    },
  }
}
