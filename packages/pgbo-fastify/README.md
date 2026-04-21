# @pgbo/fastify

Fastify route factory for [`@pgbo/core`](https://www.npmjs.com/package/@pgbo/core) Business Objects. Registers CRUD endpoints, metadata, value helps, and paginated list routes with search/filter/sort built in.

## Install

```bash
npm install @pgbo/core @pgbo/fastify fastify
```

## Quick start

```typescript
import Fastify from 'fastify'
import { createDatabase } from '@pgbo/core'
import { registerBoRoutes } from '@pgbo/fastify'
import { warehouseBO, warehouseView } from './schema.js'

const app = Fastify()
const db = createDatabase({ connectionString: 'postgresql://localhost/mydb' })

registerBoRoutes(app, db, {
  bo: warehouseBO,
  view: warehouseView,
  extractContext: (req) => ({
    app,
    db,
    userId: req.headers['x-user-id'] as string,
    tenantId: req.headers['x-tenant-id'] as string,
    locale: 'en',
  }),
})

await app.listen({ port: 3000 })
```

## Features

- **GET** `{prefix}` — paginated list with search, filter, sort (multi-column ORDER BY supported)
- **GET** `{prefix}/:param` — single item with composition enrichment
- **GET** `/bo/{name}` — metadata with `labelKey` fallback
- **GET** `/bo/{name}/valueHelp/{vhName}` — dropdown data sources
- **POST / PUT / DELETE** — CRUD with action-based gating, afterWrite hooks, and global-record write protection
- **POST** `/bo/{name}/{actionName}` — auto-registered for every custom BO action
- **File / binary responses** — return a `FileResponse` from an action handler to send PDF/XLSX/CSV/etc. with proper `Content-Type` and `Content-Disposition`
- **`registerViewRoute`** — read-only paginated view endpoint

## Custom actions and file responses

Every non-standard action on a BO is auto-exposed as `POST /bo/{boName}/{actionName}`:

```typescript
import type { FileResponse } from '@pgbo/fastify'

export const documentBO = defineBO(documentTable, {
  actions: {
    create: {}, update: {}, delete: {},
    reverse: {
      handler: async (ctx, data) => reverseDocument(data.id),
    },
    pdf: {
      handler: async (ctx, data): Promise<FileResponse> => ({
        data: await renderPdf(data.id),
        contentType: 'application/pdf',
        filename: `${data.documentNumber}.pdf`,
        inline: true,
      }),
    },
  },
})
```

- Custom actions that return a value → JSON body, status 200
- Custom actions that return `undefined` / `null` → status 204 (no body)
- Custom actions that return `FileResponse` → binary body with `Content-Type` + `Content-Disposition` headers

Standard `create` / `update` / `delete` keep their existing REST routes and are NOT also exposed under `/{actionName}` — no duplication.

See the [full documentation](https://github.com/tim-riep/pgbo) for details.

## License

MIT © [Tim Riep](mailto:tim@riep-tech.de)
