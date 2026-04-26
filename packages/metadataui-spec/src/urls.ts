// URL convention for the metadata-driven UI contract — the canonical layout
// any server implementation exposes:
//
//   GET    /bo/{name}                       list
//   GET    /bo/{name}/{paramValue}          detail
//   POST   /bo/{name}                       create
//   PUT    /bo/{name}/{paramValue}          update
//   DELETE /bo/{name}/{paramValue}          delete
//   GET    /meta/{name}                     metadata
//   GET    /bo/{name}/valueHelp/{vh}        value help
//   POST   /bo/{name}/{action}              custom action
//   GET    /view/{name}                     read-only view
//   GET    /view/{name}/meta                view metadata
//
// Status code semantics:
//   2xx — success (201 on create, 204 on null/undefined return, 200 otherwise)
//   401 — auth required (clients should refresh once and retry)
//   403 — forbidden (e.g. tenant trying to write a global record)
//   404 — not found, or out-of-scope under the projection's WHERE clause
//
// These helpers are the single source of truth for URL composition. Servers and
// clients both reference them so renaming a route happens in exactly one place.

/** Strip a single trailing slash so `${base}/${path}` doesn't double-up. */
function trimBase(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base
}

/** `{base}/bo/{projection}` — list / create endpoint. */
export function urlForProjection(base: string, projection: string): string {
  return `${trimBase(base)}/bo/${projection}`
}

/** `{base}/bo/{projection}/{paramValue}` — detail / update / delete endpoint. */
export function urlForDetail(base: string, projection: string, paramValue: string | number): string {
  return `${trimBase(base)}/bo/${projection}/${encodeURIComponent(String(paramValue))}`
}

/** `{base}/bo/{projection}/{action}` — custom action endpoint. */
export function urlForAction(base: string, projection: string, action: string): string {
  return `${trimBase(base)}/bo/${projection}/${encodeURIComponent(action)}`
}

/** `{base}/bo/{projection}/valueHelp/{vh}` — value-help dropdown source. */
export function urlForValueHelp(base: string, projection: string, vh: string): string {
  return `${trimBase(base)}/bo/${projection}/valueHelp/${encodeURIComponent(vh)}`
}

/** `{base}/meta/{projection}` — projection metadata. */
export function urlForMeta(base: string, projection: string): string {
  return `${trimBase(base)}/meta/${projection}`
}

/** `{base}/view/{view}` — read-only view route. */
export function urlForView(base: string, view: string): string {
  return `${trimBase(base)}/view/${view}`
}

/** `{base}/view/{view}/meta` — view-route metadata. */
export function urlForViewMeta(base: string, view: string): string {
  return `${trimBase(base)}/view/${view}/meta`
}

/**
 * Encode a record into `key=value&key=value` (skipping undefined / null / empty strings).
 *
 * Two pgbo-style conventions baked in:
 * - `{ filters: { col: 'val' } }` expands to `filter.col=val` (the per-column filter shorthand).
 * - Arrays serialise as comma-joined values (matches `?fields=id,slug,name`).
 */
export function buildQueryString(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value === '') continue
    if (typeof value === 'object') {
      if (key === 'filters') {
        for (const [col, val] of Object.entries(value as Record<string, unknown>)) {
          if (val === undefined || val === null || val === '') continue
          if (typeof val === 'object') continue
          const str = typeof val === 'string' ? val : String(val as number | boolean | bigint)
          parts.push(`filter.${encodeURIComponent(col)}=${encodeURIComponent(str)}`)
        }
        continue
      }
      if (Array.isArray(value)) {
        if (value.length > 0) {
          const joined = (value as readonly unknown[]).map(v => String(v as string | number | boolean)).join(',')
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(joined)}`)
        }
        continue
      }
      continue
    }
    const str = typeof value === 'string' ? value : String(value as number | boolean | bigint)
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(str)}`)
  }
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}
