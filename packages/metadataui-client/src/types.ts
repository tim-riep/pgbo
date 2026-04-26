// Client-only types. The wire-protocol types (FieldMeta, BOMeta, etc.) come
// from `@metadataui/spec` — re-exported here so apps have a single import path.

export type {
  // Field metadata
  FieldKind, FilterOption, FilterMeta, ValueHelpRef, FieldMeta,
  // Aggregate metadata
  AssociationMeta, CompositionMeta, ValueHelpMeta, ViewMeta, BOMeta,
  // Public response shapes
  PublicFilterMeta, PublicValueHelpRef, PublicFieldMeta, PublicBoMeta,
  // List query contract
  ListParams, PaginatedResult,
  // Custom action returns
  FileResponse,
  // Translation enrichment
  TranslationConfig, EnrichConfig,
} from '@metadataui/spec'

/** Query options for `client.list` / `client.valueHelp` / view routes. */
export interface ListQuery {
  readonly page?: number
  readonly limit?: number
  readonly search?: string
  readonly sort?: string
  readonly order?: 'asc' | 'desc'
  /** `?filter.<col>=value` — per-column filter convention. */
  readonly filters?: Readonly<Record<string, string | number | boolean>>
  readonly locale?: string
  /** Comma-joined into `?fields=a,b,c`. */
  readonly fields?: readonly string[]
}

/** Configuration passed to `createClient`. */
export interface ClientConfig {
  /** API root, e.g. `'http://localhost:3000'`. Trailing slash is fine. */
  readonly baseUrl: string
  /** Override the global `fetch` (for testing, custom timeouts, etc.). */
  readonly fetch?: typeof globalThis.fetch
  /** Resolves the current locale on every request — appended as `?locale=...`. */
  readonly locale?: () => string
  /** Returns a value for the `Authorization` header on every request. */
  readonly getAuthHeader?: () => string | null | undefined | Promise<string | null | undefined>
  /**
   * Called once on a 401 response to refresh tokens, then the request retries.
   * Return the new `Authorization` header value to use on the retry.
   */
  readonly refreshAuth?: () => Promise<string | null | undefined>
  /** Extra headers attached to every request (e.g. `'X-Tenant-Id'`). */
  readonly headers?: () => Record<string, string> | Promise<Record<string, string>>
}

/** Raised on non-2xx responses. */
export class MetadataUiClientError extends Error {
  readonly status: number
  readonly url: string
  readonly body: unknown

  constructor(message: string, status: number, url: string, body: unknown) {
    super(message)
    this.name = 'MetadataUiClientError'
    this.status = status
    this.url = url
    this.body = body
  }
}

/** Options for `client.action` — used to opt into binary responses. */
export interface ActionOptions {
  /** Default 'json'. Use 'blob' for binary returns (FileResponse on the server side). */
  readonly responseType?: 'json' | 'blob'
}
