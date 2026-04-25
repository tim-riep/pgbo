// Re-export structural types from @pgbo/core so frontend bundles don't have to
// transitively import the server package (which pulls in `pg`, `@types/pg`, …).
//
// These are pure types with no runtime dependency. Browser bundlers tree-shake
// them away. Apps treat `@pgbo/client` as the single import point for frontend code.

export type {
  FieldMeta,
  FilterMeta,
  ValueHelpRef,
  ValueHelpMeta,
  CompositionMeta,
  AssociationMeta,
  ViewMeta,
  BOMeta,
  FieldKind,
  FilterOption,
} from '@pgbo/core/metadata'

export type {
  ListParams,
  PaginatedResult,
} from '@pgbo/core/query'

/**
 * The `/meta/:name` response shape returned by `@pgbo/fastify`. Same as `BOMeta`
 * but with `label` already transformed to `labelKey` (always set, with the
 * `${projection.name}.${key}` fallback baked in) and `valueHelp.endpoint` /
 * `filterable.endpoint` resolved to absolute URLs (issue #35).
 */
export interface PublicFieldMeta {
  readonly key: string
  readonly kind: 'text' | 'number' | 'date' | 'boolean' | 'slug' | 'relation' | 'translation'
  readonly labelKey: string
  readonly hidden: boolean
  readonly immutable: boolean
  readonly searchable: boolean
  readonly filterable: false | PublicFilterMeta
  readonly valueHelp?: PublicValueHelpRef
  readonly inList: boolean
  readonly inForm: boolean
  readonly required: boolean
  readonly quick: boolean
}

export interface PublicFilterMeta {
  readonly type: 'text' | 'date' | 'select' | 'relation'
  readonly endpoint?: string
  readonly valueField?: string
  readonly labelField?: string
  readonly options?: readonly { value: string; label: string }[]
}

export interface PublicValueHelpRef {
  readonly name: string
  readonly endpoint: string
  readonly keyField: string
  readonly displayField: string
}

export interface PublicBoMeta {
  readonly name: string
  readonly paramField: string
  readonly readOnly: boolean
  readonly fields: readonly PublicFieldMeta[]
  readonly associations: readonly { name: string; foreignKey: string; target?: string }[]
  readonly compositions: readonly { name: string; fields: readonly string[] }[]
  readonly valueHelps: readonly { name: string; fields: readonly PublicFieldMeta[] }[]
  readonly orderBy?: string
  readonly orderDir?: 'asc' | 'desc'
  readonly cacheTags?: readonly string[]
}

/** Query options for `client.list` / `client.valueHelp` / view routes. */
export interface ListQuery {
  readonly page?: number
  readonly limit?: number
  readonly search?: string
  readonly sort?: string
  readonly order?: 'asc' | 'desc'
  /** `?filter.<col>=value` — pgbo's per-column filter convention. */
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
export class PgboClientError extends Error {
  readonly status: number
  readonly url: string
  readonly body: unknown

  constructor(message: string, status: number, url: string, body: unknown) {
    super(message)
    this.name = 'PgboClientError'
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
