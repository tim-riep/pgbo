// The metadata-driven UI contract — pure types, no runtime.
//
// Any HTTP server that wants its forms/lists/dropdowns/actions to be auto-rendered
// by a metadata-driven UI returns these shapes from `/meta/{name}` and accepts
// the conventions described alongside. `@pgbo/fastify` is one implementation;
// other backends (Spring, Go, hand-rolled REST) can serve the same contract.

// --- Field metadata ---

export type FieldKind = 'text' | 'number' | 'date' | 'boolean' | 'slug' | 'relation' | 'translation'

export interface FilterOption {
  readonly value: string
  readonly label: string
}

/** Filter widget config emitted on `.filterable()` columns. */
export interface FilterMeta {
  readonly type: 'text' | 'date' | 'select' | 'relation'
  /** Absolute URL to the value-help endpoint (set by the server's metadata transform). */
  readonly endpoint?: string
  readonly valueField?: string
  readonly labelField?: string
  readonly options?: readonly FilterOption[]
}

/** Reference from a field to its value-help endpoint — drives metadata-driven dropdowns. */
export interface ValueHelpRef {
  /** Key under the BO's `valueHelps` map — the URL segment in `/bo/{name}/valueHelp/{key}`. */
  readonly name: string
  /** Column on the value-help view that holds the identifier (`.vh({ key })`). */
  readonly keyField: string
  /** Column on the value-help view that holds the human-readable label (`.vh({ display })`). */
  readonly displayField: string
  /** Absolute URL — populated by the server's projection-aware metadata transform. */
  readonly endpoint?: string
}

/** Internal field metadata — emitted by `boMeta()` / `viewMeta()` server-side before transformation. */
export interface FieldMeta {
  readonly key: string
  readonly kind: FieldKind
  readonly label: string | undefined
  readonly hidden: boolean
  readonly immutable: boolean
  readonly searchable: boolean
  readonly filterable: false | FilterMeta
  readonly valueHelp?: ValueHelpRef
  readonly inList: boolean
  readonly inForm: boolean
  readonly required: boolean
  readonly quick: boolean
  /**
   * System-managed timestamp marker (issue #61). Set when the column was
   * declared with `.systemCreatedAt()` / `.systemUpdatedAt()` (or via the
   * `systemTimestamps()` helper). Always paired with `inForm: false,
   * immutable: true`. Servers should auto-stamp `updatedAt` on writes
   * and strip these fields from incoming payloads.
   */
  readonly systemManaged?: 'createdAt' | 'updatedAt'
}

// --- Aggregate metadata ---

export interface AssociationMeta {
  readonly name: string
  readonly foreignKey: string
  readonly target?: string
}

export interface CompositionMeta {
  readonly name: string
  readonly fields: readonly string[]
}

export interface ValueHelpMeta {
  readonly name: string
  readonly fields: readonly FieldMeta[]
}

export interface ViewMeta {
  readonly name: string
  readonly fields: readonly FieldMeta[]
  readonly associations: readonly AssociationMeta[]
}

export interface BOMeta extends ViewMeta {
  readonly paramField: string
  readonly readOnly: boolean
  readonly compositions: readonly CompositionMeta[]
  readonly valueHelps: readonly ValueHelpMeta[]
  readonly orderBy?: string
  readonly orderDir?: 'asc' | 'desc'
  readonly cacheTags?: readonly string[]
}

// --- Public (post-transform) shapes — what the server returns at `/meta/:name` ---

/** Same as `FilterMeta` but `endpoint` is always the absolute URL. */
export interface PublicFilterMeta {
  readonly type: 'text' | 'date' | 'select' | 'relation'
  readonly endpoint?: string
  readonly valueField?: string
  readonly labelField?: string
  readonly options?: readonly FilterOption[]
}

/** Same as `ValueHelpRef` but `endpoint` is always set (absolute URL). */
export interface PublicValueHelpRef {
  readonly name: string
  readonly endpoint: string
  readonly keyField: string
  readonly displayField: string
}

/** Field metadata after the server's projection transform: `label` → `labelKey` (always set), endpoints absolute. */
export interface PublicFieldMeta {
  readonly key: string
  readonly kind: FieldKind
  readonly labelKey: string
  readonly hidden: boolean
  readonly immutable: boolean
  readonly searchable: boolean
  readonly filterable: false | PublicFilterMeta
  readonly valueHelp?: PublicValueHelpRef
  readonly inList: boolean
  readonly inForm: boolean
  readonly required: boolean
  readonly quick: boolean
  /** System-managed timestamp marker (issue #61). See `FieldMeta.systemManaged`. */
  readonly systemManaged?: 'createdAt' | 'updatedAt'
}

/** The shape returned by `GET /meta/{name}` — what frontends consume. */
export interface PublicBoMeta {
  readonly name: string
  readonly paramField: string
  readonly readOnly: boolean
  readonly fields: readonly PublicFieldMeta[]
  readonly associations: readonly AssociationMeta[]
  readonly compositions: readonly CompositionMeta[]
  readonly valueHelps: readonly { readonly name: string; readonly fields: readonly PublicFieldMeta[] }[]
  readonly orderBy?: string
  readonly orderDir?: 'asc' | 'desc'
  readonly cacheTags?: readonly string[]
}

// --- List query contract ---

export interface ListParams {
  readonly page: number
  readonly limit: number
  readonly search: string
  readonly sort: string | null
  readonly order: 'asc' | 'desc'
  readonly filters: Readonly<Record<string, string>>
  readonly locale: string
  readonly fields: readonly string[] | null
}

export interface PaginatedResult<T> {
  readonly items: readonly T[]
  readonly total: number
  readonly page: number
  readonly limit: number
}

// --- Custom action returns ---

/**
 * Server-side return shape for custom actions that emit binary data
 * (PDF / XLSX / CSV / images). Servers that implement this contract recognise
 * it and set the appropriate `Content-Type` + `Content-Disposition` headers.
 *
 * `data` is typed as `Uint8Array` so the contract stays platform-neutral
 * (Node `Buffer extends Uint8Array`, so server code passing a `Buffer` is
 * structurally compatible).
 */
export interface FileResponse {
  readonly data: Uint8Array
  /** MIME type, e.g. `'application/pdf'`. */
  readonly contentType: string
  /** Optional filename — triggers `Content-Disposition` header. */
  readonly filename?: string
  /** `false` (default) → `attachment`; `true` → `inline`. */
  readonly inline?: boolean
}

// --- Translation enrichment shape ---

export interface TranslationConfig {
  /** Loose `tableLike` — server-specific. Only here so server packages can re-use the type signature. */
  readonly table: { readonly name: string; readonly columns: Readonly<Record<string, unknown>> }
  readonly parentKey: string
  readonly fields: readonly string[]
}

export interface EnrichConfig {
  readonly translationTable: string
  readonly parentKey: string
  readonly idField: string
  readonly fields: readonly string[]
  readonly locale: string
  readonly fallbackLocale?: string
}
