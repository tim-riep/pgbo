import { describe, it, expect } from 'vitest'
import { table } from '../../src/schema/table.js'
import { text, integer } from '../../src/schema/types.js'
import { defineBO } from '../../src/bo/index.js'
import { boMeta } from '../../src/metadata/index.js'

const areaTable = table('area', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    sortOrder: integer().default(0),
  },
  primaryKey: ['id'],
})

describe('BOConfig list/search/filter metadata (issue 021)', () => {
  it('carries orderBy, orderDir, cacheTags', () => {
    const bo = defineBO(areaTable, {
      paramField: 'id',
      orderBy: 'sortOrder',
      orderDir: 'asc',
      cacheTags: ['area', 'navigation'],
    })

    expect(bo.orderBy).toBe('sortOrder')
    expect(bo.orderDir).toBe('asc')
    expect(bo.cacheTags).toEqual(['area', 'navigation'])
  })

  it('boMeta() includes orderBy/orderDir/cacheTags (URL prefix is locked, issue #44)', () => {
    const bo = defineBO(areaTable, {
      paramField: 'id',
      orderBy: 'sortOrder',
      orderDir: 'desc',
      cacheTags: ['area'],
    })

    const meta = boMeta(bo)
    expect(meta.orderBy).toBe('sortOrder')
    expect(meta.orderDir).toBe('desc')
    expect(meta.cacheTags).toEqual(['area'])
  })

  it('virtualFields are merged into boMeta fields', () => {
    const bo = defineBO(areaTable, {
      paramField: 'id',
      virtualFields: [
        { key: 'childCount', kind: 'number', label: 'crud.childCount' },
        { key: 'statusLabel', kind: 'text', searchable: true, inList: true, inForm: false },
      ],
    })

    const meta = boMeta(bo)
    const childCount = meta.fields.find(f => f.key === 'childCount')
    expect(childCount).toBeDefined()
    expect(childCount!.kind).toBe('number')
    expect(childCount!.label).toBe('crud.childCount')
    expect(childCount!.inForm).toBe(false)

    const statusLabel = meta.fields.find(f => f.key === 'statusLabel')
    expect(statusLabel).toBeDefined()
    expect(statusLabel!.searchable).toBe(true)
    expect(statusLabel!.inList).toBe(true)
  })

  it('virtualFields do not duplicate existing view fields', () => {
    const bo = defineBO(areaTable, {
      paramField: 'id',
      virtualFields: [
        { key: 'slug', kind: 'text' }, // already on areaTable
      ],
    })

    const meta = boMeta(bo)
    const slugFields = meta.fields.filter(f => f.key === 'slug')
    expect(slugFields).toHaveLength(1)
  })

  it('transformItems callback is stored on BO', () => {
    const transform = async (rows: Record<string, unknown>[]) => rows
    const bo = defineBO(areaTable, {
      paramField: 'id',
      transformItems: transform,
    })
    expect(bo.transformItems).toBe(transform)
  })

  it('optional fields default to undefined', () => {
    const bo = defineBO(areaTable, { paramField: 'id' })
    expect(bo.orderBy).toBeUndefined()
    expect(bo.cacheTags).toBeUndefined()
    expect(bo.virtualFields).toBeUndefined()
    expect(bo.transformItems).toBeUndefined()
  })
})
