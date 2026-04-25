---
"@pgbo/core": minor
"@pgbo/fastify": minor
---

OpenAPI / Swagger schema generation for every auto-registered route (closes #38).

`@pgbo/fastify` now attaches a Fastify `schema` block to every route it registers — `@fastify/swagger` picks them up automatically and the generated `/docs` UI shows every reachable endpoint with the right shapes, no per-route boilerplate.

### What gets emitted per route

| Route | tags | summary | body / response |
|---|---|---|---|
| `GET {prefix}` (list) | `[name]` | `List {name}` | querystring: page/limit/search/sort/order/locale/fields. Response: `{ items, total, page, limit }` |
| `GET {prefix}/:param` (detail) | `[name]` | `Get {name}` | params: `{ param: <PK type> }`. Response: row schema |
| `POST {prefix}` | `[name]` | `Create {name}` | body: required + writable fields |
| `PUT {prefix}/:param` | `[name]` | `Update {name}` | body: writable fields, all optional |
| `DELETE {prefix}/:param` | `[name]` | `Delete {name}` | params + row response |
| `GET /meta/{name}` | `[name, 'meta']` | `Metadata for {name}` | response: `BOMeta` shape |
| `GET /bo/{name}/valueHelp/{vh}` | `[name, 'valueHelp']` | `Value help: {vh}` | list params + paginated rows |
| `POST /bo/{name}/{action}` | `[name, 'action']` | from `ActionDef.summary` | body from `ActionDef.inputSchema` (when set) |
| View routes (`registerViewRoute`) | `[view.name, 'view']` | `View: {name}` | list params + paginated rows |

### New API surface

- **`ActionDef.inputSchema`** — JSON Schema describing the action's request body. Used as the route `body` schema. Skip it and the route accepts any object (Fastify doesn't validate).
- **`ActionDef.summary` / `ActionDef.description`** — propagate into the OpenAPI spec. Use these when the description belongs with the BO (reusable across projections) rather than the per-projection `swagger.descriptions`.
- **`ProjectionRouteConfig.swagger`** + **`ViewRouteConfig.swagger`** — `{ enabled?, tag?, descriptions?, securityScheme? }`. Defaults are sensible (on, with `projection.name` as tag, `bearerAuth` security).
- **Auth integration** — when the projection's view has `.restrict()` (and not `.noAuth()`), routes get `security: [{ bearerAuth: [] }]`. Override the scheme name with `swagger.securityScheme: 'apiKey'`.

### Field type → JSON Schema mapping

| `FieldMeta.kind` | JSON Schema |
|---|---|
| `text` / `slug` / `relation` | `{ type: 'string' }` |
| `number` | `{ type: 'number' }` |
| `boolean` | `{ type: 'boolean' }` |
| `date` | `{ type: 'string', format: 'date-time' }` |
| `translation` | `{ type: 'string', nullable: true }` |

All row schemas use `additionalProperties: true` so dynamically-attached fields (the `global` flag, composition arrays, association merges, virtual fields) pass through unchanged.

### Opt out

`swagger.enabled: false` falls back to the pre-#38 behaviour — routes registered without any schema block.
