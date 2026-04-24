import { describe, it, expect } from 'vitest'
import { table } from '../../src/schema/table.js'
import { text, integer } from '../../src/schema/types.js'
import { defineBO } from '../../src/bo/index.js'
import { defineProjection, projectRow, projectionExposes } from '../../src/bo/projection.js'

const areaTable = table('area', {
  columns: {
    id: integer().notNull(),
    slug: text().notNull(),
    name: text().notNull(),
    internalNote: text(),
  },
  primaryKey: ['id'],
})

describe('defineProjection (issue #15)', () => {
  const areaBO = defineBO(areaTable, {
    paramField: 'id',
    actions: {
      create: {},
      update: {},
      delete: {},
      rebuildCache: { handler: () => ({ ok: true }) },
      internalExport: { handler: () => ({ secret: 42 }) },
    },
  })

  it('stores config on the ProjectionDef', () => {
    const p = defineProjection(areaBO, {
      name: 'areaPublic',
      actions: { read: true },
      columns: ['id', 'slug', 'name'],
      where: { slug: 'nav' },
    })
    expect(p.name).toBe('areaPublic')
    expect(p.bo).toBe(areaBO)
    expect(p.actions).toEqual({ read: true })
    expect(p.columns).toEqual(['id', 'slug', 'name'])
    expect(p.where).toEqual({ slug: 'nav' })
  })

  it('throws if a whitelisted action does not exist on the BO', () => {
    expect(() =>
      defineProjection(areaBO, {
        name: 'bad',
        actions: { nonexistent: true },
      }),
    ).toThrow(/whitelists action "nonexistent" but the underlying BO "area" has no such action/)
  })

  it('does NOT throw for the implicit "read" action', () => {
    expect(() =>
      defineProjection(areaBO, {
        name: 'readonly',
        actions: { read: true },
      }),
    ).not.toThrow()
  })

  it('throws when column does not exist on the root', () => {
    expect(() =>
      defineProjection(areaBO, {
        name: 'bad',
        actions: { read: true },
        columns: ['id', 'nonexistent'],
      }),
    ).toThrow(/references column "nonexistent" which does not exist/)
  })

  it('actions set to false are NOT in the whitelist (projectionExposes returns false)', () => {
    const p = defineProjection(areaBO, {
      name: 'p',
      actions: { read: true, create: false },
    })
    expect(projectionExposes(p, 'read')).toBe(true)
    expect(projectionExposes(p, 'create')).toBe(false)
    expect(projectionExposes(p, 'delete')).toBe(false)  // not mentioned
  })

  it('custom actions from the BO can be whitelisted', () => {
    const p = defineProjection(areaBO, {
      name: 'admin',
      actions: { read: true, rebuildCache: true },
    })
    expect(projectionExposes(p, 'rebuildCache')).toBe(true)
    expect(projectionExposes(p, 'internalExport')).toBe(false)  // not listed
  })

  describe('projectRow', () => {
    const p = defineProjection(areaBO, {
      name: 'p',
      actions: { read: true },
      columns: ['id', 'slug'],
    })

    it('returns only the projected columns', () => {
      const narrowed = projectRow(p, { id: 1, slug: 'nav', name: 'Navigation', internalNote: 'hidden' })
      expect(narrowed).toEqual({ id: 1, slug: 'nav' })
    })

    it('projection without columns returns a shallow clone', () => {
      const pAll = defineProjection(areaBO, { name: 'pAll', actions: { read: true } })
      const row = { id: 1, slug: 'nav', name: 'Navigation' }
      const result = projectRow(pAll, row)
      expect(result).toEqual(row)
      expect(result).not.toBe(row)  // clone, not reference
    })

    it('silently drops columns that are not on the input row', () => {
      const narrowed = projectRow(p, { id: 1 } as Record<string, unknown>)
      expect(narrowed).toEqual({ id: 1 })
    })
  })
})
