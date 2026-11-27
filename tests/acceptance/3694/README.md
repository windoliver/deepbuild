# Acceptance tests for #3694: a test request outside a run takes a turn on the pool, as a build does

Drafted blind, before any implementation, from these inputs only:

- issue #3694 (What happened, Scope, its four acceptance criteria and Proof);
- `docs/parallel-proof.md` section 6 (Scheduling) and section 13 (Capacity), as the base has them;
- the issues it names, for the words it cites: #3549, #3221, #2980 and #3580;
- `AGENTS.md`, `CONTRIBUTING.md` and `GLOSSARY.md`;
- the base commit `894a293f2`, for call shapes and conventions only: `scripts/throttle.mjs` (its CLI, `acquire`, the
  log's entries, a test's own table and readings, `throttle.mjs load`), how `scripts/proof-change.mjs` derives a
  criterion's ID, and for shape the suites `3549` and `3221` (README, helpers, tests).

No test imports the code under test: `scripts/throttle.mjs` runs as a process, found from the test files' own place in
the tree, so the suite runs in any copy of the tree. Per AGENTS.md the implementing agent doesn't edit these files; a
dispute goes to a blind redraft. The suite needs no line anywhere else in the tree and no `lane.json`: every test has a
table and a sandbox of its own, as 3549's does.

## Run

```sh
node scripts/throttle.mjs test --stall 60 -- node --test --test-reporter=spec tests/acceptance/3694/*.test.mjs
```

The files must run under `node --test`: only inside a test run does a table of a test's own exist (section 6). The
suite needs no `node_modules` and no cargo.

**The machine's table at `~/.deepbuild/throttle/` is never read or written.** Every process a test starts gets
`DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's sandbox under the system's temporary folder,
`DEEP_THROTTLE_READINGS` pointed at a readings file there, a `HOME` and `TMPDIR` there, and no `DEEP_` variable of the
test run's (its own `DEEP_THROTTLE` among them), nor its `NODE_TEST_CONTEXT`, `CARGO_MAKEFLAGS`, `MAKEFLAGS` or
`MFLAGS`, unless the test sets one. Each request starts in a process group of its own. At a test's end every stub is
told to stop by a file, and 5 s later what is left is stopped by its process group's ID. A load sampler is stopped by
its process group's ID once its sample is in. Nothing is stopped by name or port. Failure messages write the checkout
`<checkout>`, the sandbox `<sandbox>`, the temporary folder `<tmp>` and every home folder, the sandbox's own `HOME`
too, `~`.

## The surface

- **The readings** are the issue's, in every test: `{"load": 57, "cores": 18, "memory": 50e9}`, 50 GB as bytes. So
  the pool is 17 tokens (a core less one of the readings' cores, section 6). The memory is far above the Mac's 8 GiB
  a run for two grants; the readings are the Mac's, the issue's machine (see Gaps).
- **A run** is `DEEP_THROTTLE_RUN=0 node scripts/throttle.mjs test --wait 1 -- node stub.mjs <name> hold|drive`,
  the admission marker on the process that asks (section 6, Admission). A run that holds just holds its grant until a
  stop file; a run that drives starts its jobs. **A job** is `node scripts/throttle.mjs test --wait 10 -- node stub.mjs
  <job> hold`, started by its run with the run's `DEEP_THROTTLE` and without `DEEP_THROTTLE_RUN`, so it passes
  through on the run's grant (the log's `passed`, by the job's pid) and waits for a turn.
- **A plain test request** is `node scripts/throttle.mjs test --wait <min> -- node stub.mjs <name> exit`, asked by a
  process under no grant (the test's own process, with no `DEEP_THROTTLE`). Its command "starts" when its stub notes
  its start; "A starts after B ends" is read on the two stubs' own notes.
- **Granted** is the log's `granted` entry of class `test` and `grant: "top-level"` for the request's pid, the
  throttle process's, and its command started. **Not granted** is the throttle's own reading: `INCONCLUSIVE no grant: `
  in its output, exit 3, its command never started.
- **A request in line** is read from the throttle's own count (section 6, #3240): `throttle.mjs load` appends a sample
  to `load.log` in the table's folder, whose `waiting` counts the requests in line by class. A timed request and a
  plain test request that waits for admission count there. The table's file is not read.
- **A timed request** is top-level, `node scripts/throttle.mjs timed --wait 0.5 -- node stub.mjs timed exit`. It
  waits on the run's grant, a holder outside its chain that never waits in the throttle, so it stays in line until its
  wait runs out; it never needs the machine's own load, which a test can't set.
- **The admitted build** criterion 4 reads against is `node scripts/throttle.mjs build --wait 1 -- node stub.mjs build
  exit`, asked under no grant (section 6, Builds on the pool, #3549).

## How I read each criterion

| Criterion | File | How it is read |
|---|---|---|
| 1 `#3694.28023738` | `admission.test.mjs` | One run is admitted and holds its test grant (its `granted` entry carries `run: true`). A plain test request with a wait of 0.5 min is then granted: its command starts, it ends with 0, the log has its top-level `granted` entry of class test, and the run's grant was held all the while. |
| 2 `#3694.b252ab9d` | `turns.test.mjs` | "Same table": the issue's readings and one run's grant. "The pool's tokens all dealt to the run's jobs": the run's first 17 jobs all started. "The run's waiting jobs": three more of its jobs then ask, each shown in the table by its `passed` entry, and none starts in 2 s. The plain request then asks: it is granted (its `granted` entry), and for 3 s neither its command nor a waiting job starts. One job ends: the token goes to the plain request, whose command starts no earlier than that job's end and before any of the three waiting jobs starts, and it ends with 0. |
| 3 `#3694.2f5b9fe1` | `drain.test.mjs`, the first | A run's grant is held and a timed request stands in line (a sample counts it). A plain request with a wait of 0.1 min is not granted while the timed request still waits. Then the timed request's 0.5 min run out and it leaves with `INCONCLUSIVE no grant`, and a plain request asked after that is granted and ends with 0, so the refusal was the drain's. |
| 3 `#3694.2f5b9fe1` | `drain.test.mjs`, the second | The test ceiling's grants are held by admitted runs (2 on macOS, 6 elsewhere). A plain request with a wait of 10 min stands in line (a sample counts it) and its command hasn't started 3 s later. When one run ends, the plain request is granted within 60 s, starts no earlier than that end, and ends with 0. |
| 4 `#3694.24a531af` | `log.test.mjs` | "Names its turn, as an admitted build's does" is open in the issue. Read here by what the log holds for an admitted build on the same table: the build's `granted` line, a `turn` line after it whose `run` is the build's grant ID, and a `released` line of class `turn` for that turn (section 6, Builds on the pool). The plain request's `granted` line must carry the same `run` value as the build's (`true` on the base's build); a `turn` line after it must name its grant ID as `run`, written by the plain request's own pid as the build's is; and a `released` line of class `turn` must give that turn back. If the build's `granted` line carries a `turn` field, it must name the build's turn, and the plain request's must name its own. The plain request is asked on a table with no test grant held, so the test reads the log's lines rather than the admission of criterion 1. |

Where a criterion's planted program is named: criterion 1's "a planted `roomForTest()` that still reads the load for
a plain request" is the base's rule, and `admission.test.mjs` fails on it (see On the base). Criterion 2's "a planted
pool that serves arrival order" fails `turns.test.mjs` at its order assertion: the first of the run's three waiting
jobs asked before the plain request did. The twins are the implementer's to add.

No test passes on a throttle that grants every request at once: criterion 2 needs the plain request's command held
back while the pool is dealt, and criterion 3 needs a refusal and a wait. None passes on one that grants nothing:
each needs a plain request to run.

## What I ran

On the Mac (18 cores), 2026-11-27. One request for the machine's `test` grant,
`node scripts/throttle.mjs test --stall 60 -- node --test ...` for the guess run below, waited from about 14:13Z with
no grant. On the owner's instruction, relayed by the parent session, it was stopped by its PID, and every run below
was made with no throttle grant of the machine's: each file once per program, one after another, as
`node --test --test-reporter=spec <file>`, each after a check that the machine's table held no `timed` grant (none
was held at any check). The suite's own requests still went only to each test's own table.

| Program | File | UTC start | UTC end | Result | 1-minute load at start, end |
|---|---|---|---|---|---|
| base `894a293f2` | `admission.test.mjs` | 2026-11-27T14:25:01Z | 2026-11-27T14:25:35Z | 1 fail | 76.8, 84.4 |
| base | `drain.test.mjs` | 2026-11-27T14:25:35Z | 2026-11-27T14:27:43Z | 2 fail | 84.4, 84.2 |
| base | `log.test.mjs` | 2026-11-27T14:27:43Z | 2026-11-27T14:27:44Z | 1 fail | 84.2, 84.2 |
| base | `turns.test.mjs` | 2026-11-27T14:27:44Z | 2026-11-27T14:28:52Z | 1 fail | 84.2, 81.1 |
| guess | `admission.test.mjs` | 2026-11-27T14:29:09Z | 2026-11-27T14:29:10Z | 1 pass | 142.0, 142.0 |
| guess | `drain.test.mjs` | 2026-11-27T14:29:10Z | 2026-11-27T14:29:47Z | 2 pass | 142.0, 112.1 |
| guess | `log.test.mjs` | 2026-11-27T14:29:47Z | 2026-11-27T14:29:48Z | 1 pass | 112.1, 112.1 |
| guess | `turns.test.mjs` | 2026-11-27T14:29:48Z | 2026-11-27T14:29:58Z | 1 pass | 112.1, 105.4 |
| arrival order | `turns.test.mjs` | 2026-11-27T14:30:13Z | 2026-11-27T14:30:22Z | 1 fail | 96.1, 90.9 |

`BASE-FAILURE.txt` holds the base runs' output: 5 tests, 0 pass, 5 fail, each at an assertion of the suite's own.

**A throwaway guess at the change**, in a copy of `scripts/` and this folder outside the checkout: the base's
`throttle.mjs` with three edits. A top-level test request decides its admission as a run's does, without the load. Its
grant is a run's (`run: true`, `used: 0`). It then asks for its turn in the same write, as an admitted build does.
All 5 tests passed on it.

**One wrong version of the guess**, for criterion 2's planted program: the guess with turns dealt in arrival order
(`nextTurn` sorted by `seq` alone). `turns.test.mjs` failed on it: the token `dealt-1` gave back went to the run's
waiting job `waiting-3` before the plain request's command had started. Criterion 1's planted program, a
`roomForTest()` that still reads the load for a plain request, is the base's rule, and the base run shows
`admission.test.mjs` failing on it. After the runs, the wording of that one failure message in `turns.test.mjs` was
changed, text only. Nothing that decides whether the test passes changed.

The guess, its wrong version and the runs' outputs stay outside the tree. They are no part of the suite: the twins are
the implementer's.

**Not run:** the suite under a grant of the machine's, so the runs had other sessions' load beside them (the column
above); the suite on the Linux machine; `scripts/affected.mjs`, a lane or a preflight; a twin in its line form.

## Gaps and assumptions

- **The Mac's numbers.** With the issue's 50 GB, a second test grant is room for a run only at the Mac's 8 GiB a run
  (#2980). At the Linux machine's 24 GiB, one settling grant leaves 50 GB less 24 GiB, under 24 GiB, so criteria 1 to
  3 would refuse the plain request there by memory. The test ceiling is read from `process.platform` (2 on macOS,
  6 elsewhere), but the suite ran only on the Mac and is for the issue's machine.
- **"Granted"** (criteria 1 and 3) is the admission: the `granted` entry and the command's start. On the change the
  admitted request then takes a turn, and with tokens free it starts at once.
- **"Ahead of the run's waiting jobs"** (criterion 2) is read as the token freed first: the plain request's command
  starts before any of the three waiting jobs' commands. Those jobs asked before it did. Which of them goes next after
  it is not read.
- **"Doesn't start until a token is free"** (criterion 2) is read over 3 s after the plain request's `granted` entry,
  and then as its start being no earlier than the end of the job whose token it got.
- **"The drain still holds"** (criterion 3) is a plain request with a wait of 0.1 min refused while a top-level timed
  request is in line. The control after it tells the drain's refusal from the load's.
- **"Names its turn"** (criterion 4) is read against an admitted build's lines on the same table, as the How I read
  table says. The issue doesn't say which field. If the change names the turn on the `granted` line only for a test
  request and not for a build, this test reads only `run` and the `turn` and `released` lines.
- **Not tested**, since no criterion names it: `--hold` and a window beside a plain request (Scope says they still
  decide as now); a plain request's `waited`; a plain request under a caller's grant, which passes through as before;
  the head-of-line rule (#3580), out of scope.
