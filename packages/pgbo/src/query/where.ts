// WHERE clause builder — parameterized SQL generation

import { toSnakeCase } from '../schema/table.js'

export interface WhereOperator {
  eq?: unknown
  like?: string
  ilike?: string
  in?: unknown[]
  /** col = ANY($1) — single bound param, dynamic-length arrays */
  any?: unknown[]
  /** col != ALL($1) — single bound param, dynamic-length arrays */
  notAny?: unknown[]
  gt?: unknown
  lt?: unknown
  gte?: unknown
  lte?: unknown
  between?: [unknown, unknown]
  isNull?: boolean
  isNotNull?: boolean
}

export type WhereConditions = {
  OR?: WhereConditions[]
  AND?: WhereConditions[]
  NOT?: WhereConditions
  [column: string]: unknown
}

export interface WhereResult {
  text: string
  values: unknown[]
}

const LOGICAL_KEYS = new Set(['OR', 'AND', 'NOT'])

function isOperatorObject(value: unknown): value is WhereOperator {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || value instanceof Date) {
    return false
  }
  const keys = Object.keys(value)
  const operatorKeys = ['eq', 'like', 'ilike', 'in', 'any', 'notAny', 'gt', 'lt', 'gte', 'lte', 'between', 'isNull', 'isNotNull']
  return keys.length > 0 && keys.every(k => operatorKeys.includes(k))
}

export function buildWhere(conditions: WhereConditions, startParam = 1): WhereResult {
  const state = { paramIdx: startParam }
  const result = buildWhereRecursive(conditions, state)
  return result
}

function buildWhereRecursive(
  conditions: WhereConditions,
  state: { paramIdx: number },
): WhereResult {
  const clauses: string[] = []
  const values: unknown[] = []

  for (const [key, value] of Object.entries(conditions)) {
    if (value === undefined) continue

    // Handle logical operators
    if (key === 'OR' && Array.isArray(value)) {
      const subClauses: string[] = []
      for (const sub of value as WhereConditions[]) {
        const result = buildWhereRecursive(sub, state)
        if (result.text) {
          subClauses.push(result.text)
          values.push(...result.values)
        }
      }
      if (subClauses.length > 0) {
        clauses.push(`(${subClauses.join(' OR ')})`)
      }
      continue
    }

    if (key === 'AND' && Array.isArray(value)) {
      const subClauses: string[] = []
      for (const sub of value as WhereConditions[]) {
        const result = buildWhereRecursive(sub, state)
        if (result.text) {
          subClauses.push(result.text)
          values.push(...result.values)
        }
      }
      if (subClauses.length > 0) {
        clauses.push(`(${subClauses.join(' AND ')})`)
      }
      continue
    }

    if (key === 'NOT' && typeof value === 'object' && !Array.isArray(value)) {
      const result = buildWhereRecursive(value as WhereConditions, state)
      if (result.text) {
        clauses.push(`NOT (${result.text})`)
        values.push(...result.values)
      }
      continue
    }

    // Skip logical keys that didn't match above (shouldn't happen)
    if (LOGICAL_KEYS.has(key)) continue

    // Regular column condition
    const col = toSnakeCase(key)

    if (isOperatorObject(value)) {
      const op = value

      if (op.eq !== undefined) {
        clauses.push(`${col} = $${state.paramIdx++}`)
        values.push(op.eq)
      } else if (op.like !== undefined) {
        clauses.push(`${col} LIKE $${state.paramIdx++}`)
        values.push(op.like)
      } else if (op.ilike !== undefined) {
        clauses.push(`${col} ILIKE $${state.paramIdx++}`)
        values.push(op.ilike)
      } else if (op.in !== undefined) {
        const placeholders = op.in.map(() => `$${state.paramIdx++}`)
        clauses.push(`${col} IN (${placeholders.join(', ')})`)
        values.push(...op.in)
      } else if (op.any !== undefined) {
        if (op.any.length === 0) {
          clauses.push('FALSE')
        } else {
          clauses.push(`${col} = ANY($${state.paramIdx++})`)
          values.push(op.any)
        }
      } else if (op.notAny !== undefined) {
        if (op.notAny.length === 0) {
          clauses.push('TRUE')
        } else {
          clauses.push(`${col} != ALL($${state.paramIdx++})`)
          values.push(op.notAny)
        }
      } else if (op.gt !== undefined) {
        clauses.push(`${col} > $${state.paramIdx++}`)
        values.push(op.gt)
      } else if (op.lt !== undefined) {
        clauses.push(`${col} < $${state.paramIdx++}`)
        values.push(op.lt)
      } else if (op.gte !== undefined) {
        clauses.push(`${col} >= $${state.paramIdx++}`)
        values.push(op.gte)
      } else if (op.lte !== undefined) {
        clauses.push(`${col} <= $${state.paramIdx++}`)
        values.push(op.lte)
      } else if (op.between !== undefined) {
        clauses.push(`${col} BETWEEN $${state.paramIdx++} AND $${state.paramIdx++}`)
        values.push(op.between[0], op.between[1])
      } else if (op.isNull) {
        clauses.push(`${col} IS NULL`)
      } else if (op.isNotNull) {
        clauses.push(`${col} IS NOT NULL`)
      }
    } else {
      clauses.push(`${col} = $${state.paramIdx++}`)
      values.push(value)
    }
  }

  return {
    text: clauses.join(' AND '),
    values,
  }
}
