# Acceptance tests for #3221: admitted runs take turns on one pool of the machine's cores

Drafted blind, before any implementation, from these inputs only:

- issue #3221 (its seven acceptance criteria);
- AGENTS.md, and `docs/technical-design.md`'s Dogfooding and Repo guards bullets;
- the design text the change adds: the diff of `docs/parallel-proof.md` sections 6, 7a and 13 (Admission, Turns on
  one pool, A turn's compiles, Drain, the waits table, Compiles at once, and the trust paragraphs), with its amendment
  that a budget window stops new grants but not turns;
- the base's code, read only to learn the surfaces driven here: `scripts/throttle.mjs`, the job and grant parts of
  `scripts/affected.mjs`, `scripts/wait-ratchet.mjs`, how `scripts/proof-runs.mjs` reads `twins.json` and how
  `scripts/proof-change.mjs` derives criterion IDs, and for shape the suites `2924`, `2744`, `2574`,
  `2741-redraft-2820` and `3067`.

The base is `f8c6cff82`; the worktree stood one merge past it (`6bed8c627`, which adds another suite and three lines of
`scripts/lanes-lists.mjs` for it, and nothing this suite reads). No test imports the code under test: `throttle.mjs`
runs as a process. Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind redraft.

## Run

```sh
PATH=/opt/homebrew/opt/rustup/bin:$PATH node --test 'tests/acceptance/3221/*.test.mjs'
```

They must run under `node --test`: only inside a test run does a table of a test's own exist (section 6). With the
files side by side it takes about 2 minutes, most of it `turns.test.mjs`. `compiles.test.mjs` needs cargo and a Rust
toolchain (it adds `~/.cargo/bin` and `/opt/homebrew/opt/rustup/bin` to its PATH itself) and works offline.

**The machine's table at `~/.deepbuild/throttle/` is never read or written.** Every process a test starts gets
`DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's temp sandbox, a `HOME` and `TMPDIR` there, and
`DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_PROOF_VITEST_REPORT`, `DEEP_THROTTLE_READINGS`,
`DEEP_THROTTLE_RUN`, `CARGO_MAKEFLAGS`, `MAKEFLAGS` and `MFLAGS` unset unless the test sets one. Each run or request
starts in its own process group and is stopped after its test by that group's PID; AC4 kills one process it started,
by its PID. Nothing is stopped by name or port.

## The surface

- **A run** is `DEEP_THROTTLE_RUN=0 node scripts/throttle.mjs test [--wait <min>] -- node run.mjs <name> <config>`,
  the admission marker on the process that asks (section 6). The stub run notes its start and the `DEEP_THROTTLE` it
  was given (its grant, `test:<id>`), starts its jobs, at most a given number at once, and exits 0 when all of them did.
  It leaves `DEEP_THROTTLE_RUN` out of its jobs' environment itself, so no test depends on the throttle doing so.
- **A job** is `node scripts/throttle.mjs test [--wait <min>] -- node job.mjs <run> <k> <mode>`, started by its run,
  so it passes through on the run's grant and waits for a turn. The stub notes its start (with the `DEEP_THROTTLE` and
  `CARGO_MAKEFLAGS` it was given) and its end, and either exits, sleeps, holds until a stop file, or runs
  `cargo build --offline` in a workspace of its run's own.
- **The pool** is a core less one of the test's own readings (`DEEP_THROTTLE_READINGS`): `cores` 5 for a pool of 4,
  3 for 2, 2 for 1. The memory is set far above any run's need unless a test says otherwise.
- **The table's log**: `passed` through `test:<run grant>` (a job asked); `turn` and `released` with class `turn`,
  each naming its run's grant as `run`, read as the grant's ID or its `test:<id>` token. Only AC3, AC4 and AC5 read the
  log, and only AC4 reads `turn` and `released`.
- **Jobs running at once** are counted from the jobs' own start and end notes, at every note, which is stricter than a
  sample a second: a job notes its end before it exits, and a token goes back only once it has.
- **Compiler processes** are counted from `ps -A -ww -o pid=,ucomm=,args=` once a second: a `rustc` whose arguments
  name `--crate-name u3221_` and one of the sandbox's workspaces. Cargo's own probes of rustc hold no token and aren't
  counted.

## The tests

| Criterion | File | What it checks |
|---|---|---|
| AC1 `#3221.2a179649` | `turns.test.mjs` | A pool of 4, readings at load 50 on 5 cores. The first run has 40 jobs of 10 s and keeps 8 started; the second, 4 jobs of 10 s, asks 30 s after the first. Both end with 0 and start all their jobs; no moment of the notes holds more than 4 jobs running; the second ends within 60 s of asking. Its diagnostic prints the timeline, and whether the second's first job started before or after the first run ended. |
| AC2 `#3221.cbe8556f` | `compiles.test.mjs` | A pool of 4. Three runs, each with one job that builds 8 independent leaf crates and a binary in a workspace of its own, every leaf seeded fresh so each must compile (a constant of about a second of one core). Each build exits 0 and compiles all 9 crates, each run's compilers are seen in some reading, and no reading once a second counts more than 4. |
| AC3 `#3221.9bee972a` | `no-grant.test.mjs` | A pool of 1. A run's job holds the token; a second run is admitted and its job, with `--wait 0.05` (3 s), asks. 8 s later it hasn't started; once the token frees it runs. Both runs end with 0 and neither run's output holds `INCONCLUSIVE no grant`. |
| AC3 `#3221.9bee972a` | `no-grant.test.mjs` | Readings of 0 bytes of memory and one test grant held: a run asked with `--wait 0.1` prints `INCONCLUSIVE no grant: no test grant came within 0.1 min` first, exits 3, and its command and jobs never started. |
| AC4 `#3221.300249e2` | `killed.test.mjs` | A pool of 2. A run's 2 jobs hold both tokens until a stop file that never comes; a second run's 2 jobs ask and haven't started 5 s later. The first run's grant holder (the `throttle.mjs` it was admitted by) is killed with SIGKILL. The log has a `released` of class `turn` for each of its 2 turns within 2 s of the kill; the second run's 2 jobs start, the log names 2 turns of its run, and it ends with 0. |
| AC5 `#3221.c7e55b61` | `drain.test.mjs` | A pool of 2. A run's 4 jobs hold until stop files: 2 start, 2 wait. A plain `timed` request (not a window) is asked under a build grant of the test's own; 15 s later the jobs in flight are stopped one after the other, 5 s apart. No job starts between the timed request and its command's start, its command starts only after both jobs in flight have ended, and the 2 waiting jobs run afterwards. |
| AC6 `#3221.cb760c49` | none | Not testable inside a suite (below). |
| AC7 `#3221.14b7a581` | `design.test.mjs` | Each of sections 6, 7a and 13 names #3221, a pool, tokens, turns, a core less one, the trust given up, none in what a test proves, and the disk. |

**AC6 can't be a test here.** "The FAIL IDs of the unit lane on main are the same before and after" is a reading of
the whole unit lane on main, at the merge base and with the change, and a suite can't run the lane it is part of. The
implementer brings the two runs' FAIL ID lists (the unit lane's records, or `node scripts/affected.mjs` over the
lane's files at each commit) and their difference, which must be empty.

## Planted twins (`twins.json`)

The merge base has no pool, so it can't show the criteria's planted wrong programs. Each twin under `twins/<name>/`
replaces `scripts/throttle.mjs` with a program **this blind job wrote from the design text** (no implementation
existed): the base's `throttle.mjs` with section 6's admission (by the ceiling and memory without the load, and the
disk under `HOME`), turns on one pool in the order of least time, a turn released when its job ends or when its holder
or its run's holder is gone (a dead run's running jobs stopped), the drain, and a jobserver lent from the pool for each
turn, and then one rule changed, marked `Planted:`. They implement only what these tests reach: a run admitted under a
caller's grant passes through as on the base with no turns for its jobs, and nothing of `affected.mjs` changes.

| Twin | What it gets wrong | The test that fails on it, and how |
|---|---|---|
| `arrival-order` | A free token goes to the job of the run that arrived first, not the run with the least time | `turns.test.mjs`: "the second run (4 jobs) ended 83.4 s after asking, not within 60 s"; its first job started at +102 s, once the first run had started all 40 |
| `waits-for-jobs` | A turn goes back only when its own job's holder is gone, so a killed run's tokens wait for its jobs | `killed.test.mjs`: "the killed run "doomed" (grant ...) gave back 0 of its 2 tokens within 2 s of its kill ...; releases: none in 30 s" |
| `deals-in-drain` | A pending timed request doesn't stop new turns | `drain.test.mjs`: "a job started while the timed request waited: job busy#0 ... at +15.2 s", 0.2 s after the first job in flight ended |

The same program without the planted change (kept outside the checkout, never committed, with this folder and the
design text beside it) passed all 9 tests in three runs on this Mac, twice with the whole folder side by side, at
1-minute loads from 20 to 380 on 18 cores: the second run of AC1 ended 11.8 to 12.3 s after asking, AC2's peak was 4,
and AC4's tokens went back 40 to 80 ms after the kill. A first draft of the drain test stopped the second job in flight at once after the first,
and `deals-in-drain` passed it once (the timed request was granted before the freed token was dealt); the test now
leaves 5 s between them: the twin fails and the program without it passes.

## Gaps and assumptions

- **Stub runs, not `affected.mjs` runs.** No criterion names `affected.mjs`, and a real run in a scratch tree with
  shards costs minutes a test at this machine's load. So the tests show the throttle's pool, not that `affected.mjs`
  asks its admission with `DEEP_THROTTLE_RUN` or stops making a jobserver of its own. `affected.mjs` starts each job as
  `throttle.mjs <class> --wait 30 -- ...`, so its jobs reach the same code; a refused admission's own reading
  (`INCONCLUSIVE no grant`, a line per file, the summary, exit 2) stays #2574 AC2d's test.
- **AC1's readings show the load above the cores** (50 on 5), as on the Mac the issue describes: section 6 decides an
  admission without the load, so the second run is admitted, and on the base the same reading keeps it out until the
  first has ended, which is the criterion's base claim. The first run keeps 8 jobs started, twice the pool, so it has
  jobs waiting for every token that frees; with all 40 started at once the base would end the first run before the
  second asked. "Asks 30 s later" counts from the first run's start; the 60 s, from the second's start to its exit.
- **AC2 on the Mac** has a test ceiling of 2, so the third run is admitted when one of the first two has ended; on
  Linux all three are admitted at once. The base's own pool isn't run: a stub run's cargo on the base has no jobserver
  at all and runs at its own job count, 8 here for each of two runs.
- **AC3's first test passes on the base only through its setup**: the base has no turns, so its job runs at once and
  the test fails at "didn't wait its turn". The second test passes on the base: it guards the reading that doesn't
  change. The run is kept out by the memory rule, not by a full ceiling.
- **AC4's "process"** is the run's grant holder. Only it is killed, so its jobs live on and only the run's death can
  give their tokens back. Not asserted: that those jobs are then stopped (design, no criterion).
- **AC5's timed request is nested** under a build grant, since a top-level one waits for the machine's load below its
  cores, which a test can't set; a top-level timed request isn't tested. "While it waits" runs from the timed request's
  start to its command's start; whether turns stay held while the timed grant is held isn't asserted. The 15 s pause
  assumes the request is in the table by then; the table's file isn't a surface the design names.
- **Fixed waits**, each marked `// deadline:`: AC1's 30 s schedule, AC3's 8 s past a 3 s `--wait`, AC4's and AC5's 5 s
  for a job a wrong pool would start, AC5's 15 s and the 1 s sampling in AC2. The 2 s of AC4 and the 60 s of AC1 are the
  criteria's own, measured on the machine's clock from the test's kill or start.
- **Not tested**, as no criterion names them: the disk rule of an admission; turns for a run admitted under a caller's
  grant; `DEEP_THROTTLE_RUN` taken out of the command's environment; the pipe giving tokens back while a job waits; a
  budget window letting turns go on; a pool on a table with no readings; a job's 360-minute idle bound counting from its
  turn.
- **AC7** is matched by words, not meaning.

## On the base

`BASE-FAILURE.txt`: each file run once on the base, at a 1-minute load of 124 to 178 on 18 cores. 8 tests fail and 1
passes, each failure at an assertion and for the expected reason: 8 jobs ran at once on a pool of 4 (AC1, whose
timeline shows the second run's first job starting after the first run ended, the criterion's base claim); 16
planted compilers at once (AC2); a job that ran at once with no turn to wait for (AC3's first test, AC4 and AC5); and
sections 6, 7a and 13 without the rule (AC7). AC3's second test passes, as it should.
