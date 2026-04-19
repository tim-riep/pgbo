import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import { createDatabase } from '../../src/query/client.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const usersTable = table('users', {
  columns: {
    id: integer().notNull(),
    userName: text().notNull(),
    email: text().notNull(),
  },
  primaryKey: ['id'],
})

const users = view('users_view').from(usersTable)

describe('DELETE query builder', () => {
  describe('SQL generation', () => {
    it('db.deleteFrom(view).where(cond).toQuery() generates DELETE', () => {
      const db = createDatabase({ connectionString })
      const q = db.deleteFrom(users).where({ id: 1 }).toQuery()
      expect(q.text).toBe('DELETE FROM users_view WHERE id = $1')
      expect(q.values).toEqual([1])
      db.close()
    })

    it('without .where() throws (safety guard)', () => {
      const db = createDatabase({ connectionString })
      expect(() => db.deleteFrom(users).toQuery()).toThrow()
      db.close()
    })

    it('.all() allows delete without WHERE', () => {
      const db = createDatabase({ connectionString })
      const q = db.deleteFrom(users).all().toQuery()
      expect(q.text).toBe('DELETE FROM users_view')
      db.close()
    })
  })

  describe('integration', () => {
    let testDb: TestDatabase

    beforeAll(async () => {
      testDb = await createTestDatabase({
        connectionString,
        schema: [usersTable],
        seed: [
          'CREATE VIEW users_view AS SELECT * FROM users',
          "INSERT INTO users (id, user_name, email) VALUES (1, 'Alice', 'alice@test.com')",
          "INSERT INTO users (id, user_name, email) VALUES (2, 'Bob', 'bob@test.com')",
        ],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    it('.returning("*") returns deleted rows', async () => {
      const rows = await testDb.db.deleteFrom(users)
        .where({ id: 1 })
        .returning('*')
        .execute()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toHaveProperty('userName', 'Alice')
    })
  })
})
