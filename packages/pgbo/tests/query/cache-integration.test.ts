import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { text, integer } from '../../src/schema/types.js'
import { memoryCache } from '../../src/query/cache.js'
import { defineBO } from '../../src/bo/index.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import { createDatabase } from '../../src/query/client.js'

const connectionString = process.env.PGBO_TEST_URL ?? 'postgresql://localhost:5432/postgres'

const warehouseTable = table('warehouse', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['id'],
})

const warehouseView = view('warehouse_view').from(warehouseTable)

describe('Cache integration (issue #8)', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [warehouseTable],
      seed: [
        'CREATE OR REPLACE VIEW warehouse_view AS SELECT * FROM warehouse',
        "INSERT INTO warehouse (id, slug, name) VALUES (1, 'main', 'Main')",
        "INSERT INTO warehouse (id, slug, name) VALUES (2, 'returns', 'Returns')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('Database exposes the registered cache', async () => {
    const cache = memoryCache()
    const db = createDatabase({ connectionString: testDb.connectionString, cache })
    expect(db.cache).toBe(cache)
    await db.close()
  })

  it('Database.cache is undefined when no cache configured', async () => {
    expect(testDb.db.cache).toBeUndefined()
  })

  describe('read-through .cached()', () => {
    it('first call executes SQL, second returns cached without SQL', async () => {
      const cache = memoryCache()
      const db = createDatabase({ connectionString: testDb.connectionString, cache })

      // Track SQL calls by monkey-patching the query function
      let sqlCount = 0
      const origQuery = db.query.bind(db) as typeof db.query
      db.query = ((...args: Parameters<typeof origQuery>) => {
        sqlCount++
        return origQuery(...args)
      }) as typeof db.query

      const first = await db.from(warehouseView).where({ id: 1 }).cached({ tags: ['wh'] }).execute()
      expect(first).toHaveLength(1)
      expect(sqlCount).toBe(1)

      const second = await db.from(warehouseView).where({ id: 1 }).cached({ tags: ['wh'] }).execute()
      expect(second).toHaveLength(1)
      expect(sqlCount).toBe(1)  // no additional SQL

      await db.close()
    })

    it('different WHERE clauses get different cache keys', async () => {
      const cache = memoryCache()
      const db = createDatabase({ connectionString: testDb.connectionString, cache })

      const a = await db.from(warehouseView).where({ id: 1 }).cached({ tags: ['wh'] }).execute()
      const b = await db.from(warehouseView).where({ id: 2 }).cached({ tags: ['wh'] }).execute()

      expect(a[0]?.slug).toBe('main')
      expect(b[0]?.slug).toBe('returns')
      await db.close()
    })

    it('explicit key overrides auto-derivation', async () => {
      const cache = memoryCache()
      const db = createDatabase({ connectionString: testDb.connectionString, cache })

      await db.from(warehouseView).where({ id: 1 }).cached({ tags: ['wh'], key: 'custom-key' }).execute()
      const direct = (await cache.get('custom-key')) as unknown[] | undefined
      expect(direct).toBeDefined()
      expect(direct).toHaveLength(1)

      await db.close()
    })

    it('TTL expires the entry', async () => {
      const cache = memoryCache()
      const db = createDatabase({ connectionString: testDb.connectionString, cache })

      let sqlCount = 0
      const origQuery = db.query.bind(db) as typeof db.query
      db.query = ((...args: Parameters<typeof origQuery>) => {
        sqlCount++
        return origQuery(...args)
      }) as typeof db.query

      await db.from(warehouseView).where({ id: 1 }).cached({ tags: ['wh'], ttl: 0.05 }).execute()
      expect(sqlCount).toBe(1)

      await new Promise(r => setTimeout(r, 80))
      await db.from(warehouseView).where({ id: 1 }).cached({ tags: ['wh'], ttl: 0.05 }).execute()
      expect(sqlCount).toBe(2)  // expired, re-executed

      await db.close()
    })

    it('no cache configured → .cached() is a no-op (always hits DB)', async () => {
      // testDb has no cache — .cached() should not error and just run SQL
      const rows = await testDb.db.from(warehouseView).cached({ tags: ['wh'] }).execute()
      expect(rows.length).toBeGreaterThan(0)
    })
  })

  describe('BO auto-invalidation on writes', () => {
    it('create invalidates by cacheTags', async () => {
      const cache = memoryCache()
      const db = createDatabase({ connectionString: testDb.connectionString, cache })

      // Seed the cache with a sentinel
      await cache.set('sentinel', 'before', ['warehouses'])

      const bo = defineBO(warehouseTable, {
        paramField: 'id',
        cacheTags: ['warehouses'],
        actions: { create: {}, update: {}, delete: {} },
      })

      await bo.create(db, {}, { id: 100, slug: 'new-wh', name: 'New' })

      expect(await cache.get('sentinel')).toBeUndefined()

      // Cleanup
      await db.query('DELETE FROM warehouse WHERE id = 100')
      await db.close()
    })

    it('update invalidates by cacheTags', async () => {
      const cache = memoryCache()
      const db = createDatabase({ connectionString: testDb.connectionString, cache })
      await cache.set('s', 'x', ['warehouses'])

      const bo = defineBO(warehouseTable, {
        paramField: 'id',
        cacheTags: ['warehouses'],
        actions: { create: {}, update: {}, delete: {} },
      })

      await bo.update(db, {}, { id: 1, name: 'Renamed' })
      expect(await cache.get('s')).toBeUndefined()

      // Reset state
      await db.query("UPDATE warehouse SET name = 'Main' WHERE id = 1")
      await db.close()
    })

    it('delete invalidates by cacheTags', async () => {
      const cache = memoryCache()
      const db = createDatabase({ connectionString: testDb.connectionString, cache })
      await cache.set('s', 'x', ['warehouses'])

      await db.query("INSERT INTO warehouse (id, slug, name) VALUES (200, 'tmp', 'Tmp')")

      const bo = defineBO(warehouseTable, {
        paramField: 'id',
        cacheTags: ['warehouses'],
        actions: { create: {}, update: {}, delete: {} },
      })

      await bo.delete(db, {}, { id: 200 })
      expect(await cache.get('s')).toBeUndefined()
      await db.close()
    })

    it('BOs without cacheTags do NOT invalidate anything', async () => {
      const cache = memoryCache()
      const db = createDatabase({ connectionString: testDb.connectionString, cache })
      await cache.set('s', 'x', ['warehouses'])

      const bo = defineBO(warehouseTable, {
        paramField: 'id',
        actions: { update: {} },
      })

      await bo.update(db, {}, { id: 1, name: 'X' })
      expect(await cache.get('s')).toBe('x')

      // Reset
      await db.query("UPDATE warehouse SET name = 'Main' WHERE id = 1")
      await db.close()
    })

    it('custom actions do NOT auto-invalidate (they must call db.cache themselves)', async () => {
      const cache = memoryCache()
      const db = createDatabase({ connectionString: testDb.connectionString, cache })
      await cache.set('s', 'x', ['warehouses'])

      const bo = defineBO(warehouseTable, {
        paramField: 'id',
        cacheTags: ['warehouses'],
        actions: {
          ping: { handler: () => 'pong' },
        },
      })

      await bo.execute(db, 'ping', {}, {})
      expect(await cache.get('s')).toBe('x')  // unchanged
      await db.close()
    })
  })

  it('end-to-end: cached read invalidated by BO write', async () => {
    const cache = memoryCache()
    const db = createDatabase({ connectionString: testDb.connectionString, cache })

    const bo = defineBO(warehouseTable, {
      paramField: 'id',
      cacheTags: ['warehouses'],
      actions: { update: {} },
    })

    // Cache the current name
    const [row1] = await db.from(warehouseView).where({ id: 1 }).cached({ tags: ['warehouses'] }).execute()
    expect(row1?.name).toBe('Main')

    // Mutate via raw SQL — cache is still stale
    await db.query("UPDATE warehouse SET name = 'Sneaky' WHERE id = 1")
    const [row2] = await db.from(warehouseView).where({ id: 1 }).cached({ tags: ['warehouses'] }).execute()
    expect(row2?.name).toBe('Main')  // cache hit, stale

    // Now go through the BO — invalidates 'warehouses' tag
    await bo.update(db, {}, { id: 1, name: 'Updated' })
    const [row3] = await db.from(warehouseView).where({ id: 1 }).cached({ tags: ['warehouses'] }).execute()
    expect(row3?.name).toBe('Updated')  // cache miss, fresh read

    // Reset
    await db.query("UPDATE warehouse SET name = 'Main' WHERE id = 1")
    await db.close()
  })
})
