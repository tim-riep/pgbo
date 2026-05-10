// Zod schema generation from table/view definitions — Phase 5 (Step 15)

import { z, toJSONSchema } from 'zod'
import type { TableDef, ColumnDef } from '../schema/definitions.js'

export interface ZodSchemas {
  row: z.ZodObject<any>
  insert: z.ZodObject<any>
  update: z.ZodObject<any>
  partial: z.ZodObject<any>
}

function columnToZodType(def: ColumnDef): z.ZodType {
  let schema: z.ZodType

  // Base type mapping
  const pgType = def.pgType
  if (pgType === 'text' || pgType === 'varchar') {
    let s = z.string()
    // Apply text constraints from checks
    for (const check of def.checks) {
      const minMatch = check.sql.match(/length\(VALUE\) >= (\d+)/)
      if (minMatch) s = s.min(Number(minMatch[1]))

      const maxMatch = check.sql.match(/length\(VALUE\) <= (\d+)/)
      if (maxMatch) s = s.max(Number(maxMatch[1]))

      const patternMatch = /VALUE ~ '(.+)'/.exec(check.sql)
      const patternStr = patternMatch?.[1]
      if (patternStr) s = s.regex(new RegExp(patternStr))
    }
    schema = s
  } else if (pgType === 'integer' || pgType === 'int4' || pgType === 'serial') {
    let n = z.number().int()
    for (const check of def.checks) {
      const minMatch = check.sql.match(/VALUE >= (\d+)/)
      if (minMatch) n = n.min(Number(minMatch[1]))
      const maxMatch = check.sql.match(/VALUE <= (\d+)/)
      if (maxMatch) n = n.max(Number(maxMatch[1]))
      if (check.sql === 'VALUE > 0') n = n.min(1)
    }
    schema = n
  } else if (pgType === 'bigint' || pgType === 'bigserial') {
    schema = z.string()
  } else if (pgType === 'numeric' || pgType === 'real' || pgType === 'double precision') {
    let n = z.number()
    for (const check of def.checks) {
      const minMatch = check.sql.match(/VALUE >= (\d+)/)
      if (minMatch) n = n.min(Number(minMatch[1]))
      const maxMatch = check.sql.match(/VALUE <= (\d+)/)
      if (maxMatch) n = n.max(Number(maxMatch[1]))
      if (check.sql === 'VALUE > 0') n = n.min(Number.MIN_VALUE)
    }
    schema = n
  } else if (pgType === 'boolean') {
    schema = z.boolean()
  } else if (pgType === 'uuid') {
    schema = z.uuid()
  } else if (pgType === 'timestamp' || pgType === 'timestamptz') {
    schema = z.date()
  } else if (pgType === 'date') {
    schema = z.string()
  } else if (pgType === 'time') {
    schema = z.string()
  } else if (pgType === 'jsonb' || pgType === 'json') {
    schema = z.unknown()
  } else if (pgType === 'bytea') {
    schema = z.instanceof(Buffer)
  } else {
    schema = z.unknown()
  }

  return schema
}

export function zodSchemas(tableDef: TableDef): ZodSchemas {
  const rowShape: Record<string, z.ZodType> = {}
  const insertShape: Record<string, z.ZodType> = {}

  for (const [colName, colBuilder] of Object.entries(tableDef.columns)) {
    const def: ColumnDef = (colBuilder)._def
    const baseSchema = columnToZodType(def)

    // Row schema: nullable columns get .nullable()
    if (def.isNullable) {
      rowShape[colName] = baseSchema.nullable()
    } else {
      rowShape[colName] = baseSchema
    }

    // Insert schema: determine if optional
    const hasDefault = def.defaultValue !== undefined
      || def.pgType === 'serial'
      || def.pgType === 'bigserial'
    const isOptional = def.isNullable || hasDefault

    if (isOptional) {
      if (def.isNullable) {
        insertShape[colName] = baseSchema.nullable().optional()
      } else {
        insertShape[colName] = baseSchema.optional()
      }
    } else {
      insertShape[colName] = baseSchema
    }
  }

  const row = z.object(rowShape)
  const insert = z.object(insertShape)
  const update = z.object(
    Object.fromEntries(
      Object.entries(rowShape).map(([k, v]) => [k, v.optional()])
    )
  )
  const partial = update

  return { row, insert, update, partial }
}

/** Convert a Zod schema to JSON Schema, replacing z.date() with z.string() */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // Replace z.date() with z.string() for JSON Schema compat
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>
    const newShape: Record<string, z.ZodType> = {}
    for (const [key, val] of Object.entries(shape)) {
      newShape[key] = replaceDateWithString(val)
    }
    return toJSONSchema(z.object(newShape))
  }
  return toJSONSchema(schema)
}

function replaceDateWithString(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodDate) {
    return z.string()
  }
  if (schema instanceof z.ZodNullable) {
    return replaceDateWithString(schema.unwrap() as z.ZodType).nullable()
  }
  if (schema instanceof z.ZodOptional) {
    return replaceDateWithString(schema.unwrap() as z.ZodType).optional()
  }
  return schema
}
