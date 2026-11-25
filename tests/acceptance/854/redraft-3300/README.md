# Blind redraft for #3300: #854's made-up readings, with each run's load and each idle run's window

A blind redraft of the made-up readings of `tests/acceptance/854/`, written for #3300 from the issue, the design and
base commit `3637dea3f` ("Merge pull request #3288 …"). It runs in the first draft's place: each file here carries
every test of its first draft, each name with its ID unchanged, and the measured tests as written. The first draft stays
as it was, frozen; nothing of `tests/acceptance/854/` outside this folder changed.

## Why

Since #1830 (`1055cc469`) `node benchmarks/canvas.mjs judge` passes each run's `loadStart` and `loadEnd` to
`judgeLimit` (`scripts/benchmark.mjs`), and a run whose load it can't read is INCONCLUSIVE: "the load at each run's
start and end can't be read". The first draft's `synthetic` (`../helpers.ts`), its `patchRun`, and the runs its tests
make up themselves give no loads, so every test that judges a made-up reading and expects PASS or FAIL fails on every
machine, the reference Macs included. Since #1551 (`2e1eeb506`) the idle judge also reads a run with no `window` as
`headless`, INCONCLUSIVE, and the first draft's idle runs give none. The design says such a run "counts neither way"
(How we know version 0 works), so the tests are the wrong side, not the judge.

Here every made-up run carries `loadStart: 1, loadEnd: 1` (`LOAD_AT_REST`): `judgeLimit` reads a load as loaded only
above the core count of the machine that judges, and no machine has under one core, so the verdicts are the same on
every Mac. Every made-up idle run carries `window: { state: 'shown', shown_ms: 60010 }` (`SHOWN`), as the idle task
records a window it held on screen. The loads are written in each run's object literal, where a lint reads them.

## What was read

- AGENTS.md; issue #3300's body.
- `tests/acceptance/854/` at the base: every file.
- `benchmarks/canvas.mjs` (`judge`, `judgeEfficiency`), `benchmarks/canvas-judge.mjs` (`loadsOf`, `shownWindow`),
  `scripts/benchmark.mjs` (`judgeLimit`), `scripts/loads-lint.mjs`, `scripts/lanes-lists.mjs` (`redrafted`, `byHand`,
  `timed`, `alone`), #1830's redrafts (`465-redraft-1830/`, `311/redraft-ac12/`, `1018/redraft-ac6/`) for the convention,
  and `1551/lane.test.ts` for the shape of a shown window.
- `docs/technical-design.md`: How we know version 0 works (the timing rule and the load) and Dogfooding.

## What changed, file by file

| File | Its made-up readings |
|---|---|
| `helpers.ts` | `export *` of `../helpers.ts`, except `patchRun` and `synthetic`: the first draft's, line for line, each run given the load at rest, the idle runs a shown window |
| `patch.test.ts` | none of its own beyond `patchRun`'s, so only its header comment differs |
| `scene-read.test.ts` | its 2,437-token runs carry the load |
| `idle.test.ts` | its three-frame run carries the load and a shown window |
| `replica.test.ts` | its 700 ms runs carry the load |
| `release.test.ts` | none of its own; only its header comment differs |
| `replica-redraft.test.ts` | `madeUpRun`'s runs carry the load |

`budgets.test.ts` judges no reading, so it isn't redrafted. Every import is `./helpers.ts`, which here is this folder's;
`REPO` is the first draft's, so the measured tests reach the same checkout root.

## What the base has

At the base the first drafts' tests that judge a made-up reading fail on this Mac, each naming the load it can't read,
except `replica-redraft.test.ts`'s third, which reads FAIL on the pipeline a missing load doesn't stop; their redrafts
here pass (`../../3300/BASE-FAILURE.txt`). `release.test.ts` builds `deep-show` after its judging, so its redraft was not
run here.

## Run it

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/854/redraft-3300 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/854/redraft-3300/tsconfig.json
```

The measured tests build and time exactly as the first draft's do (`../README.md`). In `scripts/lanes-lists.mjs` the
`redrafted` entries for #3300 send each first-draft file to this folder: the first drafts run by hand only, this folder
runs alone with `tests/acceptance/854/`, and each redraft is timed where its first draft was. Delete Vitest's cache in
`tests/acceptance/854/redraft-3300/node_modules/.vite` after a run.
