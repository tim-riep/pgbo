import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildWhere } from '../../src/query/where.js'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

describe('WHERE array operators: any / notAny', () => {
  describe('SQL generation', () => {
    it('any produces col = ANY($1) with array as single bound param', () => {
      const result = buildWhere({
        slug: { any: ['admin', 'user', 'guest'] },
      })
      expect(result.text).toBe('slug = ANY($1)')
      expect(result.values).toEqual([['admin', 'user', 'guest']])
    })

    it('notAny produces col != ALL($1)', () => {
      const result = buildWhere({
        slug: { notAny: ['seed1', 'seed2'] },
      })
      expect(result.text).toBe('slug != ALL($1)')
      expect(result.values).toEqual([['seed1', 'seed2']])
    })

    it('empty any array → FALSE', () => {
      const result = buildWhere({
        slug: { any: [] },
      })
      expect(result.text).toBe('FALSE')
      expect(result.values).toEqual([])
    })

    it('empty notAny array → TRUE', () => {
      const result = buildWhere({
        slug: { notAny: [] },
      })
      expect(result.text).toBe('TRUE')
      expect(result.values).toEqual([])
    })

    it('composes with other conditions', () => {
      const result = buildWhere({
        tenantId: 't1',
        warehouseSlug: { any: ['main', 'returns'] },
      })
      expect(result.text).toBe('tenant_id = $1 AND warehouse_slug = ANY($2)')
      expect(result.values).toEqual(['t1', ['main', 'returns']])
    })

    it('composes with OR/AND/NOT', () => {
      const result = buildWhere({
        AND: [
          { tenantId: { isNull: true } },
          { slug: { notAny: ['x', 'y'] } },
        ],
      })
      expect(result.text).toBe('(tenant_id IS NULL AND slug != ALL($1))')
      expect(result.values).toEqual([['x', 'y']])
    })

    it('camelCase column name becomes snake_case', () => {
      const result = buildWhere({
        warehouseSlug: { any: ['main'] },
      })
      expect(result.text).toContain('warehouse_slug = ANY($1)')
    })
  })

  describe('integration', () => {
    let testDb: TestDatabase

    const areaTable = table('area', {
      columns: {
        id: integer().notNull(),
        slug: text().notNull(),
        tenantId: text(),
      },
      primaryKey: ['id'],
    })

    const areaView = view('area_view').from(areaTable)

    beforeAll(async () => {
      testDb = await createTestDatabase({
        connectionString,
        schema: [areaTable],
        seed: [
          'CREATE OR REPLACE VIEW area_view AS SELECT * FROM area',
          "INSERT INTO area (id, slug, tenant_id) VALUES (1, 'north', 't1')",
          "INSERT INTO area (id, slug, tenant_id) VALUES (2, 'south', 't1')",
          "INSERT INTO area (id, slug, tenant_id) VALUES (3, 'east', 't2')",
          "INSERT INTO area (id, slug, tenant_id) VALUES (4, 'west', 't2')",
        ],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    it('any: fetches rows matching array', async () => {
      const rows = await testDb.db.from(areaView)
        .where({ slug: { any: ['north', 'south'] } })
        .execute()
      expect(rows).toHaveLength(2)
      expect(rows.map(r => r.slug).sort()).toEqual(['north', 'south'])
    })

    it('notAny: excludes rows matching array', async () => {
      const rows = await testDb.db.from(areaView)
        .where({ slug: { notAny: ['north', 'south'] } })
        .execute()
      expect(rows).toHaveLength(2)
      expect(rows.map(r => r.slug).sort()).toEqual(['east', 'west'])
    })

    it('any with empty array returns nothing', async () => {
      const rows = await testDb.db.from(areaView)
        .where({ slug: { any: [] } })
        .execute()
      expect(rows).toHaveLength(0)
    })

    it('notAny with empty array returns everything', async () => {
      const rows = await testDb.db.from(areaView)
        .where({ slug: { notAny: [] } })
        .execute()
      expect(rows).toHaveLength(4)
    })

    it('any + other conditions (tenant scoping)', async () => {
      const rows = await testDb.db.from(areaView)
        .where({
          tenantId: 't1',
          slug: { any: ['north', 'south', 'east'] },
        })
        .execute()
      expect(rows).toHaveLength(2)
      expect(rows.every(r => r.tenantId === 't1')).toBe(true)
    })

    it('notAny for stale cleanup pattern', async () => {
      // Delete all areas NOT in the kept list
      await testDb.db.deleteFrom(areaView)
        .where({ slug: { notAny: ['north', 'east'] } })
        .execute()

      const remaining = await testDb.db.from(areaView).execute()
      expect(remaining).toHaveLength(2)
      expect(remaining.map(r => r.slug).sort()).toEqual(['east', 'north'])

      // Restore deleted rows for other tests
      await testDb.raw(
        "INSERT INTO area (id, slug, tenant_id) VALUES (2, 'south', 't1'), (4, 'west', 't2')",
      )
    })
  })
})
