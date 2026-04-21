import { describe, it, expect } from 'vitest'
import { memoryCache } from '../../src/query/cache.js'

describe('memoryCache', () => {
  it('set + get returns the value', async () => {
    const cache = memoryCache()
    await cache.set('k', { a: 1 }, ['tag'])
    expect(await cache.get('k')).toEqual({ a: 1 })
  })

  it('get returns undefined on miss', async () => {
    const cache = memoryCache()
    expect(await cache.get('missing')).toBeUndefined()
  })

  it('TTL expires entries', async () => {
    const cache = memoryCache()
    await cache.set('k', 'v', [], 0.05)  // 50ms
    expect(await cache.get('k')).toBe('v')
    await new Promise(r => setTimeout(r, 80))
    expect(await cache.get('k')).toBeUndefined()
  })

  it('defaultTtl applies when ttl not given', async () => {
    const cache = memoryCache({ defaultTtl: 0.05 })
    await cache.set('k', 'v', [])
    await new Promise(r => setTimeout(r, 80))
    expect(await cache.get('k')).toBeUndefined()
  })

  it('explicit ttl overrides default', async () => {
    const cache = memoryCache({ defaultTtl: 0.01 })
    await cache.set('k', 'v', [], 5)
    await new Promise(r => setTimeout(r, 50))
    expect(await cache.get('k')).toBe('v')
  })

  it('invalidateByTags evicts matching entries only', async () => {
    const cache = memoryCache()
    await cache.set('a', 1, ['users'])
    await cache.set('b', 2, ['users', 'admin'])
    await cache.set('c', 3, ['products'])
    await cache.invalidateByTags(['users'])
    expect(await cache.get('a')).toBeUndefined()
    expect(await cache.get('b')).toBeUndefined()
    expect(await cache.get('c')).toBe(3)
  })

  it('invalidateByTags with empty tags is a no-op', async () => {
    const cache = memoryCache()
    await cache.set('a', 1, ['users'])
    await cache.invalidateByTags([])
    expect(await cache.get('a')).toBe(1)
  })

  it('invalidateByKey evicts a single entry', async () => {
    const cache = memoryCache()
    await cache.set('a', 1, [])
    await cache.set('b', 2, [])
    await cache.invalidateByKey('a')
    expect(await cache.get('a')).toBeUndefined()
    expect(await cache.get('b')).toBe(2)
  })

  it('maxEntries evicts oldest on overflow', async () => {
    const cache = memoryCache({ maxEntries: 2 })
    await cache.set('a', 1, [])
    await cache.set('b', 2, [])
    await cache.set('c', 3, [])  // evicts 'a'
    expect(await cache.get('a')).toBeUndefined()
    expect(await cache.get('b')).toBe(2)
    expect(await cache.get('c')).toBe(3)
  })

  it('get refreshes LRU order', async () => {
    const cache = memoryCache({ maxEntries: 2 })
    await cache.set('a', 1, [])
    await cache.set('b', 2, [])
    await cache.get('a')              // 'a' becomes most-recently-used
    await cache.set('c', 3, [])       // evicts 'b' (now oldest)
    expect(await cache.get('a')).toBe(1)
    expect(await cache.get('b')).toBeUndefined()
    expect(await cache.get('c')).toBe(3)
  })

  it('clear removes everything', async () => {
    const cache = memoryCache()
    await cache.set('a', 1, [])
    await cache.set('b', 2, [])
    await cache.clear?.()
    expect(await cache.get('a')).toBeUndefined()
    expect(await cache.get('b')).toBeUndefined()
  })

  it('set on existing key replaces value and tags', async () => {
    const cache = memoryCache()
    await cache.set('k', 1, ['old'])
    await cache.set('k', 2, ['new'])
    expect(await cache.get('k')).toBe(2)
    await cache.invalidateByTags(['old'])
    expect(await cache.get('k')).toBe(2)  // old tag no longer applies
    await cache.invalidateByTags(['new'])
    expect(await cache.get('k')).toBeUndefined()
  })
})
