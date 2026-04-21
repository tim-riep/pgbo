// Route factory configuration types

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Database } from '@pgbo/core'
import type { ViewDef, ValueHelpViewDef } from '@pgbo/core/schema'
import type { BusinessObjectDef } from '@pgbo/core/bo'

export interface RouteContext {
  readonly app: FastifyInstance
  readonly db: Database
  readonly tenantId?: string
  readonly userId?: string
  readonly locale: string
}

export interface BoRouteConfig {
  /** The BO definition */
  readonly bo: BusinessObjectDef
  /** The view to query (defaults to bo.root if it's a ViewDef) */
  readonly view?: ViewDef
  /** Route prefix override (defaults to bo.routePrefix or `/bo/${bo.name}`) */
  readonly prefix?: string
  /** Include global (tenant-less) rows alongside tenant-scoped rows */
  readonly includeGlobal?: boolean
  /** Tenant column name (default: 'tenantId') */
  readonly tenantColumn?: string
  /** Extract context from request — provides tenantId, userId, locale */
  readonly extractContext: (req: FastifyRequest) => RouteContext | Promise<RouteContext>
  /** Optional hook called after a successful create/update/delete — useful for cache invalidation */
  readonly afterWrite?: (ctx: RouteContext, action: 'create' | 'update' | 'delete') => void | Promise<void>
  /** Value help views keyed by name. Registers GET /bo/{name}/valueHelp/{vhName}. Defaults to bo.valueHelps */
  readonly valueHelps?: Readonly<Record<string, ViewDef | ValueHelpViewDef>>
}

/**
 * Return this shape from a custom BO action handler to send a binary response
 * (PDF, XLSX, CSV, etc.) instead of JSON.
 */
export interface FileResponse {
  readonly data: Buffer | Uint8Array
  /** MIME type, e.g. 'application/pdf' */
  readonly contentType: string
  /** Optional filename — triggers Content-Disposition header */
  readonly filename?: string
  /** `inline` (default false) serves the file for in-browser viewing; `attachment` forces download */
  readonly inline?: boolean
}

export interface ViewRouteConfig {
  /** The view to expose */
  readonly view: ViewDef
  /** Route prefix override (defaults to `/view/${view.name}`) */
  readonly prefix?: string
  /** Extract context from request */
  readonly extractContext: (req: FastifyRequest) => RouteContext | Promise<RouteContext>
}
