// Metadata type definitions

import type { FieldKind, FilterOption, TableDef } from '../schema/definitions.js'

export interface FilterMeta {
  readonly type: 'text' | 'date' | 'select' | 'relation'
  readonly endpoint?: string
  readonly valueField?: string
  readonly labelField?: string
  readonly options?: readonly FilterOption[]
}

export interface FieldMeta {
  readonly key: string
  readonly kind: FieldKind
  readonly label: string | undefined
  readonly hidden: boolean
  readonly immutable: boolean
  readonly searchable: boolean
  readonly filterable: false | FilterMeta
  readonly inList: boolean
  readonly inForm: boolean
  readonly required: boolean
  readonly quick: boolean
}

export interface ViewMeta {
  readonly name: string
  readonly fields: readonly FieldMeta[]
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
