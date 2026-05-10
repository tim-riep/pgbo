# @metadataui/spec

## 1.1.0

### Minor Changes

- 1f804c1: First-class composite-key support across the metadata-driven UI contract (closes #51).

  A BO whose primary key spans multiple columns (e.g. `(warehouseSlug, slug)`) can now be defined, served, and consumed end-to-end without per-app workarounds.

  ### What's new

  1. **`BOMeta.paramField` widened to `string | readonly string[]`** in `@metadataui/spec`. Single string for the common case (`'id'`, `'slug'`); a tuple of column names for composite keys.

  2. **`urlForDetail` accepts composite-key objects** — `urlForDetail(base, 'storageLocation', { warehouseSlug: 'WH-1', slug: 'A1' })` produces `/bo/storageLocation/(warehouseSlug='WH-1',slug='A1')` (OData-style segment).

  3. **`formatCompositeKey` / `parseCompositeKey` helpers** in `@metadataui/spec` for round-tripping the OData segment. String values are single-quoted with embedded `'` doubled (`O''Brien`) and URL-encoded; numeric values are emitted bare.

  4. **`defineBO({ paramField: ['warehouseSlug', 'slug'] })`** is type-checked and validated at definition time — every entry must be a real column on the root, and the array can't be empty.

  5. **Fastify routes parse `:param` automatically** — when the BO uses a composite key the handler detects the leading `(` and decodes the segment via `parseCompositeKey`, builds the WHERE clause via `keyToWhere`, and feeds the right object into `bo.update` / `bo.delete`.

  6. **OpenAPI schemas widen accordingly** — the `:param` schema describes the OData syntax, and the `/meta` response permits both the string and array forms of `paramField`.

  ### Out of scope for this change

  - **Composite-key targets in associations / link-table compositions** — these throw a clear error directing you to flatten the target's key. Single-column associations from a composite-key BO still work fine.
  - **Compositions hanging off a composite-key parent** use the first key column as the parent join column. Multi-column joins are uncommon and would need a richer composition definition.

  ### Backward compatibility

  - Single-string `paramField` keeps working unchanged — the contract widens but doesn't break existing consumers.
  - The `parseCompositeKey` helper is the only new runtime symbol clients need; existing `urlForDetail(base, name, 'main')` calls keep their behaviour.

- ce7b65e: System-managed timestamps (closes #61).

  A near-universal pattern: every entity has `createdAt` / `updatedAt`. Until now, declaring them as plain `timestamp().withTimeZone().notNull().defaultNow()` columns left them looking like any other writable field — `/meta/{name}` returned them with `inForm: true`, auto-generated forms rendered them as datetime inputs, and a naive client submission silently overwrote the timestamps. `updatedAt` also never advanced because the SQL DEFAULT only fires on INSERT.

  ### New API

  `@pgbo/core/schema`:

  - **`.systemCreatedAt()`** / **`.systemUpdatedAt()`** column-builder methods. Set `NOT NULL DEFAULT now()` and tag the column as system-managed.
  - **`systemTimestamps()`** helper — returns a `{ createdAt, updatedAt }` pair ready to spread into a table's `columns`.

  ```ts
  import { table, text, systemTimestamps } from "@pgbo/core/schema";

  const apps = table("app", {
    columns: {
      slug: text().notNull(),
      name: text().notNull(),
      ...systemTimestamps(),
    },
    primaryKey: ["slug"],
  });
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

- 77c99d6: Discriminator-aware field visibility via `.visibleWhen()` (closes #62).

  Polymorphic tables typically have one discriminator column (`kind`, `type`, `status`) and other columns that only apply to specific values of it. Until now, `/meta/{name}` returned every field with the same `inForm: true`, with no signal that some are conditional — every metadata-driven UI had to hard-code per-table dispatch logic.

  ### New API

  `@pgbo/core/schema`:

  - **`col(...).visibleWhen(predicate)`** column annotation. Three predicate shapes:

    | Shape                                    | Semantics         |
    | ---------------------------------------- | ----------------- |
    | `{ kind: 'iframe' }`                     | Equality          |
    | `{ kind: ['iframe', 'esm_upload'] }`     | OR over the array |
    | `{ kind: 'iframe', requiresAuth: true }` | AND across keys   |

    Throws on empty predicates so accidentally-empty calls fail at definition time.

  `@metadataui/spec`:

  - **`VisibleWhen`** type — `Readonly<Record<string, unknown | readonly unknown[]>>`.
  - **`FieldMeta.visibleWhen?: VisibleWhen`** + same on `PublicFieldMeta`. Frontends evaluate it against the current form state on every change to show/hide the field.

  ### Example

  ```ts
  const appView = view("app_view")
    .from(apps)
    .columns({
      slug: col("slug").required().immutable(),
      kind: col("kind").required(), // discriminator
      name: col("name").required(),
      version: col("version").required().visibleWhen({ kind: "esm_upload" }),
      bundleRef: col("bundleRef").visibleWhen({ kind: "esm_upload" }),
      iframeUrl: col("iframeUrl").visibleWhen({ kind: "iframe" }),
    });
  ```

  `/meta/app` now emits `version.visibleWhen = { kind: 'esm_upload' }`. A metadata-driven form hides the field unless `formState.kind === 'esm_upload'`.

  ### `required` composes

  `.required().visibleWhen({...})` means _required when visible_. The frontend skips required validation while the field is hidden, and strips hidden fields from the submit payload so toggling the discriminator doesn't carry stale data.

  ### Server-side enforcement (out of scope)

  Stripping hidden columns server-side is a v1.5 follow-up. For now the frontend is responsible — a malicious client can still submit irrelevant fields. The metadata-driven UI benefit lands first; defensive server-side stripping later.

  ### Backward compatibility

  Purely additive — fields without `.visibleWhen()` keep `visibleWhen: undefined` and are always visible.

## 1.0.0

### Major Changes

- 49c44b6: Initial release. The metadata-driven UI contract — pure types, URL builders, and the conventions any HTTP server can implement to be auto-rendered by a metadata-driven frontend.

  Extracted from `@pgbo/core/metadata`, `@pgbo/core/query`, and `@pgbo/fastify` to live under a vendor-neutral namespace (closes #52).

  ### What's in the contract

  - **Wire-protocol types**: `BOMeta`, `FieldMeta`, `ViewMeta`, `FilterMeta`, `ValueHelpRef`, `ValueHelpMeta`, `CompositionMeta`, `AssociationMeta`, `FieldKind`, `FilterOption`
  - **Public response shapes** (post-transform on the server): `PublicBoMeta`, `PublicFieldMeta`, `PublicValueHelpRef`, `PublicFilterMeta`
  - **List query contract**: `ListParams`, `PaginatedResult`
  - **Custom action returns**: `FileResponse` (typed as `Uint8Array` so it's platform-neutral; Node `Buffer` is structurally compatible)
  - **Translation enrichment**: `TranslationConfig`, `EnrichConfig`

  ### URL convention (single source of truth)

  ```
  GET    /bo/{name}                       list
  GET    /bo/{name}/{paramValue}          detail
  POST   /bo/{name}                       create
  PUT    /bo/{name}/{paramValue}          update
  DELETE /bo/{name}/{paramValue}          delete
  GET    /meta/{name}                     metadata
  GET    /bo/{name}/valueHelp/{vh}        value help
  POST   /bo/{name}/{action}              custom action
  GET    /view/{name}                     read-only view
  GET    /view/{name}/meta                view metadata
  ```

  Each pattern has a builder helper (`urlForProjection`, `urlForDetail`, `urlForAction`, `urlForValueHelp`, `urlForMeta`, `urlForView`, `urlForViewMeta`) plus `buildQueryString` for the list query convention (`page`, `limit`, `search`, `sort`, `order`, `locale`, `filter.<col>`, `fields`).

  ### Status code semantics

  | Status                | Meaning                                                              |
  | --------------------- | -------------------------------------------------------------------- |
  | `200` / `201` / `204` | Success. Create returns 201, null/undefined returns 204, others 200. |
  | `401`                 | Auth required. Clients should call `refreshAuth` once and retry.     |
  | `403`                 | Forbidden. E.g. tenant trying to write a global record.              |
  | `404`                 | Not found, or filtered out by the projection's WHERE clause.         |

  ### Implementations

  - **Server**: [`@pgbo/fastify`](https://www.npmjs.com/package/@pgbo/fastify) — Fastify route factory backed by [`@pgbo/core`](https://www.npmjs.com/package/@pgbo/core).
  - **Client**: [`@metadataui/client`](https://www.npmjs.com/package/@metadataui/client) — framework-agnostic HTTP client.

  Other backends are valid implementations as long as they conform to this contract.
