// Single source of truth for the pgbo URL schema (issues #44 + #46).
// Every URL constructed by `@pgbo/client` flows through these helpers — when
// `@pgbo/fastify`'s URL layout changes, this file is the only thing to update.

/** Strip a single trailing slash so `${base}/${path}` doesn't double-up. */
function trimBase(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base
}

/** `${base}/bo/{projection}` — list / create endpoint. */
export function urlForProjection(base: string, projection: string): string {
  return `${trimBase(base)}/bo/${projection}`
}

/** `${base}/bo/{projection}/{paramValue}` — detail / update / delete endpoint. */
export function urlForDetail(base: string, projection: string, paramValue: string | number): string {
  return `${trimBase(base)}/bo/${projection}/${encodeURIComponent(String(paramValue))}`
}

/** `${base}/bo/{projection}/{action}` — custom action endpoint. */
export function urlForAction(base: string, projection: string, action: string): string {
  return `${trimBase(base)}/bo/${projection}/${encodeURIComponent(action)}`
}

/** `${base}/bo/{projection}/valueHelp/{vh}` — value-help dropdown source. */
export function urlForValueHelp(base: string, projection: string, vh: string): string {
  return `${trimBase(base)}/bo/${projection}/valueHelp/${encodeURIComponent(vh)}`
}

/** `${base}/meta/{projection}` — projection metadata. */
export function urlForMeta(base: string, projection: string): string {
  return `${trimBase(base)}/meta/${projection}`
}

/** `${base}/view/{view}` — read-only view route from `registerViewRoute`. */
export function urlForView(base: string, view: string): string {
  return `${trimBase(base)}/view/${view}`
}

/** `${base}/view/{view}/meta` — view metadata. */
export function urlForViewMeta(base: string, view: string): string {
  return `${trimBase(base)}/view/${view}/meta`
}

/** Encode a record into `key=value&key=value` (skipping undefined / null / empty strings).
 * Preserves the `filter.<col>=value` convention pgbo uses for per-column filters. */
export function buildQueryString(params: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value === '') continue
    if (typeof value === 'object') {
      // filter.<col> shorthand: { filters: { col: 'val' } } → filter.col=val
      if (key === 'filters') {
        for (const [col, val] of Object.entries(value as Record<string, unknown>)) {
          if (val === undefined || val === null || val === '') continue
          if (typeof val === 'object') continue  // skip non-primitive values
          const str = typeof val === 'string' ? val : String(val as number | boolean | bigint)
          parts.push(`filter.${encodeURIComponent(col)}=${encodeURIComponent(str)}`)
        }
        continue
      }
      // Arrays — join with comma (matches `fields=id,slug,name` convention)
      if (Array.isArray(value)) {
        if (value.length > 0) {
          const joined = (value as readonly unknown[]).map(v => String(v as string | number | boolean)).join(',')
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(joined)}`)
        }
        continue
      }
      // Other objects — skip (caller should pre-serialize)
      continue
    }
    const str = typeof value === 'string' ? value : String(value as number | boolean | bigint)
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(str)}`)
  }
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}
