// Metadata type definitions.
//
// Wire-protocol shapes live in `@metadataui/spec` so they can be shared with
// any client (browser, codegen, third-party backend implementations). This
// file re-exports them under their existing names + adds the pgbo-specific
// `TranslationConfig` that uses `TableDef`.

import type { TableDef } from '../schema/definitions.js'

export type {
  FilterMeta,
  ValueHelpRef,
  FieldMeta,
  AssociationMeta,
  ViewMeta,
  CompositionMeta,
  ValueHelpMeta,
  BOMeta,
  EnrichConfig,
  // Re-export FieldKind + FilterOption too so consumers don't need a second import path
  FieldKind,
  FilterOption,
} from '@metadataui/spec'

/** pgbo-specific — uses the server-only `TableDef` for the translation table. */
export interface TranslationConfig {
  readonly table: TableDef
  readonly parentKey: string
  readonly fields: readonly string[]
}
