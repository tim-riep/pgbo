// Migration assertions — verify migration produces expected schema

import type { TestDatabase } from './database.js'

type RelInfo = { name: string; [key: string]: unknown }

export async function assertMigration(
  testDb: TestDatabase,
  expected: { tables?: string[]; views?: string[]; domains?: string[]; enums?: string[] },
): Promise<void> {
  if (expected.tables) {
    const rows = await testDb.raw<RelInfo>(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )
    const actual = rows.map(r => r.name)
    for (const t of expected.tables) {
      if (!actual.includes(t)) {
        throw new Error(`Expected table "${t}" not found. Existing: [${actual.join(', ')}]`)
      }
    }
  }

  if (expected.views) {
    const rows = await testDb.raw<RelInfo>(
      `SELECT table_name AS name FROM information_schema.views
       WHERE table_schema = 'public'`,
    )
    const actual = rows.map(r => r.name)
    for (const v of expected.views) {
      if (!actual.includes(v)) {
        throw new Error(`Expected view "${v}" not found. Existing: [${actual.join(', ')}]`)
      }
    }
  }

  if (expected.domains) {
    const rows = await testDb.raw<RelInfo>(
      `SELECT domain_name AS name FROM information_schema.domains
       WHERE domain_schema = 'public'`,
    )
    const actual = rows.map(r => r.name)
    for (const d of expected.domains) {
      if (!actual.includes(d)) {
        throw new Error(`Expected domain "${d}" not found. Existing: [${actual.join(', ')}]`)
      }
    }
  }

  if (expected.enums) {
    const rows = await testDb.raw<RelInfo>(
      `SELECT typname AS name FROM pg_type
       WHERE typtype = 'e' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')`,
    )
    const actual = rows.map(r => r.name)
    for (const e of expected.enums) {
      if (!actual.includes(e)) {
        throw new Error(`Expected enum "${e}" not found. Existing: [${actual.join(', ')}]`)
      }
    }
  }
}
