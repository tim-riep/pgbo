import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { col } from '../../src/schema/column.js'
import { subqueryCount } from '../../src/schema/subquery.js'
import { text, integer } from '../../src/schema/types.js'
import { foreignKey } from '../../src/schema/constraints.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import type { InferViewRow } from '../../src/schema/infer.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const stockDocumentTable = table('stock_document', {
  columns: {
    id: integer().notNull(),
    documentNumber: text().notNull(),
  },
  primaryKey: ['id'],
})

const stockDocumentItemTable = table('stock_document_item', {
  columns: {
    id: integer().notNull(),
    documentId: integer().notNull(),
    status: text(),
  },
  primaryKey: ['id'],
  foreignKeys: [
    foreignKey(['documentId']).references('stock_document', ['id']).onDelete('CASCADE'),
  ],
})

describe('View with subqueryCount columns (issue 014)', () => {
  describe('SQL generation', () => {
    it('emits scalar subquery with parent-child join', () => {
      const v = view('stock_document_list_view')
        .from(stockDocumentTable)
        .columns({
          id: col('id'),
          documentNumber: col('documentNumber'),
          itemCount: subqueryCount(stockDocumentItemTable, { id: 'documentId' }),
        })

      const ddl = v.toSQL()
      expect(ddl).toContain('FROM stock_document')
      expect(ddl).toContain('(SELECT COUNT(*) FROM stock_document_item WHERE stock_document_item.document_id = stock_document.id)')
      expect(ddl).toContain('AS item_count')
    })

    it('supports optional where filter on subquery', () => {
      const v = view('sdv').from(stockDocumentTable).columns({
        id: col('id'),
        activeItems: subqueryCount(stockDocumentItemTable, { id: 'documentId' }, {
          where: "stock_document_item.status = 'active'",
        }),
      })
      const ddl = v.toSQL()
      expect(ddl).toContain("AND (stock_document_item.status = 'active')")
    })

    it('infers itemCount as number', () => {
      const v = view('sdv2').from(stockDocumentTable).columns({
        id: col('id'),
        itemCount: subqueryCount(stockDocumentItemTable, { id: 'documentId' }),
      })
      type Row = InferViewRow<typeof v>
      const assertIsNumber: Row['itemCount'] extends number ? true : false = true
      expect(assertIsNumber).toBe(true)
    })
  })

  describe('integration', () => {
    let testDb: TestDatabase

    beforeAll(async () => {
      testDb = await createTestDatabase({
        connectionString,
        schema: [stockDocumentTable, stockDocumentItemTable],
        seed: [
          "INSERT INTO stock_document (id, document_number) VALUES (1, 'DOC-1')",
          "INSERT INTO stock_document (id, document_number) VALUES (2, 'DOC-2')",
          "INSERT INTO stock_document_item (id, document_id, status) VALUES (10, 1, 'active')",
          "INSERT INTO stock_document_item (id, document_id, status) VALUES (11, 1, 'active')",
          "INSERT INTO stock_document_item (id, document_id, status) VALUES (12, 1, 'draft')",
          "INSERT INTO stock_document_item (id, document_id, status) VALUES (13, 2, 'active')",
          `CREATE OR REPLACE VIEW stock_document_list_view AS
           SELECT stock_document.id, stock_document.document_number,
             (SELECT COUNT(*) FROM stock_document_item WHERE stock_document_item.document_id = stock_document.id)::integer AS item_count
           FROM stock_document`,
        ],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    it('returns child counts as numbers', async () => {
      const v = view('stock_document_list_view').from(stockDocumentTable).columns({
        id: col('id'),
        documentNumber: col('documentNumber'),
        itemCount: subqueryCount(stockDocumentItemTable, { id: 'documentId' }),
      })

      const rows = await testDb.db.from(v).orderBy('id', 'asc').execute()
      expect(rows).toHaveLength(2)
      expect(rows[0]!.itemCount).toBe(3)
      expect(rows[1]!.itemCount).toBe(1)
      expect(typeof rows[0]!.itemCount).toBe('number')
    })
  })
})
