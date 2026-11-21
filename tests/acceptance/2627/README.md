# Acceptance tests for #2627, AC2: No file holds a slot without end

A blind job drafted these tests before any fix existed, from these sources only:

- issue #2627 and its comments, the latest (2026-11-18) giving the design and a testable form of this criterion
- `docs/parallel-proof.md` (section 6, the throttle and `affected.mjs`'s one test grant) and `docs/technical-design.md`
- AGENTS.md
- the base commit `f17fa347c`, which has no implementation; there I read `scripts/affected.mjs`, `scripts/throttle.mjs`,
  `scripts/lease`, `scripts/proof-vitest-reporter.mjs` and `reportResults` in `scripts/lanes.mjs` to learn how a run is
  called and what it prints, and `tests/acceptance/1115/`, `2574/` and `2744/` for conventions

AC1 (`tests/proof-binaries-lease-loss` leaves nothing after a failed start) is out of scope here. The helpers are
written here, never imported from another suite, and no test imports the code under test. Per AGENTS.md the
implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

Run them with:

```sh
node --test 'tests/acceptance/2627/*.test.mjs'
```

They must run under `node --test`: section 6 lets a request use `DEEP_THROTTLE_TABLE` only inside a test run. Both are
offline, on real processes: this checkout's real `scripts/affected.mjs` and `scripts/throttle.mjs`, real `node --test`
and real vitest, in a scratch git repository. Stubbed, at boundaries #2627 doesn't own: `cargo` (first on `PATH`,
`metadata` reports no crates) and the lint lane's own scripts. Each test takes about 1.5 to 2 minutes with a fix and
fails at its 270 s limit on the base; the two files run side by side.

**No test reads or writes the machine's table at `~/.deepbuild/throttle/`.** Every process gets a temporary `HOME`, a
`DEEP_THROTTLE_TABLE` folder in the test's sandbox and a `TMPDIR` there (so the run's logs land there), with
`DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_TEST_GRANT_WAIT`, `DEEP_SHARDS`, `CARGO_MAKEFLAGS` and
others unset. The run starts in a process group of its own. **Each test enforces its own wall-clock limit**: at 270 s it
SIGKILLs that group and fails with the output so far, so on the base, where nothing bounds the job, it fails at the
limit rather than hanging. After the test, that group and every process the fixtures noted (by PID, only while its start
time still matches) are SIGKILLed, and the sandbox is removed. Nothing is killed by name or port.

## Criteria to tests

The ID is `#2627.<first 8 hex digits of the SHA-256 of the criterion's "- [ ]" text, trimmed, white space collapsed>`,
as `scripts/proof-change.mjs` works it out.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC2 `#2627.0e4b51fe` **No file holds a slot without end.** Given a `node --test` file that never exits, when `affected.mjs` runs it, then the job ends within a bound, reads INCONCLUSIVE and releases its grant. | `node-job.test.mjs` | One node `--test` job of two files: one whose test never settles and which has started a child that ignores SIGTERM, one that passes. See below |
| the same, for vitest (the comment's "The same holds for a vitest file whose worker spins without yielding") | `vitest-job.test.mjs` | One vitest job of two files: one whose test spins in a `for (;;) {}` after starting a child that ignores SIGTERM, one that passes. See below |

Each runs `node scripts/affected.mjs <stuck> <pass>` with `DEEP_JOB_IDLE_MIN=1` and requires, in order:

1. the run exits within 270 s (the 1 min bound, the 10 s before the SIGKILL, and slack for a loaded machine);
2. the stuck file noted its process and its child, so it really ran;
3. the run took at least 1 min: the job wasn't stopped before its bound;
4. a line starting `INCONCLUSIVE` names the stuck file and the bound (`1 min`), and no line starting `PASS`, `FAIL`,
   `NEW FAIL`, `KNOWN` or `NO NEW FAILURES` names it;
5. no line starting with a state names the passing file, and the summary reads `INCONCLUSIVE affected: ... 1 passed`;
6. the exit is 2 (INCONCLUSIVE);
7. within 5 s of the exit, no process the stuck file noted (its own and its child) runs, read from the process table
   by PID and start time (`ps -o stat= -o lstart=`; a zombie runs nothing);
8. the sandbox's throttle log shows exactly one top-level `test` grant (the run's) and a `released` entry for it, and the
   table (`table.json`) holds no grant.

## The surface (my choice where the issue leaves it open)

- **The bound** is `DEEP_JOB_IDLE_MIN` minutes, as the comment names it. The tests use 1, as its testable form does.
- **"Reads INCONCLUSIVE"** for a file: a line of `affected.mjs`'s stdout starting `INCONCLUSIVE` names the file's repo
  path. "Naming the bound" (the comment's design) is read as that line matching `1 min` or `1min`.
- **"Reads passed"** for the passing file: `affected.mjs` prints no per-test pass line at the base, so it is read as no
  state line naming the file and the summary's `1 passed` (the only passing test in the run).
- **The run's exit code** for INCONCLUSIVE is 2, as at the base.
- **The grant** is the run's top-level `test` grant, read from `<table>/log` (`granted`, then `released` with its `id`)
  and from `<table>/table.json`'s `grants`.
- **No process of the stuck file left** is read for the processes the file itself notes (the `node --test` file's
  process or vitest's worker, and the child each started), by PID and start time.

## On the base

`BASE-FAILURE.txt` holds the run at `f17fa347c`. Both tests fail at their first assertion for the expected reason:
`affected.mjs` was still running at the 270 s limit, held by the stuck job, so the test SIGKILLed its process group. A
planted wrong program isn't shipped: the base fails each test, and no implementation was written into the repo.

To tell a test bug from a real failure, I patched a throwaway idle watchdog into a scratch copy of the base's
`scripts/` (never committed). Both tests passed against it in about 73 s each. Three one-change twins of it each failed
both tests at the assertion for their fault: SIGKILL of the job's process alone, not its tree; the missing result read
FAIL; every file of the stopped job read INCONCLUSIVE. `BASE-FAILURE.txt` shows those runs too. The watchdog isn't
kept, so it isn't the program under test and proves nothing about the real change.

## What the tests can't see

- **The real 120 min bound.** Only `DEEP_JOB_IDLE_MIN=1` is run; that the default is 120 minutes, above
  `tests/acceptance/1332`'s 90 min limit, isn't asserted.
- **A job that keeps writing past the bound is left alone.** The design stops a job only when its log and report stayed
  unchanged; the criterion doesn't name that, so no test holds a busy job past 1 min.
- **SIGTERM, then SIGKILL 10 s later.** Only the outcome is seen (the processes are gone, the run ended in time); the
  order of the signals isn't observed.
- **A file whose tests all finished but whose process never exits** (the issue's own case, a leaked child after its
  tests ended). The criterion's "each of its files with no result" reads INCONCLUSIVE; what such a file with results
  should read isn't settled by the issue, so it isn't tested.
- **The Mac.** Drafted and run on Linux (the Spark). `ps -o lstart=` works on macOS too, but it wasn't run there.

## Files

- `helpers.mjs`: the sandbox, the scratch tree, the fixtures, the limited run, the process table and the throttle table,
  and the shared assertions.
- `node-job.test.mjs`: the `node --test` case.
- `vitest-job.test.mjs`: the vitest case.
- `BASE-FAILURE.txt`: the run on the base, paths redacted.

No fixture holds a secret or personal data.
