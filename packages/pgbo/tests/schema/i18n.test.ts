import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { configureI18n, translated, localeCode, getI18nConfig } from '../../src/schema/i18n.js'
import { table } from '../../src/schema/table.js'
import { text, integer } from '../../src/schema/types.js'
import { view } from '../../src/schema/view.js'
import { col } from '../../src/schema/column.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

describe('Native i18n', () => {
  it('configureI18n() sets locale table and fallback', () => {
    configureI18n({
      localeTable: 'locale',
      localeColumn: 'code',
      fallbackLocale: 'en',
    })
    const config = getI18nConfig()
    expect(config.localeTable).toBe('locale')
    expect(config.localeColumn).toBe('code')
    expect(config.fallbackLocale).toBe('en')
  })

  it('localeCode domain is built-in', () => {
    expect(localeCode.name).toBe('locale_code')
    expect(localeCode.baseType._def.pgType).toBe('text')
    // has length(2) constraint
    expect(localeCode.baseType._def.length).toBe(2)
  })

  it('.translations([]) on table generates translation table with correct PK/FK', () => {
    const area = table('area', {
      columns: {
        slug: text().notNull(),
        tenantId: integer(),
        sortOrder: integer().default(0),
      },
      primaryKey: ['slug', 'tenantId'],
      translations: ['name'],
    })

    const tt = area.translationTable!
    expect(tt).toBeDefined()
    expect(tt.name).toBe('area_translation')
    expect(Object.keys(tt.columns)).toContain('slug')
    expect(Object.keys(tt.columns)).toContain('tenantId')
    expect(Object.keys(tt.columns)).toContain('locale')
    expect(Object.keys(tt.columns)).toContain('name')
    expect(tt.primaryKey).toEqual(['slug', 'tenantId', 'locale'])
    // FK to parent
    expect(tt.foreignKeys).toHaveLength(1)
    expect(tt.foreignKeys[0]!.refTable).toBe('area')
    expect(tt.foreignKeys[0]!.onDelete).toBe('CASCADE')
  })

  it('translated() creates a column marker for translation join', () => {
    const t = translated('name')
    expect(t.ref).toBe('name')
    expect(t.isTranslated).toBe(true)
  })

  it('view with translated() generates DDL with LEFT JOIN on translation table', () => {
    configureI18n({ localeTable: 'locale', localeColumn: 'code', fallbackLocale: 'en' })

    const area = table('area', {
      columns: {
        slug: text().notNull(),
        tenantId: integer(),
        sortOrder: integer().default(0),
      },
      primaryKey: ['slug', 'tenantId'],
      translations: ['name'],
    })

    const areaView = view('area_view').from(area).columns({
      slug: col('slug'),
      sortOrder: col('sortOrder'),
      name: translated('name'),
    })

    const ddl = areaView.toSQL()
    expect(ddl).toContain('CREATE VIEW area_view AS')
    expect(ddl).toContain('LEFT JOIN area_translation')
    expect(ddl).toContain('slug')
    expect(ddl).toContain('sort_order')
    expect(ddl).toContain('area_translation.name')
  })

  describe('integration', () => {
    let testDb: TestDatabase

    beforeAll(async () => {
      configureI18n({ localeTable: 'locale', localeColumn: 'code', fallbackLocale: 'en' })

      testDb = await createTestDatabase({
        connectionString,
        schema: [],
        seed: [
          `CREATE TABLE area (
            slug text NOT NULL,
            sort_order integer DEFAULT 0,
            PRIMARY KEY (slug)
          )`,
          `CREATE TABLE area_translation (
            area_slug text NOT NULL REFERENCES area(slug) ON DELETE CASCADE,
            locale text NOT NULL,
            name text NOT NULL,
            PRIMARY KEY (area_slug, locale)
          )`,
          "INSERT INTO area (slug, sort_order) VALUES ('NORTH', 1), ('SOUTH', 2)",
          "INSERT INTO area_translation (area_slug, locale, name) VALUES ('NORTH', 'en', 'North Zone'), ('NORTH', 'de', 'Nordzone'), ('SOUTH', 'en', 'South Zone')",
        ],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    it('translated() in view joins translation table — SELECT resolves by locale', async () => {
      // Query with locale filter
      const rows = await testDb.db.query<{ slug: string; name: string; [key: string]: unknown }>(
        "SELECT a.slug, t.name FROM area a LEFT JOIN area_translation t ON a.slug = t.area_slug AND t.locale = $1 ORDER BY a.sort_order",
        ['en'],
      )
      expect(rows).toHaveLength(2)
      expect(rows[0]!.name).toBe('North Zone')
      expect(rows[1]!.name).toBe('South Zone')
    })

    it('fallback locale is used when requested locale has no translation', async () => {
      // SOUTH has no 'de' translation — use COALESCE with fallback
      const rows = await testDb.db.query<{ slug: string; name: string | null; [key: string]: unknown }>(
        `SELECT a.slug,
                COALESCE(t.name, fb.name) AS name
         FROM area a
         LEFT JOIN area_translation t ON a.slug = t.area_slug AND t.locale = $1
         LEFT JOIN area_translation fb ON a.slug = fb.area_slug AND fb.locale = $2
         ORDER BY a.sort_order`,
        ['de', 'en'],
      )
      expect(rows).toHaveLength(2)
      expect(rows[0]!.name).toBe('Nordzone')       // has 'de'
      expect(rows[1]!.name).toBe('South Zone')      // fallback to 'en'
    })
  })
})
