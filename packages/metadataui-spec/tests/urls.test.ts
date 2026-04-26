import { describe, it, expect } from 'vitest'
import {
  urlForProjection, urlForDetail, urlForAction, urlForValueHelp,
  urlForMeta, urlForView, urlForViewMeta, buildQueryString,
} from '../src/urls.js'

describe('URL builders', () => {
  const base = 'http://localhost:3000'

  it('urlForProjection', () => {
    expect(urlForProjection(base, 'warehouse')).toBe('http://localhost:3000/bo/warehouse')
  })

  it('urlForDetail encodes the param value', () => {
    expect(urlForDetail(base, 'warehouse', 'main')).toBe('http://localhost:3000/bo/warehouse/main')
    expect(urlForDetail(base, 'warehouse', 'has space')).toBe('http://localhost:3000/bo/warehouse/has%20space')
    expect(urlForDetail(base, 'product', 42)).toBe('http://localhost:3000/bo/product/42')
  })

  it('urlForAction', () => {
    expect(urlForAction(base, 'doc', 'pdf')).toBe('http://localhost:3000/bo/doc/pdf')
  })

  it('urlForValueHelp', () => {
    expect(urlForValueHelp(base, 'product', 'uom')).toBe('http://localhost:3000/bo/product/valueHelp/uom')
  })

  it('urlForMeta', () => {
    expect(urlForMeta(base, 'warehouse')).toBe('http://localhost:3000/meta/warehouse')
  })

  it('urlForView + urlForViewMeta', () => {
    expect(urlForView(base, 'warehouse_view')).toBe('http://localhost:3000/view/warehouse_view')
    expect(urlForViewMeta(base, 'warehouse_view')).toBe('http://localhost:3000/view/warehouse_view/meta')
  })

  it('strips a single trailing slash from baseUrl', () => {
    expect(urlForProjection('http://x/', 'p')).toBe('http://x/bo/p')
    expect(urlForProjection('http://x', 'p')).toBe('http://x/bo/p')
  })
})

describe('buildQueryString', () => {
  it('returns empty string for no params', () => {
    expect(buildQueryString({})).toBe('')
    expect(buildQueryString({ a: undefined, b: null, c: '' })).toBe('')
  })

  it('encodes simple primitives', () => {
    expect(buildQueryString({ page: 2, limit: 25, search: 'foo' })).toBe('?page=2&limit=25&search=foo')
  })

  it('expands `filters` to filter.<col>=<val>', () => {
    expect(buildQueryString({ filters: { active: true, slug: 'main' } })).toBe('?filter.active=true&filter.slug=main')
  })

  it('joins arrays with comma', () => {
    expect(buildQueryString({ fields: ['id', 'slug', 'name'] })).toBe('?fields=id%2Cslug%2Cname')
  })

  it('skips undefined / null filter values', () => {
    expect(buildQueryString({ filters: { a: 'x', b: undefined, c: null, d: '' } })).toBe('?filter.a=x')
  })

  it('encodes special characters', () => {
    expect(buildQueryString({ search: 'foo bar&baz' })).toBe('?search=foo%20bar%26baz')
  })
})
