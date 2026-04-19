# CLI

pgbo includes a command-line tool for migration, status, and introspection.

## Setup

After building (`npm run build`), the CLI is available as `pgbo`:

```bash
npx pgbo --help
```

Or add to package.json scripts:

```json
{
  "scripts": {
    "db:migrate": "pgbo migrate --schema ./src/schema.ts",
    "db:status": "pgbo status"
  }
}
```

## Commands

### pgbo migrate

Apply schema migrations:

```bash
pgbo migrate --schema ./schema.ts --db postgresql://localhost:5432/mydb
```

1. Introspects the current database
2. Diffs against the schema definitions
3. Displays the operations to apply
4. Executes all DDL in a transaction

The schema file must export a `default` or named `schema` export of type `SchemaDefinitions`:

```typescript
// schema.ts
import type { SchemaDefinitions } from 'pgbo/migration'

export const schema: SchemaDefinitions = {
  domains: [...],
  enums: [...],
  tables: [...],
  views: [...],
}
```

### pgbo status

Show database schema summary and recent migration history:

```bash
pgbo status --db postgresql://localhost:5432/mydb
```

Output:
```
Database schema:
  Domains:  2
  Enums:    1
  Tables:   4
  Views:    2

Tables:
  warehouse (5 cols, 1 FKs, 2 indexes)
  product (4 cols, 0 FKs, 1 indexes)

Recent migrations:
  #1 — 2026-04-07T10:30:00.000Z (7 ops)
```

### pgbo introspect

Dump the full database schema as JSON:

```bash
pgbo introspect --db postgresql://localhost:5432/mydb
```

## Options

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--db` | `-d` | PostgreSQL connection string | `$DATABASE_URL` |
| `--schema` | `-s` | Path to schema definitions file | (required for migrate) |
| `--help` | `-h` | Show help message | |
