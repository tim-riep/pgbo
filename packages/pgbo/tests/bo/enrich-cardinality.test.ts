import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer, timestamp } from '../../src/schema/types.js'
import { foreignKey } from '../../src/schema/constraints.js'
import { defineBO } from '../../src/bo/index.js'
import { enrichCompositions } from '../../src/bo/enrich.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env.PGBO_TEST_URL ?? 'postgresql://localhost:5432/postgres'

const areaTable = table('area', {
  columns: { id: integer().notNull(), slug: text().notNull() },
  primaryKey: ['id'],
})

const areaTranslationTable = table('area_translation', {
  columns: {
    areaId: integer().notNull(),
    locale: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['areaId', 'locale'],
  foreignKeys: [foreignKey(['areaId']).references('area', ['id']).onDelete('CASCADE')],
})

const addressTable = table('address', {
  columns: {
    id: integer().notNull(),
    customerId: integer().notNull(),
    label: text().notNull(),
    isPrimary: text(),  // 'yes' / null; avoids PG reserved keyword "primary"
  },
  primaryKey: ['id'],
})

const customerTable = table('customer', {
  columns: { id: integer().notNull(), name: text().notNull() },
  primaryKey: ['id'],
})

const contractTable = table('contract', {
  columns: {
    id: integer().notNull(),
    customerId: integer().notNull(),
    validFrom: timestamp().withTimeZone().notNull(),
    validTo: timestamp().withTimeZone().notNull(),
    plan: text().notNull(),
  },
  primaryKey: ['id'],
})

const areaView = view('area_view').from(areaTable)
const customerView = view('customer_view').from(customerTable)

describe('Composition cardinality + where + merge (issue #13)', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [areaTable, areaTranslationTable, customerTable, addressTable, contractTable],
      seed: [
        'CREATE OR REPLACE VIEW area_view AS SELECT * FROM area',
        'CREATE OR REPLACE VIEW customer_view AS SELECT * FROM customer',
        "INSERT INTO area (id, slug) VALUES (1, 'nav'), (2, 'admin')",
        "INSERT INTO area_translation (area_id, locale, name) VALUES (1, 'en', 'Navigation'), (1, 'de', 'Navigation DE'), (2, 'en', 'Admin')",
        "INSERT INTO customer (id, name) VALUES (10, 'Alice'), (20, 'Bob')",
        "INSERT INTO address (id, customer_id, label, is_primary) VALUES (100, 10, 'Home', 'yes'), (101, 10, 'Work', null), (102, 20, 'Office', 'yes')",
        "INSERT INTO contract (id, customer_id, valid_from, valid_to, plan) VALUES (200, 10, '2024-01-01', '2025-01-01', 'basic'), (201, 10, '2025-01-01', '2030-01-01', 'pro'), (202, 20, '2024-01-01', '2030-01-01', 'enterprise')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  describe('cardinality: "one"', () => {
    it('returns a single object or null', async () => {
      const bo = defineBO(areaTable, {
        paramField: 'id',
        actions: { create: {} },
        compositions: {
          primaryTranslation: {
            table: areaTranslationTable,
            parentKey: 'areaId',
            cardinality: 'one',
            where: { locale: 'en' },
          },
        },
      })

      const items = await testDb.db.from(areaView).orderBy('id', 'asc').execute()
      const enriched = await enrichCompositions(testDb.db, bo, items)

      expect(enriched[0]!.primaryTranslation).toMatchObject({ locale: 'en', name: 'Navigation' })
      expect(enriched[1]!.primaryTranslation).toMatchObject({ locale: 'en', name: 'Admin' })
    })

    it('returns null when no row matches', async () => {
      const bo = defineBO(areaTable, {
        paramField: 'id',
        actions: { create: {} },
        compositions: {
          frenchTranslation: {
            table: areaTranslationTable,
            parentKey: 'areaId',
            cardinality: 'one',
            where: { locale: 'fr' },
          },
        },
      })

      const items = await testDb.db.from(areaView).execute()
      const enriched = await enrichCompositions(testDb.db, bo, items)
      expect(enriched[0]!.frenchTranslation).toBeNull()
    })
  })

  describe('where with $locale context placeholder', () => {
    it('resolves $locale from ctx', async () => {
      const bo = defineBO(areaTable, {
        paramField: 'id',
        actions: { create: {} },
        compositions: {
          translation: {
            table: areaTranslationTable,
            parentKey: 'areaId',
            cardinality: 'one',
            where: { locale: '$locale' },
          },
        },
      })

      const items = await testDb.db.from(areaView).orderBy('id', 'asc').execute()

      const en = await enrichCompositions(testDb.db, bo, items, { ctx: { locale: 'en' } })
      expect((en[0]!.translation as any).name).toBe('Navigation')

      const de = await enrichCompositions(testDb.db, bo, items, { ctx: { locale: 'de' } })
      expect((de[0]!.translation as any).name).toBe('Navigation DE')
    })

    it('throws when placeholder references missing ctx data (fail loud)', async () => {
      const bo = defineBO(areaTable, {
        paramField: 'id',
        actions: { create: {} },
        compositions: {
          translation: {
            table: areaTranslationTable,
            parentKey: 'areaId',
            cardinality: 'one',
            where: { locale: '$locale' },
          },
        },
      })

      const items = await testDb.db.from(areaView).execute()
      await expect(enrichCompositions(testDb.db, bo, items, {})).rejects.toThrow(
        /uses "\$locale" but enrichCompositions was called without a ctx/,
      )
      await expect(enrichCompositions(testDb.db, bo, items, { ctx: {} })).rejects.toThrow(
        /uses "\$locale" but ctx\.locale is undefined/,
      )
    })
  })

  describe('where with $now placeholder', () => {
    it('filters by current time for current-contract pattern', async () => {
      const bo = defineBO(customerTable, {
        paramField: 'id',
        actions: { create: {} },
        compositions: {
          currentContract: {
            table: contractTable,
            parentKey: 'customerId',
            cardinality: 'one',
            where: {
              validFrom: { lte: '$now' },
              validTo: { gte: '$now' },
            },
          },
        },
      })

      const items = await testDb.db.from(customerView).orderBy('id', 'asc').execute()
      const enriched = await enrichCompositions(testDb.db, bo, items)

      // Alice (id 10): two contracts, only the 2025-2030 one covers $now (2026)
      expect((enriched[0]!.currentContract as any).plan).toBe('pro')
      // Bob (id 20): one contract, enterprise
      expect((enriched[1]!.currentContract as any).plan).toBe('enterprise')
    })
  })

  describe('merge: lift fields onto parent', () => {
    it('attaches translation.name as parent.name (no nested object)', async () => {
      const bo = defineBO(areaTable, {
        paramField: 'id',
        actions: { create: {} },
        compositions: {
          translation: {
            table: areaTranslationTable,
            parentKey: 'areaId',
            cardinality: 'one',
            where: { locale: '$locale' },
            merge: ['name'],
          },
        },
      })

      const items = await testDb.db.from(areaView).orderBy('id', 'asc').execute()
      const enriched = await enrichCompositions(testDb.db, bo, items, { ctx: { locale: 'en' } })

      expect(enriched[0]!).toMatchObject({ id: 1, slug: 'nav', name: 'Navigation' })
      expect(enriched[1]!).toMatchObject({ id: 2, slug: 'admin', name: 'Admin' })
      // No nested 'translation' object
      expect((enriched[0] as any).translation).toBeUndefined()
    })

    it('merge with no matching row sets fields to null', async () => {
      const bo = defineBO(areaTable, {
        paramField: 'id',
        actions: { create: {} },
        compositions: {
          translation: {
            table: areaTranslationTable,
            parentKey: 'areaId',
            cardinality: 'one',
            where: { locale: 'fr' },
            merge: ['name'],
          },
        },
      })

      const items = await testDb.db.from(areaView).execute()
      const enriched = await enrichCompositions(testDb.db, bo, items)
      expect((enriched[0] as any).name).toBeNull()
    })
  })

  describe('cardinality: "many" (default, unchanged behaviour)', () => {
    it('returns an array', async () => {
      const bo = defineBO(areaTable, {
        paramField: 'id',
        actions: { create: {} },
        compositions: {
          translations: {
            table: areaTranslationTable,
            parentKey: 'areaId',
          },
        },
      })

      const items = await testDb.db.from(areaView).where({ id: 1 }).execute()
      const enriched = await enrichCompositions(testDb.db, bo, items)

      expect(enriched[0]!.translations).toHaveLength(2)
    })
  })

  describe('where with boolean/string literals', () => {
    it('supports static WHERE filters (no placeholders)', async () => {
      const bo = defineBO(customerTable, {
        paramField: 'id',
        actions: { create: {} },
        compositions: {
          primaryAddress: {
            table: addressTable,
            parentKey: 'customerId',
            cardinality: 'one',
            where: { isPrimary: 'yes' },
          },
        },
      })

      const items = await testDb.db.from(customerView).orderBy('id', 'asc').execute()
      const enriched = await enrichCompositions(testDb.db, bo, items)

      expect((enriched[0]!.primaryAddress as any).label).toBe('Home')
      expect((enriched[1]!.primaryAddress as any).label).toBe('Office')
    })
  })
})
