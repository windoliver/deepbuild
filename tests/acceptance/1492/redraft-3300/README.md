# Blind redraft for #3300: #1492's made-up idle reading, with each run's load and a shown window

A blind redraft of the made-up reading of `tests/acceptance/1492/`, written for #3300 from the issue, the design and
base commit `3637dea3f`, on the owner's ruling that the suites beside #854 and #896 that hand `canvas.mjs judge` a
made-up reading with no loads are redrafted in the same PR. It runs in the first draft's place: `idle-energy.test.ts`
here carries every test of its first draft, each name with its ID unchanged, and the measured test (the idle task run
on a Mac) as written. The first draft stays as it was, frozen.

## Why

`idleReport` (`../helpers.ts`) gives its runs no `loadStart` or `loadEnd` and no `window`, so `canvas.mjs judge` reads
its timings INCONCLUSIVE ("the load at each run's start and end can't be read") and its window `headless` on every
machine. The first draft's tests read the energy entry only, which neither changes, so they pass; but criterion 3's
lint lists such a reading, and the issue's scope gives every made-up idle run its load and a shown window.

Here `idleReport` is the first draft's, line for line, each run given `loadStart: 1, loadEnd: 1` and
`window: { state: 'shown', shown_ms: 60010 }` in its own object literal. Its point is the energy reading, never the
window, so a shown window, the idle task's own shape for a window held on screen (#1551), changes no test's point; the
energy-only test's three readings still get one verdict status, now PASS rather than INCONCLUSIVE.

## What was read

AGENTS.md; issue #3300; `tests/acceptance/1492/` at the base; `benchmarks/canvas.mjs` (`judgeEfficiency`),
`benchmarks/canvas-judge.mjs` (`loadsOf`, `shownWindow`, `energyReading`), `scripts/benchmark.mjs` (`judgeLimit`);
`scripts/lanes-lists.mjs`; the design's How we know version 0 works and Dogfooding.

## Files

| File | Its made-up readings |
|---|---|
| `helpers.ts` | `export *` of `../helpers.ts`, except `idleReport`, redrafted as above |
| `idle-energy.test.ts` | none of its own; only its header comment differs |

`panel-host.test.ts` makes up no reading, so it isn't redrafted and runs as it did.

## Run it

```sh
npx vitest run --root tests/acceptance/1492/redraft-3300
npx tsc --noEmit -p tests/acceptance/1492/redraft-3300/tsconfig.json
```

The live test runs `node benchmarks/canvas.mjs idle` on macOS, as the first draft's does. In `scripts/lanes-lists.mjs`
`redrafted` sends `idle-energy.test.ts` and `helpers.ts` here, and the first draft's test file runs by hand only; neither
was alone or timed, so neither is the redraft. Results: `../../3300/BASE-FAILURE.txt`, section 6.
