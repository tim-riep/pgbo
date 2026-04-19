import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer, timestamp } from '../../src/schema/types.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import { createDatabase } from '../../src/query/client.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const usersTable = table('users', {
  columns: {
    id: integer().notNull(),
    userName: text().notNull(),
    email: text().notNull(),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['id'],
})

const users = view('users_view').from(usersTable)

describe('INSERT query builder', () => {
  describe('SQL generation', () => {
    it('db.into(view).values(data).toQuery() generates INSERT', () => {
      const db = createDatabase({ connectionString })
      const q = db.into(users).values({ id: 1, userName: 'Alice', email: 'a@b.com' }).toQuery()
      expect(q.text).toBe('INSERT INTO users_view (id, user_name, email) VALUES ($1, $2, $3)')
      expect(q.values).toEqual([1, 'Alice', 'a@b.com'])
      db.close()
    })

    it('batch insert with array of values', () => {
      const db = createDatabase({ connectionString })
      const q = db.into(users).values([
        { id: 1, userName: 'Alice', email: 'a@b.com' },
        { id: 2, userName: 'Bob', email: 'b@b.com' },
      ]).toQuery()
      expect(q.text).toBe('INSERT INTO users_view (id, user_name, email) VALUES ($1, $2, $3), ($4, $5, $6)')
      expect(q.values).toEqual([1, 'Alice', 'a@b.com', 2, 'Bob', 'b@b.com'])
      db.close()
    })

    it('camelCase data keys become snake_case in SQL', () => {
      const db = createDatabase({ connectionString })
      const q = db.into(users).values({ id: 1, userName: 'X', email: 'x@y.com' }).toQuery()
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
        seed: ['CREATE OR REPLACE VIEW users_view AS SELECT * FROM users'],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    beforeEach(async () => {
      await testDb.reset()
    })

    it('.returning("*") returns the inserted row', async () => {
      const rows = await testDb.db.into(users)
        .values({ id: 1, userName: 'Alice', email: 'a@b.com' })
        .returning('*')
        .execute()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toHaveProperty('userName', 'Alice')
      expect(rows[0]).toHaveProperty('id', 1)
    })

    it('returns typed result matching InferRow<view>', async () => {
      const rows = await testDb.db.into(users)
        .values({ id: 5, userName: 'Eve', email: 'eve@test.com' })
        .returning('*')
        .execute()
      expect(rows[0]!.userName).toBe('Eve')
      expect(rows[0]!.id).toBe(5)
      expect(rows[0]!.createdAt).toBeInstanceOf(Date)
    })
  })
})
