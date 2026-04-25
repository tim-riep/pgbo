import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { table, view, text, integer, col } from '@pgbo/core/schema'
import { defineBO, defineProjection } from '@pgbo/core/bo'
import { createTestDatabase, type TestDatabase } from '@pgbo/core/testing'
import { registerProjection } from '../src/index.js'

const connectionString = process.env.PGBO_TEST_URL ?? 'postgresql://localhost:5432/postgres'

const productTable = table('product', {
  columns: {
    id: integer().notNull(),
    sku: text().notNull(),
    uomSlug: text().notNull(),
  },
  primaryKey: ['id'],
})

const uomTable = table('uom', {
  columns: { slug: text().notNull(), name: text().notNull() },
  primaryKey: ['slug'],
})

// vh-annotated view used as the dropdown source
const uomVh = view('uom_vh').from(uomTable)
  .columns({ slug: col('slug'), name: col('name') })
  .vh({ key: 'slug', display: 'name' })

const productView = view('product_view').from(productTable).columns({
  id: col('id'),
  sku: col('sku'),
  uomSlug: col('uomSlug').valueHelp(uomVh),  // <-- column-to-vh binding (issue #35)
})

const productBO = defineBO(productView, {
  paramField: 'id',
  // BO registers the same vh under key "uom" — the URL segment Fastify uses
  valueHelps: { uom: uomVh },
})

const productProjection = defineProjection(productBO, {
  name: 'product',
  actions: { read: true },
})

describe('Column-to-value-help binding via metadata (issue #35)', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [productTable, uomTable],
      seed: [
        `CREATE OR REPLACE VIEW product_view AS SELECT id, sku, uom_slug FROM product`,
        `CREATE OR REPLACE VIEW uom_vh AS SELECT slug, name FROM uom`,
        `INSERT INTO uom (slug, name) VALUES ('kg', 'Kilogram'), ('m', 'Meter')`,
        `INSERT INTO product (id, sku, uom_slug) VALUES (1, 'X', 'kg')`,
      ],
    })
  })

  afterAll(async () => { await testDb.dispose() })

  it('exposes field.valueHelp with absolute endpoint URL', async () => {
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: productProjection,
      view: productView,
      extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
    })

    const res = await app.inject({ method: 'GET', url: '/meta/product' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const uomField = body.fields.find((f: any) => f.key === 'uomSlug')
    expect(uomField.valueHelp).toEqual({
      name: 'uom',
      keyField: 'slug',
      displayField: 'name',
      endpoint: '/bo/product/valueHelp/uom',
    })
    await app.close()
  })

  it('the endpoint URL actually serves the value-help dropdown', async () => {
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: productProjection,
      view: productView,
      extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
    })

    const metaRes = await app.inject({ method: 'GET', url: '/meta/product' })
    const uomEndpoint = metaRes.json().fields.find((f: any) => f.key === 'uomSlug').valueHelp.endpoint

    const vhRes = await app.inject({ method: 'GET', url: uomEndpoint })
    expect(vhRes.statusCode).toBe(200)
    const items = vhRes.json().items
    expect(items.find((r: any) => r.slug === 'kg')).toEqual({ slug: 'kg', name: 'Kilogram' })
    await app.close()
  })

  it('field.valueHelp is undefined for columns without .valueHelp()', async () => {
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: productProjection,
      view: productView,
      extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
    })

    const res = await app.inject({ method: 'GET', url: '/meta/product' })
    const skuField = res.json().fields.find((f: any) => f.key === 'sku')
    expect(skuField.valueHelp).toBeUndefined()
    await app.close()
  })
})
