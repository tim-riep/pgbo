import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { col } from '../../src/schema/column.js'
import { text, integer } from '../../src/schema/types.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

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

describe('View JOIN support', () => {
  describe('SQL generation', () => {
    it('.join() generates correct JOIN DDL (R1, R3)', () => {
      const tileView = view('tile_detail_view')
        .from(tileTable)
        .join(appTable, { appId: 'id' })
        .columns({
          id: col('id'),
          slug: col('slug'),
          action: col('action'),
          appSlug: col('slug', appTable),
          tenantId: col('tenantId'),
        })

      const ddl = tileView.toSQL()
      expect(ddl).toContain('CREATE VIEW tile_detail_view AS')
      expect(ddl).toContain('FROM tile')
      expect(ddl).toContain('JOIN app ON tile.app_id = app.id')
      expect(ddl).toContain('app.slug AS app_slug')
      expect(ddl).toContain('tile.id')
      expect(ddl).toContain('tile.slug')
    })

    it('col() without source table defaults to primary table', () => {
      const tileView = view('tile_view')
        .from(tileTable)
        .join(appTable, { appId: 'id' })
        .columns({
          id: col('id'),
          appSlug: col('slug', appTable),
        })

      const ddl = tileView.toSQL()
      expect(ddl).toContain('tile.id')
      expect(ddl).toContain('app.slug AS app_slug')
    })

    it('multiple columns from joined table', () => {
      const tileView = view('tile_full_view')
        .from(tileTable)
        .join(appTable, { appId: 'id' })
        .columns({
          id: col('id'),
          appSlug: col('slug', appTable),
          appName: col('name', appTable),
        })

      const ddl = tileView.toSQL()
      expect(ddl).toContain('app.slug AS app_slug')
      expect(ddl).toContain('app.name AS app_name')
    })

    it('LEFT JOIN variant', () => {
      const tileView = view('tile_left_view')
        .from(tileTable)
        .leftJoin(appTable, { appId: 'id' })
        .columns({
          id: col('id'),
          appSlug: col('slug', appTable),
        })

      const ddl = tileView.toSQL()
      expect(ddl).toContain('LEFT JOIN app ON')
    })
  })

  describe('integration', () => {
    let testDb: TestDatabase

    beforeAll(async () => {
      testDb = await createTestDatabase({
        connectionString,
        schema: [appTable, tileTable],
        seed: [
          "INSERT INTO app (id, slug, name) VALUES (1, 'dashboard', 'Dashboard App')",
          "INSERT INTO app (id, slug, name) VALUES (2, 'reports', 'Reports App')",
          "INSERT INTO tile (id, slug, action, app_id, tenant_id) VALUES (10, 'home-tile', 'navigate', 1, 't1')",
          "INSERT INTO tile (id, slug, action, app_id, tenant_id) VALUES (11, 'report-tile', 'open', 2, 't1')",
          `CREATE OR REPLACE VIEW tile_detail_view AS
           SELECT t.id, t.slug, t.action, app.slug AS app_slug, t.tenant_id
           FROM tile t
           JOIN app ON t.app_id = app.id`,
        ],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    it('SELECT through joined view returns columns from both tables', async () => {
      const tileView = view('tile_detail_view')
        .from(tileTable)
        .join(appTable, { appId: 'id' })
        .columns({
          id: col('id'),
          slug: col('slug'),
          action: col('action'),
          appSlug: col('slug', appTable),
          tenantId: col('tenantId'),
        })

      const rows = await testDb.db.from(tileView).execute()
      expect(rows).toHaveLength(2)

      const homeTile = rows.find((r: any) => r.slug === 'home-tile')!
      expect(homeTile.appSlug).toBe('dashboard')

      const reportTile = rows.find((r: any) => r.slug === 'report-tile')!
      expect(reportTile.appSlug).toBe('reports')
    })
  })
})
