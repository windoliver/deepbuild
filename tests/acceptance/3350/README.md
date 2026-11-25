# Acceptance tests for #3350: a remote lane's commands on the far machine wait on the stall, not a fixed 30 min

I drafted these tests blind from these sources:

- issue #3350, as `gh issue view 3350` printed it on 2026-11-23
- `docs/parallel-proof.md`, section 6 (Scheduling: the grant-wait table, `--stall`, tables of a test's own) and
  section 8 (Remote lanes: the far end and the record)
- the Dogfooding part of `docs/technical-design.md`
- AGENTS.md
- the base commit `7794e5728` (PR 3341's branch for #3334), where `lane-remote.mjs`'s far end asks its install and
  build grants with `--stall <DEEP_LANE_REMOTE_STALL_MIN>`, then calls `runLanes([lane], { cwd })`, and `runLanes` in
  `scripts/lanes.mjs` asks each command's grant, and `cargoListed` each cargo listing's, with a fixed `--wait 30`

At the base I also read `scripts/throttle.mjs` (`acquire`, the log's `granted` entries carrying `stall` or `wait`, the
table folder inside a test run), `scripts/lease`, `scripts/proof-runs.mjs` (tags, twins, a failure at its assertion),
and `tests/acceptance/1122/` and `3334/`. The tests import `../1122/helpers.mjs`, the #1122 fixture far machine the
issue names, and `../3334/helpers.mjs` for its moving and still build queues and its far machine made ready
(`readyFar`: the npm wrapper and `DEEP_LANE_REMOTE_STALL_MIN=0.05` in the far login profile and the session's
environment). Per AGENTS.md the implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this
job.

Run them with Node 24:

```sh
npm ci                                   # once, if node_modules is missing
node --test 'tests/acceptance/3350/*.test.mjs'
```

There are 3 tests in three files. See `BASE-FAILURE.txt` for the times seen on the merge base and against a throwaway
implementation. On the base `far-stalled.test.mjs` waits out its 6-minute bound (the base's lane waits 30 minutes for
cargo test's grant), so the suite there takes about 6 to 7 minutes. Each file stays under 20 minutes even when every
bound in it runs out: `far-moving.test.mjs` at most 15 (the near end's bound from its start), `far-stalled.test.mjs`
at most 16 (8 to reach the gate, 2 for the holders, 6 for the near end), `near-wait.test.mjs` at most 12. No test needs
an idle machine and none holds a port, so there is no `lane.json`: every test has its own two HOMEs and its own
throttle tables (the far HOME's own inside a test run, and a folder of the test's own on the session's machine).

## Criteria to tests

Each test's name starts with its criterion's tag.

| Criterion | Test (file) | What it requires | Wrong program |
|---|---|---|---|
| `#3350.46301a6a` Through the #1122 fixture far machine, a lane command whose build grant waits behind a queue that keeps moving past the bound (`DEEP_LANE_REMOTE_STALL_MIN` = 0.05) runs and the near end reads the lane's own state; a planted `lanes.mjs` keeping `--wait` for the far end's commands fails | `far-moving.test.mjs` | Once the far end's install and build are done and the lane's tests wait at a gate, the far machine's build queue moves, six holders a slot waiting at every moment, until cargo's listing runs. The unit lane's `cargo test` runs on the far machine under a build grant whose `granted` entry carries `"stall":0.05` and no `wait`; its request waited at least 6 s (twice the bound) and at least 3 holders' grants a slot changed hands meanwhile; cargo's listing's grant also carries `"stall":0.05`. The near end's `RECORD` is `<tree>-unit-<host>.json`; no finding or row of it is a missing grant; it reads the lane's own state (PASS on the Mac; elsewhere the worst of its rows, `INCONCLUSIVE (platform)` with no Mac reference list); the near end prints `<that state> unit on <host>` and exits with its status; the lane's node test, run after cargo, ran on the far machine | The base and twin `far-fixed-wait`: the grant is logged `"wait":30` |
| `#3350.cd64baa0` Same fixture: a lane command whose queue stalls past the bound leaves the far end's record `INCONCLUSIVE`, with a finding naming the holder; the near end exits 2 | `far-stalled.test.mjs` | Once the far end's install and build are done and the lane's tests wait at the gate, every far build slot is held for ten minutes. Within 6 minutes the near end prints `INCONCLUSIVE unit on <host>` and exits 2. Its `RECORD`, `<tree>-unit-<host>.json`, reads `INCONCLUSIVE`, and holds an `INCONCLUSIVE` finding whose note holds `no build grant changed hands within 0.05 min` and, for each holder, `; blocked by build grant <id> held by pid <pid> since <time> (<command>)`, the command holding its name. The far end's `npm ci` and package build ran; the lane's `cargo test` never ran | The base: its lane waits 30 minutes for the grant, so the near end is still running at the 6-minute bound |
| `#3350.48bfd705` A lane run on the Mac outside a far end still asks with `--wait 30`; a planted `lanes.mjs` asking every lane with `--stall` fails on a test's own throttle table | `near-wait.test.mjs` | The real unit lane runs whole through the real `runLanes` (#1122's driver) in a scratch worktree, on a throttle table of the test's own, with `DEEP_LANE_REMOTE_STALL_MIN=0.05` in its environment. The grants its `cargo test`, cargo's listing, its vitest block and its `node --test` command ran under are each logged `granted` with `"wait":30` and no `stall` | Twin `stall-everywhere`. The base passes this test: it is today's behavior |
| `#3350.1e11284a` On the Spark, a remote lane started while the build queue is 3 or more deep, with grants held past 30 minutes, runs its commands and reads its lane's state | none | Hand-checked: the issue's Proof is the Spark run's near-end lines and the throttle log's `granted` entries for the far end's and the lane's requests, posted on the issue. No test here reaches a Spark or holds grants for 30 minutes | — |

`twins.json` names each twin, and `twins/README.md` says exactly what each must plant. The implementing job writes the
twin files.

## The surfaces (my choice where the design leaves it open)

Every surface is one the issue or the design names. The tests start processes and read files; they import nothing of
the code under test.

- **The near end**: `node scripts/lane-remote.mjs --host far-1122 unit` in a #1122 session worktree. Read: its exit
  status, its last `<STATE> unit on <host>` line, its last `RECORD <path>` line and the record it names (`state`,
  `tests`, `findings` as `{ state, note }`).
- **The lane run outside a far end**: #1122's `fullRun`, the real `runLanes` on the unit lane of the worktree's
  `lanes.mjs`, with `DEEP_THROTTLE_TABLE` naming a folder of the test's own.
- **What a lane command asked for**: the throttle table's `log`, whose `granted` entries carry `stall` or `wait`
  (section 6), matched by grant `id` to the grant the command ran under. A command reads its grant from
  `DEEP_THROTTLE`, which `scripts/lease`'s nested request passes through unchanged. The fixture's cargo stand-in is
  wrapped on both machines to note, per call, its HOME (which machine), its `DEEP_THROTTLE`, its arguments, and for
  `cargo test` the elapsed time (`ps -o etime=`) of each `throttle.mjs` process above it; the one whose pid the
  `granted` entry names is the request's own, so its age at cargo's start is how long the request waited. A vitest
  and a node test of the lane note their `DEEP_THROTTLE` in their machine's HOME.
- **The lane's commands**: the unit lane's, in order: the parallel vitest block (class test), the alone block (test),
  `cargo test --workspace` (build) and its `-- --list` (build), then `node --test` (test). The build-class command is
  `cargo test`, so the queues are build queues and the command watched is `cargo test`.
- **The gate**: a vitest test of the lane, in the parallel block that runs first, writes `gate-3350-reached` in the
  fixture's log folder and waits for `gate-3350-open`. The test sets the far machine's queue up only then, so the far
  end's own install and build (already on `--stall` at the base) never wait behind it, and what waits is the lane's own
  command.
- **The moving and still queues** are #3334's (`../3334/README.md`, The moving line): six holders a slot always
  waiting, each holding its grant 1.5 s; or every build slot held ten minutes by holders named `hold-3334-<k>`.
- **Exit statuses**: the near end's 0 PASS, 1 FAIL, 2 INCONCLUSIVE, 3 BLOCKED or INVALID, as section 8 gives them.

## Assumptions, where the design is silent

1. **"Runs the command and reads the lane's own state"**: the lane's state is what its record reads with no missing
   grant in it. On the Mac that is PASS; on Linux the unit lane's cargo rows read `INCONCLUSIVE (platform)` with no Mac
   reference list, so the test takes the worst state of the record's rows there, and requires the near end to print
   and exit by the record's state.
2. **The finding's note** holds the throttle's text from `no build grant changed hands within 0.05 min` on, with the
   holders' clauses; whether it keeps the `INCONCLUSIVE no grant:` prefix is the merged code's (today a cargo command's
   missing grant drops it, another command's keeps `no grant:`).
3. **A lane run "any other way"** includes one whose environment holds `DEEP_LANE_REMOTE_STALL_MIN`: the variable sets
   the far end's bound, and is not what makes a run a far end's. An implementation that reads "far end" from that
   variable alone fails `near-wait.test.mjs`.
4. **The cargo listing** is in the issue's scope ("and for each cargo listing"), so `far-moving.test.mjs` checks its
   grant's `stall` too, and `near-wait.test.mjs` its `wait`.
5. **The test-class commands** (vitest, `node --test`) of a far end's lane are not checked for `--stall`: no queue of
   test grants is built here. `near-wait.test.mjs` checks they keep `--wait 30` outside a far end.

## What stays unproven here

- **The Spark** (`#3350.1e11284a`): by hand, as the issue's Proof says.
- **A far end's test-class commands on the stall**: in the scope, not built as a queue here (assumption 5).
- **Section 6's grant-wait table and section 8**: docs, read by diff review.
- **Timing on a very loaded machine**: the moving line's hand-overs must stay under 3 s apart, as in #3334's tests.

## How I checked the tests can pass

No implementation was written into the repository. In a copy of the checkout in this job's scratch folder I wrote a
throwaway one (`runLanes` takes a `stall` the far end passes, and asks `--stall <stall>` in place of `--wait 30` for
each command and cargo listing when given one) and ran this suite against it; then I planted `stall-everywhere` (every
`'--wait', '30'` of `lanes.mjs` read `'--stall', '30'`) and ran `near-wait.test.mjs`. The base is `far-fixed-wait`'s
behavior. `BASE-FAILURE.txt` is the suite's run on the merge base, then a summary of the other runs. The throwaway isn't
kept and proves nothing about the real change.

## Files

- `helpers.mjs`: the cargo wrapper and its call log, the gate, the noted tests, and re-exports of #3334's queues.
- `far-moving.test.mjs`, `far-stalled.test.mjs`: the far end's lane command behind a moving and a stalled queue.
- `near-wait.test.mjs`: a lane run outside a far end, on a table of the test's own.
- `twins.json`, `twins/README.md`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base, home paths written as `~`.

No fixture holds a secret or personal data.
