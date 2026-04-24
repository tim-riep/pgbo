import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
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
  },
  primaryKey: ['areaId', 'locale'],
})

// View that uses current_setting('app.locale', true) to filter translations per request
const areaLocalizedView = view('area_localized').from(areaTable)

describe('db.withContext + sessionParams (issue #14)', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [areaTable, areaTranslationTable],
      seed: [
        `CREATE OR REPLACE VIEW area_localized AS
         SELECT a.id, a.slug, t.name
         FROM area a
         LEFT JOIN area_translation t
           ON t.area_id = a.id
          AND t.locale = current_setting('app.locale', true)`,
        "INSERT INTO area (id, slug) VALUES (1, 'nav'), (2, 'admin')",
        "INSERT INTO area_translation (area_id, locale, name) VALUES (1, 'en', 'Navigation'), (1, 'de', 'Navigation DE'), (2, 'en', 'Admin'), (2, 'de', 'Verwaltung')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('withContext emits SET LOCAL for each configured sessionParam', async () => {
    const db = createDatabase({
      connectionString: testDb.connectionString,
      sessionParams: {
        'app.locale': (ctx) => (ctx as { locale?: string }).locale ?? 'en',
      },
    })

    const rowsEn = await db.withContext({ locale: 'en' }, async tx => {
      return tx.from(areaLocalizedView).orderBy('id', 'asc').execute()
    })
    expect(rowsEn.map(r => r.name)).toEqual(['Navigation', 'Admin'])

    const rowsDe = await db.withContext({ locale: 'de' }, async tx => {
      return tx.from(areaLocalizedView).orderBy('id', 'asc').execute()
    })
    expect(rowsDe.map(r => r.name)).toEqual(['Navigation DE', 'Verwaltung'])

    await db.close()
  })

  it('without withContext, current_setting returns NULL → no translations match', async () => {
    const db = createDatabase({ connectionString: testDb.connectionString })
    const rows = await db.from(areaLocalizedView).orderBy('id', 'asc').execute()
    expect(rows.every(r => r.name === null)).toBe(true)
    await db.close()
  })

  it('supports multiple session params', async () => {
    const db = createDatabase({
      connectionString: testDb.connectionString,
      sessionParams: {
        'app.locale': (ctx) => (ctx as { locale?: string }).locale ?? 'en',
        'app.tenant_id': (ctx) => (ctx as { tenantId?: string }).tenantId ?? '',
      },
    })

    const result = await db.withContext({ locale: 'de', tenantId: 't1' }, async tx => {
      const r = await tx.query<{ locale: string; tenant: string }>(
        `SELECT current_setting('app.locale', true) AS locale, current_setting('app.tenant_id', true) AS tenant`,
      )
      return r[0]
    })
    expect(result).toEqual({ locale: 'de', tenant: 't1' })
    await db.close()
  })

  it('resolvers returning undefined skip the SET LOCAL entirely', async () => {
    const db = createDatabase({
      connectionString: testDb.connectionString,
      sessionParams: {
        'app.locale': (ctx) => (ctx as { locale?: string }).locale,  // undefined when not in ctx
      },
    })

    // current_setting returns NULL when setting is unset (missing_ok=true)
    const got = await db.withContext({}, async tx => {
      const r = await tx.query<{ val: string | null }>(`SELECT current_setting('app.locale', true) AS val`)
      return r[0]?.val
    })
    expect(got).toBeNull()
    await db.close()
  })

  it('resolvers returning null skip the SET LOCAL entirely', async () => {
    const db = createDatabase({
      connectionString: testDb.connectionString,
      sessionParams: {
        'app.locale': () => null,
      },
    })
    const got = await db.withContext({}, async tx => {
      const r = await tx.query<{ val: string | null }>(`SELECT current_setting('app.locale', true) AS val`)
      return r[0]?.val
    })
    expect(got).toBeNull()
    await db.close()
  })

  it('rolls back on error (SET LOCAL leaks prevented)', async () => {
    const db = createDatabase({
      connectionString: testDb.connectionString,
      sessionParams: { 'app.locale': () => 'fr' },
    })
    await expect(
      db.withContext({}, async () => { throw new Error('boom') }),
    ).rejects.toThrow('boom')

    // After rollback, the setting is not set — Postgres returns NULL or '' for custom settings
    // depending on whether the session ever "declared" it. Either way, it's not 'fr'.
    const got = await db.query<{ val: string | null }>(`SELECT current_setting('app.locale', true) AS val`)
    expect(got[0]?.val ?? '').not.toBe('fr')
    await db.close()
  })

  it('rejects invalid parameter names (injection guard)', async () => {
    const db = createDatabase({
      connectionString: testDb.connectionString,
      sessionParams: { 'bad; DROP TABLE users': () => 'x' },
    })
    await expect(
      db.withContext({}, async () => undefined),
    ).rejects.toThrow(/Invalid session parameter name/)
    await db.close()
  })

  it('escapes single quotes in values', async () => {
    const db = createDatabase({
      connectionString: testDb.connectionString,
      sessionParams: { 'app.locale': () => "en'; DROP TABLE area; --" },
    })
    const got = await db.withContext({}, async tx => {
      const r = await tx.query<{ val: string }>(`SELECT current_setting('app.locale', true) AS val`)
      return r[0]?.val
    })
    expect(got).toBe("en'; DROP TABLE area; --")
    // Area table should still exist
    const rows = await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM area')
    expect(Number(rows[0]!.count)).toBe(2)
    await db.close()
  })

  it('numeric and boolean param values work', async () => {
    const db = createDatabase({
      connectionString: testDb.connectionString,
      sessionParams: {
        'app.level': () => 42,
        'app.enabled': () => true,
      },
    })
    const got = await db.withContext({}, async tx => {
      const r = await tx.query<{ l: string; e: string }>(
        `SELECT current_setting('app.level', true) AS l, current_setting('app.enabled', true) AS e`,
      )
      return r[0]
    })
    expect(got).toEqual({ l: '42', e: 'true' })
    await db.close()
  })
})
