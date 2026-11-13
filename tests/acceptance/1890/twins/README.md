# Twins for the 1890 tests

The fix edits `packages/hub/test/background.test.ts`, a file under the test paths. The `before` lane lays the change's
test files over the merge base, so its merge base already holds the fixed test, and no wrong program can live in that
file. So each wrong program here replaces a file outside the test paths, and `../twins.json` names it for its criterion.

| Criterion | Twin | Replaces | What it plants | Why it is the criterion's wrong program |
|---|---|---|---|---|
| `#1890.e77cd011` (AC1) and `#1890.75952fb4` (AC2) | `drops-job-failure` | `packages/hub/src/plant.ts` | `plantOf` and `activePlant` answer `drops-job-failure` whatever `DEEP_HUB_PLANT` says, so every hub the build starts is the planted hub that keeps no job's failure | AC1: the hub that `background.test.ts` starts is planted too, so the test fails in the checkout and the first of the three runs fails. AC2: the test fails there and the list doesn't name it |
| `#1890.75952fb4` (AC2) | `listed-after-fix` | `scripts/known-failures.json` | The base's list with the background test still on it, `(#1890, added 2026-11-12)` | The test passes and its entry outlives the fix, which the design's rule ("the fix takes a failure off the list") forbids |

`drops-job-failure` keeps every export `plant.ts` has at the base (81a5a9b2f): `Plant`, `plantOf`, `activePlant`,
`plantedSessionEnd`, `plantedReload`, `plantedStart`, `plantedStop` and `piAcceptsReplaced`. The planted behaviour of
every other plant is left out, since none of them is selected here. `Plant` is any string, so the fix's
`options.plant === 'drops-job-failure'` still type-checks. The twin builds only if the fix adds no new export to
`plant.ts` (README, Surface choices). The planted behaviour itself is the fix's. On a fix that leaves it out, the twin's
hub drops nothing, and the tests pass on it.

`listed-after-fix` holds the base's `known-failures.json`, byte for byte, with one entry added: the base's test ID. AC2
reads any entry for a test of the file as stale once the file passes, so the entry fits whatever the fix names its test.
