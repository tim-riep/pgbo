// Database client — Phase 2 (Step 6)

import pg from 'pg'
import type { Queryable } from './types.js'
import type { TableDef, ViewDef, AnyColumnBuilder, Restriction } from '../schema/definitions.js'
import type { InferRow, InferViewRow } from '../schema/infer.js'
import { SelectBuilder } from './select.js'
import { InsertBuilder } from './insert.js'
import { UpdateBuilder } from './update.js'
import { DeleteBuilder } from './delete.js'
import { runTransaction, runContextualTransaction, type TransactionClient } from './transaction.js'
import type { CacheProvider } from './cache.js'

export type AuthHandler = (userId: string, restriction: Restriction) => Promise<boolean> | boolean

function findRestriction(viewDef: ViewDef, grant: string, fallback?: string): Restriction | undefined {
  if (!viewDef.restrictions || viewDef.restrictions.length === 0) return undefined
  const match = viewDef.restrictions.find(r => r.grant === grant)
  if (match) return match
  if (fallback) return viewDef.restrictions.find(r => r.grant === fallback)
  return undefined
}

function makeAuthCheck(handler: AuthHandler, restriction: Restriction, viewName: string) {
  return async (userId: string) => {
    const allowed = await handler(userId, restriction)
    if (!allowed) {
      throw new Error(`Authorization denied: user "${userId}" lacks "${restriction.to}" (${restriction.grant}) on "${viewName}"`)
    }
  }
}

/** Resolver for a session parameter. Called with the request `ctx` inside `db.withContext()`. */
export type SessionParamResolver = (ctx: Record<string, unknown>) => string | number | boolean | null | undefined

export interface DatabaseConfig {
  connectionString: string
  pool?: {
    min?: number
    max?: number
    idleTimeoutMs?: number
    connectionTimeoutMs?: number
  }
  /** Optional cache provider. Enables `.cached()` on queries and auto-invalidation on BO writes. */
  cache?: CacheProvider
  /**
   * Postgres session parameters (`SET LOCAL <key> = <value>`) emitted at the start
   * of every `db.withContext(ctx, ...)` scope. Values are resolved per-request from ctx.
   * Views can read these with `current_setting('app.locale', true)`.
   */
  sessionParams?: Record<string, SessionParamResolver>
}

/** Internal table-level operations — used by framework internals (BO actions, seeds, testing) */
export interface TableOps extends Queryable {
  from<C extends Record<string, AnyColumnBuilder>>(
    tableDef: TableDef<C>,
  ): SelectBuilder<InferRow<TableDef<C>>>

  into<C extends Record<string, AnyColumnBuilder>>(
    tableDef: TableDef<C>,
  ): InsertBuilder<InferRow<TableDef<C>>>

  update<C extends Record<string, AnyColumnBuilder>>(
    tableDef: TableDef<C>,
  ): UpdateBuilder<InferRow<TableDef<C>>>

  deleteFrom<C extends Record<string, AnyColumnBuilder>>(
    tableDef: TableDef<C>,
  ): DeleteBuilder<InferRow<TableDef<C>>>
}

/** Helper: extract source TableDef from a ViewDef */
export interface Database extends Queryable {
  /** Execute a parameterized query and return rows */
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>

  /** Build a SELECT query from a view definition */
  from<V extends ViewDef>(
    viewDef: V,
  ): SelectBuilder<InferViewRow<V>>

  /** Build an INSERT query through a view */
  into<V extends ViewDef>(
    viewDef: V,
  ): InsertBuilder<InferViewRow<V>>

  /** Build an UPDATE query through a view */
  update<V extends ViewDef>(
    viewDef: V,
  ): UpdateBuilder<InferViewRow<V>>

  /** Build a DELETE query through a view */
  deleteFrom<V extends ViewDef>(
    viewDef: V,
  ): DeleteBuilder<InferViewRow<V>>

  /** Run a callback in a transaction with auto-rollback on error */
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>

  /**
   * Open a scoped connection, emit `SET LOCAL` for each configured `sessionParams`
   * resolved from `ctx`, then run `fn` with a `TransactionClient` bound to that
   * connection. All queries inside the scope see the session parameters via
   * `current_setting('app.key', true)`. Commits on success, rolls back on error.
   */
  withContext<T>(ctx: Record<string, unknown>, fn: (scoped: TransactionClient) => Promise<T>): Promise<T>

  /** Execute a raw SQL tagged template */
  raw<T extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>

  /** Register a pluggable auth handler for view-level restrictions */
  setAuthHandler(handler: AuthHandler): void

  /** Optional cache provider registered via DatabaseConfig. undefined when no cache was configured. */
  readonly cache?: CacheProvider

  /**
   * True when `DatabaseConfig.sessionParams` was set with at least one resolver.
   * `@pgbo/fastify` reads this to decide whether to wrap request handlers in
   * `db.withContext` — skipping the wrap entirely when no params are configured
   * so that apps without session params don't pay an extra transaction per request.
   */
  readonly hasSessionParams: boolean

  /** Close the connection pool */
  close(): Promise<void>

  /** Access the underlying pg.Pool (for advanced use / testing) */
  readonly pool: pg.Pool

  /** Internal: direct table operations for framework use (BO actions, seeds, testing) */
  readonly _table: TableOps
}

export function createDatabase(config: DatabaseConfig): Database {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    min: config.pool?.min,
    max: config.pool?.max,
    idleTimeoutMillis: config.pool?.idleTimeoutMs,
    connectionTimeoutMillis: config.pool?.connectionTimeoutMs,
  })

  const queryFn = async <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> => {
    const result = await pool.query(sql, params)
    return result.rows as T[]
  }

  // Internal table ops (shared between db._table and transaction._table)
  function makeTableOps(q: Queryable): TableOps {
    return {
      query: q.query.bind(q),
      from<C extends Record<string, AnyColumnBuilder>>(tableDef: TableDef<C>) {
        return new SelectBuilder<InferRow<TableDef<C>>>(q, tableDef.name)
      },
      into<C extends Record<string, AnyColumnBuilder>>(tableDef: TableDef<C>) {
        return new InsertBuilder<InferRow<TableDef<C>>>(q, tableDef.name)
      },
      update<C extends Record<string, AnyColumnBuilder>>(tableDef: TableDef<C>) {
        return new UpdateBuilder<InferRow<TableDef<C>>>(q, tableDef.name)
      },
      deleteFrom<C extends Record<string, AnyColumnBuilder>>(tableDef: TableDef<C>) {
        return new DeleteBuilder<InferRow<TableDef<C>>>(q, tableDef.name)
      },
    }
  }

  let authHandler: AuthHandler | undefined

  function wireAuth<B extends { _authCheck?: (userId: string) => Promise<void> }>(
    builder: B, viewDef: ViewDef, grant: string, fallback?: string,
  ): B {
    if (!authHandler || viewDef.isNoAuth) return builder
    const restriction = findRestriction(viewDef, grant, fallback)
    if (restriction) builder._authCheck = makeAuthCheck(authHandler, restriction, viewDef.name)
    return builder
  }

  const cache = config.cache

  function wireCache<B extends { _cache?: CacheProvider }>(builder: B): B {
    if (cache) builder._cache = cache
    return builder
  }

  const hasSessionParams = config.sessionParams !== undefined
    && Object.keys(config.sessionParams).length > 0

  const db: Database = {
    pool,
    cache,
    hasSessionParams,

    query: queryFn,

    from<V extends ViewDef>(viewDef: V) {
      return wireCache(wireAuth(new SelectBuilder<InferViewRow<V>>(db, viewDef.name), viewDef, 'READ'))
    },

    into<V extends ViewDef>(viewDef: V) {
      return wireAuth(new InsertBuilder<InferViewRow<V>>(db, viewDef.name), viewDef, 'WRITE')
    },

    update<V extends ViewDef>(viewDef: V) {
      return wireAuth(new UpdateBuilder<InferViewRow<V>>(db, viewDef.name), viewDef, 'WRITE')
    },

    deleteFrom<V extends ViewDef>(viewDef: V) {
      return wireAuth(new DeleteBuilder<InferViewRow<V>>(db, viewDef.name), viewDef, 'DELETE', 'WRITE')
    },

    setAuthHandler(handler: AuthHandler) {
      authHandler = handler
    },

    async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
      return runTransaction(pool, fn, authHandler)
    },

    async withContext<T>(ctx: Record<string, unknown>, fn: (scoped: TransactionClient) => Promise<T>): Promise<T> {
      const resolvers = config.sessionParams ?? {}
      const resolved: Record<string, string | number | boolean | null> = {}
      for (const [key, resolver] of Object.entries(resolvers)) {
        const value = resolver(ctx)
        if (value !== undefined) resolved[key] = value
      }
      return runContextualTransaction(pool, fn, resolved, authHandler)
    },

    async raw<T extends Record<string, unknown> = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T[]> {
      let text = ''
      for (let i = 0; i < strings.length; i++) {
        text += strings[i] ?? ''
        if (i < values.length) {
          text += `$${i + 1}`
        }
      }
      const result = await pool.query(text, values)
      return result.rows as T[]
    },

    async close(): Promise<void> {
      await pool.end()
    },

    _table: makeTableOps({ query: queryFn }),
  }

  return db
}
