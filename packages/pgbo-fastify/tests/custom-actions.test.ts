import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { table, view, text, integer } from '@pgbo/core/schema'
import { defineBO, defineProjection } from '@pgbo/core/bo'
import { createTestDatabase, type TestDatabase } from '@pgbo/core/testing'
import { registerProjection, type FileResponse } from '../src/index.js'

const connectionString = process.env.PGBO_TEST_URL ?? 'postgresql://localhost:5432/postgres'

const roleTable = table('role', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
  },
  primaryKey: ['id'],
})

const roleView = view('role_view').from(roleTable)

describe('Custom BO actions exposed as HTTP routes (issues #5 + #7)', () => {
  let testDb: TestDatabase

  const roleBO = defineBO(roleTable, {
    paramField: 'id',
    
    actions: {
      // Standard
      create: {},
      update: {},
      delete: {},
      // Custom — returns JSON
      availableFragments: {
        handler: (ctx, data) => [
          { slug: 'MANAGE_STOCK', context: data, user: (ctx as { userId?: string }).userId },
          { slug: 'MANAGE_USERS' },
        ],
      },
      // Custom — returns a value that echoes the input
      objectRefValues: {
        handler: (_ctx, data) => ({ echoed: data }),
      },
      // Custom — returns a FileResponse (PDF)
      pdf: {
        handler: () => {
          const buffer = Buffer.from('%PDF-1.4 fake pdf content')
          return {
            data: buffer,
            contentType: 'application/pdf',
            filename: 'report.pdf',
            inline: true,
          } satisfies FileResponse
        },
      },
      // Custom — returns void (no response body)
      markRead: {
        handler: () => undefined,
      },
    },
  })

  const roleProjection = defineProjection(roleBO, {
    name: 'role',
    actions: {
      read: true, create: true, update: true, delete: true,
      availableFragments: true, objectRefValues: true, pdf: true, markRead: true,
    },
  })

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [roleTable],
      seed: [
        'CREATE OR REPLACE VIEW role_view AS SELECT * FROM role',
        "INSERT INTO role (id, slug) VALUES (1, 'admin')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  function mkApp(): ReturnType<typeof Fastify> {
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: roleProjection,
      view: roleView,
      extractContext: () => ({ app, db: testDb.db, locale: 'en', userId: 'user-123' }),
    })
    return app
  }

  it('registers POST /bo/{name}/{actionName} for each custom action', async () => {
    const app = mkApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bo/role/availableFragments',
      payload: { scope: 'global' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(2)
    expect(body[0].slug).toBe('MANAGE_STOCK')
    expect(body[0].user).toBe('user-123')
    expect(body[0].context).toEqual({ scope: 'global' })
    await app.close()
  })

  it('passes the request body to the action as data', async () => {
    const app = mkApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bo/role/objectRefValues',
      payload: { fieldSlug: 'WAREHOUSE', id: 42 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ echoed: { fieldSlug: 'WAREHOUSE', id: 42 } })
    await app.close()
  })

  it('does NOT register a /{actionName} route for standard create/update/delete', async () => {
    const app = mkApp()
    const res = await app.inject({ method: 'POST', url: '/bo/role/create', payload: {} })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('returns 204 when the action returns undefined', async () => {
    const app = mkApp()
    const res = await app.inject({ method: 'POST', url: '/bo/role/markRead', payload: {} })
    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    await app.close()
  })

  it('sends binary when the action returns a FileResponse', async () => {
    const app = mkApp()
    const res = await app.inject({ method: 'POST', url: '/bo/role/pdf', payload: {} })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toBe('inline; filename="report.pdf"')
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength('%PDF-1.4 fake pdf content')))
    expect(res.rawPayload.toString()).toBe('%PDF-1.4 fake pdf content')
    await app.close()
  })

  it('defaults Content-Disposition to attachment when inline is false', async () => {
    const testBO = defineBO(roleTable, {
      paramField: 'id',
      
      actions: {
        download: {
          handler: () => ({
            data: Buffer.from('hello'),
            contentType: 'text/plain',
            filename: 'hello.txt',
          } satisfies FileResponse),
        },
      },
    })
    const testProjection = defineProjection(testBO, { name: 'role', actions: { download: true } })
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: testProjection,
      view: roleView,
      extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
    })
    const res = await app.inject({ method: 'POST', url: '/bo/role/download', payload: {} })
    expect(res.headers['content-disposition']).toBe('attachment; filename="hello.txt"')
    await app.close()
  })

  it('works with an empty body', async () => {
    const app = mkApp()
    const res = await app.inject({ method: 'POST', url: '/bo/role/availableFragments' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(2)
    await app.close()
  })

  it('returns a 500 when the action throws', async () => {
    const throwingBO = defineBO(roleTable, {
      paramField: 'id',
      
      actions: {
        broken: {
          handler: () => { throw new Error('boom') },
        },
      },
    })
    const throwingProjection = defineProjection(throwingBO, { name: 'role', actions: { broken: true } })
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: throwingProjection,
      view: roleView,
      extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
    })
    const res = await app.inject({ method: 'POST', url: '/bo/role/broken', payload: {} })
    expect(res.statusCode).toBe(500)
    await app.close()
  })
})
