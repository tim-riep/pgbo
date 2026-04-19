// Schema DSL — tables, views, domains, enums
export { table } from './table.js'
export { view, valueHelpView } from './view.js'
export { domain } from './domain.js'
export { pgEnum } from './enum.js'
export { foreignKey, index, check } from './constraints.js'
export { configureI18n, translated, getI18nConfig, localeCode, isTranslatedRef, type TranslatedRef } from './i18n.js'
export { col } from './column.js'
export { subqueryCount, isSubqueryCountRef } from './subquery.js'

// Column type builders
export {
  text, integer, bigint, serial, bigserial,
  numeric, real, doublePrecision,
  boolean, uuid, timestamp, date, time, interval,
  jsonb, json, bytea, array,
  daterange, int4range, numrange, tsrange, tstzrange,
} from './types.js'

// Type inference utilities
export type { InferRow, InferInsert, InferUpdate, InferColumnType, InferViewRow } from './infer.js'
export type {
  TableDef, TableInput, ViewDef, DomainDef, EnumDef,
  ColumnBuilder, AnyColumnBuilder, ColumnDef, CheckExpr,
  ForeignKeyDef, ForeignKeyBuilder, IndexDef, IndexBuilder,
  CheckConstraintDef, CheckBuilder, ForeignKeyReference,
  FieldAnnotations, FieldKind, FilterOption, ColumnRef, JoinDef, ValueHelpViewDef, SubqueryCountRef, Restriction,
} from './definitions.js'
export { toSnakeCase } from './table.js'
