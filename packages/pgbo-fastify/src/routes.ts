// BO and View route factories for Fastify
//
// HTTP surface is defined by `registerProjection` — projections are the only
// thing wired to HTTP (issue #15). Base BOs remain importable for internal
// use (custom action handlers, CLI, seeds) but cannot be exposed directly.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Database } from '@pgbo/core'
import type { ViewDef } from '@pgbo/core/schema'
import type { WhereConditions, TransactionClient } from '@pgbo/core/query'
import { parseListParams } from '@pgbo/core/query'
import { boMeta, viewMeta, type BOMeta, type FieldMeta } from '@pgbo/core/metadata'
import { enrichCompositions, enrichAssociations, projectRow, projectionExposes, type ProjectionDef } from '@pgbo/core/bo'
import type { ProjectionRouteConfig, ViewRouteConfig, FileResponse, SwaggerConfig, RouteContext } from './types.js'
import { paginateView, buildTenantWhere } from './helpers.js'
import {
  rowSchema, listResponseSchema, listQuerystringSchema, paramSchema, paramFieldType,
  createBodySchema, updateBodySchema, metaResponseSchema,
  buildRouteSchema, viewHasAuth, actionBodySchema,
  type JSONSchema,
} from './openapi.js'

interface TypedBoMethods {
  create: (db: Database, ctx: unknown, data: unknown) => Promise<unknown>
  update: (db: Database, ctx: unknown, data: unknown) => Promise<unknown>
  delete: (db: Database, ctx: unknown, data: unknown) => Promise<unknown>
  execute: (db: Database, actionName: string, ctx: unknown, data: unknown) => Promise<unknown>
}

const STANDARD_ACTIONS = new Set(['create', 'update', 'delete'])

function isFileResponse(value: unknown): value is FileResponse {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const data = v.data
  const isBinary = (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) || data instanceof Uint8Array
  return isBinary && typeof v.contentType === 'string'
}

async function sendActionResult(reply: FastifyReply, result: unknown): Promise<void> {
  if (result === undefined || result === null) {
    await reply.code(204).send()
    return
  }
  if (isFileResponse(result)) {
    reply.header('content-type', result.contentType)
    reply.header('content-length', String(result.data.byteLength))
    if (result.filename) {
      const disposition = result.inline ? 'inline' : 'attachment'
      // Escape quotes in filename per RFC 6266
      const safe = result.filename.replace(/"/g, '\\"')
      reply.header('content-disposition', `${disposition}; filename="${safe}"`)
    }
    await reply.send(result.data)
    return
  }
  await reply.send(result)
}

function resolveView(config: ProjectionRouteConfig): ViewDef {
  if (config.view) return config.view
  const root = config.projection.bo.root
  if ('source' in root) return root
  throw new Error(`BO "${config.projection.bo.name}" root is a TableDef — pass an explicit view in ProjectionRouteConfig`)
}

type PublicFieldMeta = Omit<FieldMeta, 'label'> & { readonly labelKey: string }
type PublicBoMeta = Omit<BOMeta, 'fields'> & { readonly fields: readonly PublicFieldMeta[] }

/**
 * Transform boMeta output:
 * - label → labelKey with `${projectionName}.${key}` fallback
 * - hidden → inList/inForm: false
 * - restricts field list to the projection's column allowlist if set
 * - resolves valueHelp / filterable.endpoint to absolute URLs (issue #35)
 */
function transformProjectionMeta(projection: ProjectionDef, meta: BOMeta): PublicBoMeta {
  const allowed = projection.columns ? new Set(projection.columns) : undefined
  const vhPrefix = `/bo/${projection.name}/valueHelp`
  const fields = meta.fields
    .filter(f => !allowed || allowed.has(f.key))
    .map((f): PublicFieldMeta => {
      const valueHelp = f.valueHelp
        ? { ...f.valueHelp, endpoint: `${vhPrefix}/${f.valueHelp.name}` }
        : undefined
      const filterable = f.filterable && typeof f.filterable === 'object' && f.filterable.endpoint
        ? { ...f.filterable, endpoint: `${vhPrefix}/${f.filterable.endpoint}` }
        : f.filterable
      return {
        key: f.key,
        kind: f.kind,
        labelKey: f.label ?? `${projection.name}.${f.key}`,
        hidden: f.hidden,
        immutable: f.immutable,
        searchable: f.searchable,
        filterable,
        valueHelp,
        inList: f.hidden ? false : f.inList,
        inForm: f.hidden ? false : f.inForm,
        required: f.required,
        quick: f.quick,
      }
    })
  return { ...meta, name: projection.name, fields }
}

/** Attach `global: true` to rows where tenantColumn is null (for includeGlobal routes) */
function attachGlobalFlag(items: Record<string, unknown>[], tenantCol: string): Record<string, unknown>[] {
  return items.map(item => ({ ...item, global: item[tenantCol] === null || item[tenantCol] === undefined }))
}

/** Extract :param from req.params — throws if missing (Fastify guarantees this won't happen with the route pattern) */
function extractParam(req: FastifyRequest): string {
  const value = (req.params as Record<string, string | undefined>).param
  if (value === undefined) throw new Error('Route param :param is missing — route pattern is misconfigured')
  return value
}

/** Merge the projection's root WHERE with any other conditions. Returns undefined if both are empty. */
function mergeWhere(a: WhereConditions | undefined, b: Record<string, unknown> | undefined): WhereConditions | undefined {
  if (!a && !b) return undefined
  if (!a) return b as WhereConditions
  if (!b) return a
  return { ...a, ...b } as WhereConditions
}

/**
 * Register HTTP routes for a projection. This is the only way to wire a BO to HTTP.
 *
 * Only actions whitelisted in `projection.actions` produce routes:
 * - `read: true`   — GET {prefix} (list) + GET {prefix}/:param (detail) + GET /bo/{name} (metadata)
 * - `create: true` — POST {prefix}
 * - `update: true` — PUT {prefix}/:param
 * - `delete: true` — DELETE {prefix}/:param
 * - `<custom>: true` — POST /bo/{name}/{custom}
 *
 * Actions not listed are NOT registered. Accidental exposure is impossible.
 */
export function registerProjection(app: FastifyInstance, db: Database, config: ProjectionRouteConfig): void {
  const projection = config.projection
  const bo = projection.bo
  const boMethods = bo as unknown as TypedBoMethods
  const viewDef = resolveView(config)
  const prefix = config.prefix ?? bo.routePrefix ?? `/bo/${projection.name}`
  const paramField = bo.paramField
  const tenantCol = config.tenantColumn ?? 'tenantId'
  const includeGlobal = config.includeGlobal ?? false
  const valueHelps = config.valueHelps ?? bo.valueHelps

  const readExposed = projectionExposes(projection, 'read')

  // --- Session-param wrap (issue #42) ---
  // When the database has sessionParams configured, every read handler runs
  // inside `db.withContext(ctx, ...)` so views with .translatedJoin() (or any
  // current_setting() lookup) see the per-request values. The handler receives
  // the scoped TransactionClient, which paginateView/enrichCompositions/etc.
  // accept (their `db` params widened to Database | TransactionClient).
  // When sessionParams is empty, the wrap is a no-op — saves an extra
  // transaction round-trip per request.
  function withSession<T>(
    ctx: RouteContext,
    fn: (q: Database | TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (db.hasSessionParams) {
      return db.withContext(ctx as unknown as Record<string, unknown>, tx => fn(tx))
    }
    return fn(db)
  }

  // --- OpenAPI schema generation (issue #38) ---
  const swagger: SwaggerConfig = config.swagger ?? {}
  const swaggerEnabled = swagger.enabled !== false  // default on
  const tag = swagger.tag ?? projection.name
  const baseTags = [tag] as const
  const securityScheme = swagger.securityScheme ?? 'bearerAuth'
  const security = viewHasAuth(projection) ? [{ [securityScheme]: [] }] : undefined
  // boMeta() with the BO so schemas reflect the same fields as the /meta endpoint
  const meta = boMeta(bo)
  const paramTypeForRoute = paramFieldType(bo.root, paramField)
  const desc = (key: string): string | undefined => swagger.descriptions?.[key]
  const route404Schema: JSONSchema = { type: 'object', properties: { error: { type: 'string' } } }

  /** Wrap an options-object so we only attach `schema` when swagger is enabled. */
  function withSchema(parts: Parameters<typeof buildRouteSchema>[0]): Record<string, unknown> {
    if (!swaggerEnabled) return {}
    const schema = buildRouteSchema(security ? { ...parts, security } : parts)
    return { schema }
  }

  // Apply projection column narrowing to a row (or no-op when no columns are set)
  function narrow(row: Record<string, unknown>): Record<string, unknown> {
    return projection.columns ? projectRow(projection, row) : { ...row }
  }
  function narrowAll(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return projection.columns ? rows.map(r => projectRow(projection, r)) : rows
  }

  // Fetch a single row by paramField — used by detail + write-protection.
  // Applies the projection's root WHERE so "invisible" rows 404 even if they exist.
  async function fetchByParam(
    queryable: Database | TransactionClient,
    paramValue: string,
    userId?: string,
  ): Promise<Record<string, unknown> | undefined> {
    let q = queryable.from(viewDef).where(mergeWhere({ [paramField]: paramValue } as WhereConditions, projection.where) ?? { [paramField]: paramValue } as WhereConditions)
    if (userId) q = q.as(userId)
    const rows = await q.execute()
    return rows[0] as Record<string, unknown> | undefined
  }

  function assertNotGlobal(row: Record<string, unknown>, reply: FastifyReply): boolean {
    if (!includeGlobal) return true
    if (row[tenantCol] === null || row[tenantCol] === undefined) {
      reply.code(403)
      return false
    }
    return true
  }

  // Read routes: GET list + GET detail + GET metadata
  if (readExposed) {
    const rowSchemaObj = rowSchema(meta)
    const listSchema = listResponseSchema(rowSchemaObj)
    const listQueryString = listQuerystringSchema(meta)
    const paramSchemaObj = paramSchema(paramField, paramTypeForRoute)

    app.get(prefix, withSchema({
      tags: baseTags,
      summary: `List ${tag}`,
      description: desc('list'),
      querystring: listQueryString,
      response: { 200: listSchema },
    }), async (req: FastifyRequest) => {
      const ctx = await config.extractContext(req)
      const params = parseListParams(req.query as Record<string, unknown>)

      const tenantWhere = ctx.tenantId
        ? buildTenantWhere(ctx.tenantId, tenantCol, includeGlobal)
        : undefined
      const baseWhere = mergeWhere(tenantWhere, projection.where)

      return withSession(ctx, async (q) => {
        const result = await paginateView({
          db: q, view: viewDef, params, baseWhere, userId: ctx.userId,
        })

        let items = result.items as Record<string, unknown>[]
        if (Object.keys(bo.compositions).length > 0) {
          items = await enrichCompositions(q, bo, items, { ctx: { ...ctx } })
        }
        if (Object.keys(bo.associations).length > 0) {
          items = await enrichAssociations(q, bo, items, { ctx: { ...ctx } })
        }
        if (bo.transformItems) {
          items = await bo.transformItems(items, ctx.locale, q)
        }
        if (includeGlobal) items = attachGlobalFlag(items, tenantCol)
        items = narrowAll(items)

        return { items, total: result.total, page: result.page, limit: result.limit }
      })
    })

    app.get(`${prefix}/:param`, withSchema({
      tags: baseTags,
      summary: `Get ${tag}`,
      description: desc('detail'),
      params: paramSchemaObj,
      response: { 200: rowSchemaObj, 404: route404Schema },
    }), async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = await config.extractContext(req)
      const paramValue = extractParam(req)

      return withSession(ctx, async (q) => {
        const row = await fetchByParam(q, paramValue, ctx.userId)
        if (!row) {
          reply.code(404)
          return { error: 'Not found' }
        }

        let items: Record<string, unknown>[] = [row]
        if (Object.keys(bo.compositions).length > 0) {
          items = await enrichCompositions(q, bo, items, { ctx: { ...ctx } })
        }
        if (Object.keys(bo.associations).length > 0) {
          items = await enrichAssociations(q, bo, items, { ctx: { ...ctx } })
        }
        if (bo.transformItems) {
          items = await bo.transformItems(items, ctx.locale, q)
        }
        if (includeGlobal) items = attachGlobalFlag(items, tenantCol)
        items = narrowAll(items)

        return items[0]
      })
    })

    // Metadata — reflects the narrowed surface. Lives in a separate `/meta/` namespace
    // so it never collides with the list/detail route prefix (#24).
    app.get(`/meta/${projection.name}`, withSchema({
      tags: [tag, 'meta'],
      summary: `Metadata for ${tag}`,
      description: desc('meta'),
      response: { 200: metaResponseSchema() },
    }), () => transformProjectionMeta(projection, boMeta(bo)))

    // Value help endpoints — each vh is a ViewDef annotated with .vh(), so everything
    // a regular view supports (search, filters, pagination, restrict, translatedJoin)
    // just works.
    if (Object.keys(valueHelps).length > 0) {
      for (const [vhName, vh] of Object.entries(valueHelps)) {
        const vhMeta = viewMeta(vh)
        const vhRowSchema = rowSchema(vhMeta)
        app.get(`/bo/${projection.name}/valueHelp/${vhName}`, withSchema({
          tags: [tag, 'valueHelp'],
          summary: `Value help: ${vhName}`,
          description: desc(`valueHelp.${vhName}`),
          querystring: listQuerystringSchema(vhMeta),
          response: { 200: listResponseSchema(vhRowSchema) },
        }), async (req: FastifyRequest) => {
          const ctx = await config.extractContext(req)
          const params = parseListParams(req.query as Record<string, unknown>)
          return withSession(ctx, async (q) => {
            const result = await paginateView({ db: q, view: vh, params, userId: ctx.userId })
            return { items: result.items, total: result.total, page: result.page, limit: result.limit }
          })
        })
      }
    }
  }

  const createBody = createBodySchema(meta)
  const updateBody = updateBodySchema(meta)
  const writeRowSchema = rowSchema(meta)

  // POST create
  if (projectionExposes(projection, 'create') && bo.actions.create) {
    app.post(prefix, withSchema({
      tags: baseTags,
      summary: `Create ${tag}`,
      description: desc('create'),
      body: createBody,
      response: { 201: writeRowSchema },
    }), async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = await config.extractContext(req)
      const data = req.body as Record<string, unknown>
      const result = await boMethods.create(db, ctx, data) as Record<string, unknown>
      if (config.afterWrite) await config.afterWrite(ctx, 'create')
      reply.code(201)
      return narrow(result)
    })
  }

  // PUT update
  if (projectionExposes(projection, 'update') && bo.actions.update) {
    app.put(`${prefix}/:param`, withSchema({
      tags: baseTags,
      summary: `Update ${tag}`,
      description: desc('update'),
      params: paramSchema(paramField, paramTypeForRoute),
      body: updateBody,
      response: { 200: writeRowSchema, 404: route404Schema, 403: route404Schema },
    }), async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = await config.extractContext(req)
      const paramValue = extractParam(req)

      // Always resolve the existing row through the projection — out-of-scope records 404
      const existing = await withSession(ctx, q => fetchByParam(q, paramValue, ctx.userId))
      if (!existing) {
        reply.code(404)
        return { error: 'Not found' }
      }
      if (includeGlobal && !assertNotGlobal(existing, reply)) return { error: 'Global records are read-only' }

      const data = { ...(req.body as Record<string, unknown>), [paramField]: paramValue }
      const result = await boMethods.update(db, ctx, data) as Record<string, unknown>
      if (config.afterWrite) await config.afterWrite(ctx, 'update')
      return narrow(result)
    })
  }

  // DELETE
  if (projectionExposes(projection, 'delete') && bo.actions.delete) {
    app.delete(`${prefix}/:param`, withSchema({
      tags: baseTags,
      summary: `Delete ${tag}`,
      description: desc('delete'),
      params: paramSchema(paramField, paramTypeForRoute),
      response: { 200: writeRowSchema, 404: route404Schema, 403: route404Schema },
    }), async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = await config.extractContext(req)
      const paramValue = extractParam(req)

      const existing = await withSession(ctx, q => fetchByParam(q, paramValue, ctx.userId))
      if (!existing) {
        reply.code(404)
        return { error: 'Not found' }
      }
      if (includeGlobal && !assertNotGlobal(existing, reply)) return { error: 'Global records are read-only' }

      const result = await boMethods.delete(db, ctx, { [paramField]: paramValue }) as Record<string, unknown>
      if (config.afterWrite) await config.afterWrite(ctx, 'delete')
      return narrow(result)
    })
  }

  // Custom actions — only those explicitly whitelisted
  for (const [actionName, action] of Object.entries(bo.actions)) {
    if (STANDARD_ACTIONS.has(actionName)) continue
    if (!projectionExposes(projection, actionName)) continue
    // Only attach a body schema when the action declares an explicit `inputSchema`.
    // Without it, Fastify's body validator would reject empty POSTs that the
    // existing handlers happily accept (they read `req.body ?? {}`).
    app.post(`/bo/${projection.name}/${actionName}`, withSchema({
      tags: [tag, 'action'],
      summary: action.summary ?? `Action: ${actionName}`,
      description: action.description ?? desc(actionName),
      ...(action.inputSchema && { body: actionBodySchema(action) }),
      // Custom actions can return JSON, null/undefined (→204), or a FileResponse
      // (→binary). We can't pin the response shape down here without a contract;
      // the action's `description` should mention which form it returns.
    }), async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = await config.extractContext(req)
      const data = (req.body as Record<string, unknown> | undefined) ?? {}
      const result = await boMethods.execute(db, actionName, ctx, data)
      await sendActionResult(reply, result)
    })
  }
}

/**
 * Register a read-only paginated view route.
 *
 * Route: GET {prefix} — paginated list
 */
export function registerViewRoute(app: FastifyInstance, db: Database, config: ViewRouteConfig): void {
  const viewDef = config.view
  const prefix = config.prefix ?? `/view/${viewDef.name}`

  // OpenAPI schema (issue #38)
  const swagger: SwaggerConfig = config.swagger ?? {}
  const swaggerEnabled = swagger.enabled !== false
  const tag = swagger.tag ?? viewDef.name
  const meta = viewMeta(viewDef)
  const rowSchemaObj = rowSchema(meta)
  const listOpts = swaggerEnabled
    ? { schema: buildRouteSchema({
        tags: [tag, 'view'],
        summary: `View: ${tag}`,
        description: swagger.descriptions?.list,
        querystring: listQuerystringSchema(meta),
        response: { 200: listResponseSchema(rowSchemaObj) },
      }) }
    : {}
  const metaOpts = swaggerEnabled
    ? { schema: buildRouteSchema({
        tags: [tag, 'view', 'meta'],
        summary: `Metadata for ${tag}`,
        description: swagger.descriptions?.meta,
        response: { 200: metaResponseSchema() },
      }) }
    : {}

  function viewWithSession<T>(
    ctx: RouteContext,
    fn: (q: Database | TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (db.hasSessionParams) {
      return db.withContext(ctx as unknown as Record<string, unknown>, tx => fn(tx))
    }
    return fn(db)
  }

  app.get(prefix, listOpts, async (req: FastifyRequest) => {
    const ctx = await config.extractContext(req)
    const params = parseListParams(req.query as Record<string, unknown>)

    return viewWithSession(ctx, async (q) => {
      const result = await paginateView({
        db: q, view: viewDef, params, userId: ctx.userId,
      })
      return { items: result.items, total: result.total, page: result.page, limit: result.limit }
    })
  })

  // GET metadata
  app.get(`${prefix}/meta`, metaOpts, () => viewMeta(viewDef))
}
