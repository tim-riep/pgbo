// Business Object layer — Phase 7 (Step 17)

import type { ViewDef, TableDef, AnyColumnBuilder } from '../schema/definitions.js'
import type { Database } from '../query/client.js'
import type { BusinessObjectDef, BOConfig, ActionContext, CompositionDef, AnyCompositionDef, TypedBusinessObject } from './types.js'
import { executeAction } from './actions.js'

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

function normalizeComposition(value: AnyCompositionDef | ViewDef | TableDef): AnyCompositionDef {
  // Link-table M2M composition — pass through as-is
  if ('linkTable' in value) return value
  // Plain composition with explicit config — pass through
  if ('parentKey' in value) return value as CompositionDef
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

  const bo: BusinessObjectDef = {
    name: config.name ?? snakeToCamel(root.name),
    root,
    paramField: config.paramField ?? 'id',
    actions: config.actions ?? {},
    compositions,
    associations,
    valueHelps: config.valueHelps ?? {},
    isReadOnly: !config.actions || Object.keys(config.actions).length === 0,
    routePrefix: config.routePrefix,
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
export { defineProjection, projectRow, projectionExposes } from './projection.js'
