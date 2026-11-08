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

## Later runs on the Spark, at `c815c505`, `49aa6825` and `2c9d67a6`

`49aa6825` is main (`c12a65bb`) merged in plus the Mac's R3 evidence. `2c9d67a6` merges main again (`9fe631ac`, 139
commits on): `scripts/perf.mjs` conflicted with #1116's move of the copy's preparation into `benchmark.mjs`
(`prepareCopy`, `judgeTask`, `judgeTargets`); the resolution keeps main's helpers and this change's kept copies, and
`checkCopy` now removes the last run's `.git` and `target` link before `prepareCopy`. The owner approved that resolution
with `deep/approved/2c9d67a6`; `node scripts/proof.mjs guard` at `2c9d67a6` PASSes, 25 commits checked. Every load below
is the 1-minute average when the file started; the machine has 20 cores, and other sessions' affected runs held it at
30 to 270 most of the day.

### The key keeps a fixture's perf out of the clone's copies (regression for `9f942a02`)

#246's fixture runs perf under the real HOME. With the path-keyed copies it wrote `~/.cache/deepbuild-perf/spark-c89f`,
the same folder the real clone would use. With the clone in the key, the fixture's folder is
`spark-c89f-37241af8fb39` and the real clone's would be `spark-c89f-4e3e746b8b7a`: they never meet. After each affected
run, the real cache was compared with a listing taken before it: the fixtures' folders are new and empty (4 KB each);
the real clone's folder does not exist, since no real perf ran. The empty folders were removed with `rmdir`.

### `node scripts/affected.mjs` at `c815c505` under the real HOME: void

It ran 16 hours and was stopped. Its last lane hung in `tests/acceptance/56/leases.test.mjs`: `deep lease` waits for
the whole process group of a dead leader (the Mac session found the same hang in R3; the fix is on
`claude/lease-leader-exit`). Its perf-area tests (583, 568/lane, perf.test) ended `INCONCLUSIVE no grant` at loads of
166 to 270: a perf nested in affected asks for `timed` while affected's own `test` grant is held, so it can never be
granted under the real HOME. Nothing from this run counts.

### Perf-area files alone at `49aa6825`, one at a time (free disk 66 to 99 GB)

| file | load | result |
|---|---|---|
| `1119/ledger`, `1119/warm` | 5.0, 4.9 | pass (these have no skip path: a missing grant fails them) |
| `tests/bays.test.mjs`, `246/perf` | 6.9, 6.4 | pass |
| `tests/perf.test.mjs` | 6.4 | 18/20; then 19/20, 16/20, 16/20 at loads 17.5, 16.5, 14.0 (below) |
| `583/perf-added-tests` | 6.4 | INCONCLUSIVE: waited 2 h 41 min for `timed`, stopped by the owner's word ("Stop 583, run rest") |
| `568/lane` | 20.6 | INCONCLUSIVE 0/5: each perf killed at the helper's 120 s `spawnSync` timeout while waiting for `timed` |
| `1113` (7 files), `1117` (6), `1118` (3) | 15 to 44 | all pass |

`timed` is exclusive: it needs the load below the core count and no other grant held. Another session's affected run
(worktree `optimistic-pike-acc366`) held `test` grants for hours, so 583 and 568's perfs could not be granted. Both are
INCONCLUSIVE, not failures of this change.

`tests/perf.test.mjs`: every failure across the four runs is the Linux timer flake: `FAIL perf: preflight: missing base
cpuMs`, or `cpuMs 20 regressed beyond base 10 + 50%`, from GNU time's 10 ms CPU resolution on fixture workloads of tens
of ms; the same tests pass on the other runs and the failing set differs each time. The three lock tests (`one perf run
per machine at a time`, the two `racing` tests), run alone at load 17: 3/3. The Mac ran the suite 23/23.

The same files were asked of the Mac at `49aa6825`; it waited 7200 s for a load below 8 (load 187 on 8 CPUs) and ran
nothing.

### `node scripts/affected.mjs` at `49aa6825` under the real HOME (unit capped at 40 GB; 57446 s at load 8 to 270)

An earlier attempt at `4bf64a6f` was killed by a machine-wide OOM. This run: `637 new, 21 already failing on main, 754
inconclusive or blocked, 4 listed skips, 5144 passed`. No WIDE line. INCONCLUSIVE: `113 timed files were not run;
--timed runs them under a timed grant`.

- Three files were stopped by PID inside the run, each checked to be in this unit's cgroup: `56/leases` (hung 2 h 53
  min, the `deep lease` bug above; its six `trap TERM` fixture orphans needed SIGKILL), `583` and `tests/preflight.test.mjs`
  (both waiting for a `timed` grant affected's own grant blocks). All three are INCONCLUSIVE here.
- NEW FAILs by class, none from this change's files: repo-wide `deps`, `cards`, `canvas-lint`, `slots`, `guide` and
  `secrets` (other issues' home paths), which `scripts/known-failures.json` has not caught up with; `48 harness`,
  `87 gate`, `139`, `377`, `65`, `607 reference-macs`, `panel-keys.live` and other suites listed as failing on main
  here.
- Perf-area NEW FAILs, all the same cause: `tests/perf.test.mjs` (2 tests, `RUN perf` only), `594/margin`
  (`spawnSync node ETIMEDOUT`), `594/build-dirs` (the first preflight failed), `568/lane` (5, `exit null`), `583`,
  `1017/budgets` and `428/budgets` (a bench's cargo build). Each perf timed out waiting for `timed` behind affected's
  own `test` grant: INCONCLUSIVE. `1114/affected › with --timed` and `1114/timed-list` fail at the merge base too.
- The real cache gained one empty fixture folder (`spark-c89f-7abd37917ad7`, 0 files), removed; and
  `8cc81dbbe5d9fc75`, an old path-keyed folder another worktree's base-side perf wrote during the run (78 files), left
  alone.

### Perf-area files alone at `2c9d67a6`, one at a time, after `npm ci` and the workspace build

The owner dropped the "start only below load 8" rule on 2026-11-07 ("remove wait for under 8 rule in all sessions"),
so these started at whatever load the machine had; a timed result missed under high load stays INCONCLUSIVE.

A first attempt (unit `1119-rerun5`) ran `1119/ledger` and `1119/warm` at loads 89 to 165: both ended `INCONCLUSIVE no
grant: perf got no timed grant within 10 min`, and the machine's OOM killer then ended the unit during `tests/perf.test.mjs`
(the unit itself peaked at 1 GB). The loop was started again (`1119-rerun6`) at load 18, with `npm ci` and the build
already done (`build exit=0`).

| file | load | result |
|---|---|---|
| `1119/ledger` | 18.0 | 1/1 pass |
| `1119/warm` | 19.7 | 2/2 pass |
| `tests/perf.test.mjs` | 18.7 | 19/20: `the copy without the change's own tests keeps links as links` failed on `cpuMs 20 regressed beyond base 10 + 50%`, the Linux timer flake; it passed in the other runs above |
| `tests/bays.test.mjs` | 42.9 | 20/20 |
| `246/perf` | 63.7 | 2/2 |
| `1404` (5 files, main's) | 63.7 | BLOCKED on Linux: `the counter is read from macOS's /usr/bin/time -l`; 13 tests, none of them read this change |
| `1116` (3 files, main's) | 64.6 | 0 tests ran (vitest files under `node --test`); they ran in affected's vitest lane at `49aa6825` |
| `594/margin`, `594/build-dirs` | 64.6, 160.7 | INCONCLUSIVE: perf `spawnSync ETIMEDOUT` after 900 s waiting for `timed` at loads above 20 cores |
| `594/warm` | 155.8 | FAIL `warm() never check-compiled a dependency, as clippy does`: it calls main's `benchmark.mjs` `warm()` in a child; this change does not touch that file |
| `568/lane` | 77.4 | INCONCLUSIVE 0/5: `exit null`, each perf killed at the helper's 120 s timeout waiting for `timed` |
| `583/perf-added-tests` | 97.5 | INCONCLUSIVE: 7200 s timeout waiting for `timed` |
| `1113` (7 files) | 18 to 78 | all pass (15 tests) |
| `1117` (6 files) | 8.0 to 8.6 | all pass (10 tests) |
| `1118` (3 files) | 7.5 to 8.2 | all pass (8 tests) |
| `56/leases` | 8.3 | 2/4: BLOCKED, `Cannot find package 'effect'` for the spikes' hub; not this change |
| `tests/preflight.test.mjs` | 19.7 | 3/13: `every lane runs after failures` took 4728 s waiting for `timed`; the rest fail on `preflight.mjs`'s own failure summaries (`FAIL unit: console.error(...)` where the test expects `FAIL unit: Error: ...`), a class the machine notes list as failing on main here. Not checked at the merge base: a run takes 79 min |

So at `2c9d67a6` every test that reads this change and could get a grant passes: the 1119 acceptance tests, perf.test's
lock and copy tests, bays, 246, 1113, 1117 and 1118. The timed-grant tests (583, 568/lane, 594/margin, 594/build-dirs,
preflight's first test) stay INCONCLUSIVE on this machine: `timed` needs the 1-minute load below 20, and other sessions'
runs held it above that whenever those files ran.
