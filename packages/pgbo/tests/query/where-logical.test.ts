import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildWhere } from '../../src/query/where.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

describe('WHERE builder: OR / AND / NOT', () => {
  describe('SQL generation', () => {
    it('OR produces (clause1 OR clause2)', () => {
      const result = buildWhere({
        OR: [
          { tenantId: { isNull: true } },
          { tenantId: '123' },
        ],
      })
      expect(result.text).toBe('(tenant_id IS NULL OR tenant_id = $1)')
      expect(result.values).toEqual(['123'])
    })

    it('AND produces (clause1 AND clause2)', () => {
      const result = buildWhere({
        AND: [
          { status: 'ACTIVE' },
          { age: { gt: 18 } },
        ],
      })
      expect(result.text).toBe('(status = $1 AND age > $2)')
      expect(result.values).toEqual(['ACTIVE', 18])
    })

    it('NOT produces NOT (clause)', () => {
      const result = buildWhere({
        NOT: { status: 'ARCHIVED' },
      })
      expect(result.text).toBe('NOT (status = $1)')
      expect(result.values).toEqual(['ARCHIVED'])
    })

    it('OR combined with regular conditions', () => {
      const result = buildWhere({
        active: true,
        OR: [
          { tenantId: { isNull: true } },
          { tenantId: '123' },
        ],
      })
      expect(result.text).toBe('active = $1 AND (tenant_id IS NULL OR tenant_id = $2)')
      expect(result.values).toEqual([true, '123'])
    })

    it('nested OR inside AND', () => {
      const result = buildWhere({
        AND: [
          { status: 'ACTIVE' },
          {
            OR: [
              { slug: { ilike: '%test%' } },
              { name: { ilike: '%test%' } },
            ],
          },
        ],
      })
      expect(result.text).toBe('(status = $1 AND (slug ILIKE $2 OR name ILIKE $3))')
      expect(result.values).toEqual(['ACTIVE', '%test%', '%test%'])
    })

    it('NOT combined with other conditions', () => {
      const result = buildWhere({
        active: true,
        NOT: { status: 'ARCHIVED' },
      })
      expect(result.text).toBe('active = $1 AND NOT (status = $2)')
      expect(result.values).toEqual([true, 'ARCHIVED'])
    })

    it('paramIdx continues correctly across nested structures', () => {
      const result = buildWhere({
        tenantId: '123',
        OR: [
          { slug: 'admin' },
          { slug: 'system' },
        ],
        name: { ilike: '%test%' },
      })
      // tenantId=$1, slug=$2 OR slug=$3, name ILIKE $4
      expect(result.text).toBe('tenant_id = $1 AND (slug = $2 OR slug = $3) AND name ILIKE $4')
      expect(result.values).toEqual(['123', 'admin', 'system', '%test%'])
    })
  })

  describe('integration', () => {
    let testDb: TestDatabase

    const areaTable = table('area', {
      columns: {
        id: integer().notNull(),
        slug: text().notNull(),
        tenantId: text(),
        status: text().notNull().default('ACTIVE' as any),
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
          "INSERT INTO area (id, slug, tenant_id, status) VALUES (1, 'admin', NULL, 'ACTIVE')",
          "INSERT INTO area (id, slug, tenant_id, status) VALUES (2, 'north', '123', 'ACTIVE')",
          "INSERT INTO area (id, slug, tenant_id, status) VALUES (3, 'south', '123', 'ARCHIVED')",
          "INSERT INTO area (id, slug, tenant_id, status) VALUES (4, 'global', NULL, 'ACTIVE')",
        ],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    it('OR: tenant scoping with global records', async () => {
      const rows = await testDb.db.from(areaView).where({
        OR: [
          { tenantId: { isNull: true } },
          { tenantId: '123' },
        ],
      }).execute()
      expect(rows).toHaveLength(4) // all rows match
    })

    it('OR + regular condition: active global or tenant', async () => {
      const rows = await testDb.db.from(areaView).where({
        status: 'ACTIVE',
        OR: [
          { tenantId: { isNull: true } },
          { tenantId: '123' },
        ],
      }).execute()
      expect(rows).toHaveLength(3) // excludes ARCHIVED south
      expect(rows.find((r: any) => r.slug === 'south')).toBeUndefined()
    })

    it('NOT: exclude archived', async () => {
      const rows = await testDb.db.from(areaView).where({
        NOT: { status: 'ARCHIVED' },
      }).execute()
      expect(rows).toHaveLength(3)
      expect(rows.every((r: any) => r.status !== 'ARCHIVED')).toBe(true)
    })
  })
})
