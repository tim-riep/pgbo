// Standard action handlers — Phase 7 (Step 17)

import type { Database } from '../query/client.js'
import type { TableDef } from '../schema/definitions.js'
import type { BusinessObjectDef, ActionContext } from './types.js'
import { paramFieldList, keyToWhere } from './composite-key.js'

function getTable(bo: BusinessObjectDef): TableDef {
  const root = bo.root
  if ('columns' in root && 'primaryKey' in root) return root
  if ('source' in root) return root.source
  throw new Error(`Cannot resolve table from BO root`)
}

/** Walk the root table's columns and split out which are system-managed (issue #61). */
function systemManagedColumns(table: TableDef): { createdAt: string[]; updatedAt: string[] } {
  const result = { createdAt: [] as string[], updatedAt: [] as string[] }
  for (const [camelName, builder] of Object.entries(table.columns)) {
    const sm = builder._def.systemManaged
    if (sm === 'createdAt') result.createdAt.push(camelName)
    else if (sm === 'updatedAt') result.updatedAt.push(camelName)
  }
  return result
}

/** Drop client-supplied values for system-managed columns — they're owned by the framework. */
function stripSystemManagedKeys(
  data: Record<string, unknown>,
  systemCols: { createdAt: string[]; updatedAt: string[] },
): Record<string, unknown> {
  const banned = new Set([...systemCols.createdAt, ...systemCols.updatedAt])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (!banned.has(k)) out[k] = v
  }
  return out
}

export async function executeAction(
  db: Database,
  bo: BusinessObjectDef,
  actionName: string,
  ctx: ActionContext,
  data: Record<string, unknown>,
): Promise<unknown> {
  const action = bo.actions[actionName]
  if (!action) {
    throw new Error(`Action "${actionName}" is not defined on BO "${bo.name}". This BO is ${bo.isReadOnly ? 'read-only' : 'missing this action'}.`)
  }

  // Permission check
  if (action.permission) {
    const result = await action.permission(ctx)
    if (typeof result === 'string') throw new Error(result)
    if (!result) throw new Error(`Permission denied for action "${actionName}"`)
  }

  // Before hook
  if (action.before) {
    const result = await action.before(ctx, data)
    if (typeof result === 'string') throw new Error(result)
  }

  // Custom handler
  if (action.handler) {
    const result = await action.handler(ctx, data)
    if (action.after) await action.after(ctx, result as any)
    return result
  }

  // Use internal _table API — BO framework writes directly to tables
  const table = getTable(bo)
  const systemCols = systemManagedColumns(table)
  let result: unknown

  switch (actionName) {
    case 'create': {
      // Strip composition keys + system-managed columns from parent data.
      // System-managed columns get their value from the table's DEFAULT now()
      // — clients can't override them (issue #61).
      const compositionKeys = new Set(Object.keys(bo.compositions))
      const parentData: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(data)) {
        if (!compositionKeys.has(k)) parentData[k] = v
      }
      const cleaned = stripSystemManagedKeys(parentData, systemCols)

      const rows = await db._table.into(table).values(cleaned).returning('*').execute()
      result = rows[0]

      // Handle compositions on create. Link-table compositions (M2M) are
      // read-only in this version — write support is a follow-up; if the caller
      // passes link data we ignore it rather than fail.
      for (const [compName, compDef] of Object.entries(bo.compositions)) {
        const compData = data[compName]
        if (!Array.isArray(compData)) continue
        if ('linkTable' in compDef) continue  // skip link compositions on write

        const plain = compDef
        const compTable = plain.table ?? plain.view?.source
        if (!compTable) continue

        // Composition parentKey resolves against a single column even when the
        // BO uses a composite key — only one column is the FK that links children.
        // defineBO already rejects an empty paramField array, so [0] is defined.
        const parentJoinCol = typeof bo.paramField === 'string' ? bo.paramField : bo.paramField[0] ?? ''
        const parentKeyValue = (result as Record<string, unknown>)[parentJoinCol]
        for (const childRow of compData as Record<string, unknown>[]) {
          const childData = { ...childRow, [plain.parentKey]: parentKeyValue }
          await db._table.into(compTable).values(childData).execute()
        }
      }

      break
    }
    case 'update': {
      // Split data into key columns (used in WHERE) and update payload, in a
      // composite-key-aware way (issue #51).
      const keyCols = paramFieldList(bo.paramField)
      const rawUpdateData: Record<string, unknown> = {}
      const keyValues: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(data)) {
        if (keyCols.includes(k)) keyValues[k] = v
        else rawUpdateData[k] = v
      }
      // Strip any client-supplied system-managed values, then auto-stamp every
      // `updatedAt` column with `now()` so the timestamp actually advances on
      // each write (issue #61).
      const cleaned = stripSystemManagedKeys(rawUpdateData, systemCols)
      const stamp = new Date()
      for (const col of systemCols.updatedAt) cleaned[col] = stamp

      const rows = await db._table.update(table)
        .set(cleaned)
        .where(keyToWhere(bo.paramField, keyValues))
        .returning('*')
        .execute()
      result = rows[0]
      break
    }
    case 'delete': {
      const rows = await db._table.deleteFrom(table)
        .where(keyToWhere(bo.paramField, data))
        .returning('*')
        .execute()
      result = rows[0]
      break
    }
    default: {
      throw new Error(`Unknown standard action "${actionName}". Use a custom handler.`)
    }
  }

  // After hook
  if (action.after) await action.after(ctx, result as any)

  // Auto-invalidate cache by BO tags. Runs after successful writes only; custom
  // actions that invoke their own handler already returned above.
  if (bo.cacheTags && bo.cacheTags.length > 0 && db.cache) {
    await db.cache.invalidateByTags(bo.cacheTags)
  }

  return result
}
