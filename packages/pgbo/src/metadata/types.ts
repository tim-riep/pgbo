// Metadata type definitions

import type { FieldKind, FilterOption, TableDef } from '../schema/definitions.js'

export interface FilterMeta {
  readonly type: 'text' | 'date' | 'select' | 'relation'
  readonly endpoint?: string
  readonly valueField?: string
  readonly labelField?: string
  readonly options?: readonly FilterOption[]
}

/**
 * Reference from a field to a value-help endpoint (issue #35). Set when a column
 * is annotated with `.valueHelp(vhView)` and the surrounding BO registers that
 * view in `valueHelps`. Lets metadata-driven forms render the field as a dropdown
 * without per-app wiring.
 */
export interface ValueHelpRef {
  /**
   * Key under `bo.valueHelps` — the URL segment Fastify uses for the route.
   * Same value is used for the metadata's top-level `valueHelps[].name`.
   */
  readonly name: string
  /** Column on the value-help view that holds the identifier (`.vh({ key })`). */
  readonly keyField: string
  /** Column on the value-help view that holds the human-readable label (`.vh({ display })`). */
  readonly displayField: string
  /**
   * Full HTTP path. Populated by `@pgbo/fastify`'s projection-aware transform
   * (`/bo/{projection.name}/valueHelp/{name}`); undefined when reading the raw
   * `boMeta()` output without projection context.
   */
  readonly endpoint?: string
}

export interface FieldMeta {
  readonly key: string
  readonly kind: FieldKind
  readonly label: string | undefined
  readonly hidden: boolean
  readonly immutable: boolean
  readonly searchable: boolean
  readonly filterable: false | FilterMeta
  readonly valueHelp?: ValueHelpRef
  readonly inList: boolean
  readonly inForm: boolean
  readonly required: boolean
  readonly quick: boolean
}

export interface AssociationMeta {
  readonly name: string
  readonly foreignKey: string
  readonly target?: string
}

export interface ViewMeta {
  readonly name: string
  readonly fields: readonly FieldMeta[]
  readonly associations: readonly AssociationMeta[]
}

export interface CompositionMeta {
  readonly name: string
  readonly fields: readonly string[]
}

export interface ValueHelpMeta {
  readonly name: string
  readonly fields: readonly FieldMeta[]
}

export interface BOMeta extends ViewMeta {
  readonly paramField: string
  readonly readOnly: boolean
  readonly compositions: readonly CompositionMeta[]
  readonly valueHelps: readonly ValueHelpMeta[]
  readonly routePrefix?: string
  readonly orderBy?: string
  readonly orderDir?: 'asc' | 'desc'
  readonly cacheTags?: readonly string[]
}

export interface TranslationConfig {
  readonly table: TableDef
  readonly parentKey: string
  readonly fields: readonly string[]
}

export interface EnrichConfig {
  readonly translationTable: string
  readonly parentKey: string
  readonly idField: string
  readonly fields: readonly string[]
  readonly locale: string
  readonly fallbackLocale?: string
}
