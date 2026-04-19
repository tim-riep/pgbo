// Migrate the trtest database using pgbo schema definitions

import { createDatabase } from '../packages/pgbo/src/query/client.js'
import { introspect } from '../packages/pgbo/src/migration/introspect.js'
import { diff } from '../packages/pgbo/src/migration/diff.js'
import { migrate } from '../packages/pgbo/src/migration/execute.js'
import { schema } from './schema.js'

const DB_URL = 'postgresql://timriep@localhost:5432/trtest'

async function main() {
  const db = createDatabase({ connectionString: DB_URL })

  try {
    console.log('Introspecting trtest...')
    const snapshot = await introspect(db)
    console.log(`  Found: ${snapshot.tables.length} tables, ${snapshot.views.length} views, ${snapshot.enums.length} enums`)

    console.log('\nComputing diff...')
    const plan = diff(schema, snapshot)

    if (plan.operations.length === 0) {
      console.log('No changes needed — database is up to date.')
      return
    }

    console.log(`\n${plan.operations.length} operation(s) to apply:`)
    for (const op of plan.operations) {
      console.log(`  [${op.type}] ${op.sql.slice(0, 100)}${op.sql.length > 100 ? '...' : ''}`)
    }

    console.log('\nApplying migration...')
    await migrate(db, plan)
    console.log('Done!')
  } finally {
    await db.close()
  }
}

main().catch(console.error)
