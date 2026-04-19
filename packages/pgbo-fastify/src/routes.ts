// BO and View route factories for Fastify

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Database } from '@pgbo/core'
import type { ViewDef } from '@pgbo/core/schema'
import { parseListParams } from '@pgbo/core/query'
import { boMeta, viewMeta, type BOMeta, type FieldMeta } from '@pgbo/core/metadata'
import { enrichCompositions } from '@pgbo/core/bo'
import type { BoRouteConfig, ViewRouteConfig } from './types.js'
import { paginateView, buildTenantWhere } from './helpers.js'

interface TypedBoMethods {
  create: (db: Database, ctx: unknown, data: unknown) => Promise<unknown>
  update: (db: Database, ctx: unknown, data: unknown) => Promise<unknown>
  delete: (db: Database, ctx: unknown, data: unknown) => Promise<unknown>
}

function resolveView(config: BoRouteConfig): ViewDef {
  if (config.view) return config.view
  const root = config.bo.root
  if ('source' in root) return root
  throw new Error(`BO "${config.bo.name}" root is a TableDef — pass an explicit view in BoRouteConfig`)
}

type PublicFieldMeta = Omit<FieldMeta, 'label'> & { readonly labelKey: string }
type PublicBoMeta = Omit<BOMeta, 'fields'> & { readonly fields: readonly PublicFieldMeta[] }

/** Transform boMeta output: label → labelKey with `${boName}.${key}` fallback, hidden → inList/inForm: false */
function transformBoMeta(meta: BOMeta): PublicBoMeta {
  const fields = meta.fields.map((f): PublicFieldMeta => ({
    key: f.key,
    kind: f.kind,
    labelKey: f.label ?? `${meta.name}.${f.key}`,
    hidden: f.hidden,
    immutable: f.immutable,
    searchable: f.searchable,
    filterable: f.filterable,
    inList: f.hidden ? false : f.inList,
    inForm: f.hidden ? false : f.inForm,
    required: f.required,
    quick: f.quick,
  }))
  return { ...meta, fields }
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

/**
 * Register CRUD + metadata routes for a Business Object.
 *
 * Routes:
 * - GET  {prefix}           — paginated list
 * - GET  {prefix}/:param    — single item by paramField
 * - GET  /bo/{name}         — BO metadata (fields, compositions, valueHelps)
 * - POST {prefix}           — create
 * - PUT  {prefix}/:param    — update
 * - DELETE {prefix}/:param  — delete
 */
export function registerBoRoutes(app: FastifyInstance, db: Database, config: BoRouteConfig): void {
  const bo = config.bo
  const boMethods = bo as unknown as TypedBoMethods
  const viewDef = resolveView(config)
  const prefix = config.prefix ?? bo.routePrefix ?? `/bo/${bo.name}`
  const paramField = bo.paramField
  const tenantCol = config.tenantColumn ?? 'tenantId'
  const includeGlobal = config.includeGlobal ?? false
  const valueHelps = config.valueHelps ?? bo.valueHelps

  // Fetch a single row by paramField — used by detail + write-protection
  async function fetchByParam(paramValue: string, userId?: string): Promise<Record<string, unknown> | undefined> {
    let q = db.from(viewDef).where({ [paramField]: paramValue })
    if (userId) q = q.as(userId)
    const rows = await q.execute()
    return rows[0] as Record<string, unknown> | undefined
  }

  // Enforce global-record write protection (403 when tenantCol is null and includeGlobal is set)
  function assertNotGlobal(row: Record<string, unknown>, reply: FastifyReply): boolean {
    if (!includeGlobal) return true
    if (row[tenantCol] === null || row[tenantCol] === undefined) {
      reply.code(403)
      return false
    }
    return true
  }

  // GET list
  app.get(prefix, async (req: FastifyRequest) => {
    const ctx = await config.extractContext(req)
    const params = parseListParams(req.query as Record<string, unknown>)

    const baseWhere = ctx.tenantId
      ? buildTenantWhere(ctx.tenantId, tenantCol, includeGlobal)
      : undefined

    const result = await paginateView({
      db, view: viewDef, params, baseWhere, userId: ctx.userId,
    })

    // Enrich
    let items = result.items as Record<string, unknown>[]
    if (Object.keys(bo.compositions).length > 0) {
      items = await enrichCompositions(db, bo, items)
    }
    if (bo.transformItems) {
      items = await bo.transformItems(items, ctx.locale, db)
    }
    if (includeGlobal) {
      items = attachGlobalFlag(items, tenantCol)
    }

    return { items, total: result.total, page: result.page, limit: result.limit }
  })

  // GET single item
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
    if (includeGlobal) {
      items = attachGlobalFlag(items, tenantCol)
    }

    return items[0]
  })

  // GET metadata
  app.get(`/bo/${bo.name}`, () => transformBoMeta(boMeta(bo)))

  // Value help endpoints
  if (Object.keys(valueHelps).length > 0) {
    for (const [vhName, vh] of Object.entries(valueHelps)) {
      app.get(`/bo/${bo.name}/valueHelp/${vhName}`, async (req: FastifyRequest) => {
        const ctx = await config.extractContext(req)
        const params = parseListParams(req.query as Record<string, unknown>)

        // ViewDef has `source` as a TableDef; ValueHelpViewDef uses keyField/displayField
        if ('source' in vh && typeof vh.source === 'object') {
          const result = await paginateView({
            db, view: vh as ViewDef, params, userId: ctx.userId,
          })
          return { items: result.items, total: result.total, page: result.page, limit: result.limit }
        }

        // ValueHelpViewDef — plain SELECT of key, display
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

  // POST create
  if (bo.actions.create) {
    app.post(prefix, async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = await config.extractContext(req)
      const data = req.body as Record<string, unknown>
      const result = await boMethods.create(db, ctx, data)
      if (config.afterWrite) await config.afterWrite(ctx, 'create')
      reply.code(201)
      return result
    })
  }

  // PUT update
  if (bo.actions.update) {
    app.put(`${prefix}/:param`, async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = await config.extractContext(req)
      const paramValue = extractParam(req)

      if (includeGlobal) {
        const existing = await fetchByParam(paramValue, ctx.userId)
        if (!existing) {
          reply.code(404)
          return { error: 'Not found' }
        }
        if (!assertNotGlobal(existing, reply)) return { error: 'Global records are read-only' }
      }

      const data = { ...(req.body as Record<string, unknown>), [paramField]: paramValue }
      const result = await boMethods.update(db, ctx, data)
      if (config.afterWrite) await config.afterWrite(ctx, 'update')
      return result
    })
  }

  // DELETE
  if (bo.actions.delete) {
    app.delete(`${prefix}/:param`, async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = await config.extractContext(req)
      const paramValue = extractParam(req)

      if (includeGlobal) {
        const existing = await fetchByParam(paramValue, ctx.userId)
        if (!existing) {
          reply.code(404)
          return { error: 'Not found' }
        }
        if (!assertNotGlobal(existing, reply)) return { error: 'Global records are read-only' }
      }

      const result = await boMethods.delete(db, ctx, { [paramField]: paramValue })
      if (config.afterWrite) await config.afterWrite(ctx, 'delete')
      return result
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
