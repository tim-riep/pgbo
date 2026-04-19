// INSERT query builder — Phase 2 (Step 9) + ON CONFLICT upsert support

import { toSnakeCase } from '../schema/table.js'
import { toCamelCase } from './select.js'
import type { Queryable } from './types.js'
import type { QuerySpec, AuthCheckFn } from './select.js'

function rowToCamelCase(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    result[toCamelCase(key)] = value
  }
  return result
}

/** Assignment value for ON CONFLICT DO UPDATE */
export type ConflictAssignment<Col = unknown> =
  | Col
  | { excluded: true }
  | { increment: number }
  | { decrement: number }

/** Conflict target — either column list or constraint name */
export type ConflictTarget<Row> =
  | (keyof Row & string)[]
  | { constraint: string }

type ConflictAction =
  | { kind: 'nothing' }
  | { kind: 'update'; assignments: Record<string, unknown> }

export interface ConflictBuilder<Row> {
  doNothing(): InsertBuilder<Row>
  doUpdate(assignments: Partial<{ [K in keyof Row]: ConflictAssignment<Row[K]> }>): InsertBuilder<Row>
}

export class InsertBuilder<Row> {
  private readonly queryable: Queryable
  private readonly tableName: string
  private rows: Record<string, unknown>[] = []
  private returningClause: string | undefined
  private conflictTarget: ConflictTarget<Row> | undefined
  private conflictAction: ConflictAction | undefined
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

  values(data: Record<string, unknown> | Record<string, unknown>[]): this {
    this.rows = Array.isArray(data) ? data : [data]
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

  onConflict(target: ConflictTarget<Row>): ConflictBuilder<Row> {
    this.conflictTarget = target
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    return {
      doNothing(): InsertBuilder<Row> {
        self.conflictAction = { kind: 'nothing' }
        return self
      },
      doUpdate(assignments: Record<string, unknown>): InsertBuilder<Row> {
        self.conflictAction = { kind: 'update', assignments }
        return self
      },
    }
  }

  toQuery(): QuerySpec {
    const [firstRow] = this.rows
    if (!firstRow) {
      throw new Error('No values provided for INSERT')
    }

    const keys = Object.keys(firstRow)
    const snakeKeys = keys.map(toSnakeCase)

    const values: unknown[] = []
    const rowPlaceholders: string[] = []

    for (const row of this.rows) {
      const placeholders = keys.map((k) => {
        values.push(row[k])
        return `$${values.length}`
      })
      rowPlaceholders.push(`(${placeholders.join(', ')})`)
    }

    let text = `INSERT INTO ${this.tableName} (${snakeKeys.join(', ')}) VALUES ${rowPlaceholders.join(', ')}`

    // ON CONFLICT clause
    if (this.conflictTarget && this.conflictAction) {
      const targetStr = Array.isArray(this.conflictTarget)
        ? `(${this.conflictTarget.map(c => toSnakeCase(c)).join(', ')})`
        : `ON CONSTRAINT ${this.conflictTarget.constraint}`

      text += ` ON CONFLICT ${targetStr.startsWith('ON') ? targetStr : targetStr}`

      if (this.conflictAction.kind === 'nothing') {
        text += ' DO NOTHING'
      } else {
        const setParts: string[] = []
        for (const [camelKey, value] of Object.entries(this.conflictAction.assignments)) {
          const col = toSnakeCase(camelKey)
          if (typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value)) {
            const v = value as Record<string, unknown>
            if (v['excluded'] === true) {
              setParts.push(`${col} = EXCLUDED.${col}`)
              continue
            }
            if (typeof v['increment'] === 'number') {
              values.push(v['increment'])
              setParts.push(`${col} = ${this.tableName}.${col} + $${values.length}`)
              continue
            }
            if (typeof v['decrement'] === 'number') {
              values.push(v['decrement'])
              setParts.push(`${col} = ${this.tableName}.${col} - $${values.length}`)
              continue
            }
          }
          // Plain literal value
          values.push(value)
          setParts.push(`${col} = $${values.length}`)
        }
        text += ` DO UPDATE SET ${setParts.join(', ')}`
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
