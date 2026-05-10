// Helpers that abstract over single-vs-composite paramField (issue #51).
//
// A BO's `paramField` is either:
//   - a single string (simple key, e.g. 'id', 'slug'), or
//   - a `readonly string[]` (composite key, e.g. ['warehouseSlug', 'slug'])
//
// These helpers let action / enrichment code treat both forms uniformly without
// peppering call sites with `Array.isArray` checks.

import type { WhereConditions } from '../query/where.js'

/** Normalise paramField to an array of column names. */
export function paramFieldList(paramField: string | readonly string[]): readonly string[] {
  return typeof paramField === 'string' ? [paramField] : paramField
}

/** True if the BO uses a composite key. */
export function isComposite(paramField: string | readonly string[]): boolean {
  return typeof paramField !== 'string'
}

/**
 * Build a WHERE clause from a paramField + value(s).
 *
 * For a simple key, `value` may be the scalar (`'A1'`) or a single-entry record (`{ slug: 'A1' }`).
 * For a composite key, `value` must be a record covering every key column.
 */
export function keyToWhere(
  paramField: string | readonly string[],
  value: unknown,
): WhereConditions {
  if (typeof paramField === 'string') {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const v = (value as Record<string, unknown>)[paramField]
      return { [paramField]: v }
    }
    return { [paramField]: value as string | number }
  }
  if (value === null || typeof value !== 'object') {
    throw new Error(
      `Composite paramField [${paramField.join(', ')}] requires an object value, got ${typeof value}`,
    )
  }
  const obj = value as Record<string, unknown>
  const where: Record<string, unknown> = {}
  for (const k of paramField) {
    if (!(k in obj)) {
      throw new Error(`Composite paramField is missing column "${k}" in value`)
    }
    where[k] = obj[k]
  }
  return where as WhereConditions
}

/**
 * Extract the key columns from a row. For simple keys returns the scalar value.
 * For composite keys returns a `{ col: val, ... }` record covering every key column.
 */
export function extractKey(
  paramField: string | readonly string[],
  row: Record<string, unknown>,
): unknown {
  if (typeof paramField === 'string') return row[paramField]
  const out: Record<string, unknown> = {}
  for (const k of paramField) out[k] = row[k]
  return out
}

/** Stringify a primitive key column. Non-primitive values collapse to empty —
 *  keys come out of Postgres so this is mostly defensive. */
function stringifyScalar(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}

/**
 * Stable string hash of a row's key columns — usable as a JS `Map` key for
 * grouping. For simple keys this is the value coerced to string; for composite
 * keys it joins each column's value with a sentinel separator.
 */
export function keyHash(
  paramField: string | readonly string[],
  row: Record<string, unknown>,
): string {
  if (typeof paramField === 'string') return stringifyScalar(row[paramField])
  return paramField.map(k => stringifyScalar(row[k])).join('')
}

/**
 * Hash a key value (scalar or record) the same way as `keyHash` hashes a row.
 * Used when an FK or composite-key value isn't fronted by a row object.
 */
export function valueHash(
  paramField: string | readonly string[],
  value: unknown,
): string {
  if (typeof paramField === 'string') return stringifyScalar(value)
  if (value === null || typeof value !== 'object') return ''
  const obj = value as Record<string, unknown>
  return paramField.map(k => stringifyScalar(obj[k])).join('')
}
