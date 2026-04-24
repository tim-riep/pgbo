// View builder — Phase 3 (Step 11) + i18n + JOIN support + typed columns

import type { TableDef, ViewDef, ValueHelpViewDef, ColumnRef, JoinDef, SubqueryCountRef, Restriction, AssociationDef, TranslatedJoinSpec } from './definitions.js'
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
  translatedJoinSpec?: TranslatedJoinSpec,
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
    translatedJoinSpec,

    from(table: TableDef) {
      return createViewDef(name, table, joins, selectedColumns, whereClause, restrictions, isNoAuth, viewAssociations, translatedJoinSpec)
    },

    join(table: TableDef, on: Record<string, string>) {
      const newJoin: JoinDef = { table, on, type: 'JOIN' }
      return createViewDef(name, source, [...(joins ?? []), newJoin], selectedColumns, whereClause, restrictions, isNoAuth, viewAssociations, translatedJoinSpec)
    },

    leftJoin(table: TableDef, on: Record<string, string>) {
      const newJoin: JoinDef = { table, on, type: 'LEFT JOIN' }
      return createViewDef(name, source, [...(joins ?? []), newJoin], selectedColumns, whereClause, restrictions, isNoAuth, viewAssociations, translatedJoinSpec)
    },

    columns(cols: Record<string, ColumnEntry>) {
      if (translatedJoinSpec) {
        throw new Error(
          `View "${name}": .columns() cannot be combined with .translatedJoin() — use one or the other. ` +
          `.translatedJoin() already sets the output column list (source columns + translated fields).`,
        )
      }
      return createViewDef(name, source, joins, cols, whereClause, restrictions, isNoAuth, viewAssociations, translatedJoinSpec)
    },

    where(condition: string) {
      return createViewDef(name, source, joins, selectedColumns, condition, restrictions, isNoAuth, viewAssociations, translatedJoinSpec)
    },

    restrict(r: Restriction) {
      return createViewDef(name, source, joins, selectedColumns, whereClause, [...(restrictions ?? []), r], isNoAuth, viewAssociations, translatedJoinSpec)
    },

    noAuth() {
      return createViewDef(name, source, joins, selectedColumns, whereClause, restrictions, true, viewAssociations, translatedJoinSpec)
    },

    associations(assocs: Record<string, AssociationDef>) {
      return createViewDef(name, source, joins, selectedColumns, whereClause, restrictions, isNoAuth, { ...viewAssociations, ...assocs }, translatedJoinSpec)
    },

    translatedJoin(translationTable: TableDef, spec: Omit<TranslatedJoinSpec, 'translationTable'>) {
      if (selectedColumns) {
        throw new Error(
          `View "${name}": .translatedJoin() cannot be combined with .columns() — use one or the other.`,
        )
      }
      const fullSpec: TranslatedJoinSpec = { translationTable, ...spec }
      return createViewDef(name, source, joins, selectedColumns, whereClause, restrictions, isNoAuth, viewAssociations, fullSpec)
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

      // .translatedJoin() — append COALESCE'd translated columns
      if (translatedJoinSpec) {
        const tReq = 't_req'
        const tFb = 't_fb'
        for (const field of translatedJoinSpec.fields) {
          const snakeField = toSnakeCase(field)
          if (translatedJoinSpec.fallbackLocale) {
            colParts.push(`COALESCE(${tReq}.${snakeField}, ${tFb}.${snakeField}) AS ${snakeField}`)
          } else {
            colParts.push(`${tReq}.${snakeField} AS ${snakeField}`)
          }
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

      // .translatedJoin() — emit the LEFT JOINs
      if (translatedJoinSpec) {
        const parentPK = src.primaryKey[0]
        if (!parentPK) {
          throw new Error(`View "${name}": .translatedJoin() requires the source table "${tableName}" to have a primary key`)
        }
        const snakePK = toSnakeCase(parentPK)
        const tt = translatedJoinSpec.translationTable.name
        const snakeParentKey = toSnakeCase(translatedJoinSpec.parentKey)
        const snakeLocaleCol = toSnakeCase(translatedJoinSpec.localeColumn)

        sql += ` LEFT JOIN ${tt} t_req`
          + ` ON t_req.${snakeParentKey} = ${tableName}.${snakePK}`
          + ` AND t_req.${snakeLocaleCol} = current_setting('${translatedJoinSpec.localeParam}', true)`

        if (translatedJoinSpec.fallbackLocale) {
          const fb = translatedJoinSpec.fallbackLocale.replace(/'/g, "''")
          sql += ` LEFT JOIN ${tt} t_fb`
            + ` ON t_fb.${snakeParentKey} = ${tableName}.${snakePK}`
            + ` AND t_fb.${snakeLocaleCol} = '${fb}'`
        }
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
