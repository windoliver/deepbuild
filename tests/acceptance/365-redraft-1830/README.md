# Blind redraft for #1830 of #365's budgets (AC10)

A redraft of `tests/acceptance/365/budgets.test.ts`, written blind for #1830. It runs in that file's place: the
same five tests, the same names (with AC10's ID, `#365.db4ac3e6`), the same criterion, the same work and the same
limits. What changes: every timing run reads the one-minute load average (`os.loadavg()[0]`) at its start and at its
end, and every `judgeLimit` call passes those readings as `loads`, one `{ start, end }` per run, in the runs' order,
as the design's timing rule says. The first draft called `judgeLimit` with `limit`, `runs` and `fingerprint` only, so
since #1555 its timings read INCONCLUSIVE on every machine, the reference Macs included.

It read only:

- issue #1830's body (the dispute) and issue #365's body (AC10: "Budgets, on the reference Mac in the local
  preflight, compared with the merge base: a source call adds under 5 ms beyond the network; a store query over
  100,000 rows takes under 10 ms at p95; schedules fire within 1 s; each plug-in's store stays within its declared
  quota");
- `AGENTS.md`;
- the first draft at the base: `tests/acceptance/365/budgets.test.ts`, `helpers.ts`, `fixtures/tally` and
  `README.md`;
- `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`, `validateBudgets`);
- `docs/technical-design.md`: How we know version 0 works (the timing rule: a loaded run counts neither way; The
  reference Macs) and Dogfooding (a disputed test goes to a fresh run of the job that wrote it).

The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What the base has

The base is `3557b348` (main). It has #365's schedules and #363's store with its quota, #364's sources, and
`benchmarks/budgets.json` holds `extension-source-call`, `extension-store-query` and `extension-schedule-fire`.
`judgeLimit` there reads INCONCLUSIVE whenever `loads` is missing, malformed, or holds a reading above the core count
(`availableParallelism()`).

## How to run

macOS, the repo's Node (24.22) first on `PATH`, and a shell whose own sandbox is off (the plug-ins run in the platform
sandbox through the supervisor), from the checkout's root:

```sh
npm ci --no-audit --no-fund              # once, in a fresh worktree
node node_modules/typescript/bin/tsc -p tests/acceptance/365-redraft-1830/tsconfig.json
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/365-redraft-1830 --testTimeout=600000 --no-file-parallelism --reporter=verbose --silent=false
```

The verbose reporter with `--silent=false` prints each timing's readings, loads and verdict; without them an
agent's shell may get only the counts.

The file imports the first draft's `helpers.ts` (unchanged, frozen), which copies its `fixtures/tally` and
`fixtures/market` packages, so the same environment rules hold: `HOME` is a temp folder, every package and record is
under `/tmp/dh365-*` and removed after the file, every host is closed after the file, `api.market.example` is a server
on 127.0.0.1 reached only through the test's HTTP client, and nothing is stopped by name or port. It times calls,
queries and a schedule on the real clock, so it runs alone, as the first draft's file does; putting this folder on
`scripts/lanes.mjs`'s `alone` list and retiring the first draft's file are outside this folder and not done here.

## What each test proves

| Test | What it proves |
|---|---|
| `AC10 the perf lane has a task for each timing, and the budgets are valid against the merge base's` | `benchmarks/budgets.json` has the three tasks and is valid by `validateBudgets` against the merge base's (`git merge-base HEAD origin/main`); with no merge base it fails BLOCKED. Not a timing, unchanged. |
| `AC10 a source call adds under 5 ms beyond the network (five runs of 20 calls after a warm-up)` | A run is 20 `readSource` calls of the market price, each less the same request sent straight to the provider (mean less mean). One warm-up run, then five, each with its load read before and after. `judgeLimit` at 5 ms with the five loads. |
| `AC10 a store query over 100,000 rows takes under 10 ms at p95 (five runs of 200 lookups after a warm-up)` | The tally plug-in's store is seeded with 100,000 items; a run is one `ext.tally.lookup` of 200 random keys, timed in the plug-in, read at p95, and must find all 200. One warm-up run, then five, each with its load read before and after. `judgeLimit` at 10 ms with the five loads. |
| `AC10 schedules fire within 1 s: a five-second schedule's job starts within 1 s of its slot (five firings after a warm-up)` | A five-second schedule on the real clock, with no tick, must fire six times within 90 s. A run is one firing, from its slot to its job's start; firings 2 to 6 are the runs (the first is the warm-up). The load is read when the host starts and just before and just after each one-second poll of the job's report: a firing's start reading is the last taken at or before the earliest its slot can have been (the start of the poll before the one that saw it, less its lateness), its end reading the one just after the poll that saw it. `judgeLimit` at 1,000 ms with the five loads. |
| `AC10 a plug-in's store stays within its declared quota: puts past 4,096 bytes are refused, naming the quota, and the store holds no more` | Not a timing, checked on every machine, unchanged: against a 4,096-byte quota, 100 puts of 117 bytes leave at most 35 items and a refusal naming the quota, and the store holds exactly what it took. |

The verdict is `judgeLimit`'s: PASS passes; FAIL fails, the message holding the five runs, the loads, the machine and
the reason; INCONCLUSIVE, and BLOCKED (five readings that aren't five finite non-negative numbers), print the same and
skip as INCONCLUSIVE with `judgeLimit`'s reason. The gate stays where the first draft had it, before any work in each
of the three timings: there the test skips as INCONCLUSIVE when this machine can't count a run now. The first draft's
gate called `judgeLimit` on five zero runs with no `loads`, so since #1555 it skipped everywhere; this one gives
`judgeLimit` five empty runs, each with the load read at its start and its end, so it passes on a fit reference Mac
under its core count and names the load otherwise. Past the gate, the five real runs are judged again with their own
loads. A firing whose start reading can't be found passes no load for that run, which `judgeLimit` reads INCONCLUSIVE.
A skip is never a pass.

## The base run

On the base `3557b348`, on a Mac17,10 (a reference Mac) on mains power, macOS 26B8119, 18 cores, with other work
holding the one-minute load near 390. Type check: clean. Vitest, run once: 2 passed, 3 skipped (19 s).

- `AC10 the perf lane has a task for each timing, …`: **PASS**.
- `AC10 a source call adds under 5 ms beyond the network …`: **INCONCLUSIVE** at the gate, skipped before any work:

  ```text
  AC10 INCONCLUSIVE: a source call not timed: a reading, not a budget result: off the reference Macs (Mac15,7 (M3 Pro,
  36 GB) or Mac15,12 (M3, 16 GB) or Mac17,10 (M5 Max, 64 GB); mains power, Low Power Mode off, thermal state
  nominal): load 391.35595703125 at a run's start or end is above the 18 cores
  ```

- `AC10 a store query over 100,000 rows takes under 10 ms at p95 …`: **INCONCLUSIVE** at the gate, the same reason
  (load 391.36).
- `AC10 schedules fire within 1 s: …`: **INCONCLUSIVE** at the gate, the same reason (load 391.36).
- `AC10 a plug-in's store stays within its declared quota: …`: **PASS**.

A PASS or FAIL needs a fit reference Mac with every run's load at or under its core count; that run hasn't been made.

An earlier draft of this file, with no gate, was also run once on the base, at loads of 308 to 371 with the thermal
state fair. Its source call (0.00, 73.01, 40.75, 45.86, 23.57 ms) and schedule firings (271, 217, 180, 148, 98 ms
late) were judged with their loads and read INCONCLUSIVE, naming the load. Its store query failed before any timing:
seeding the 100,000 rows, a `ext.tally.put_batch` call came back `{"status":"refused","reason":"test/tally's
ext.tally.put_batch failed","started":true}`. Whether that is the load or the base wasn't settled; the gate keeps the
first draft's order, so on a fit reference Mac the seeding runs and such a refusal fails the test.
