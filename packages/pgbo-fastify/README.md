# @pgbo/fastify

Fastify route factory for [`@pgbo/core`](https://www.npmjs.com/package/@pgbo/core) Business Objects. Routes are registered via **projections** — explicit whitelists that declare which actions, columns, and rows are reachable over HTTP.

## Install

```bash
npm install @pgbo/core @pgbo/fastify fastify
```

## Quick start

```typescript
import Fastify from 'fastify'
import { createDatabase } from '@pgbo/core'
import { defineProjection } from '@pgbo/core/bo'
import { registerProjection } from '@pgbo/fastify'
import { warehouseBO, warehouseView } from './schema.js'

const warehousePublic = defineProjection(warehouseBO, {
  name: 'warehouse',
  actions: { read: true, create: true, update: true, delete: true },
})

const app = Fastify()
const db = createDatabase({ connectionString: 'postgresql://localhost/mydb' })

registerProjection(app, db, {
  projection: warehousePublic,
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

- **Explicit action whitelist** — accidental exposure is impossible. An action is reachable only when named `true` in the projection.
- **Column narrowing** — responses and metadata return only projected columns
- **Root WHERE** — out-of-scope rows 404 even if they exist in the database
- **GET** `{prefix}` — paginated list with search, filter, multi-column sort
- **GET** `{prefix}/:param` — single item with composition enrichment
- **GET** `/bo/{projection}` — narrowed metadata with `labelKey` fallback
- **GET** `/bo/{projection}/valueHelp/{vhName}` — dropdown data sources
- **POST / PUT / DELETE** — when whitelisted; `afterWrite` hooks; global-record write protection
- **POST** `/bo/{projection}/{actionName}` — one route per whitelisted custom action
- **File / binary responses** — return a `FileResponse` from an action handler
- **`registerViewRoute`** — read-only paginated view endpoint (no projection)

## Projections

One BO, many tailored surfaces:

```typescript
import { defineProjection } from '@pgbo/core/bo'

// Public — read-only, only safe fields visible
const areaPublic = defineProjection(areaBO, {
  name: 'areaPublic',
  actions: { read: true },
  columns: ['id', 'slug', 'name'],
})

// Admin — full CRUD + one custom action; internalExport NOT whitelisted
const areaAdmin = defineProjection(areaBO, {
  name: 'areaAdmin',
  actions: { read: true, create: true, update: true, delete: true, rebuildCache: true },
})

// Published-only subset
const areaPublished = defineProjection(areaBO, {
  name: 'areaPublished',
  actions: { read: true, update: true },
  where: { status: 'PUBLISHED' },
})
```

All three can be registered on the same Fastify instance. The admin and public surfaces coexist without duplicating the BO definition.

## Custom actions and file responses

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

const documentProjection = defineProjection(documentBO, {
  name: 'document',
  actions: { read: true, create: true, reverse: true, pdf: true },
  // 'update' and 'delete' NOT whitelisted — even though they exist on the BO
})
```

- Custom action returning a value → JSON body, status 200
- Custom action returning `undefined` / `null` → status 204 (no body)
- Custom action returning `FileResponse` → binary body with `Content-Type` + `Content-Disposition`

Full documentation: **<https://tim-riep.github.io/pgbo/>**. Source and issues: <https://github.com/tim-riep/pgbo>.

## License

MIT © [Tim Riep](mailto:tim@riep-tech.de)
