---
"@metadataui/spec": major
"@metadataui/client": major
"@pgbo/core": minor
"@pgbo/fastify": minor
"@pgbo/client": minor
---

Rebrand `@pgbo/client` → `@metadataui/*` (closes #52). The metadata-driven UI contract — URL conventions, response shapes, status-code semantics — is independent of pgbo, so it now lives under a vendor-neutral namespace. Other backends (Spring, Go, hand-rolled REST) can implement it without taking pgbo as a dependency.

### New packages

- **`@metadataui/spec@1.0.0`** — pure types + URL builders + status-code semantics. Zero runtime dependencies. Server-and-browser compatible. The contract.
- **`@metadataui/client@1.0.0`** — framework-agnostic HTTP client. Drop-in replacement for `@pgbo/client` (renamed `PgboClientError` → `MetadataUiClientError`; otherwise identical surface).

### Updated packages

- **`@pgbo/core`** — `metadata/types.ts` now re-exports from `@metadataui/spec`. `FieldKind` and `FilterOption` re-exported too. Adds `@metadataui/spec` as a dependency.
- **`@pgbo/fastify`** — `FileResponse` re-exports from `@metadataui/spec`. Adds `@metadataui/spec` as a dependency.

### Deprecated

- **`@pgbo/client`** — re-exports everything from `@metadataui/client` and aliases `PgboClientError → MetadataUiClientError`. Logs a one-time `console.warn` at module load. The next major will remove the package.

### Migration for apps

```diff
- import { createClient, PgboClientError } from '@pgbo/client'
+ import { createClient, MetadataUiClientError } from '@metadataui/client'
```

The runtime API is identical. Apps importing types from `@pgbo/core/metadata` keep working — those types are now re-exported from `@metadataui/spec` but the existing import paths still resolve.

### Why the rename

The contract is independent of postgres-BO. Keeping it under `@metadataui/*` makes that explicit and unblocks (a) other server frameworks implementing the contract without pgbo, and (b) frontends consuming the contract without knowing pgbo exists. `@pgbo/core` and `@pgbo/fastify` keep their existing surface — they're the easiest way to fulfil the contract, not the only way.
