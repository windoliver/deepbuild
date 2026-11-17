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
- **"New" failures:** "new" means not listed in `scripts/known-failures.json`. About 270 of the 360 are lint findings. The other ~90 come from 91 test files, which are being rerun one at a time on this head and on main (f7d661d67). Results are pending.

### Lint findings, head (6c79c47b8) against main (f7d661d67)

FAIL lines from each lint check the run used, on the same machine:

| check | head | main | head only | main only |
|---|---|---|---|---|
| ask-sources-guard | 0 | 0 | 0 | 0 |
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

## Acceptance #318 (main's `work.call` row, fixed by #2097)

| run | head | main |
|---|---|---|
| 5 s timeout, without #2097's fix | 2 failed, `unlisted_field` | 2 failed, `unlisted_field` |
| 5 s timeout, with #2097's fix applied for the run | 1 timed out under load | 1 timed out under load |
| 120 s timeout, with #2097's fix applied for the run | 27/27 | 27/27 |

So this PR's `promise.blocked` row neither adds to main's #318 failure nor masks it.
