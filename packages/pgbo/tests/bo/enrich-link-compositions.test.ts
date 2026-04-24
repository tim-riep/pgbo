import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { foreignKey } from '../../src/schema/constraints.js'
import { defineBO } from '../../src/bo/index.js'
import { enrichCompositions } from '../../src/bo/enrich.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env.PGBO_TEST_URL ?? 'postgresql://localhost:5432/postgres'

const warehouseTable = table('warehouse', {
  columns: { slug: text().notNull(), name: text().notNull() },
  primaryKey: ['slug'],
})

const warehouseTranslationTable = table('warehouse_translation', {
  columns: {
    warehouseSlug: text().notNull(),
    locale: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['warehouseSlug', 'locale'],
  foreignKeys: [foreignKey(['warehouseSlug']).references('warehouse', ['slug']).onDelete('CASCADE')],
})

const productTable = table('product', {
  columns: {
    wku: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['wku'],
})

const productWarehouseTable = table('product_warehouse', {
  columns: {
    wku: text().notNull(),
    warehouseSlug: text().notNull(),
    archived: text(),  // 'yes' / null — test linkWhere
  },
  primaryKey: ['wku', 'warehouseSlug'],
})

const productView = view('product_view').from(productTable)
const warehouseView = view('warehouse_view').from(warehouseTable)

describe('Link-table compositions (M2M) — issue #25', () => {
  let testDb: TestDatabase

  // Target BO with a translation composition, so M2M reads get locale-resolved names
  const warehouseBO = defineBO(warehouseTable, {
    paramField: 'slug',
    actions: { create: {} },
    compositions: {
      translation: {
        table: warehouseTranslationTable,
        parentKey: 'warehouseSlug',
        cardinality: 'one',
        where: { locale: '$locale' },
        merge: ['name'],
      },
    },
  })

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [warehouseTable, warehouseTranslationTable, productTable, productWarehouseTable],
      seed: [
        'CREATE OR REPLACE VIEW product_view AS SELECT * FROM product',
        'CREATE OR REPLACE VIEW warehouse_view AS SELECT * FROM warehouse',
        "INSERT INTO warehouse (slug, name) VALUES ('main', 'Main'), ('returns', 'Returns'), ('hub', 'Hub')",
        "INSERT INTO warehouse_translation (warehouse_slug, locale, name) VALUES " +
          "('main','en','Main Warehouse'), ('main','de','Hauptlager'), " +
          "('returns','en','Returns Centre'), ('returns','de','Rücksendezentrum'), " +
          "('hub','en','Logistics Hub'), ('hub','de','Logistik-Hub')",
        "INSERT INTO product (wku, name) VALUES ('P1', 'Widget'), ('P2', 'Gizmo'), ('P3', 'Thingy')",
        "INSERT INTO product_warehouse (wku, warehouse_slug, archived) VALUES " +
          "('P1', 'main', null), ('P1', 'returns', null), ('P1', 'hub', 'yes'), " +
          "('P2', 'main', null), " +
          "('P3', 'hub', null)",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  describe('basic M2M load with BO target', () => {
    it('attaches target rows grouped per parent', async () => {
      const productBO = defineBO(productTable, {
        paramField: 'wku',
        actions: { create: {} },
        compositions: {
          warehouses: {
            linkTable: productWarehouseTable,
            linkParentKey: 'wku',
            linkTargetKey: 'warehouseSlug',
            target: warehouseBO,
          },
        },
      })

      const items = await testDb.db.from(productView).orderBy('wku', 'asc').execute()
      const enriched = await enrichCompositions(testDb.db, productBO, items, { ctx: { locale: 'en' } })

      const byWku = Object.fromEntries(enriched.map(p => [p.wku, p.warehouses]))

      const p1Slugs = (byWku['P1'] as any[]).map(w => w.slug).sort()
      expect(p1Slugs).toEqual(['hub', 'main', 'returns'])

      // Target BO's translation composition ran → each warehouse has locale-resolved `name`
      const mainForP1 = (byWku['P1'] as any[]).find(w => w.slug === 'main')
      expect(mainForP1.name).toBe('Main Warehouse')

      expect((byWku['P2'] as any[]).map(w => w.slug)).toEqual(['main'])
      expect((byWku['P3'] as any[]).map(w => w.slug)).toEqual(['hub'])
    })

    it('runs target compositions at different locales', async () => {
      const productBO = defineBO(productTable, {
        paramField: 'wku',
        actions: { create: {} },
        compositions: {
          warehouses: {
            linkTable: productWarehouseTable,
            linkParentKey: 'wku',
            linkTargetKey: 'warehouseSlug',
            target: warehouseBO,
          },
        },
      })

      const items = await testDb.db.from(productView).where({ wku: 'P1' }).execute()
      const de = await enrichCompositions(testDb.db, productBO, items, { ctx: { locale: 'de' } })

      const names = ((de[0] as any).warehouses as any[]).map(w => w.name).sort()
      expect(names).toEqual(['Hauptlager', 'Logistik-Hub', 'Rücksendezentrum'])
    })
  })

  describe('columns narrowing', () => {
    it('limits the exposed target fields', async () => {
      const productBO = defineBO(productTable, {
        paramField: 'wku',
        actions: { create: {} },
        compositions: {
          warehouses: {
            linkTable: productWarehouseTable,
            linkParentKey: 'wku',
            linkTargetKey: 'warehouseSlug',
            target: warehouseBO,
            columns: ['slug'],  // hide name, etc.
          },
        },
      })

      const items = await testDb.db.from(productView).where({ wku: 'P2' }).execute()
      const enriched = await enrichCompositions(testDb.db, productBO, items, { ctx: { locale: 'en' } })
      const warehouses = (enriched[0] as any).warehouses as Record<string, unknown>[]
      expect(warehouses).toEqual([{ slug: 'main' }])
    })
  })

  describe('linkWhere filters the join rows', () => {
    it('drops archived links', async () => {
      const productBO = defineBO(productTable, {
        paramField: 'wku',
        actions: { create: {} },
        compositions: {
          activeWarehouses: {
            linkTable: productWarehouseTable,
            linkParentKey: 'wku',
            linkTargetKey: 'warehouseSlug',
            target: warehouseBO,
            linkWhere: { archived: { isNull: true } },
          },
        },
      })

      const items = await testDb.db.from(productView).where({ wku: 'P1' }).execute()
      const enriched = await enrichCompositions(testDb.db, productBO, items, { ctx: { locale: 'en' } })
      const slugs = ((enriched[0] as any).activeWarehouses as any[]).map(w => w.slug).sort()
      expect(slugs).toEqual(['main', 'returns'])  // 'hub' was archived → filtered
    })
  })

  describe('view target (no BO compositions)', () => {
    it('merges target view fields without running compositions', async () => {
      const productBO = defineBO(productTable, {
        paramField: 'wku',
        actions: { create: {} },
        compositions: {
          warehouses: {
            linkTable: productWarehouseTable,
            linkParentKey: 'wku',
            linkTargetKey: 'warehouseSlug',
            target: warehouseView,  // view, not BO
          },
        },
      })

      const items = await testDb.db.from(productView).where({ wku: 'P2' }).execute()
      const enriched = await enrichCompositions(testDb.db, productBO, items)
      const wh = ((enriched[0] as any).warehouses as any[])[0]
      // `name` here is the raw warehouse.name column, not translation-resolved
      expect(wh.slug).toBe('main')
      expect(wh.name).toBe('Main')
    })
  })

  describe('no parent rows / no link rows', () => {
    it('empty parent list → empty enrichment', async () => {
      const productBO = defineBO(productTable, {
        paramField: 'wku',
        actions: { create: {} },
        compositions: {
          warehouses: {
            linkTable: productWarehouseTable,
            linkParentKey: 'wku',
            linkTargetKey: 'warehouseSlug',
            target: warehouseBO,
          },
        },
      })
      const enriched = await enrichCompositions(testDb.db, productBO, [], { ctx: { locale: 'en' } })
      expect(enriched).toEqual([])
    })

    it('parents with no link rows get an empty array', async () => {
      // New product with no warehouses
      await testDb.raw("INSERT INTO product (wku, name) VALUES ('P99', 'Orphan')")

      const productBO = defineBO(productTable, {
        paramField: 'wku',
        actions: { create: {} },
        compositions: {
          warehouses: {
            linkTable: productWarehouseTable,
            linkParentKey: 'wku',
            linkTargetKey: 'warehouseSlug',
            target: warehouseBO,
          },
        },
      })
      const items = await testDb.db.from(productView).where({ wku: 'P99' }).execute()
      const enriched = await enrichCompositions(testDb.db, productBO, items, { ctx: { locale: 'en' } })
      expect((enriched[0] as any).warehouses).toEqual([])

      await testDb.raw("DELETE FROM product WHERE wku = 'P99'")
    })
  })

  describe('coexistence with plain compositions', () => {
    it('both plain and link-through comps enrich the same parent', async () => {
      // Add a translation sub-table for products too (borrowing warehouse_translation schema for simplicity)
      const productTranslationTable = table('product_translation', {
        columns: {
          wku: text().notNull(),
          locale: text().notNull(),
          name: text().notNull(),
        },
        primaryKey: ['wku', 'locale'],
      })

      await testDb.raw(
        "CREATE TABLE product_translation (wku text NOT NULL, locale text NOT NULL, name text NOT NULL, PRIMARY KEY (wku, locale))",
      )
      await testDb.raw("INSERT INTO product_translation (wku, locale, name) VALUES ('P1', 'en', 'Widget EN'), ('P1', 'de', 'Widget DE')")

      const productBO = defineBO(productTable, {
        paramField: 'wku',
        actions: { create: {} },
        compositions: {
          translations: {
            table: productTranslationTable,
            parentKey: 'wku',
          },
          warehouses: {
            linkTable: productWarehouseTable,
            linkParentKey: 'wku',
            linkTargetKey: 'warehouseSlug',
            target: warehouseBO,
            columns: ['slug'],
          },
        },
      })

      const items = await testDb.db.from(productView).where({ wku: 'P1' }).execute()
      const enriched = await enrichCompositions(testDb.db, productBO, items, { ctx: { locale: 'en' } })
      expect(((enriched[0] as any).translations as any[])).toHaveLength(2)
      expect(((enriched[0] as any).warehouses as any[]).length).toBeGreaterThan(0)

      await testDb.raw('DROP TABLE product_translation')
    })
  })
})
