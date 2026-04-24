---
"@pgbo/core": minor
"@pgbo/fastify": minor
---

Bump minimum supported Node version from 20 to 22.

CI matrix now runs against Node 22 and 24 (was 20 and 22). Node 20 is in maintenance LTS; Node 22 is the current active LTS. This aligns the supported range with npm's Trusted Publishing requirement (npm 11.5+, bundled with Node 22+) and lets us use modern features without polyfills.
