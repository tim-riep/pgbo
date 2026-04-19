# pgbo

Type-safe PostgreSQL Business Objects.

A TypeScript framework for PostgreSQL that enforces a clean three-layer architecture:

- **Tables** — pure storage with foreign keys. Never accessed directly by application code.
- **Views** — the only interface to the database. All reads and writes go through PostgreSQL views.
- **Business Objects** — a marker on a view that adds compositions, associations, actions, lifecycle hooks, and CRUD route generation.

## Packages

- **[`pgbo`](packages/pgbo)** — core library: schema DSL, query builder, migrations, BO framework, metadata, validation, seeding, testing.
- **[`pgbo-fastify`](packages/pgbo-fastify)** — Fastify route factory for CRUD, metadata, value helps, pagination.

## Key concepts

- **Everything via TypeScript methods** — schema, views, domains, enums, annotations
- **PostgreSQL-native** — domains, updatable views, materialized views, range types, JSONB, arrays
- **Auto-migration** — CLI reads `pg_catalog`, diffs against definitions, generates DDL
- **Native i18n** — `translated('name')` on view fields, auto-generated translation tables
- **Zod validation** — auto-generated from view definitions
- **Seed system** — declarative seeds + extract from demo system
- **Read-only by default** — BOs only allow writes when actions are explicitly defined

## Documentation

See [`docs/`](docs/index.md) — including [`architecture.md`](docs/architecture.md), [`schema.md`](docs/schema.md), [`query.md`](docs/query.md), [`bo.md`](docs/bo.md), [`migration.md`](docs/migration.md), and more.

## License

Released under the [MIT License](LICENSE). © 2026 Tim Riep <tim@riep-tech.de>
