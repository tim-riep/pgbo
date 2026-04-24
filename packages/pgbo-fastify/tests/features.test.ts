import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { table, view, valueHelpView, text, integer, col } from '@pgbo/core/schema'
import { defineBO, defineProjection } from '@pgbo/core/bo'
import { createTestDatabase, type TestDatabase } from '@pgbo/core/testing'
import { registerProjection } from '../src/index.js'

const connectionString = process.env.PGBO_TEST_URL ?? 'postgresql://localhost:5432/postgres'

const warehouseTable = table('warehouse', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    tenantId: text(),
  },
  primaryKey: ['id'],
})

const warehouseView = view('warehouse_view').from(warehouseTable).columns({
  id: col('id'),
  slug: col('slug').searchable(),
  name: col('name').searchable(),
  tenantId: col('tenantId'),
})

const warehouseVH = valueHelpView('warehouse_vh')
  .from(warehouseTable).key('slug').display('name')

const warehouseBO = defineBO(warehouseTable, {
  paramField: 'slug',
  actions: { create: {}, update: {}, delete: {} },
  routePrefix: '/api/warehouses',
  valueHelps: { warehouse: warehouseVH },
})

const warehouseProjection = defineProjection(warehouseBO, {
  name: 'warehouse',
  actions: { read: true, create: true, update: true, delete: true },
})

describe('pgbo-fastify — issue 026 features', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [warehouseTable],
      seed: [
        `CREATE OR REPLACE VIEW warehouse_view AS
         SELECT id, slug, name, tenant_id FROM warehouse`,
        `CREATE OR REPLACE VIEW warehouse_vh AS SELECT slug, name FROM warehouse`,
        "INSERT INTO warehouse (id, slug, name, tenant_id) VALUES (1, 'main', 'Main WH', 't1')",
        "INSERT INTO warehouse (id, slug, name, tenant_id) VALUES (2, 'returns', 'Returns', 't1')",
        "INSERT INTO warehouse (id, slug, name, tenant_id) VALUES (3, 'global-wh', 'Global', NULL)",
        "INSERT INTO warehouse (id, slug, name, tenant_id) VALUES (4, 'other', 'Other', 't2')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  describe('1. ILIKE search via view annotations', () => {
    it('applies ILIKE on searchable columns when search param is present', async () => {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: warehouseProjection,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/api/warehouses?search=Main' })
      const body = res.json()
      expect(body.items).toHaveLength(1)
      expect(body.items[0].slug).toBe('main')
      await app.close()
    })

    it('searches across multiple searchable columns (OR)', async () => {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: warehouseProjection,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/api/warehouses?search=return' })
      const body = res.json()
      expect(body.items).toHaveLength(1)
      expect(body.items[0].slug).toBe('returns')
      await app.close()
    })
  })

  describe('2. Metadata labelKey transform', () => {
    it('returns labelKey with fallback to `${boName}.${key}`', async () => {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: warehouseProjection,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/bo/warehouse' })
      const body = res.json()
      const slug = body.fields.find((f: any) => f.key === 'slug')
      expect(slug).toBeDefined()
      expect(slug.labelKey).toBe('warehouse.slug')
      expect(slug.label).toBeUndefined()
      await app.close()
    })
  })

  describe('3. Value help endpoints', () => {
    it('registers GET /bo/{name}/valueHelp/{vhName}', async () => {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: warehouseProjection,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/bo/warehouse/valueHelp/warehouse' })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.items).toHaveLength(4)
      expect(body.total).toBe(4)
      await app.close()
    })
  })

  describe('4. afterWrite hook', () => {
    it('calls afterWrite after successful create/update/delete', async () => {
      const calls: Array<{ action: string }> = []
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: warehouseProjection,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
        afterWrite: (_ctx, action) => { calls.push({ action }) },
      })

      await app.inject({
        method: 'POST', url: '/api/warehouses',
        payload: { id: 99, slug: 'temp', name: 'Temp' },
      })
      await app.inject({
        method: 'PUT', url: '/api/warehouses/temp',
        payload: { name: 'Temp Renamed' },
      })
      await app.inject({ method: 'DELETE', url: '/api/warehouses/temp' })

      expect(calls.map(c => c.action)).toEqual(['create', 'update', 'delete'])
      await app.close()
    })
  })

  describe('5 + 6. Global flag + write protection', () => {
    it('adds global: true for tenant-less rows when includeGlobal', async () => {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: warehouseProjection,
        view: warehouseView,
        includeGlobal: true,
        extractContext: () => ({ app, db: testDb.db, tenantId: 't1', locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/api/warehouses' })
      const body = res.json()
      const global = body.items.find((i: any) => i.slug === 'global-wh')
      const main = body.items.find((i: any) => i.slug === 'main')
      expect(global.global).toBe(true)
      expect(main.global).toBe(false)
      await app.close()
    })

    it('does NOT add global flag when includeGlobal is not set', async () => {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: warehouseProjection,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/api/warehouses' })
      const body = res.json()
      expect(body.items[0].global).toBeUndefined()
      await app.close()
    })

    it('returns 403 on PUT for global record when includeGlobal', async () => {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: warehouseProjection,
        view: warehouseView,
        includeGlobal: true,
        extractContext: () => ({ app, db: testDb.db, tenantId: 't1', locale: 'en' }),
      })

      const res = await app.inject({
        method: 'PUT', url: '/api/warehouses/global-wh',
        payload: { name: 'Hijacked' },
      })
      expect(res.statusCode).toBe(403)
      await app.close()
    })

    it('returns 403 on DELETE for global record when includeGlobal', async () => {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: warehouseProjection,
        view: warehouseView,
        includeGlobal: true,
        extractContext: () => ({ app, db: testDb.db, tenantId: 't1', locale: 'en' }),
      })

      const res = await app.inject({ method: 'DELETE', url: '/api/warehouses/global-wh' })
      expect(res.statusCode).toBe(403)
      await app.close()
    })

    it('allows PUT/DELETE for tenant-owned records', async () => {
      await testDb.raw("INSERT INTO warehouse (id, slug, name, tenant_id) VALUES (50, 'temp-tenant', 'Temp', 't1')")

      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: warehouseProjection,
        view: warehouseView,
        includeGlobal: true,
        extractContext: () => ({ app, db: testDb.db, tenantId: 't1', locale: 'en' }),
      })

      const delRes = await app.inject({ method: 'DELETE', url: '/api/warehouses/temp-tenant' })
      expect(delRes.statusCode).toBe(200)
      await app.close()
    })
  })
})
