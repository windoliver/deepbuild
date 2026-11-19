# Acceptance tests for #2833: the Linux test-slot limit goes from 4 to 6

These tests were drafted blind from issue #2833 (its text and its one comment on 2026-11-18), `docs/parallel-proof.md`
sections 6 and 13, the Dogfooding part of `docs/technical-design.md`, AGENTS.md and the base commit `c26bdb5be`, which
has the limit at 4. At the base I also read `scripts/throttle.mjs` and `tests/acceptance/2744/` for style. The helpers
are written here, never imported from another suite, and no test imports the code under test: `scripts/throttle.mjs`
is run as a process. Per AGENTS.md, the implementing agent doesn't edit these tests; a dispute goes to a blind redraft.

## The criteria

1. "On Linux, the throttle grants up to 6 test grants at once on the machine's table, and the 7th request waits for a
   slot. darwin stays at 2."
2. "The design (`docs/parallel-proof.md` sections 6 and 13) states 6 for the Spark's test class."

The limits 6 (Linux) and 2 (darwin) are the issue's expected values and are hard-coded on purpose: the point of these
tests is that the code and the design say those numbers. (The issue's comment asks the redrafts of *other* suites to
read the limit from `throttle.mjs`; this suite is the one that pins the values themselves.)

## Run

```sh
node --test 'tests/acceptance/2833/*.test.mjs'
```

They must run under `node --test`: section 6 lets a request use `DEEP_THROTTLE_TABLE` only inside a test run.
**No test reads or writes the live table at `~/.deepbuild/throttle/`.** Every `throttle.mjs` process gets
`DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's temp sandbox and a temporary `HOME` there, with
`DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT` and `DEEP_PROOF_VITEST_REPORT` unset. Each process starts in
its own process group, stopped after the test by its PID. Offline; about 5 s on the Spark with the fix, 30 s on the
base (the AC1 test waits 30 s for a grant that never comes).

## The surface

- `node scripts/throttle.mjs test --wait 2 -- node stub.mjs <name> [exit]` (section 6's CLI). The stub notes its
  start and the `DEEP_THROTTLE` it sees (`test:<id>`), then holds until a stop file appears, or exits at once.
- "Waits for a slot": the request is still running and its command hasn't started 3 s after the limit's worth of
  holders all hold; once one holder finishes, its command starts under a test grant within 30 s and it exits 0.
- The design's tables: the row whose first cell is `test` in section 6's class table and `test grants` in section
  13's capacity table, read by their `Mac` and `Spark` header columns.

## The tests

| File | Criterion | What it checks |
|---|---|---|
| `limit.test.mjs` 1 (Linux only) | AC1 | 6 test requests are each granted while the others hold; the 7th hasn't run 3 s later and is still waiting; once one holder finishes it runs and exits 0, and the other 5 run on. |
| `limit.test.mjs` 2 (darwin only) | AC1 | The same with 2: the 3rd request waits until a slot frees. |
| `design.test.mjs` 1 | AC2 | Section 6's `test` row: Spark `6`, Mac `2`. |
| `design.test.mjs` 2 | AC2 | Section 13's `test grants` row: Spark `6`, Mac `2`. |

The platform not running is skipped with its reason; the darwin test needs a Mac run to count.

## Wrong programs

On the base all 3 Linux-run tests fail at their assertions (`BASE-FAILURE.txt`): the 5th holder is never granted
(the limit is 4), and both tables give the Spark 4. A throwaway tree of the base with only `test: 4` → `test: 6` on
the Linux side of `LIMITS` and both Spark cells → 6 passes all of them (never committed). Two twins of that tree
fail AC1 as the criterion names: Linux `test: 7` (the 7th request runs at once) and `test: 5` (holder 6 is never
granted). Not run: the darwin test, on a Mac.
