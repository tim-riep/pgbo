# @metadataui/client

Framework-agnostic HTTP client for the [metadata-driven UI contract](https://www.npmjs.com/package/@metadataui/spec). Wraps `fetch` with the things every metadata-driven frontend needs:

- URL composition (single source of truth via [`@metadataui/spec`](https://www.npmjs.com/package/@metadataui/spec))
- Pagination unwrap
- Metadata cache
- 401 retry via configurable `refreshAuth`
- Locale + custom-header pass-through
- Re-exported types from `@metadataui/spec` (single import path)

```ts
import { createClient } from '@metadataui/client'

const api = createClient({
  baseUrl: 'http://localhost:3000',
  locale: () => 'en',
  getAuthHeader: () => `Bearer ${token}`,
})

await api.list('warehouse', { search: 'main' })
await api.create('warehouse', { name: 'X' })
await api.action<Blob>('doc', 'pdf', { id: 1 }, { responseType: 'blob' })
const uoms = await api.valueHelp('product', 'uom')
```

Compatible with any HTTP server that implements the contract — including [`@pgbo/fastify`](https://www.npmjs.com/package/@pgbo/fastify).

This package replaces the deprecated `@pgbo/client`. Migration is one find-and-replace: swap the import path and rename `PgboClientError` → `MetadataUiClientError`.

Full reference: https://tim-riep.github.io/pgbo/client

## License

MIT
