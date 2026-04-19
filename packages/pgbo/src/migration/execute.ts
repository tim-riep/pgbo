// Migration execution — Phase 4 (Step 13)

import type { Queryable } from '../query/types.js'
import type { Database } from '../query/client.js'
import type { MigrationPlan } from './diff.js'

export async function migrate(db: Database, plan: MigrationPlan): Promise<void> {
  if (plan.operations.length === 0) return

  // Ensure migrations table exists (outside the transaction — idempotent)
  await db.query(`
    CREATE TABLE IF NOT EXISTS _pgbo_migrations (
      id serial PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      operations_count integer NOT NULL,
      operations jsonb NOT NULL
    )
  `)

  // Execute all operations in a transaction
  await db.transaction(async (tx: Queryable) => {
    for (const op of plan.operations) {
      await tx.query(op.sql)
    }
  })

  // Record the migration (after successful commit)
  await db.query(
    `INSERT INTO _pgbo_migrations (operations_count, operations) VALUES ($1, $2)`,
    [
      plan.operations.length,
      JSON.stringify(plan.operations.map(op => ({ type: op.type, sql: op.sql }))),
    ],
  )
}
