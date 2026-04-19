import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const docTable = table('doc', {
  columns: {
    id: integer().notNull(),
    postedAt: text().notNull(),
    documentNumber: text().notNull(),
  },
  primaryKey: ['id'],
})
const docView = view('doc_view').from(docTable)

describe('SelectBuilder.orderBy — multi-column (issue 016)', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [docTable],
      seed: [
        'CREATE OR REPLACE VIEW doc_view AS SELECT * FROM doc',
        "INSERT INTO doc (id, posted_at, document_number) VALUES (1, '2024-01-01', 'B')",
        "INSERT INTO doc (id, posted_at, document_number) VALUES (2, '2024-01-01', 'A')",
        "INSERT INTO doc (id, posted_at, document_number) VALUES (3, '2024-01-02', 'A')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('chained orderBy appends secondary sort', async () => {
    const { text } = testDb.db.from(docView)
      .orderBy('postedAt', 'desc')
      .orderBy('documentNumber', 'asc')
      .toQuery()
    expect(text).toContain('ORDER BY posted_at DESC, document_number ASC')

    const rows = await testDb.db.from(docView)
      .orderBy('postedAt', 'desc')
      .orderBy('documentNumber', 'asc')
      .execute()
    expect(rows.map(r => r.id)).toEqual([3, 2, 1])
  })

  it('array form', async () => {
    const rows = await testDb.db.from(docView)
      .orderBy([
        { column: 'postedAt', direction: 'asc' },
        { column: 'documentNumber', direction: 'desc' },
      ])
      .execute()
    expect(rows.map(r => r.id)).toEqual([1, 2, 3])
  })

  it('single-column form unchanged', async () => {
    const rows = await testDb.db.from(docView).orderBy('id', 'desc').execute()
    expect(rows.map(r => r.id)).toEqual([3, 2, 1])
  })
})
