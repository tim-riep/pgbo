import { describe, it, expect } from 'vitest'
import {
  urlForProjection, urlForDetail, urlForAction, urlForValueHelp,
  urlForMeta, urlForView, urlForViewMeta, buildQueryString,
  formatCompositeKey, parseCompositeKey,
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

describe('formatCompositeKey', () => {
  it('formats string values with single quotes', () => {
    expect(formatCompositeKey({ slug: 'A1', warehouseSlug: 'WH-1' }))
      .toBe("(slug='A1',warehouseSlug='WH-1')")
  })

  it('emits numeric values bare', () => {
    expect(formatCompositeKey({ id: 42, slug: 'main' }))
      .toBe("(id=42,slug='main')")
  })

  it('doubles embedded single quotes inside string values', () => {
    expect(formatCompositeKey({ name: "O'Brien" }))
      .toBe("(name='O''Brien')")
  })

  it('URL-encodes reserved characters in string values', () => {
    expect(formatCompositeKey({ slug: 'foo bar&baz' }))
      .toBe("(slug='foo%20bar%26baz')")
  })

  it('throws on an empty key object', () => {
    expect(() => formatCompositeKey({})).toThrow(/at least one entry/)
  })
})

describe('parseCompositeKey', () => {
  it('parses string values', () => {
    expect(parseCompositeKey("(slug='A1',warehouseSlug='WH-1')"))
      .toEqual({ slug: 'A1', warehouseSlug: 'WH-1' })
  })

  it('parses numeric values as numbers', () => {
    expect(parseCompositeKey("(id=42,slug='main')"))
      .toEqual({ id: 42, slug: 'main' })
  })

  it('decodes doubled single quotes inside string values', () => {
    expect(parseCompositeKey("(name='O''Brien')"))
      .toEqual({ name: "O'Brien" })
  })

  it('decodes URL-encoded characters inside string values', () => {
    expect(parseCompositeKey("(slug='foo%20bar%26baz')"))
      .toEqual({ slug: 'foo bar&baz' })
  })

  it('round-trips through formatCompositeKey', () => {
    const original = { slug: 'A1', kind: "O'Brien", count: 7 }
    expect(parseCompositeKey(formatCompositeKey(original))).toEqual(original)
  })

  it('throws when the input is not wrapped in parens', () => {
    expect(() => parseCompositeKey("slug='A1'")).toThrow(/expected/)
  })

  it('throws on an empty body "()"', () => {
    expect(() => parseCompositeKey('()')).toThrow(/empty/)
  })

  it('throws when a part is missing "="', () => {
    expect(() => parseCompositeKey("(slug'A1')")).toThrow(/missing "="/)
  })

  it('throws when a bare value is not numeric', () => {
    expect(() => parseCompositeKey('(slug=abc)')).toThrow(/quoted string or a number/)
  })
})

describe('urlForDetail with composite keys', () => {
  const base = 'http://localhost:3000'

  it('uses OData-style key syntax for composite-key objects', () => {
    expect(urlForDetail(base, 'storageLocation', { slug: 'A1', warehouseSlug: 'WH-1' }))
      .toBe("http://localhost:3000/bo/storageLocation/(slug='A1',warehouseSlug='WH-1')")
  })

  it('encodes reserved characters inside composite-key values', () => {
    expect(urlForDetail(base, 'storageLocation', { slug: 'has space' }))
      .toBe("http://localhost:3000/bo/storageLocation/(slug='has%20space')")
  })
})
