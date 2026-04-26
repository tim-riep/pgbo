// @metadataui/client — framework-agnostic HTTP client for the metadata-driven
// UI contract. Drop-in replacement for @pgbo/client (which is now deprecated).

export { createClient } from './client.js'
export type { MetadataUiClient } from './client.js'

export {
  MetadataUiClientError,
} from './types.js'
export type {
  ClientConfig, ListQuery, ActionOptions,
  // Re-exports from @metadataui/spec — single import path for apps
  PublicBoMeta, PublicFieldMeta, PublicFilterMeta, PublicValueHelpRef,
  FieldMeta, FilterMeta, ValueHelpRef, ValueHelpMeta, CompositionMeta, AssociationMeta,
  ViewMeta, BOMeta, FieldKind, FilterOption,
  ListParams, PaginatedResult,
  FileResponse, TranslationConfig, EnrichConfig,
} from './types.js'

// Re-export URL builders too — frontend codegen and link-builders use them.
export {
  urlForProjection, urlForDetail, urlForAction,
  urlForValueHelp, urlForMeta, urlForView, urlForViewMeta,
  buildQueryString,
} from '@metadataui/spec'
