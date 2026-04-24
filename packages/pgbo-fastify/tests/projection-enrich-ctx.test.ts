// Regression test for issue #20:
// registerProjection must forward ctx to enrichCompositions so placeholder
// compositions (where: { locale: '$locale' }) work through HTTP.

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

const areaView = view('area_view').from(areaTable)

describe('issue #20 — registerProjection forwards ctx to enrichCompositions', () => {
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

  const areaProjection = defineProjection(areaBO, {
    name: 'area',
    actions: { read: true },
  })

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [areaTable, areaTranslationTable],
      seed: [
        'CREATE OR REPLACE VIEW area_view AS SELECT * FROM area',
        "INSERT INTO area (id, slug) VALUES (1, 'nav')",
        "INSERT INTO area (id, slug) VALUES (2, 'admin')",
        "INSERT INTO area_translation (area_id, locale, name) VALUES (1, 'en', 'Navigation')",
        "INSERT INTO area_translation (area_id, locale, name) VALUES (1, 'de', 'Navigation DE')",
        "INSERT INTO area_translation (area_id, locale, name) VALUES (2, 'en', 'Admin')",
        "INSERT INTO area_translation (area_id, locale, name) VALUES (2, 'de', 'Verwaltung')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  function mkApp(locale: string): ReturnType<typeof Fastify> {
    const app = Fastify()
    registerProjection(app, testDb.db, {
      projection: areaProjection,
      view: areaView,
      prefix: '/api/areas',
      extractContext: () => ({ app, db: testDb.db, locale }),
    })
    return app
  }

  it('GET list resolves $locale from ctx — no 500', async () => {
    const app = mkApp('en')
    const res = await app.inject({ method: 'GET', url: '/api/areas' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    // merge: ['name'] lifts translation.name onto parent
    const byId = Object.fromEntries(body.items.map((i: { id: number; name: string }) => [i.id, i.name]))
    expect(byId).toEqual({ 1: 'Navigation', 2: 'Admin' })
    await app.close()
  })

  it('different locale → different merged name', async () => {
    const app = mkApp('de')
    const res = await app.inject({ method: 'GET', url: '/api/areas' })
    expect(res.statusCode).toBe(200)
    const byId = Object.fromEntries(res.json().items.map((i: { id: number; name: string }) => [i.id, i.name]))
    expect(byId).toEqual({ 1: 'Navigation DE', 2: 'Verwaltung' })
    await app.close()
  })

  it('GET detail resolves $locale from ctx', async () => {
    const app = mkApp('de')
    const res = await app.inject({ method: 'GET', url: '/api/areas/1' })
    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Navigation DE')
    await app.close()
  })
})
