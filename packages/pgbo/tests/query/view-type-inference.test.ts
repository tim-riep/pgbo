import { describe, it, expectTypeOf } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { col } from '../../src/schema/column.js'
import { translated } from '../../src/schema/i18n.js'
import { text, integer, timestamp, boolean } from '../../src/schema/types.js'
import type { Database } from '../../src/query/client.js'

const usersTable = table('users', {
  columns: {
    id: integer().notNull(),
    name: text().notNull(),
    email: text().notNull(),
    age: integer(),
    active: boolean().default(true),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['id'],
})

const appTable = table('app', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['id'],
})

const tileTable = table('tile', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    appId: integer().notNull(),
  },
  primaryKey: ['id'],
})

// Simple view — no .columns()
const usersView = view('users_view').from(usersTable)

// View with .columns() from source table only — types inferred automatically
const usersColumnsView = view('users_cols_view').from(usersTable).columns({
  id: col('id'),
  name: col('name'),
  age: col('age'),
})

// View with joined columns — types inferred automatically via col(ref, sourceTable)
const tileDetailView = view('tile_detail_view')
  .from(tileTable)
  .join(appTable, { appId: 'id' })
  .columns({
    id: col('id'),
    slug: col('slug'),
    appSlug: col('slug', appTable),
    appName: col('name', appTable),
  })

// View with translated column
const areaTable = table('area', {
  columns: { slug: text().notNull(), sortOrder: integer() },
  primaryKey: ['slug'],
  translations: ['name'],
})

const areaView = view('area_view').from(areaTable).columns({
  slug: col('slug'),
  name: translated('name'),
})

declare const db: Database

describe('View type inference (issue 005)', () => {
  it('simple view (no .columns()): InferRow from source table', () => {
    type Row = Awaited<ReturnType<typeof db.from<typeof usersView>>['execute']>[number]

    expectTypeOf<Row>().toHaveProperty('id')
    expectTypeOf<Row>().toHaveProperty('name')
    expectTypeOf<Row>().toHaveProperty('email')
    expectTypeOf<Row['id']>().toEqualTypeOf<number>()
    expectTypeOf<Row['name']>().toEqualTypeOf<string>()
    expectTypeOf<Row['age']>().toEqualTypeOf<number | null>()
    expectTypeOf<Row['createdAt']>().toEqualTypeOf<Date | null>()
  })

  it('issue 007+008: unqualified col() infers type from source table via literal ref', () => {
    type Row = Awaited<ReturnType<typeof db.from<typeof usersColumnsView>>['execute']>[number]

    expectTypeOf<Row>().toHaveProperty('id')
    expectTypeOf<Row>().toHaveProperty('name')
    expectTypeOf<Row>().toHaveProperty('age')

    // col('id') ref is literal 'id', resolved to number from usersTable.columns.id
    expectTypeOf<Row['id']>().toEqualTypeOf<number>()
    expectTypeOf<Row['name']>().toEqualTypeOf<string>()
    expectTypeOf<Row['age']>().toEqualTypeOf<number | null>()
  })

  it('joined view: col(ref, sourceTable) infers type from joined table', () => {
    type Row = Awaited<ReturnType<typeof db.from<typeof tileDetailView>>['execute']>[number]

    expectTypeOf<Row>().toHaveProperty('id')
    expectTypeOf<Row>().toHaveProperty('slug')
    expectTypeOf<Row>().toHaveProperty('appSlug')
    expectTypeOf<Row>().toHaveProperty('appName')

    // Joined columns: col('slug', appTable) infers string from appTable.columns.slug
    expectTypeOf<Row['appSlug']>().toEqualTypeOf<string>()
    expectTypeOf<Row['appName']>().toEqualTypeOf<string>()
  })

  it('translated() column infers string | null', () => {
    type Row = Awaited<ReturnType<typeof db.from<typeof areaView>>['execute']>[number]

    expectTypeOf<Row>().toHaveProperty('name')
    expectTypeOf<Row['name']>().toEqualTypeOf<string | null>()
  })

  it('issue 006: plain view without .columns() does NOT return {}', () => {
    // This was a regression — plain views returned {} instead of the source table's row type
    const plainView = view('plain').from(usersTable)
    type Row = Awaited<ReturnType<typeof db.from<typeof plainView>>['execute']>[number]

    // Should have ALL columns from the source table
    expectTypeOf<Row['id']>().toEqualTypeOf<number>()
    expectTypeOf<Row['name']>().toEqualTypeOf<string>()
    expectTypeOf<Row['email']>().toEqualTypeOf<string>()
    expectTypeOf<Row['age']>().toEqualTypeOf<number | null>()
    expectTypeOf<Row['active']>().toEqualTypeOf<boolean | null>()
    expectTypeOf<Row['createdAt']>().toEqualTypeOf<Date | null>()
  })

  it('.as<T>() still works as escape hatch', () => {
    const customView = view('custom')
      .from(tileTable)
      .as<{ x: number; y: string }>()

    type Row = Awaited<ReturnType<typeof db.from<typeof customView>>['execute']>[number]
    expectTypeOf<Row['x']>().toEqualTypeOf<number>()
    expectTypeOf<Row['y']>().toEqualTypeOf<string>()
  })
})
