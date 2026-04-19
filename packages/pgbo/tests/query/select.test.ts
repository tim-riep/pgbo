import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
    age: integer(),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['id'],
})

const users = view('users_view').from(usersTable)

describe('SELECT query builder', () => {
  describe('SQL generation', () => {
    it('db.from(view).execute() selects all columns', () => {
      const db = createDatabase({ connectionString })
      const q = db.from(users).toQuery()
      expect(q.text).toBe('SELECT * FROM users_view')
      expect(q.values).toEqual([])
      db.close()
    })

    it('.where() adds WHERE clause', () => {
      const db = createDatabase({ connectionString })
      const q = db.from(users).where({ userName: 'Alice' }).toQuery()
      expect(q.text).toBe('SELECT * FROM users_view WHERE user_name = $1')
      expect(q.values).toEqual(['Alice'])
      db.close()
    })

    it('.where() with operators: eq, like, in, gt, lt, between, isNull, isNotNull', () => {
      const db = createDatabase({ connectionString })

      const eq = db.from(users).where({ id: { eq: 5 } }).toQuery()
      expect(eq.text).toContain('id = $1')
      expect(eq.values).toEqual([5])

      const like = db.from(users).where({ userName: { like: '%ali%' } }).toQuery()
      expect(like.text).toContain('user_name LIKE $1')

      const inOp = db.from(users).where({ id: { in: [1, 2, 3] } }).toQuery()
      expect(inOp.text).toContain('id IN ($1, $2, $3)')
      expect(inOp.values).toEqual([1, 2, 3])

      const gt = db.from(users).where({ age: { gt: 18 } }).toQuery()
      expect(gt.text).toContain('age > $1')

      const lt = db.from(users).where({ age: { lt: 65 } }).toQuery()
      expect(lt.text).toContain('age < $1')

      const between = db.from(users).where({ age: { between: [18, 65] } }).toQuery()
      expect(between.text).toContain('age BETWEEN $1 AND $2')
      expect(between.values).toEqual([18, 65])

      const isNull = db.from(users).where({ age: { isNull: true } }).toQuery()
      expect(isNull.text).toContain('age IS NULL')
      expect(isNull.values).toEqual([])

      const isNotNull = db.from(users).where({ age: { isNotNull: true } }).toQuery()
      expect(isNotNull.text).toContain('age IS NOT NULL')
      expect(isNotNull.values).toEqual([])

      db.close()
    })

    it('.orderBy() adds ORDER BY', () => {
      const db = createDatabase({ connectionString })
      const q = db.from(users).orderBy('userName', 'asc').toQuery()
      expect(q.text).toBe('SELECT * FROM users_view ORDER BY user_name ASC')
      db.close()
    })

    it('.limit() / .offset() adds LIMIT/OFFSET', () => {
      const db = createDatabase({ connectionString })
      const q = db.from(users).limit(25).offset(50).toQuery()
      expect(q.text).toBe('SELECT * FROM users_view LIMIT 25 OFFSET 50')
      db.close()
    })

    it('camelCase where keys become snake_case in SQL', () => {
      const db = createDatabase({ connectionString })
      const q = db.from(users).where({ userName: 'Alice', createdAt: { isNotNull: true } }).toQuery()
      expect(q.text).toContain('user_name = $1')
      expect(q.text).toContain('created_at IS NOT NULL')
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
          "CREATE VIEW users_view AS SELECT * FROM users",
          "INSERT INTO users (id, user_name, email, age) VALUES (1, 'Alice', 'alice@test.com', 30)",
          "INSERT INTO users (id, user_name, email, age) VALUES (2, 'Bob', 'bob@test.com', 25)",
          "INSERT INTO users (id, user_name, email, age) VALUES (3, 'Charlie', 'charlie@test.com', NULL)",
        ],
      })
    })

    afterAll(async () => {
      await testDb.dispose()
    })

    it('snake_case result columns become camelCase in returned objects', async () => {
      const rows = await testDb.db.from(users).where({ id: 1 }).execute()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toHaveProperty('userName', 'Alice')
      expect(rows[0]).toHaveProperty('email', 'alice@test.com')
      expect(rows[0]).not.toHaveProperty('user_name')
    })

    it('.count() returns number', async () => {
      const total = await testDb.db.from(users).count()
      expect(total).toBe(3)

      const filtered = await testDb.db.from(users).where({ age: { gt: 26 } }).count()
      expect(filtered).toBe(1)
    })

    it('returns typed result matching InferRow<view>', async () => {
      const rows = await testDb.db.from(users).where({ id: 2 }).execute()
      expect(rows).toHaveLength(1)
      expect(rows[0]!.userName).toBe('Bob')
      expect(rows[0]!.age).toBe(25)
    })
  })
})
