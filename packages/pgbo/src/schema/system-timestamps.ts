// System-managed timestamps shorthand (issue #61).
//
// Spread into a table's `columns` to add a conventional `createdAt` /
// `updatedAt` pair without re-declaring the same five chained calls per table.

import type { ColumnBuilder } from './definitions.js'
import { timestamp } from './types.js'

/**
 * Returns `{ createdAt, updatedAt }` columns with system-managed semantics:
 *
 * - DDL: `timestamptz NOT NULL DEFAULT now()`
 * - Metadata: `inForm: false, immutable: true` — auto-generated forms skip them
 * - BO update: `updatedAt` auto-stamps `now()` on every write
 * - `@pgbo/fastify`: stripped from incoming `POST` / `PUT` payloads
 *
 * ```ts
 * const apps = table('app', {
 *   columns: {
 *     slug: text().notNull(),
 *     name: text().notNull(),
 *     ...systemTimestamps(),
 *   },
 *   primaryKey: ['slug'],
 * })
 * ```
 */
export function systemTimestamps(): {
  createdAt: ColumnBuilder<Date, false, true>
  updatedAt: ColumnBuilder<Date, false, true>
} {
  return {
    createdAt: timestamp().withTimeZone().systemCreatedAt(),
    updatedAt: timestamp().withTimeZone().systemUpdatedAt(),
  }
}
