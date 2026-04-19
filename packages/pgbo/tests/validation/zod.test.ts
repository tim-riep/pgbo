import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { zodSchemas, zodToJsonSchema } from '../../src/validation/index.js'
import { table } from '../../src/schema/table.js'
import { text, integer, boolean, uuid, timestamp, numeric, serial } from '../../src/schema/types.js'
import { pgEnum } from '../../src/schema/enum.js'

const stockType = pgEnum('stock_type', ['RECEIPT', 'ADJUSTMENT', 'TRANSFER'])

const users = table('users', {
  columns: {
    id: serial().notNull(),
    name: text().notNull().minLength(1).maxLength(100),
    email: text().notNull().pattern(/^[^@]+@[^@]+$/),
    age: integer().min(0).max(150),
    score: numeric().positive(),
    active: boolean().default(true),
    externalId: uuid(),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['id'],
})

describe('Zod schema generation', () => {
  it('zodSchemas(table) returns { row, insert, update, partial }', () => {
    const schemas = zodSchemas(users)
    expect(schemas).toHaveProperty('row')
    expect(schemas).toHaveProperty('insert')
    expect(schemas).toHaveProperty('update')
    expect(schemas).toHaveProperty('partial')
  })

  it('text column → z.string()', () => {
    const { row } = zodSchemas(users)
    expect(row.parse({ id: 1, name: 'Alice', email: 'a@b', age: null, score: null, active: null, externalId: null, createdAt: null }).name).toBe('Alice')
  })

  it('integer column → z.number().int()', () => {
    const { row } = zodSchemas(users)
    expect(() => row.parse({ id: 1.5, name: 'A', email: 'a@b', age: null, score: null, active: null, externalId: null, createdAt: null })).toThrow()
  })

  it('uuid column → z.string().uuid()', () => {
    const { row } = zodSchemas(users)
    const valid = { id: 1, name: 'A', email: 'a@b', age: null, score: null, active: null, externalId: '550e8400-e29b-41d4-a716-446655440000', createdAt: null }
    expect(row.parse(valid).externalId).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('boolean column → z.boolean()', () => {
    const { row } = zodSchemas(users)
    const valid = { id: 1, name: 'A', email: 'a@b', age: null, score: null, active: true, externalId: null, createdAt: null }
    expect(row.parse(valid).active).toBe(true)
  })

  it('timestamp column → z.date()', () => {
    const { row } = zodSchemas(users)
    const now = new Date()
    const valid = { id: 1, name: 'A', email: 'a@b', age: null, score: null, active: null, externalId: null, createdAt: now }
    expect(row.parse(valid).createdAt).toEqual(now)
  })

  it('numeric column → z.number()', () => {
    const { row } = zodSchemas(users)
    const valid = { id: 1, name: 'A', email: 'a@b', age: null, score: 3.14, active: null, externalId: null, createdAt: null }
    expect(row.parse(valid).score).toBe(3.14)
  })

  it('domain constraints map to Zod refinements (min, max, regex)', () => {
    const { insert } = zodSchemas(users)
    // name: minLength(1), maxLength(100)
    expect(() => insert.parse({ name: '', email: 'a@b' })).toThrow()
    // email: pattern
    expect(() => insert.parse({ name: 'A', email: 'invalid' })).toThrow()
    // age: min(0), max(150)
    expect(() => insert.parse({ name: 'A', email: 'a@b', age: -1 })).toThrow()
    expect(() => insert.parse({ name: 'A', email: 'a@b', age: 200 })).toThrow()
  })

  it('notNull column → required in insert schema', () => {
    const { insert } = zodSchemas(users)
    // name and email are notNull without defaults — required
    expect(() => insert.parse({})).toThrow()
    expect(() => insert.parse({ name: 'A' })).toThrow()
  })

  it('column with default → optional in insert schema', () => {
    const { insert } = zodSchemas(users)
    // id (serial), active (default), createdAt (default) should be optional
    const result = insert.parse({ name: 'Alice', email: 'a@b' })
    expect(result.name).toBe('Alice')
  })

  it('nullable column → .nullable()', () => {
    const { row } = zodSchemas(users)
    // age is nullable
    const valid = { id: 1, name: 'A', email: 'a@b', age: null, score: null, active: null, externalId: null, createdAt: null }
    expect(row.parse(valid).age).toBeNull()
  })

  it('update schema makes all fields optional', () => {
    const { update } = zodSchemas(users)
    // Empty object should be valid for update
    expect(update.parse({})).toEqual({})
    expect(update.parse({ name: 'Bob' })).toEqual({ name: 'Bob' })
  })

  it('zodToJsonSchema() produces valid JSON Schema', () => {
    const { row } = zodSchemas(users)
    const jsonSchema = zodToJsonSchema(row)
    expect(jsonSchema).toHaveProperty('type', 'object')
    expect(jsonSchema).toHaveProperty('properties')
    expect(jsonSchema.properties).toHaveProperty('name')
    expect(jsonSchema.properties).toHaveProperty('id')
  })
})
