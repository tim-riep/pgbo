import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import type { AuthHandler } from '../../src/query/client.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const warehouseTable = table('warehouse', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['id'],
})

// Restricted view — requires MANAGE_WAREHOUSE for READ, WRITE
const warehouseView = view('warehouse_view')
  .from(warehouseTable)
  .restrict({ grant: 'READ', to: 'MANAGE_WAREHOUSE' })
  .restrict({ grant: 'WRITE', to: 'MANAGE_WAREHOUSE' })

// Value help — no auth required
const warehouseVH = view('warehouse_vh')
  .from(warehouseTable)
  .noAuth()

// Unrestricted view — no annotations
const openView = view('open_view').from(warehouseTable)

// View with DELETE-specific restriction
const strictView = view('strict_view')
  .from(warehouseTable)
  .restrict({ grant: 'READ', to: 'VIEW_WH' })
  .restrict({ grant: 'WRITE', to: 'EDIT_WH' })
  .restrict({ grant: 'DELETE', to: 'DELETE_WH' })

// View with only WRITE restriction (DELETE should fall back)
const writeOnlyView = view('write_only_view')
  .from(warehouseTable)
  .restrict({ grant: 'WRITE', to: 'EDIT_WH' })

// View with restriction including where context
const scopedView = view('scoped_view')
  .from(warehouseTable)
  .restrict({ grant: 'READ', to: 'FRONTEND_DESIGN', where: { FRONTEND_OBJECT: 'PAGES' } })

describe('View auth annotations (issue 020)', () => {
  describe('metadata', () => {
    it('.restrict() accumulates restrictions on the view', () => {
      expect(warehouseView.restrictions).toHaveLength(2)
      expect(warehouseView.restrictions![0]).toEqual({ grant: 'READ', to: 'MANAGE_WAREHOUSE' })
      expect(warehouseView.restrictions![1]).toEqual({ grant: 'WRITE', to: 'MANAGE_WAREHOUSE' })
    })

    it('.noAuth() marks the view', () => {
      expect(warehouseVH.isNoAuth).toBe(true)
    })

    it('unrestricted view has no restrictions', () => {
      expect(openView.restrictions).toBeUndefined()
    })

    it('.restrict() with where context', () => {
      expect(scopedView.restrictions![0]!.where).toEqual({ FRONTEND_OBJECT: 'PAGES' })
    })
  })

  describe('enforcement', () => {
    let testDb: TestDatabase

    // Auth handler: only 'admin' user has all permissions
    const handler: AuthHandler = (userId, restriction) => {
      if (userId === 'admin') return true
      if (userId === 'viewer' && restriction.grant === 'READ') return true
      return false
    }

    beforeAll(async () => {
      testDb = await createTestDatabase({
        connectionString,
        schema: [warehouseTable],
        seed: [
          'CREATE OR REPLACE VIEW warehouse_view AS SELECT * FROM warehouse',
          'CREATE OR REPLACE VIEW warehouse_vh AS SELECT * FROM warehouse',
          'CREATE OR REPLACE VIEW open_view AS SELECT * FROM warehouse',
          'CREATE OR REPLACE VIEW strict_view AS SELECT * FROM warehouse',
          'CREATE OR REPLACE VIEW write_only_view AS SELECT * FROM warehouse',
          'CREATE OR REPLACE VIEW scoped_view AS SELECT * FROM warehouse',
          "INSERT INTO warehouse (id, slug, name) VALUES (1, 'main', 'Main')",
        ],
      })
      testDb.db.setAuthHandler(handler)
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    it('READ denied when handler returns false', async () => {
      await expect(
        testDb.db.from(warehouseView).as('nobody').execute(),
      ).rejects.toThrow(/Authorization denied.*nobody.*MANAGE_WAREHOUSE.*READ/)
    })

    it('READ allowed when handler returns true', async () => {
      const rows = await testDb.db.from(warehouseView).as('admin').execute()
      expect(rows).toHaveLength(1)
    })

    it('READ allowed for viewer role', async () => {
      const rows = await testDb.db.from(warehouseView).as('viewer').execute()
      expect(rows).toHaveLength(1)
    })

    it('WRITE denied for viewer on INSERT', async () => {
      await expect(
        testDb.db.into(warehouseView).values({ id: 2, slug: 'x', name: 'X' }).as('viewer').execute(),
      ).rejects.toThrow(/Authorization denied/)
    })

    it('WRITE allowed for admin on INSERT', async () => {
      await testDb.db.into(warehouseView).values({ id: 3, slug: 'y', name: 'Y' }).as('admin').execute()
    })

    it('WRITE denied for viewer on UPDATE', async () => {
      await expect(
        testDb.db.update(warehouseView).set({ name: 'X' }).where({ id: 1 }).as('viewer').execute(),
      ).rejects.toThrow(/Authorization denied/)
    })

    it('.noAuth() view always allowed regardless of handler', async () => {
      const rows = await testDb.db.from(warehouseVH).as('nobody').execute()
      expect(rows).toHaveLength(2) // main + y from admin insert
    })

    it('unrestricted view — no check (fail-open)', async () => {
      const rows = await testDb.db.from(openView).as('nobody').execute()
      expect(rows).toHaveLength(2)
    })

    it('.as(userId) without auth handler — no error', async () => {
      // Use a fresh DB without auth handler
      const freshDb = await createTestDatabase({
        connectionString,
        schema: [warehouseTable],
        seed: [
          'CREATE OR REPLACE VIEW warehouse_view AS SELECT * FROM warehouse',
          "INSERT INTO warehouse (id, slug, name) VALUES (1, 'a', 'A')",
        ],
      })
      const rows = await freshDb.db.from(warehouseView).as('anyone').execute()
      expect(rows).toHaveLength(1)
      await freshDb.dispose()
    })

    it('DELETE falls back to WRITE restriction', async () => {
      await expect(
        testDb.db.deleteFrom(writeOnlyView).where({ id: 999 }).as('viewer').execute(),
      ).rejects.toThrow(/Authorization denied.*viewer.*EDIT_WH.*WRITE/)
    })

    it('DELETE uses DELETE-specific restriction when available', async () => {
      await expect(
        testDb.db.deleteFrom(strictView).where({ id: 999 }).as('viewer').execute(),
      ).rejects.toThrow(/Authorization denied.*viewer.*DELETE_WH.*DELETE/)
    })

    it('count() also checks auth', async () => {
      await expect(
        testDb.db.from(warehouseView).as('nobody').count(),
      ).rejects.toThrow(/Authorization denied/)
    })

    it('_table operations bypass auth', async () => {
      const rows = await testDb.db._table.from(warehouseTable).execute()
      expect(rows.length).toBeGreaterThanOrEqual(1)
    })

    it('auth handler receives where context', async () => {
      let receivedRestriction: any
      const contextHandler: AuthHandler = (_userId, restriction) => {
        receivedRestriction = restriction
        return true
      }

      const freshDb = await createTestDatabase({
        connectionString,
        schema: [warehouseTable],
        seed: [
          'CREATE OR REPLACE VIEW scoped_view AS SELECT * FROM warehouse',
          "INSERT INTO warehouse (id, slug, name) VALUES (1, 'a', 'A')",
        ],
      })
      freshDb.db.setAuthHandler(contextHandler)
      await freshDb.db.from(scopedView).as('user1').execute()

      expect(receivedRestriction.to).toBe('FRONTEND_DESIGN')
      expect(receivedRestriction.where).toEqual({ FRONTEND_OBJECT: 'PAGES' })
      await freshDb.dispose()
    })
  })
})
