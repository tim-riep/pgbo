// UPDATE query builder — Phase 2 (Step 9)

import { toSnakeCase } from '../schema/table.js'
import { buildWhere, type WhereConditions } from './where.js'
import type { Queryable } from './types.js'
import { rowToCamelCase, type QuerySpec, type AuthCheckFn } from './select.js'

export class UpdateBuilder<Row> {
  private readonly queryable: Queryable
  private readonly tableName: string
  private setData: Record<string, unknown> | undefined
  private whereClause: WhereConditions | undefined
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

  set(data: Record<string, unknown>): this {
    this.setData = data
    return this
  }

  where(conditions: WhereConditions): this {
    this.whereClause = conditions
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
    const setData = this.setData
    if (!setData) {
      throw new Error('No data provided for UPDATE (.set() not called)')
    }

    const keys = Object.keys(setData)
    const values: unknown[] = []
    const setClauses = keys.map((k) => {
      values.push(setData[k])
      return `${toSnakeCase(k)} = $${values.length}`
    })

    let text = `UPDATE ${this.tableName} SET ${setClauses.join(', ')}`

    if (this.whereClause) {
      const w = buildWhere(this.whereClause, values.length + 1)
      if (w.text) {
        text += ` WHERE ${w.text}`
        values.push(...w.values)
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
