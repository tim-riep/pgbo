# pgbo Documentation

Type-safe PostgreSQL Business Objects — tables, views, domains, auto-migration, native i18n.

## Architecture

pgbo is built around a three-layer abstraction:

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

**Key principle:** Application code never touches tables directly. All reads and writes flow through views. Views become Business Objects when they need CRUD lifecycle, permissions, and hooks.

## Installation

```bash
npm install @pgbo/core
```

Optional peer dependency for validation:

```bash
npm install zod@4
```

## Quick Start

```typescript
import { createDatabase } from '@pgbo/core'
import { table, view, text, integer, timestamp, index } from '@pgbo/core/schema'
import { introspect, diff, migrate } from '@pgbo/core/migration'

// 1. Define tables
const warehouseTable = table('warehouse', {
  columns: {
    slug: text().notNull(),
    name: text().notNull(),
    capacity: integer().min(0),
    createdAt: timestamp().withTimeZone().defaultNow(),
  },
  primaryKey: ['slug'],
  indexes: [index('name')],
})

// 2. Define views (the application interface)
const warehouseView = view('warehouse_view').from(warehouseTable)

// 3. Connect and migrate
const db = createDatabase({ connectionString: 'postgresql://localhost:5432/mydb' })
const snapshot = await introspect(db)
const plan = diff(
  { domains: [], enums: [], tables: [warehouseTable], views: [warehouseView] },
  snapshot,
)
await migrate(db, plan)

// 4. Query through views
const warehouses = await db.from(warehouseView).execute()
await db.into(warehouseView).values({ slug: 'main', name: 'Main' }).execute()

await db.close()
```

## Table of Contents

- [Architecture](architecture.md) — The three-layer model, design principles, package layout
- [Schema Definition](schema.md) — Tables, columns, domains, enums, constraints, views
- [Query Builder](query.md) — SELECT, INSERT, UPDATE, DELETE, transactions, raw SQL
- [Migration Engine](migration.md) — Introspect, diff, migrate
- [Business Objects](bo.md) — defineBO, actions, compositions
- [Validation](validation.md) — Zod schema generation
- [Seed System](seed.md) — Declarative seeding with upsert and FK ordering
- [Metadata](metadata.md) — viewMeta, boMeta, searchWhere, filterWhere, enrichItems
- [Testing](testing.md) — Disposable test databases, fixtures, assertions
- [CLI](cli.md) — Command-line tools
- [i18n](i18n.md) — Native translation support
