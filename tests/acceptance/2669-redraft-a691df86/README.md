# Blind test for #2669.a691df86: #83's redraft-319 status suite passes

Criterion `#2669.a691df86`: "`tests/acceptance/83/redraft-319/status.test.ts` passes". It replaced `#2669.6995f057`
("`tests/acceptance/83/status.test.ts` passes") by the owner's amendment (issue comment 7150789468): `83/status.test.ts`
is #83's retired first draft, and `83/redraft-319` is its blind replacement. Written by the blind acceptance-test job
(AGENTS.md, Proof; design, Dogfooding) at base `89713fcd8` (main). It read only issue #2669 with its comments,
`AGENTS.md`, the design's Dogfooding and Proof parts, and the base's files; it never saw an implementation, a branch, a
diff or a pull request for #2669.

## What it proves

`redraft-319-passes.test.ts` holds one test. It runs `tests/acceptance/83/redraft-319/status.test.ts` once, as that
folder's README runs it, in a child process through the repo's own vitest:

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/83/redraft-319 --no-file-parallelism --testTimeout=600000 status.test.ts
```

with `NO_COLOR=1` and no `FORCE_COLOR` in the child's environment, and ANSI codes stripped before its summary is read.
It passes only when:

- the built CLI and `deep-hook` that #83's suite drives (`../83/helpers.ts` `CURRENT`) exist; otherwise it fails
  `BLOCKED`, never passes;
- the child finishes inside 17 minutes (the proof lanes stop a file at 20) and exits 0;
- the child's summary reads one test file passed, at least one test, and every test passed: none failed, skipped or
  left todo. A skipped test is unrun, and nothing unrun passes (AGENTS.md, the four invariants).

The redraft's own tests carry #83's IDs; this file's test name carries `#2669.a691df86`, the ID the lanes read. It
imports `CURRENT` from `../83/helpers.ts`, so the lanes place the CLI and `deep-hook` binaries that suite needs.

## Wrong programs (`twins.json`, `twins/`)

Each twin is a full copy of one product file at the base with a one-line plant marked `planted (#2669.a691df86)`:

| Twin | File | Plant | Fails |
|---|---|---|---|
| `status-never-asked` | `packages/hub/src/verdict-chat.ts` | `isStatusQuestion` returns `false`, so no typed status question is answered from the record | all five of the redraft's tests (AC2, AC4, AC6); this test at `exits 0` |
| `needs-you-counts-queued` | `packages/hub/src/core.ts` | the status answer's Needs-you count takes every ask in the inbox, one still waiting for its batch included | the redraft's "an ask still waiting for its batch isn't counted" test; this test at `exits 0` |

`BASE-FAILURE.txt` holds both twin runs and the base run.

## How to run

Node 24 first on `PATH`, the workspaces built (`npm ci && npm run build --workspaces`) and `cargo build -p deep-hook`:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2669-redraft-a691df86 --no-file-parallelism --silent=false
npx tsc -p tests/acceptance/2669-redraft-a691df86 --noEmit
```

About 20 s on the base; up to 4 minutes more when started just before a batch time (the redraft's README).

## Decided where the issue leaves it open

- **"Passes" means every test in the file passed, none skipped.** vitest exits 0 with skips; a skip is not a pass here.
- **Run once.** The issue's Proof says "`83/redraft-319/status.test.ts` run once". This test runs it once, under
  whatever load the machine has; it doesn't retry. #2669's first criterion is about that suite failing under load, so a
  failure under load here is a failure, not noise.
- **No load gate.** The criterion names no load or machine, so none is checked.
