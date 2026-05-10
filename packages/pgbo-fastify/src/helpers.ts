// Query helpers for route handlers

import type { Database } from '@pgbo/core'
import type { ViewDef } from '@pgbo/core/schema'
import type { PaginatedResult, ListParams, WhereConditions, TransactionClient } from '@pgbo/core/query'
import { viewMeta } from '@pgbo/core/metadata'

/**
 * Either the top-level `Database` or a request-scoped `TransactionClient` from
 * `db.withContext(...)`. Both share the `from` / `_table` / `query` surface that
 * paginateView and friends rely on, so accepting both lets routes opt into the
 * session-param-aware scope without changing helper code (issue #42).
 */
export type DbOrTx = Database | TransactionClient

export interface PaginateOptions {
  readonly db: DbOrTx
  readonly view: ViewDef
  readonly params: ListParams
  readonly baseWhere?: WhereConditions
  readonly userId?: string
}

/** Extract searchable field keys from a view's column annotations. */
function searchableKeys(view: ViewDef): string[] {
  return viewMeta(view).fields
    .filter(f => f.searchable)
    .map(f => f.key)
}

/** Build an OR-of-ILIKE condition from searchable view fields. */
function buildSearchWhere(view: ViewDef, search: string): WhereConditions | undefined {
  const keys = searchableKeys(view)
  if (keys.length === 0 || !search) return undefined
  const pattern = `%${search}%`
  return { OR: keys.map(k => ({ [k]: { ilike: pattern } })) }
}

/**
 * Paginated query: combines base WHERE, search, filter, orderBy, limit/offset + count.
 * Returns standardised PaginatedResult.
 */
export async function paginateView<T extends Record<string, unknown>>(
  opts: PaginateOptions,
): Promise<PaginatedResult<T>> {
  const { db, view, params, baseWhere, userId } = opts

  // Assemble top-level AND: baseWhere, filters, search (if searchable fields exist)
  const andParts: WhereConditions[] = []
  if (baseWhere) andParts.push(baseWhere)

  if (Object.keys(params.filters).length > 0) {
    andParts.push(params.filters)
  }

  const searchWhere = buildSearchWhere(view, params.search)
  if (searchWhere) andParts.push(searchWhere)

  const conditions: WhereConditions | undefined =
    andParts.length === 0 ? undefined
    : andParts.length === 1 ? andParts[0]
    : { AND: andParts }

  // Build query
  let query = db.from(view)
  if (userId) query = query.as(userId)
  if (conditions) query = query.where(conditions)
  if (params.sort) query = query.orderBy(params.sort, params.order)

  // Count query (same WHERE, no sort/limit)
  let countQuery = db.from(view)
  if (userId) countQuery = countQuery.as(userId)
  if (conditions) countQuery = countQuery.where(conditions)

  const offset = (params.page - 1) * params.limit

  const [items, total] = await Promise.all([
    query.limit(params.limit).offset(offset).execute() as Promise<T[]>,
    countQuery.count(),
  ])

  return { items, total, page: params.page, limit: params.limit }
}

/**
 * Build tenant-scoped WHERE clause.
 * If includeGlobal is true, matches rows where tenantColumn IS NULL OR equals tenantId.
 */
export function buildTenantWhere(
  tenantId: string,
  tenantColumn = 'tenantId',
  includeGlobal = false,
): WhereConditions {
  if (includeGlobal) {
    return {
      OR: [
        { [tenantColumn]: { isNull: true } },
        { [tenantColumn]: tenantId },
      ],
    }
  }
  return { [tenantColumn]: tenantId }
}
