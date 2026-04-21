# @pgbo/fastify

## 0.2.0

### Minor Changes

- 15832be: Auto-expose BO custom actions as HTTP routes, with support for binary file responses (closes #5, #7).

  Every non-standard action on a BO (anything besides `create` / `update` / `delete`) is now auto-registered as `POST /bo/{boName}/{actionName}`. The request body is passed as the action's `data` argument. Standard CRUD actions keep their existing REST routes — no duplication.

  Return-value handling:

  - Any value → JSON body, 200
  - `undefined` or `null` → 204 no body
  - New `FileResponse` shape (`{ data: Buffer | Uint8Array, contentType, filename?, inline? }`) → binary body with `Content-Type` and `Content-Disposition` headers

  This eliminates the need for hand-written Fastify wrapper routes around `bo.execute(...)` and enables PDF / XLSX / CSV generation from BO actions without glue code.

### Patch Changes

- Updated dependencies [bd7cca3]
- Updated dependencies [a23904b]
  - @pgbo/core@0.2.0
