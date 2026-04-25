import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createClient, PgboClientError } from '../src/index.js'

/** Minimal Response stub backed by a body + status. */
function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

function errorResponse(status: number, body: unknown = { error: 'oops' }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function blobResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': contentType },
  })
}

describe('createClient — request basics', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
  })

  it('list returns the paginated envelope', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [{ id: 1 }, { id: 2 }], total: 2, page: 1, limit: 25 }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    const res = await client.list('warehouse', { page: 1, limit: 25 })
    expect(res.items).toHaveLength(2)
    expect(res.total).toBe(2)
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api/bo/warehouse?page=1&limit=25')
  })

  it('detail issues GET to /bo/{name}/{paramValue}', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Main' }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    await client.detail('warehouse', 'main')
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api/bo/warehouse/main')
    expect(fetchMock.mock.calls[0]![1].method).toBe('GET')
  })

  it('create posts JSON body and returns the new row', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 99, name: 'X' }, { status: 201 }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    const res = await client.create('warehouse', { name: 'X' })
    expect(res).toEqual({ id: 99, name: 'X' })
    const call = fetchMock.mock.calls[0]!
    expect(call[1].method).toBe('POST')
    expect(call[1].body).toBe(JSON.stringify({ name: 'X' }))
    expect(call[1].headers['content-type']).toBe('application/json')
  })

  it('update + delete hit the correct verbs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Renamed' }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1 }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    await client.update('warehouse', 'main', { name: 'Renamed' })
    await client.delete('warehouse', 'main')
    expect(fetchMock.mock.calls[0]![1].method).toBe('PUT')
    expect(fetchMock.mock.calls[1]![1].method).toBe('DELETE')
  })

  it('throws PgboClientError on non-2xx with the parsed body attached', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(404, { error: 'Not found' }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    try {
      await client.detail('warehouse', 'x')
      throw new Error('should not reach here')
    } catch (e) {
      expect(e).toBeInstanceOf(PgboClientError)
      const err = e as PgboClientError
      expect(err.status).toBe(404)
      expect(err.url).toBe('http://api/bo/warehouse/x')
      expect(err.body).toEqual({ error: 'Not found' })
    }
  })
})

describe('createClient — meta cache', () => {
  it('caches the same projection name across calls', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ name: 'warehouse', fields: [], paramField: 'id', readOnly: false, associations: [], compositions: [], valueHelps: [] }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    const a = await client.meta('warehouse')
    const b = await client.meta('warehouse')
    expect(a).toBe(b)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('invalidateMeta(name) drops a single entry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ name: 'a', fields: [], paramField: 'id', readOnly: false, associations: [], compositions: [], valueHelps: [] }))
      .mockResolvedValueOnce(jsonResponse({ name: 'a', fields: [{ key: 'x' }], paramField: 'id', readOnly: false, associations: [], compositions: [], valueHelps: [] }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    await client.meta('a')
    client.invalidateMeta('a')
    const second = await client.meta('a')
    expect(second.fields).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('invalidateMeta() with no arg clears every entry', async () => {
    const body = { name: 'x', fields: [], paramField: 'id', readOnly: false, associations: [], compositions: [], valueHelps: [] }
    // Each call must produce a fresh Response — Response bodies are single-use
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(body)))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    await Promise.all([client.meta('a'), client.meta('b')])
    client.invalidateMeta()
    await Promise.all([client.meta('a'), client.meta('b')])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not cache failed fetches', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(jsonResponse({ name: 'x', fields: [], paramField: 'id', readOnly: false, associations: [], compositions: [], valueHelps: [] }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    await expect(client.meta('x')).rejects.toBeInstanceOf(PgboClientError)
    const second = await client.meta('x')
    expect(second.name).toBe('x')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('createClient — auth integration', () => {
  it('attaches Authorization from getAuthHeader', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 25 }))
    const client = createClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
      getAuthHeader: () => 'Bearer abc',
    })
    await client.list('w')
    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBe('Bearer abc')
  })

  it('retries once on 401 after refreshAuth', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(401))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 25 }))
    const refreshAuth = vi.fn().mockResolvedValue('Bearer fresh')
    const client = createClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
      getAuthHeader: () => 'Bearer stale',
      refreshAuth,
    })
    await client.list('w')
    expect(refreshAuth).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[1]![1].headers.authorization).toBe('Bearer fresh')
  })

  it('does not retry beyond a single attempt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errorResponse(401))
      .mockResolvedValueOnce(errorResponse(401))
    const client = createClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
      getAuthHeader: () => 'Bearer x',
      refreshAuth: () => Promise.resolve('Bearer y'),
    })
    await expect(client.list('w')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(2)  // initial + one retry, no more
  })
})

describe('createClient — locale', () => {
  it('appends ?locale= when config.locale is set and caller did not provide one', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 25 }))
    const client = createClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
      locale: () => 'de',
    })
    await client.list('w')
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api/bo/w?locale=de')
  })

  it('explicit query.locale wins over config.locale()', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 25 }))
    const client = createClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
      locale: () => 'de',
    })
    await client.list('w', { locale: 'fr' })
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api/bo/w?locale=fr')
  })
})

describe('createClient — value helps and view routes', () => {
  it('valueHelp unwraps items', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [{ slug: 'kg' }, { slug: 'm' }], total: 2, page: 1, limit: 25 }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    const rows = await client.valueHelp('product', 'uom')
    expect(rows).toEqual([{ slug: 'kg' }, { slug: 'm' }])
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api/bo/product/valueHelp/uom')
  })

  it('valueHelpPaged returns the full envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [{ slug: 'kg' }], total: 1, page: 2, limit: 10 }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    const res = await client.valueHelpPaged('product', 'uom', { page: 2, limit: 10 })
    expect(res.total).toBe(1)
    expect(res.page).toBe(2)
  })

  it('view route + view meta', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ a: 1 }], total: 1, page: 1, limit: 25 }))
      .mockResolvedValueOnce(jsonResponse({ name: 'v', fields: [] }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    expect(await client.view('warehouse_view')).toEqual([{ a: 1 }])
    expect(await client.viewMeta('warehouse_view')).toEqual({ name: 'v', fields: [] })
    expect(fetchMock.mock.calls[1]![0]).toBe('http://api/view/warehouse_view/meta')
  })
})

describe('createClient — actions', () => {
  it('action posts JSON and returns parsed JSON by default', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    const res = await client.action('doc', 'archive', { id: 1 })
    expect(res).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api/bo/doc/archive')
    expect(fetchMock.mock.calls[0]![1].body).toBe(JSON.stringify({ id: 1 }))
  })

  it('action with responseType:"blob" returns a Blob', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const fetchMock = vi.fn().mockResolvedValueOnce(blobResponse(bytes, 'application/pdf'))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    const res = await client.action<Record<string, unknown>, Blob>('doc', 'pdf', { id: 1 }, { responseType: 'blob' })
    expect(res).toBeInstanceOf(Blob)
    const buf = await res.arrayBuffer()
    expect(new Uint8Array(buf)).toEqual(bytes)
  })

  it('action with no body still issues a POST', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true }))
    const client = createClient({ baseUrl: 'http://api', fetch: fetchMock as unknown as typeof fetch })
    await client.action('doc', 'noop')
    const init = fetchMock.mock.calls[0]![1]
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })
})

describe('createClient — extra headers', () => {
  it('merges per-request headers from config.headers()', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [], total: 0, page: 1, limit: 25 }))
    const client = createClient({
      baseUrl: 'http://api',
      fetch: fetchMock as unknown as typeof fetch,
      headers: () => ({ 'x-tenant-id': 't1' }),
    })
    await client.list('w')
    expect(fetchMock.mock.calls[0]![1].headers['x-tenant-id']).toBe('t1')
  })
})
