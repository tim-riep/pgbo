import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { table, view, text, integer } from '@pgbo/core/schema'
import { defineBO, defineProjection } from '@pgbo/core/bo'
import { createTestDatabase, type TestDatabase } from '@pgbo/core/testing'
import { registerProjection } from '../src/index.js'

const connectionString = process.env.PGBO_TEST_URL ?? 'postgresql://localhost:5432/postgres'

const areaTable = table('area', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    internalNote: text(),  // sensitive — should be hidden on public projection
  },
  primaryKey: ['id'],
})

const areaView = view('area_view').from(areaTable)

describe('Projections as HTTP surface (issue #15)', () => {
  let testDb: TestDatabase

  const areaBO = defineBO(areaTable, {
    paramField: 'id',
    actions: {
      create: {},
      update: {},
      delete: {},
      rebuildCache: { handler: () => ({ ok: true }) },
      internalExport: { handler: () => ({ exported: 'secret' }) },
    },
  })

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [areaTable],
      seed: [
        'CREATE OR REPLACE VIEW area_view AS SELECT * FROM area',
        "INSERT INTO area (id, slug, name, internal_note) VALUES (1, 'nav', 'Navigation', 'keep quiet')",
        "INSERT INTO area (id, slug, name, internal_note) VALUES (2, 'admin', 'Admin', 'top secret')",
        "INSERT INTO area (id, slug, name, internal_note) VALUES (3, 'draft', 'Draft', null)",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  describe('action whitelist enforcement', () => {
    const areaPublic = defineProjection(areaBO, {
      name: 'areaPublic',
      actions: { read: true },  // ONLY read
    })

    function mkApp(): ReturnType<typeof Fastify> {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: areaPublic,
        view: areaView,
        
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })
      return app
    }

    it('read-only projection exposes GET list', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'GET', url: '/bo/areaPublic' })
      expect(res.statusCode).toBe(200)
      expect(res.json().items).toHaveLength(3)
      await app.close()
    })

    it('read-only projection exposes GET detail', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'GET', url: '/bo/areaPublic/1' })
      expect(res.statusCode).toBe(200)
      expect(res.json().slug).toBe('nav')
      await app.close()
    })

    it('read-only projection exposes GET metadata', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'GET', url: '/meta/areaPublic' })
      expect(res.statusCode).toBe(200)
      expect(res.json().name).toBe('areaPublic')
      await app.close()
    })

    it('read-only projection does NOT expose POST create', async () => {
      const app = mkApp()
      const res = await app.inject({
        method: 'POST', url: '/bo/areaPublic',
        payload: { id: 99, slug: 'x', name: 'X' },
      })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it('read-only projection does NOT expose PUT update', async () => {
      const app = mkApp()
      const res = await app.inject({
        method: 'PUT', url: '/bo/areaPublic/1', payload: { name: 'Hijacked' },
      })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it('read-only projection does NOT expose DELETE', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'DELETE', url: '/bo/areaPublic/1' })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it('read-only projection does NOT expose ANY custom action', async () => {
      const app = mkApp()
      const a = await app.inject({ method: 'POST', url: '/bo/areaPublic/rebuildCache' })
      const b = await app.inject({ method: 'POST', url: '/bo/areaPublic/internalExport' })
      expect(a.statusCode).toBe(404)
      expect(b.statusCode).toBe(404)
      await app.close()
    })
  })

  describe('selectively exposed custom action', () => {
    const areaAdmin = defineProjection(areaBO, {
      name: 'areaAdmin',
      actions: { read: true, create: true, update: true, delete: true, rebuildCache: true },
      // internalExport NOT whitelisted
    })

    function mkApp(): ReturnType<typeof Fastify> {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: areaAdmin,
        view: areaView,
        
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })
      return app
    }

    it('whitelisted custom action is exposed', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'POST', url: '/bo/areaAdmin/rebuildCache' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
      await app.close()
    })

    it('non-whitelisted custom action is hidden (404)', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'POST', url: '/bo/areaAdmin/internalExport' })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it('standard CRUD is exposed when whitelisted', async () => {
      const app = mkApp()
      const post = await app.inject({
        method: 'POST', url: '/bo/areaAdmin',
        payload: { id: 100, slug: 'new', name: 'New' },
      })
      expect(post.statusCode).toBe(201)

      const del = await app.inject({ method: 'DELETE', url: '/bo/areaAdmin/100' })
      expect(del.statusCode).toBe(200)
      await app.close()
    })
  })

  describe('column narrowing', () => {
    const areaMobile = defineProjection(areaBO, {
      name: 'areaMobile',
      actions: { read: true },
      columns: ['id', 'slug', 'name'],  // internalNote hidden
    })

    function mkApp(): ReturnType<typeof Fastify> {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: areaMobile,
        view: areaView,
        
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })
      return app
    }

    it('list response omits non-projected columns', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'GET', url: '/bo/areaMobile' })
      const body = res.json()
      expect(body.items[0]).toEqual({ id: 1, slug: 'nav', name: 'Navigation' })
      expect(body.items[0].internalNote).toBeUndefined()
      await app.close()
    })

    it('detail response omits non-projected columns', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'GET', url: '/bo/areaMobile/1' })
      const body = res.json()
      expect(body).toEqual({ id: 1, slug: 'nav', name: 'Navigation' })
      expect(body.internalNote).toBeUndefined()
      await app.close()
    })

    it('metadata response omits non-projected fields', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'GET', url: '/meta/areaMobile' })
      const fieldKeys = res.json().fields.map((f: { key: string }) => f.key)
      expect(fieldKeys).toEqual(['id', 'slug', 'name'])
      expect(fieldKeys).not.toContain('internalNote')
      await app.close()
    })
  })

  describe('root WHERE', () => {
    const publishedOnly = defineProjection(areaBO, {
      name: 'areaPublished',
      actions: { read: true, update: true, delete: true },
      where: { slug: { in: ['nav', 'admin'] } },  // 'draft' invisible
    })

    function mkApp(): ReturnType<typeof Fastify> {
      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: publishedOnly,
        view: areaView,
        
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })
      return app
    }

    it('list filters by root WHERE', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'GET', url: '/bo/areaPublished' })
      const slugs = res.json().items.map((i: { slug: string }) => i.slug).sort()
      expect(slugs).toEqual(['admin', 'nav'])  // 'draft' filtered out
      await app.close()
    })

    it('detail 404s for out-of-scope rows', async () => {
      const app = mkApp()
      // draft (id 3) exists but is invisible through this projection
      const res = await app.inject({ method: 'GET', url: '/bo/areaPublished/3' })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it('detail succeeds for in-scope rows', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'GET', url: '/bo/areaPublished/1' })
      expect(res.statusCode).toBe(200)
      await app.close()
    })

    it('update on out-of-scope row 404s', async () => {
      const app = mkApp()
      const res = await app.inject({
        method: 'PUT', url: '/bo/areaPublished/3', payload: { name: 'Hijacked' },
      })
      expect(res.statusCode).toBe(404)
      await app.close()
    })

    it('delete on out-of-scope row 404s', async () => {
      const app = mkApp()
      const res = await app.inject({ method: 'DELETE', url: '/bo/areaPublished/3' })
      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })

  describe('multi-projection isolation', () => {
    it('two projections over the same BO coexist with different surfaces', async () => {
      const areaRead = defineProjection(areaBO, {
        name: 'areaRead', actions: { read: true },
      })
      const areaFull = defineProjection(areaBO, {
        name: 'areaFull', actions: { read: true, create: true, update: true, delete: true, rebuildCache: true },
      })

      const app = Fastify()
      registerProjection(app, testDb.db, {
        projection: areaRead, view: areaView, 
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })
      registerProjection(app, testDb.db, {
        projection: areaFull, view: areaView, 
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })

      // Read available on both
      expect((await app.inject({ method: 'GET', url: '/bo/areaRead' })).statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/bo/areaFull' })).statusCode).toBe(200)

      // Delete only on admin
      expect((await app.inject({ method: 'DELETE', url: '/bo/areaRead/1' })).statusCode).toBe(404)
      // rebuildCache only on admin
      expect((await app.inject({ method: 'POST', url: '/bo/areaRead/rebuildCache' })).statusCode).toBe(404)
      expect((await app.inject({ method: 'POST', url: '/bo/areaFull/rebuildCache' })).statusCode).toBe(200)

      await app.close()
    })
  })
})
