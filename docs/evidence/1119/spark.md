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
- **Later runs:** at `056a443d` and `ce3c9c5c` the suite passed 3/3 in three of four runs. In the fourth, the second
  worktree's perf failed `preflight: cpuMs 50 regressed beyond base 30 + 50%`: perf's own comparison of two fixture
  workloads tens of ms long, at load 14. Its base side printed `wrote 0 files`.
- **The record (AC2):** the ledger test asserts that the second run prints a stdout line matching
  `^perf: base\b.*crates/deep-show/kit-ledger\.json`. perf prints it as
  `perf: base copy <dir>: wrote <n> files, deleted <m>; rewrote what the last run left with other bytes: <paths>`.
  The passing run's exact line was not captured.

## Bugs found after the first push, each fixed with a test failing first

| Bug | Found by | Fix | Test that failed first |
|---|---|---|---|
| Fixtures without `node_modules` couldn't load perf: perf imported bays.mjs, which imported proof-change.mjs and so TypeScript (`Cannot find package 'typescript'`) | affected.mjs: #583's tests | `d9b65a01`: bays.mjs loads proof-change.mjs only in its CLI | `tests/perf.test.mjs` with its fixture's `node_modules` link removed: 2 of 2 failed on the old bays.mjs |
| A merge base whose archive is over 128 MiB stopped perf with `spawnSync git ENOBUFS`. The Mac's archive is 141 MiB, and main has the same bug | the Mac's run | `c48d66c9`: `git archive \| tar` streams under bash's `pipefail` | `a merge base whose archive is larger than a process buffer is still copied` (140 MiB): `BLOCKED perf: spawnSync git ENOBUFS` before the fix, then 4 passes in a row after it; one earlier run failed, and its output wasn't captured |
| A copy of perf with only benchmark.mjs beside it couldn't load (`Cannot find module …/scripts/bays.mjs`) | affected.mjs: #246's test | `ce3c9c5c`: throttle.mjs and bays.mjs are imported only when they lie beside perf, as the throttle was at the base | `tests/acceptance/246/perf.test.mjs`: 1 of 2 failed at `056a443d`, 2 of 2 pass at `ce3c9c5c` |

## tests/perf.test.mjs

| | pass | fail |
|---|---|---|
| merge base `a2ea54a5` | 7 | 9 (its fixture copied only three scripts, which no longer load alone) |
| change at `056a443d` | 17 | 0 |
| change at `ce3c9c5c`, four runs at load 9 to 14 | 14 to 17 | 0 to 3, each `missing base cpuMs` |

`missing base cpuMs` comes from GNU time's 10 ms CPU resolution on Linux: an empty fixture workload can read
`cpu_s=0.00 0.00`, and perf refuses a base reading of 0. The Mac ran perf.test 16/16. The 16/0 run at `5c13c2e3` took
2025 s. Almost all of that time was the suite's one `timed` grant waiting for a load below 20;
each test took 0.4 to 7 s. One earlier run on the change failed `wall time that only machine load stretched` with
`missing base cpuMs`. Run again alone, the test passed, and it passed in the full run above, so that failure was a
flake.

## Proof lanes and affected.mjs, at `ce3c9c5c` (load about 10)

- `node scripts/proof.mjs guard before trace`:
  - guard FAILs only for the four guarded commits awaiting the owner's tag (`42f17f38a5c4`, `d9b65a013ee6`,
    `c48d66c99961`, `ce3c9c5c0a63`).
  - before PASSes: each of the 3 tagged tests failed on the merge base at its assertion.
  - trace PASSes: `Part of #1119; open: #1119.d289b927` (AC3, a reading with no test).
  - An earlier before run at load 45 to 67 was BLOCKED by its 20-minute limit while perf waited for `timed`.
- `XDG_CACHE_HOME=<scratch> node scripts/affected.mjs` (the scratch cache keeps #583's fixture out of the machine's
  real kept copies):
  - No WIDE line. One INCONCLUSIVE line: `1 timed file was not run; --timed runs them under a timed grant:
    tests/acceptance/568/judge.test.mjs`.
  - BLOCKED: macOS-only tests (568 fingerprint, 724), and `packages/conformance/dist` not built.
  - NEW FAILs, by class: 48 harness, 87 gate, two preflight.test tests, canvas-lint, checks-work deps and cards, and
    other issues' home paths (996, corpus-redact). The machine notes list each of these as failing on main here.
    `1114/timed-list` also fails on the merge base. `tests/perf.test.mjs › the copy without the change's own tests
    keeps links as links` failed once with its output cut off after `RUN perf`; run alone 4 times, it passed 4.
  - Run alone at `056a443d` and at the merge base: 583 passes 7 of 8 at head, and criterion 1 waited 3611 s for a timed
    grant at load 45 to 74; 8 of 8 at base. 246, 568/lane and 1113 (measured, waits, before) pass at head and base.
    1117 and bays.test pass 18 of 18 at head.

## Not run here

- **The real repository's perf from a fresh second worktree (the headline criterion on real crates).** A run from a
  fresh worktree under the real HOME waited for `timed` behind other sessions' grants, at loads of 21 to 67. It was
  stopped before it started, so that its pending request would stop draining other sessions' builds. Even with a
  grant, the merge base's `checks.mjs` fails on Linux until T8 (#1121): deep-app and its six dependents don't build,
  so perf stops BLOCKED after the base side, and those crates are tried again on every run. The count belongs to the
  Mac.
- **Wall time before and after (AC3)** on the real repository: also the Mac's.
