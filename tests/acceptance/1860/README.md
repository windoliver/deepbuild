# Acceptance tests for #1860: the validity gate reads the mask in the run a claim cites, not only in the run it matched

These tests were written before any implementation existed, by a job that never saw one. The implementing agent
doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #1860 as of 2026-11-14: its description, Scope, three acceptance criteria and Proof line.
- `docs/technical-design.md`: "An agent says it's done", "How runs become one of five verdicts", Dogfooding.
- `AGENTS.md`.
- At base commit `c740dede7`, for surfaces and conventions only: `packages/gate/src/index.ts` (the public entry:
  `floor`, `lockDefinition`, the `FloorResult` and `SessionRun` types), `packages/gate/src/floor.ts` (how a cite
  resolves to a run and where the masked-exit rule reads), `packages/gate/test/floor.test.ts`, and
  `tests/acceptance/29/` (README, `tsconfig.json`, `floor.test.ts`, `helpers.ts`) and `tests/acceptance/2513/`
  (README, BASE-FAILURE) for the folder's format. Nothing from them is imported; the temp-checkout pattern is copied.

Every expected value comes from the issue.

## What the base does

`validityGate` resolves a cite to the first session run whose command equals it or that it starts with followed by a
space, then reads the masked-exit rule from that run's command and the package script it runs, never from the cite.
So a cite of `pnpm test || true` matches a bare `pnpm test` run (its `test` script is `vitest run`), finds no mask and
passes, whether or not the session also ran `pnpm test || true`.

## The tests

`cite-mask.test.ts`, through `floor` from `@deepbuild/gate`'s public entry (the validity gate, before any check runs,
with no model), on a real temporary checkout whose `package.json` `test` script is plain `vitest run`. The definition
names no checks, so nothing but the floor judges the claim. Each claim's final message cites one run in backticks.

| Test | Session ran | Cites | Expected (from the issue) | Base |
|---|---|---|---|---|
| AC1 | `pnpm test`, then `pnpm test \|\| true` | `pnpm test \|\| true` | goes back (`send_back`) with a finding naming "exit status masked by `\|\| true`"; the failure message names the cite | fails |
| AC2 | only `pnpm test` | `pnpm test \|\| true` | goes back naming "exit status masked by `\|\| true`" | fails |
| AC3 | only `pnpm test` | `pnpm test` | passes the gate (`{ ok: true }`) | passes |

The tests assert only what the issue names: going back, and a finding whose words contain the mask text. They don't
fix a finding's kind or ref, or forbid other findings (AC2's cite is also a run the session never made; a finding
saying so beside the mask's is allowed).

## Run them

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1860
node node_modules/typescript/bin/tsc -p tests/acceptance/1860/tsconfig.json
```

With `--root` here Vitest writes a cache to `tests/acceptance/1860/node_modules/.vite/`; delete it before committing.
`BASE-FAILURE.txt` holds the base run: AC1 and AC2 fail, AC3 passes.
