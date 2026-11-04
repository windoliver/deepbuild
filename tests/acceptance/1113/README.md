# Acceptance tests for #1113: the per-machine throttle table (T5)

These tests were drafted blind from issue #1113 (its text on 2026-11-02), `docs/parallel-proof.md` (sections 6 and
10 to 12), the Dogfooding part of `docs/technical-design.md`, AGENTS.md and the base commit `74e6ff91`, which has no
implementation. At the base I also read `scripts/lanes.mjs`, `preflight.mjs`, `perf.mjs`, `benchmark.mjs`,
`proof-runs.mjs`, `proof-guard.mjs`, `proof-change.mjs`, `affected.mjs`, issue #1114 (T9a) and
`tests/acceptance/569/`, `821/` and `910/`. The helpers are written here, never imported from another suite. Per
AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing (affected.mjs imports typescript)
node --test 'tests/acceptance/1113/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. All 16 are offline and run on
real processes: `throttle.mjs` itself, stub holders (small node scripts that note when they start and end), and the
real preflight, perf, lanes, proof and affected scripts. Nothing under test is mocked. The suite takes about 50 s on
the Spark. About 40 s of that is the `affected.mjs` test, which runs the real lint jobs. Every other test takes a few
seconds. On the base all 16 fail at their assertions, as `BASE-FAILURE.txt` shows. That file also lists the planted
wrong programs and which tests caught each.

**Every test points `HOME` at a temporary folder**, so the lock table and log are
the sandbox HOME's `.deepbuild/throttle/`, never the real `~/.deepbuild/throttle/`. The sandbox also unsets
`DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_PREFLIGHT`, `DEEP_OPEN_ISSUES` and
`CARGO_TARGET_DIR`. Each process a test starts gets its own process group, and the test stops that group by its
PID when it ends.

## The surface (my choice where the issue leaves it open)

- **The CLI is `node scripts/throttle.mjs <class> [--wait <min>] -- <command ...>`.** The classes are spelled
  `build`, `bay-pair`, `test` and `timed`. `bay-pair` is my spelling of the issue's "bay pair".
- **`--wait` takes a decimal number of minutes.** The tests pass `0.02` (1.2 s), `0.05`, `0.25`, `0.5` and `1`, so no
  test waits minutes.
- **Exit status.** The CLI exits with the child's status. When the child is killed by a signal, it exits 128 plus the
  signal's number (143 for SIGTERM).
- **No grant.** On a timeout the CLI exits non-zero. Its first non-empty output line (stdout, or stderr when stdout is
  empty) starts with `INCONCLUSIVE no grant`, and the command never runs.
- **The grant is exported.** The command, and every process it starts, gets `DEEP_THROTTLE=<class>:<id>`. A request
  that passes through runs its command under the ancestor's grant, so the command sees the ancestor's `DEEP_THROTTLE`
  value unchanged. The test of a nested timed request under a timed grant reads it that way.
- **Limits follow section 6's table.** On macOS the Mac's limits apply: build 1, bay pair 1, test 2, timed 1. Anywhere
  else the Spark's apply: 2, 3, 4 and 1. The tests use these limits only to fill a class.
- **The throttle log.** It is any regular file directly under `~/.deepbuild/throttle/` whose name contains `log`,
  for example `log` or `throttle.log`. The tests read only lines that name a class. A line is either a JSON object or
  whitespace-separated `key=value` tokens. One line per grant, with these keys:
  - `class`: `build`, `bay-pair`, `test` or `timed`.
  - `grant`: `top-level` for a request with no verified ancestor grant, `nested` otherwise. A pass-through may be
    logged as `nested` or not logged at all.
  - `load`: the one-minute load when the grant was made.
  - `wait`: the caller's grant wait, in minutes.
  - `cores` (optional): when it's missing, the test uses `os.cpus().length`.
  Other keys and lines are ignored.
- **`acquire(class)` / `release(grant)`** aren't imported by any test. A failed import would be an error, not an
  assertion failure, so the base couldn't serve as the wrong program. They're reached through `preflight.mjs`,
  `perf.mjs` and `proof-runs.mjs`. `DEEP_PERF_LOCK` isn't tested on its own. AC7's preflight test shows that its
  perf child isn't BLOCKED, whether or not perf takes its lock there.

### Preflight and perf (AC7, AC8, AC9)

The preflight and perf run in a scratch git repository that holds a copy of this checkout's `scripts/`, with
`origin/main` at its one commit. Three things in that copy are fixtures:

- **The check workload.** `scripts/checks.mjs` is a stub. It notes its start time, burns 300 ms of CPU and exits 0.
- **The warm-up builds.** `npm` and `cargo` are stubs first on `PATH` that exit 0. `RUSTUP_HOME` and `CARGO_HOME`
  are in the sandbox.
- **The budget file.** `benchmarks/budgets.json` is outside git: a preflight budget of 900 s and no tasks. So perf
  has no merge-base budget, builds no copy, and passes with an INITIAL reading.

This assumes `preflight.mjs` still runs its check workload as the child `node scripts/checks.mjs`, as the base
does. Perf "started by hand" is `node scripts/perf.mjs '<observation>'` with a passing observation, as the preflight
would hand it. "Another session's" holders are `throttle.mjs bay-pair` (or `build`) stub holders started by the test,
outside the measured run's parent chain.

### The before lane (AC10, and AC8's 15 minutes)

`node scripts/proof.mjs before` runs, from this checkout, in a scratch repository. The change is
`Part of #9113`, a planted issue given through `DEEP_PROOF_ISSUES`, with one tagged test file. The tag is worked out
at runtime, so no file here carries it. The test file is what I assume is in the timed set: it calls
`environmentProblem(` at its own call site (T9a's seed rule), and the scene's own `scripts/lanes.mjs` exports
`timed = ['tests/acceptance/9113/']`. If T5 runs all of the before lane's spawns under timed, the file is in the
set too. Each run of the file notes its start time and its `DEEP_THROTTLE`.

## Criteria to tests

Each criterion's ID is `#1113.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test carries its tag at the start of its
name.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#1113.060e7bae` A wrapped command that exits 3 makes `throttle.mjs` exit 3, and one killed by SIGTERM exits 143 | `cli.test.mjs` | `throttle.mjs test --wait 1 -- node -e 'process.exit(3)'` exits 3. The test also runs a `sleep 30` child and SIGTERMs that child by its PID, and then the CLI exits 143 |
| AC2 `#1113.99a9da00` A no-grant timeout exits non-zero with `INCONCLUSIVE no grant` as its first line | `cli.test.mjs` | Build is filled with holders for 8 s. A `build --wait 0.02` request exits non-zero within 6 s, its first line starts `INCONCLUSIVE no grant`, and its command never ran |
| AC3 `#1113.ca815dac` A nested `timed` request under a `build` holder still drains …; nested `build` and `test` pass through | `drain.test.mjs`, two tests | (a) A build holder's descendants ask for build and for test (3 s wait each) while other chains fill both classes for 6 s. Both start before any outside holder ends. (b) Test holder B holds for 2 s, and build holder A asks for timed. Then build C and test D are asked for at top level. The timed command starts no earlier than B's end, and C and D start no earlier than the timed command's end |
| AC4 `#1113.a4cc0a86` The throttle log shows no top-level `timed` grant started at load > cores … | `load.test.mjs` | A top-level timed, then a top-level timed whose child asks for timed again (that request passes through: same `DEEP_THROTTLE`). The log holds exactly two top-level timed lines. Each has a numeric `load` below the cores and within 2 (or half) of the machine's load read then |
| AC5 `#1113.06c9ec7b` A forged `DEEP_THROTTLE` is ignored and a fresh grant is requested | `cli.test.mjs` | Build is full for 3 s. Two top-level requests carry a forged `DEEP_THROTTLE`: one is a live holder's real value, copied from outside its chain, and one is the made-up `build:forged-1113`. Each command starts only after a holder ended, under a value other than the forged one |
| AC6 `#1113.1f6072ef` Two `timed` requests nested in different chains both complete in request order …; so do two chains that each hold a bay pair … | `drain.test.mjs`, two tests | Two chains (build and test, then bay-pair and bay-pair) each ask for a nested timed with a 15 s wait, 600 ms apart. Both return 0, both commands run, and the second starts no earlier than the first ends |
| AC7 `#1113.74ef5038` A preflight, and separately a perf run started by hand, that requests `timed` while another session holds the Mac's bay pair waits …, then completes, and preflight's perf child is not BLOCKED | `measured.test.mjs`, two tests | A bay-pair holder holds for 3 s. The preflight's checks start no earlier than its release. The output has `RUN perf` and `PASS perf` and no `BLOCKED perf`, and the exit is 0. Perf by hand ends no earlier than the release, prints `PASS perf` and exits 0. Neither prints `INCONCLUSIVE no grant` |
| AC8 `#1113.a0183037` Each caller's grant wait matches the section 6 table | `waits.test.mjs`, three tests, and `before.test.mjs` | Read from the log's `wait`. A lane command (the `corpus` lane of `checks`, its script a stub, run through `runLanes`) is 30, and the lane's command runs under `build:` (an unlisted command). Preflight's and hand-started perf's top-level timed are 60 each. An `affected.mjs` job is 30: every top-level line of a run on a probe test is 30, a `test` line among them, and the probe runs under `test:`. The before lane's timed grant is 15 |
| AC9 `#1113.dadec762` A preflight run's measured time contains no throttle wait: the grant precedes the timer | `measured.test.mjs` | A build holder holds for 3 s. The preflight ends no earlier than its release. Its printed `preflight elapsed` and `Checks elapsed` are each at most (end − release) + 0.3 s |
| AC10 `#1113.6899a042` After a 14-minute `timed` wait, the before lane's timed set still gets its full 20-minute `TIMEOUT` | `before.test.mjs` | A build holder of another chain holds for 3 s while `proof.mjs before` runs. Every run of the timed file has `DEEP_THROTTLE=timed:…` and starts no earlier than the holder's end. The output has no `INCONCLUSIVE no grant` and no `was stopped after` |
| AC11 `#1113.3fd014d8` `throttle.mjs` and `perf.mjs` are in the guard regex: an unsigned change to either fails the guard | `guard.test.mjs` | In a scene whose main holds `scripts/proof-guard.mjs`, one unsigned commit changes `scripts/throttle.mjs`, `scripts/perf.mjs` and `scripts/guide.mjs`. `proof.mjs guard` prints `FAIL guard: scripts/throttle.mjs: …` and `FAIL guard: scripts/perf.mjs: …`, names `guide.mjs` in no FAIL, and exits non-zero |

## What the long time scales became

- **AC10 and AC8 (14-minute wait, 20-minute `TIMEOUT`, 15-minute grant wait).** Node's `spawnSync` timeout counts
  from the spawn. So a spawn that starts after its grant, and runs under it, keeps all of its `TIMEOUT` however long
  the wait was. The test shows that ordering with a 3 s wait. A 14-minute wait is under the logged 15-minute grant
  wait, so it ends in a grant, not in INCONCLUSIVE. **What the test can't see:** a spawn of `throttle.mjs timed -- …`
  whose `spawnSync` timeout is still 20 minutes would also pass, though its wait counts against the timeout. Telling
  that apart needs a run of minutes, or reading `proof-runs.mjs`.
- **Grant waits (AC8).** The 30-, 15- and 60-minute waits are read from the log's `wait`, never waited out.
- **Load (AC4).** No test forces the load above the cores: on 20 cores that would take minutes of busy CPU. A wrong
  program that ignores load passes on an idle machine. The test catches a grant logged at or above the cores, a
  logged load far from the machine's, a nested timed under a timed grant logged as top-level, and no log at all.
  When the machine's load is already at or above its cores, the test skips as INCONCLUSIVE, which is never a pass.

## Readings where the issue leaves a choice

- **"Nested build and test pass through"** means under a build holder, as AC3 says. Pass-through is shown by a
  command starting while its class is full outside its chain.
- **"No other grant starts until it ends"** is read for grants asked for after the timed request. Grants that were
  already held are the drain's business: the test shows the timed command waiting for one.
- **"Request order" (AC6)** is the order of the two chains' nested timed requests, 600 ms apart.
- **"The Mac's bay pair" (AC7)** is read as any bay-pair grant, since a top-level timed request never treats a
  bay-pair holder as idle. On the Spark the test holds one of its three.
- **AC8's affected.mjs and the before lane's timed set** overlap #1114 (T9a), whose Scope routes `affected.mjs`
  and splits the before lane's timed set. #1113 lists them in its own criteria, so they're tested here. If T5 leaves
  them to T9a, these tests stay failing and the PR says `Part of #1113`.
- **AC8's affected test** runs `affected.mjs` in this checkout on `tests/acceptance/1113/fixtures/probe.test.mjs`.
  The probe is untagged and outside the suite's glob. The test first checks with `--list` that only the probe is
  selected, and runs affected.mjs only after that. The probe's path is joined at runtime, so no literal here makes
  affected.mjs select this file again.

## Files

- `helpers.mjs`: the sandbox, stub holders, launching, polling, the log reader and the scratch repositories.
- `cli.test.mjs`: AC1, AC2 and AC5.
- `drain.test.mjs`: AC3 (two tests) and AC6 (two tests).
- `load.test.mjs`: AC4.
- `measured.test.mjs`: AC7 (two tests) and AC9.
- `waits.test.mjs`: AC8 (three tests).
- `before.test.mjs`: AC10 and AC8's 15 minutes (one test with both tags).
- `guard.test.mjs`: AC11.
- `fixtures/probe.test.mjs`: the probe for the `affected.mjs` test.
- `twins.json`, `twins/`: the three planted wrong programs the issue's Proof names (`twins/README.md`).
- `BASE-FAILURE.txt`: the run on the base, and the planted programs, with paths redacted.

No fixture holds a secret or personal data. Issue 9113 is made up.
