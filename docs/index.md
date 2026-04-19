---
layout: home

hero:
  name: pgbo
  text: Type-safe PostgreSQL Business Objects
  tagline: Tables, views, domains, auto-migration, native i18n — built on PostgreSQL, with zero codegen.
  actions:
    - theme: brand
      text: Get Started
      link: /architecture
    - theme: alt
      text: View on GitHub
      link: https://github.com/tim-riep/pgbo

features:
  - title: Three-layer architecture
    details: Tables for storage, views for access, Business Objects for lifecycle. Application code only talks to views.
  - title: Type inference, no codegen
    details: InferRow, InferInsert, InferUpdate, InferViewRow derive TS types from your schema at compile time via generics.
  - title: PostgreSQL-native
    details: Domains, updatable views, materialized views, range types, JSONB, arrays, enums, INSTEAD OF triggers.
  - title: Auto-migration
    details: CLI introspects pg_catalog, diffs against your TypeScript definitions, executes migration plans transactionally.
  - title: Read-only by default
    details: BOs only allow writes when actions are explicitly defined. Compositions, associations, lifecycle hooks built in.
  - title: Framework adapters
    details: "@pgbo/core is framework-agnostic. @pgbo/fastify plugs into Fastify for CRUD routes, metadata, and pagination."
---

## Quick start

```bash
npm install @pgbo/core
```

```typescript
import { createDatabase } from '@pgbo/core'
import { table, view, text, integer } from '@pgbo/core/schema'

const warehouse = table('warehouse', {
  columns: {
    slug: text().notNull(),
    name: text().notNull(),
    capacity: integer().min(0),
  },
  primaryKey: ['slug'],
})

const warehouseView = view('warehouse_view').from(warehouse)

const db = createDatabase({ connectionString: 'postgresql://localhost/mydb' })
const rows = await db.from(warehouseView).execute()
```

## The three-layer model

```
┌─────────────────────────────────────────────────┐
│  Business Object (BO)                           │
│  Marks a view as a managed entity.              │
│  Owns CRUD lifecycle, permissions, hooks.       │
├─────────────────────────────────────────────────┤
│  View                                           │
│  PostgreSQL VIEW — the read/write interface.    │
│  Application code only talks to views.          │
├─────────────────────────────────────────────────┤
│  Table                                          │
│  PostgreSQL TABLE — pure data storage.          │
│  Never accessed directly by application code.   │
└─────────────────────────────────────────────────┘
```

Application code never touches tables directly. All reads and writes flow through views. Views become Business Objects when they need CRUD lifecycle, permissions, and hooks.

**Next steps** — read the [Architecture](/architecture) overview, then dive into [Schema Definition](/schema), [Query Builder](/query), or [Business Objects](/bo).

