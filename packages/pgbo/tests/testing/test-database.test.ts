import { describe, it, expect, afterEach } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'
import { assertMigration } from '../../src/testing/migration.js'
import { assertSchema } from '../../src/testing/schema.js'
import { fixture } from '../../src/testing/fixture.js'
import { table } from '../../src/schema/table.js'
import { text, integer, timestamp } from '../../src/schema/types.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

const users = table('users', {
  columns: {
    id: integer().notNull(),
    name: text().notNull(),
    email: text().notNull().unique(),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['id'],
})

describe('Test database utilities', () => {
  let testDb: TestDatabase | undefined

  afterEach(async () => {
    if (testDb) {
      await testDb.dispose()
      testDb = undefined
    }
  })

  it('createTestDatabase() creates a new PG database', async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [users],
    })
    expect(testDb.name).toMatch(/^pgbo_test_/)
    expect(testDb.db).toBeDefined()
  })

  it('migrates schema into test database', async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [users],
    })
    await assertMigration(testDb, { tables: ['users'] })
  })

  it('applies seed data', async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [users],
      seed: ["INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@test.com')"],
    })
    const rows = await testDb.raw<{ name: string }>('SELECT name FROM users')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('Alice')
  })

  it('testDb.reset() truncates all tables and re-seeds', async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [users],
      seed: ["INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@test.com')"],
    })
    // Insert extra data
    await testDb.raw("INSERT INTO users (id, name, email) VALUES (2, 'Bob', 'bob@test.com')")
    let rows = await testDb.raw<{ id: number }>('SELECT id FROM users')
    expect(rows).toHaveLength(2)

    // Reset should truncate and re-seed
    await testDb.reset()
    rows = await testDb.raw<{ id: number }>('SELECT id FROM users')
    expect(rows).toHaveLength(1)
  })

  it('testDb.dispose() drops the database', async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [users],
    })
    const dbName = testDb.name
    await testDb.dispose()
    testDb = undefined

    // Verify the database no longer exists
    const { createDatabase } = await import('../../src/query/client.js')
    const adminDb = createDatabase({ connectionString })
    const rows = await adminDb.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname = $1',
      [dbName],
    )
    await adminDb.close()
    expect(rows).toHaveLength(0)
  })

  it('testDb.raw() executes arbitrary SQL', async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [users],
    })
    const rows = await testDb.raw<{ result: number }>('SELECT 42 AS result')
    expect(rows[0]!.result).toBe(42)
  })

  it('fixture() inserts typed test data', async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [users],
    })
    const userFixture = fixture(users, [
      { id: 1, name: 'Alice', email: 'alice@test.com' },
      { id: 2, name: 'Bob', email: 'bob@test.com' },
    ])
    await userFixture.insert(testDb.db)

    const rows = await testDb.raw<{ name: string }>('SELECT name FROM users ORDER BY id')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.name).toBe('Alice')
    expect(rows[1]!.name).toBe('Bob')

    await userFixture.cleanup(testDb.db)
    const after = await testDb.raw('SELECT * FROM users')
    expect(after).toHaveLength(0)
  })

  it('assertMigration() verifies expected tables exist', async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [users],
    })
    await assertMigration(testDb, { tables: ['users'] })
    await expect(
      assertMigration(testDb, { tables: ['nonexistent'] }),
    ).rejects.toThrow('not found')
  })

  it('assertSchema() verifies table structure', async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [users],
    })
    await assertSchema(testDb, 'users', {
      columns: { id: 'integer', name: 'text', email: 'text' },
      primaryKey: ['id'],
    })
  })
})
