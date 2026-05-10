// Annotation-based metadata system

import type { ViewDef, TableDef, ColumnRef, AnyColumnBuilder, FieldKind } from '../schema/definitions.js'

type MetaSource = ViewDef | TableDef

function isViewDef(source: MetaSource): source is ViewDef {
  return 'source' in source
}

function resolveTable(source: MetaSource): TableDef {
  return isViewDef(source) ? source.source : source as TableDef
}

function resolveSelectedColumns(source: MetaSource): Record<string, unknown> | undefined {
  return isViewDef(source) ? source.selectedColumns : undefined
}
import type { BusinessObjectDef } from '../bo/types.js'
import type { Queryable } from '../query/types.js'
import { isTranslatedRef } from '../schema/i18n.js'
import { toSnakeCase } from '../schema/table.js'
import { toCamelCase } from '../query/select.js'
import { getI18nConfig } from '../schema/i18n.js'
import type { FieldMeta, FilterMeta, ViewMeta, BOMeta, TranslationConfig, EnrichConfig, ValueHelpRef } from './types.js'

export type { FieldMeta, FilterMeta, ViewMeta, BOMeta, TranslationConfig, EnrichConfig, ValueHelpRef, AssociationMeta, CompositionMeta, ValueHelpMeta } from './types.js'
export type { FieldKind, FilterOption } from '../schema/definitions.js'

// --- Kind inference ---

const numericTypes = new Set(['integer', 'int4', 'serial', 'bigint', 'bigserial', 'numeric', 'real', 'double precision'])
const dateTypes = new Set(['timestamp', 'timestamptz', 'date'])

function inferKind(pgType: string, annotations: { immutable?: boolean; searchable?: boolean; label?: string; valueHelp?: ViewDef }): FieldKind {
  if (annotations.valueHelp) return 'relation'
  if (annotations.immutable && annotations.searchable && annotations.label?.includes('slug')) return 'slug'
  if (numericTypes.has(pgType)) return 'number'
  if (dateTypes.has(pgType)) return 'date'
  if (pgType === 'boolean') return 'boolean'
  return 'text'
}

function inferFilterMeta(kind: FieldKind, annotations: {
  filterType?: string
  filterOptions?: readonly { value: string; label: string }[]
  valueHelp?: ViewDef
}): FilterMeta {
  if (annotations.filterType) {
    const meta: FilterMeta = { type: annotations.filterType as FilterMeta['type'] }
    if (annotations.filterOptions) return { ...meta, options: annotations.filterOptions }
    const vh = annotations.valueHelp
    if (vh?.vhAnnotation) {
      return {
        ...meta,
        endpoint: vh.name,
        valueField: vh.vhAnnotation.key,
        labelField: vh.vhAnnotation.display,
      }
    }
    return meta
  }

  switch (kind) {
    case 'date': return { type: 'date' }
    case 'relation': {
      const vh = annotations.valueHelp
      if (vh?.vhAnnotation) {
        return {
          type: 'relation',
          endpoint: vh.name,
          valueField: vh.vhAnnotation.key,
          labelField: vh.vhAnnotation.display,
        }
      }
      return { type: 'relation' }
    }
    default: return { type: 'text' }
  }
}

/** Look up the ViewDef referenced by `.valueHelp(...)` on a column with the given output key. */
function findColumnValueHelpView(source: ViewDef | TableDef, fieldKey: string): ViewDef | undefined {
  if (!isViewDef(source)) return undefined
  const cols = source.selectedColumns
  if (!cols) return undefined
  const entry = cols[fieldKey] as { annotations?: { valueHelp?: ViewDef } } | undefined
  return entry?.annotations?.valueHelp
}

function buildFieldMeta(
  key: string,
  annotations: ColumnRef['annotations'],
  pgType: string,
  isTranslated: boolean,
  systemManaged?: 'createdAt' | 'updatedAt',
): FieldMeta {
  const kind: FieldKind = isTranslated
    ? 'translation'
    : annotations.kind ?? inferKind(pgType, annotations)

  const filterable = annotations.filterable
    ? inferFilterMeta(kind, annotations)
    : false

  // Surface the column-to-vh binding (issue #35) so metadata-driven forms can
  // render dropdowns automatically. `name` is set to the view name as a stand-in;
  // boMeta() rewrites it to the BO's `valueHelps` key (the URL segment Fastify uses).
  const vh = annotations.valueHelp
  const valueHelp: ValueHelpRef | undefined = vh?.vhAnnotation
    ? { name: vh.name, keyField: vh.vhAnnotation.key, displayField: vh.vhAnnotation.display }
    : undefined

  // System-managed timestamps (issue #61) are always immutable + form-hidden,
  // regardless of explicit annotations on the column ref.
  const isSystemManaged = systemManaged !== undefined

  return {
    key,
    kind,
    label: annotations.label,
    hidden: annotations.hidden ?? false,
    immutable: isSystemManaged ? true : (annotations.immutable ?? false),
    searchable: annotations.searchable ?? false,
    filterable,
    valueHelp,
    inList: annotations.inList ?? true,
    inForm: isSystemManaged ? false : (annotations.inForm ?? true),
    required: isSystemManaged ? false : (annotations.required ?? false),
    quick: annotations.quick ?? false,
    ...(systemManaged && { systemManaged }),
    // Issue #62 — surface the discriminator-aware visibility predicate so
    // metadata-driven forms can hide irrelevant fields based on form state.
    ...(annotations.visibleWhen && { visibleWhen: annotations.visibleWhen }),
  }
}

// --- R1: viewMeta ---

export function viewMeta(source: ViewDef | TableDef): ViewMeta {
  const fields: FieldMeta[] = []
  const sourceTable = resolveTable(source)
  const selectedColumns = resolveSelectedColumns(source)

  if (selectedColumns) {
    for (const [key, entry] of Object.entries(selectedColumns)) {
      if (isTranslatedRef(entry)) {
        fields.push(buildFieldMeta(key, {}, 'text', true))
      } else {
        const colRef = entry as ColumnRef
        // Resolve pgType from the source table (or joined table if specified)
        const resolvedTable = colRef.sourceTable ?? sourceTable
        const colBuilder = resolvedTable.columns[colRef.ref] as AnyColumnBuilder | undefined
        const pgType = colBuilder?._def.pgType ?? 'text'
        const systemManaged = colBuilder?._def.systemManaged
        fields.push(buildFieldMeta(key, colRef.annotations, pgType, false, systemManaged))
      }
    }
  } else {
    for (const [camelName, colBuilder] of Object.entries(sourceTable.columns)) {
      const pgType = (colBuilder)._def.pgType
      const systemManaged = (colBuilder)._def.systemManaged
      fields.push(buildFieldMeta(camelName, {}, pgType, false, systemManaged))
    }
  }

  const viewAssocs = isViewDef(source) ? source.viewAssociations ?? {} : {}
  const associations = Object.entries(viewAssocs).map(([name, assoc]) => ({
    name,
    foreignKey: assoc.foreignKey,
    target: assoc.target?.name,
  }))

  return { name: source.name, fields, associations }
}

// --- R2: boMeta ---

export function boMeta(
  bo: BusinessObjectDef,
  config?: { translations?: TranslationConfig },
): BOMeta {
  const base = viewMeta(bo.root)

  // Build a lookup so per-field valueHelp refs can use the BO's `valueHelps` key
  // (the URL segment Fastify routes use) instead of the underlying view name.
  // Same map drives `filterable.endpoint` rewriting below.
  const vhKeyByView = new Map<unknown, string>()
  for (const [vhKey, vhView] of Object.entries(bo.valueHelps)) {
    vhKeyByView.set(vhView, vhKey)
  }

  const fields = base.fields.map(f => {
    let next = f
    if (f.valueHelp) {
      // viewMeta sets valueHelp.name = view name; rewrite to BO key when it matches
      const annotatedView = findColumnValueHelpView(bo.root, f.key)
      const boKey = annotatedView ? vhKeyByView.get(annotatedView) : undefined
      if (boKey && boKey !== f.valueHelp.name) {
        next = { ...next, valueHelp: { ...f.valueHelp, name: boKey } }
      }
    }
    if (next.filterable && typeof next.filterable === 'object' && next.filterable.endpoint) {
      const annotatedView = findColumnValueHelpView(bo.root, f.key)
      const boKey = annotatedView ? vhKeyByView.get(annotatedView) : undefined
      if (boKey && boKey !== next.filterable.endpoint) {
        next = { ...next, filterable: { ...next.filterable, endpoint: boKey } }
      }
    }
    return next
  })

  // Inject translation fields
  if (config?.translations) {
    for (const field of config.translations.fields) {
      // Check if already present
      if (!fields.find(f => f.key === field)) {
        fields.push({
          key: field,
          kind: 'translation',
          label: undefined,
          hidden: false,
          immutable: false,
          searchable: true,
          filterable: { type: 'text' },
          inList: true,
          inForm: true,
          required: false,
          quick: false,
        })
      }
    }
  }

  // Inject virtual fields from BO config
  if (bo.virtualFields) {
    for (const vf of bo.virtualFields) {
      if (!fields.find(f => f.key === vf.key)) {
        fields.push({
          key: vf.key,
          kind: vf.kind,
          label: vf.label,
          hidden: false,
          immutable: false,
          searchable: vf.searchable ?? false,
          filterable: vf.filterable ? { type: 'text' } : false,
          inList: vf.inList ?? true,
          inForm: vf.inForm ?? false,
          required: false,
          quick: false,
        })
      }
    }
  }

  // Build compositions — supports both plain and link-through variants
  const compositions = Object.entries(bo.compositions).map(([name, comp]) => {
    if ('linkTable' in comp) {
      // Link-through: the exposed shape is the target's columns (narrowed if set)
      if (comp.columns && comp.columns.length > 0) return { name, fields: [...comp.columns] }
      const target = comp.target
      if ('source' in target) return { name, fields: Object.keys(target.source.columns) }
      if ('columns' in target) return { name, fields: Object.keys(target.columns) }
      // BO target — fall back to root's columns
      const root = (target as { root: ViewDef | TableDef }).root
      return {
        name,
        fields: 'source' in root ? Object.keys(root.source.columns) : Object.keys(root.columns),
      }
    }
    return {
      name,
      fields: comp.table
        ? Object.keys(comp.table.columns)
        : comp.view
          ? Object.keys(comp.view.source.columns)
          : [],
    }
  })

  // Build valueHelps from the BO's registered views (each is a ViewDef with .vh()).
  // `name` is the BO key — that's the URL segment Fastify routes use, and what
  // FieldMeta.valueHelp.name and filterable.endpoint reference (issue #35).
  const valueHelps = Object.entries(bo.valueHelps).map(([boKey, vhView]) => ({
    name: boKey,
    fields: viewMeta(vhView).fields,
  }))

  // Merge view associations with BO-level associations (BO wins on key collision)
  const associations = Object.entries(bo.associations).map(([name, assoc]) => ({
    name,
    foreignKey: assoc.foreignKey,
    target: assoc.target?.name,
  }))

  return {
    name: base.name,
    fields,
    associations,
    paramField: bo.paramField,
    readOnly: bo.isReadOnly,
    compositions,
    valueHelps,
    orderBy: bo.orderBy,
    orderDir: bo.orderDir,
    cacheTags: bo.cacheTags,
  }
}

// --- R3: searchWhere ---

export interface SearchWhereResult {
  readonly text: string
  readonly values: readonly unknown[]
}

export function searchWhere(viewDef: ViewDef, query: string): SearchWhereResult {
  const searchableKeys: string[] = []

  if (viewDef.selectedColumns) {
    for (const [key, entry] of Object.entries(viewDef.selectedColumns)) {
      if (isTranslatedRef(entry)) continue // translation search handled separately
      const colRef = entry as ColumnRef
      if (colRef.annotations.searchable) {
        searchableKeys.push(key)
      }
    }
  }

  if (searchableKeys.length === 0) {
    return { text: '', values: [] }
  }

  const pattern = `%${query}%`
  const clauses = searchableKeys.map((key, i) => `${toSnakeCase(key)} ILIKE $${i + 1}`)
  const values = searchableKeys.map(() => pattern)

  return {
    text: `(${clauses.join(' OR ')})`,
    values,
  }
}

// --- R3: filterWhere ---

export function filterWhere(viewDef: ViewDef, params: Record<string, unknown>): Record<string, unknown> {
  const filterableKeys = new Set<string>()

  if (viewDef.selectedColumns) {
    for (const [key, entry] of Object.entries(viewDef.selectedColumns)) {
      if (isTranslatedRef(entry)) continue
      const colRef = entry as ColumnRef
      if (colRef.annotations.filterable) {
        const effectiveKey = colRef.annotations.filterKey ?? key
        filterableKeys.add(effectiveKey)
      }
    }
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (filterableKeys.has(key)) {
      result[key] = value
    }
  }

  return result
}

// --- R4: enrichItems ---

export async function enrichItems<T extends Record<string, unknown>>(
  db: Queryable,
  items: readonly T[],
  config: EnrichConfig,
): Promise<(T & { translations?: Record<string, unknown>[] })[]> {
  if (items.length === 0) return []

  const i18nConfig = getI18nConfig()
  const fallback = config.fallbackLocale ?? i18nConfig.fallbackLocale

  // Extract parent IDs
  const ids = items.map(item => item[config.idField])

  // Single batch query
  const snakeParentKey = toSnakeCase(config.parentKey)
  const snakeFields = config.fields.map(toSnakeCase)
  const selectFields = [snakeParentKey, 'locale', ...snakeFields].join(', ')

  type TranslationRow = Record<string, unknown>
  const rows = await db.query<TranslationRow>(
    `SELECT ${selectFields} FROM ${config.translationTable} WHERE ${snakeParentKey} = ANY($1) ORDER BY ${snakeParentKey}, locale`,
    [ids],
  )

  // Group translations by parent ID
  const translationMap = new Map<unknown, TranslationRow[]>()
  for (const row of rows) {
    const parentId = row[snakeParentKey]
    const existing = translationMap.get(parentId)
    if (existing) {
      existing.push(row)
    } else {
      translationMap.set(parentId, [row])
    }
  }

  // Enrich each item
  return items.map(item => {
    const id = item[config.idField]
    const allTranslations = translationMap.get(id) ?? []

    // Convert to camelCase
    const translations = allTranslations.map(row => {
      const result: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        result[toCamelCase(k)] = v
      }
      return result
    })

    // Resolve fields for requested locale with fallback
    const localeRow = translations.find(t => t.locale === config.locale)
    const fallbackRow = translations.find(t => t.locale === fallback)

    const enriched: Record<string, unknown> = { ...item, translations }
    for (const field of config.fields) {
      enriched[field] = localeRow?.[field] ?? fallbackRow?.[field] ?? null
    }

    return enriched as T & { translations?: Record<string, unknown>[] }
  })
}
