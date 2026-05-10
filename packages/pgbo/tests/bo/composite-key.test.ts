// Unit tests for composite-key helpers + defineBO validation (issue #51).

import { describe, it, expect } from 'vitest'
import { table } from '../../src/schema/table.js'
import { text, integer } from '../../src/schema/types.js'
import { defineBO } from '../../src/bo/index.js'
import {
  paramFieldList, isComposite, keyToWhere, extractKey, keyHash, valueHash,
} from '../../src/bo/composite-key.js'
import { boMeta } from '../../src/metadata/index.js'

const storageLocation = table('storage_location', {
  columns: {
    warehouseSlug: text().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    capacity: integer(),
  },
  primaryKey: ['warehouse_slug', 'slug'],
})

describe('composite-key helpers', () => {
  describe('paramFieldList', () => {
    it('wraps a string in a single-element array', () => {
      expect(paramFieldList('id')).toEqual(['id'])
    })
    it('returns array as-is', () => {
      expect(paramFieldList(['warehouseSlug', 'slug'])).toEqual(['warehouseSlug', 'slug'])
    })
  })

  describe('isComposite', () => {
    it('false for a single string', () => {
      expect(isComposite('id')).toBe(false)
    })
    it('true for an array', () => {
      expect(isComposite(['a', 'b'])).toBe(true)
    })
  })

  describe('keyToWhere', () => {
    it('builds simple where from scalar', () => {
      expect(keyToWhere('slug', 'main')).toEqual({ slug: 'main' })
    })
    it('builds simple where from a single-entry record', () => {
      expect(keyToWhere('slug', { slug: 'main' })).toEqual({ slug: 'main' })
    })
    it('builds composite where from a record', () => {
      expect(keyToWhere(['warehouseSlug', 'slug'], { warehouseSlug: 'WH-1', slug: 'A1' }))
        .toEqual({ warehouseSlug: 'WH-1', slug: 'A1' })
    })
    it('throws when composite value is missing a key column', () => {
      expect(() => keyToWhere(['warehouseSlug', 'slug'], { slug: 'A1' }))
        .toThrow(/missing column "warehouseSlug"/)
    })
    it('throws when composite value is not an object', () => {
      expect(() => keyToWhere(['a', 'b'], 'scalar')).toThrow(/requires an object value/)
    })
  })

  describe('extractKey', () => {
    it('extracts scalar from row for simple key', () => {
      expect(extractKey('slug', { slug: 'main', name: 'Main' })).toBe('main')
    })
    it('extracts record from row for composite key', () => {
      expect(extractKey(['warehouseSlug', 'slug'], { warehouseSlug: 'WH-1', slug: 'A1', name: 'X' }))
        .toEqual({ warehouseSlug: 'WH-1', slug: 'A1' })
    })
  })

  describe('keyHash + valueHash', () => {
    it('matches for equivalent rows + values', () => {
      const row = { warehouseSlug: 'WH-1', slug: 'A1', name: 'X' }
      const value = { warehouseSlug: 'WH-1', slug: 'A1' }
      expect(keyHash(['warehouseSlug', 'slug'], row))
        .toBe(valueHash(['warehouseSlug', 'slug'], value))
    })
    it('differs when values differ', () => {
      const a = keyHash(['warehouseSlug', 'slug'], { warehouseSlug: 'WH-1', slug: 'A1' })
      const b = keyHash(['warehouseSlug', 'slug'], { warehouseSlug: 'WH-2', slug: 'A1' })
      expect(a).not.toBe(b)
    })
  })
})

describe('defineBO with composite paramField (issue #51)', () => {
  it('accepts an array of column names', () => {
    const bo = defineBO(storageLocation, {
      paramField: ['warehouseSlug', 'slug'],
      actions: { update: {}, delete: {} },
    })
    expect(bo.paramField).toEqual(['warehouseSlug', 'slug'])
  })

  it('throws when an array entry is not a real column', () => {
    expect(() => defineBO(storageLocation, {
      // @ts-expect-error — intentional invalid column for runtime check
      paramField: ['warehouseSlug', 'doesNotExist'],
    })).toThrow(/references column "doesNotExist" which does not exist/)
  })

  it('throws when paramField is an empty array', () => {
    expect(() => defineBO(storageLocation, {
      paramField: [] as never,
    })).toThrow(/empty array/)
  })

  it('boMeta emits paramField as the array', () => {
    const bo = defineBO(storageLocation, {
      paramField: ['warehouseSlug', 'slug'],
    })
    const meta = boMeta(bo)
    expect(meta.paramField).toEqual(['warehouseSlug', 'slug'])
  })

  it('defaults to "id" when omitted', () => {
    const tbl = table('with_id', {
      columns: { id: integer().notNull(), name: text().notNull() },
      primaryKey: ['id'],
    })
    const bo = defineBO(tbl, {})
    expect(bo.paramField).toBe('id')
  })
})
