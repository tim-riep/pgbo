# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

pgbo is a type-safe PostgreSQL Business Objects library. It replaces Prisma with a three-layer architecture: **Tables** (storage) -> **Views** (read/write interface) -> **Business Objects** (managed entities with CRUD lifecycle). Application code never accesses tables directly — all access flows through views.

## Monorepo Structure

This is an npm workspaces monorepo with two packages:

- **`packages/pgbo`** — Core library: schema DSL, query builder, migrations, BO framework, metadata
- **`packages/pgbo-fastify`** — Fastify adapter: route factory for CRUD endpoints, pagination, metadata routes

## Commands

### Root (runs across all workspaces)
- **Build all:** `npm run build`
- **Type check all:** `npm run typecheck`
- **Test all:** `npm test`

### Per-package (run from package directory)
- **Build:** `npm run build` (runs `tsc`)
- **Type check:** `npm run typecheck` (runs `tsc --noEmit`)
- **Test all:** `npx vitest run`
- **Test single file:** `npx vitest tests/schema/column-types.test.ts`
- **Test with coverage:** `npm run test:coverage` (pgbo only)
- **Lint:** `npm run lint` (pgbo only)

## Architecture

### packages/pgbo — Module Layout

- **`src/schema/`** — TypeScript DSL for defining tables, views, domains, enums, constraints, and i18n. Column builders use a chainable API (`text().notNull().maxLength(100)`). Type inference flows at compile time via generics — no code generation.
- **`src/query/`** — Database client with transaction support. Defines the `Queryable` interface. Includes `parseListParams` and `PaginatedResult`.
- **`src/bo/`** — Business Object layer: `defineBO`, typed CRUD, `enrichCompositions` (nested children).
- **`src/metadata/`** — Annotation-based metadata: `viewMeta`, `boMeta`, `searchWhere`, `filterWhere`, `enrichItems`.
- **`src/migration/`** — Auto-migration engine: introspects `pg_catalog`, diffs against schema definitions, executes migration plans transactionally.
- **`src/validation/`** — Auto-generates Zod schemas from view definitions.
- **`src/seed/`** — Declarative seed system with optional extraction from demo systems.
- **`src/testing/`** — Test utilities (per-test database isolation).

### packages/pgbo-fastify — Module Layout

- **`src/routes.ts`** — `registerBoRoutes` (CRUD + metadata) and `registerViewRoute` (read-only pagination).
- **`src/helpers.ts`** — `paginateView`, `buildTenantWhere`.
- **`src/types.ts`** — `BoRouteConfig`, `ViewRouteConfig`, `RouteContext`.

### Key Design Decisions

- **Schema-as-code via builders, not raw SQL.** Column/table/view definitions are TypeScript objects with `.toSQL()` methods for DDL output.
- **Domains are semantic types** (e.g., `email`, `slug`, `locale_code`) with constraints. Single-column FKs auto-infer from `.references()`; composite FKs are explicit.
- **Views are the API boundary.** Simple views are auto-updatable; complex views get `INSTEAD OF` triggers.
- **BOs are read-only by default.** Actions (create, update, delete) must be explicitly defined with permission checks and hooks.
- **Type inference without codegen.** `InferRow<V>`, `InferInsert<V>`, `InferUpdate<V>` derive TS types from schema definitions.
- **Fastify adapter is a separate package.** Framework-specific code stays out of the core. pgbo provides primitives; pgbo-fastify wires them into routes.

## Development Approach

- TDD: tests are written first, then implementation. See `IMPLEMENTATION.md` for the phased plan.
- Tests live in `packages/*/tests/` with pattern `tests/**/*.test.ts`.
- File parallelism is disabled in vitest — each test gets its own database. Test timeout is 30s.
- ES modules (`"type": "module"`) with Node16 module resolution. Target ES2022.
- `noUncheckedIndexedAccess: true` is enabled in tsconfig — handle `undefined` on indexed access.
- pgbo-fastify depends on pgbo via npm workspace link. Build pgbo first before typechecking pgbo-fastify.
