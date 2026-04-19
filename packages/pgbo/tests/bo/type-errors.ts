// This file is NOT a test — it's checked with tsc to verify type errors.
// Each @ts-expect-error should trigger a real error underneath.

import { table } from '../../src/schema/table.js'
import { text, integer, timestamp } from '../../src/schema/types.js'
import { defineBO } from '../../src/bo/index.js'
import type { Database } from '../../src/query/client.js'

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

declare const db: Database

// @ts-expect-error — missing required 'name' field
bo.create(db, {}, { slug: 'test' })

// @ts-expect-error — wrong type for capacity (string instead of number)
bo.create(db, {}, { slug: 'x', name: 'X', capacity: 'not a number' })

// @ts-expect-error — delete needs slug (paramField)
bo.delete(db, {}, {})

// @ts-expect-error — update needs slug (paramField)
bo.update(db, {}, { name: 'Updated' })
