# Blind redraft of `helpers.mjs`'s end steps

Request: windoliver/deepbuild#2954. `setup()` registered three end steps per test, in this order: `scratch()` deleted the scratch folder, `fixture()` stopped the check PIDs it had read from `checks.jsonl`, and `startHub()` sent SIGKILL to the hub without waiting. node runs a test's end steps in that order. So when a test failed with holds in flight, the folder went first, while the hub and its checks still wrote to it. The record was read after it was deleted, so a check whose lines the test never read was never stopped. The hub died last and could start another check after the record was read. Such checks, and their grandchildren, outlived the test. Only `helpers.mjs` changed, and this write-up is new. No assertion, number, timeout or test name changed. `leases.test.mjs`, the README and the fixtures are unchanged.

## What this job read

- Issue #56 with its comments, and #2954.
- `docs/technical-design.md`, the Dogfooding bullet.
- `AGENTS.md`.
- This suite's own files: `README.md`, `helpers.mjs`, `fixtures/`, the five test files, `BUDGETS-REDRAFT.md`, `LEASES-REDRAFT.md`, and `git log` of `tests/acceptance/56/`.
- `scripts/wait-ratchet.mjs`, for what it counts, with this suite's lines in `scripts/wait-ceilings.json` and `testPaths` in `scripts/lanes.mjs`.
- A `git grep -l` for other importers of this suite's helpers. Only `scripts/wait-ceilings.json` names the file.

This job didn't read #56's implementation, other issues' tests, other branches or PRs. It reached the hub only through `helpers.mjs`, as the tests do. It installed the spike's locked packages with `npm ci --prefix spikes/hub-core --ignore-scripts`. One failing `decision.test.mjs` test printed, in its own failure message, one line of `spikes/hub-core/bench.mjs` (the error for a hold that timed out); nothing else of the spike was read. The wait ratchet's output names other issues' test files and lines; their code wasn't read.

## How node runs end steps

The issue states this, and this job checked it on Node v24.22.2 with a probe in its scratchpad (`probe/node-test-hooks.test.mjs`):

- a test's `t.after` steps run in the order they were registered;
- when one throws, the steps after it don't run;
- when a test times out, `t.signal` aborts, its steps run while its function goes on, and the function keeps running after node reports the timeout;
- a step registered after that never runs.

## The change, and why

Each test now has one end step. The first helper call that takes the test's `t` registers it: `scratch()`, which `fixture()` and so `setup()` call first, or `startHub()`. The helpers record in it what they start: each hub (`startHub()`), each fixture's marker (`fixture()`) and each scratch folder (`scratch()`). When the test ends, pass, fail or timeout, the step:

1. sends SIGKILL to each hub still running, as `startHub()`'s own step did, and waits for each to exit, 5 s at most (through `within`);
2. sends SIGKILL to every process whose command line carries one of the test's markers. It reads `ps` once a pass, through `waitFor` (a pass every 25 ms or so), and stops once 1 s has passed since the hubs exited **and** a pass finds none, or after 5 s. A `ps` that fails counts as finding none, and running out of time ends the sweep without throwing;
3. deletes the test's scratch folders.

Once the step has begun, or the test has timed out (`t.signal.aborted`), `scratch()`, `fixture()`, `setup()` and `startHub()` throw instead of starting anything.

Why each part is there:

- **One step, not three.** A step that throws skips every step after it. On main, the record step could read a broken line from a folder being deleted and throw, and then the hub kill never ran (LEASES-REDRAFT.md saw a half-deleted folder and a live hub). With one step, its code fixes the order, and the only part that can throw is the last.
- **The hub first, and waiting for it to exit.** A live hub starts attempts: it retries a check whose process was stopped, and starts queued holds. Once it has exited, nothing starts a new check, so the sweep has a fixed set to stop.
- **Stopping by marker, not by the record.** `checks.jsonl` holds only what the checks wrote, and `fixture()`'s step saw only the lines the test had already read, since it read the file after the folder was gone. `ps` shows every process carrying the marker, whatever the test read. The marker is random per fixture (`ds56m.<hex>.`), so the sweep stops only what this test's fixtures started, as `fixture()`'s step already required before a kill. Its `stop()` has no caller left and is removed.
- **A second after the hubs exit, not just until the first empty pass.** LEASES-REDRAFT.md found that a check the hub left can show in `ps` as `(node)`, without its arguments and so without the marker, and start a marked grandchild up to about 140 ms after a pass found nothing. The window and the 5 s cap are the same numbers its lease step uses, so the suite has one rule. A check that only gets going after the folder is gone dies on its first write, since `fixtures/check.mjs` writes its attempt counter into the folder before it starts any grandchild.
- **The folder last.** Once the hubs are gone and no marked process runs, nothing writes into the folder, so the delete doesn't race a writer. Nothing before it reads the folder any more.
- **Nothing starts once the test has ended.** When a test times out, node runs its end step while its function goes on, and a step registered after that never runs. `timeouts.test.mjs`'s virtual-clock test calls `setup()` 20 times in a loop and catches each run's error, so after a timeout it would go on starting hubs and folders that no step stops. Now its next `setup()` throws and the loop ends. Checking `t.signal.aborted` too covers a test that times out before its first helper call, when it has no end step yet.
- **`living(...markers)`.** The sweep reads `ps` once a pass for all of a test's markers. The virtual-clock test has 20 fixtures in one test, and one `ps` per marker would make each pass 20 times slower. `living(marker)` with one marker behaves as before.
- **No new fixed wait.** The sweep polls through `waitFor` and the hub wait is bounded through `within`, both already in `helpers.mjs` and counted under its ceiling of 6. LEASES-REDRAFT.md says why the 1 s floor is part of the condition and is still a fixed margin: no event announces a late grandchild. That stays true here.

Not changed: what any test asserts and in what order, every number and timeout, the test names, the fixtures, `leases.test.mjs` and `README.md`. On a pass, the sweep finds nothing and ends after 1 s, so each test that uses `fixture()` spends about 1 s more in its end step: 8 in `processes.test.mjs`, 4 in `timeouts.test.mjs` (the 20 virtual runs share one step), 2 in `typecheck.test.mjs` and 4 in `leases.test.mjs`. That is about 18 s for the suite.

`decision.test.mjs` calls `scratch(t)` and nothing else from this part. Its folder is still deleted when its test ends; the step has no hub and no marker, so it only deletes. That test calls `scratch()` only when the record's decision is Effect.

## `leases.test.mjs` keeps its end step

The step from LEASES-REDRAFT.md stays as it is:

- Its first part, stopping the lease sampler, is still needed. The helpers can't see the sampler, and without that stop a failed test never exits (#2804).
- Its `t.signal.aborted` check is still needed, so the sampler doesn't start after the test timed out inside `setup()`.
- Its hub kill and marker sweep now repeat the helpers'. It is registered before `setup()`, so it runs first, and the helpers' step then finds the hub gone and no marked process. That costs about 1 s more per lease test and changes nothing else.

Trimming the step to the sampler stop would change a file LEASES-REDRAFT.md proved, and the README row that describes it, with no change in behavior. That is a cleanup, left as a follow-up.

## Behavior → source → wrong program

The redraft adds no assertion. Its proof is that a failed or timed-out test still ends the file and leaves nothing running, and that the tests still pass.

| Behavior | Source | Wrong program it is shown on |
|---|---|---|
| A test that fails with holds in flight kills its hub and waits for it to exit before it stops anything else or deletes anything | #2954: "its end steps first stop the hub and wait for it to exit" | main's helpers, which kill the hub last and don't wait: the forced copies of `processes` and `typecheck` |
| Then every process carrying the test's marker is stopped, found through `ps`, whatever the test read of `checks.jsonl` | #2954: "then stop every process carrying the test's marker" | main's helpers, which stop only PIDs they had read from the record: in the `processes`, `typecheck` and `timeouts` copies, the extra hold, seen only through `ps`, leaves its check and grandchildren running there. In `leases`, the file's own end step sweeps it on main too |
| Only then is the scratch folder deleted | #2954: "and only then delete the scratch folder" | main's helpers, which delete it first, so the record step reads a file that is gone. Both sides delete it in the end: in the runs that print their folders (round 3 and the timeout case), every folder is gone afterwards except the 19 main's timeout case made after its end steps |
| A test that times out does the same, and the helpers start nothing more for it | #2954: "When a #56 test fails or times out" | main's helpers in the timeout case: after the timeout, the virtual-clock loop starts 19 more hubs and folders that no end step stops |
| The file exits and reports the failure, with no marked process left | #2954: "The file exits, reports the failure, and leaves no marked process behind" | main leaves 2 or 3 marked processes in every case but `leases`; the redraft leaves none. Every run on both sides exits and reports its failure |
| Every test that passed before still passes | #2954 asks only for the order of the end steps | the unmodified files, run once each |

## Evidence

The proof runs throwaway copies (`zz-forced-*.test.mjs`, `zz-timeout-timeouts.test.mjs`) of the suite's files, each with one forced change, all deleted now. Each copy has a `.base` twin that imports a copy of main's `helpers.mjs` (from `e575a47af`, saved as `harness/base/helpers.mjs` before the edit) instead of the redraft, so the two sides run the same test code. To run them again: `node harness/copies.mjs make`, then `node harness/proof.mjs <log dir> processes-forced typecheck-forced leases-forced timeouts-forced timeouts-timeout`, then `node harness/copies.mjs remove`. The job's scratchpad keeps the harness that makes and runs them (`harness/copies.mjs`, `harness/run.mjs`, `harness/proof.mjs`) and every log (`logs/`). Each run goes through `run.mjs`, which puts `node --test` in a process group of its own and kills only that group at a limit. It logs the load average, the output, when the failure was reported and when the file exited. Then it lists the processes whose command line carries a marker the run printed, at once and 5 s later, from `ps -axww` read in node, so no `grep <marker>` process carries the marker itself. Last, it SIGKILLs those by PID, since they carry that run's random marker. Each copy prints its fixtures' markers, and every forced failure names `fx.run`. Runs went one at a time, on Node v24.22.2, with only the `[plain]` test run (`--test-name-pattern`).

The forced change. After the test's own holds are in flight, the copy starts one more hanging hold with grandchildren, waits for it through `living()` (so through `ps`, not the record), then fails with `forced failure with holds in flight, marker <fx.run>`. main's record step can't see that hold, since the test never read its lines. That makes main's leak certain rather than a matter of timing. Without it, main leaks only a check that started after the test's last read of the record and before the folder went: `fixtures/check.mjs` keeps its counter and log in the folder, so a check that starts after the folder is gone dies on its first write.

### Forced failures with holds in flight

Each line: the log, the copy's test (`[plain]` only), the load average at its start, the failure node reported, when the file exited (after `node --test` started; node reports a failed test only once its end steps have run), and the processes left carrying that run's markers 5 s after the exit.

```
round3/processes-forced.base      cancel test (load 220.67)         → fail 1, the forced failure | exited 1 at +5.4 s, 0.0 s after it was reported | left 3: h6-extra's check and 2 grandchildren
round3/processes-forced.redraft   cancel test (load 215.36)         → fail 1, the forced failure | exited 1 at +10.2 s, 0.0 s after | left 0
round2/typecheck-forced.base      runtime-error test (load 216.45)  → fail 1, the forced failure | exited 1 at +15.8 s, 0.2 s after it was reported | left 3: h1-extra's check and 2 grandchildren
round2/typecheck-forced.redraft   runtime-error test (load 212.38)  → fail 1, the forced failure | exited 1 at +23.4 s, 0.2 s after | left 0
round2/timeouts-forced.base       virtual-clock test (load 231.29)  → fail 1, '19 of 20 runs passed: run 1: forced failure …' | exited 1 at +145.7 s, 0.0 s after | left 2: h6-extra's check and its grandchild
round2/timeouts-forced.redraft    virtual-clock test (load 260.22)  → fail 1, '19 of 20 runs passed: run 1: forced failure …' | exited 1 at +111.8 s, 0.2 s after | left 0
round3/leases-forced.base         50-session test (load 210.95)     → fail 1, the forced failure | exited 1 at +3.8 s, 0.0 s after | left 0
round3/leases-forced.redraft      50-session test (load 213.80)     → fail 1, the forced failure | exited 1 at +6.3 s, 0.0 s after | left 0
```

On main, `leases.test.mjs` already left nothing: its own end step, from LEASES-REDRAFT.md, runs first and sweeps the marker. That is the workaround #2954 describes, and it is why the lease file keeps no leak to show.

How long the end steps took, from the `[forced]` line to node's report of the failure (round 3 only; round 2's runner didn't log it): `processes` 0.7 s on main and 1.4 s on the redraft; `leases` 1.1 s on main and 3.1 s on the redraft, where the lease file's own sweep and the helpers' each wait at least 1 s.

In the virtual-clock test, the file's own `finally` kills each run's hub, so on main the leak there comes from the record step alone: the three hanging checks the test had read were stopped, and the extra hold it hadn't read was not. In every main run, what was left is exactly the extra hold's check and grandchildren; nothing else carrying the marker was.

### The timeout case

`zz-timeout-timeouts` is the virtual-clock test with its timeout cut from 600 s to 120 s. In run 1, with its three hanging holds and the extra hold in flight, it waits for its hub to exit, which only an end step causes, so the test times out there. Then the test's function goes on: run 1 fails on its next `tick`, and the loop moves to run 2.

```
round2/timeouts-timeout.base     (load 257.89) → cancelled 1, 'test timed out after 120000ms', reported at +122.5 s (forced wait reached at +17.0 s) | exited 1 at +281.3 s, 158.7 s after it was reported | runs 2 to 20 started after the timeout: 20 markers printed, 19 of 20 scratch folders left | left 2: h6-extra's check and its grandchild
round2/timeouts-timeout.redraft  (load 174.13) → cancelled 1, 'test timed out after 120000ms', reported at +128.3 s (forced wait reached at +14.6 s) | exited 1 at +128.5 s, 0.2 s after | no run started after the timeout: 1 marker printed, 0 of 1 scratch folders left | left 0
```

On main, node ran the end steps at the timeout, and then the test's function went on for 19 more runs, each with a new hub and folder that no end step covered. The file exited only when that loop ended. On the redraft, the next `setup()` threw, so the loop ended at once and the file exited 0.2 s after the timeout was reported. The redraft's end step took about 7.6 s here (the test's duration, 127.6 s, less its 120 s timeout), against about 1.7 s on main. It waits for the hub to exit and sweeps for at least 1 s; how the rest splits between the hub's exit and `ps` passes at this load wasn't measured.

### The unmodified files on the redraft

Each file ran once, whole, through the same runner, after the copies were deleted (`logs/unmodified/`). The forced runs and the `processes` and `timeouts` runs loaded `helpers.mjs` before one last edit, which only added "each test's end step" to the file's opening comment; the other runs loaded the delivered file.

```
unmodified/unmodified-processes  (load 235.43) → pass 2, fail 6, duration_ms 29917 | exited 1 at +30.0 s | no new ds56m. process after the run
unmodified/unmodified-timeouts   (load 235.53) → pass 3, fail 1, duration_ms 258540 | exited 1 at +258.7 s | no new ds56m. process after the run
unmodified/unmodified-leases     (load 258.97) → pass 0, fail 4, duration_ms 201114 | exited 1 at +202.5 s | no new ds56m. process after the run
unmodified/unmodified-typecheck  (load 254.12) → pass 8, fail 0, duration_ms 330129 | exited 0 at +331.2 s | no new ds56m. process after the run
unmodified/unmodified-decision   (load 218.47) → pass 9, fail 1, duration_ms 77342 | exited 1 at +78.8 s | no new ds56m. process after the run
probe-scratch-only               a test calling only scratch(t)  → pass 2 of 2: its folder, with a file planted in it, is gone once it ends; the test took 70 ms, with no sweep to wait on
```

`processes.test.mjs`: the six failures are all the 2 s real-clock window. Five fail at `fiveHanging`'s "<hold>'s check and grandchildren run before anything stops them", and one at "a cancel of s0 leaves h3-s2 running": by the time the test looked, the hold's 2 s had passed and the hub had stopped it. These tests took 3.6 to 5.6 s each, end step included, and each failure comes before the end step runs, in code this change doesn't touch (`living()` with one marker matches as before). Round 1's main-helpers copy of the cancel test, whose code is the file's up to that point, failed at the same check at load 214. The two tests that don't depend on that window passed.

`timeouts.test.mjs`: both `[plain]` tests and `[effect]`'s real-clock test passed. `[effect]`'s virtual-clock test passed 16 of 20 runs. In runs 13, 17, 18 and 20, `h3-hung` "timed out on the virtual clock, not after 2 s of wall time" took 2202 to 3057 ms of wall time from request to reply, against the test's bound of 1700 ms. That bound is on wall time inside each run, before the test's end step, which runs once after all 20 runs. So it is load.

`leases.test.mjs`, at load 245 to 259: both 50-session tests failed the hold-due check, at 2268 and 2254 ms against the 2250 ms bound. That is the load failure LEASES-REDRAFT.md describes. Both randomized tests had runs that "replied long after the 2 s timeout": 30 of 1,000 on plain, and 573 of 1,000 on effect, 259 of them with no reply in 5 s. Each failure is in the test's body, before its end steps run. The file still exited when its run ended (node's 201.1 s, exit at +202.5 s), with no new marked process: four tests that failed with holds in flight, all cleaned up.

`typecheck.test.mjs` passed 8 of 8, its two runtime-error tests through `setup()` among them.

`decision.test.mjs` passed 9 of 10. `[effect] the bench holds 50 sessions' hooks …` failed because the spike's bench, run through `spawnSync`, had a hold time out at load 218 (`hold timed-41 came back … "timeout"`). That test uses no fixture, hub or scratch folder from the helpers. Its `scratch(t)` test passed in 66 ms, which suggests the record's decision took the branch that never calls `scratch()`; this job didn't read the record to check. So a probe in the scratchpad (`probe/scratch-only.test.mjs`, run against the redraft) calls only `scratch(t)`, plants a file, and checks in a second test that the folder is gone.

### The wait ratchet

`node scripts/wait-ratchet.mjs`, run once on the final code with the copies deleted (`logs/wait-ratchet.log`), prints no line for any `tests/acceptance/56/` file. So each is at its ceiling, `helpers.mjs` still at 6. It exits 1 on 71 findings in 29 files of 18 other issues' suites (1120, 1518, 1558, 194, 2109, 2200, 2227, 2581, 2645, 2647, 2674, 2699, 2856, 2898, 2924, 551, 594 and 667), which this change doesn't touch.

### Runs that didn't reach the forced line

These came before the copies' last form. Each still failed with its own holds in flight, so they are listed, but they don't count as the forced case.

```
round1/processes-forced.base     real-clock hub (load 214.71) → fail 1 at fiveHanging's "h1-s0's check and grandchildren run before anything stops them": by the time the test looked, the hold's 2 s had passed and the hub had stopped it | exited 1 at +11.5 s, 0.2 s after | left 0
round1/processes-forced.redraft  real-clock hub (load 214.34) → the same failure | exited 1 at +14.9 s, 0.2 s after | left 0
round2/processes-forced.base     (load 208.16) → fail 1, 'timed out after 15000 ms waiting for the extra hold and its grandchildren to run' | exited 1 at +59.5 s, 0.2 s after | left 3: h6-extra's check and 2 grandchildren, all three running at the exit though the wait never saw them together
round2/processes-forced.redraft  (load 220.94) → fail 1, the forced failure | exited 1 at +71.5 s, 0.2 s after | left 0
round2/leases-forced.base        real-clock hub (load 224.21) → fail 1, 'timed out after 15000 ms waiting for checks and their grandchildren to run' | exited 1 at +24.7 s, 0.2 s after | left 0, by the lease file's own end step
round2/leases-forced.redraft     real-clock hub (load 217.99) → the same failure | exited 1 at +31.2 s, 0.1 s after | left 0
```

After round 1, the processes and typecheck copies moved to the virtual clock. After round 2, the extra hold's wait went from 15 s to 90 s, and the leases copy took the same extra hold, on the virtual clock.

## Not shown

- Only the `[plain]` variant was forced. The end step doesn't depend on the variant, but no `[effect]` hub was forced to fail.
- Each forced case ran once per side in its final form, at load 174 to 260. No repeats, so a rare race isn't ruled out.
- Why a hub-started check shows in `ps` as `(node)` is still not explained (LEASES-REDRAFT.md). The 1 s window covers the late grandchildren seen so far. A check that becomes visible only after the window, and writes its counter and start line before the folder goes, could still leave one grandchild: the delete would make its next write throw after its first grandchild started. No run here hit that.
- A PID found by marker is killed a few milliseconds after `ps` listed it, so a reused PID in that gap would be hit. The suite's earlier steps had the same gap.
- After a timeout, the test's function keeps running until it ends on its own. The helpers refuse to start anything for it, but the function's own waits (such as `waitFor`'s polling of `ps`) go on until they run out.
- The `processes`, `typecheck` and `leases` copies ran their hub on the virtual clock, unlike the files. At load ~210, holds on the real clock hit their 2 s timeout before the test could see their checks running (rounds 1 and 2 above). The end step doesn't read the clock, but a forced failure on a real-clock hub isn't shown.
- That every test which passes on main still passes. At load 218 to 259, 6 of 8 `processes` tests, all 4 `leases` tests, `[effect]`'s virtual-clock test in `timeouts` and `[effect]`'s bench in `decision` failed on timing checks, in their bodies before any end step. They weren't rerun at a lower load, and only the `processes` cancel test's failure was also seen on main (round 1). Each run still exited and left no marked process.
- `decision.test.mjs`'s own `scratch(t)` branch. The record's decision seems to skip it, so the scratch-only probe stands in for it.
- The suite's time with and without the change. About 1 s per test with a fixture is an estimate from the code, not a measurement.
