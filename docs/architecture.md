# Architecture

pgbo is built around a three-layer model: **Tables → Views → Business Objects**. Each layer has a single responsibility, and application code only ever talks to the top two.

## The three layers

```
┌──────────────────────────────────────────────────┐
│  Business Object (BO)                            │
│  Marks a view as a managed entity.               │
│  Compositions (owned children), associations,    │
│  actions (create/update/delete/custom), hooks.   │
├──────────────────────────────────────────────────┤
│  View                                            │
│  PostgreSQL VIEW — the read/write interface.     │
│  Simple (1 table) or joined across multiple.     │
│  Every table has at least one view.              │
│  Application code only talks to views.           │
├──────────────────────────────────────────────────┤
│  Table                                           │
│  PostgreSQL TABLE — pure storage.                │
│  Owns columns, PKs, FKs, indexes, constraints.   │
│  Never accessed directly by application code.    │
└──────────────────────────────────────────────────┘
```

### Tables
Physical storage: columns, primary keys, foreign keys, indexes, check constraints. FK references auto-infer from domains for single-column keys; composite FKs are declared explicitly on the table.

### Views
The only boundary between application code and the database. Simple views are auto-updatable in PostgreSQL; complex views use `INSTEAD OF` triggers. Runtime `.join()` is available when a pre-defined view isn't enough.

### Business Objects
A BO is a marker on a view that elevates it to a managed entity:

- **Compositions** — child entities that live and die with the parent (`warehouse → warehouseTranslation`). On create, children are inserted alongside the parent; on delete, PG FK cascades handle cleanup.
- **Associations** — references to independently-owned entities (`warehouseProduct.baseUomSlug → unitOfMeasure`).
- **Actions** — `create`, `update`, `delete`, or custom (e.g. `post`, `reverse`, `approve`). Each action has permission checks and before/after hooks.
- **Value helps** — dropdown sources linked to a BO.

BOs are **read-only by default**. Actions must be explicitly declared to enable writes. Without actions, a BO only serves `GET` (list + detail + metadata).

## Core principles

1. **PostgreSQL-native.** Domains, updatable views, materialized views, ranges, JSONB, arrays, enums, partial indexes, generated columns.
2. **Schema as code.** Everything is defined via TypeScript methods — no DSL files, no separate schema language.
3. **Views are the API boundary.** Application code never touches tables. The internal `db._table.*` API exists solely for BO write handlers, seeds, and test setup.
4. **Read-only by default.** A plain view is readable; writes require explicit actions on a BO.
5. **Type inference without codegen.** `InferRow<V>`, `InferInsert<V>`, `InferUpdate<V>`, `InferViewRow<V>` derive TS types from schema definitions at compile time via generics.
6. **Auto-migration.** `pgbo migrate` reads `pg_catalog`, diffs against your TypeScript definitions, and executes a transactional migration plan.
7. **camelCase ↔ snake_case conversion** happens automatically. Column names are `camelCase` in TS; DDL and SQL use `snake_case`.
8. **Framework adapters are separate packages.** The core (`pgbo`) provides primitives; `pgbo-fastify` wires them into HTTP routes.

## Type inference, no codegen

Types flow from schema definitions via TypeScript generics. There is no code-generation step, no watcher, no build artifact checked into the repo.

```ts
const warehouse = table('warehouse', {
  columns: {
    slug: text().notNull(),
    name: text().notNull(),
    capacity: integer(),
  },
  primaryKey: ['slug'],
})

type Row = InferRow<typeof warehouse>
// { slug: string; name: string; capacity: number | null }

type Insert = InferInsert<typeof warehouse>
// { slug: string; name: string; capacity?: number | null }
```

Views carry their row type through joined columns too — `col('slug', appTable)` preserves the type from the joined table's column. For edge cases there's an `as<T>()` escape hatch.

## Auto-migration

pgbo reads the PostgreSQL system catalog (`pg_class`, `pg_attribute`, `pg_constraint`, `pg_index`), diffs against your schema definitions, and produces a migration plan. The plan runs inside a single transaction — if anything fails, the whole migration rolls back.

Migration order respects FK dependencies: referenced tables are created first, dependent tables second. Drops happen in reverse. Index renames are handled gracefully (no recreate-from-scratch).

## Auth

Views carry declarative `restrict({ grant, to, where? })` annotations. pgbo doesn't interpret the `to` or `where` fields — the consuming app registers a pluggable `authHandler` that receives the restriction and makes the access decision. `.noAuth()` opts a view out entirely (e.g. value helps).

## Package layout

- **`packages/pgbo`** — schema DSL, query builder, migrations, BO framework, metadata, validation, seeding, testing.
- **`packages/pgbo-fastify`** — Fastify route factory for CRUD, metadata, value helps, pagination.

Framework-specific code stays out of the core. An adapter for another framework would live in its own package and depend on `pgbo` the same way.

## What `pgbo` intentionally is not

- **Not an ORM.** There are no model classes, no lazy-loading, no dirty tracking. The three-layer model replaces the ORM pattern.
- **Not a migration history tool.** No ordered migration files, no `up/down` scripts. The schema definitions ARE the source of truth; migrations are derived by diffing.
- **Not framework-coupled.** The core has zero HTTP-framework dependencies.
- **Not a raw SQL library.** `db.raw\`…\`` exists as an escape hatch, but the goal is that you rarely need it.
