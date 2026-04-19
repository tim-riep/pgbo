# Contributing

## Development

```bash
npm ci
npm run build -w @pgbo/core   # adapter's typecheck needs core's dist/
npm run lint
npm run typecheck
npm test
```

Tests require a running PostgreSQL instance. Set `PGBO_TEST_URL` (defaults to `postgresql://localhost:5432/postgres`).

## Making changes that affect published packages

We use [Changesets](https://github.com/changesets/changesets) to manage versions and changelogs for the two published packages (`@pgbo/core`, `@pgbo/fastify`).

**When your change affects one or both published packages**, add a changeset alongside your code:

```bash
npm run changeset
```

Answer the prompts:
1. Which packages changed? (space to select, enter to confirm)
2. What kind of bump? (patch / minor / major, per package)
3. A short summary — this becomes the changelog entry.

This creates a `.changeset/some-random-name.md` file. **Commit it with your code.**

Internal changes that don't affect the public API (refactors, test updates, CI tweaks, docs-only changes) don't need a changeset.

## Release flow

Two explicit actions, each under your control:

1. **Throughout the release cycle**: PRs merge to `main` with their changesets. The `Version PR` workflow keeps a **"chore: version packages"** PR open and up to date — it shows exactly what the next release will look like (version bumps, changelog entries, internal dep syncs).

2. **Release day, step 1** — Review the Version PR's diff and merge it. This lands the new versions and CHANGELOG on `main`. **Nothing publishes yet.**

3. **Release day, step 2** — Go to GitHub → Actions → **Publish** → Run workflow. This runs the full test suite, then publishes any package whose current version isn't yet on npm, with provenance. A GitHub release is created automatically.

The Publish workflow supports a **dry-run** toggle if you want to validate the publish flow without shipping.

No manual `npm version`, no manual tags, no manual `npm publish`.

## Package naming

- `packages/pgbo` publishes as `@pgbo/core`
- `packages/pgbo-fastify` publishes as `@pgbo/fastify`

## Scoping rules for changesets

- Change only in `packages/pgbo/` → select `@pgbo/core`.
- Change only in `packages/pgbo-fastify/` → select `@pgbo/fastify`.
- Breaking API change shared by both → select both, usually both at the same bump level.
- When `@pgbo/core` gets a new major, `@pgbo/fastify` usually needs one too (since it imports from the core).
