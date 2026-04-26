# @metadataui/spec

The metadata-driven UI contract — pure types, URL builders, and the conventions any HTTP server can implement to be auto-rendered by a metadata-driven frontend.

```ts
import type { PublicBoMeta, ListParams, FileResponse } from '@metadataui/spec'
import { urlForProjection, buildQueryString } from '@metadataui/spec'
```

## URL convention

```
GET    /bo/{name}                       list
GET    /bo/{name}/{paramValue}          detail
POST   /bo/{name}                       create
PUT    /bo/{name}/{paramValue}          update
DELETE /bo/{name}/{paramValue}          delete
GET    /meta/{name}                     metadata
GET    /bo/{name}/valueHelp/{vh}        value help
POST   /bo/{name}/{action}              custom action
GET    /view/{name}                     read-only view
GET    /view/{name}/meta                view metadata
```

## Implementations

- **Server**: [`@pgbo/fastify`](https://www.npmjs.com/package/@pgbo/fastify) — Fastify route factory backed by [`@pgbo/core`](https://www.npmjs.com/package/@pgbo/core)
- **Client**: [`@metadataui/client`](https://www.npmjs.com/package/@metadataui/client) — framework-agnostic HTTP client

Other backends (Spring, Go, hand-rolled REST) are valid implementations as long as they conform to this contract.

## License

MIT
