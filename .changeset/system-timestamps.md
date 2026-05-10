---
"@pgbo/core": minor
"@metadataui/spec": minor
---

System-managed timestamps (closes #61).

A near-universal pattern: every entity has `createdAt` / `updatedAt`. Until now, declaring them as plain `timestamp().withTimeZone().notNull().defaultNow()` columns left them looking like any other writable field — `/meta/{name}` returned them with `inForm: true`, auto-generated forms rendered them as datetime inputs, and a naive client submission silently overwrote the timestamps. `updatedAt` also never advanced because the SQL DEFAULT only fires on INSERT.

### New API

`@pgbo/core/schema`:

- **`.systemCreatedAt()`** / **`.systemUpdatedAt()`** column-builder methods. Set `NOT NULL DEFAULT now()` and tag the column as system-managed.
- **`systemTimestamps()`** helper — returns a `{ createdAt, updatedAt }` pair ready to spread into a table's `columns`.

```ts
import { table, text, systemTimestamps } from '@pgbo/core/schema'

const apps = table('app', {
  columns: {
    slug: text().notNull(),
    name: text().notNull(),
    ...systemTimestamps(),
  },
  primaryKey: ['slug'],
})
```

`@metadataui/spec`:

- **`FieldMeta.systemManaged?: 'createdAt' | 'updatedAt'`** + same on `PublicFieldMeta`. Frontends use it to render audit timestamps differently from user-editable fields.

### Behaviour wired in

- **DDL**: `timestamptz NOT NULL DEFAULT now()`
- **Metadata**: `inForm: false, immutable: true, required: false` regardless of any other annotations on the column ref
- **BO `create`**: client-supplied values for system-managed columns are stripped before the `INSERT`; the table DEFAULT fills them
- **BO `update`**: client-supplied values are stripped, then every `updatedAt` column is auto-stamped with `now()` so the timestamp actually advances
- **`@pgbo/fastify`**: relies on the BO's strip — no separate work needed; payloads passing through `POST` / `PUT` to `bo.create` / `bo.update` get cleaned before SQL

### Backward compatibility

Purely additive — existing schemas that declare `createdAt`/`updatedAt` as regular columns keep working unchanged. The new behaviour only activates when you opt in via `.systemCreatedAt()` / `.systemUpdatedAt()` / `systemTimestamps()`.
