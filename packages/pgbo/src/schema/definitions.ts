// Core type definitions for the schema DSL

export interface CheckExpr {
  readonly sql: string // Uses VALUE as placeholder, replaced with column name in toSQL
}

export interface ColumnDef {
  readonly pgType: string
  readonly isNullable: boolean
  readonly defaultValue: string | undefined
  readonly checks: readonly CheckExpr[]
  readonly isUnique: boolean
  readonly length: number | undefined
  readonly precision: number | undefined
  readonly scale: number | undefined
  readonly hasTimeZone: boolean
}

export interface ColumnBuilder<
  TsType = unknown,
  Nullable extends boolean = true,
  HasDefault extends boolean = false,
> {
  readonly _def: ColumnDef
  readonly _type: TsType
  readonly _nullable: Nullable
  readonly _hasDefault: HasDefault

  // Nullability & defaults
  notNull(): ColumnBuilder<TsType, false, HasDefault>
  nullable(): ColumnBuilder<TsType, true, HasDefault>
  default(value: TsType): ColumnBuilder<TsType, Nullable, true>
  defaultNow(): ColumnBuilder<TsType, Nullable, true>
  defaultRandom(): ColumnBuilder<TsType, Nullable, true>
  unique(): ColumnBuilder<TsType, Nullable, HasDefault>

  // Text constraints
  length(n: number): ColumnBuilder<TsType, Nullable, HasDefault>
  minLength(n: number): ColumnBuilder<TsType, Nullable, HasDefault>
  maxLength(n: number): ColumnBuilder<TsType, Nullable, HasDefault>
  pattern(regex: RegExp): ColumnBuilder<TsType, Nullable, HasDefault>

  // Numeric constraints
  min(n: number): ColumnBuilder<TsType, Nullable, HasDefault>
  max(n: number): ColumnBuilder<TsType, Nullable, HasDefault>
  between(a: number, b: number): ColumnBuilder<TsType, Nullable, HasDefault>
  positive(): ColumnBuilder<TsType, Nullable, HasDefault>

  // Type-specific
  precision(p: number, s?: number): ColumnBuilder<TsType, Nullable, HasDefault>
  withTimeZone(): ColumnBuilder<TsType, Nullable, HasDefault>

  // DDL
  toSQL(columnName: string): string
}

export type AnyColumnBuilder = ColumnBuilder<any, boolean, boolean>

// --- Foreign key ---

export interface ForeignKeyReference {
  readonly table: string
  readonly column: string
  readonly onDelete?: string
}

export interface ForeignKeyDef {
  readonly columns: readonly string[]
  readonly refTable: string
  readonly refColumns: readonly string[]
  readonly onDelete: string | undefined
  readonly onUpdate: string | undefined
}

export interface ForeignKeyBuilder {
  readonly columns: readonly string[]
  references(table: string, columns: readonly string[]): ForeignKeyBuilder
  onDelete(action: string): ForeignKeyBuilder
  onUpdate(action: string): ForeignKeyBuilder
  _build(): ForeignKeyDef
}

// --- Index ---

export interface IndexDef {
  readonly columns: readonly string[]
  readonly isUnique: boolean
  readonly condition: string | undefined
  readonly method: string | undefined
}

export interface IndexBuilder {
  readonly columns: readonly string[]
  readonly isUnique: boolean
  readonly condition: string | undefined
  readonly method: string | undefined
  unique(): IndexBuilder
  where(condition: string): IndexBuilder
  using(method: string): IndexBuilder
}

// --- Check constraint ---

export interface CheckConstraintDef {
  readonly column: string
  readonly sql: string
}

export interface CheckBuilder {
  readonly column: string
  readonly sql: string
  greaterThan(valueOrColumn: number | string): CheckBuilder
  greaterThanOrEqual(value: number): CheckBuilder
  lessThan(valueOrColumn: number | string): CheckBuilder
  lessThanOrEqual(value: number): CheckBuilder
}

// --- Table ---

export interface TableDef<C extends Record<string, AnyColumnBuilder> = Record<string, AnyColumnBuilder>> {
  readonly name: string
  readonly columns: C
  readonly primaryKey: readonly string[]
  readonly foreignKeys: readonly ForeignKeyDef[]
  readonly indexes: readonly IndexDef[]
  readonly checks: readonly CheckConstraintDef[]
  readonly translations?: readonly string[]
  readonly translationTable?: TableDef
  toSQL(): string
}

export interface TableInput {
  readonly columns: Record<string, AnyColumnBuilder>
  readonly primaryKey: readonly string[]
  readonly foreignKeys?: readonly ForeignKeyBuilder[]
  readonly indexes?: readonly IndexBuilder[]
  readonly checks?: readonly CheckBuilder[]
  readonly translations?: readonly string[]
  readonly domains?: Record<string, DomainDef>
}

// --- Field annotations ---

export type FieldKind = 'text' | 'number' | 'date' | 'boolean' | 'slug' | 'relation' | 'translation'

export interface FilterOption {
  readonly value: string
  readonly label: string
}

export interface FieldAnnotations {
  readonly label?: string
  readonly searchable?: boolean
  readonly filterable?: boolean
  readonly immutable?: boolean
  readonly hidden?: boolean
  readonly inList?: boolean
  readonly inForm?: boolean
  readonly valueHelp?: ValueHelpViewDef
  readonly required?: boolean
  readonly kind?: FieldKind
  readonly filterType?: 'text' | 'date' | 'select' | 'relation'
  readonly filterOptions?: readonly FilterOption[]
  readonly filterKey?: string
  readonly quick?: boolean
}

// --- Column reference ---

export interface JoinDef {
  readonly table: TableDef
  readonly on: Record<string, string>  // { localCol: foreignCol }
  readonly type: 'JOIN' | 'LEFT JOIN'
}

export interface ColumnRef<T = unknown, R extends string = string> {
  readonly ref: R
  readonly sourceTable?: TableDef
  readonly annotations: FieldAnnotations
  /** Phantom type carrying the inferred column TS type */
  readonly _colType?: T
  label(key: string): ColumnRef<T, R>
  searchable(): ColumnRef<T, R>
  filterable(): ColumnRef<T, R>
  immutable(): ColumnRef<T, R>
  hidden(): ColumnRef<T, R>
  inList(show: boolean): ColumnRef<T, R>
  inForm(show: boolean): ColumnRef<T, R>
  valueHelp(vh: ValueHelpViewDef): ColumnRef<T, R>
  required(): ColumnRef<T, R>
  kind(k: FieldKind): ColumnRef<T, R>
  filterType(t: 'text' | 'date' | 'select' | 'relation'): ColumnRef<T, R>
  filterOptions(opts: FilterOption[]): ColumnRef<T, R>
  filterKey(k: string): ColumnRef<T, R>
  quick(): ColumnRef<T, R>
}

// --- Subquery count reference ---

export interface SubqueryCountRef {
  readonly isSubqueryCount: true
  readonly childTable: TableDef
  readonly on: Record<string, string>  // { parentCol: childCol }
  readonly whereSQL?: string
  readonly annotations: FieldAnnotations
  label(key: string): SubqueryCountRef
  filterable(): SubqueryCountRef
  hidden(): SubqueryCountRef
  inList(show: boolean): SubqueryCountRef
  inForm(show: boolean): SubqueryCountRef
}

// --- Auth restriction ---

export interface Restriction {
  readonly grant: string       // 'READ' | 'WRITE' | 'DELETE' | custom
  readonly to: string          // role/fragment identifier (opaque to pgbo)
  readonly where?: Readonly<Record<string, string>>
}

// --- View row inference from columns map ---

/** Inline column type extraction — avoids import() in conditional types which TS may not resolve */
type InferColType<C> = C extends ColumnBuilder<infer T, infer N, any>
  ? N extends true ? T | null : T
  : unknown

/** Extract the TS type from a ColumnRef or TranslatedRef, with fallback to source table */
type InferColEntry<E, SourceCols extends Record<string, AnyColumnBuilder>> =
  E extends { isSubqueryCount: true } ? number :
  E extends { isTranslated: true } ? string | null :
  E extends ColumnRef<infer T, infer R>
    ? unknown extends T
      ? R extends keyof SourceCols
        ? InferColType<SourceCols[R]>
        : unknown
      : T
    : unknown

/** Force eager evaluation of mapped types for better IDE hover display */
type Simplify<T> = { [K in keyof T]: T[K] } & {}

/** Infer the row type from a columns map, resolving unqualified refs from source table */
type InferColumnsMap<M extends Record<string, any>, SourceCols extends Record<string, AnyColumnBuilder> = Record<string, AnyColumnBuilder>> =
  Simplify<{ [K in keyof M]: InferColEntry<M[K], SourceCols> }>

// --- Association ---

/**
 * Read-time navigation relation from this view/BO to another entity.
 * `target` is optional and identifies the referenced view/table for metadata + enrichment.
 */
/**
 * Structural shape of a BO that can act as an association target.
 * Defined here (rather than importing BusinessObjectDef from bo/) to avoid
 * a circular module dependency. The actual BO satisfies this shape.
 */
export interface AssociationTargetBO {
  readonly name: string
  readonly root: ViewDef | TableDef
  readonly paramField: string
  readonly compositions: Readonly<Record<string, unknown>>
}

export interface AssociationDef {
  readonly foreignKey: string
  readonly target?: ViewDef | TableDef | AssociationTargetBO
  /**
   * `'one'` (default) — FK points to a single target row.
   * `'many'` — reverse-FK, multiple target rows match one parent (deferred to a follow-up PR).
   */
  readonly cardinality?: 'one' | 'many'
  /**
   * With `cardinality: 'one'`, lift these target fields onto the parent.
   * Use `prefix` to avoid name collisions (e.g. `merge: ['name'], prefix: 'area'` → parent.areaName).
   */
  readonly merge?: readonly string[]
  /** Prefix applied to merged field names: `${prefix}${CapitalizedField}`. */
  readonly prefix?: string
  /** Attach the target as a nested object under this key. Mutually exclusive with `merge`. */
  readonly attach?: string
  /** Narrow the target fields kept in the attached object (used with `attach`). */
  readonly columns?: readonly string[]
  /** WHERE clause applied to the target query. Context placeholders allowed (`$locale`, etc.). */
  readonly where?: Record<string, unknown>
}

// --- View ---

export interface ViewDef<
  TRow extends Record<string, unknown> = Record<string, unknown>,
  SC extends Record<string, AnyColumnBuilder> = Record<string, AnyColumnBuilder>,
> {
  readonly name: string
  readonly source: TableDef
  readonly joins?: readonly JoinDef[]
  readonly selectedColumns?: Record<string, any>
  readonly whereClause?: string
  readonly restrictions?: readonly Restriction[]
  readonly isNoAuth?: boolean
  readonly viewAssociations?: Readonly<Record<string, AssociationDef>>
  /** Phantom type carrying the inferred row shape */
  readonly _rowType?: TRow
  from<C extends Record<string, AnyColumnBuilder>>(table: TableDef<C>): ViewDef<TRow, C>
  join(table: TableDef, on: Record<string, string>): ViewDef<TRow, SC>
  leftJoin(table: TableDef, on: Record<string, string>): ViewDef<TRow, SC>
  columns<M extends Record<string, any>>(cols: M): ViewDef<InferColumnsMap<M, SC>, SC>
  where(condition: string): ViewDef<TRow, SC>
  /** Declare an auth restriction on this view */
  restrict(r: Restriction): ViewDef<TRow, SC>
  /** Mark this view as requiring no auth (e.g. value helps) */
  noAuth(): ViewDef<TRow, SC>
  /** Declare read-time navigation relations. BOs built on this view inherit them. */
  associations(assocs: Record<string, AssociationDef>): ViewDef<TRow, SC>
  /** Brand the view with an explicit row type (escape hatch) */
  as<T extends Record<string, unknown>>(): ViewDef<T>
  toSQL(): string
}

// --- Value help view ---

export interface ValueHelpViewDef {
  readonly name: string
  readonly source?: TableDef
  readonly keyField?: string
  readonly displayField?: string
  from(table: TableDef): ValueHelpViewDef
  key(field: string): ValueHelpViewDef
  display(field: string): ValueHelpViewDef
  toSQL(): string
}

// --- Domain ---

export interface DomainDef {
  readonly name: string
  readonly baseType: AnyColumnBuilder
  readonly baseDomain: DomainDef | undefined
  readonly reference: ForeignKeyReference | undefined
  references(table: string, column: string, onDelete?: string): DomainDef
  toSQL(): string
}

// --- Enum ---

export interface EnumDef {
  readonly name: string
  readonly values: readonly string[]
  column(): AnyColumnBuilder
  toSQL(): string
}
