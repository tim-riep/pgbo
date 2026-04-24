import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { foreignKey } from '../../src/schema/constraints.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import { createDatabase } from '../../src/query/client.js'

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
    description: text(),
  },
  primaryKey: ['areaId', 'locale'],
  foreignKeys: [foreignKey(['areaId']).references('area', ['id']).onDelete('CASCADE')],
})

describe('.translatedJoin() view helper (issue #14)', () => {
  describe('SQL generation', () => {
    it('emits a LEFT JOIN filtered by current_setting() without fallback', () => {
      const v = view('area_localized')
        .from(areaTable)
        .translatedJoin(areaTranslationTable, {
          parentKey: 'areaId',
          localeColumn: 'locale',
          localeParam: 'app.locale',
          fields: ['name'],
        })
      const sql = v.toSQL()
      expect(sql).toContain('CREATE VIEW area_localized AS')
      expect(sql).toContain('area.id, area.slug')
      expect(sql).toContain('t_req.name AS name')
      expect(sql).toContain('LEFT JOIN area_translation t_req')
      expect(sql).toContain('t_req.area_id = area.id')
      expect(sql).toContain("t_req.locale = current_setting('app.locale', true)")
      expect(sql).not.toContain('t_fb')
      expect(sql).not.toContain('COALESCE')
    })

    it('emits COALESCE + two LEFT JOINs when fallbackLocale is set', () => {
      const v = view('area_localized')
        .from(areaTable)
        .translatedJoin(areaTranslationTable, {
          parentKey: 'areaId',
          localeColumn: 'locale',
          localeParam: 'app.locale',
          fallbackLocale: 'en',
          fields: ['name', 'description'],
        })
      const sql = v.toSQL()
      expect(sql).toContain('COALESCE(t_req.name, t_fb.name) AS name')
      expect(sql).toContain('COALESCE(t_req.description, t_fb.description) AS description')
      expect(sql).toContain('LEFT JOIN area_translation t_req')
      expect(sql).toContain('LEFT JOIN area_translation t_fb')
      expect(sql).toContain("t_fb.locale = 'en'")
    })

    it('escapes single quotes in fallback locale', () => {
      const v = view('area_localized')
        .from(areaTable)
        .translatedJoin(areaTranslationTable, {
          parentKey: 'areaId',
          localeColumn: 'locale',
          localeParam: 'app.locale',
          fallbackLocale: "en'; DROP TABLE area; --",
          fields: ['name'],
        })
      const sql = v.toSQL()
      expect(sql).toContain("t_fb.locale = 'en''; DROP TABLE area; --'")
    })

    it('throws when combined with .columns()', () => {
      expect(() =>
        view('bad').from(areaTable).columns({}).translatedJoin(areaTranslationTable, {
          parentKey: 'areaId', localeColumn: 'locale', localeParam: 'app.locale', fields: ['name'],
        }),
      ).toThrow(/cannot be combined with \.columns\(\)/)
    })

    it('throws when .columns() is called after .translatedJoin()', () => {
      const partial = view('bad').from(areaTable).translatedJoin(areaTranslationTable, {
        parentKey: 'areaId', localeColumn: 'locale', localeParam: 'app.locale', fields: ['name'],
      })
      expect(() => partial.columns({})).toThrow(/cannot be combined with \.translatedJoin\(\)/)
    })

    it('requires the source table to have a primary key', () => {
      const brokenTable = table('broken', {
        columns: { x: text() },
        primaryKey: [] as unknown as [string],
      })
      const v = view('bad').from(brokenTable).translatedJoin(areaTranslationTable, {
        parentKey: 'areaId', localeColumn: 'locale', localeParam: 'app.locale', fields: ['name'],
      })
      expect(() => v.toSQL()).toThrow(/requires the source table .* to have a primary key/)
    })
  })

  describe('integration with db.withContext + sessionParams', () => {
    let testDb: TestDatabase

    const areaLocalizedView = view('area_localized')
      .from(areaTable)
      .translatedJoin(areaTranslationTable, {
        parentKey: 'areaId',
        localeColumn: 'locale',
        localeParam: 'app.locale',
        fallbackLocale: 'en',
        fields: ['name'],
      })

    beforeAll(async () => {
      testDb = await createTestDatabase({
        connectionString,
        schema: [areaTable, areaTranslationTable],
        seed: [
          areaLocalizedView.toSQL(),
          "INSERT INTO area (id, slug) VALUES (1, 'nav'), (2, 'admin'), (3, 'orphan')",
          // 'nav' has both en + de, 'admin' only has en (fallback expected), 'orphan' has nothing
          "INSERT INTO area_translation (area_id, locale, name) VALUES " +
            "(1, 'en', 'Navigation'), (1, 'de', 'Navigation DE'), " +
            "(2, 'en', 'Admin')",
        ],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    it('returns locale-specific name when the translation exists', async () => {
      const db = createDatabase({
        connectionString: testDb.connectionString,
        sessionParams: { 'app.locale': (ctx) => (ctx as { locale?: string }).locale ?? 'en' },
      })

      const rows = await db.withContext({ locale: 'de' }, async tx => {
        return tx.from(areaLocalizedView).orderBy('id', 'asc').execute()
      })

      // nav → German, admin → falls back to English, orphan → null
      expect(rows.map(r => r.name)).toEqual(['Navigation DE', 'Admin', null])
      await db.close()
    })

    it('without withContext, current_setting returns NULL → no locale match; fallback still resolves', async () => {
      const db = createDatabase({ connectionString: testDb.connectionString })
      const rows = await db.from(areaLocalizedView).orderBy('id', 'asc').execute()

      // Request locale is NULL so t_req is all nulls — fallback 'en' picks up nav+admin
      expect(rows.map(r => r.name)).toEqual(['Navigation', 'Admin', null])
      await db.close()
    })

    it('switches language based on ctx between calls', async () => {
      const db = createDatabase({
        connectionString: testDb.connectionString,
        sessionParams: { 'app.locale': (ctx) => (ctx as { locale?: string }).locale ?? 'en' },
      })

      const en = await db.withContext({ locale: 'en' }, async tx => {
        const r = await tx.from(areaLocalizedView).where({ id: 1 }).execute()
        return r[0]?.name
      })
      const de = await db.withContext({ locale: 'de' }, async tx => {
        const r = await tx.from(areaLocalizedView).where({ id: 1 }).execute()
        return r[0]?.name
      })

      expect(en).toBe('Navigation')
      expect(de).toBe('Navigation DE')
      await db.close()
    })
  })
})
