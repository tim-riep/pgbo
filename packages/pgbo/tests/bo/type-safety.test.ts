import { describe, it, expect, expectTypeOf } from 'vitest'
import { table } from '../../src/schema/table.js'
import { text, integer, timestamp } from '../../src/schema/types.js'
import { defineBO } from '../../src/bo/index.js'
import type { Database } from '../../src/query/client.js'
import type { InferRow, InferInsert } from '../../src/schema/infer.js'

const warehouse = table('warehouse', {
  columns: {
    slug: text().notNull(),
    name: text().notNull(),
    capacity: integer(),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['slug'],
})

const bo = defineBO(warehouse, {
  paramField: 'slug',
  actions: { create: {}, update: {}, delete: {} },
})

describe('BO type safety', () => {
  it('create accepts InferInsert-shaped data', () => {
    // The create method's first data param should match InferInsert
    type CreateData = Parameters<typeof bo.create>[2]

    // slug and name are required (notNull, no default)
    expectTypeOf<CreateData>().toHaveProperty('slug')
    expectTypeOf<CreateData>().toHaveProperty('name')
  })

  it('create return type is InferRow', async () => {
    type CreateReturn = Awaited<ReturnType<typeof bo.create>>

    expectTypeOf<CreateReturn>().toHaveProperty('slug')
    expectTypeOf<CreateReturn>().toHaveProperty('name')
    expectTypeOf<CreateReturn>().toHaveProperty('capacity')
    expectTypeOf<CreateReturn>().toHaveProperty('createdAt')
  })

  it('update requires paramField + optional fields', () => {
    type UpdateData = Parameters<typeof bo.update>[2]

    // slug (paramField) must be present
    expectTypeOf<UpdateData>().toHaveProperty('slug')
  })

  it('delete requires only paramField', () => {
    type DeleteData = Parameters<typeof bo.delete>[2]

    expectTypeOf<DeleteData>().toHaveProperty('slug')
  })

  it('read-only BO still has typed methods', () => {
    const readOnly = defineBO(warehouse, {})
    type CreateData = Parameters<typeof readOnly.create>[2]
    expectTypeOf<CreateData>().toHaveProperty('slug')
  })
})
