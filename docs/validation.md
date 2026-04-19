# Validation

pgbo auto-generates [Zod 4](https://zod.dev) schemas from table definitions. No manual schema duplication.

## Setup

Zod is an optional peer dependency:

```bash
npm install zod@4
```

## Usage

```typescript
import { zodSchemas, zodToJsonSchema } from '@pgbo/core/validation'

const schemas = zodSchemas(warehouseTable)
```

Returns four schemas:

| Schema | Purpose |
|--------|---------|
| `schemas.row` | All columns typed, nullable columns get `.nullable()` |
| `schemas.insert` | Required fields for insert (nullable/default columns optional) |
| `schemas.update` | All fields optional |
| `schemas.partial` | Alias for update |

## Type Mapping

| Column Type | Zod Schema |
|------------|------------|
| `text()` | `z.string()` |
| `integer()` / `serial()` | `z.number().int()` |
| `numeric()` | `z.number()` |
| `boolean()` | `z.boolean()` |
| `uuid()` | `z.string().uuid()` |
| `timestamp()` | `z.date()` |
| `date()` / `time()` | `z.string()` |
| `jsonb()` | `z.unknown()` |

## Constraint Mapping

Column CHECK constraints are mapped to Zod refinements:

```typescript
// text().minLength(1).maxLength(100).pattern(/^[a-z]+$/)
// → z.string().min(1).max(100).regex(/^[a-z]+$/)

// integer().min(0).max(150)
// → z.number().int().min(0).max(150)

// numeric().positive()
// → z.number().min(Number.MIN_VALUE)
```

## Validation Example

```typescript
const { insert } = zodSchemas(warehouseTable)

// Valid
const data = insert.parse({ slug: 'main', name: 'Main' })

// Throws ZodError: missing required field 'name'
insert.parse({ slug: 'main' })

// Throws ZodError: slug too short
insert.parse({ slug: '', name: 'X' })
```

## JSON Schema

For OpenAPI / Fastify integration:

```typescript
const jsonSchema = zodToJsonSchema(schemas.row)
// { type: 'object', properties: { slug: { type: 'string' }, ... } }
```

`z.date()` columns are converted to `{ type: 'string', format: 'date-time' }` in JSON Schema output.
