// SELECT query builder — Phase 2 (Step 8) + runtime JOIN support

import { toSnakeCase } from '../schema/table.js'
import { buildWhere, type WhereConditions } from './where.js'
import type { Queryable } from './types.js'
import type { TableDef } from '../schema/definitions.js'

/** Convert snake_case to camelCase */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

/** Convert all keys in an object from snake_case to camelCase */
export function rowToCamelCase(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    result[toCamelCase(key)] = value
  }
  return result
}

export interface QuerySpec {
  text: string
  values: unknown[]
}

interface JoinClause {
  type: 'JOIN' | 'LEFT JOIN'
  table: string
  on: Record<string, string> // { localCamelCol: foreignCamelCol }
}

type SelectAlias = Record<string, string>;

export type AuthCheckFn = (userId: string) => Promise<void>

export class SelectBuilder<Row> {
  private readonly queryable: Queryable
  private readonly tableName: string
  private readonly selectColumns: string | undefined
  private joinClauses: JoinClause[] = []
  private selectAliases: SelectAlias | undefined
  private pickCols: string | undefined
  private whereClause: WhereConditions | undefined
  private orderByClauses: { column: string; direction: 'asc' | 'desc' }[] = []
  private limitValue: number | undefined
  private offsetValue: number | undefined
  private _userId?: string
  /** @internal */ _authCheck?: AuthCheckFn

  constructor(queryable: Queryable, tableName: string, columns?: string[]) {
    this.queryable = queryable
    this.tableName = tableName
    this.selectColumns = columns
      ? columns.map(toSnakeCase).join(', ')
      : undefined
  }

  as(userId: string): this {
    this._userId = userId
    return this
  }

  join(table: TableDef, on: Record<string, string>): this {
    this.joinClauses.push({ type: 'JOIN', table: table.name, on })
    return this
  }

  leftJoin(table: TableDef, on: Record<string, string>): this {
    this.joinClauses.push({ type: 'LEFT JOIN', table: table.name, on })
    return this
  }

  select(aliases: SelectAlias): this {
    this.selectAliases = aliases
    return this
  }

  pick<K extends keyof Row & string>(columns: readonly K[]): SelectBuilder<Pick<Row, K>> {
    this.pickCols = columns.map(c => toSnakeCase(c)).join(', ')
    return this as unknown as SelectBuilder<Pick<Row, K>>
  }

  where(conditions: WhereConditions): this {
    this.whereClause = conditions
    return this
  }

  orderBy(
    column: (keyof Row & string) | readonly { column: keyof Row & string; direction?: 'asc' | 'desc' }[],
    direction: 'asc' | 'desc' = 'asc',
  ): this {
    if (typeof column === 'string') {
      this.orderByClauses.push({ column, direction })
    } else {
      for (const c of column) this.orderByClauses.push({ column: c.column, direction: c.direction ?? 'asc' })
    }
    return this
  }

  limit(n: number): this {
    this.limitValue = n
    return this
  }

  offset(n: number): this {
    this.offsetValue = n
    return this
  }

  toQuery(): QuerySpec {
    // Build column list
    let cols: string
    if (this.selectAliases) {
      cols = Object.entries(this.selectAliases)
        .map(([outputName, qualifiedRef]) => {
          const snakeOutput = toSnakeCase(outputName)
          return `${qualifiedRef} AS ${snakeOutput}`
        })
        .join(', ')
    } else if (this.pickCols) {
      cols = this.pickCols
    } else {
      cols = this.selectColumns ?? '*'
    }

    const parts: string[] = [`SELECT ${cols} FROM ${this.tableName}`]

    // JOINs
    for (const j of this.joinClauses) {
      const onClauses = Object.entries(j.on)
        .map(([localCol, foreignCol]) =>
          `${this.tableName}.${toSnakeCase(localCol)} = ${j.table}.${toSnakeCase(foreignCol)}`)
        .join(' AND ')
      parts.push(`${j.type} ${j.table} ON ${onClauses}`)
    }

    let values: unknown[] = []

    if (this.whereClause) {
      const w = buildWhere(this.whereClause)
      if (w.text) {
        parts.push(`WHERE ${w.text}`)
        values = w.values
      }
    }

    if (this.orderByClauses.length > 0) {
      const clauses = this.orderByClauses
        .map(c => `${toSnakeCase(c.column)} ${c.direction.toUpperCase()}`)
        .join(', ')
      parts.push(`ORDER BY ${clauses}`)
    }

    if (this.limitValue !== undefined) {
      parts.push(`LIMIT ${this.limitValue}`)
    }

    if (this.offsetValue !== undefined) {
      parts.push(`OFFSET ${this.offsetValue}`)
    }

    return { text: parts.join(' '), values }
  }

  async execute(): Promise<Row[]> {
    if (this._authCheck && this._userId) await this._authCheck(this._userId)
    const { text, values } = this.toQuery()
    const rows = await this.queryable.query(text, values)
    return rows.map(row => rowToCamelCase(row) as Row)
  }

  async count(options?: { distinct: (keyof Row & string) | readonly (keyof Row & string)[] }): Promise<number> {
    let expr = 'COUNT(*)'
    if (options?.distinct) {
      const cols = Array.isArray(options.distinct) ? options.distinct : [options.distinct]
      const snake = cols.map(c => toSnakeCase(c as string)).join(', ')
      expr = cols.length > 1 ? `COUNT(DISTINCT (${snake}))` : `COUNT(DISTINCT ${snake})`
    }
    const parts: string[] = [`SELECT ${expr} AS count FROM ${this.tableName}`]

    for (const j of this.joinClauses) {
      const onClauses = Object.entries(j.on)
        .map(([localCol, foreignCol]) =>
          `${this.tableName}.${toSnakeCase(localCol)} = ${j.table}.${toSnakeCase(foreignCol)}`)
        .join(' AND ')
      parts.push(`${j.type} ${j.table} ON ${onClauses}`)
    }

    let values: unknown[] = []

    if (this.whereClause) {
      const w = buildWhere(this.whereClause)
      if (w.text) {
        parts.push(`WHERE ${w.text}`)
        values = w.values
      }
    }

    if (this._authCheck && this._userId) await this._authCheck(this._userId)
    const rows = await this.queryable.query<{ count: string }>(parts.join(' '), values)
    const [firstRow] = rows
    return firstRow ? Number(firstRow.count) : 0
  }
}
