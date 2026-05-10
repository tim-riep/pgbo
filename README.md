# pgbo

Type-safe PostgreSQL Business Objects.

📚 **Documentation: <https://tim-riep.github.io/pgbo/>**

A TypeScript framework for PostgreSQL that enforces a clean three-layer architecture:

- **Tables** — pure storage with foreign keys. Never accessed directly by application code.
- **Views** — the only interface to the database. All reads and writes go through PostgreSQL views.
- **Business Objects** — a marker on a view that adds compositions, associations, actions, lifecycle hooks, and CRUD route generation.

## Packages

### Server

| Package | Description |
|---|---|
| [`@pgbo/core`](packages/pgbo) | Schema DSL, query builder, migrations, BO framework, metadata, validation, seeding, testing |
| [`@pgbo/fastify`](packages/pgbo-fastify) | Fastify route factory for CRUD, metadata, value helps, pagination |

### Metadata-driven UI contract

| Package | Description |
|---|---|
| [`@metadataui/spec`](packages/metadataui-spec) | The contract: types + URL builders + status-code semantics. Pure, zero runtime deps. Any HTTP server can implement it; any frontend can consume it. |
| [`@metadataui/client`](packages/metadataui-client) | Framework-agnostic HTTP client for the contract — URL composition, typed fetch, metadata cache, 401 retry. |

`@pgbo/core` + `@pgbo/fastify` are one implementation of the contract — the easiest one — but other backends (Spring, Go, hand-rolled REST) become valid implementations as long as they conform to `@metadataui/spec`.

## Install

```bash
# Server side
npm install @pgbo/core
npm install @pgbo/fastify    # if using Fastify

# Frontend
npm install @metadataui/client
```

> `@pgbo/client` is **deprecated** and renamed to `@metadataui/client`. Migrate with one find-and-replace; `@pgbo/client@0.3.0` is a thin re-export shim that prints a deprecation warning.

## Key concepts

- **Everything via TypeScript methods** — schema, views, domains, enums, annotations
- **PostgreSQL-native** — domains, updatable views, materialized views, range types, JSONB, arrays
- **Auto-migration** — CLI reads `pg_catalog`, diffs against definitions, generates DDL
- **Native i18n** — `translated('name')` on view fields, auto-generated translation tables
- **Zod validation** — auto-generated from view definitions
- **Seed system** — declarative seeds + extract from demo system
- **Read-only by default** — BOs only allow writes when actions are explicitly defined

## Documentation

Browse the full docs at **<https://tim-riep.github.io/pgbo/>**:

- [Architecture](https://tim-riep.github.io/pgbo/architecture) — the three-layer model and design principles
- [Schema Definition](https://tim-riep.github.io/pgbo/schema) — tables, columns, views, domains, enums
- [Query Builder](https://tim-riep.github.io/pgbo/query) — SELECT/INSERT/UPDATE/DELETE, caching, transactions
- [Business Objects](https://tim-riep.github.io/pgbo/bo) — `defineBO`, actions, compositions, associations
- [Migration Engine](https://tim-riep.github.io/pgbo/migration) — introspect, diff, migrate
- [`@pgbo/fastify`](https://tim-riep.github.io/pgbo/fastify) — route factory, OpenAPI, value helps, session params
- [`@metadataui/spec`](https://tim-riep.github.io/pgbo/metadataui-spec) — the contract
- [`@metadataui/client`](https://tim-riep.github.io/pgbo/metadataui-client) — HTTP client

Or read them directly in the repo under [`docs/`](docs/index.md).

## License

Released under the [MIT License](LICENSE). © 2026 Tim Riep <tim@riep-tech.de>
