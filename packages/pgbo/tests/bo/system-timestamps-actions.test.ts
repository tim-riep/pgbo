import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { text } from '../../src/schema/types.js'
import { systemTimestamps } from '../../src/schema/system-timestamps.js'
import { defineBO } from '../../src/bo/index.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const apps = table('app', {
  columns: {
    slug: text().notNull(),
    name: text().notNull(),
    ...systemTimestamps(),
  },
  primaryKey: ['slug'],
})

describe('BO writes with system-managed timestamps (issue #61)', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({ connectionString, schema: [apps] })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('create: ignores client-supplied createdAt/updatedAt; defaults set them to now()', async () => {
    const bo = defineBO(apps, { paramField: 'slug', actions: { create: {} } })
    const ctx = {}

    // Client tries to inject ancient timestamps — they must be ignored.
    const ancient = new Date('2000-01-01T00:00:00Z')
    const created = await bo.create(testDb.db, ctx, {
      slug: 'a',
      name: 'A',
      // @ts-expect-error — client shouldn't be allowed to send these, but the
      // BO must defend itself even if some caller bypasses the type system.
      createdAt: ancient,
      updatedAt: ancient,
    } as never) as { createdAt: Date; updatedAt: Date }

    expect(created.createdAt).toBeInstanceOf(Date)
    expect(created.updatedAt).toBeInstanceOf(Date)
    // Both timestamps are recent, NOT the injected ancient value
    expect(created.createdAt.getTime()).toBeGreaterThan(ancient.getTime() + 1000 * 60 * 60 * 24 * 365 * 5)
    expect(created.updatedAt.getTime()).toBeGreaterThan(ancient.getTime() + 1000 * 60 * 60 * 24 * 365 * 5)
  })

  it('update: auto-stamps updatedAt; createdAt stays put even when client tries to change it', async () => {
    const bo = defineBO(apps, {
      paramField: 'slug',
      actions: { create: {}, update: {} },
    })
    const ctx = {}

    const initial = await bo.create(testDb.db, ctx, { slug: 'b', name: 'B' }) as { createdAt: Date; updatedAt: Date }
    const initialCreated = initial.createdAt
    const initialUpdated = initial.updatedAt

    // Wait long enough that now() advances measurably (Postgres gives us ms precision).
    await new Promise(r => setTimeout(r, 50))

    const updated = await bo.update(testDb.db, ctx, {
      slug: 'b',
      name: 'B renamed',
      // Try to reset the timestamps — must be ignored.
      // @ts-expect-error — same as above, client shouldn't be able to send these.
      createdAt: new Date('2000-01-01T00:00:00Z'),
      updatedAt: new Date('2000-01-01T00:00:00Z'),
    } as never) as { name: string; createdAt: Date; updatedAt: Date }

    expect(updated.name).toBe('B renamed')
    // createdAt is preserved (within a few ms due to Postgres rounding)
    expect(Math.abs(updated.createdAt.getTime() - initialCreated.getTime())).toBeLessThan(10)
    // updatedAt actually advanced
    expect(updated.updatedAt.getTime()).toBeGreaterThan(initialUpdated.getTime())
  })

  it('update without any other fields still bumps updatedAt', async () => {
    const bo = defineBO(apps, {
      paramField: 'slug',
      actions: { create: {}, update: {} },
    })
    const ctx = {}

    const initial = await bo.create(testDb.db, ctx, { slug: 'c', name: 'C' }) as { updatedAt: Date }
    await new Promise(r => setTimeout(r, 50))

    // Empty update payload (just the param key) — auto-stamp must still fire.
    const updated = await bo.update(testDb.db, ctx, { slug: 'c' } as never) as { updatedAt: Date }
    expect(updated.updatedAt.getTime()).toBeGreaterThan(initial.updatedAt.getTime())
  })
})
