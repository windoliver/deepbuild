# Checks for #1829 at 6c79c47b8

Run on Linux (the Spark), 2026-11-16 to 2026-11-17.

## `node scripts/proof.mjs guard`

PASS. It checked 11 commits. `scripts/lanes.mjs` changed in 9311ad703 and in the merge-conflict resolution 3ec79db3a, and each has its own owner-signed `deep/approved/` tag.

## `node scripts/affected.mjs <every changed path>`

The run named every changed path, `scripts/lanes.mjs` included. It ran in one 24 GB unit with `DEEP_SHARDS=1`, `VITEST_MAX_WORKERS=4`, `CARGO_BUILD_JOBS=2` and `DEEP_TEST_GRANT_WAIT=480`. Earlier attempts at larger settings were killed for memory and count as unrun.

```
FAIL affected: 360 new, 44 already failing on main, 115 inconclusive or blocked, 0 listed skips, 1119 passed, in 39363 s at load 46
WIDE 1124 more see the change only through a process that starts another package (--wide runs them)
```

- **ENOSPC or out of memory:** none (peak 15.5 GB).
- **This PR's own tests passed:** `tests/acceptance/1829/`, `packages/hub/test/promises-hub.test.ts` and `tests/ask-sources-guard.test.mjs`.
- **The 115 INCONCLUSIVE or BLOCKED:** almost all are macOS-only checks (reference Mac, `/usr/bin/time -l`, Metal, Secure Enclave). The rest are "skipped with no note" (11), missing `BASE_BIN_*` inputs, or app/panels.rs not reporting (6).
- **`scripts/lanes.mjs`:** the line it adds feeds every suite. It is unrun until the release preflight.
- **"New" failures:** "new" means not listed in `scripts/known-failures.json`. About 270 of the 360 are lint findings. The other ~90 come from 91 test files, which are being rerun one at a time on this head and on main (f7d661d67). Results are under "The 91 test files" below.

### Lint findings, head (6c79c47b8) against main (f7d661d67)

FAIL lines from each lint check the run used, on the same machine:

| check | head | main | head only | main only |
|---|---|---|---|---|
| ask-sources-guard | 0 | not on main | 0 | 0 |
| canvas-lint | 53 | 56 | 0 | 3 |
| color-literal-guard | 18 | 6 | 12 | 0 |
| conformance-lint | 30 | 30 | 0 | 0 |
| record-reader-guard | 1 | 1 | 0 | 0 |
| repo-rules | 58 | 58 | 0 | 0 |
| size-ratchet | 62 | 62 | 0 | 0 |
| slots-check | 1 | 1 | 0 | 0 |
| vendor-rebase | 19 | 19 | 0 | 0 |

The other ten lint checks found nothing on either side: blocking-call-guard, canvas-closures, fetch-lock, guide, keymap-guard, known-failures-check, loads-lint, panel-catalog, plant-lint and render-lint.

- **color-literal-guard, 12 head only:** all are in gitignored generated files (`crates/deep-app/panels/*/@deepbuild/panel.js`, matched by `.gitignore` `**/@deepbuild/`). Earlier test runs left them in this checkout, so they aren't committed code.
- **canvas-lint, 3 main only:** they're clippy findings in `crates/deep-text/src/cache.rs`, a file that is identical on both sides. The difference comes from clippy reporting only the crates it recompiles.

No lint finding names a file this PR changes.

The guard doesn't exist on main. Run from this branch over main's `packages/` (f7d661d67) it prints one finding, `FAIL ask source: packages/hub/src/answer-delivery.ts:291: promise.blocked has no row`, which is AC2's merge-base case.

## Acceptance #318 (main's `work.call` row, fixed by #2097)

| run | head | main |
|---|---|---|
| 5 s timeout, without #2097's fix | 2 failed, `unlisted_field` | 2 failed, `unlisted_field` |
| 5 s timeout, with #2097's fix applied for the run | 1 timed out under load | 1 timed out under load |
| 120 s timeout, with #2097's fix applied for the run | 27/27 | 27/27 |

So this PR's `promise.blocked` row neither adds to main's #318 failure nor masks it.

## The 91 test files, head (6c79c47b8) against main (f7d661d67)

Each file ran alone, on the head and then on main, with a 30-minute limit. The raw lines are in `pairs.txt` (`rc` is the exit code; 124 is the limit).

| result | files |
|---|---|
| same on both sides (20 pass on both, 46 fail the same way) | 66 |
| head passes or fails less, main fails | 5 |
| differed once, same on a rerun with full output | 2 |
| unsettled: unrun | 18 |

- **Head better (5):** `pack-rule-command`, `309/network-suite` and `56/decision` fail on main's side only or more; `codex-hub` and `continues` fail one test fewer on the head. `pack-rule-command`'s main failure is BLOCKED: the comparison tree had no built `deep-show`.
- **Differed once (2):** `gate-stop` (head 1 failed, main 7/7) passed 7/7 on both sides on a rerun. `onboarding` (head 3 failed, main 2) failed the same two tests on both sides on a rerun; one is a `deepbuild-hub.service` symlink another run left in the real user manager.
- **Unsettled (18), so unrun:** eleven hit the 30-minute limit on one or both sides: `1113/measured`, `1113/waits`, `140/platform/wasm`, `1421/no-cpu-line`, `1421/zero-cpu-base`, `1425/imports`, `1556/twins`, `2144/lint-on-main`, `309/chosen-relay`, `309/frames` and `tests/perf`. Seven ran while the machine was out of memory near 09:30 on 2026-11-17 (exit 228 or a garbled line): `313/packaging`, `33/bootstrap`, `33/spine`, `349/slot-table`, `377/noop`, `47/explain` and `684/lanes`. They are to be rerun with a 90-minute limit once the disk has room for their builds.

No settled file fails on the head and passes on main.

## The final review and its corrections (head 4ebc851de)

An independent review of the diff at f866e7578 confirmed the row and the hub change, and found four ways the guard passed without checking. 4ebc851de corrects them, test first (`tests/ask-sources-guard.test.mjs`, its sixth test):

| case | before | now |
|---|---|---|
| `const f = asks['raise']` then `f(...)` | PASS | FAIL, naming the place |
| a file with a syntax error | PASS | FAIL, naming the file and line |
| a tree where it finds no raise | PASS, "0 sources" | BLOCKED, exit 2 |
| a `sources.json` that is no list of rows | a crash, no verdict line | BLOCKED, exit 2 |

The review's other findings were in this evidence and are corrected above: the lint table's main cell, and what the hand run's build stands for. The guard's PASS line counts the places a source is written (82); the table has 66 rows.

**Left as it is, and disclosed:** a source read from a property (`about.source` in `packages/hub/src/holds.ts`) is followed to every object literal and class field of its type. A value that reaches that property another way (a function's return, a parsed JSON, `Object.assign`) isn't seen once one literal sets it. A `raise` whose parameter isn't named `source`, and a template whose parts it can't read but whose shape fits some row, also pass.

### Checks at 4ebc851de

`node scripts/affected.mjs scripts/ask-sources-guard.mjs tests/ask-sources-guard.test.mjs`, the corrected paths; the full run above stands for the rest:

```
FAIL affected: 196 new, 44 already failing on main, 1 inconclusive or blocked, 0 listed skips, 10 passed, in 145 s at load 72
```

- **Passed:** `tests/ask-sources-guard.test.mjs` (6/6), `tests/acceptance/1829/check.test.ts` and the planted-file test of `tests/acceptance/1829/ask.test.ts`.
- **BLOCKED, so unrun at this head:** the first test of `tests/acceptance/1829/ask.test.ts` (AC1's fourth set). The build output was cleared for disk, and it says "no deep-hook is built". It passed at 6c79c47b8, and 4ebc851de changes only the guard and its test.
- **The 196 "new":** all are lint findings of the kinds in the table above (size 62, deps 50, code mappings 24, vendor-rebase 19, color literal 12, canvas-lint 10, secrets 8, size literal 6, drift 2, slots 2, record reader 1), run because a script changed. None names the ask-source guard or a file this PR changes. There was no WIDE line.
- **The guard over a trial merge with main (de1b08f54):** PASS, 82. The merge has no conflict.
