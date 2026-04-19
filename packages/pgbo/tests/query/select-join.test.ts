import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { col } from '../../src/schema/column.js'
import { text, integer } from '../../src/schema/types.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import { createDatabase } from '../../src/query/client.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const appTable = table('app', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['id'],
})

const tileTable = table('tile', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    action: text(),
    appId: integer().notNull(),
    tenantId: text(),
  },
  primaryKey: ['id'],
})

const tileView = view('tile_view').from(tileTable)

describe('SELECT query builder: runtime JOINs', () => {
  describe('SQL generation', () => {
    it('.join() adds JOIN clause', () => {
      const db = createDatabase({ connectionString })
      const q = db.from(tileView)
        .join(appTable, { appId: 'id' })
        .toQuery()
      expect(q.text).toContain('FROM tile_view')
      expect(q.text).toContain('JOIN app ON tile_view.app_id = app.id')
      db.close()
    })

    it('.leftJoin() adds LEFT JOIN clause', () => {
      const db = createDatabase({ connectionString })
      const q = db.from(tileView)
        .leftJoin(appTable, { appId: 'id' })
        .toQuery()
      expect(q.text).toContain('LEFT JOIN app ON tile_view.app_id = app.id')
      db.close()
    })

    it('.select() narrows columns with table qualification', () => {
      const db = createDatabase({ connectionString })
      const q = db.from(tileView)
        .join(appTable, { appId: 'id' })
        .select({
          id: 'tile_view.id',
          slug: 'tile_view.slug',
          appSlug: 'app.slug',
          appName: 'app.name',
        })
        .toQuery()
      expect(q.text).toContain('tile_view.id AS id')
      expect(q.text).toContain('app.slug AS app_slug')
      expect(q.text).toContain('app.name AS app_name')
      db.close()
    })

    it('join + where + orderBy', () => {
      const db = createDatabase({ connectionString })
      const q = db.from(tileView)
        .join(appTable, { appId: 'id' })
        .where({ tenantId: 't1' })
        .orderBy('slug', 'asc')
        .toQuery()
      expect(q.text).toContain('JOIN app ON')
      expect(q.text).toContain('WHERE tenant_id = $1')
      expect(q.text).toContain('ORDER BY slug ASC')
      expect(q.values).toEqual(['t1'])
      db.close()
    })
  })

  describe('integration', () => {
    let testDb: TestDatabase

    beforeAll(async () => {
      testDb = await createTestDatabase({
        connectionString,
        schema: [appTable, tileTable],
        seed: [
          'CREATE OR REPLACE VIEW tile_view AS SELECT * FROM tile',
          "INSERT INTO app (id, slug, name) VALUES (1, 'dashboard', 'Dashboard')",
          "INSERT INTO app (id, slug, name) VALUES (2, 'reports', 'Reports')",
          "INSERT INTO tile (id, slug, action, app_id, tenant_id) VALUES (10, 'home', 'nav', 1, 't1')",
          "INSERT INTO tile (id, slug, action, app_id, tenant_id) VALUES (11, 'stats', 'open', 2, 't1')",
        ],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    it('runtime JOIN returns merged rows', async () => {
      const rows = await testDb.db.from(tileView)
        .join(appTable, { appId: 'id' })
        .select({
          tileSlug: 'tile_view.slug',
          appSlug: 'app.slug',
          appName: 'app.name',
        })
        .execute()

      expect(rows).toHaveLength(2)
      const home = rows.find((r: any) => r.tileSlug === 'home')!
      expect(home.appSlug).toBe('dashboard')
      expect(home.appName).toBe('Dashboard')
    })

    it('runtime JOIN with where on qualified column', async () => {
      const rows = await testDb.db.from(tileView)
        .join(appTable, { appId: 'id' })
        .select({
          tileSlug: 'tile_view.slug',
          appSlug: 'app.slug',
        })
        .where({ action: 'nav' })  // unambiguous column
        .execute()

      expect(rows).toHaveLength(1)
      expect(rows[0]!.appSlug).toBe('dashboard')
    })

    it('runtime JOIN count', async () => {
      const count = await testDb.db.from(tileView)
        .join(appTable, { appId: 'id' })
        .count()

      expect(count).toBe(2)
    })
  })
})
