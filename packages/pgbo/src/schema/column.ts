// Column reference helper for view select — Phase 3

import type { ColumnRef, FieldAnnotations, FieldKind, FilterOption, ViewDef, TableDef, AnyColumnBuilder, VisibleWhen } from './definitions.js'
import type { InferColumnType } from './infer.js'

class ColumnRefImpl<T = unknown, R extends string = string> implements ColumnRef<T, R> {
  readonly ref: R
  readonly sourceTable?: TableDef
  readonly annotations: FieldAnnotations
  declare readonly _colType?: T

  constructor(ref: R, sourceTable?: TableDef, annotations: FieldAnnotations = {}) {
    this.ref = ref
    this.sourceTable = sourceTable
    this.annotations = annotations
  }

  private withAnnotation(patch: Partial<FieldAnnotations>): ColumnRef<T, R> {
    return new ColumnRefImpl<T, R>(this.ref, this.sourceTable, { ...this.annotations, ...patch })
  }

  label(key: string): ColumnRef<T, R> { return this.withAnnotation({ label: key }) }
  searchable(): ColumnRef<T, R> { return this.withAnnotation({ searchable: true }) }
  filterable(): ColumnRef<T, R> { return this.withAnnotation({ filterable: true }) }
  immutable(): ColumnRef<T, R> { return this.withAnnotation({ immutable: true }) }
  hidden(): ColumnRef<T, R> { return this.withAnnotation({ hidden: true }) }
  inList(show: boolean): ColumnRef<T, R> { return this.withAnnotation({ inList: show }) }
  inForm(show: boolean): ColumnRef<T, R> { return this.withAnnotation({ inForm: show }) }
  valueHelp(vh: ViewDef): ColumnRef<T, R> {
    if (!vh.vhAnnotation) {
      throw new Error(
        `.valueHelp() received view "${vh.name}" that is not annotated with .vh({ key, display }). ` +
        `Mark the view as a value help with .vh({ key, display }) first.`,
      )
    }
    return this.withAnnotation({ valueHelp: vh })
  }
  required(): ColumnRef<T, R> { return this.withAnnotation({ required: true }) }
  kind(k: FieldKind): ColumnRef<T, R> { return this.withAnnotation({ kind: k }) }
  filterType(t: 'text' | 'date' | 'select' | 'relation'): ColumnRef<T, R> { return this.withAnnotation({ filterType: t }) }
  filterOptions(opts: FilterOption[]): ColumnRef<T, R> { return this.withAnnotation({ filterOptions: opts }) }
  filterKey(k: string): ColumnRef<T, R> { return this.withAnnotation({ filterKey: k }) }
  quick(): ColumnRef<T, R> { return this.withAnnotation({ quick: true }) }
  visibleWhen(predicate: VisibleWhen): ColumnRef<T, R> {
    if (Object.keys(predicate).length === 0) {
      throw new Error(
        '.visibleWhen() requires at least one key/value pair. ' +
        'Pass a non-empty object like { kind: \'esm_upload\' } or omit the call entirely.',
      )
    }
    return this.withAnnotation({ visibleWhen: predicate })
  }
}

/**
 * Create a column reference.
 * - `col('name')` — unresolved type, inferred from view's source table
 * - `col('slug', appTable)` — type inferred from appTable.columns.slug
 */
export function col<
  C extends Record<string, AnyColumnBuilder>,
  K extends string & keyof C,
>(ref: K, sourceTable: TableDef<C>): ColumnRef<InferColumnType<C[K]>, K>
export function col<R extends string>(ref: R): ColumnRef<unknown, R>
export function col(ref: string, sourceTable?: TableDef): ColumnRef {
  return new ColumnRefImpl(ref, sourceTable)
}
