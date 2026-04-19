import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { table, text, integer, view } from '@pgbo/core/schema'
import { defineBO } from '@pgbo/core/bo'
import { createTestDatabase, type TestDatabase } from '@pgbo/core/testing'
import { registerBoRoutes, registerViewRoute } from '../src/index.js'

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

const warehouseView = view('warehouse_view').from(warehouseTable)

const warehouseBO = defineBO(warehouseTable, {
  paramField: 'slug',
  actions: { create: {}, update: {}, delete: {} },
  routePrefix: '/api/warehouses',
  orderBy: 'name',
})

describe('pgbo-fastify route factory', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [warehouseTable],
      seed: [
        'CREATE OR REPLACE VIEW warehouse_view AS SELECT * FROM warehouse',
        "INSERT INTO warehouse (id, slug, name, tenant_id) VALUES (1, 'main', 'Main', 't1')",
        "INSERT INTO warehouse (id, slug, name, tenant_id) VALUES (2, 'returns', 'Returns', 't1')",
        "INSERT INTO warehouse (id, slug, name, tenant_id) VALUES (3, 'other', 'Other', 't2')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  describe('registerBoRoutes', () => {
    it('GET list returns paginated items', async () => {
      const app = Fastify()
      registerBoRoutes(app, testDb.db, {
        bo: warehouseBO,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/api/warehouses' })
      const body = res.json()
      expect(res.statusCode).toBe(200)
      expect(body.items).toHaveLength(3)
      expect(body.total).toBe(3)
      expect(body.page).toBe(1)
      expect(body.limit).toBe(25)
      await app.close()
    })

    it('GET list respects ?limit and ?page', async () => {
      const app = Fastify()
      registerBoRoutes(app, testDb.db, {
        bo: warehouseBO,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/api/warehouses?limit=1&page=2' })
      const body = res.json()
      expect(body.items).toHaveLength(1)
      expect(body.page).toBe(2)
      expect(body.limit).toBe(1)
      await app.close()
    })

    it('GET single item by paramField', async () => {
      const app = Fastify()
      registerBoRoutes(app, testDb.db, {
        bo: warehouseBO,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/api/warehouses/main' })
      const body = res.json()
      expect(res.statusCode).toBe(200)
      expect(body.slug).toBe('main')
      expect(body.name).toBe('Main')
      await app.close()
    })

    it('GET single item 404 when not found', async () => {
      const app = Fastify()
      registerBoRoutes(app, testDb.db, {
        bo: warehouseBO,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/api/warehouses/nonexistent' })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it('GET /bo/{name} returns metadata', async () => {
      const app = Fastify()
      registerBoRoutes(app, testDb.db, {
        bo: warehouseBO,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/bo/warehouse' })
      const body = res.json()
      expect(res.statusCode).toBe(200)
      expect(body.fields).toBeDefined()
      expect(body.paramField).toBe('slug')
      await app.close()
    })

    it('POST creates a new item', async () => {
      const app = Fastify()
      registerBoRoutes(app, testDb.db, {
        bo: warehouseBO,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({
        method: 'POST', url: '/api/warehouses',
        payload: { id: 10, slug: 'new-wh', name: 'New WH' },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().slug).toBe('new-wh')

      // Clean up
      await testDb.raw("DELETE FROM warehouse WHERE slug = 'new-wh'")
      await app.close()
    })

    it('DELETE removes an item', async () => {
      await testDb.raw("INSERT INTO warehouse (id, slug, name) VALUES (99, 'temp', 'Temp')")
      const app = Fastify()
      registerBoRoutes(app, testDb.db, {
        bo: warehouseBO,
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'DELETE', url: '/api/warehouses/temp' })
      expect(res.statusCode).toBe(200)

      const check = await testDb.raw("SELECT * FROM warehouse WHERE slug = 'temp'")
      expect(check).toHaveLength(0)
      await app.close()
    })
  })

  describe('registerViewRoute', () => {
    it('GET returns paginated view data', async () => {
      const app = Fastify()
      registerViewRoute(app, testDb.db, {
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/view/warehouse_view' })
      const body = res.json()
      expect(res.statusCode).toBe(200)
      expect(body.items).toHaveLength(3)
      expect(body.total).toBe(3)
      await app.close()
    })

    it('GET /meta returns view metadata', async () => {
      const app = Fastify()
      registerViewRoute(app, testDb.db, {
        view: warehouseView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      const res = await app.inject({ method: 'GET', url: '/view/warehouse_view/meta' })
      expect(res.statusCode).toBe(200)
      expect(res.json().fields).toBeDefined()
      await app.close()
    })
  })
})
