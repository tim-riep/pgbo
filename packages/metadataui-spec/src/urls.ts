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

/**
 * `{base}/bo/{projection}/{paramValue}` — detail / update / delete endpoint.
 *
 * For BOs with a composite key (`paramField` is an array), pass an object
 * mapping each key column to its value: `urlForDetail(base, name, { slug: 'A1', warehouseSlug: 'WH-1' })`.
 * The result uses OData-style syntax: `{base}/bo/{projection}/(slug='A1',warehouseSlug='WH-1')`.
 *
 * For single-key BOs, pass a string or number directly.
 */
export function urlForDetail(
  base: string,
  projection: string,
  paramValue: string | number | Readonly<Record<string, string | number>>,
): string {
  const prefix = `${trimBase(base)}/bo/${projection}`
  if (typeof paramValue === 'object') {
    return `${prefix}/${formatCompositeKey(paramValue)}`
  }
  return `${prefix}/${encodeURIComponent(String(paramValue))}`
}

/**
 * Format a composite-key record as the OData-style URL segment
 * `(k1='v1',k2='v2')`. String values are single-quoted with embedded `'`
 * doubled (`O''Brien`); numeric values are emitted bare. Reserved characters
 * inside values are URL-encoded.
 *
 * The inverse of `parseCompositeKey`.
 */
export function formatCompositeKey(key: Readonly<Record<string, string | number>>): string {
  const keys = Object.keys(key)
  if (keys.length === 0) {
    throw new Error('formatCompositeKey: composite key must have at least one entry')
  }
  const parts: string[] = []
  for (const k of keys) {
    const v = key[k]
    if (typeof v === 'number') {
      parts.push(`${encodeURIComponent(k)}=${v}`)
    } else if (typeof v === 'string') {
      // Double single quotes inside the value (OData escape), then URL-encode.
      const escaped = v.replace(/'/g, "''")
      parts.push(`${encodeURIComponent(k)}='${encodeURIComponent(escaped)}'`)
    } else {
      throw new Error(`formatCompositeKey: value for "${k}" must be a string or number`)
    }
  }
  return `(${parts.join(',')})`
}

/**
 * Parse the OData-style URL segment `(k1='v1',k2='v2')` back into a record.
 * Strings are recognised by surrounding single quotes (with `''` decoded back
 * to `'`); bare values are coerced to numbers when they're numeric, otherwise
 * left as strings.
 *
 * Throws on malformed input. The inverse of `formatCompositeKey`.
 */
export function parseCompositeKey(input: string): Record<string, string | number> {
  if (!input.startsWith('(') || !input.endsWith(')')) {
    throw new Error(`parseCompositeKey: expected "(k1='v1',...)", got "${input}"`)
  }
  const body = input.slice(1, -1)
  if (body.length === 0) {
    throw new Error('parseCompositeKey: empty composite key "()"')
  }
  const result: Record<string, string | number> = {}
  for (const part of splitTopLevelCommas(body)) {
    const eq = part.indexOf('=')
    if (eq === -1) {
      throw new Error(`parseCompositeKey: missing "=" in "${part}"`)
    }
    const rawKey = part.slice(0, eq)
    const rawValue = part.slice(eq + 1)
    if (rawKey.length === 0) {
      throw new Error(`parseCompositeKey: empty key in "${part}"`)
    }
    const key = decodeURIComponent(rawKey)
    if (rawValue.startsWith("'") && rawValue.endsWith("'") && rawValue.length >= 2) {
      // String literal: strip quotes, undouble inner quotes, URL-decode
      const inner = rawValue.slice(1, -1).replace(/''/g, "'")
      result[key] = decodeURIComponent(inner)
    } else {
      // Bare value — must parse as a finite number
      const n = Number(rawValue)
      if (rawValue === '' || !Number.isFinite(n)) {
        throw new Error(`parseCompositeKey: value for "${key}" must be a quoted string or a number, got "${rawValue}"`)
      }
      result[key] = n
    }
  }
  return result
}

/** Split a body string on commas that aren't inside single-quoted segments
 *  (treating `''` as an escaped quote). */
function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = []
  let inQuotes = false
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === "'") {
      // Doubled '' inside quotes is an escape — skip the second one
      if (inQuotes && body[i + 1] === "'") {
        i++
        continue
      }
      inQuotes = !inQuotes
    } else if (!inQuotes && ch === ',') {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts
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

/** Narrow `unknown` to a value safely stringifiable by `String()`. Returns
 *  `undefined` for non-primitive values so callers can skip them. */
function stringifyPrimitive(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return undefined
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
          const str = stringifyPrimitive(val)
          if (str === undefined) continue
          parts.push(`filter.${encodeURIComponent(col)}=${encodeURIComponent(str)}`)
        }
        continue
      }
      if (Array.isArray(value)) {
        if (value.length > 0) {
          const joined = (value as readonly unknown[]).map(v => stringifyPrimitive(v) ?? '').join(',')
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(joined)}`)
        }
        continue
      }
      continue
    }
    const str = stringifyPrimitive(value)
    if (str === undefined) continue
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(str)}`)
  }
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}
