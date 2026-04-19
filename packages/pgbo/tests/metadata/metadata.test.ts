import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { table } from '../../src/schema/table.js'
import { view } from '../../src/schema/view.js'
import { col } from '../../src/schema/column.js'
import { valueHelpView } from '../../src/schema/view.js'
import { text, integer, timestamp, boolean } from '../../src/schema/types.js'
import { translated, configureI18n } from '../../src/schema/i18n.js'
import { defineBO } from '../../src/bo/index.js'
import { viewMeta, boMeta, searchWhere, filterWhere, enrichItems } from '../../src/metadata/index.js'
import { createTestDatabase, type TestDatabase } from '../../src/testing/database.js'

const connectionString = process.env['PGBO_TEST_URL'] ?? 'postgresql://localhost:5432/postgres'

configureI18n({ localeTable: 'locale', localeColumn: 'code', fallbackLocale: 'en' })

const areaTable = table('area', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    sortOrder: integer().default(0),
    active: boolean().default(true),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['id'],
  translations: ['name'],
})

const areaTranslationTable = table('area_translation', {
  columns: {
    areaId: integer().notNull(),
    locale: text().notNull(),
    name: text().notNull(),
  },
  primaryKey: ['areaId', 'locale'],
})

const warehouseVH = valueHelpView('warehouse_vh')
  .from(areaTable)
  .key('slug')
  .display('name')

const areaView = view('area_view').from(areaTable).columns({
  id: col('id').hidden().immutable(),
  slug: col('slug').label('area.slug').searchable().filterable().immutable(),
  sortOrder: col('sortOrder').label('area.sortOrder'),
  active: col('active').label('area.active').filterable(),
  name: translated('name'),
  warehouseSlug: col('slug').label('area.warehouse').filterable().filterType('relation').valueHelp(warehouseVH).quick(),
  createdAt: col('createdAt').label('area.createdAt').filterable(),
})

const plainView = view('plain_view').from(areaTable)

describe('Metadata: viewMeta (R1)', () => {
  it('returns correct fields with inferred kinds', () => {
    const meta = viewMeta(areaView)
    expect(meta.name).toBe('area_view')

    const slugField = meta.fields.find(f => f.key === 'slug')!
    expect(slugField.kind).toBe('slug')
    expect(slugField.label).toBe('area.slug')
    expect(slugField.searchable).toBe(true)
    expect(slugField.immutable).toBe(true)

    const sortField = meta.fields.find(f => f.key === 'sortOrder')!
    expect(sortField.kind).toBe('number')

    const activeField = meta.fields.find(f => f.key === 'active')!
    expect(activeField.kind).toBe('boolean')

    const createdField = meta.fields.find(f => f.key === 'createdAt')!
    expect(createdField.kind).toBe('date')
  })

  it('handles views without explicit columns', () => {
    const meta = viewMeta(plainView)
    expect(meta.fields.length).toBe(5) // id, slug, sortOrder, active, createdAt
    expect(meta.fields.find(f => f.key === 'id')!.kind).toBe('number')
  })

  it('expands filterable to { type } based on kind', () => {
    const meta = viewMeta(areaView)

    const slugField = meta.fields.find(f => f.key === 'slug')!
    expect(slugField.filterable).toEqual({ type: 'text' })

    const createdField = meta.fields.find(f => f.key === 'createdAt')!
    expect(createdField.filterable).toEqual({ type: 'date' })

    const whField = meta.fields.find(f => f.key === 'warehouseSlug')!
    expect(whField.filterable).toEqual({
      type: 'relation',
      endpoint: 'warehouse_vh',
      valueField: 'slug',
      labelField: 'name',
    })
    expect(whField.quick).toBe(true)
  })

  it('handles translated columns as kind: translation', () => {
    const meta = viewMeta(areaView)
    const nameField = meta.fields.find(f => f.key === 'name')!
    expect(nameField.kind).toBe('translation')
  })

  it('non-filterable fields get filterable: false', () => {
    const meta = viewMeta(areaView)
    const sortField = meta.fields.find(f => f.key === 'sortOrder')!
    expect(sortField.filterable).toBe(false)
  })

  it('hidden field is marked hidden: true', () => {
    const meta = viewMeta(areaView)
    const idField = meta.fields.find(f => f.key === 'id')!
    expect(idField.hidden).toBe(true)
  })
})

describe('Metadata: boMeta (R2)', () => {
  it('adds paramField, readOnly, compositions, valueHelps', () => {
    const areaBO = defineBO(areaTable, {
      paramField: 'id',
      actions: { create: {}, update: {}, delete: {} },
      compositions: {
        translations: { table: areaTranslationTable, parentKey: 'areaId' },
      },
    })

    const meta = boMeta(areaBO, {
      translations: { table: areaTranslationTable, parentKey: 'areaId', fields: ['name'] },
    })

    expect(meta.paramField).toBe('id')
    expect(meta.readOnly).toBe(false)
    expect(meta.compositions).toHaveLength(1)
    expect(meta.compositions[0]!.name).toBe('translations')

    // Translation field injected
    const nameField = meta.fields.find(f => f.key === 'name')
    expect(nameField).toBeDefined()
    expect(nameField!.kind).toBe('translation')
    expect(nameField!.searchable).toBe(true)
    expect(nameField!.filterable).toEqual({ type: 'text' })
  })

  it('read-only BO', () => {
    const readOnlyBO = defineBO(areaTable, {})
    const meta = boMeta(readOnlyBO)
    expect(meta.readOnly).toBe(true)
  })
})

describe('Metadata: searchWhere (R3)', () => {
  it('builds OR clause over searchable columns', () => {
    // areaView has 1 searchable column (slug), so no OR needed
    const result = searchWhere(areaView, 'test')
    expect(result.text).toContain('ILIKE')
    expect(result.text).toContain('slug')
    expect(result.values).toEqual(['%test%'])

    // View with 2 searchable columns → OR
    const multiView = view('multi_search').from(areaTable).columns({
      slug: col('slug').searchable(),
      active: col('active').searchable(),
    })
    const multi = searchWhere(multiView, 'abc')
    expect(multi.text).toContain('OR')
    expect(multi.values).toEqual(['%abc%', '%abc%'])
  })

  it('returns empty for views with no searchable columns', () => {
    const noSearchView = view('no_search').from(areaTable).columns({
      id: col('id'),
    })
    const result = searchWhere(noSearchView, 'test')
    expect(result.text).toBe('')
    expect(result.values).toEqual([])
  })
})

describe('Metadata: filterWhere (R3)', () => {
  it('only passes through filterable columns', () => {
    const result = filterWhere(areaView, {
      slug: 'admin',
      sortOrder: 5,      // not filterable
      active: true,       // filterable
      unknown: 'ignored', // not in view
    })
    expect(result).toEqual({ slug: 'admin', active: true })
    expect(result).not.toHaveProperty('sortOrder')
    expect(result).not.toHaveProperty('unknown')
  })
})

describe('Metadata: enrichItems (R4)', () => {
  let testDb: TestDatabase

  beforeAll(async () => {
    testDb = await createTestDatabase({
      connectionString,
      schema: [areaTable, areaTranslationTable],
      seed: [
        "INSERT INTO area (id, slug, sort_order) VALUES (1, 'north', 1), (2, 'south', 2)",
        "INSERT INTO area_translation (area_id, locale, name) VALUES (1, 'en', 'North Zone'), (1, 'de', 'Nordzone'), (2, 'en', 'South Zone')",
      ],
    })
  })

  afterAll(async () => {
    await testDb.dispose()
  })

  it('resolves translations with locale and fallback', async () => {
    const items = [
      { id: 1, slug: 'north', sortOrder: 1 },
      { id: 2, slug: 'south', sortOrder: 2 },
    ]

    const enriched = await enrichItems(testDb.db, items, {
      translationTable: 'area_translation',
      parentKey: 'areaId',
      idField: 'id',
      fields: ['name'],
      locale: 'de',
      fallbackLocale: 'en',
    })

    expect(enriched).toHaveLength(2)

    // North has 'de' translation
    expect(enriched[0]!.name).toBe('Nordzone')
    expect(enriched[0]!.translations).toHaveLength(2)

    // South falls back to 'en'
    expect(enriched[1]!.name).toBe('South Zone')
    expect(enriched[1]!.translations).toHaveLength(1)
  })
})
