// @metadataui/spec — the metadata-driven UI contract.
//
// Pure types + URL builders. Any HTTP server can implement this contract;
// any frontend can consume it. `@pgbo/core` + `@pgbo/fastify` are one such
// implementation.

export type {
  // Field metadata
  FieldKind, FilterOption, FilterMeta, ValueHelpRef, FieldMeta, VisibleWhen,
  // Aggregate metadata
  AssociationMeta, CompositionMeta, ValueHelpMeta, ViewMeta, BOMeta,
  // Public (post-transform) shapes
  PublicFilterMeta, PublicValueHelpRef, PublicFieldMeta, PublicBoMeta,
  // List query contract
  ListParams, PaginatedResult,
  // Custom action returns
  FileResponse,
  // Translation enrichment
  TranslationConfig, EnrichConfig,
  // Composite key (issue #51)
  CompositeKey,
} from './types.js'

export {
  urlForProjection, urlForDetail, urlForAction, urlForValueHelp,
  urlForMeta, urlForView, urlForViewMeta, buildQueryString,
  // Composite-key URL helpers (issue #51)
  formatCompositeKey, parseCompositeKey,
} from './urls.js'
