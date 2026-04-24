// Integration test for #23 — registerProjection must forward ctx to
// enrichAssociations so target BO compositions (e.g. translation lookup)
// resolve at the caller's locale.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { table, view, text, integer } from '@pgbo/core/schema'
import { foreignKey } from '@pgbo/core/schema'
import { defineBO, defineProjection } from '@pgbo/core/bo'
import { createTestDatabase, type TestDatabase } from '@pgbo/core/testing'
import { registerProjection } from '../src/index.js'

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
  foreignKeys: [foreignKey(['areaId']).references('area', ['id']).onDelete('CASCADE')],
})

const pageTable = table('page', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    areaId: integer().notNull(),
  },
  primaryKey: ['id'],
})

const pageView = view('page_view').from(pageTable)

describe('Association enrichment through HTTP (issue #23)', () => {
  let testDb: TestDatabase

  const areaBO = defineBO(areaTable, {
    paramField: 'id',
    actions: { create: {} },
    compositions: {
      translation: {
        table: areaTranslationTable,
        parentKey: 'areaId',
        cardinality: 'one',
        where: { locale: '$locale' },
        merge: ['name'],
      },
    },
  })

  const pageBO = defineBO(pageTable, {
    paramField: 'id',
    routePrefix: '/api/pages',
    actions: { create: {} },
    associations: {
      area: {
        foreignKey: 'areaId',
        target: areaBO,
        merge: ['name'],
        prefix: 'area',
      },
    },
  })

  const pageProjection = defineProjection(pageBO, {
    name: 'page',
    actions: { read: true },
  })

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [areaTable, areaTranslationTable, pageTable],
      seed: [
        'CREATE OR REPLACE VIEW page_view AS SELECT * FROM page',
        "INSERT INTO area (id, slug) VALUES (10, 'nav'), (20, 'admin')",
        "INSERT INTO area_translation (area_id, locale, name) VALUES (10, 'en', 'Navigation'), (10, 'de', 'Navigation DE'), (20, 'en', 'Admin'), (20, 'de', 'Verwaltung')",
        "INSERT INTO page (id, slug, area_id) VALUES (1, 'home', 10), (2, 'about', 10), (3, 'dashboard', 20)",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  function mkApp(locale: string): ReturnType<typeof Fastify> {
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: pageProjection,
      view: pageView,
      extractContext: () => ({ app, db: testDb.db, locale }),
    })
    return app
  }

  it('GET list merges target.name as areaName at $locale', async () => {
    const app = mkApp('en')
    const res = await app.inject({ method: 'GET', url: '/api/pages' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.items).toHaveLength(3)
    expect(body.items[0]).toMatchObject({ id: 1, slug: 'home', areaName: 'Navigation' })
    expect(body.items[2]).toMatchObject({ id: 3, slug: 'dashboard', areaName: 'Admin' })
    await app.close()
  })

  it('GET list resolves different locale through target compositions', async () => {
    const app = mkApp('de')
    const res = await app.inject({ method: 'GET', url: '/api/pages' })
    const names = res.json().items.map((i: { areaName: string }) => i.areaName)
    expect(names).toEqual(['Navigation DE', 'Navigation DE', 'Verwaltung'])
    await app.close()
  })

  it('GET detail enriches a single row too', async () => {
    const app = mkApp('en')
    const res = await app.inject({ method: 'GET', url: '/api/pages/1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ id: 1, slug: 'home', areaName: 'Navigation' })
    await app.close()
  })
})
