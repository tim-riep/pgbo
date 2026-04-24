// Projections — issue #15
//
// A projection is the HTTP surface layered on top of a BO. The BO holds the
// data model, schema, and write logic; the projection declares what is reachable
// over HTTP: which actions are whitelisted, which columns are visible, and what
// root-level WHERE applies to every query.
//
// Only projections are exposed via `registerProjection` in @pgbo/fastify.
// Base BOs remain importable for internal use (custom action handlers, CLI,
// seed scripts) but never directly wired to HTTP.

import type { BusinessObjectDef, ProjectionDef, ProjectionConfig } from './types.js'

/**
 * Define an HTTP projection of a Business Object.
 *
 * @example
 * ```ts
 * const areaPublic = defineProjection(areaBO, {
 *   name: 'areaPublic',
 *   actions: { read: true },
 *   columns: ['id', 'slug', 'name'],
 *   where: { published: true },
 * })
 * ```
 */
export function defineProjection(bo: BusinessObjectDef, config: ProjectionConfig): ProjectionDef {
  // Validate: every action in the whitelist must exist on the BO (or be 'read', which is implicit)
  for (const [actionName, enabled] of Object.entries(config.actions)) {
    if (!enabled) continue
    if (actionName === 'read') continue  // GET list+detail are always available from the underlying BO
    if (!bo.actions[actionName]) {
      throw new Error(
        `Projection "${config.name}" whitelists action "${actionName}" but the underlying BO "${bo.name}" has no such action. Remove it or add it to the BO first.`,
      )
    }
  }

  // Validate: every column in the projection must exist on the BO root (if root is a view or table)
  if (config.columns) {
    const root = bo.root
    const available = 'columns' in root ? Object.keys(root.columns) : undefined
    if (available) {
      for (const col of config.columns) {
        if (!available.includes(col)) {
          throw new Error(
            `Projection "${config.name}" references column "${col}" which does not exist on "${bo.name}". Available columns: ${available.join(', ')}`,
          )
        }
      }
    }
  }

  return {
    name: config.name,
    bo,
    actions: { ...config.actions },
    columns: config.columns,
    where: config.where,
  }
}

/** Narrow a row to only the projection's columns. Returns a new object. */
export function projectRow(
  projection: ProjectionDef,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (!projection.columns) return { ...row }
  const result: Record<string, unknown> = {}
  for (const col of projection.columns) {
    if (col in row) result[col] = row[col]
  }
  return result
}

/** Whether this projection exposes the given action name. */
export function projectionExposes(projection: ProjectionDef, actionName: string): boolean {
  return projection.actions[actionName] === true
}
