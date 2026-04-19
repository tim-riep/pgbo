// Type inference utilities — Phase 1f

import type { ColumnBuilder } from './definitions.js'

/** Extract the TS type from a column builder, adding | null if nullable */
export type InferColumnType<C> = C extends ColumnBuilder<infer T, infer N, any>
  ? N extends true ? T | null : T
  : unknown

/** Keys that are required for INSERT (not nullable AND no default) */
type RequiredInsertKeys<C> = {
  [K in keyof C]: C[K] extends ColumnBuilder<any, false, false> ? K : never
}[keyof C]

/** Keys that are optional for INSERT (nullable OR has default) */
type OptionalInsertKeys<C> = Exclude<keyof C, RequiredInsertKeys<C>>

/** Infer the row type from a table or view definition */
export type InferRow<T> = T extends { columns: infer C }
  ? { [K in keyof C]: InferColumnType<C[K]> }
  : never

/** Infer the insert type (required + optional columns) */
export type InferInsert<T> = T extends { columns: infer C }
  ? { [K in RequiredInsertKeys<C>]: InferColumnType<C[K]> }
    & { [K in OptionalInsertKeys<C>]?: InferColumnType<C[K]> }
  : never

/** Infer the update type (all columns optional) */
export type InferUpdate<T> = T extends { columns: infer C }
  ? Partial<{ [K in keyof C]: InferColumnType<C[K]> }>
  : never

/** Infer the row type from a ViewDef — uses TRow if branded via .columns()/.as(), else falls back to source table */
export type InferViewRow<V> =
  V extends { _rowType?: infer R }
    ? IsDefaultRowType<R> extends true
      ? InferRow<V extends { source: infer S } ? S : never>
      : R
    : InferRow<V extends { source: infer S } ? S : never>

/** Check if R is the default Record<string, unknown> (unbranded view) */
type IsDefaultRowType<R> =
  string extends keyof R ? true : // Record<string, unknown> has keyof = string
  [keyof R] extends [never] ? true : // {} has keyof = never
  false
