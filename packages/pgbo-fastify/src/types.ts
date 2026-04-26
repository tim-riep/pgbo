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

// FileResponse is part of the metadata-driven UI contract — re-export from
// `@metadataui/spec` so any server implementation (and any client) sees the
// same shape.
export type { FileResponse } from '@metadataui/spec'

export interface ViewRouteConfig {
  /** The view to expose */
  readonly view: ViewDef
  /** Extract context from request */
  readonly extractContext: (req: FastifyRequest) => RouteContext | Promise<RouteContext>
  /** OpenAPI / Swagger schema generation (issue #38). */
  readonly swagger?: SwaggerConfig
}
