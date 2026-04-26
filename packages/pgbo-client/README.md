# @pgbo/client — DEPRECATED

This package has been renamed to **[`@metadataui/client`](https://www.npmjs.com/package/@metadataui/client)** (issue #52). The contract it implements is independent of pgbo — it works with any HTTP server that speaks the metadata-driven UI contract — so the package now lives under a vendor-neutral namespace.

## Migration (one find-and-replace)

```diff
- import { createClient, PgboClientError } from '@pgbo/client'
+ import { createClient, MetadataUiClientError } from '@metadataui/client'
```

The API is identical. Only the package name and the error class name changed.

## What this version does

`@pgbo/client@0.3.0` re-exports everything from `@metadataui/client` and aliases `PgboClientError` to `MetadataUiClientError`. A one-time `console.warn` notes the deprecation. The next major will remove this package entirely.

## License

MIT
