// HTTP client for the metadata-driven UI contract. Framework-agnostic — wraps
// `fetch`, knows the URL schema and pagination contract, caches metadata,
// retries once on 401.

import type { PaginatedResult } from '@metadataui/spec'
import {
  urlForProjection, urlForDetail, urlForAction, urlForValueHelp,
  urlForMeta, urlForView, urlForViewMeta, buildQueryString,
} from '@metadataui/spec'
import type {
  ClientConfig, ListQuery, PublicBoMeta, ActionOptions,
} from './types.js'
import { MetadataUiClientError } from './types.js'

/** Public client surface returned by `createClient`. */
export interface MetadataUiClient {
  /** GET `/meta/{name}` — cached. Subsequent calls return the same Promise. */
  meta(projection: string): Promise<PublicBoMeta>
  /** Drop the cached metadata for a projection so the next `meta()` re-fetches. */
  invalidateMeta(projection?: string): void

  /** GET `/bo/{name}` — paginated list with `{ items, total, page, limit }`. */
  list<T = Record<string, unknown>>(projection: string, query?: ListQuery): Promise<PaginatedResult<T>>

  /** GET `/bo/{name}/{paramValue}` — single row. */
  detail<T = Record<string, unknown>>(projection: string, paramValue: string | number): Promise<T>

  /** POST `/bo/{name}` — returns the created row. */
  create<T = Record<string, unknown>>(projection: string, data: Record<string, unknown>): Promise<T>

  /** PUT `/bo/{name}/{paramValue}` — returns the updated row. */
  update<T = Record<string, unknown>>(
    projection: string,
    paramValue: string | number,
    data: Record<string, unknown>,
  ): Promise<T>

  /** DELETE `/bo/{name}/{paramValue}`. */
  delete<T = Record<string, unknown>>(projection: string, paramValue: string | number): Promise<T>

  /**
   * POST `/bo/{name}/{action}` — custom action.
   * Set `responseType: 'blob'` for binary returns (e.g. PDF / XLSX from `FileResponse`).
   */
  action<TOut = unknown>(
    projection: string,
    action: string,
    data?: Record<string, unknown>,
    options?: ActionOptions,
  ): Promise<TOut>

  /**
   * GET `/bo/{name}/valueHelp/{vh}` — paginated dropdown source. Returns the
   * unwrapped `items` array (callers usually only need the rows). Use
   * `valueHelpPaged` if you need the full pagination envelope.
   */
  valueHelp<T = Record<string, unknown>>(projection: string, vh: string, query?: ListQuery): Promise<T[]>

  /** Same as `valueHelp` but returns the full `{ items, total, page, limit }` envelope. */
  valueHelpPaged<T = Record<string, unknown>>(
    projection: string,
    vh: string,
    query?: ListQuery,
  ): Promise<PaginatedResult<T>>

  /** GET `/view/{name}` — read-only view route. Unwraps `items`. */
  view<T = Record<string, unknown>>(view: string, query?: ListQuery): Promise<T[]>

  /** Same as `view` but returns the full pagination envelope. */
  viewPaged<T = Record<string, unknown>>(view: string, query?: ListQuery): Promise<PaginatedResult<T>>

  /** GET `/view/{name}/meta` — view-route metadata. */
  viewMeta(view: string): Promise<unknown>
}

/** Create a configured metadata-UI HTTP client. */
export function createClient(config: ClientConfig): MetadataUiClient {
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis)
  const metaCache = new Map<string, Promise<PublicBoMeta>>()

  /** Resolve dynamic header values (auth + locale + extras) into a flat record. */
  async function buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (config.getAuthHeader) {
      const auth = await config.getAuthHeader()
      if (auth) headers.authorization = auth
    }
    if (config.headers) {
      Object.assign(headers, await config.headers())
    }
    return headers
  }

  /** Apply the `?locale=` shortcut from `config.locale` unless the caller already set it. */
  function applyLocale(query: ListQuery | undefined): ListQuery {
    if (query?.locale !== undefined) return query
    const locale = config.locale?.()
    if (!locale) return query ?? {}
    return { ...query, locale }
  }

  /** Run a request, retrying once on 401 if `refreshAuth` is configured. */
  async function request(
    url: string,
    init: { method: string; body?: BodyInit | null },
    responseType: 'json' | 'blob' | 'none' = 'json',
  ): Promise<unknown> {
    const headers = await buildHeaders()
    let res = await fetchImpl(url, { ...init, headers })

    if (res.status === 401 && config.refreshAuth) {
      const newAuth = await config.refreshAuth()
      const retryHeaders: Record<string, string> = { ...headers }
      if (newAuth) retryHeaders.authorization = newAuth
      else delete retryHeaders.authorization
      res = await fetchImpl(url, { ...init, headers: retryHeaders })
    }

    if (!res.ok) {
      let body: unknown
      try {
        body = await res.json() as unknown
      } catch { /* non-JSON error body */ }
      throw new MetadataUiClientError(
        `metadataui: ${init.method} ${url} failed with ${res.status}`,
        res.status, url, body,
      )
    }

    if (responseType === 'none' || res.status === 204) return undefined
    if (responseType === 'blob') return res.blob()
    return res.json() as Promise<unknown>
  }

  function get(url: string, responseType: 'json' | 'blob' = 'json'): Promise<unknown> {
    return request(url, { method: 'GET' }, responseType)
  }
  function post(url: string, body?: unknown, responseType: 'json' | 'blob' | 'none' = 'json'): Promise<unknown> {
    const init: { method: string; body?: BodyInit | null } = { method: 'POST' }
    if (body !== undefined) init.body = JSON.stringify(body)
    return request(url, init, responseType)
  }
  function put(url: string, body: unknown): Promise<unknown> {
    return request(url, { method: 'PUT', body: JSON.stringify(body) })
  }
  function del(url: string): Promise<unknown> {
    return request(url, { method: 'DELETE' })
  }

  return {
    meta(projection) {
      let pending = metaCache.get(projection)
      if (!pending) {
        pending = (get(urlForMeta(config.baseUrl, projection)) as Promise<PublicBoMeta>)
          .catch((err: unknown) => {
            metaCache.delete(projection)
            throw err
          })
        metaCache.set(projection, pending)
      }
      return pending
    },

    invalidateMeta(projection) {
      if (projection) metaCache.delete(projection)
      else metaCache.clear()
    },

    async list<T>(projection: string, query?: ListQuery) {
      const qs = buildQueryString(applyLocale(query) as Record<string, unknown>)
      return await get(`${urlForProjection(config.baseUrl, projection)}${qs}`) as PaginatedResult<T>
    },

    async detail<T>(projection: string, paramValue: string | number) {
      const qs = buildQueryString(applyLocale(undefined) as Record<string, unknown>)
      return await get(`${urlForDetail(config.baseUrl, projection, paramValue)}${qs}`) as T
    },

    async create<T>(projection: string, data: Record<string, unknown>) {
      return await post(urlForProjection(config.baseUrl, projection), data) as T
    },

    async update<T>(projection: string, paramValue: string | number, data: Record<string, unknown>) {
      return await put(urlForDetail(config.baseUrl, projection, paramValue), data) as T
    },

    async delete<T>(projection: string, paramValue: string | number) {
      return await del(urlForDetail(config.baseUrl, projection, paramValue)) as T
    },

    async action<TOut>(
      projection: string,
      action: string,
      data?: Record<string, unknown>,
      options?: ActionOptions,
    ) {
      return await post(
        urlForAction(config.baseUrl, projection, action),
        data,
        options?.responseType ?? 'json',
      ) as TOut
    },

    async valueHelp<T>(projection: string, vh: string, query?: ListQuery) {
      const result = await this.valueHelpPaged<T>(projection, vh, query)
      return [...result.items]
    },

    async valueHelpPaged<T>(projection: string, vh: string, query?: ListQuery) {
      const qs = buildQueryString(applyLocale(query) as Record<string, unknown>)
      return await get(`${urlForValueHelp(config.baseUrl, projection, vh)}${qs}`) as PaginatedResult<T>
    },

    async view<T>(view: string, query?: ListQuery) {
      const result = await this.viewPaged<T>(view, query)
      return [...result.items]
    },

    async viewPaged<T>(view: string, query?: ListQuery) {
      const qs = buildQueryString(applyLocale(query) as Record<string, unknown>)
      return await get(`${urlForView(config.baseUrl, view)}${qs}`) as PaginatedResult<T>
    },

    async viewMeta(view: string) {
      return await get(urlForViewMeta(config.baseUrl, view))
    },
  }
}
