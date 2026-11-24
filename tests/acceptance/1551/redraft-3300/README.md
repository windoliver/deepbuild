# Blind redraft for #3300: #1551's made-up idle reading, with each run's load

A blind redraft of the made-up reading of `tests/acceptance/1551/lane.test.ts`, written for #3300 from the issue, the
design and base commit `3637dea3f`, on the owner's ruling that the suites beside #854 and #896 that hand `canvas.mjs
judge` a made-up reading with no loads are redrafted in the same PR. It runs in the first draft's place: `lane.test.ts`
here carries every test of its first draft, each name with its ID unchanged, and the measured test (the lane's idle task
on this Mac) as written. The first draft stays as it was, frozen.

## Why

`shownReading` gives its runs a shown window but no `loadStart` or `loadEnd`, so `canvas.mjs judge` reads its timings
INCONCLUSIVE ("the load at each run's start and end can't be read") on every machine. The first draft's tests read the
window entry, and expect INCONCLUSIVE or not-PASS overall only where a window is off, so they pass; but criterion 3's
lint lists such a reading.

Here each run of `shownReading` carries `loadStart: 1, loadEnd: 1` in its own object literal (`LOAD_AT_REST`; no machine
has under one core, so the verdict is the same on every Mac). Its windows are the first draft's: shown throughout, and
the hidden, covered, asleep and headless runs the tests make of it are unchanged, since those windows are the tests'
point. With the loads read, a hidden or headless run is what keeps the verdict from passing, as the tests mean.

## What was read

AGENTS.md; issue #3300; `tests/acceptance/1551/lane.test.ts`, `helpers.ts`, `README.md` at the base;
`benchmarks/canvas.mjs` (`judgeEfficiency`), `benchmarks/canvas-judge.mjs` (`loadsOf`, `shownWindow`),
`scripts/benchmark.mjs` (`judgeLimit`); `scripts/lanes-lists.mjs`; the design's How we know version 0 works and
Dogfooding.

## Files

| File | Its made-up readings |
|---|---|
| `lane.test.ts` | `shownReading`'s run carries the load at rest; it imports `../helpers.ts`, which makes up no reading |

The suite's other files make up no reading for the judge, so they aren't redrafted.

## Run it

```sh
npx vitest run --root tests/acceptance/1551/redraft-3300
npx tsc --noEmit -p tests/acceptance/1551/redraft-3300/tsconfig.json
```

In `scripts/lanes-lists.mjs` `redrafted` sends `lane.test.ts` here and the first draft runs by hand only; it was neither
alone nor timed, so neither is the redraft. Results: `../../3300/BASE-FAILURE.txt`, section 6.
