# Blind redraft for #1830 of #761's budgets (AC3)

A redraft of `tests/acceptance/761/budgets.test.ts`, written blind for #1830. It runs in that file's place: the
same two tests, the same names (with AC3's ID, `#761.51e647b5`), the same criterion, the same work, the same proof
step and the same limit. What changes: every timing run reads the one-minute load average (`os.loadavg()[0]`) at its
start and at its end, and the `judgeLimit` call passes those readings as `loads`, one `{ start, end }` per run, in the
runs' order, as the design's timing rule says. The first draft called `judgeLimit` with `limit`, `runs` and
`fingerprint` only, so since #1555 its timing read INCONCLUSIVE on every machine, the reference Macs included.

It read only:

- issue #1830's body (the dispute) and issue #761's body (AC3: "Budgets, on the reference Mac in the local
  preflight, compared with the merge base: with the field rules, redaction still adds under 10 ms per MB of text");
- `AGENTS.md`;
- the first draft at the base: `tests/acceptance/761/budgets.test.ts` and `README.md`, and the helpers it imports
  from `tests/acceptance/15/helpers.ts`;
- `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`, `validateBudgets`);
- `docs/technical-design.md`: How we know version 0 works (the timing rule: a loaded run counts neither way; The
  reference Macs) and Dogfooding (a disputed test goes to a fresh run of the job that wrote it).

The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What the base has

The base is `3557b348` (main). It has #761's field rules in the evidence scrub, and `benchmarks/budgets.json` holds
#15's `evidence-redact-text` (`node benchmarks/evidence.mjs redact-8mb`). `judgeLimit` there knows three reference
Macs (Mac15,7, Mac15,12 and Mac17,10) and reads INCONCLUSIVE whenever `loads` is missing, malformed, or holds a
reading above the core count (`availableParallelism()`).

## How to run

From the checkout's root, with the repo's Node (24.22) first on `PATH`:

```sh
npm ci --no-audit --no-fund              # once, in a fresh worktree
node node_modules/typescript/bin/tsc -p tests/acceptance/761-redraft-1830/tsconfig.json
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/761-redraft-1830 --testTimeout=600000 --no-file-parallelism --reporter=verbose --silent=false
```

The verbose reporter with `--silent=false` prints each timing's readings, loads and verdict; without them an
agent's shell may get only the counts.

The file imports #15's `helpers.ts` (unchanged) for the store's temp roots, `storeText`, `stored`, the seeded words
and `anyUse`, as the first draft does; every root is removed after each test. `tsconfig.json` is the other suites'
(the root options with `noEmit` and `allowImportingTsExtensions`); the first draft's folder has none. The timing
test times a scrub, so it runs alone, as the first draft's README asks for its file; putting this folder on
`scripts/lanes.mjs`'s `alone` list and retiring the first draft's file are outside this folder and not done here.

## What each test proves

| Test | What it proves |
|---|---|
| `AC3 the perf lane still has #15's evidence-redact-text task, unchanged, and the budgets are valid against the merge base's` | `benchmarks/budgets.json` is valid by `validateBudgets` against the merge base's (`git merge-base HEAD origin/main`) and still holds `evidence-redact-text` running `node benchmarks/evidence.mjs redact-8mb`; with no merge base it fails BLOCKED. Not a timing, unchanged. |
| `AC3 with the field rules, redaction adds under 10 ms per MB of text (five runs after a warm-up)` | The proof step first, on every machine, unchanged: the warm-up text stored through the text sink keeps no `v7_` field value, one stored line per printed line, each field line starting with its own field name, and the four twins unchanged. Then six texts of 8 MB; a run is one text's scrubbed put and the same bytes' plain put (one byte changed), read as the difference per MB, a negative reading counting as 0. The first is the warm-up; each of the five runs has its load read just before its scrubbed put and just after its plain put. `judgeLimit` at 10 ms per MB with the five loads. |

The verdict is `judgeLimit`'s: PASS passes; FAIL fails, the message holding the raw readings, the loads, the machine
and the reason; INCONCLUSIVE, and BLOCKED (five readings that aren't five finite non-negative numbers), print the same
and skip as INCONCLUSIVE with `judgeLimit`'s reason. The gate stays where the first draft had it, after the proof step
and before any timing: there the test skips as INCONCLUSIVE when this machine can't count a run now. The first draft's
gate called `judgeLimit` on five zero runs with no `loads`, so since #1555 it skipped everywhere; this one gives
`judgeLimit` five empty runs, each with the load read at its start and its end, so it passes on a fit reference Mac
under its core count and names the load otherwise. Past the gate, the five real runs are judged again with their own
loads. A skip is never a pass.

## The base run

On the base `3557b348`, on a Mac17,10 (a reference Mac) on mains power, macOS 26B8119, 18 cores, with other work
holding the one-minute load near 355. Type check: clean. Vitest, run once: 1 passed, 1 skipped (9 s).

- `AC3 the perf lane still has #15's evidence-redact-text task, …`: **PASS**.
- `AC3 with the field rules, redaction adds under 10 ms per MB of text …`: the proof step passed (no field value
  kept, every field name kept, the twins unchanged); then **INCONCLUSIVE** at the gate, skipped before any timing:

  ```text
  AC3 INCONCLUSIVE: not timed: a reading, not a budget result: off the reference Macs (Mac15,7 (M3 Pro, 36 GB) or
  Mac15,12 (M3, 16 GB) or Mac17,10 (M5 Max, 64 GB); mains power, Low Power Mode off, thermal state nominal): thermal
  state is "fair", not "nominal"; load 355.54248046875 at a run's start or end is above the 18 cores
  ```

A PASS or FAIL needs a fit reference Mac with every run's load at or under its core count; that run hasn't been made.

An earlier draft of this file, with no gate, was also run on the base (twice: its first run's default reporter
printed no test output). Its timed runs were judged with their loads and read INCONCLUSIVE the same way: 286.71,
64.81, 293.03, 247.62, 380.18 ms per MB at loads 662 to 666, thermal state fair.
