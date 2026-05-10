// Integration tests for composite-key CRUD via the Fastify route factory (issue #51).
//
// Storage locations are scoped per warehouse, so the natural primary key is
// `(warehouseSlug, slug)`. The detail / update / delete URLs use OData-style
// segments like `/bo/storageLocation/(warehouseSlug='WH-1',slug='A1')`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { table, text, view } from '@pgbo/core/schema'
import { defineBO, defineProjection } from '@pgbo/core/bo'
import { createTestDatabase, type TestDatabase } from '@pgbo/core/testing'
import { registerProjection } from '../src/index.js'

const connectionString = process.env.PGBO_TEST_URL ?? 'postgresql://localhost:5432/postgres'

const storageLocationTable = table('storage_location', {
  columns: {
    warehouseSlug: text().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['warehouse_slug', 'slug'],
})

const storageLocationView = view('storage_location_view').from(storageLocationTable)

const storageLocationBO = defineBO(storageLocationTable, {
  paramField: ['warehouseSlug', 'slug'],
  actions: { create: {}, update: {}, delete: {} },
})

const storageLocationProjection = defineProjection(storageLocationBO, {
  name: 'storageLocation',
  actions: { read: true, create: true, update: true, delete: true },
})

describe('Fastify routes — composite paramField (issue #51)', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [storageLocationTable],
      seed: [
        'CREATE OR REPLACE VIEW storage_location_view AS SELECT * FROM storage_location',
        "INSERT INTO storage_location (warehouse_slug, slug, name) VALUES ('WH-1', 'A1', 'Aisle 1')",
        "INSERT INTO storage_location (warehouse_slug, slug, name) VALUES ('WH-1', 'A2', 'Aisle 2')",
        "INSERT INTO storage_location (warehouse_slug, slug, name) VALUES ('WH-2', 'A1', 'Other Aisle 1')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  function makeApp() {
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: storageLocationProjection,
      view: storageLocationView,
      extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
    })
    return app
  }

  it('GET /meta/{name} emits paramField as an array', async () => {
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/meta/storageLocation' })
    expect(res.statusCode).toBe(200)
    expect(res.json().paramField).toEqual(['warehouseSlug', 'slug'])
    await app.close()
  })

  it('GET detail by OData composite key', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: "/bo/storageLocation/(warehouseSlug='WH-1',slug='A1')",
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.warehouseSlug).toBe('WH-1')
    expect(body.slug).toBe('A1')
    expect(body.name).toBe('Aisle 1')
    await app.close()
  })

  it('GET detail respects all key columns — same slug, different warehouse', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: "/bo/storageLocation/(warehouseSlug='WH-2',slug='A1')",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Other Aisle 1')
    await app.close()
  })

  it('GET detail 404 when composite key does not match any row', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: "/bo/storageLocation/(warehouseSlug='WH-1',slug='ZZZ')",
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('GET detail 400-ish when path segment is not OData-form', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/bo/storageLocation/just-a-string',
    })
    // The handler throws — Fastify maps to 500. The important thing is that
    // a non-composite path doesn't silently produce a wrong-row match.
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    await app.close()
  })

  it('PUT updates a row by composite key', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'PUT',
      url: "/bo/storageLocation/(warehouseSlug='WH-1',slug='A2')",
      payload: { name: 'Aisle 2 Renamed' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Aisle 2 Renamed')

    // Restore for downstream tests
    await testDb.raw("UPDATE storage_location SET name = 'Aisle 2' WHERE warehouse_slug = 'WH-1' AND slug = 'A2'")
    await app.close()
  })

  it('DELETE removes the right row by composite key', async () => {
    await testDb.raw("INSERT INTO storage_location (warehouse_slug, slug, name) VALUES ('WH-1', 'TMP', 'Temp')")
    const app = makeApp()
    const res = await app.inject({
      method: 'DELETE',
      url: "/bo/storageLocation/(warehouseSlug='WH-1',slug='TMP')",
    })
    expect(res.statusCode).toBe(200)

    const remaining = await testDb.raw(
      "SELECT * FROM storage_location WHERE warehouse_slug = 'WH-1' AND slug = 'TMP'",
    )
    expect(remaining).toHaveLength(0)
    await app.close()
  })

  it('POST creates a new row with the composite key columns in body', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/bo/storageLocation',
      payload: { warehouseSlug: 'WH-1', slug: 'NEW1', name: 'Created' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.warehouseSlug).toBe('WH-1')
    expect(body.slug).toBe('NEW1')

    await testDb.raw("DELETE FROM storage_location WHERE warehouse_slug = 'WH-1' AND slug = 'NEW1'")
    await app.close()
  })

  it('PUT 404 when composite key is out of scope', async () => {
    const app = makeApp()
    const res = await app.inject({
      method: 'PUT',
      url: "/bo/storageLocation/(warehouseSlug='WH-1',slug='ZZZ')",
      payload: { name: 'whatever' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
