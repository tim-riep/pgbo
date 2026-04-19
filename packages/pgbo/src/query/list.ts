// Standardised list params parsing and pagination (issue 024)

export interface ListParams {
  readonly page: number
  readonly limit: number
  readonly search: string
  readonly sort: string | null
  readonly order: 'asc' | 'desc'
  readonly filters: Readonly<Record<string, string>>
  readonly locale: string
  readonly fields: readonly string[] | null
}

export interface PaginatedResult<T> {
  readonly items: readonly T[]
  readonly total: number
  readonly page: number
  readonly limit: number
}

/**
 * Parse a query string object (e.g. from `req.query`) into standardised list params.
 *
 * Recognised keys:
 * - `page` — 1-based page number (default 1)
 * - `limit` — items per page (default 25, max 250)
 * - `search` — free-text search string (default '')
 * - `sort` — column to sort by (default null)
 * - `order` — 'asc' | 'desc' (default 'asc')
 * - `locale` — locale code (default 'en')
 * - `fields` — comma-separated column list (default null = all)
 * - `filter.<key>` — per-column filter values
 */
export function parseListParams(query: Record<string, unknown>): ListParams {
  const page = Math.max(1, toInt(query['page'], 1))
  const limit = Math.min(250, Math.max(1, toInt(query['limit'], 25)))
  const search = typeof query['search'] === 'string' ? query['search'].trim() : ''
  const sort = typeof query['sort'] === 'string' && query['sort'].length > 0 ? query['sort'] : null
  const order = query['order'] === 'desc' ? 'desc' as const : 'asc' as const
  const locale = typeof query['locale'] === 'string' && query['locale'].length > 0 ? query['locale'] : 'en'

  const fieldsRaw = typeof query['fields'] === 'string' && query['fields'].length > 0
    ? query['fields']
    : null
  const fields = fieldsRaw ? fieldsRaw.split(',').map(f => f.trim()).filter(Boolean) : null

  const filters: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('filter.') && typeof value === 'string' && value.length > 0) {
      filters[key.slice(7)] = value
    }
  }

  return { page, limit, search, sort, order, filters, locale, fields }
}

function toInt(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Math.floor(value)
  if (typeof value === 'string') {
    const n = parseInt(value, 10)
    return Number.isNaN(n) ? fallback : n
  }
  return fallback
}
