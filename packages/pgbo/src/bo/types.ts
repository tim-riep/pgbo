// Business Object type definitions — Phase 7 (Step 17)

import type { ViewDef, TableDef, AnyColumnBuilder, FieldKind, AssociationDef } from '../schema/definitions.js'

/**
 * Structural shape of a BO that can act as a link-composition target.
 * Defined here (rather than importing BusinessObjectDef recursively) so the
 * type is self-contained. The real BusinessObjectDef satisfies this shape.
 */
export interface BoTarget {
  readonly name: string
  readonly root: ViewDef | TableDef
  readonly paramField: string
  readonly compositions: Readonly<Record<string, unknown>>
}
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

/**
 * Many-to-many composition variant (issue #25).
 *
 * Parent rows reach target rows through a link table:
 * `parent → linkTable.linkParentKey = parent.paramField`
 * `→ target.paramField = linkTable.linkTargetKey`
 *
 * On read, `enrichCompositions` loads link rows, looks up targets, runs the
 * target BO's compositions (so translations resolve), and attaches them to
 * each parent under the composition name as an array.
 *
 * Write-through support (replace/add/remove semantics) is deferred to a
 * follow-up PR — for now link compositions are **read-only**.
 */
export interface LinkCompositionDef {
  /** Tag used at runtime to discriminate from the plain `CompositionDef` shape. */
  readonly linkTable: TableDef
  /** Column on the link table that matches the parent's paramField. */
  readonly linkParentKey: string
  /** Column on the link table that matches the target's paramField / primary key. */
  readonly linkTargetKey: string
  /** The target entity to resolve — view, table, or BO (BO → its compositions run). */
  readonly target: ViewDef | TableDef | BoTarget
  /** Narrow the target columns exposed on each parent element. */
  readonly columns?: readonly string[]
  /** Additional WHERE on the target query (context placeholders supported). */
  readonly where?: Record<string, unknown>
  /** Additional WHERE on the link table query. */
  readonly linkWhere?: Record<string, unknown>
}

/** Union of composition shapes used inside a BO's `compositions` record. */
export type AnyCompositionDef = CompositionDef | LinkCompositionDef

export function isLinkComposition(def: AnyCompositionDef): def is LinkCompositionDef {
  return 'linkTable' in def
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
  readonly compositions: Readonly<Record<string, AnyCompositionDef>>
  readonly associations: Readonly<Record<string, AssociationDef>>
  readonly valueHelps: Readonly<Record<string, ViewDef>>
  readonly isReadOnly: boolean
  readonly routePrefix?: string
  readonly orderBy?: string
  readonly orderDir?: 'asc' | 'desc'
  readonly cacheTags?: readonly string[]
  readonly virtualFields?: readonly VirtualFieldMeta[]
  readonly transformItems?: (rows: Record<string, unknown>[], locale: string, db: any) => Promise<Record<string, unknown>[]>
}

// --- Projection (HTTP surface definition, layered on top of a BO) ---

export interface ProjectionDef {
  /** Public name used for routes, metadata endpoint, and logs */
  readonly name: string
  /** The underlying BO — data model + write logic + schema */
  readonly bo: BusinessObjectDef
  /**
   * Explicit action whitelist. Only keys set to `true` are reachable via HTTP.
   * Standard keys: 'read' (GET list + detail), 'create', 'update', 'delete'.
   * Any custom action key from the BO can also be listed.
   */
  readonly actions: Readonly<Record<string, boolean>>
  /** Narrow the visible columns in responses and metadata. Undefined → all BO columns. */
  readonly columns?: readonly string[]
  /** Applied to every list / detail / update / delete query through this projection. */
  readonly where?: Record<string, unknown>
}

export interface ProjectionConfig {
  readonly name: string
  readonly actions: Record<string, boolean>
  readonly columns?: readonly string[]
  readonly where?: Record<string, unknown>
}

export interface BOConfig<C extends Record<string, AnyColumnBuilder> = Record<string, AnyColumnBuilder>> {
  name?: string
  paramField?: string & keyof C
  actions?: Record<string, ActionDef>
  compositions?: Record<string, AnyCompositionDef | ViewDef | TableDef>
  associations?: Record<string, AssociationDef>
  valueHelps?: Record<string, ViewDef>
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
