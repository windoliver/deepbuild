# Acceptance test for #1575, criterion 1 (blind redraft)

`#1575.1adcfe64` With a reader replaying from 0 on a record of 100,000 events and a live reader beside it, the live
reader's frames stay within the 50 ms budget. The merge base fails this, naming the cold reader

One test, in `budgets.test.ts`. Written blind: no implementation of #1575, no other worktree, branch or discussion was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- The issue text (`issue.md`: Scope, the six criteria, Proof, Depends on).
- `AGENTS.md`, and in `docs/technical-design.md`: Socket roles and contract versions (Reads and writes a slow link can
  afford), Numbers version 0 has to hold (the budgets table, Every task carries its own budgets, The reference Macs)
  and How we know version 0 works (Criteria to tests, Wrong programs, Dogfooding).
- The base commit `f38d2b39` (origin/main): `tests/acceptance/34/` (README, `helpers.ts`, `stream.test.ts`,
  `budgets.test.ts`), `tests/acceptance/16/helpers.ts`, `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`), how
  `tests/acceptance/1637/` calls them, and the hub's `stream.subscribe` in `packages/hub/src/server.ts` and
  `log-reads.ts` (the reply's shape, the frame's shape, `fell_behind`).

## What the test does

It enters only through the hub as a process and its socket: `stream.subscribe`, its reply and frames, `events.read`,
and hook requests. The hub process, the socket client, hook requests, temp homes and cleanup are #16's and #34's,
imported.

1. 100,000 events are seeded through the record (`openRecord`) before the hub starts, shaped as #34's history seed.
2. The hub starts (`deep hub run`). The live reader is an app connection that subscribes after the log's end.
3. A run is ten cold readers, one after another. Each is an app connection that subscribes after 0. From the moment
   its subscribe is written until it holds the frame of the log's end as it stood then, a hook is sent every 10 ms,
   each on its own connection.
4. A sample is one of those hooks: from its request written to the live reader's frame for its event read, which is
   #34's measure of the 50 ms budget. Only hooks written while the cold reader was still replaying count. A run's
   reading is the p95 of its samples.
5. One warm-up run, then five.

The cold reader is the one piece that isn't imported. #16's `Conn` parses and keeps every line, and 100,000 frames a
replay in the test's own process would cost the live reader's clock. This reader parses up to its first event frame,
then counts lines and looks for the head's frame. It reads as fast as the socket gives. The base hub still cuts it off
with `fell_behind` partway through a replay; it then subscribes again after the last log_pos it holds, as that refusal
says. The test is BLOCKED, not failed, when the premise doesn't hold: the cold reader's first event frame isn't the
record's first, it reaches the head on fewer than 100,000 lines, or it doesn't reach the head in 120 s.

## How the timing is judged, and why

The 50 ms is the design's live-stream budget: an event delivered to the app within 50 ms at p95. The five readings go
to the perf lane's own rule, `judgeLimit` on `fingerprint()` in `scripts/benchmark.mjs`, imported, not copied. That is
the base's code for "Numbers version 0 has to hold":

- A run counts only on a reference Mac (Mac15,7, Mac15,12 or Mac17,10), on mains power, with Low Power Mode off, the
  thermal state nominal and the one-minute load at each run's start and end within the core count.
- PASS when all five are within 50 ms.
- FAIL when all five are over 50 ms by more than the margin, the larger of 5% and the five runs' spread. The message
  names the cold reader.
- Anything else is INCONCLUSIVE: the test is skipped with a note starting `INCONCLUSIVE`, with the five readings, the
  machine and the rule's reason. It neither passes nor fails. The measurement always runs first, so the readings are
  there on any machine.

#34's own judge and reference-Mac list weren't used: they predate the third reference Mac and don't gate on power,
thermal state or load. The design's GPU lease doesn't apply here; nothing in this test uses the GPU.

## How to run

With the repo's Node (24.22.0) first on `PATH`, dependencies installed and built (the test runs the built CLI,
`packages/cli/dist/main.js`):

```sh
npx vitest run --root tests/acceptance/1575-redraft-ac1 --no-file-parallelism --testTimeout=900000 --reporter=verbose --disable-console-intercept
node node_modules/typescript/bin/tsc -p tests/acceptance/1575-redraft-ac1/tsconfig.json
```

It took 5 minutes at the base on a loaded machine.

## Result on the base

INCONCLUSIVE, so the base's FAIL is not shown yet (`BASE-FAILURE.txt`). The machine was a Mac17,10 on mains power, but
its thermal state was "fair" and its load was 249 to 363 on 18 cores, so the rule calls the run a reading.

The readings: the live reader's delay at p95 was 919.7, 10682.0, 2404.9, 2718.4 and 2236.6 ms against 50, with each
cold replay taking 0.9 to 14 s.

Two things to know before a counted run:

- The rule's margin is the five runs' spread as a fraction of the limit. With readings as spread out as these, all
  five would have to be over about 9.8 s to FAIL, so a counted run needs a quiet machine to settle it.
- "121809 events" in the output is the log's end when the run finished, the run's own hooks included.

## Files

- `budgets.test.ts`: the test.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, as #34's.
- `BASE-FAILURE.txt`: the run at the base.
