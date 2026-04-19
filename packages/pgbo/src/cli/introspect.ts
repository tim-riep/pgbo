// CLI: pgbo introspect

import { createDatabase } from '../query/client.js'
import { introspect } from '../migration/introspect.js'

export async function runIntrospect(connectionString: string): Promise<void> {
  const db = createDatabase({ connectionString })

  try {
    const snapshot = await introspect(db)
    console.log(JSON.stringify(snapshot, null, 2))
  } finally {
    await db.close()
  }
}
