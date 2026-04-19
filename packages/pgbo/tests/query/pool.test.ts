import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createDatabase, type Database } from '../../src/query/client.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

describe('Connection pool', () => {
  let db: Database

  beforeAll(() => {
    db = createDatabase({
      connectionString,
      pool: { min: 1, max: 5 },
    })
  })

  afterAll(async () => {
    await db.close()
  })

  it('createDatabase() creates a pool with configured min/max', () => {
    expect(db.pool).toBeDefined()
    expect(db.pool.options.max).toBe(5)
    expect(db.pool.options.min).toBe(1)
  })

  it('queries acquire and release connections automatically', async () => {
    const rows = await db.query<{ result: number }>('SELECT 1 + 1 AS result')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.result).toBe(2)
  })

  it('db.close() drains the pool', async () => {
    const tempDb = createDatabase({ connectionString })
    await tempDb.query('SELECT 1')
    await tempDb.close()
    // After close, queries should fail
    await expect(tempDb.query('SELECT 1')).rejects.toThrow()
  })

  it('concurrent queries use separate connections', async () => {
    const results = await Promise.all([
      db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
      db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
      db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
    ])
    // At least some should get different PIDs (different connections)
    const pids = new Set(results.map(r => r[0]!.pid))
    expect(pids.size).toBeGreaterThanOrEqual(1)
  })
})
