---
"@pgbo/fastify": patch
---

Fix `registerProjection` not forwarding `ctx` to `enrichCompositions` (closes #20).

Compositions that use context placeholders in their `where` clause (`$locale`, `$userId`, `$tenantId`, `$now`) threw at request time — e.g. translation compositions using `where: { locale: '$locale' }`. Both GET list and GET detail handlers now pass the extracted `RouteContext` through as the enrichment ctx.
