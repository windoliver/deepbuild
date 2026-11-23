# Acceptance tests for #3088, blind redraft: the play tests name the CLI, so the proof lanes place deep-hook

A fresh run of #3088's blind test job, written from the issue (`gh issue view 3088`), `AGENTS.md`, the design
sections `node scripts/design-section.mjs --issue 3088` prints, and the blind commit `004cf6d21` (the first suite,
`tests/acceptance/3088/`, on base `b4e6a09c0`). No implementation, other branch, worktree, pull request or stash
was read. The implementing agent doesn't edit these files (AGENTS.md, Proof). `tests/acceptance/3088/` is untouched.

## Why a redraft

`tests/acceptance/3088/play.test.ts` runs `deep-conformance gate run`, whose plays start `deep hub run` from
`packages/cli/dist/main.js` and fire hooks through `target/debug/deep-hook` (`packages/conformance/src/gate-play.ts`,
`CLI`, `DEEP_HOOK`, `startHub`). The proof lanes run each tagged test in a checkout of its own and put the hub's
binaries (deep-hook, deep-show) in that checkout's `target/debug` only for a test whose sources name the hub's or the
CLI's package: `selectBinaries` in `scripts/proof-binaries.mjs` (regex `HUB_ENTRY`) reads string literals, template
text and the string pieces of `join(...)`/`resolve(...)` calls in the test and the helpers it imports (relative
imports into `tests/` or `packages/*/test/` only). The first suite names only `packages/conformance/...`, and its
helper's import of `packages/conformance/src/gate-play.ts` isn't followed, so in the lanes every play ended
`BLOCKED: the hub did not start: ... no deep-hook is built under target`.

This suite runs the same two tests, with the same criteria and verdicts. Before the run each one asserts as a
precondition that the CLI the kit's hub runs from, `join(REPO, 'packages/cli/dist/main.js')`, and the hub's
`join(REPO, 'target/debug/deep-hook')` are built, naming each in its message. That is a real surface of the play (an
unbuilt CLI or deep-hook makes every play BLOCKED), and it names `packages/cli`, so the lanes place the binaries.

Checked with the repo's own function, in a fresh clone at `004cf6d21` plus this folder, on macOS and on Linux:

```
selectBinaries(cwd, ['tests/acceptance/3088-redraft-hub/play.test.ts'])
  → {"bin":[],"target":["deep-hook","deep-show"],"hub":["tests/acceptance/3088-redraft-hub/play.test.ts"],"builds":[]}
selectBinaries(cwd, ['tests/acceptance/3088/play.test.ts'])
  → {"bin":[],"target":[],"hub":[],"builds":[]}
```

## Criteria, tags, tests

| Criterion | Tag | Test (`play.test.ts`) |
|---|---|---|
| AC1: "On Linux (the Spark, aarch64), `reporting-vitest-setup` and `reporting-rewrite-on-import` play their claim and their twin, and each verdict is one the case expects. `deep-conformance gate run …` proves it. …" | `#3088.bb512932` | `#3088.bb512932 on Linux (Linux only): …`, skipped elsewhere |
| AC2, the play half: "On macOS arm64, both cases still play to their expected verdicts, …" (the `node_modules` half stays in `../3088/world.test.ts`) | `#3088.301242f7` | `#3088.301242f7 on macOS arm64 (macOS arm64 only): …`, skipped elsewhere |

The tags are the coordinator's (first 8 hex of the SHA-256 of each criterion's text), not recomputed here.

## Readings

- Surface: `deep-conformance` as a process, `node packages/conformance/dist/bin.js gate run --case
  reporting-vitest-setup --case reporting-rewrite-on-import`, through `kit()` imported from `../3088/helpers.ts`
  (cwd the checkout, TMPDIR a fresh `/tmp/b3088-k-*` folder, removed after; only that process stopped, by PID, on
  the 14-minute timeout).
- Preconditions: `packages/cli/dist/main.js` and `target/debug/deep-hook` exist.
- For each case, a line `<judgement> <case> <claim|twin>: <outcome> — …` for the claim and the twin, each judged
  `PASS` (the kit's word for an outcome the case expects); exit 0; last line `PASS gate@1: 2 cases`.
- Nothing is mocked: the real kit, hub, deep-hook, `cp`, `git` and Vitest in each world.

## Base results (`004cf6d21`)

See `BASE-FAILURE.txt`.

- Linux (aarch64, Ubuntu 24.04): `#3088.bb512932` fails at the assertion: every play is `INCONCLUSIVE … cp: cannot
  stat '…/node_modules/@rolldown/binding-darwin-arm64'`. `#3088.301242f7` skips (macOS arm64 only).
- macOS arm64: `#3088.301242f7` passes on the base (the issue says "still"; the base already lists the darwin
  folders). `#3088.bb512932` skips (Linux only). Its wrong program is the implementer's twin or a mutant.
- `tsc -p tests/acceptance/3088-redraft-hub/tsconfig.json` passes on both.

## How to run

After `npm ci`, `npm run build --workspaces` and `cargo build --locked -p deep-hook`:

```
node node_modules/vitest/vitest.mjs run tests/acceptance/3088-redraft-hub
node node_modules/typescript/bin/tsc -p tests/acceptance/3088-redraft-hub/tsconfig.json
```

`lane.json` runs this folder alone: four plays, each a hub and a Vitest run in its world.
