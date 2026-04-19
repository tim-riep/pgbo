// DELETE query builder — Phase 2 (Step 9)

import { toSnakeCase } from '../schema/table.js'
import { buildWhere, type WhereConditions } from './where.js'
import type { Queryable } from './types.js'
import { rowToCamelCase, type QuerySpec, type AuthCheckFn } from './select.js'

export class DeleteBuilder<Row> {
  private readonly queryable: Queryable
  private readonly tableName: string
  private whereClause: WhereConditions | undefined
  private deleteAll = false
  private returningClause: string | undefined
  private _userId?: string
  /** @internal */ _authCheck?: AuthCheckFn

  constructor(queryable: Queryable, tableName: string) {
    this.queryable = queryable
    this.tableName = tableName
  }

  as(userId: string): this {
    this._userId = userId
    return this
  }

  where(conditions: WhereConditions): this {
    this.whereClause = conditions
    return this
  }

  all(): this {
    this.deleteAll = true
    return this
  }

  returning(cols: '*' | string[]): this {
    if (cols === '*') {
      this.returningClause = '*'
    } else {
      this.returningClause = cols.map(toSnakeCase).join(', ')
    }
    return this
  }

  toQuery(): QuerySpec {
    if (!this.whereClause && !this.deleteAll) {
      throw new Error('DELETE requires .where() or .all() to prevent accidental deletion')
    }

    let text = `DELETE FROM ${this.tableName}`
    let values: unknown[] = []

    if (this.whereClause) {
      const w = buildWhere(this.whereClause)
      if (w.text) {
        text += ` WHERE ${w.text}`
        values = w.values
      }
    }

    if (this.returningClause) {
      text += ` RETURNING ${this.returningClause}`
    }

    return { text, values }
  }

  async execute(): Promise<Row[]> {
    if (this._authCheck && this._userId) await this._authCheck(this._userId)
    const { text, values } = this.toQuery()
    const rows = await this.queryable.query(text, values)
    if (this.returningClause) {
      return rows.map(row => rowToCamelCase(row) as Row)
    }
    return []
  }
}
