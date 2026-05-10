// JSON Schema / OpenAPI generation for routes registered by registerProjection
// + registerViewRoute (issue #38). All shapes derive from boMeta / viewMeta —
// no per-app wiring beyond the existing schema annotations.

import type { ViewDef, TableDef, AnyColumnBuilder } from '@pgbo/core/schema'
import type { BOMeta, FieldMeta, ViewMeta } from '@pgbo/core/metadata'
import type { ProjectionDef, ActionDef } from '@pgbo/core/bo'

/** Loose JSON-Schema-shaped object — Fastify and @fastify/swagger accept the same shape. */
export type JSONSchema = Record<string, unknown>

/** Map a FieldMeta.kind to a JSON Schema type entry. */
export function fieldSchema(field: FieldMeta): JSONSchema {
  // Translation fields can be null when the requested locale is missing
  const nullable = field.kind === 'translation'
  switch (field.kind) {
    case 'number':      return nullableIfNeeded({ type: 'number' }, nullable)
    case 'boolean':     return nullableIfNeeded({ type: 'boolean' }, nullable)
    case 'date':        return nullableIfNeeded({ type: 'string', format: 'date-time' }, nullable)
    case 'slug':        return nullableIfNeeded({ type: 'string' }, nullable)
    case 'relation':    return nullableIfNeeded({ type: 'string' }, nullable)
    case 'translation': return nullableIfNeeded({ type: 'string' }, true)
    case 'text':
    default:            return nullableIfNeeded({ type: 'string' }, nullable)
  }
}

function nullableIfNeeded(schema: JSONSchema, nullable: boolean): JSONSchema {
  return nullable ? { ...schema, nullable: true } : schema
}

/** Build an `object` schema with one property per field. Omits hidden fields.
 * `additionalProperties: true` so dynamic enrichment (compositions, associations,
 * virtual fields, the `global` flag) flows through Fastify's response serializer. */
export function rowSchema(meta: BOMeta | ViewMeta): JSONSchema {
  const properties: Record<string, JSONSchema> = {}
  for (const field of meta.fields) {
    if (field.hidden) continue
    properties[field.key] = fieldSchema(field)
  }
  return { type: 'object', properties, additionalProperties: true }
}

/** Standard list response: { items, total, page, limit }. */
export function listResponseSchema(rowSchemaObj: JSONSchema): JSONSchema {
  return {
    type: 'object',
    properties: {
      items: { type: 'array', items: rowSchemaObj },
      total: { type: 'integer' },
      page: { type: 'integer' },
      limit: { type: 'integer' },
    },
    required: ['items', 'total', 'page', 'limit'],
  }
}

/** Querystring schema for the standard list contract from `parseListParams`. */
export function listQuerystringSchema(meta: BOMeta | ViewMeta): JSONSchema {
  const sortableKeys = meta.fields
    .filter(f => !f.hidden)
    .map(f => f.key)
  return {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 250, default: 25 },
      search: { type: 'string' },
      sort: sortableKeys.length > 0 ? { type: 'string', enum: sortableKeys } : { type: 'string' },
      order: { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
      locale: { type: 'string', default: 'en' },
      fields: { type: 'string', description: 'Comma-separated subset of columns to return' },
    },
    additionalProperties: true,  // filter.<key>=value is dynamic per column
  }
}

/**
 * Path-param schema. The param is named `:param` in the route; the BO's
 * paramField names the column. For composite keys (issue #51) the param is
 * always a string in OData-style `(k1='v1',k2='v2')` form.
 */
export function paramSchema(
  paramField: string | readonly string[],
  paramType: 'integer' | 'string' = 'string',
): JSONSchema {
  if (typeof paramField !== 'string') {
    return {
      type: 'object',
      properties: {
        param: {
          type: 'string',
          description: `Composite key (${paramField.join(', ')}) in OData syntax: (k1='v1',k2='v2')`,
        },
      },
      required: ['param'],
    }
  }
  return {
    type: 'object',
    properties: {
      param: { type: paramType, description: `${paramField} of the record` },
    },
    required: ['param'],
  }
}

/** Body schema for POST (create): required + writable fields.
 * `additionalProperties: true` so composition arrays (e.g. `translations: [...]`)
 * pass through to `bo.create()` — the BO layer decides what to do with them. */
export function createBodySchema(meta: BOMeta): JSONSchema {
  const properties: Record<string, JSONSchema> = {}
  const required: string[] = []
  for (const field of meta.fields) {
    if (field.hidden) continue
    if (field.kind === 'translation') continue
    properties[field.key] = fieldSchema(field)
    if (field.required) required.push(field.key)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
    additionalProperties: true,
  }
}

/** Body schema for PUT (update): all writable, all optional, immutable + paramField excluded.
 * `additionalProperties: true` for the same reason as createBodySchema. */
export function updateBodySchema(meta: BOMeta): JSONSchema {
  const keyCols = new Set(
    typeof meta.paramField === 'string' ? [meta.paramField] : meta.paramField,
  )
  const properties: Record<string, JSONSchema> = {}
  for (const field of meta.fields) {
    if (field.hidden) continue
    if (field.immutable) continue
    if (keyCols.has(field.key)) continue
    if (field.kind === 'translation') continue
    properties[field.key] = fieldSchema(field)
  }
  return {
    type: 'object',
    properties,
    additionalProperties: true,
  }
}

/**
 * Detect the paramField's PG type from the BO root so the path-param schema
 * gets `integer` vs `string` right. Composite-key params are always emitted as
 * strings (the OData segment is one string).
 */
export function paramFieldType(
  root: ViewDef | TableDef,
  paramField: string | readonly string[],
): 'integer' | 'string' {
  if (typeof paramField !== 'string') return 'string'
  // Walk to the underlying table — view's source has the column builders
  const table = 'source' in root ? root.source : root
  const builder = (table.columns)[paramField] as AnyColumnBuilder | undefined
  if (!builder) return 'string'
  const pgType = builder._def.pgType
  if (pgType === 'integer' || pgType === 'serial' || pgType === 'bigint' || pgType === 'bigserial') return 'integer'
  return 'string'
}

/** Loose schema for the public BOMeta shape. Frontend tooling that consumes /meta gets a typed contract. */
export function metaResponseSchema(): JSONSchema {
  return {
    type: 'object',
    properties: {
      name: { type: 'string' },
      // paramField is a string for simple keys, a string[] for composite keys (issue #51).
      paramField: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      readOnly: { type: 'boolean' },
      fields: { type: 'array', items: { type: 'object', additionalProperties: true } },
      associations: { type: 'array', items: { type: 'object', additionalProperties: true } },
      compositions: { type: 'array', items: { type: 'object', additionalProperties: true } },
      valueHelps: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
    additionalProperties: true,
  }
}

/** Response shape for actions that return a FileResponse. */
export function fileResponseSchema(): JSONSchema {
  return { type: 'string', format: 'binary' }
}

export interface RouteSchemaParams {
  readonly tags: readonly string[]
  readonly summary?: string
  readonly description?: string
  readonly params?: JSONSchema
  readonly querystring?: JSONSchema
  readonly body?: JSONSchema
  readonly response?: Record<string | number, JSONSchema>
  readonly security?: readonly Record<string, readonly string[]>[]
}

/** Compose a Fastify route `schema` block. Fields are dropped when undefined. */
export function buildRouteSchema(parts: RouteSchemaParams): Record<string, unknown> {
  const out: Record<string, unknown> = { tags: [...parts.tags] }
  if (parts.summary) out.summary = parts.summary
  if (parts.description) out.description = parts.description
  if (parts.params) out.params = parts.params
  if (parts.querystring) out.querystring = parts.querystring
  if (parts.body) out.body = parts.body
  if (parts.response) out.response = parts.response
  if (parts.security) out.security = parts.security
  return out
}

/** Determine whether the projection's view requires auth (any `.restrict()` entry). */
export function viewHasAuth(projection: ProjectionDef): boolean {
  const root = projection.bo.root
  if (!('restrictions' in root)) return false
  if (root.isNoAuth) return false
  return Array.isArray(root.restrictions) && root.restrictions.length > 0
}

/** Default body schema for a custom action — uses ActionDef.inputSchema if present. */
export function actionBodySchema(action: ActionDef): JSONSchema {
  if (action.inputSchema) return action.inputSchema
  return { type: 'object', additionalProperties: true }
}
