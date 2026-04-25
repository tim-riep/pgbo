// Regression test for issue #24:
// `/meta/{name}` lives in its own namespace (not `/bo/{name}/meta`) so it can't
// collide with the canonical `/bo/{projection.name}` list route under any name
// (issue #24 + #44 — URL layout is now locked to that pattern, no overrides).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { table, view, text, integer } from '@pgbo/core/schema'
import { defineBO, defineProjection } from '@pgbo/core/bo'
import { createTestDatabase, type TestDatabase } from '@pgbo/core/testing'
import { registerProjection } from '../src/index.js'

const connectionString = process.env.PGBO_TEST_URL ?? 'postgresql://localhost:5432/postgres'

const thingTable = table('thing', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['id'],
})

const thingView = view('thing_view').from(thingTable)

describe('issue #24 — canonical /bo/{name} does not collide with /meta/{name}', () => {
  let testDb: TestDatabase

  const thingBO = defineBO(thingTable, {
    paramField: 'id',
    actions: { create: {}, update: {}, delete: {} },
  })

  const thingProjection = defineProjection(thingBO, {
    name: 'thing',
    actions: { read: true, create: true, update: true, delete: true },
  })

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [thingTable],
      seed: [
        'CREATE OR REPLACE VIEW thing_view AS SELECT * FROM thing',
        "INSERT INTO thing (id, slug, name) VALUES (1, 'alpha', 'Alpha')",
        "INSERT INTO thing (id, slug, name) VALUES (2, 'beta', 'Beta')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('registers without Fastify complaining about duplicate routes', async () => {
    const app = Fastify()
    expect(() => {
      registerProjection(app, testDb.db, {
        projection: thingProjection,
        view: thingView,
        extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
      })
    }).not.toThrow()
    await app.ready()  // forces Fastify to finalize the router
    await app.close()
  })

  it('list route still serves data', async () => {
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: thingProjection,
      view: thingView,
      extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
    })
    const res = await app.inject({ method: 'GET', url: '/bo/thing' })
    expect(res.statusCode).toBe(200)
    expect(res.json().items).toHaveLength(2)
    await app.close()
  })

  it('detail route still serves a single row', async () => {
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: thingProjection,
      view: thingView,
      extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
    })
    const res = await app.inject({ method: 'GET', url: '/bo/thing/1' })
    expect(res.statusCode).toBe(200)
    expect(res.json().slug).toBe('alpha')
    await app.close()
  })

  it('metadata is reachable at a distinct path that does not collide with list', async () => {
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: thingProjection,
      view: thingView,
      extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
    })
    const res = await app.inject({ method: 'GET', url: '/meta/thing' })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('thing')
    expect(Array.isArray(res.json().fields)).toBe(true)
    await app.close()
  })
})
