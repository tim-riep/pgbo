import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { foreignKey } from '../../src/schema/constraints.js'
import { defineBO } from '../../src/bo/index.js'
import { enrichCompositions } from '../../src/bo/enrich.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const menuGroupTable = table('menu_group', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
  },
  primaryKey: ['id'],
})

const menuGroupTranslationTable = table('menu_group_translation', {
  columns: {
    menuGroupId: integer().notNull(),
    locale: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['menuGroupId', 'locale'],
  foreignKeys: [
    foreignKey(['menuGroupId']).references('menu_group', ['id']).onDelete('CASCADE'),
  ],
})

const menuGroupPageTable = table('menu_group_page', {
  columns: {
    id: integer().notNull(),
    menuGroupId: integer().notNull(),
    pageSlug: text().notNull(),
  },
  primaryKey: ['id'],
  foreignKeys: [
    foreignKey(['menuGroupId']).references('menu_group', ['id']).onDelete('CASCADE'),
  ],
})

const menuGroupView = view('menu_group_view').from(menuGroupTable)

describe('enrichCompositions (issue 018)', () => {
  let testDb: TestDatabase

  const menuGroupBO = defineBO(menuGroupTable, {
    paramField: 'id',
    actions: { create: {}, update: {}, delete: {} },
    compositions: {
      translations: {
        table: menuGroupTranslationTable,
        parentKey: 'menuGroupId',
      },
      pages: {
        table: menuGroupPageTable,
        parentKey: 'menuGroupId',
      },
    },
  })

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [menuGroupTable, menuGroupTranslationTable, menuGroupPageTable],
      seed: [
        'CREATE OR REPLACE VIEW menu_group_view AS SELECT * FROM menu_group',
        "INSERT INTO menu_group (id, slug) VALUES (1, 'nav')",
        "INSERT INTO menu_group (id, slug) VALUES (2, 'admin')",
        "INSERT INTO menu_group_translation (menu_group_id, locale, name) VALUES (1, 'en', 'Navigation')",
        "INSERT INTO menu_group_translation (menu_group_id, locale, name) VALUES (1, 'de', 'Navigation DE')",
        "INSERT INTO menu_group_translation (menu_group_id, locale, name) VALUES (2, 'en', 'Admin')",
        "INSERT INTO menu_group_page (id, menu_group_id, page_slug) VALUES (10, 1, 'home')",
        "INSERT INTO menu_group_page (id, menu_group_id, page_slug) VALUES (11, 1, 'dashboard')",
        "INSERT INTO menu_group_page (id, menu_group_id, page_slug) VALUES (12, 2, 'settings')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('batch-loads all compositions in parallel', async () => {
    const items = await testDb.db.from(menuGroupView).orderBy('id', 'asc').execute()
    const enriched = await enrichCompositions(testDb.db, menuGroupBO, items)

    expect(enriched).toHaveLength(2)

    // Group 1 — nav
    const nav = enriched[0]!
    expect(nav.slug).toBe('nav')
    expect(nav.translations).toHaveLength(2)
    expect(nav.pages).toHaveLength(2)
    expect((nav.translations as any[]).map((t: any) => t.locale).sort()).toEqual(['de', 'en'])
    expect((nav.pages as any[]).map((p: any) => p.pageSlug).sort()).toEqual(['dashboard', 'home'])

    // Group 2 — admin
    const admin = enriched[1]!
    expect(admin.slug).toBe('admin')
    expect(admin.translations).toHaveLength(1)
    expect(admin.pages).toHaveLength(1)
  })

  it('returns empty arrays for compositions with no children', async () => {
    // Insert a group with no translations or pages
    await testDb.raw("INSERT INTO menu_group (id, slug) VALUES (3, 'empty')")

    const items = await testDb.db.from(menuGroupView).where({ slug: 'empty' }).execute()
    const enriched = await enrichCompositions(testDb.db, menuGroupBO, items)

    expect(enriched[0]!.translations).toEqual([])
    expect(enriched[0]!.pages).toEqual([])

    await testDb.raw("DELETE FROM menu_group WHERE id = 3")
  })

  it('handles empty items array without querying', async () => {
    const enriched = await enrichCompositions(testDb.db, menuGroupBO, [])
    expect(enriched).toEqual([])
  })

  it('does not mutate original items', async () => {
    const items = await testDb.db.from(menuGroupView).execute()
    const original = items.map(i => ({ ...i }))
    await enrichCompositions(testDb.db, menuGroupBO, items)
    expect(items).toEqual(original)
  })

  it('converts snake_case keys to camelCase in children', async () => {
    const items = await testDb.db.from(menuGroupView).where({ slug: 'nav' }).execute()
    const enriched = await enrichCompositions(testDb.db, menuGroupBO, items)

    const page = (enriched[0]!.pages as any[])[0]!
    expect(page.menuGroupId).toBeDefined()
    expect(page.pageSlug).toBeDefined()
    expect(page.menu_group_id).toBeUndefined()
    expect(page.page_slug).toBeUndefined()
  })
})
