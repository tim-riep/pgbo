// Regression tests for issue #68 — `/meta/{name}` must surface
// `systemManaged` (#61) and `visibleWhen` (#62) on each field.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { table, view, text, timestamp, col, systemTimestamps } from '@pgbo/core/schema'
import { defineBO, defineProjection } from '@pgbo/core/bo'
import { createTestDatabase, type TestDatabase } from '@pgbo/core/testing'
import { registerProjection } from '../src/index.js'

const connectionString = process.env.PGBO_TEST_URL ?? 'postgresql://localhost:5432/postgres'

const linkTable = table('link', {
  columns: {
    slug: text().notNull(),
    kind: text().notNull(),
    iframeUrl: text(),
    label: text(),
    ...systemTimestamps(),
  },
  primaryKey: ['slug'],
})

const linkView = view('link_view').from(linkTable).columns({
  slug: col('slug'),
  kind: col('kind'),
  iframeUrl: col('iframeUrl').visibleWhen({ kind: 'iframe' }),
  label: col('label'),
  createdAt: col('createdAt'),
  updatedAt: col('updatedAt'),
})

// BO root is the view so view-column annotations (`.visibleWhen()`) surface
// in metadata. System-managed columns flow through either way because the
// marker lives on the column builder itself.
const linkBO = defineBO(linkView, {
  paramField: 'slug',
  actions: { create: {}, update: {}, delete: {} },
})

const linkProjection = defineProjection(linkBO, {
  name: 'link',
  actions: { read: true, create: true, update: true, delete: true },
})

describe('GET /meta/{name} — issue #68 passthrough', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [linkTable],
      seed: [
        `CREATE OR REPLACE VIEW link_view AS
         SELECT slug, kind, iframe_url, label, created_at, updated_at FROM link`,
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  function makeApp() {
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: linkProjection,
      view: linkView,
      extractContext: () => ({ app, db: testDb.db, locale: 'en' }),
    })
    return app
  }

  it('passes visibleWhen through to PublicFieldMeta', async () => {
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/meta/link' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const iframeUrl = body.fields.find((f: { key: string }) => f.key === 'iframeUrl')
    expect(iframeUrl).toBeDefined()
    expect(iframeUrl.visibleWhen).toEqual({ kind: 'iframe' })
    await app.close()
  })

  it('passes systemManaged through to PublicFieldMeta', async () => {
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/meta/link' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const createdAt = body.fields.find((f: { key: string }) => f.key === 'createdAt')
    const updatedAt = body.fields.find((f: { key: string }) => f.key === 'updatedAt')
    expect(createdAt.systemManaged).toBe('createdAt')
    expect(updatedAt.systemManaged).toBe('updatedAt')
    await app.close()
  })

  it('omits visibleWhen / systemManaged keys when not annotated', async () => {
    const app = makeApp()
    const res = await app.inject({ method: 'GET', url: '/meta/link' })
    const body = res.json()
    const slug = body.fields.find((f: { key: string }) => f.key === 'slug')
    const label = body.fields.find((f: { key: string }) => f.key === 'label')
    expect('visibleWhen' in slug).toBe(false)
    expect('systemManaged' in slug).toBe(false)
    expect('visibleWhen' in label).toBe(false)
    expect('systemManaged' in label).toBe(false)
    await app.close()
  })
})
