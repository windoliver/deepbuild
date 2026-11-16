# Blind redraft of #1425's budgets (AC5) that reads the load at each run's start and end (#1830)

AC5 `#1425.30ab78a9`: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a panel's
update stays within its budget, with no new time on the load path above 1 ms." Written from issue #1830, issue #1425,
the design and base `3557b348`, by a job that never saw #1830's implementation or any other redraft of it.
`budgets.test.ts` here runs in place of `tests/acceptance/1425/budgets.test.ts`; once it lands, that first draft stops
running (the swap is the implementer's). Nothing here edits a test: a dispute goes to a blind redraft (design:
Dogfooding).

## Why a redraft

Since #1555, `judgeLimit` (`scripts/benchmark.mjs`) reads INCONCLUSIVE when a call gives no `loads`: one `{ start, end }`
per run, the one-minute load average (`os.loadavg()[0]`) read at that run's start and at its end. The first draft calls
it with `limit`, `runs` and `fingerprint` only, 24 times (two limits for each of the 12 panels), so its timing reads
INCONCLUSIVE on every machine, a fit reference Mac included. This draft reads the load at each run's start and end and
gives it to `judgeLimit`. No criterion text, test name or limit changes.

## What was read

- Issue #1830 (the dispute, its scope and criteria) and issue #1425 (Scope, the eight criteria, Proof).
- `docs/technical-design.md`: How we know version 0 works (Dogfooding), Numbers version 0 has to hold (Every task carries
  its own budgets: five runs after warm-up, the margin; The reference Macs). `AGENTS.md`.
- At the base: `tests/acceptance/1425/budgets.test.ts` (the first draft), its `helpers.ts`, `README.md`,
  `BASE-FAILURE.txt` and `tsconfig.json`, and its Rust half `app/panels.rs` (the AC5 load-path test and how it writes
  `load.json`) with the `[[test]]` entry that wires it in `crates/deep-replica/Cargo.toml`; `scripts/benchmark.mjs`
  (`judgeLimit`, `fingerprint`); `benchmarks/budgets.json`'s `panel-module-load` entry.

## What the base has

At `3557b348` #1425 is built: `benchmarks/budgets.json` has `panel-module-load` (`node benchmarks/panel-module.mjs`), and
the Rust half's AC5 test times `deep_app::mount_panel` with the module check and under `panel-load-unchecked`. The
reference Macs in `scripts/benchmark.mjs` are three, the Mac17,10 among them.

## Where the load is read

- **A panel's update.** The test takes these runs itself: one run is one `deep-panel-host serve` of the panel, 25
  invalidations, the slowest `scriptNs` of the last 20. The load is read just before the `serve` starts and just after
  it ends.
- **The load path.** These runs are taken in the Rust half (`../1425/app/panels.rs`, frozen), which times all 12
  panels' five runs in one process and writes only their medians to `load.json`: no time or load per run. It can't be
  changed here, and a second Rust half would need its own `[[test]]` entry outside this folder. So a load-path run here
  is one invocation of the Rust half's AC5 test: the Rust half is built first (`cargo test ... --no-run`, so no run's
  readings hold a build), then run five times, the load read just before each invocation and just after it, and from
  each invocation each panel's **first** run is taken: the difference of the medians of 15 checked and 15 unchecked
  loads, right after that invocation's untimed load a side. That is the same quantity the first draft judges as a run;
  each invocation's other four runs aren't judged. The five load-path runs share their readings across the 12 panels,
  since one invocation times every panel.

Every `judgeLimit` call gets its five runs' readings as `loads`, in the runs' order.

## The tests

`budgets.test.ts`, two tests, named as the first draft's:

| Test | What it proves |
|---|---|
| `#1425.30ab78a9 the perf lane has the task panel-module-load, a #1425 first measurement, valid against the merge base's budgets, and it runs` | the perf lane's merge-base comparison has its task, valid by `validateBudgets` against the merge base's budgets, naming #1425, and its command exits 0 |
| `#1425.30ab78a9 on a reference Mac, each of the 12 panels updates within 4 ms and the load check adds at most 1 ms to its load` | judged: each panel's update against 4 ms (the design's per-update budget for a panel in the app), and what the module check adds to its load against 1 ms, each on five runs with each run's load |

The work runs first, so a missing surface fails (the Rust half not built, its AC5 test not reported or not ok, a panel
missing from `load.json`, a panel the host can't serve). Then the judge: `judgeLimit` with the runs, this machine's
`fingerprint()` and `loads`. Any FAIL fails, with every panel's runs, loads and verdicts; otherwise any INCONCLUSIVE
(off a reference Mac, not on mains, Low Power Mode on, the thermal state not nominal, the macOS build missing, or a
run's load above the core count) or BLOCKED prints the readings and skips as INCONCLUSIVE, the #1425 suite's way. A skip
is never a pass. The first draft's own after-the-fact load check is gone: `judgeLimit` now sees each run's load.

## Run it

macOS only (the replica draws through AppKit), with the repo's Node:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
npm ci                                                       # once
scripts/lease node scripts/throttle.mjs build -- cargo test --locked -p deep-replica --test acceptance_1425 --no-run
scripts/lease node scripts/throttle.mjs build -- cargo build --locked -p deep-panel-host --bin deep-panel-host
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1425-redraft-1830 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1425-redraft-1830/tsconfig.json
```

Every process is stopped by its PID. Nothing leaves the machine but cargo's fetches; no model is called. Delete
`tests/acceptance/1425-redraft-1830/node_modules/.vite` if Vitest leaves one.

## The base run

Not run. On 2026-11-15 this job's Mac (a Mac17,10, on mains, at a one-minute load of 300 to 600 from other sessions'
work) held its build request in `scripts/throttle.mjs`'s build queue for hours: `deep-panel-host` and the Rust half
(`cargo test ... --test acceptance_1425 --no-run`) never got a slot, so the request was stopped and the suite handed on
unrun. `node node_modules/typescript/bin/tsc -p tests/acceptance/1425-redraft-1830/tsconfig.json` exits 0.

What a run on the base should show, from the code and not seen: the perf-lane task test as the first draft's (#1425 is
built at the base), and the timing test skipping as INCONCLUSIVE with every panel's runs and "load N at a run's start
or end is above the 18 cores" at this Mac's load.

## What this doesn't settle

- It hasn't run at all yet (The base run), so no result of either test has been seen from this file.
- A load-path run's readings bracket a whole invocation of the Rust half (its start, the plant check and all 12
  panels), not the one run taken from it; tighter readings need the Rust half to read the load around each run, which
  is a redraft of `app/panels.rs` with its own `[[test]]` entry.
- The load-path timing costs five invocations of the Rust half where the first draft ran one, so the timing test is
  allowed three hours (`3 * BUILD_MS`) where the first draft allowed one.
