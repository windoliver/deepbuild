# Blind redraft of `#56.80ab2a58`'s lease tests

Request: windoliver/deepbuild#2804. If a test in `leases.test.mjs` failed before its sampler's `stop()`, the sampler kept polling the dead hub every 25 ms. `[plain] 50 sessions` fails that way at its hold-due check under load. node's test runner waits for the file's process to exit, and it never did, so the node lane of `affected.mjs` hung for hours. Two files changed: `leases.test.mjs`, and `README.md`'s `#56.80ab2a58` row, which now describes the end step and points here. No assertion, number, timeout or helper behavior another file uses changed.

## Open question for the user: the criterion's 30 s in a whole-file run

The criterion reads: with `[plain] 50 sessions` made to fail at its hold-due check, `node --test tests/acceptance/56/leases.test.mjs` exits within 30 s of that test's failure and reports it. **This redraft doesn't meet that as written.** `[plain] 50 sessions` is the first of four tests, and after it fails, node runs the other three. Here they took 75 s at load 40 to 60, and about 160 s at load 100 to 120. The file exits about 1 s after its last test ends. To exit within 30 s of the first failure, the file would have to skip its remaining tests, and that would change what it proves. The redraft doesn't do that.

What is shown instead:

- run alone with `--test-name-pattern`, the failed test leaves the file exiting 0 to 1 s after the failure;
- run whole, the file exits about 1 s after its last test, where the old file never exits.

Whether that meets #2804 is for the user to decide, perhaps by amending the criterion, for example to "exits within 30 s of its last test ending". Until then, this redraft is `Part of #2804`.

## What this job read

- Issue #56 with its comments, and #2804 with its comment.
- `docs/technical-design.md`, the Dogfooding bullet.
- This suite's own files: `README.md`, `helpers.mjs`, `fixtures/`, `leases.test.mjs`, `BUDGETS-REDRAFT.md`.
- `AGENTS.md`.

This job didn't read #56's implementation, other issues' tests, other branches or PRs. It reached the hub only through `helpers.mjs`, as the tests do.

## The change, and why

Each test now gets its hub, fixture and sampler from `setupLeases(t, variant)`, a local function in the file. It registers one end step with `t.after` **before** it calls `setup()`. node runs a test's end steps in the order they were registered, whether the test passes, fails or times out, so this step runs first. It:

1. stops the sampler, the loop #2804 found still running;
2. kills the hub with SIGKILL, as `startHub`'s own end step does, and waits for it to exit;
3. SIGKILLs every process whose command line carries the test's random marker (`living(fx.run)`), every 50 ms or so. It stops once 1 s has passed since the hub exited **and** a pass finds none, and after 5 s at most.

If the test has already timed out when `setup()` returns (`t.signal.aborted`), node may have run this step already, before `setup()` set `started`, or may be about to run it. So `setupLeases` runs the step itself and throws instead of starting the sampler. Running the step twice, even at once, is harmless: each part checks first or ignores a process that's already gone.

Why each part is there, from what the wrong programs showed:

- **Stopping the sampler** is #2804's own cause.
- **Running before the helpers' end steps.** A test that fails mid-workload still has holds running. The helpers' first end step deletes the scratch folder while those checks still write `checks.jsonl`. The next step, `fixture()`'s cleanup, reads that file. Sometimes it read a broken line and threw, and node then skipped the test's remaining end steps, among them the hub kill and any step registered after them. Two earlier drafts registered their step after `setup()`. In the randomized forced-failure case, they hung in 3 of 8 runs (logs below). Node's diagnostic report showed a live hub child and the sampler's timer still re-arming, and the scratch folder was half deleted. Stopping the hub and its checks first leaves those steps nothing to race.
- **Sweeping marked processes.** A hub killed with SIGKILL leaves its checks' process groups behind (README: a restart reaps them). On a pass, every hold has ended and the test asserts no process is left. On a failure, holds are still running, and their grandchildren (`sh` loops that ignore SIGTERM) would outlive the file. The marker is random per test (`ds56m.<hex>.`), so the sweep stops only what this test started, as `fixture()`'s cleanup already does.
- **Sweeping for a second, not just until the first empty pass.** The third draft swept only until a pass found nothing. In 2 of 8 runs with both 50-session tests forced to fail, `sh` grandchildren were left behind: 10 in `redraft/round2/p2a-new-bothhold-50.log`, and 9 in `redraft/round2/diag-bothhold-2.log`, whose `.txt` log shows the step finishing with no sweep pass logged. The other runs were `redraft/p2a-new-bothhold-50.log` and `redraft/round2/diag-bothhold-{1,3..6}.log`. Diagnostic copies then logged every process near the hub's PID for 2 s after the hub exited (`redraft/round3/diag3-*`, `diag4-*`, `diag5-*`). What they show:
  - The checks still running (`fixtures/check.mjs`, each leading its own process group with parent 1 once the hub is gone) show in `ps` as `(node)`, without their arguments, so without the marker. A check started outside the hub, by a probe here, showed its arguments at once (`scratchpad/probe/argv.mjs`). So `ps` doesn't hide every new node process this way, and **why the hub's checks show as `(node)` is not explained.** These checks exit on their own a moment later; every one was gone 2 s on (`diag5-*`).
  - Before exiting, such a check can start its marked `sh` grandchild after a sweep pass. In `diag3-bothhold-09.txt`, the effect test's first look at about +45 ms found nothing, and 7 grandchildren appeared at +126 ms. A loop that stops at the first empty pass misses them, and that is the leak above.
  - Nothing ever matched the hub's state folder, so the previous draft's `living(state)` is dropped.
  - With the window, `redraft/round3/final/diag6-bothhold-{01..15}.txt` logs every pass of the step's loop (code from before the `try`/`catch` edit). Of 30 test ends, 18 caught 1 to 4 more processes after the first pass (41 in all), the last at +114 ms. No first pass came back empty in these runs, at load 6 to 8, so the late-start case wasn't hit again. All 15 runs left 0. The 1 s window is a margin over the latest late start seen (+136 ms in `diag3`) and isn't proven enough under heavy load. A check slower than that to start its grandchild would still leak one.
- **A timeout inside `setup()`.** node aborts the test's signal and runs its end steps without waiting for the test's function. End steps registered after node has finished running them never run, so `startHub`'s own kill can be lost. Without the check, the sampler and hub would start after the test was over.

Not changed: what each test asserts and in what order, `HOLD_MS`, `SESSIONS`, `POOL`, `RANDOMIZED_RUNS`, the 120 s and 300 s test timeouts, and `helpers.mjs`. On a pass, the end step kills only the hub, as `startHub`'s own end step would. Its sweep finds nothing but still costs about 1 s per test (some 20 `ps` runs). A `ps` that fails counts as an empty pass, so the step never throws from the sweep and node still runs the helpers' end steps after it.

## Behavior → source → wrong program

The redraft adds no assertion. Its proof is that a failure still ends the file, and that the tests still pass.

| Behavior | Source | Wrong program it is shown on |
|---|---|---|
| A failed 50-session test stops its sampler. Run alone, the file exits within 30 s of the failure (0 to 1 s) and reports it. Run whole, it exits about 1 s after its last test (see the open question) | #2804: "the file ends and reports its failure"; criterion: exits within 30 s of that test's failure and reports it | `[plain] 50 sessions` with its hold-due check forced false; both variants' hold-due checks forced false |
| A test that fails mid-workload, with holds and checks still running, ends the file and leaves nothing running | #2804: "A failed 56/leases test leaves nothing running" | The randomized test forced to fail at run 100, before its sampler stop |
| A test that times out mid-workload, or inside `setup()`, does the same | Same | The randomized test with its timeout cut to 8 s (mid-workload) and to 300 ms (inside `setup()`) |
| No process a failed test started outlives it | Same | Every case above: no marked process is left 5 s after the run |
| Every test that passed before still passes | #2804: "No change to what the tests assert" | The unmodified redraft, run whole |

## Evidence

The wrong programs were throwaway copies (`zz-wrong-*.test.mjs`) of the redraft (`new`) and of the file at `8bfb6a633` (`old`), each with one forced change. All are deleted now. Each copy ran through a runner that puts `node --test` in its own process group, kills only that group at a limit, and logs the exit time measured from the first `✖` line. A wrapper then counted processes carrying a test marker that weren't there before the run ("left"). Runs went one at a time on Node v24.22.0. Every log's first line holds its load average. Logs are in the job's scratchpad, `redraft/`.

### The delivered code

These runs used the file as delivered:

```
redraft/round4/p1a  [plain] 50 sessions forced, alone (load 9.56)           → fail 1 | exited code 1 at +2 s; 0 s after first failure | left 0
redraft/round4/p3   unmodified, whole file (load 8.93)                       → pass 4, fail 0, duration_ms 49721 | exited code 0 at +50 s | left 0
redraft/round5/p2c8 randomized timeout cut to 8 s, both (load 95.39)         → cancelled 2, 'test timed out after 8000ms', reported at 27.9 s and 25.7 s | exited code 1 at +56 s | left 0
redraft/round5/p2f  randomized timeout cut to 300 ms (inside setup()), both (load 214.66) → cancelled 2 | exited code 1 at +6 s; 3 s after first failure | left 0
```

### Just before the last edit (`redraft/round3/final/`), load 6 to 9

These runs predate the last change, which made a failing `ps` in the sweep count as an empty pass (the `try`/`catch` around `living()`). Whenever `ps` succeeds, the step behaves the same as it does now.

```
p1a  new, [plain] 50 sessions forced, alone        → fail 1 | exited code 1 at +2 s; 0 s after first failure | left 0
p1c  new, [plain] 50 sessions forced, whole file   → pass 3, fail 1, duration_ms 44753 | exited code 1 at +45 s | left 0
p2e  new, randomized forced at run 100, [plain], ×6 → 6 of 6 exited, 2 to 4 s after the failure | left 0 each
p2c8 new, randomized timeout cut to 8 s, both      → cancelled 2, 'test timed out after 8000ms' | exited code 1 at +23 s | left 0
p2f  new, randomized timeout cut to 300 ms (inside setup()), both → cancelled 2 | exited code 1 at +6 s | left 0
p3   new, unmodified, whole file                   → pass 4, fail 0, duration_ms 46108 | exited code 0 at +47 s | left 0
diag6 ×15, both 50-session tests forced            → every run fail 2, exited 1 s after the first failure | left 0
```

In `p1c`, the four tests' durations add up to 44.7 s and the file exited at +45 s, within about 1 s of its last test.

The previous draft (marker or state folder, until the first empty pass) passed these as well, at load 14 to 64 (`redraft/round2/final/`). Its randomized forced-failure case exited 12 of 12 times, 3 to 4 s after the failure. Its both-50 forced case left 0 in 12 of 12 (`redraft/round2/p2a2-new-bothhold-{01..12}.log`). Its unmodified whole file passed 4 of 4 at load 59. The hangs in earlier drafts came at load 100 or more, and this round ran at much lower load. So the counts say less than they would under that load, and the proof rests as much on the mechanisms above.

**Timeout cases: time spent in end steps.** A timed-out test is reported only once its end steps finish, so its duration minus its timeout is roughly that time. In the delivered code's `p2c8` (`round5`, load 95), the tests timed out at 8,000 ms and were reported at 27.9 s and 25.7 s, so the end steps took about 20 s and 18 s. The file exited at +56 s, right after its last test. In `round3/final`'s `p2c8` (load 7), they were reported at 10.6 s and 10.7 s: about 2.6 s. The previous draft's `p2c8` (`redraft/round2/final/`, load 45) reported at 14.2 s and 13.4 s: about 6 s and 5 s. An earlier draft's run (`redraft/p2c-new-timeout-randomized.log`, load 111 at its start) timed out at 20,000 ms and reported at 49.0 s and 60.2 s: about 29 s and 40 s. Most of that is likely `fixture()`'s cleanup, which spawns `ps -p` once for every check PID recorded (hundreds in the randomized test). That is unchanged helper behavior, and this job didn't measure the split. So the sub-30 s figures above apply to the 50-session case. A timed-out randomized test can take tens of seconds under heavy load before it is reported, and the file then exits about 1 s after its last test.

### The old file at `8bfb6a633`

```
redraft-attempt2/p1b, redraft/p1b  [plain] 50 sessions forced, alone → still running at +120 s; HUNG
redraft/p2d  randomized forced at run 100, [plain] alone              → still running at +120 s; HUNG | left 1
```

### Earlier drafts, randomized test forced to fail at run 100 (load 60 to 176)

Draft 1, `t.after(stop)` in `sampler()` only: 1 of 5 hung.
- `redraft-attempt1/p2-new-random-whole.log` HUNG
- `redraft-attempt1/cap-random-whole.log`, `diag-random-whole.log`, `diag2-random-whole.log`, `diag-random.log` exited (the `diag-*` copies add only an unref'd logging timer)

Draft 2, plus the marker sweep, registered after `setup()`: 2 of 3 hung.
- `redraft-attempt2/p2b-new-random-whole.log` HUNG
- `diag/capB.log` HUNG, with Node reports beside it: a live plain hub child, and a referenced timer at `firesInMsFromNow: 8`
- `diag/capA.log` exited

Draft 3, the step registered before `setup()`, sweeping the marker until the first empty pass: 10 of 10 exited.
- `redraft/p2b-new-random-whole-{1..4}.log`, `redraft/round2/p2e-new-random-plain-{01..06}.log`
- It leaked processes in 2 of 8 runs with both 50-session tests forced, as above.

Draft 4 added the state folder and the `t.signal.aborted` check: 12 of 12 exited (`redraft/round2/final/`). The final draft swaps the state folder for the 1 s window.

Not counted: `redraft-attempt1/p2-new-timeout-randomized.log` and `cap-timeout.log` (HUNG) and `diag2-timeout.log` (exited). They used a 4 s timeout that fell inside `setup()`, the case the `t.signal.aborted` check now covers; `cap-timeout.log`'s reports show the effect hub still alive. Also not counted is `redraft-attempt1/diag2-load1.log`: a whole file with the plain hold-due check forced, killed at 240 s at load 176 after all four results printed. It can't be told apart from a slow run. Nor is `redraft/round2/final/p2c-new-timeout-randomized.log`: its 20 s timeout never fired at load 47, both tests passed, so it tested nothing. The 8 s run (`p2c8`) replaced it.

### Unforced hold-due failures

At load 100 to 140, the unforced 50-session tests sometimes failed their hold-due check, by 2251 to 2316 ms. That is the load failure #2804 reports, and it happens at the first assertion, which the redraft doesn't touch. Draft 3 was run as a whole file at load 106 (`redraft/p3-redraft-whole.log`): pass 2, fail 2, both 50-session tests at 2283 and 2258 ms, exited at +163 s. The old file, run right after at load 140 (`redraft/p3-current-whole.log`), passed 4 of 4. Then the two 50-session tests ran alone in 8 pairs, alternating which file went first, at load 60 to 121 (`redraft/ab-{1..8}-{redraft,current}-50.log`). `[plain] 50 sessions` passed 8 of 8 in both files. `[effect] 50 sessions` failed in 5 of 8 runs of draft 3 and 4 of 8 runs of the old file. Every old-file failure hung. Every draft 3 run exited 0 to 4 s after its last test. One failure in eight is within noise, so this job reads those failures as load, not as the redraft's doing. The final redraft passed 4 of 4 whole at load 59 (`p3` above).

## Not shown

- The criterion's 30 s in a whole-file run, as the open question above says.
- Why the hub's running checks show in `ps` as `(node)`, without their arguments. The 1 s window covers the late grandchildren seen here, but a check slower than that to start its grandchild under heavy load would leak one.
- After a timeout inside `setup()`, the test's scratch folder stays in the system temp folder. Nothing in it runs.
