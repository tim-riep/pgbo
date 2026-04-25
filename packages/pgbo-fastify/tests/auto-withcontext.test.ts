import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { table, view, text, integer, col } from '@pgbo/core/schema'
import { foreignKey } from '@pgbo/core/schema'
import { defineBO, defineProjection } from '@pgbo/core/bo'
import { createDatabase } from '@pgbo/core'
import { createTestDatabase, type TestDatabase } from '@pgbo/core/testing'
import { registerProjection } from '../src/index.js'
import type { RouteContext } from '../src/index.js'

const connectionString = process.env.PGBO_TEST_URL ?? 'postgresql://localhost:5432/postgres'

const uomTable = table('uom', {
  columns: { slug: text().notNull() },
  primaryKey: ['slug'],
})

const uomTranslationTable = table('uom_translation', {
  columns: {
    uomSlug: text().notNull(),
    locale: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['uomSlug', 'locale'],
  foreignKeys: [foreignKey(['uomSlug']).references('uom', ['slug']).onDelete('CASCADE')],
})

// translatedJoin view — relies on current_setting('app.locale', true)
const uomVh = view('uom_vh').from(uomTable)
  .translatedJoin(uomTranslationTable, {
    parentKey: 'uomSlug',
    localeColumn: 'locale',
    localeParam: 'app.locale',
    fallbackLocale: 'en',
    fields: ['name'],
  })
  .vh({ key: 'slug', display: 'name' })

const productTable = table('product', {
  columns: {
    id: integer().notNull(),
    sku: text().notNull(),
  },
  primaryKey: ['id'],
})
const productView = view('product_view').from(productTable).columns({
  id: col('id'),
  sku: col('sku'),
})
const productBO = defineBO(productView, {
  paramField: 'id',
  valueHelps: { uom: uomVh },
})
const productProjection = defineProjection(productBO, {
  name: 'product',
  actions: { read: true },
})

describe('Auto-wrap Fastify routes with db.withContext (issue #42)', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [uomTable, uomTranslationTable, productTable],
      seed: [
        `CREATE OR REPLACE VIEW product_view AS SELECT id, sku FROM product`,
        `CREATE VIEW uom_vh AS
          SELECT uom.slug, COALESCE(t_req.name, t_fb.name) AS name
          FROM uom
          LEFT JOIN uom_translation t_req ON t_req.uom_slug = uom.slug AND t_req.locale = current_setting('app.locale', true)
          LEFT JOIN uom_translation t_fb ON t_fb.uom_slug = uom.slug AND t_fb.locale = 'en'`,
        `INSERT INTO uom (slug) VALUES ('kg'), ('m')`,
        `INSERT INTO uom_translation (uom_slug, locale, name) VALUES
          ('kg', 'en', 'Kilogram'), ('kg', 'de', 'Kilogramm'),
          ('m', 'en', 'Meter'), ('m', 'de', 'Meter (DE)')`,
      ],
    })
  })

  afterAll(async () => { await testDb.dispose() })

  it('serves the requested locale through the value-help endpoint when sessionParams is configured', async () => {
    // Re-create the database client with sessionParams pointing at ctx.locale
    const db = createDatabase({
      connectionString: testDb.connectionString,
      sessionParams: { 'app.locale': (ctx) => (ctx as RouteContext).locale },
    })
    expect(db.hasSessionParams).toBe(true)

    const app = Fastify()
    let currentLocale = 'de'
    registerProjection(app, db, {
      projection: productProjection,
      view: productView,
      extractContext: () => ({ app, db, locale: currentLocale }),
    })

    const deRes = await app.inject({ method: 'GET', url: '/bo/product/valueHelp/uom' })
    const deNames = (deRes.json().items as { slug: string; name: string }[])
      .reduce<Record<string, string>>((acc, r) => { acc[r.slug] = r.name; return acc }, {})
    expect(deNames).toEqual({ kg: 'Kilogramm', m: 'Meter (DE)' })

    currentLocale = 'en'
    const enRes = await app.inject({ method: 'GET', url: '/bo/product/valueHelp/uom' })
    const enNames = (enRes.json().items as { slug: string; name: string }[])
      .reduce<Record<string, string>>((acc, r) => { acc[r.slug] = r.name; return acc }, {})
    expect(enNames).toEqual({ kg: 'Kilogram', m: 'Meter' })

    await app.close()
    await db.close()
  })

  it('falls back to fallbackLocale when no sessionParams are configured (legacy path)', async () => {
    const db = createDatabase({ connectionString: testDb.connectionString })
    expect(db.hasSessionParams).toBe(false)

    const app = Fastify()
    registerProjection(app, db, {
      projection: productProjection,
      view: productView,
      extractContext: () => ({ app, db, locale: 'de' }),
    })

    // No sessionParams → current_setting('app.locale', true) is NULL → t_req join misses → fallback wins
    const res = await app.inject({ method: 'GET', url: '/bo/product/valueHelp/uom' })
    const names = (res.json().items as { slug: string; name: string }[])
      .reduce<Record<string, string>>((acc, r) => { acc[r.slug] = r.name; return acc }, {})
    expect(names).toEqual({ kg: 'Kilogram', m: 'Meter' })

    await app.close()
    await db.close()
  })
})
