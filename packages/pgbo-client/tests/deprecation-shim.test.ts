import { describe, it, expect, vi, beforeAll } from 'vitest'

// Silence the deprecation warning during tests
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* noop */ })

beforeAll(() => { warnSpy.mockClear() })

describe('@pgbo/client deprecation shim', () => {
  it('re-exports createClient from @metadataui/client', async () => {
    const mod = await import('../src/index.js')
    expect(typeof mod.createClient).toBe('function')
  })

  it('aliases PgboClientError → MetadataUiClientError', async () => {
    const mod = await import('../src/index.js')
    const err = new mod.PgboClientError('x', 404, 'http://x', null)
    expect(err.name).toBe('MetadataUiClientError')
    expect(err.status).toBe(404)
  })

  it('re-exports URL builders', async () => {
    const mod = await import('../src/index.js')
    expect(mod.urlForProjection('http://api', 'warehouse')).toBe('http://api/bo/warehouse')
  })

  it('emits a deprecation warning at module load', () => {
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('@pgbo/client] DEPRECATED'),
    )
  })
})
