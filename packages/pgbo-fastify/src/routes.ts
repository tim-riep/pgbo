// BO and View route factories for Fastify
//
// HTTP surface is defined by `registerProjection` — projections are the only
// thing wired to HTTP (issue #15). Base BOs remain importable for internal
// use (custom action handlers, CLI, seeds) but cannot be exposed directly.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Database } from '@pgbo/core'
import type { ViewDef } from '@pgbo/core/schema'
import type { WhereConditions } from '@pgbo/core/query'
import { parseListParams } from '@pgbo/core/query'
import { boMeta, viewMeta, type BOMeta, type FieldMeta } from '@pgbo/core/metadata'
import { enrichCompositions, projectRow, projectionExposes, type ProjectionDef } from '@pgbo/core/bo'
import type { ProjectionRouteConfig, ViewRouteConfig, FileResponse } from './types.js'
import { paginateView, buildTenantWhere } from './helpers.js'

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
 */
function transformProjectionMeta(projection: ProjectionDef, meta: BOMeta): PublicBoMeta {
  const allowed = projection.columns ? new Set(projection.columns) : undefined
  const fields = meta.fields
    .filter(f => !allowed || allowed.has(f.key))
    .map((f): PublicFieldMeta => ({
      key: f.key,
      kind: f.kind,
      labelKey: f.label ?? `${projection.name}.${f.key}`,
      hidden: f.hidden,
      immutable: f.immutable,
      searchable: f.searchable,
      filterable: f.filterable,
      inList: f.hidden ? false : f.inList,
      inForm: f.hidden ? false : f.inForm,
      required: f.required,
      quick: f.quick,
    }))
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

  // Apply projection column narrowing to a row (or no-op when no columns are set)
  function narrow(row: Record<string, unknown>): Record<string, unknown> {
    return projection.columns ? projectRow(projection, row) : { ...row }
  }
  function narrowAll(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return projection.columns ? rows.map(r => projectRow(projection, r)) : rows
  }

  // Fetch a single row by paramField — used by detail + write-protection.
  // Applies the projection's root WHERE so "invisible" rows 404 even if they exist.
  async function fetchByParam(paramValue: string, userId?: string): Promise<Record<string, unknown> | undefined> {
    let q = db.from(viewDef).where(mergeWhere({ [paramField]: paramValue } as WhereConditions, projection.where) ?? { [paramField]: paramValue } as WhereConditions)
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
    app.get(prefix, async (req: FastifyRequest) => {
      const ctx = await config.extractContext(req)
      const params = parseListParams(req.query as Record<string, unknown>)

      const tenantWhere = ctx.tenantId
        ? buildTenantWhere(ctx.tenantId, tenantCol, includeGlobal)
        : undefined
      const baseWhere = mergeWhere(tenantWhere, projection.where)

      const result = await paginateView({
        db, view: viewDef, params, baseWhere, userId: ctx.userId,
      })

      let items = result.items as Record<string, unknown>[]
      if (Object.keys(bo.compositions).length > 0) {
        items = await enrichCompositions(db, bo, items)
      }
      if (bo.transformItems) {
        items = await bo.transformItems(items, ctx.locale, db)
      }
      if (includeGlobal) items = attachGlobalFlag(items, tenantCol)
      items = narrowAll(items)

      return { items, total: result.total, page: result.page, limit: result.limit }
    })

    app.get(`${prefix}/:param`, async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = await config.extractContext(req)
      const paramValue = extractParam(req)

      const row = await fetchByParam(paramValue, ctx.userId)
      if (!row) {
        reply.code(404)
        return { error: 'Not found' }
      }

      let items: Record<string, unknown>[] = [row]
      if (Object.keys(bo.compositions).length > 0) {
        items = await enrichCompositions(db, bo, items)
      }
      if (bo.transformItems) {
        items = await bo.transformItems(items, ctx.locale, db)
      }
      if (includeGlobal) items = attachGlobalFlag(items, tenantCol)
      items = narrowAll(items)

      return items[0]
    })

    // Metadata — reflects the narrowed surface
    app.get(`/bo/${projection.name}`, () => transformProjectionMeta(projection, boMeta(bo)))

    // Value help endpoints
    if (Object.keys(valueHelps).length > 0) {
      for (const [vhName, vh] of Object.entries(valueHelps)) {
        app.get(`/bo/${projection.name}/valueHelp/${vhName}`, async (req: FastifyRequest) => {
          const ctx = await config.extractContext(req)
          const params = parseListParams(req.query as Record<string, unknown>)

          if ('source' in vh && typeof vh.source === 'object') {
            const result = await paginateView({
              db, view: vh as ViewDef, params, userId: ctx.userId,
            })
            return { items: result.items, total: result.total, page: result.page, limit: result.limit }
          }

          const offset = (params.page - 1) * params.limit
          const [items, countRows] = await Promise.all([
            db.query(`SELECT * FROM ${vh.name} LIMIT ${params.limit} OFFSET ${offset}`),
            db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${vh.name}`),
          ])
          const total = Number(countRows[0]?.count ?? 0)
          return { items, total, page: params.page, limit: params.limit }
        })
      }
    }
  }

  // POST create
  if (projectionExposes(projection, 'create') && bo.actions.create) {
    app.post(prefix, async (req: FastifyRequest, reply: FastifyReply) => {
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
    app.put(`${prefix}/:param`, async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = await config.extractContext(req)
      const paramValue = extractParam(req)

      // Always resolve the existing row through the projection — out-of-scope records 404
      const existing = await fetchByParam(paramValue, ctx.userId)
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
    app.delete(`${prefix}/:param`, async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = await config.extractContext(req)
      const paramValue = extractParam(req)

      const existing = await fetchByParam(paramValue, ctx.userId)
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
  for (const actionName of Object.keys(bo.actions)) {
    if (STANDARD_ACTIONS.has(actionName)) continue
    if (!projectionExposes(projection, actionName)) continue
    app.post(`/bo/${projection.name}/${actionName}`, async (req: FastifyRequest, reply: FastifyReply) => {
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

  app.get(prefix, async (req: FastifyRequest) => {
    const ctx = await config.extractContext(req)
    const params = parseListParams(req.query as Record<string, unknown>)

    const result = await paginateView({
      db, view: viewDef, params, userId: ctx.userId,
    })

    return { items: result.items, total: result.total, page: result.page, limit: result.limit }
  })

  // GET metadata
  app.get(`${prefix}/meta`, () => viewMeta(viewDef))
}
