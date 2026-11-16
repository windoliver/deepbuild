# Blind redraft for #1830 of #103's budgets (AC14)

A redraft of `tests/acceptance/103/budgets.test.ts`, written blind for #1830. It runs in that file's place: the
same three tests, the same names (with AC14's ID, `#103.84a93fb7`), the same criterion, the same work and the same
limits. What changes: every timing run reads the one-minute load average (`os.loadavg()[0]`) at its start and at its
end, and every `judgeLimit` call passes those readings as `loads`, one `{ start, end }` per run, in the runs' order,
as the design's timing rule says. The first draft called `judgeLimit` with `limit`, `runs` and `fingerprint` only, so
since #1555 its timings read INCONCLUSIVE on every machine, the reference Macs included.

It read only:

- issue #1830's body (the dispute) and issue #103's body (AC14: "Budgets, on the reference Mac in the local
  preflight, compared with the merge base: wiring a composition at install takes under 100 ms, and a reading
  crossing an edge adds under 1 ms");
- `AGENTS.md`;
- the first draft at the base: `tests/acceptance/103/budgets.test.ts`, `helpers.ts` and `README.md`;
- `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`, `validateBudgets`);
- `docs/technical-design.md`: How we know version 0 works (the timing rule: a loaded run counts neither way; The
  reference Macs) and Dogfooding (a disputed test goes to a fresh run of the job that wrote it).

The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What the base has

The base is `3557b348` (main). It has #103's composition: `install` wires a brief's two uses, the brief's
`ext.brief.bench` action times reads through its edge, and `benchmarks/budgets.json` holds `composition-wire` and
`composition-edge-read`. `judgeLimit` there reads INCONCLUSIVE whenever `loads` is missing, malformed, or holds a
reading above the core count (`availableParallelism()`).

## How to run

macOS, the repo's Node (24.22) first on `PATH`, and a shell whose own sandbox is off (the test plug-ins run in the
platform sandbox through the supervisor, and Seatbelt can't nest), from the checkout's root:

```sh
npm ci --no-audit --no-fund              # once, in a fresh worktree
node node_modules/typescript/bin/tsc -p tests/acceptance/103-redraft-1830/tsconfig.json
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/103-redraft-1830 --testTimeout=600000 --no-file-parallelism --reporter=verbose --silent=false
```

The verbose reporter with `--silent=false` prints each timing's readings, loads and verdict; without them an
agent's shell may get only the counts.

The file imports the first draft's `helpers.ts` (unchanged, frozen) for the world, the host, the generic piece and
the manifest rows, so the same environment rules hold: `HOME` is a temp folder, every package and record is under
`/tmp/dh103-*` and removed after the file, every host is closed after the file, and nothing is stopped by name or
port. It times installs and reads, so it runs alone, as the first draft's file does; putting this folder on
`scripts/lanes.mjs`'s `alone` list and retiring the first draft's file are outside this folder and not done here.

## What each test proves

| Test | What it proves |
|---|---|
| `AC14 the perf lane has a task for each timing, and the budgets are valid against the merge base's` | `benchmarks/budgets.json` has `composition-wire` and `composition-edge-read`, and is valid by `validateBudgets` against the merge base's (`git merge-base HEAD origin/main`); with no merge base it fails BLOCKED. Not a timing, unchanged from the first draft. |
| `AC14 wiring a composition at install takes under 100 ms (five runs after a warm-up)` | The surface first: the wired brief's install wires its two uses (`acme/ci`, `acme/stocks`), on any machine. Then one warm-up run and five runs; a run is three wired and three plain installs, alternated, and reads the median wired install less the median plain one. Each run's load is read just before it and just after it. `judgeLimit` at 100 ms with the five loads. |
| `AC14 a reading crossing an edge adds under 1 ms (five runs of 200 reads after a warm-up)` | The surface first: the brief's bench reads through its edge. Then five runs of `ext.brief.bench` (200 reads through the edge, less 200 hub round trips that cross none), each with its load read before and after. `judgeLimit` at 1 ms with the five loads. |

The verdict is `judgeLimit`'s: PASS passes; FAIL fails, the message holding the five runs, the loads, the machine and
the reason; INCONCLUSIVE, and BLOCKED (five readings that aren't five finite non-negative numbers), print the same and
skip as INCONCLUSIVE with `judgeLimit`'s reason. The gate stays where the first draft had it, after each test's
surface check and before its warm-up: there the test skips as INCONCLUSIVE when this machine can't count a run now.
The first draft's gate called `judgeLimit` on five zero runs with no `loads`, so since #1555 it skipped everywhere;
this one gives `judgeLimit` five empty runs, each with the load read at its start and its end, so it passes on a fit
reference Mac under its core count and names the load otherwise. Past the gate, the five real runs are judged again
with their own loads. A skip is never a pass.

## The base run

On the base `3557b348`, on a Mac17,10 (a reference Mac) on mains power, macOS 26B8119, 18 cores, with other work
holding the one-minute load near 400. Type check: clean. Vitest, run once: 1 passed, 2 skipped (51 s).

- `AC14 the perf lane has a task for each timing, …`: **PASS**.
- `AC14 wiring a composition at install takes under 100 ms …`: the surface passed (the brief's two uses wired to
  `acme/ci` and `acme/stocks`); then **INCONCLUSIVE** at the gate, skipped before the timed runs:

  ```text
  AC14 INCONCLUSIVE: wiring at install not judged: a reading, not a budget result: off the reference Macs (Mac15,7
  (M3 Pro, 36 GB) or Mac15,12 (M3, 16 GB) or Mac17,10 (M5 Max, 64 GB); mains power, Low Power Mode off, thermal
  state nominal): load 420.4248046875 at a run's start or end is above the 18 cores
  ```

- `AC14 a reading crossing an edge adds under 1 ms …`: the surface passed (the bench read through its edge); then
  **INCONCLUSIVE** at the gate:

  ```text
  AC14 INCONCLUSIVE: a reading crossing an edge not judged: … load 390.3642578125 at a run's start or end is above
  the 18 cores
  ```

A PASS or FAIL needs a fit reference Mac with every run's load at or under its core count; that run hasn't been made.

An earlier draft of this file, with no gate, was also run once on the base; its timed runs were judged with their
loads and read INCONCLUSIVE the same way (wiring 5.144, 0.000, 0.000, 22.062, 0.000 ms; a read through an edge 5.732,
5.430, 1.845, 9.739, 6.118 ms; loads 357 to 390; `pmset` read battery power and the thermal state fair then).
