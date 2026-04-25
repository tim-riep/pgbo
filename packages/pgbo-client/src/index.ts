// Public surface of @pgbo/client.
//
// Apps interact with pgbo over HTTP through `createClient(config)` and use the
// re-exported types from `@pgbo/core` for typing — no need to import the
// server-only `@pgbo/core` directly from frontend code.

export { createClient } from './client.js'
export type { PgboClient } from './client.js'

export {
  urlForProjection, urlForDetail, urlForAction,
  urlForValueHelp, urlForMeta, urlForView, urlForViewMeta,
  buildQueryString,
} from './urls.js'

export {
  PgboClientError,
} from './types.js'
export type {
  ClientConfig, ListQuery, ActionOptions,
  PublicBoMeta, PublicFieldMeta, PublicFilterMeta, PublicValueHelpRef,
  // Re-exports from @pgbo/core
  FieldMeta, FilterMeta, ValueHelpRef, ValueHelpMeta, CompositionMeta, AssociationMeta,
  ViewMeta, BOMeta, FieldKind, FilterOption,
  ListParams, PaginatedResult,
} from './types.js'
