# Evidence for #3298: #27's three twins on main after #3178

Both runs are the real `node scripts/proof.mjs before`, on the Spark (Linux, 20 cores), in a GitHub clone of main
`254bdc87c` made for this (`run-whole-suite.sh` clones and builds; `run-pass.sh` reuses that clone). Each run has one
scratch commit on main that was never pushed. It says `Part of #27`, since the lane proves the issue its change names.
So "the change" in the lane's lines is main plus that scratch commit, and the lane's merge base is main. The redraft
tests named below are the ones PR #3249 (#3178) put in place of #27's first drafts.

| Run | Scratch commit | Output | 1-minute load, start to end |
|---|---|---|---|
| Whole suite | `twins.json` narrowed (the heredoc in `run-whole-suite.sh`) | `before-lane-whole-suite.txt` | 103.5 to 100.5 on 20 cores |
| Pass A | the same, and a scratch `scripts/lanes.mjs` (`scratch-commit-A.txt`) | `before-lane-pass-A.txt` | 120.8 to 78.4 on 20 cores |

Loads are from `steps-spark.txt`, read only at each run's start and end. The Spark's thermal state wasn't recorded.

## Criterion 1: `repeat-reaches-you` (AC2 `#27.6e863673`): proven

`before-lane-pass-A.txt`. The lane prints `PASS before: … failed on <twin> at its assertion` only for a test that
passed on the change and failed at an assertion with that twin laid over it (`before`, `wrongProgram` in
`scripts/proof-runs.mjs`). Both tests of `tests/acceptance/27/redraft-3178/repeat.test.ts` read so:

```
PASS before: …/27/redraft-3178/repeat.test.ts › … the same question asked again in a new session …: failed on repeat-reaches-you at its assertion
PASS before: …/27/redraft-3178/repeat.test.ts › … asked again with a recommendation (blue) …: failed on repeat-reaches-you at its assertion
```

The scratch commit changes no file these tests or the hub read, so passing on the change is passing on main.

## Criterion 2: `answer-skips-held-stop` (AC4 `#27.e6116d56`): proven

Also `before-lane-pass-A.txt`, for the stop-hold test of `tests/acceptance/27/outcomes-redraft-3178/outcomes.test.ts`:

```
PASS before: …/27/outcomes-redraft-3178/outcomes.test.ts › … (a stop held while a Claude subagent still runs) …: failed on answer-skips-held-stop at its assertion
```

The file's five other tests read `FAIL … fails on neither the merge base nor its planted wrong program`. They passed
on the change, and the one twin laid for their tag didn't fail them. This run doesn't judge them. The scratch
`twins.json` left out AC4's three other twins, so it can't say whether those still fail them.

`redraft-3178/waits.test.ts` also holds an AC4 stop-hold test. A pass B for it was started and stopped before it
reported (`B before` in `steps-spark.txt` has no `done` line). Nothing is claimed for it.

## Criterion 3: `waiter-checks-every-5s` (AC5 `#27.ffbe7d6f`): not proven, INCONCLUSIVE

The criterion needs a reference Mac (Mac15,7 or Mac15,12, from `REFERENCE_MACS` in `tests/acceptance/27/helpers.ts`)
loaded no more than its core count. None was reachable (`mac-reading.txt`). The only Mac is a Mac18,1, which
`environmentProblem` rejects whatever its load is, and its load was 69 on 12 cores. `budgets.test.ts` was not run
with the twin or without it. In the whole-suite run it read `INCONCLUSIVE no grant: no timed grant came within 15
minutes`, and in pass A it was by hand. No budget reading was taken and none is claimed.

## Why the lane was narrowed

Main has 36 test files tagged with #27's criteria: suite 27, and files of suites 55, 70, 994, 3178, 3428, 3429 and
3430 that name its IDs. Main's `byHand` list holds 12 of them, which leaves 24 for the lane. In the whole-suite run,
none was judged. 22 read `BLOCKED … cannot run on the change: the run was stopped after 20 minutes`, and the 2 budget
files read `INCONCLUSIVE no grant`. The lane's last line there, `PASS before: no tagged test to run on the merge
base`, is a pass over no test and proves nothing. `runTests` (`scripts/proof-runs.mjs`) gives each side's vitest files
to `runVitest` in at most two calls (files that start no hub, then files that do), one file at a time, each call under
one 20-minute `TIMEOUT`. 22 files didn't finish inside that. Whether they would on a quiet machine wasn't tried.

Pass A's scratch commit therefore adds every one of the 24 except the two kept files to `byHand` in a scratch
`scripts/lanes.mjs`, so the lane's vitest call holds only those two. Both scratch commits narrow `twins.json` so that
each tag lists only the twin #3298 names. The lane prints only the first twin that fails a test, so with AC4's four
twins listed, its line might not name `answer-skips-held-stop`.

This PR changes no twin, test, helper or lane script.
