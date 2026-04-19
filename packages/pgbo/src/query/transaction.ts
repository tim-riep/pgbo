// Transaction client — Phase 2 (Step 10)

import type pg from 'pg'
import type { Queryable } from './types.js'
import type { TableDef, ViewDef, AnyColumnBuilder, Restriction } from '../schema/definitions.js'
import type { InferRow, InferViewRow } from '../schema/infer.js'
import type { TableOps, AuthHandler } from './client.js'
import { SelectBuilder } from './select.js'
import { InsertBuilder } from './insert.js'
import { UpdateBuilder } from './update.js'
import { DeleteBuilder } from './delete.js'

export interface TransactionClient extends Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>

  /** Build a SELECT query from a view */
  from<V extends ViewDef>(viewDef: V): SelectBuilder<InferViewRow<V>>

  /** Build an INSERT query through a view */
  into<V extends ViewDef>(viewDef: V): InsertBuilder<InferViewRow<V>>

  /** Build an UPDATE query through a view */
  update<V extends ViewDef>(viewDef: V): UpdateBuilder<InferViewRow<V>>

  /** Build a DELETE query through a view */
  deleteFrom<V extends ViewDef>(viewDef: V): DeleteBuilder<InferViewRow<V>>

  savepoint<T>(name: string, fn: (sp: TransactionClient) => Promise<T>): Promise<T>

  /** Internal: direct table operations for framework use */
  readonly _table: TableOps
}

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

function wireAuth<B extends { _authCheck?: (userId: string) => Promise<void> }>(
  builder: B, viewDef: ViewDef, grant: string, handler?: AuthHandler, fallback?: string,
): B {
  if (!handler || viewDef.isNoAuth) return builder
  const restriction = findRestriction(viewDef, grant, fallback)
  if (restriction) builder._authCheck = makeAuthCheck(handler, restriction, viewDef.name)
  return builder
}

function createTransactionClient(client: pg.PoolClient, authHandler?: AuthHandler): TransactionClient {
  const queryFn = async <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> => {
    const result = await client.query(sql, params)
    return result.rows as T[]
  }

  const q: Queryable = { query: queryFn }

  const tx: TransactionClient = {
    query: queryFn,

    from<V extends ViewDef>(viewDef: V) {
      return wireAuth(new SelectBuilder<InferViewRow<V>>(q, viewDef.name), viewDef, 'READ', authHandler)
    },

    into<V extends ViewDef>(viewDef: V) {
      return wireAuth(new InsertBuilder<InferViewRow<V>>(q, viewDef.name), viewDef, 'WRITE', authHandler)
    },

    update<V extends ViewDef>(viewDef: V) {
      return wireAuth(new UpdateBuilder<InferViewRow<V>>(q, viewDef.name), viewDef, 'WRITE', authHandler)
    },

    deleteFrom<V extends ViewDef>(viewDef: V) {
      return wireAuth(new DeleteBuilder<InferViewRow<V>>(q, viewDef.name), viewDef, 'DELETE', authHandler, 'WRITE')
    },

    async savepoint<T>(name: string, fn: (sp: TransactionClient) => Promise<T>): Promise<T> {
      await client.query(`SAVEPOINT ${name}`)
      try {
        const result = await fn(tx)
        await client.query(`RELEASE SAVEPOINT ${name}`)
        return result
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`)
        throw err
      }
    },

    _table: makeTableOps(q),
  }

  return tx
}

export async function runTransaction<T>(
  pool: pg.Pool,
  fn: (tx: TransactionClient) => Promise<T>,
  authHandler?: AuthHandler,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const tx = createTransactionClient(client, authHandler)
    const result = await fn(tx)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
