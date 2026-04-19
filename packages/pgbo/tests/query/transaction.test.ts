import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

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

describe('Transactions', () => {
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

  it('db.transaction(fn) wraps in BEGIN/COMMIT', async () => {
    await testDb.db.transaction(async (tx) => {
      await tx.into(users).values({ id: 1, userName: 'Alice', email: 'a@b.com' }).execute()
    })
    const rows = await testDb.db.from(users).execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.userName).toBe('Alice')
  })

  it('rolls back on throw', async () => {
    await expect(
      testDb.db.transaction(async (tx) => {
        await tx.into(users).values({ id: 1, userName: 'Alice', email: 'a@b.com' }).execute()
        throw new Error('Oops')
      }),
    ).rejects.toThrow('Oops')

    const rows = await testDb.db.from(users).execute()
    expect(rows).toHaveLength(0)
  })

  it('tx has same API as db (from, into, update, deleteFrom)', async () => {
    await testDb.db.transaction(async (tx) => {
      await tx.into(users).values({ id: 1, userName: 'Alice', email: 'a@b.com' }).execute()
      await tx.update(users).set({ userName: 'Alicia' }).where({ id: 1 }).execute()
      const rows = await tx.from(users).where({ id: 1 }).execute()
      expect(rows[0]!.userName).toBe('Alicia')
      await tx.deleteFrom(users).where({ id: 1 }).execute()
      const after = await tx.from(users).execute()
      expect(after).toHaveLength(0)
    })
  })

  it('tx runs on a single connection', async () => {
    await testDb.db.transaction(async (tx) => {
      const [r1] = await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      const [r2] = await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      expect(r1!.pid).toBe(r2!.pid)
    })
  })

  it('savepoint: tx.savepoint(name, fn)', async () => {
    await testDb.db.transaction(async (tx) => {
      await tx.into(users).values({ id: 1, userName: 'Alice', email: 'a@b.com' }).execute()

      await expect(
        tx.savepoint('sp1', async (sp) => {
          await sp.into(users).values({ id: 2, userName: 'Bob', email: 'b@b.com' }).execute()
          throw new Error('savepoint fail')
        }),
      ).rejects.toThrow('savepoint fail')

      const rows = await tx.from(users).execute()
      expect(rows).toHaveLength(1)
      expect(rows[0]!.userName).toBe('Alice')
    })
  })

  it('savepoint rollback does not affect outer transaction', async () => {
    await testDb.db.transaction(async (tx) => {
      await tx.into(users).values({ id: 1, userName: 'Alice', email: 'a@b.com' }).execute()

      try {
        await tx.savepoint('sp1', async (sp) => {
          await sp.into(users).values({ id: 2, userName: 'Bob', email: 'b@b.com' }).execute()
          throw new Error('fail')
        })
      } catch {
        // ignore
      }

      await tx.into(users).values({ id: 3, userName: 'Charlie', email: 'c@b.com' }).execute()
    })

    const rows = await testDb.db.from(users).execute()
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.userName).sort()).toEqual(['Alice', 'Charlie'])
  })

  it('nested transaction returns value from callback', async () => {
    const result = await testDb.db.transaction(async (tx) => {
      await tx.into(users).values({ id: 1, userName: 'Alice', email: 'a@b.com' }).execute()
      return 42
    })
    expect(result).toBe(42)
  })
})
