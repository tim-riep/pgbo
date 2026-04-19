// CLI: pgbo status

import { createDatabase } from '../query/client.js'
import { introspect } from '../migration/introspect.js'

export async function runStatus(connectionString: string): Promise<void> {
  const db = createDatabase({ connectionString })

  try {
    const snapshot = await introspect(db)

    console.log('Database schema:')
    console.log(`  Domains:  ${snapshot.domains.length}`)
    console.log(`  Enums:    ${snapshot.enums.length}`)
    console.log(`  Tables:   ${snapshot.tables.length}`)
    console.log(`  Views:    ${snapshot.views.length}`)

    if (snapshot.tables.length > 0) {
      console.log('\nTables:')
      for (const t of snapshot.tables) {
        const colCount = t.columns.length
        const fkCount = t.foreignKeys.length
        const idxCount = t.indexes.length
        console.log(`  ${t.name} (${colCount} cols, ${fkCount} FKs, ${idxCount} indexes)`)
      }
    }

    // Check migration history
    try {
      const migrations = await db.query<{ id: number; applied_at: Date; operations_count: number; [key: string]: unknown }>(
        'SELECT id, applied_at, operations_count FROM _pgbo_migrations ORDER BY id DESC LIMIT 5',
      )
      if (migrations.length > 0) {
        console.log('\nRecent migrations:')
        for (const m of migrations) {
          console.log(`  #${m.id} — ${m.applied_at.toISOString()} (${m.operations_count} ops)`)
        }
      }
    } catch {
      // _pgbo_migrations table doesn't exist yet
    }
  } finally {
    await db.close()
  }
}
