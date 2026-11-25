# Blind redraft of #2574's AC2c, which #3478's stall contradicts

#3478 has an `affected.mjs` run ask for its test grant with a stall of 720 minutes (`throttle.mjs test --stall 720`) in place of the fixed 30-minute wait. `tests/acceptance/2574/grant.test.mjs` › `#2574.AC2c` asserts the 30 minutes: the grant's log entry carries `wait: 30` and the call is `throttle.mjs test --wait 30 --`. On the change the entry carries `stall: 720` and no `wait`, so the original fails. This folder redrafts that one test from #2574's AC2 (as `tests/acceptance/2574/README.md` quotes it), #3478's text, the design (Dogfooding; `docs/parallel-proof.md` section 6) and the base `1b4929ae7`, drafted by a blind job.

The original file is deleted, as #2833 retired its originals (the owner's approval, 2026-11-25, on PR #3483, recorded in #3478's Scope); git history keeps it. Run with:

```
node --test tests/acceptance/2574-redraft-3478/grant.test.mjs
```

`grant.test.mjs` imports `tests/acceptance/2574/helpers.mjs`, unchanged, for the sandbox, the scratch tree, the probes, the throttle shim's record of each call and the run. There is no helper file here.

## What each redraft replaces

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `2574/grant.test.mjs` › #2574.AC2c the run's grant waits 30 minutes and is taken through scripts/throttle.mjs test --wait | #2574.AC2c (AC2, bullet 3) | #3478: with `DEEP_TEST_GRANT_WAIT` unset the run asks `throttle.mjs test --stall 720`, so the log entry has `stall: 720` and no `wait`, and the call's arguments are not `test --wait 30 --` | `grant.test.mjs` › #2574.AC2c the run's grant waits on a stall of 720 minutes and is taken through scripts/throttle.mjs test --stall |

What the redraft keeps of the criterion: the run's grant is its one top-level test grant, and it is taken through `scripts/throttle.mjs test` (the shim's record holds a call whose pid is the grant's). What it changes: the log entry's `stall` is 720 and it has no `wait`, and the call's first four arguments are `test --stall 720 --`.

## Kept as they are

- `2574/grant.test.mjs` › #2574.AC2a and › #2574.AC2e are carried here with their names, criterion IDs and assertions unchanged, so that this file takes the place of the original, which is deleted. AC2a shares AC2c's one run, as in the original. `within`'s timer gained a `// deadline:` comment, since the wait ratchet starts a new file at zero; nothing else differs (`diff ../2574/grant.test.mjs grant.test.mjs`).
- #2574.AC2b and #2574.AC2d already run from `tests/acceptance/2574-redraft-2833/grant.test.mjs` and are not repeated here. AC2d sets `DEEP_TEST_GRANT_WAIT`, which #3478 leaves as it was.
- `tests/acceptance/2574/helpers.mjs`, `2574/shards-linux.test.mjs` (AC1) and `2574/wide.test.mjs` (AC3).

## On the base and on the change

Run on the Spark (Linux, 20 cores, 1-minute load about 20 to 35), the file once per program, each in a memory-capped transient unit (`systemd-run --user -p AppArmorProfile=claude-desktop -p MemoryMax=24G -p MemorySwapMax=2G`, `CARGO_BUILD_JOBS=2`), one at a time. The tests point `HOME` at a sandbox, so the machine's own throttle table wasn't touched.

On the base `1b4929ae7` the redrafted AC2c fails for the expected reason, the base's grant being a 30-minute wait:

```
$ node --test tests/acceptance/2574-redraft-3478/grant.test.mjs
  ✖ #2574.AC2a the throttle log shows one top-level test grant, a passed event for each job that asks, and no build request (3.800086ms)
      57 passed events for 33 jobs
  ✖ #2574.AC2c the run's grant waits on a stall of 720 minutes and is taken through scripts/throttle.mjs test --stall (2.323325ms)
      the run's test grant waited on a stall of undefined min, not 720
      {"at":"2026-11-25T06:57:08.353Z","event":"granted","class":"test","grant":"top-level","id":"b9f90ccb50248807","pid":654189,"index":1,"load":33.51,"cores":20,"wait":30,"run":true,"readings":null}
✖ #2574 AC2 a run with untimed jobs and no neighbour (15680.700612ms)
✔ #2574.AC2e with --timed the timed files run after the run's test grant is released, each block under its own timed grant (16160.901602ms)
ℹ pass 1
ℹ fail 2
```

On the change (`bb9a70a22`) it passes:

```
$ node --test tests/acceptance/2574-redraft-3478/grant.test.mjs
  ✖ #2574.AC2a the throttle log shows one top-level test grant, a passed event for each job that asks, and no build request (4.118344ms)
      57 passed events for 33 jobs
  ✔ #2574.AC2c the run's grant waits on a stall of 720 minutes and is taken through scripts/throttle.mjs test --stall (1.170887ms)
      {"at":"2026-11-25T06:56:08.058Z","event":"granted","class":"test","grant":"top-level","id":"782ffa1d7451d612","pid":642721,"index":1,"load":23.5,"cores":20,"stall":720,"run":true,"readings":null}
✖ #2574 AC2 a run with untimed jobs and no neighbour (7024.90265ms)
✔ #2574.AC2e with --timed the timed files run after the run's test grant is released, each block under its own timed grant (5910.124513ms)
ℹ pass 2
ℹ fail 1
```

The carried tests read as the original's do on each side. AC2a fails on both, on the same line as the original on the base (`57 passed events for 33 jobs`: more `passed` events than the run's logs folder holds job logs); that failure is the base's, not #3478's, and the carried test is not bent to it. AC2e passes on both.

The wrong program for the redrafted AC2c is the merge base itself (a fixed 30-minute wait through `--wait`). #3478's own twins (`tests/acceptance/3478/twins/`) plant a fixed wait with `DEEP_TEST_GRANT_STALL` set; this test runs with neither variable set.
