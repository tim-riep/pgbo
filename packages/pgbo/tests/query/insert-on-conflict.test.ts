import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { createDatabase } from '../../src/query/client.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const stockTable = table('stock_level', {
  columns: {
    tenantId: text().notNull(),
    wku: text().notNull(),
    warehouseSlug: text().notNull(),
    quantity: integer().notNull().default(0),
  },
  primaryKey: ['tenantId', 'wku', 'warehouseSlug'],
})

const stockView = view('stock_view').from(stockTable)

const countryTable = table('country', {
  columns: {
    code: text().notNull(),
    alpha3: text().notNull(),
    numericCode: text().notNull(),
  },
  primaryKey: ['code'],
})

const countryView = view('country_view').from(countryTable)

describe('InsertBuilder.onConflict()', () => {
  describe('SQL generation', () => {
    it('.doNothing() generates ON CONFLICT DO NOTHING', () => {
      const db = createDatabase({ connectionString })
      const q = db.into(countryView)
        .values({ code: 'DE', alpha3: 'DEU', numericCode: '276' })
        .onConflict(['code']).doNothing()
        .toQuery()
      expect(q.text).toBe('INSERT INTO country_view (code, alpha3, numeric_code) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING')
      expect(q.values).toEqual(['DE', 'DEU', '276'])
      db.close()
    })

    it('.doUpdate({literals}) generates ON CONFLICT DO UPDATE SET', () => {
      const db = createDatabase({ connectionString })
      const q = db.into(countryView)
        .values({ code: 'DE', alpha3: 'DEU', numericCode: '276' })
        .onConflict(['code']).doUpdate({
          alpha3: 'DEU',
          numericCode: '276',
        })
        .toQuery()
      expect(q.text).toBe('INSERT INTO country_view (code, alpha3, numeric_code) VALUES ($1, $2, $3) ON CONFLICT (code) DO UPDATE SET alpha3 = $4, numeric_code = $5')
      expect(q.values).toEqual(['DE', 'DEU', '276', 'DEU', '276'])
      db.close()
    })

    it('.doUpdate({ excluded: true }) uses EXCLUDED.col', () => {
      const db = createDatabase({ connectionString })
      const q = db.into(countryView)
        .values({ code: 'DE', alpha3: 'DEU', numericCode: '276' })
        .onConflict(['code']).doUpdate({
          alpha3: { excluded: true },
          numericCode: { excluded: true },
        })
        .toQuery()
      expect(q.text).toContain('ON CONFLICT (code) DO UPDATE SET alpha3 = EXCLUDED.alpha3, numeric_code = EXCLUDED.numeric_code')
      expect(q.values).toEqual(['DE', 'DEU', '276'])
      db.close()
    })

    it('.doUpdate({ increment: N }) adds table.col + value', () => {
      const db = createDatabase({ connectionString })
      const q = db.into(stockView)
        .values({ tenantId: 't1', wku: 'W1', warehouseSlug: 'MAIN', quantity: 10 })
        .onConflict(['tenantId', 'wku', 'warehouseSlug']).doUpdate({
          quantity: { increment: 10 },
        })
        .toQuery()
      expect(q.text).toContain('ON CONFLICT (tenant_id, wku, warehouse_slug) DO UPDATE SET quantity = stock_view.quantity + $5')
      expect(q.values).toEqual(['t1', 'W1', 'MAIN', 10, 10])
      db.close()
    })

    it('.doUpdate({ decrement: N }) subtracts', () => {
      const db = createDatabase({ connectionString })
      const q = db.into(stockView)
        .values({ tenantId: 't1', wku: 'W1', warehouseSlug: 'MAIN', quantity: 5 })
        .onConflict(['tenantId', 'wku', 'warehouseSlug']).doUpdate({
          quantity: { decrement: 5 },
        })
        .toQuery()
      expect(q.text).toContain('quantity = stock_view.quantity - $5')
      db.close()
    })

    it('composes with .returning()', () => {
      const db = createDatabase({ connectionString })
      const q = db.into(stockView)
        .values({ tenantId: 't1', wku: 'W1', warehouseSlug: 'MAIN', quantity: 10 })
        .onConflict(['tenantId', 'wku', 'warehouseSlug']).doUpdate({
          quantity: { increment: 10 },
        })
        .returning('*')
        .toQuery()
      expect(q.text).toContain('DO UPDATE SET')
      expect(q.text).toContain('RETURNING *')
      db.close()
    })
  })

  describe('integration', () => {
    let testDb: TestDatabase

    beforeAll(async () => {
      testDb = await createTestDatabase({
        connectionString,
        schema: [stockTable, countryTable],
        seed: [
          'CREATE OR REPLACE VIEW stock_view AS SELECT * FROM stock_level',
          'CREATE OR REPLACE VIEW country_view AS SELECT * FROM country',
        ],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    beforeEach(async () => {
      await testDb.reset()
    })

    it('DO NOTHING skips existing rows', async () => {
      await testDb.db.into(countryView)
        .values({ code: 'DE', alpha3: 'DEU', numericCode: '276' })
        .execute()

      // Re-insert with DO NOTHING — no error, no update
      await testDb.db.into(countryView)
        .values({ code: 'DE', alpha3: 'XXX', numericCode: '999' })
        .onConflict(['code']).doNothing()
        .execute()

      const rows = await testDb.db.from(countryView).where({ code: 'DE' }).execute()
      expect(rows[0]!.alpha3).toBe('DEU')  // not overwritten
    })

    it('DO UPDATE with literals overwrites', async () => {
      await testDb.db.into(countryView)
        .values({ code: 'DE', alpha3: 'OLD', numericCode: '000' })
        .execute()

      await testDb.db.into(countryView)
        .values({ code: 'DE', alpha3: 'DEU', numericCode: '276' })
        .onConflict(['code']).doUpdate({
          alpha3: 'DEU',
          numericCode: '276',
        })
        .execute()

      const rows = await testDb.db.from(countryView).where({ code: 'DE' }).execute()
      expect(rows[0]!.alpha3).toBe('DEU')
      expect(rows[0]!.numericCode).toBe('276')
    })

    it('DO UPDATE with EXCLUDED uses incoming values', async () => {
      await testDb.db.into(countryView)
        .values({ code: 'FR', alpha3: 'OLD', numericCode: '000' })
        .execute()

      await testDb.db.into(countryView)
        .values({ code: 'FR', alpha3: 'FRA', numericCode: '250' })
        .onConflict(['code']).doUpdate({
          alpha3: { excluded: true },
          numericCode: { excluded: true },
        })
        .execute()

      const rows = await testDb.db.from(countryView).where({ code: 'FR' }).execute()
      expect(rows[0]!.alpha3).toBe('FRA')
      expect(rows[0]!.numericCode).toBe('250')
    })

    it('DO UPDATE with increment adds to existing quantity', async () => {
      await testDb.db.into(stockView)
        .values({ tenantId: 't1', wku: 'W1', warehouseSlug: 'MAIN', quantity: 10 })
        .execute()

      // Increment by 5
      const [updated] = await testDb.db.into(stockView)
        .values({ tenantId: 't1', wku: 'W1', warehouseSlug: 'MAIN', quantity: 5 })
        .onConflict(['tenantId', 'wku', 'warehouseSlug']).doUpdate({
          quantity: { increment: 5 },
        })
        .returning('*')
        .execute()

      expect(updated!.quantity).toBe(15)
    })

    it('DO UPDATE with decrement subtracts', async () => {
      await testDb.db.into(stockView)
        .values({ tenantId: 't1', wku: 'W1', warehouseSlug: 'MAIN', quantity: 20 })
        .execute()

      const [updated] = await testDb.db.into(stockView)
        .values({ tenantId: 't1', wku: 'W1', warehouseSlug: 'MAIN', quantity: 7 })
        .onConflict(['tenantId', 'wku', 'warehouseSlug']).doUpdate({
          quantity: { decrement: 7 },
        })
        .returning('*')
        .execute()

      expect(updated!.quantity).toBe(13)
    })

    it('works inside a transaction', async () => {
      await testDb.db.transaction(async (tx) => {
        await tx.into(countryView)
          .values({ code: 'IT', alpha3: 'ITA', numericCode: '380' })
          .onConflict(['code']).doNothing()
          .execute()
      })

      const rows = await testDb.db.from(countryView).where({ code: 'IT' }).execute()
      expect(rows).toHaveLength(1)
    })
  })
})
