// CLI: pgbo migrate

import { createDatabase } from '../query/client.js'
import { introspect } from '../migration/introspect.js'
import { diff, type SchemaDefinitions } from '../migration/diff.js'
import { migrate } from '../migration/execute.js'

export async function runMigrate(connectionString: string, schemaPath: string): Promise<void> {
  const schema = await loadSchema(schemaPath)
  const db = createDatabase({ connectionString })

  try {
    console.log('Introspecting current database...')
    const snapshot = await introspect(db)

    console.log('Computing diff...')
    const plan = diff(schema, snapshot)

    if (plan.operations.length === 0) {
      console.log('No changes detected. Database is up to date.')
      return
    }

    console.log(`Applying ${plan.operations.length} operation(s):`)
    for (const op of plan.operations) {
      console.log(`  [${op.type}] ${op.sql.slice(0, 80)}${op.sql.length > 80 ? '...' : ''}`)
    }

    await migrate(db, plan)
    console.log('Migration complete.')
  } finally {
    await db.close()
  }
}

async function loadSchema(schemaPath: string): Promise<SchemaDefinitions> {
  const mod = (await import(schemaPath)) as { default?: SchemaDefinitions; schema?: SchemaDefinitions }
  if (mod.default) return mod.default
  if (mod.schema) return mod.schema
  throw new Error(
    `Schema file must export a default or named "schema" export of type SchemaDefinitions: { domains, enums, tables, views }`,
  )
}
