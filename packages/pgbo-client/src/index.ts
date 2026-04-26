// @pgbo/client is DEPRECATED — renamed to @metadataui/client (issue #52).
//
// This shim re-exports the new package's surface verbatim and aliases the
// renamed error class so existing apps keep working during one deprecation
// cycle. Migrate to `@metadataui/client` for the next major; the next
// release of this package will be removed.

export { createClient } from '@metadataui/client'
export type { MetadataUiClient as PgboClient } from '@metadataui/client'

export { MetadataUiClientError as PgboClientError } from '@metadataui/client'

export type {
  ClientConfig, ListQuery, ActionOptions,
  PublicBoMeta, PublicFieldMeta, PublicFilterMeta, PublicValueHelpRef,
  FieldMeta, FilterMeta, ValueHelpRef, ValueHelpMeta, CompositionMeta, AssociationMeta,
  ViewMeta, BOMeta, FieldKind, FilterOption,
  ListParams, PaginatedResult,
  FileResponse, TranslationConfig, EnrichConfig,
} from '@metadataui/client'

export {
  urlForProjection, urlForDetail, urlForAction,
  urlForValueHelp, urlForMeta, urlForView, urlForViewMeta,
  buildQueryString,
} from '@metadataui/client'

// Print a one-time warning so apps still on the old import path notice the rename.
// Kept lightweight — just a console.warn at module load.
if (typeof globalThis !== 'undefined' && typeof globalThis.console !== 'undefined') {
  globalThis.console.warn(
    '[@pgbo/client] DEPRECATED — rename to `@metadataui/client`. ' +
    '`PgboClientError` is now `MetadataUiClientError`. ' +
    'This package will be removed in the next major.',
  )
}
