import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { foreignKey } from '../../src/schema/constraints.js'
import { defineBO } from '../../src/bo/index.js'
import { enrichCompositions } from '../../src/bo/enrich.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const roleTable = table('role', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
  },
  primaryKey: ['id'],
})

const roleFragmentTable = table('role_fragment', {
  columns: {
    id: integer().notNull(),
    roleId: integer().notNull(),
    fragmentSlug: text().notNull(),
  },
  primaryKey: ['id'],
  foreignKeys: [
    foreignKey(['roleId']).references('role', ['id']).onDelete('CASCADE'),
  ],
})

const roleFragmentValueTable = table('role_fragment_value', {
  columns: {
    id: integer().notNull(),
    roleFragmentId: integer().notNull(),
    fieldSlug: text().notNull(),
    value: text().notNull(),
  },
  primaryKey: ['id'],
  foreignKeys: [
    foreignKey(['roleFragmentId']).references('role_fragment', ['id']).onDelete('CASCADE'),
  ],
})

const roleView = view('role_view').from(roleTable)

describe('enrichCompositions — nested children (issue 019)', () => {
  let testDb: TestDatabase

  const roleBO = defineBO(roleTable, {
    paramField: 'id',
    actions: { create: {}, delete: {} },
    compositions: {
      fragments: {
        table: roleFragmentTable,
        parentKey: 'roleId',
        children: {
          values: {
            table: roleFragmentValueTable,
            parentKey: 'roleFragmentId',
          },
        },
      },
    },
  })

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [roleTable, roleFragmentTable, roleFragmentValueTable],
      seed: [
        'CREATE OR REPLACE VIEW role_view AS SELECT * FROM role',
        "INSERT INTO role (id, slug) VALUES (1, 'admin')",
        "INSERT INTO role (id, slug) VALUES (2, 'viewer')",
        "INSERT INTO role_fragment (id, role_id, fragment_slug) VALUES (10, 1, 'MANAGE_STOCK')",
        "INSERT INTO role_fragment (id, role_id, fragment_slug) VALUES (11, 1, 'MANAGE_USERS')",
        "INSERT INTO role_fragment (id, role_id, fragment_slug) VALUES (12, 2, 'VIEW_REPORTS')",
        "INSERT INTO role_fragment_value (id, role_fragment_id, field_slug, value) VALUES (100, 10, 'ACTION', '*')",
        "INSERT INTO role_fragment_value (id, role_fragment_id, field_slug, value) VALUES (101, 10, 'WAREHOUSE', '*')",
        "INSERT INTO role_fragment_value (id, role_fragment_id, field_slug, value) VALUES (102, 11, 'SCOPE', 'OWN')",
        "INSERT INTO role_fragment_value (id, role_fragment_id, field_slug, value) VALUES (103, 12, 'REPORT', 'DAILY')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('loads fragments with nested values', async () => {
    const items = await testDb.db.from(roleView).orderBy('id', 'asc').execute()
    const enriched = await enrichCompositions(testDb.db, roleBO, items)

    expect(enriched).toHaveLength(2)

    // Admin role
    const admin = enriched[0]!
    expect(admin.slug).toBe('admin')
    const fragments = admin.fragments as any[]
    expect(fragments).toHaveLength(2)

    const manageStock = fragments.find((f: any) => f.fragmentSlug === 'MANAGE_STOCK')!
    expect(manageStock.values).toHaveLength(2)
    expect(manageStock.values.map((v: any) => v.fieldSlug).sort()).toEqual(['ACTION', 'WAREHOUSE'])

    const manageUsers = fragments.find((f: any) => f.fragmentSlug === 'MANAGE_USERS')!
    expect(manageUsers.values).toHaveLength(1)
    expect(manageUsers.values[0].fieldSlug).toBe('SCOPE')

    // Viewer role
    const viewer = enriched[1]!
    const viewFragments = viewer.fragments as any[]
    expect(viewFragments).toHaveLength(1)
    expect(viewFragments[0].values).toHaveLength(1)
    expect(viewFragments[0].values[0].fieldSlug).toBe('REPORT')
  })

  it('sub-children are empty arrays when none exist', async () => {
    await testDb.raw("INSERT INTO role (id, slug) VALUES (3, 'empty')")
    await testDb.raw("INSERT INTO role_fragment (id, role_id, fragment_slug) VALUES (13, 3, 'NO_VALUES')")

    const items = await testDb.db.from(roleView).where({ slug: 'empty' }).execute()
    const enriched = await enrichCompositions(testDb.db, roleBO, items)

    const fragments = enriched[0]!.fragments as any[]
    expect(fragments).toHaveLength(1)
    expect(fragments[0].values).toEqual([])

    await testDb.raw("DELETE FROM role WHERE id = 3")
  })

  it('camelCase keys in nested children', async () => {
    const items = await testDb.db.from(roleView).where({ slug: 'admin' }).execute()
    const enriched = await enrichCompositions(testDb.db, roleBO, items)

    const fragment = (enriched[0]!.fragments as any[])[0]!
    const value = fragment.values[0]!
    expect(value.roleFragmentId).toBeDefined()
    expect(value.fieldSlug).toBeDefined()
    expect(value.role_fragment_id).toBeUndefined()
    expect(value.field_slug).toBeUndefined()
  })
})
