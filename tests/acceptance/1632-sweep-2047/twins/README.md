# Twins for `#1632.b9d4ec97`

The base already holds the criterion (`../BASE-RUN.txt`), so the test needs a wrong program that fails it.
`../twins.json` maps the criterion tag to the two twins here. Each is a full copy of the base's
`packages/hub/src/mcp-operations.ts`, changed only to hand A's answer back to B through `deep mcp`. Laid over a tree,
it replaces that one file, never a test or a helper.

| Twin | Change | Caught by |
|---|---|---|
| `keeps-acting-for-a` | `rebound()` leaves a rotated connection bound to its hello's session, and `bind()` returns that session even after it ended, so B's calls act for A | `ac2.test.ts`, first `expect`: B's `deep_wait`s on A's ask return your answer |
| `waits-on-any-ask` | `deep_wait` drops its check that the ask is the caller's own, so B, rebound by its stamp, may wait on A's ask | `ac2.test.ts`, first `expect`: B's stamped `deep_wait`s on A's ask return your answer |

To run one: APFS-copy a built tree (`cp -cR`), copy `twins/<name>/packages/` over its `packages/`, run
`npm run build --workspaces`, then `npx vitest run tests/acceptance/1632-sweep-2047`.
