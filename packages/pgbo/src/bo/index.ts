// Business Object layer — Phase 7 (Step 17)

import type { ViewDef, TableDef, AnyColumnBuilder } from '../schema/definitions.js'
import type { Database } from '../query/client.js'
import type { BusinessObjectDef, BOConfig, ActionContext, AnyCompositionDef, TypedBusinessObject } from './types.js'
import { executeAction } from './actions.js'

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

function normalizeComposition(value: AnyCompositionDef | ViewDef | TableDef): AnyCompositionDef {
  // Link-table M2M composition — pass through as-is
  if ('linkTable' in value) return value
  // Plain composition with explicit config — pass through
  if ('parentKey' in value) return value
  // Shorthand: a TableDef passed directly (legacy shape, parentKey inferred/empty)
  if ('columns' in value) return { table: value as TableDef, parentKey: '' }
  // Shorthand: a ViewDef passed directly
  return { view: value as ViewDef, parentKey: '' }
}

/** Resolve the columns type from a ViewDef or TableDef */
type ResolveColumns<R> =
  R extends TableDef<infer C> ? C :
  R extends ViewDef ? R['source'] extends TableDef<infer C> ? C : Record<string, AnyColumnBuilder> :
  Record<string, AnyColumnBuilder>

/** Resolve the paramField — defaults to 'id' */
type ResolveParam<C extends Record<string, AnyColumnBuilder>, Cfg extends BOConfig<C>> =
  Cfg extends { paramField: infer P extends string & keyof C } ? P : 'id' & keyof C

export function defineBO<
  R extends ViewDef | TableDef,
  C extends Record<string, AnyColumnBuilder> = ResolveColumns<R>,
  Cfg extends BOConfig<C> = BOConfig<C>,
>(
  root: R,
  config: Cfg = {} as Cfg,
): TypedBusinessObject<C, ResolveParam<C, Cfg>> {
  const compositions: Record<string, AnyCompositionDef> = {}
  if (config.compositions) {
    for (const [key, value] of Object.entries(config.compositions)) {
      compositions[key] = normalizeComposition(value)
    }
  }

  // Inherit associations from the view. BO-level associations override by key.
  const viewAssocs = 'viewAssociations' in root ? root.viewAssociations ?? {} : {}
  const associations = { ...viewAssocs, ...(config.associations ?? {}) }

  // Value helps must be views annotated with .vh() — surface a clear error instead
  // of letting Fastify fail at request time when it can't find key/display columns.
  const valueHelps = config.valueHelps ?? {}
  const boName = config.name ?? snakeToCamel(root.name)
  for (const [vhName, vhView] of Object.entries(valueHelps)) {
    if (!vhView.vhAnnotation) {
      throw new Error(
        `BO "${boName}": valueHelps["${vhName}"] points to view "${vhView.name}" which has no .vh({ key, display }) annotation. ` +
        `Mark it as a value help with .vh({ key: '…', display: '…' }) on the view.`,
      )
    }
  }

  // Cross-check: every column-level `.valueHelp(vhView)` on the root must reference
  // a vh view that's also registered in the BO's `valueHelps` (issue #35). Catches
  // typos and missed wiring at definition time instead of at request time when the
  // form tries to fetch a non-existent endpoint.
  if ('selectedColumns' in root && root.selectedColumns) {
    const registeredViews = new Set(Object.values(valueHelps))
    for (const [colKey, entry] of Object.entries(root.selectedColumns)) {
      const vh = (entry as { annotations?: { valueHelp?: ViewDef } }).annotations?.valueHelp
      if (vh && !registeredViews.has(vh)) {
        const known = Object.keys(valueHelps)
        const suggestion = known.length > 0
          ? ` Known value helps: ${known.map(k => `"${k}"`).join(', ')}.`
          : ' No value helps registered on this BO.'
        throw new Error(
          `BO "${boName}": column "${colKey}" references value help view "${vh.name}" via .valueHelp(...), ` +
          `but no entry in this BO's valueHelps points at that view.${suggestion} ` +
          `Add it under valueHelps so the metadata-driven form can resolve the dropdown.`,
        )
      }
    }
  }

  const bo: BusinessObjectDef = {
    name: config.name ?? snakeToCamel(root.name),
    root,
    paramField: config.paramField ?? 'id',
    actions: config.actions ?? {},
    compositions,
    associations,
    valueHelps,
    isReadOnly: !config.actions || Object.keys(config.actions).length === 0,
    orderBy: config.orderBy,
    orderDir: config.orderDir,
    cacheTags: config.cacheTags,
    virtualFields: config.virtualFields,
    transformItems: config.transformItems,
  }

  const impl = {
    ...bo,

    create(db: Database, ctx: ActionContext, data: Record<string, unknown>) {
      return executeAction(db, bo, 'create', ctx, data)
    },

    update(db: Database, ctx: ActionContext, data: Record<string, unknown>) {
      return executeAction(db, bo, 'update', ctx, data)
    },

    delete(db: Database, ctx: ActionContext, data: Record<string, unknown>) {
      return executeAction(db, bo, 'delete', ctx, data)
    },

    execute(db: Database, actionName: string, ctx: ActionContext, data: Record<string, unknown>) {
      return executeAction(db, bo, actionName, ctx, data)
    },
  }
  return impl as unknown as TypedBusinessObject<C, ResolveParam<C, Cfg>>
}

export { type BusinessObjectDef, type BOConfig, type ActionDef, type ActionContext, type CompositionDef, type AnyCompositionDef, type LinkCompositionDef, type BoTarget, type TypedBusinessObject, type VirtualFieldMeta, type ProjectionDef, type ProjectionConfig, isLinkComposition } from './types.js'
export { enrichCompositions } from './enrich.js'
export { enrichAssociations, type EnrichAssociationsOptions } from './enrich-associations.js'
export { defineProjection, projectRow, projectionExposes } from './projection.js'
