// Auto-enrich associations on reads (issue #23).
//
// Symmetric to enrichCompositions, but resolves FK references to target entities.
// When the target is a BO, its compositions (e.g. translation lookup) run on the
// target rows too — so `merge: ['name']` with a $locale-filtered translation
// composition gives you the caller-locale name lifted onto the parent.

import type { Database } from '../query/client.js'
import type { TransactionClient } from '../query/transaction.js'
import type { AssociationDef, AssociationTargetBO, ViewDef } from '../schema/definitions.js'
import type { BusinessObjectDef, ActionContext } from './types.js'
import type { WhereConditions } from '../query/where.js'
import { enrichCompositions } from './enrich.js'

/** Database or a request-scoped TransactionClient — used so association reads
 * see session params when callers wrap routes in `db.withContext` (issue #42). */
type DbOrTx = Database | TransactionClient

function isBusinessObjectTarget(target: unknown): target is AssociationTargetBO {
  return typeof target === 'object' && target !== null
    && 'compositions' in target
    && 'paramField' in target
    && 'root' in target
}

function isViewDef(target: unknown): target is ViewDef {
  return typeof target === 'object' && target !== null
    && 'source' in target && !('compositions' in target)
}

/** Capitalize the first letter — `name` → `Name` for prefix joining. */
function capitalize(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export interface EnrichAssociationsOptions {
  /** Context used to resolve placeholders in target WHERE clauses + target BO compositions. */
  readonly ctx?: ActionContext
}

/**
 * For each BO association, batch-load the target rows and either merge their
 * fields onto each parent or attach them as a nested object.
 *
 * An association without `merge` or `attach` is metadata-only — no DB hit.
 * Returns new objects; does not mutate input.
 */
export async function enrichAssociations<T extends Record<string, unknown>>(
  db: DbOrTx,
  bo: BusinessObjectDef,
  items: readonly T[],
  opts: EnrichAssociationsOptions = {},
): Promise<T[]> {
  const associations = Object.entries(bo.associations)
  if (associations.length === 0 || items.length === 0) {
    return items.map(item => ({ ...item }))
  }

  type Loaded = { name: string; def: AssociationDef; byKey: Map<unknown, Record<string, unknown>> }

  // Only associations with merge or attach trigger enrichment
  const active = associations.filter(([, def]) => !!def.target && (def.merge ?? def.attach))
  if (active.length === 0) {
    return items.map(item => ({ ...item }))
  }

  const loaded: Loaded[] = await Promise.all(
    active.map(async ([name, def]): Promise<Loaded> => {
      const target = def.target
      if (!target) return { name, def, byKey: new Map() }

      // Collect distinct non-null FK values
      const fkValues = [...new Set(
        items.map(i => i[def.foreignKey]).filter(v => v !== null && v !== undefined),
      )]
      if (fkValues.length === 0) {
        return { name, def, byKey: new Map() }
      }

      if (isBusinessObjectTarget(target)) {
        const targetBO = target as unknown as BusinessObjectDef
        const root = targetBO.root
        const where = combineWhere({ [targetBO.paramField]: { any: fkValues } }, def.where)

        // Query through the view if root is a view; otherwise through _table for a TableDef root.
        const rows = 'source' in root
          ? await db.from(root).where(where).execute() as Record<string, unknown>[]
          : await db._table.from(root).where(where).execute() as unknown as Record<string, unknown>[]

        // Run the target BO's compositions (translations, etc.)
        const enriched = Object.keys(targetBO.compositions).length > 0
          ? await enrichCompositions(db, targetBO, rows, { ctx: opts.ctx })
          : rows

        const byKey = new Map<unknown, Record<string, unknown>>()
        for (const row of enriched) byKey.set(row[targetBO.paramField], row)
        return { name, def, byKey }
      }

      if (isViewDef(target)) {
        const pk = target.source.primaryKey[0]
        if (!pk) {
          throw new Error(`Association "${name}" target view "${target.name}" has no primary key`)
        }
        const where = combineWhere({ [pk]: { any: fkValues } }, def.where)
        const rows = await db.from(target).where(where).execute() as Record<string, unknown>[]

        const byKey = new Map<unknown, Record<string, unknown>>()
        for (const row of rows) byKey.set(row[pk], row)
        return { name, def, byKey }
      }

      // TableDef target — not supported in this MVP
      throw new Error(
        `Association "${name}" target must be a ViewDef or a BusinessObjectDef, not a plain TableDef`,
      )
    }),
  )

  return items.map(item => {
    const result: Record<string, unknown> = { ...item }
    for (const { def, byKey } of loaded) {
      const fkValue = item[def.foreignKey]
      const targetRow = fkValue !== null && fkValue !== undefined ? byKey.get(fkValue) : undefined

      if (def.merge && def.merge.length > 0) {
        const prefix = def.prefix ?? ''
        for (const field of def.merge) {
          const outKey = prefix ? `${prefix}${capitalize(field)}` : field
          result[outKey] = targetRow?.[field] ?? null
        }
      } else if (def.attach) {
        if (targetRow && def.columns && def.columns.length > 0) {
          const narrowed: Record<string, unknown> = {}
          for (const col of def.columns) {
            if (col in targetRow) narrowed[col] = targetRow[col]
          }
          result[def.attach] = narrowed
        } else {
          result[def.attach] = targetRow ?? null
        }
      }
    }
    return result as T
  })
}

function combineWhere(
  base: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
): WhereConditions {
  if (!extra) return base as WhereConditions
  return { ...base, ...extra } as WhereConditions
}
