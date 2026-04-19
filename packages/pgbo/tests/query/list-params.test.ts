import { describe, it, expect } from 'vitest'
import { parseListParams } from '../../src/query/list.js'

describe('parseListParams (issue 024)', () => {
  it('defaults when empty query', () => {
    const p = parseListParams({})
    expect(p.page).toBe(1)
    expect(p.limit).toBe(25)
    expect(p.search).toBe('')
    expect(p.sort).toBeNull()
    expect(p.order).toBe('asc')
    expect(p.locale).toBe('en')
    expect(p.fields).toBeNull()
    expect(p.filters).toEqual({})
  })

  it('parses all standard keys', () => {
    const p = parseListParams({
      page: '3', limit: '10', search: ' hello ',
      sort: 'name', order: 'desc', locale: 'de',
      fields: 'slug,name,id',
    })
    expect(p.page).toBe(3)
    expect(p.limit).toBe(10)
    expect(p.search).toBe('hello')
    expect(p.sort).toBe('name')
    expect(p.order).toBe('desc')
    expect(p.locale).toBe('de')
    expect(p.fields).toEqual(['slug', 'name', 'id'])
  })

  it('extracts filter.* keys', () => {
    const p = parseListParams({
      'filter.status': 'ACTIVE',
      'filter.tenantId': 't1',
      'filter.empty': '',
    })
    expect(p.filters).toEqual({ status: 'ACTIVE', tenantId: 't1' })
    expect(p.filters['empty']).toBeUndefined() // empty string ignored
  })

  it('clamps page ≥ 1', () => {
    expect(parseListParams({ page: '0' }).page).toBe(1)
    expect(parseListParams({ page: '-5' }).page).toBe(1)
  })

  it('clamps limit between 1 and 250', () => {
    expect(parseListParams({ limit: '0' }).limit).toBe(1)
    expect(parseListParams({ limit: '999' }).limit).toBe(250)
  })

  it('handles numeric values (not just strings)', () => {
    const p = parseListParams({ page: 2, limit: 50 })
    expect(p.page).toBe(2)
    expect(p.limit).toBe(50)
  })

  it('invalid values fall back to defaults', () => {
    const p = parseListParams({ page: 'abc', limit: 'xyz' })
    expect(p.page).toBe(1)
    expect(p.limit).toBe(25)
  })

  it('order defaults to asc for non-desc values', () => {
    expect(parseListParams({ order: 'asc' }).order).toBe('asc')
    expect(parseListParams({ order: 'invalid' }).order).toBe('asc')
    expect(parseListParams({ order: 'desc' }).order).toBe('desc')
  })
})
