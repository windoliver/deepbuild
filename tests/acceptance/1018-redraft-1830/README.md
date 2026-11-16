# Blind redraft of #1018 AC6's budget that reads the load at each run's start and end (#1830)

AC6 `#1018.e558130f`: "**Budgets,** on the reference Mac in the local preflight, compared with the merge base: with
10,000 keys kept, carrying a result across sessions adds under 5 ms at p95 to a claim's verdict." Written from issue
#1830, issue #1018, the design and base `3557b348`, by a job that never saw #1830's implementation or any other redraft
of it. `budgets.test.ts` here runs in place of `tests/acceptance/1018/redraft-ac6/budgets.test.ts` (itself the first
redraft of AC6); once it lands, that file stops running (the swap is the implementer's). Nothing here edits a test: a
dispute goes to a blind redraft (design: Dogfooding).

## Why a redraft

Since #1555, `judgeLimit` (`scripts/benchmark.mjs`) reads INCONCLUSIVE when a call gives no `loads`: one `{ start, end }`
per run, the one-minute load average (`os.loadavg()[0]`) read at that run's start and at its end. The AC6 redraft calls
it with `limit`, `runs` and `fingerprint` only, twice in the test and once in its fit gate (`machineProblem` in its
helpers), so the gate skips the test as INCONCLUSIVE before it measures anything, on every machine, a fit reference Mac
included. This draft reads the load where each run is taken, gives it to `judgeLimit`, and gates on its own call that
gives the load. No criterion text, test name or limit changes.

## What was read

- Issue #1830 (the dispute, its scope and criteria) and issue #1018 (Scope, the criteria, Proof, the Nov 6 overlap note).
- `docs/technical-design.md`: How we know version 0 works (Dogfooding), Numbers version 0 has to hold (Every task carries
  its own budgets: five runs after warm-up, the margin; The reference Macs). `AGENTS.md`.
- At the base: `tests/acceptance/1018/redraft-ac6/` (`budgets.test.ts`, `helpers.ts`, `README.md`, `BASE-FAILURE.txt`,
  `tsconfig.json`); `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`).

## What the base has

At `3557b348` the reference Macs in `scripts/benchmark.mjs` are three, the Mac17,10 among them, and `judgeLimit` reads a
run whose load at its start or end can't be read, or is above `os.availableParallelism()`, as INCONCLUSIVE. The AC6
redraft's `machineProblem` calls `judgeLimit` with no `loads`, so it always answers "the load at each run's start and end
can't be read", and the test never gets past its gate.

## The test

`budgets.test.ts`, one test, named as the first redraft's:
describe `AC6 #1018.e558130f budgets on the reference Mac in the local preflight, compared with the merge base`, test
`AC6 #1018.e558130f with 10,000 keys kept, carrying a result across sessions adds under 5 ms at p95 to a claim's verdict`.

What it measures is the AC6 redraft's, through its helpers (`../1018/redraft-ac6/helpers.ts`, frozen): this checkout and
the merge base, each built from its own source with its own hub and its own record seeded with the same 10,000 passed
results; a warm-up of 20 pairs, then five runs of 200 pairs, each pair A then B claiming the same tree in two sessions
and worktrees, sides alternating; `carriedOrFail` on every pair; per run, the `carried` (B's claims) and `ran` (A's
claims) figures, this side's p95 gate time less the merge base's, a negative reading counted as 0 ms; and a PASS counts
only when the run's own noise resolves 5 ms (resolution at most 5/3 ms). Its README holds the measurement's reasoning.

What changes:

- **Each run's load.** A run is one call of `pairs` (200 pairs on both sides). The test reads `os.loadavg()[0]` just
  before it and just after it, and both `judgeLimit` calls (`carried` and `ran`, the same five runs) get them as
  `loads`, in the runs' order. The warm-up isn't judged.
- **The fit gate is this file's own** (`unfit`): `judgeLimit` on this machine's `fingerprint()` and five placeholder
  runs, with the load read now as each run's start and end. Any reason it gives (off a reference Mac, not on mains, Low
  Power Mode on, the thermal state not nominal, the macOS build missing, or the load now above the core count) skips the
  test as INCONCLUSIVE before anything is built, seeded or measured, as the first redraft meant its gate to. The first
  redraft's after-the-measurement `loadProblem` is gone: `judgeLimit` now sees each run's load.
- **The judge.** PASS on both figures passes (when both resolve 5 ms); FAIL on either fails, naming the figures, the
  runs' loads and the machine; INCONCLUSIVE or BLOCKED on either skips as INCONCLUSIVE with each figure's status and
  reason. A skip is never a pass.

## Run it

Node 24.22 first on `PATH`, on a fit reference Mac, with `origin/main` fetched so the merge base resolves:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                                       # once
scripts/lease node scripts/throttle.mjs build -- npm run build --workspaces
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease node scripts/throttle.mjs build -- cargo build --locked -p deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1018-redraft-1830 --testTimeout=600000 --no-file-parallelism --disable-console-intercept
node node_modules/typescript/bin/tsc -p tests/acceptance/1018-redraft-1830/tsconfig.json
```

One test, allowed four hours. On a fit Mac the first run exports the merge base into
`target/acceptance-1018-ac6-base/<sha>` and builds it there, as the AC6 redraft does. It belongs on the budget window's
one-at-a-time line, as the AC6 redraft's README says. Delete `tests/acceptance/1018-redraft-1830/node_modules/.vite` if
Vitest leaves one.

## The base run

Run once at `3557b348` on a Mac17,10 (M5 Max, 64 GB, 18 cores), on mains, Node 24.22.0, Vitest 5.0.5, 2026-11-15,
with `NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1018-redraft-1830
--testTimeout=600000 --no-file-parallelism --reporter=verbose`:

```
 ↓ budgets.test.ts > AC6 #1018.e558130f budgets on the reference Mac in the local preflight, compared with the merge base
   > AC6 #1018.e558130f with 10,000 keys kept, carrying a result across sessions adds under 5 ms at p95 to a claim's verdict 5867ms
   [INCONCLUSIVE a reading, not a budget result: off the reference Macs (Mac15,7 (M3 Pro, 36 GB) or Mac15,12 (M3, 16 GB)
   or Mac17,10 (M5 Max, 64 GB); mains power, Low Power Mode off, thermal state nominal): thermal state is "fair", not
   "nominal"; load 616.15380859375 at a run's start or end is above the 18 cores: a budget counts only on a fit reference Mac]
 Test Files  1 passed (1)
      Tests  1 skipped (1)
```

INCONCLUSIVE, naming the load (616 on 18 cores, from other sessions' work) and the thermal state, at the gate, before
anything was built or measured. `tsc -p tests/acceptance/1018-redraft-1830/tsconfig.json` exits 0. The AC6 redraft's
own gate gives `judgeLimit` no `loads`, so on this or any Mac it reads "the load at each run's start and end can't be
read: null" (read from its code; the first redraft wasn't run, so as to leave its folder untouched).

## What this doesn't settle

- It hasn't run past the gate: this Mac's load keeps it from building, seeding or measuring, so no PASS or FAIL of AC6
  has been seen, and the AC6 redraft's own open points (its README: Never run) stay open.
- The gate reads the load once, before the build; a machine that is fit then and loaded during the runs reads
  INCONCLUSIVE from `judgeLimit` after the measurement, which is the design's rule.
