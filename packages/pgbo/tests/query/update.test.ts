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

describe('UPDATE query builder', () => {
  describe('SQL generation', () => {
    it('db.update(view).set(data).where(cond).toQuery() generates UPDATE', () => {
      const db = createDatabase({ connectionString })
      const q = db.update(users).set({ userName: 'Bob' }).where({ id: 1 }).toQuery()
      expect(q.text).toBe('UPDATE users_view SET user_name = $1 WHERE id = $2')
      expect(q.values).toEqual(['Bob', 1])
      db.close()
    })

    it('only provided columns are SET', () => {
      const db = createDatabase({ connectionString })
      const q = db.update(users).set({ email: 'new@test.com' }).where({ id: 1 }).toQuery()
      expect(q.text).toBe('UPDATE users_view SET email = $1 WHERE id = $2')
      expect(q.text).not.toContain('user_name')
      db.close()
    })

    it('camelCase keys become snake_case in SQL', () => {
      const db = createDatabase({ connectionString })
      const q = db.update(users).set({ userName: 'X' }).where({ id: 1 }).toQuery()
      expect(q.text).toContain('user_name')
      expect(q.text).not.toContain('userName')
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
        ],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    it('.returning("*") returns the updated row', async () => {
      const rows = await testDb.db.update(users)
        .set({ userName: 'Alicia' })
        .where({ id: 1 })
        .returning('*')
        .execute()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toHaveProperty('userName', 'Alicia')
    })
  })
})
