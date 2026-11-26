# Blind redraft for #3300: #896's made-up readings, with each run's load

A blind redraft of the made-up readings of `tests/acceptance/896/`, written for #3300 from the issue, the design and
base commit `3637dea3f` ("Merge pull request #3288 …"). It runs in the first draft's place: each file here carries
every test of its first draft, each name with its ID unchanged, and the measured tests as written. The first draft stays
as it was, frozen; nothing of `tests/acceptance/896/` outside this folder changed.

## Why

Since #1830 (`1055cc469`) `node benchmarks/canvas.mjs judge` passes each run's `loadStart` and `loadEnd` to
`judgeLimit` (`scripts/benchmark.mjs`), and a run whose load it can't read is INCONCLUSIVE: "the load at each run's
start and end can't be read". The first draft's `settledReading` and `dirtyReading` (`../helpers.ts`) give their runs no
loads, so `settled.test.ts`'s judge test and `dirty.test.ts`'s two read INCONCLUSIVE where they expect PASS, on every
machine, the reference Macs included. The design says a run whose load can't be read "counts neither way" (How we know
version 0 works), so the tests are the wrong side, not the judge.

Here every made-up run carries `loadStart: 1, loadEnd: 1` (`LOAD_AT_REST`), written in the run's object literal:
`judgeLimit` reads a load as loaded only above the core count of the machine that judges, and no machine has under one
core, so the verdicts are the same on every Mac. #896's tasks are no idle task, so no window is made up.

## What was read

- AGENTS.md; issue #3300's body.
- `tests/acceptance/896/` at the base, every file, and `tests/acceptance/854/helpers.ts`, whose judge, gate and rule it
  uses.
- `benchmarks/canvas.mjs` (`judge`, `judgeEfficiency`), `benchmarks/canvas-judge.mjs` (`loadsOf`, `unjudged`),
  `scripts/benchmark.mjs` (`judgeLimit`), `scripts/loads-lint.mjs`, `scripts/lanes-lists.mjs`, and #1830's redrafts
  (`465-redraft-1830/`, `311/redraft-ac12/`, `1018/redraft-ac6/`) for the convention.
- `docs/technical-design.md`: How we know version 0 works and Dogfooding.

## What changed, file by file

| File | Its made-up readings |
|---|---|
| `helpers.ts` | `export *` of `../helpers.ts`, except `settledReading` and `dirtyReading`: the first draft's, line for line (with its private `madeSample`), each run given the load at rest |
| `settled.test.ts` | none of its own; only its header comment differs |
| `dirty.test.ts` | none of its own; only its header comment differs |

Every import is `./helpers.ts`, which here is this folder's; it re-exports the first draft's, so `REPO` and the
measured tests' runner are the same.

## What the base has

At the base the first drafts' three judge tests fail on this Mac, naming the load they can't read; their redrafts here
pass (`../../3300/BASE-FAILURE.txt`).

## Run it

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/896/redraft-3300 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/896/redraft-3300/tsconfig.json
```

The measured tests build and time exactly as the first draft's do (`../README.md`). In `scripts/lanes-lists.mjs` the
`redrafted` entries for #3300 send `settled.test.ts`, `dirty.test.ts` and `helpers.ts` to this folder: the first drafts
run by hand only, this folder runs alone with `tests/acceptance/896/`, and both redrafts are timed as their first drafts
are. Delete Vitest's cache in `tests/acceptance/896/redraft-3300/node_modules/.vite` after a run.
