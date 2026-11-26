# Acceptance tests for #3567: a change's affected run ends within its bound

A blind job wrote these tests before any work on #3567 existed, from these inputs only:

- issue #3567: its Why, its Scope, its six acceptance criteria and its Not in scope;
- the issues it names, for the words it cites: #2673 (the three fixture changes), #2627 (the idle stop), #3512 (the
  `slow` list), #3478 and #3553;
- the design sections it links: `docs/technical-design.md`, "How we know version 0 works", and
  `docs/parallel-proof.md`, sections 6 and 7a; `AGENTS.md` and `CONTRIBUTING.md`;
- the base commit `f063c8098`, which has no bound. There I read `scripts/affected.mjs`, `scripts/throttle.mjs`,
  `scripts/lease`, `scripts/lanes.mjs`, `scripts/lanes-lists.mjs`, `scripts/proof-binaries.mjs`, the two proof
  reporters, `scripts/wait-ratchet.mjs` and `scripts/repo-rules.mjs`, to learn how a run is called, what it prints and
  what the lint lane holds a suite to; and the suites `2627`, `3221`, `2574`, `1115` and `3065` for conventions.

No test imports the code under test, and the helpers are written here. Per AGENTS.md the implementing agent doesn't
edit these files; a dispute goes to a blind redraft by this job.

## Run

```sh
node --test 'tests/acceptance/3567/*.test.mjs'
```

They must run under `node --test`: only inside a test run does a request keep a table of its own
(`docs/parallel-proof.md`, section 6). They are offline, on real processes: this checkout's real `scripts/affected.mjs`,
`scripts/throttle.mjs` and `scripts/lease`, real `node --test` jobs and a real vitest job, in a scratch git
repository. Stubbed, at boundaries #3567 doesn't own: `cargo` and `npm` (first on `PATH`) and the lint lane's own
scripts.

With the files side by side the suite took 81 s on a program that held the criteria (the throwaway guess, below) and
132 s on the base, at a 1-minute load of 23 to 86 on 18 cores. One file at a time it is the sum of the tests' own
times: 5.3 minutes there, and 7.8 on the base, where six runs go on to their 65 s limit. Each test has its own limit,
and each run it starts has one too: a run past its limit is stopped by its own process group and the test fails with
the output so far.

**No test reads or writes the machine's table at `~/.deepbuild/throttle/`.** Every process a test starts gets a
temporary `HOME`, a `DEEP_THROTTLE_TABLE` folder and a `TMPDIR` in the test's sandbox, with `DEEP_THROTTLE`,
`DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_TEST_GRANT_WAIT`, `DEEP_TEST_GRANT_STALL`, `DEEP_JOB_IDLE_MIN`,
`DEEP_AFFECTED_MIN`, `DEEP_SHARDS`, `DEEP_THROTTLE_READINGS`, `NODE_OPTIONS`, the jobserver variables and others unset
unless the test sets one. Each run and each neighbour starts in a process group of its own and is stopped after its
test by that group's PID; a process a fixture noted is stopped by its PID while its start still matches. Nothing is
stopped by name or port, and the sandbox is removed.

No `lane.json`: the suite needn't run alone. With the files side by side at a 1-minute load of 86, the four tests of
the guess that had a job to stop took 39.7 to 40.1 s each, tree and checks included, so each run ended some 5 s
inside its 45 s. No line is needed anywhere else in the repository.

## The setup (`helpers.mjs`)

- **A scratch tree** (`tree`): a copy of this checkout's `scripts/` with each script of the lint lane stubbed, an
  empty known-failures baseline, a vitest config, a folder of links to `node_modules`, and the test's files, committed
  in a fresh repository whose `origin/main` is that commit. `cargo metadata` reports the fixture's crates, `cargo test`
  prints what libtest would, and `npm run build --workspaces` exits 0.
- **A run** (`start`, `affected`): `node scripts/affected.mjs ...` in the tree. Its start is the moment its process
  exists, read on the test's clock as soon as the process is started; its end is its exit.
- **The fixtures**, all `node --test` files unless said: one that never ends (its one test never settles, and it has
  started a child that ignores SIGTERM; both note their PID and start); one that notes that it started and would pass
  two tests; one whose one test fails at once; one whose test takes a given time.
- **A file that waits for the parallel block** is in the alone block by its own folder's `lane.json` in the scratch
  tree (`tests/acceptance/900003567/`): with one alone folder the run makes no shard and starts it in the worktree
  once the parallel block has ended.
- **A neighbour** (`hold`): `node scripts/throttle.mjs <class> --wait 30 -- node hold.mjs`, another session's grant in
  the sandbox's table. For the test class one neighbour and readings of no memory (`DEEP_THROTTLE_READINGS`) keep a
  second grant out on either platform; for the build class two neighbours fill the one slot of macOS or the two of
  Linux, the one left in line being ahead of the run.

## The surfaces assumed where the issue is silent

1. **The bound** is `DEEP_AFFECTED_MIN` minutes, counted from the run's start, as the issue says. The tests set 0.5,
   30 s ("set to seconds").
2. **"Ends within the bound and 15 s more"** is the time from the run's start to its exit, at most 45 s. It is held of
   every run that reaches its bound (criteria 1 to 4): the Scope's first line is for the run, its waits for a grant
   included, and the first criterion's 15 s is the only allowance the issue gives. A run still going 65 s after its
   start is stopped by the test.
3. **"Reads INCONCLUSIVE"** is the summary, the last line holding ` affected: `, starting `INCONCLUSIVE affected: `,
   and the exit 2; **a FAIL's** is `FAIL affected: ` and the exit 1. Both are the base's.
4. **"Naming the file"**: a line of stdout starting `INCONCLUSIVE` holds the file's repo path, and no line starting
   with another state (`PASS`, `FAIL`, `NEW FAIL`, `KNOWN`, `BLOCKED`, `INVALID`, `NO NEW FAILURES`) does.
5. **"Named as not started"**: a line starting `INCONCLUSIVE` holds the file's path and says `not started`, `never
   started`, `not yet started`, `didn't start` or the like (`NOT_STARTED` in the helpers). `not run` alone is not it.
6. **"No test of it reads PASS"**: the summary's `<n> passed` is 0 or absent (the file's tests are the only ones that
   could pass in that tree); no line starting with a state other than `INCONCLUSIVE`, `BLOCKED` or `INVALID` names the
   file; and in the `--results` file, when the run writes one, neither the file's row nor the run's state is `PASS`.
7. **"In the summary as FAIL"**: a line starting `FAIL` or `NEW FAIL` holds the test's file and name, beside the
   `FAIL affected: ` line.
8. **A run's first grant** is its test grant, or the build grant for its binaries when its selected tests need one
   (section 6); each has a test. **"Naming the class"**: a line starting `INCONCLUSIVE` holds, beside the paths it
   names, the word `grant` and the class's name, `test` or `build`. The base's lines for a missing grant read so.
9. **"Still waiting at the bound"**: the run got no grant, started nothing, and did not end more than 15 s before its
   bound.
10. **"Holds no request in the throttle's table afterwards"**: within 5 s of the run's exit `<table>/table.json`, as
    its last writer left it, holds no request and no grant but the neighbours' (by their throttles' PIDs), and no
    process is left in the run's process group, so none still asks.
11. **"Leaves no process it started"**: within 5 s of the run's exit, neither process the stuck file noted runs (by
    PID and start; a zombie runs nothing), and no process is left in the run's own process group. The Scope's "gives
    back its grants" is held with it: the table then holds no grant and no request.
12. **"The lines it prints today, but for times"**: the run's stdout, every line in order, and its exit status.
    Standing for a time: the summary's `in <n> s at load <n>` (the load is the machine's reading at that moment), the
    sandbox's folder and the random name of the logs folder. The `TIMED` line must be the tree's own timed list, whole,
    as `scripts/lanes.mjs` exports it, so the list may change without the suite. stderr is not held.
13. **"Ran over 10 minutes"** is read by the run's own clocks, which the test sets: see Criterion 6.

## Criteria to tests

The ID is `#3567.<first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed>`, as
`scripts/proof-change.mjs` works it out. Each wrong program is the work with a single fault, named so the implementer
can plant it as a twin; the one in bold is its criterion's. I planted each in a throwaway guess (below) and saw the
test fail with the message quoted.

| Criterion | Test (file) | What it holds | Wrong program, and the test's message on it |
|---|---|---|---|
| 1 `#3567.3092e5a6` | `bound.test.mjs`, first | One selected file, which never ends. The run ends within 45 s of its start, reads INCONCLUSIVE with exit 2, names the file on an INCONCLUSIVE line and on no other state's; the file had run (both its processes noted); afterwards neither of them runs, the run's process group is empty, and the table holds no grant and no request | **`waits-for-the-file`**: at the bound the run stops no job and goes on waiting for the one still running. "affected.mjs did not end: with DEEP_AFFECTED_MIN=0.5 (30 s) it was still running 65 s after its start, waiting for tests/fixture-3567-stuck.test.mjs, which never ends" |
| 1 `#3567.3092e5a6` | `bound.test.mjs`, second | The same file and the same checks, after the run waited 10 s for its test grant behind a neighbour, whose grant the test then ends: the 45 s still count from the run's start (Scope: "its waits for a grant included") | `counts-from-its-grant`: the bound counts from the test grant, not from the run's start. "affected.mjs ended 50.3 s after its start, not within its 30 s bound and 15 s more (45 s), counting the 10 s it waited for its test grant ..." |
| 2 `#3567.415647ec` | `unstarted.test.mjs` | A file that never ends in the parallel block, and a file in the alone block behind it. The second never starts (it notes nothing), the summary counts no pass, no line reads it as run, its `--results` row isn't PASS, and an INCONCLUSIVE line names it as not started | **`counts-unstarted-as-passed`**: at the bound each file of a job not yet started is counted as one passed test, not read INCONCLUSIVE. "the summary counts 1 passed, though the only tests that could pass are those of tests/acceptance/900003567/unstarted.test.mjs, which never started: the run counts it as passed" |
| 3 `#3567.02b8eb33` | `fail.test.mjs` | A file whose test fails at once is the parallel block's only one, so its job has ended and its failure is read before the alone block's file, which never ends, starts. The run ends within 45 s with `FAIL affected: `, exit 1, and a `FAIL` or `NEW FAIL` line naming the test | **`inconclusive-alone`**: a run that reached its bound ends INCONCLUSIVE, summary and exit, whatever failed before it. "the run's summary doesn't read FAIL, though the test tests/fixture-3567-fail.test.mjs › it fails before the bound failed 5.8 s after the run's start, before its bound" |
| 4 `#3567.f4411929` | `grant.test.mjs`, first | A neighbour holds the test grant. The run ends within 45 s and not 15 s or more before its bound, INCONCLUSIVE with exit 2, having been given no grant and started nothing; an INCONCLUSIVE line names `test` beside `grant`; the table then holds no request and no grant but the neighbour's, and no process of the run is left | **`leaves-its-request`**: at the bound the run SIGKILLs the throttle that waits for its test grant and prints its lines, so that request stays in the table. "the run left its request in the throttle's table after it ended: a test request of pid <n>" |
| 4 `#3567.f4411929` | `grant.test.mjs`, second | The same for a run whose selected test starts a binary from `DEEP_BIN_DIR`: neighbours hold the build class, the run waits for the build grant of its binaries, and an INCONCLUSIVE line names `build` beside `grant` | `gives-up-early`: the run waits 3 s for its first grant, whatever its bound. "the run ended 3.5 s after its start, long before its 30 s bound: it was not still waiting for its build grant at the bound" |
| 5 `#3567.4cd7e4a4` | `today.test.mjs`, four tests | #2673's three changes, each one line committed above `origin/main`: in `packages/hub/src/core.mjs` (a vitest and a node test import it, and the package build runs), in `crates/deep-canvas-3567/src/lib.rs` (a node test reads it, `cargo test` passes one test and fails one that main already has, so the run reads `KNOWN` and `NO NEW FAILURES`), and in `docs/technical-design.md` (no test, the lints alone). `node scripts/affected.mjs` with no path and no bound set prints the base's lines and exits 0; the hub change does again with `DEEP_AFFECTED_MIN=10` | **`says-its-bound`**: every run prints a line naming its bound, `BOUND 60 min`, before its selection. "the run on the one-line change to packages/hub/src/core.mjs ended inside its bound, but doesn't print the lines it prints today", with the added line in the diff |
| 6 `#3567.58cd929d` | `slow.test.mjs` | Two files in one job, on clocks that run 20 times as fast: one takes 15 minutes of them, one well under 10. Both pass; exactly one line names the first with its minutes, and no line names the second with minutes | **`names-the-whole-job`**: every file of a job that took over 10 minutes is named with the job's minutes. "tests/fixture-3567-under.test.mjs ran under 10 minutes, yet a line names it with minutes" |

Seen failing too: a run that sends SIGTERM to the job and never stops its tree (`bound.test.mjs`: "tests/fixture-3567-stuck.test.mjs's own processes still run after the run ended: the run left processes it started").

Criterion 5's tests pass on the base, as they must: its lines are the ones to hold. The other seven fail on it.

## Criterion 6: how it is held, and what is not

The criterion names ten minutes of a real run, which no short test can spend, and the issue names no way to shorten
them. So the test changes the clock, not the limit: `NODE_OPTIONS=--require=<sandbox>/clock.cjs` gives every node
process of that one run clocks that run 20 times as fast as the test's (`T3567_CLOCK`), `Date` from a moment they all
share (`T3567_ORIGIN`). Scaled: `Date.now()`, `new Date()`, `performance.now()`, `process.hrtime()` and
`process.hrtime.bigint()` as any script of the run reads them (`affected.mjs`, the throttle, the reporters), and with
them the durations `node:test` reports from each test file's own process (`duration_ms` of a test's `test:pass` or
`test:fail`, and of that file's `test:summary`). Timers keep real time. The file that waits 45 s of the test's time
ran 15 minutes by those clocks; the file beside it, in the same `node --test` job, ran for the moment its process took.
The bound is set to 600 minutes, so no bound is near whichever clock it is read by.

Read as loosely as I could: the line that names the slow file may say anything, as long as it holds the file's repo
path and, beside the paths, a number over 10 and no more than the whole run's minutes by those clocks, its minutes.
Exactly one line of stdout may do so. No line that holds the other file's path may hold a number followed by `min`,
and the slow file's line may not name it.

What this can't hold:

- **Ten real minutes.** No file runs that long, so nothing shows the line on real clocks.
- **A measure the preload doesn't reach.** The `node --test` runner's own timing of a whole file (the file's
  `test:complete`, measured in the runner, whose clock is read before any preload runs: 3,058 ms where the file's own
  `test:summary` read 60,088), a count of timer ticks, file times, `ps`, or anything outside node keep real time, and a
  run that reads a file's minutes there would name nothing here. The implementer needs one of the scaled measures.
- **vitest files, files of the alone block or of a shard, and timed files.** Both fixtures are `node --test` files of
  the parallel block.
- **Several slow files**, one line each or one line for all: the criterion says "a file ... on one line".
- **What the line is for.** That it serves the `slow` list (#3512), or changes nothing else in the run, isn't
  asserted beyond the two passes the summary still counts.

## On the base

`BASE-FAILURE.txt` holds `node --test tests/acceptance/3567/*.test.mjs` at `f063c8098`, on the Mac. Seven tests fail,
each at an assertion and for the expected reason: with no bound the six runs of criteria 1 to 4 were still going 65 s
after their starts, waiting for the file that never ends or for a grant that doesn't come, and the test stopped each
by its process group; criterion 6's run ended as today, with both files passed and no line naming the slow one.
Criterion 5's four tests pass.

To tell a test's fault from a program's, I wrote a throwaway guess at the change in a scratch folder outside the
checkout (a mirror of `scripts/` with a bound in `affected.mjs` and each test's duration in the node reporter's rows)
and ran this folder's copy against it. All 11 tests passed, in 81 s side by side. With each single fault named above
planted in it, the test named beside it failed with the message quoted. `BASE-FAILURE.txt` ends with those runs'
result lines. The guess is deleted and proves nothing about the real change.

## What the tests can't see, and what I left out

- **The 60 minutes.** Only `DEEP_AFFECTED_MIN` at 0.5, 10 and 600 is run; that the bound is 60 minutes with the
  variable unset is not asserted.
- **Two Scope lines have no criterion and no test**: that `docs/parallel-proof.md`, section 7a, says so, and that
  `scripts/affected.mjs` is guarded by a signed approval tag naming the file.
- **Not in scope, so not run**: `affected.mjs --alone`, the preflight's block. No test holds that it has no bound.
- **The 15 s under any load.** The limit is the criterion's, measured on the test's clock from the run's start to its
  exit, with nothing added for a busy machine: the test waits for no time of its own, so only the run can be late. A
  run that stops its jobs as the idle stop does on the base (SIGTERM, SIGKILL to the tree 10 s later, then 5 s more
  before the job reads as ended) ends after the 15 s, not within them.
- **Only `node --test` jobs are stopped at the bound** in these tests. A vitest job, a `cargo test`, a lint, the
  package build, a timed file or a job in a shard still running at the bound is not tested; nor is a bound that comes
  while the run builds its binaries, or between its build grant and its test grant.
- **A pass read before the bound.** The issue says a FAIL stays a FAIL; what a pass in a stopped job reads isn't
  settled by it, so no file passes beside the one that never ends.
- **A file a job had not started** when the job was stopped (the runner's own queue) is not told from one that didn't
  finish: the file that never started here is in a job that never started.
- **How the jobs are stopped.** Only the outcome is seen: the processes are gone and the run ended in time. The order
  of SIGTERM and SIGKILL isn't observed.
- **The grant wait of #3478.** The base waits 30 minutes for each grant; a run that waits on a stall is not tested, but
  either wait is far past the bound, so the tests don't depend on which.
- **Linux.** Drafted and run on macOS (arm64, 18 cores). `ps -o lstart=`, `ps -o pgid=` and the `sh` stubs work on
  Linux too, and the build class's two slots are provided for, but nothing ran there.
- **Fixed waits**, each marked `// deadline:`: the 10 s the second run of criterion 1 waits for its grant, which is the
  fixture's schedule, and the limits that turn a hang into a failure. The 45 s is the criterion's own.

## Files

- `helpers.mjs`: the sandbox, the scratch tree, the fixtures, a run under its limit, the process table, the throttle's
  table and log, the neighbours, the scaled clock, and the checks every bounded run shares.
- `bound.test.mjs`, `unstarted.test.mjs`, `fail.test.mjs`, `grant.test.mjs`, `today.test.mjs`, `slow.test.mjs`: the
  tests, by criterion as above.
- `BASE-FAILURE.txt`: the run on the base, paths redacted.

No fixture holds a secret or personal data.
