# @pgbo/core

Type-safe PostgreSQL Business Objects — schema DSL, query builder, auto-migration, BO framework, metadata, validation, seeding, testing.

A TypeScript framework for PostgreSQL that enforces a clean three-layer architecture: **Tables → Views → Business Objects**. Application code never touches tables directly — all access flows through views.

## Install

```bash
npm install @pgbo/core
```

Optional peer dependency for validation:

```bash
npm install zod@4
```

## Quick start

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

## Documentation

Full documentation, architecture, and examples: <https://github.com/tim-riep/pgbo>

- [Architecture](https://github.com/tim-riep/pgbo/blob/main/docs/architecture.md)
- [Schema Definition](https://github.com/tim-riep/pgbo/blob/main/docs/schema.md)
- [Query Builder](https://github.com/tim-riep/pgbo/blob/main/docs/query.md)
- [Business Objects](https://github.com/tim-riep/pgbo/blob/main/docs/bo.md)
- [Migrations](https://github.com/tim-riep/pgbo/blob/main/docs/migration.md)

## Packages

- **`@pgbo/core`** — this package
- **`@pgbo/fastify`** — Fastify route factory for CRUD, metadata, value helps, pagination

## License

MIT © [Tim Riep](mailto:tim@riep-tech.de)
