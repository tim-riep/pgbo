import { describe, it, expect, expectTypeOf } from 'vitest'
import { table } from '../../src/schema/table.js'
import { text, integer, timestamp, boolean, serial } from '../../src/schema/types.js'
import type { InferRow, InferInsert, InferUpdate } from '../../src/schema/infer.js'

const users = table('users', {
  columns: {
    id: serial().notNull(),
    name: text().notNull(),
    email: text().notNull().unique(),
    age: integer(),
    active: boolean().default(true),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['id'],
})

type UserRow = InferRow<typeof users>
type UserInsert = InferInsert<typeof users>
type UserUpdate = InferUpdate<typeof users>

describe('Type inference', () => {
  it('InferRow extracts all column types from table', () => {
    expectTypeOf<UserRow>().toHaveProperty('id')
    expectTypeOf<UserRow>().toHaveProperty('name')
    expectTypeOf<UserRow['id']>().toEqualTypeOf<number>()
    expectTypeOf<UserRow['name']>().toEqualTypeOf<string>()
    expectTypeOf<UserRow['age']>().toEqualTypeOf<number | null>()
    expectTypeOf<UserRow['active']>().toEqualTypeOf<boolean | null>()
    expectTypeOf<UserRow['createdAt']>().toEqualTypeOf<Date | null>()
  })

  it('InferInsert makes columns with defaults optional', () => {
    // id (serial = has default), active (has default), createdAt (has default) should be optional
    expectTypeOf<{ id?: number; active?: boolean | null; createdAt?: Date | null }>()
      .toMatchTypeOf<Pick<UserInsert, 'id' | 'active' | 'createdAt'>>()
  })

  it('InferInsert makes nullable columns optional', () => {
    // age is nullable, so it should be optional
    expectTypeOf<{ age?: number | null }>()
      .toMatchTypeOf<Pick<UserInsert, 'age'>>()
  })

  it('InferInsert requires non-null non-default columns', () => {
    // name and email are notNull with no default — required
    expectTypeOf<UserInsert>().toHaveProperty('name')
    expectTypeOf<UserInsert>().toHaveProperty('email')
  })

  it('InferUpdate makes all columns optional', () => {
    expectTypeOf<UserUpdate>().toMatchTypeOf<Partial<UserRow>>()
  })

  it('camelCase column names in TS, snake_case in PG', () => {
    const t = table('example', {
      columns: {
        createdAt: timestamp().defaultNow(),
        tenantId: integer().notNull(),
      },
      primaryKey: ['tenantId'],
    })
    const ddl = t.toSQL()
    // DDL uses snake_case
    expect(ddl).toContain('created_at')
    expect(ddl).toContain('tenant_id')
    // But the TS columns object uses camelCase keys
    expect(Object.keys(t.columns)).toContain('createdAt')
    expect(Object.keys(t.columns)).toContain('tenantId')
  })
})
