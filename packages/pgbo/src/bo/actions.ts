// Standard action handlers — Phase 7 (Step 17)

import type { Database } from '../query/client.js'
import type { TableDef } from '../schema/definitions.js'
import type { BusinessObjectDef, ActionContext } from './types.js'

function getTable(bo: BusinessObjectDef): TableDef {
  const root = bo.root
  if ('columns' in root && 'primaryKey' in root) return root
  if ('source' in root) return root.source
  throw new Error(`Cannot resolve table from BO root`)
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
  let result: unknown

  switch (actionName) {
    case 'create': {
      // Strip composition keys from parent data
      const compositionKeys = new Set(Object.keys(bo.compositions))
      const parentData: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(data)) {
        if (!compositionKeys.has(k)) parentData[k] = v
      }

      const rows = await db._table.into(table).values(parentData).returning('*').execute()
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

        const parentKeyValue = (result as Record<string, unknown>)[bo.paramField]
        for (const childRow of compData as Record<string, unknown>[]) {
          const childData = { ...childRow, [plain.parentKey]: parentKeyValue }
          await db._table.into(compTable).values(childData).execute()
        }
      }

      break
    }
    case 'update': {
      const { [bo.paramField]: paramValue, ...updateData } = data
      const rows = await db._table.update(table)
        .set(updateData)
        .where({ [bo.paramField]: paramValue })
        .returning('*')
        .execute()
      result = rows[0]
      break
    }
    case 'delete': {
      const rows = await db._table.deleteFrom(table)
        .where({ [bo.paramField]: data[bo.paramField] })
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
