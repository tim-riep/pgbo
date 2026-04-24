// Business Object type definitions — Phase 7 (Step 17)

import type { ViewDef, ValueHelpViewDef, TableDef, AnyColumnBuilder, FieldKind, AssociationDef } from '../schema/definitions.js'
import type { InferRow, InferInsert, InferUpdate } from '../schema/infer.js'

export type ActionContext = Record<string, unknown>;

export interface ActionDef<TData = any> {
  permission?: (ctx: ActionContext) => boolean | string | Promise<boolean | string>
  before?: (ctx: ActionContext, data: TData) => void | string | Promise<void | string>
  after?: (ctx: ActionContext, result: TData) => void | Promise<void>
  handler?: (ctx: ActionContext, existing: TData) => unknown
}

export interface CompositionDef {
  readonly view?: ViewDef
  readonly table?: TableDef
  readonly parentKey: string
  readonly children?: Readonly<Record<string, CompositionDef>>
  /**
   * `'many'` (default) — return all matching children as an array.
   * `'one'` — return a single object or `null`, filtered via `where`.
   */
  readonly cardinality?: 'many' | 'one'
  /**
   * Optional WHERE clause applied to the composition query. Values may be
   * literal or context placeholders: `$locale` / `$userId` / `$tenantId` / `$now`.
   */
  readonly where?: Record<string, unknown>
  /**
   * With `cardinality: 'one'`, lifts these fields from the matched child onto
   * the parent instead of attaching the child as a nested object.
   * Commonly used for translations: `merge: ['name', 'description']`.
   */
  readonly merge?: readonly string[]
}

export interface VirtualFieldMeta {
  readonly key: string
  readonly kind: FieldKind
  readonly label?: string
  readonly searchable?: boolean
  readonly filterable?: boolean
  readonly inList?: boolean
  readonly inForm?: boolean
}

export interface BusinessObjectDef {
  readonly name: string
  readonly root: ViewDef | TableDef
  readonly paramField: string
  readonly actions: Readonly<Record<string, ActionDef>>
  readonly compositions: Readonly<Record<string, CompositionDef>>
  readonly associations: Readonly<Record<string, AssociationDef>>
  readonly valueHelps: Readonly<Record<string, ValueHelpViewDef>>
  readonly isReadOnly: boolean
  readonly routePrefix?: string
  readonly orderBy?: string
  readonly orderDir?: 'asc' | 'desc'
  readonly cacheTags?: readonly string[]
  readonly virtualFields?: readonly VirtualFieldMeta[]
  readonly transformItems?: (rows: Record<string, unknown>[], locale: string, db: any) => Promise<Record<string, unknown>[]>
}

export interface BOConfig<C extends Record<string, AnyColumnBuilder> = Record<string, AnyColumnBuilder>> {
  name?: string
  paramField?: string & keyof C
  actions?: Record<string, ActionDef>
  compositions?: Record<string, CompositionDef | ViewDef | TableDef>
  associations?: Record<string, AssociationDef>
  valueHelps?: Record<string, ValueHelpViewDef>
  routePrefix?: string
  orderBy?: string
  orderDir?: 'asc' | 'desc'
  cacheTags?: string[]
  virtualFields?: VirtualFieldMeta[]
  transformItems?: (rows: Record<string, unknown>[], locale: string, db: any) => Promise<Record<string, unknown>[]>
}

/** Typed BO instance — all methods are type-safe based on the root table's columns */
export interface TypedBusinessObject<
  C extends Record<string, AnyColumnBuilder>,
  P extends string & keyof C,
> extends BusinessObjectDef {
  create(db: import('../query/client.js').Database, ctx: ActionContext, data: InferInsert<{ columns: C }> & Record<string, unknown>): Promise<InferRow<{ columns: C }>>
  update(db: import('../query/client.js').Database, ctx: ActionContext, data: Pick<InferRow<{ columns: C }>, P> & InferUpdate<{ columns: C }>): Promise<InferRow<{ columns: C }>>
  delete(db: import('../query/client.js').Database, ctx: ActionContext, data: Pick<InferRow<{ columns: C }>, P>): Promise<InferRow<{ columns: C }>>
  execute(db: import('../query/client.js').Database, actionName: string, ctx: ActionContext, data: Record<string, unknown>): Promise<unknown>
}
