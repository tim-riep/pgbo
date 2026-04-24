import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { foreignKey } from '../../src/schema/constraints.js'
import { defineBO } from '../../src/bo/index.js'
import { enrichAssociations } from '../../src/bo/enrich-associations.js'
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

const userTable = table('user_', {
  columns: { id: integer().notNull(), email: text().notNull() },
  primaryKey: ['id'],
})

const pageTable = table('page', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    areaId: integer().notNull(),
    ownerId: integer(),
  },
  primaryKey: ['id'],
})

const areaView = view('area_view').from(areaTable)
const userView = view('user_view').from(userTable)
const pageView = view('page_view').from(pageTable)

describe('enrichAssociations (issue #23)', () => {
  let testDb: TestDatabase

  const areaBO = defineBO(areaTable, {
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

  const userBO = defineBO(userTable, {
    paramField: 'id',
    actions: { create: {} },
  })

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [areaTable, areaTranslationTable, userTable, pageTable],
      seed: [
        'CREATE OR REPLACE VIEW area_view AS SELECT * FROM area',
        'CREATE OR REPLACE VIEW user_view AS SELECT * FROM user_',
        'CREATE OR REPLACE VIEW page_view AS SELECT * FROM page',
        "INSERT INTO area (id, slug) VALUES (10, 'nav'), (20, 'admin')",
        "INSERT INTO area_translation (area_id, locale, name) VALUES (10, 'en', 'Navigation'), (10, 'de', 'Navigation DE'), (20, 'en', 'Admin')",
        "INSERT INTO user_ (id, email) VALUES (100, 'alice@example.com'), (200, 'bob@example.com')",
        "INSERT INTO page (id, slug, area_id, owner_id) VALUES (1, 'home', 10, 100), (2, 'about', 10, 200), (3, 'admin-dash', 20, null)",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  describe('merge with prefix (target is a BO)', () => {
    it('lifts prefixed fields onto parent rows', async () => {
      const pageBO = defineBO(pageTable, {
        paramField: 'id',
        actions: { create: {} },
        associations: {
          area: {
            foreignKey: 'areaId',
            target: areaBO,
            merge: ['name'],
            prefix: 'area',
          },
        },
      })

      const items = await testDb.db.from(pageView).orderBy('id', 'asc').execute()
      const enriched = await enrichAssociations(testDb.db, pageBO, items, { ctx: { locale: 'en' } })

      expect(enriched[0]).toMatchObject({ id: 1, slug: 'home', areaId: 10, areaName: 'Navigation' })
      expect(enriched[1]).toMatchObject({ id: 2, slug: 'about', areaId: 10, areaName: 'Navigation' })
      expect(enriched[2]).toMatchObject({ id: 3, slug: 'admin-dash', areaId: 20, areaName: 'Admin' })
    })

    it('honours the caller locale via target BO compositions', async () => {
      const pageBO = defineBO(pageTable, {
        paramField: 'id',
        actions: { create: {} },
        associations: {
          area: { foreignKey: 'areaId', target: areaBO, merge: ['name'], prefix: 'area' },
        },
      })

      const items = await testDb.db.from(pageView).where({ id: 1 }).execute()
      const en = await enrichAssociations(testDb.db, pageBO, items, { ctx: { locale: 'en' } })
      const de = await enrichAssociations(testDb.db, pageBO, items, { ctx: { locale: 'de' } })

      expect((en[0] as any).areaName).toBe('Navigation')
      expect((de[0] as any).areaName).toBe('Navigation DE')
    })

    it('merge without prefix uses the field name directly', async () => {
      const pageBO = defineBO(pageTable, {
        paramField: 'id',
        actions: { create: {} },
        associations: {
          // Unusual choice — clashes if the parent has its own `name`, but allowed
          area: { foreignKey: 'areaId', target: areaBO, merge: ['name'] },
        },
      })

      const items = await testDb.db.from(pageView).where({ id: 1 }).execute()
      const enriched = await enrichAssociations(testDb.db, pageBO, items, { ctx: { locale: 'en' } })
      expect((enriched[0] as any).name).toBe('Navigation')
    })
  })

  describe('attach + columns (target is a BO)', () => {
    it('attaches a nested object narrowed to the given columns', async () => {
      const pageBO = defineBO(pageTable, {
        paramField: 'id',
        actions: { create: {} },
        associations: {
          owner: {
            foreignKey: 'ownerId',
            target: userBO,
            attach: 'owner',
            columns: ['id', 'email'],
          },
        },
      })

      const items = await testDb.db.from(pageView).orderBy('id', 'asc').execute()
      const enriched = await enrichAssociations(testDb.db, pageBO, items)

      expect((enriched[0] as any).owner).toEqual({ id: 100, email: 'alice@example.com' })
      expect((enriched[1] as any).owner).toEqual({ id: 200, email: 'bob@example.com' })
    })

    it('null FK → attached object is null', async () => {
      const pageBO = defineBO(pageTable, {
        paramField: 'id',
        actions: { create: {} },
        associations: {
          owner: { foreignKey: 'ownerId', target: userBO, attach: 'owner' },
        },
      })

      const items = await testDb.db.from(pageView).where({ id: 3 }).execute()
      const enriched = await enrichAssociations(testDb.db, pageBO, items)
      expect((enriched[0] as any).owner).toBeNull()
    })

    it('attach without columns returns the full target row', async () => {
      const pageBO = defineBO(pageTable, {
        paramField: 'id',
        actions: { create: {} },
        associations: {
          owner: { foreignKey: 'ownerId', target: userBO, attach: 'owner' },
        },
      })

      const items = await testDb.db.from(pageView).where({ id: 1 }).execute()
      const enriched = await enrichAssociations(testDb.db, pageBO, items)
      expect((enriched[0] as any).owner).toMatchObject({ id: 100, email: 'alice@example.com' })
    })
  })

  describe('merge with null FK', () => {
    it('merged fields become null', async () => {
      const pageBO = defineBO(pageTable, {
        paramField: 'id',
        actions: { create: {} },
        associations: {
          owner: { foreignKey: 'ownerId', target: userBO, merge: ['email'], prefix: 'owner' },
        },
      })

      const items = await testDb.db.from(pageView).where({ id: 3 }).execute()
      const enriched = await enrichAssociations(testDb.db, pageBO, items)
      expect((enriched[0] as any).ownerEmail).toBeNull()
    })
  })

  describe('view target (no BO compositions run)', () => {
    it('merges target view fields without composition enrichment', async () => {
      const pageBO = defineBO(pageTable, {
        paramField: 'id',
        actions: { create: {} },
        associations: {
          // Passing a VIEW, not a BO — no composition resolution
          area: { foreignKey: 'areaId', target: areaView, merge: ['slug'], prefix: 'area' },
        },
      })

      const items = await testDb.db.from(pageView).orderBy('id', 'asc').execute()
      const enriched = await enrichAssociations(testDb.db, pageBO, items)
      expect((enriched[0] as any).areaSlug).toBe('nav')
      expect((enriched[2] as any).areaSlug).toBe('admin')
    })
  })

  describe('no merge and no attach', () => {
    it('association is treated as metadata-only — no enrichment, no DB hit', async () => {
      const pageBO = defineBO(pageTable, {
        paramField: 'id',
        actions: { create: {} },
        associations: {
          area: { foreignKey: 'areaId', target: areaBO },  // no merge, no attach
        },
      })

      const items = await testDb.db.from(pageView).where({ id: 1 }).execute()
      const enriched = await enrichAssociations(testDb.db, pageBO, items)
      // Nothing added
      expect(enriched[0]).toEqual(items[0])
    })
  })

  describe('no associations / empty items', () => {
    it('returns a shallow clone when bo has no associations', async () => {
      const bareBO = defineBO(pageTable, { paramField: 'id', actions: { create: {} } })
      const items = await testDb.db.from(pageView).execute()
      const enriched = await enrichAssociations(testDb.db, bareBO, items)
      expect(enriched).toEqual(items)
    })

    it('returns empty array when items is empty', async () => {
      const pageBO = defineBO(pageTable, {
        paramField: 'id',
        actions: { create: {} },
        associations: { area: { foreignKey: 'areaId', target: areaBO, merge: ['name'], prefix: 'area' } },
      })
      const enriched = await enrichAssociations(testDb.db, pageBO, [])
      expect(enriched).toEqual([])
    })
  })
})
