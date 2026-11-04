# #1119 perf's kept copies per machine, on the Spark (2026-11-04)

These are readings, not budgets. The Spark is Linux aarch64 with 20 cores, Node v24.22.0. Other sessions' work kept
its 1-minute load between 15 and 67. The issue says `Runs on: Mac only`, and the real repository's perf proof below
is left to the Mac. Home paths are shown as `~`.

## Acceptance tests: real perf, real cargo, two worktrees of one commit

`node --test tests/acceptance/1119/*.test.mjs` at load 17.5, on the change: 3 tests, 3 pass, 0 fail.

```
✔ #1119.d33bc868 after the canvas kit lane rewrote kit-ledger.json with other bytes, a second worktree's perf rebuilds deep-show and its dependent only, and says so (2362ms)
ℹ reading: perf wall time 1.01 s from worktree a, 0.79 s from worktree b
✔ #1119.a84127b8 a perf run from a second worktree of the same commit compiles 0 crates on its base side, in the kept copies per machine (3912ms)
ℹ reading: perf wall time 1.91 s from worktree a (first on the machine), 1.44 s from worktree b
✔ #1119.a84127b8 perf's lock is the machine's: a perf from a second worktree, started while the first holds the kept copies, is blocked and checks nothing (1356ms)
```

- **Base:** on the merge base `a2ea54a5`, all 3 fail at their assertions. The second worktree compiles `plain`,
  `deep-show` and `show-panel`, and the nested perf runs its checks in a path-keyed copy of its own
  (`tests/acceptance/1119/BASE-FAILURE.txt`).
- **The planted path-keyed copy (the issue's Proof):** this is
  `tests/acceptance/1119/twins/path-keyed-copy/scripts/perf.mjs`, which is the change's perf.mjs with only the
  folder key turned back to `sha256(realpathSync(root))`. With it over `scripts/perf.mjs`, all 3 tests fail. The
  real file was put back afterwards.
- **The record (AC2):** the ledger test asserts that the second run prints a stdout line matching
  `^perf: base\b.*crates/deep-show/kit-ledger\.json`. perf prints it as
  `perf: base copy <dir>: wrote <n> files, deleted <m>; rewrote what the last run left with other bytes: <paths>`.
  The passing run's exact line was not captured.

## tests/perf.test.mjs

| | pass | fail |
|---|---|---|
| merge base `a2ea54a5` | 7 | 9 (its fixture copied only three scripts, which no longer load alone) |
| change | 16 | 0 |

The change's run took 2025 s. Almost all of that time was the suite's one `timed` grant waiting for a load below 20;
each test took 0.4 to 7 s. One earlier run on the change failed `wall time that only machine load stretched` with
`missing base cpuMs`. Run again alone, the test passed, and it passed in the full run above, so that failure was a
flake.

## Not run here

- **The real repository's perf from a fresh second worktree (the headline criterion on real crates).** A run from a
  fresh worktree under the real HOME waited for `timed` behind other sessions' grants, at loads of 21 to 67. It was
  stopped before it started, so that its pending request would stop draining other sessions' builds. Even with a
  grant, the merge base's `checks.mjs` fails on Linux until T8 (#1121): deep-app and its six dependents don't build,
  so perf stops BLOCKED after the base side, and those crates are tried again on every run. The count belongs to the
  Mac.
- **Wall time before and after (AC3)** on the real repository: also the Mac's.
- **`proof.mjs before`:** BLOCKED. Both acceptance files were stopped at the lane's 20-minute limit while each test's
  perf waited for a top-level `timed` grant at load 45 to 67. It needs a run at a load below the core count.
