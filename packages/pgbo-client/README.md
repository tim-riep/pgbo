# @pgbo/client

Framework-agnostic HTTP client for [pgbo](https://github.com/tim-riep/pgbo). Wraps `fetch` with the things every pgbo frontend needs:

- URL composition (single source of truth for the `/bo/{name}` schema)
- Pagination unwrap
- Metadata cache
- 401 retry via configurable `refreshAuth`
- Locale + custom-header pass-through
- Re-exported types from `@pgbo/core` (so frontends never import the server package)

```ts
import { createClient } from '@pgbo/client'

const pgbo = createClient({
  baseUrl: 'http://localhost:3000',
  locale: () => 'en',
  getAuthHeader: () => `Bearer ${token}`,
})

await pgbo.list('warehouse', { search: 'main' })
await pgbo.create('warehouse', { name: 'X' })
await pgbo.action<Blob>('doc', 'pdf', { id: 1 }, { responseType: 'blob' })
const uoms = await pgbo.valueHelp('product', 'uom')
```

Full reference: https://tim-riep.github.io/pgbo/client

## License

MIT
