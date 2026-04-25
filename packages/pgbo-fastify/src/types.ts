// Route factory configuration types

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Database } from '@pgbo/core'
import type { ViewDef } from '@pgbo/core/schema'
import type { ProjectionDef } from '@pgbo/core/bo'

export interface RouteContext {
  readonly app: FastifyInstance
  readonly db: Database
  readonly tenantId?: string
  readonly userId?: string
  readonly locale: string
}

export interface ProjectionRouteConfig {
  /** The projection — defines the HTTP surface (whitelist, columns, WHERE). */
  readonly projection: ProjectionDef
  /** The view to query (defaults to projection.bo.root if it's a ViewDef) */
  readonly view?: ViewDef
  /** Route prefix override (defaults to projection.bo.routePrefix or `/bo/${projection.name}`) */
  readonly prefix?: string
  /** Include global (tenant-less) rows alongside tenant-scoped rows */
  readonly includeGlobal?: boolean
  /** Tenant column name (default: 'tenantId') */
  readonly tenantColumn?: string
  /** Extract context from request — provides tenantId, userId, locale */
  readonly extractContext: (req: FastifyRequest) => RouteContext | Promise<RouteContext>
  /** Optional hook called after a successful create/update/delete — useful for cache invalidation */
  readonly afterWrite?: (ctx: RouteContext, action: 'create' | 'update' | 'delete') => void | Promise<void>
  /**
   * Value help views keyed by name. Registers `GET /bo/{projection.name}/valueHelp/{vhName}`.
   * Defaults to `projection.bo.valueHelps`.
   */
  readonly valueHelps?: Readonly<Record<string, ViewDef>>
  /**
   * OpenAPI / Swagger schema generation (issue #38). Populated by default so
   * apps with `@fastify/swagger` registered get a complete spec immediately.
   */
  readonly swagger?: SwaggerConfig
}

/** Per-projection control of generated OpenAPI schema (issue #38). */
export interface SwaggerConfig {
  /** Disable schema generation entirely. Default: true (on). */
  readonly enabled?: boolean
  /** Override the auto tag (defaults to projection.name). */
  readonly tag?: string
  /** Per-route description overrides. Custom action keys are accepted alongside the standard ones. */
  readonly descriptions?: Readonly<Record<string, string | undefined>>
  /**
   * Security scheme name advertised on routes whose view has `.restrict()`.
   * Default: 'bearerAuth'. Must match a scheme registered with `@fastify/swagger`
   * (e.g. via `securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }`).
   */
  readonly securityScheme?: string
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
  /** OpenAPI / Swagger schema generation (issue #38). */
  readonly swagger?: SwaggerConfig
}
