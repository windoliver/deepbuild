# Blind redraft of #154's Oracle lane (`154-oracle/`) under #3525

#3525 moves the asset fetch out of `deep_kinds`: a `deep_kinds` call with `op: "fetch"` is refused with `enum` at
`/params/arguments/op`, and the fetch becomes a form of `deep_job`. #3525's blind acceptance suite
(`tests/acceptance/3525/README.md`) fixes the call as `deep_job {op: "fetch", pack, asset}`, with the same fields and
replies as the base's `deep_kinds` fetch. `tests/acceptance/154-oracle/sample-accurate.test.ts` takes `scoreWorld` from
`../154/helpers.ts`, whose `fetchLibrary` fetches each take through `deep_kinds {op: "fetch"}`. After #3525 that call is
refused, `fetchLibrary`'s `fetched` assertion fails, and the test fails before it schedules a note, on a right program.

This folder redrafts that file from #154's criterion 2, #3525 and the base `b134dd38f`. It takes its world from
`tests/acceptance/154-redraft-3525/helpers.ts` (another blind job's redraft: it re-exports `../154/helpers.ts` and
overrides `fetchTake`, `fetchUntil`, `fetchLibrary` and `scoreWorld` so the take's fetch is `deep_job {op: "fetch", pack,
asset}`). The original is not edited or deleted; a person approves the swap. Run with:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/154-oracle-redraft-3525 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/154-oracle-redraft-3525/tsconfig.json
```

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `154-oracle/sample-accurate.test.ts` › AC2 #154.8b0e5b99 impulses at offsets inside and across 128-sample quanta land on exactly their sample and nowhere else; a renderer that starts notes per quantum is rejected | #154.8b0e5b99 | `scoreWorld([CLICKS])` fetches test/clicks' take through `deep_kinds {op: "fetch"}`, which #3525 refuses with `enum`; the fetch never says `fetched` and the test fails in its setup | `sample-accurate.test.ts` › same `describe` and `it` names. The only change is the import line: every name now comes from `../154-redraft-3525/helpers.ts` in place of `../154/helpers.ts`. The upstream license notice, the offsets, the quantum, the BPM, the library, `beatOf`, the score, `checkSampleAccuracy`, the planted fault, the proof file and every assertion and expected value are the original's, line for line (`diff` shows line 40 alone) |

The file holds the original's one `describe` with its one test, so the swap drops nothing. No `t.test` subtests.
No twins: the folder `154-oracle/` has no `twins.json`.

The `proof()` call writes `oracle-sample-accurate.json` into the #154 suite's proof directory, as the original does,
since `proof` is the re-exported `../154/helpers.ts` one.

## What `scripts/lanes-lists.mjs` needs for the swap (not edited here)

- `tests/acceptance/154-oracle/` is in `alone` today (line ~629, with `tests/acceptance/154/`). It is in neither `timed`
  nor `byHand`. The redraft starts its own hub and renders through the supervisor as the original does, so:
  - `redrafted['tests/acceptance/154-oracle/sample-accurate.test.ts'] = 'tests/acceptance/154-oracle-redraft-3525/'`;
  - `byHand.push('tests/acceptance/154-oracle/sample-accurate.test.ts')`, so the original runs by hand only;
  - `alone.push('tests/acceptance/154-oracle-redraft-3525/')`. Not `timed`: the original isn't.
- `LANE_FILE` matches only numeric folder names, so a `lane.json` can't place this folder; the `alone` line is needed.
- The helper folder `tests/acceptance/154-redraft-3525/` has its own tests and its own lane entry to settle; this folder
  only imports it.

## Runs

`BASE-RUN.txt`: one run on the checkout (base `b134dd38f` plus #3525's blind suite, `d9b9015ff`), with deep-show built
from it, node 24.22.0, starting at a 1-minute load of 148 and ending at 98. The test failed, as it must on the base:
`deep_job` there has no `fetch` form, so the take's fetch is refused with `unlisted_field` at `/params/arguments/pack`,
and `fetchLibrary` (`../154-redraft-3525/helpers.ts:32`) fails on `fetched`. That shows the redraft reaches the new
form. It doesn't show the test passes on a right program: no #3525 implementation exists, so that is `INCONCLUSIVE`.
The run took 2,551 s, nearly all of it outside the test (26.8 s), under that load.
