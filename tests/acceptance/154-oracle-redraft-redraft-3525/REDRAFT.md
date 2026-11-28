# Blind redraft of #154's redrafted Oracle lane (`154-oracle-redraft/`) under #3525

#3525 moves the asset fetch out of `deep_kinds`: a `deep_kinds` call with `op: "fetch"` is refused with `enum` at
`/params/arguments/op`, and the fetch becomes a form of `deep_job`. #3525's blind acceptance suite
(`tests/acceptance/3525/README.md`) fixes the call as `deep_job {op: "fetch", pack, asset}`, with the same fields and
replies as the base's `deep_kinds` fetch. `tests/acceptance/154-oracle-redraft/sample-accurate.test.ts` takes
`scoreWorld` from its `helpers.ts`, which re-exports `../154-redraft/helpers.ts`, whose `fetchLibrary` fetches each take
through `deep_kinds {op: "fetch"}`. After #3525 that call is refused, the `fetched` assertion fails, and the test fails
in its world's setup, on a right program.

This folder redrafts it from #154's criterion 2, #3525 and the base `b134dd38f`. `helpers.ts` here re-exports
`tests/acceptance/154-redraft-3525b/helpers.ts` (another blind job's redraft: it re-exports `../154-redraft/helpers.ts`
and shadows `fetchTake` and `scoreWorld` so the take's fetch is `deep_job {op: "fetch", pack, asset}`), plus `UPSTREAM`,
`SAMPLE_OFFSETS` and `SPACING` exactly as `154-oracle-redraft/helpers.ts` has them; only its header comment and its
`export *` line differ. The original is not edited or deleted; a person approves the swap. Run with:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/154-oracle-redraft-redraft-3525 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/154-oracle-redraft-redraft-3525/tsconfig.json
rm -rf tests/acceptance/154-oracle-redraft-redraft-3525/node_modules/.vite
```

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `154-oracle-redraft/sample-accurate.test.ts` › AC2 #154.8b0e5b99 sample-accurate scheduling, ported: nine notes at upstream's offsets each start on exactly their sample and nowhere else, left and right match, nine found and none misplaced | #154.8b0e5b99 | `scoreWorld([TONE])` fetches testlib/onset's take through `deep_kinds {op: "fetch"}`, which #3525 refuses with `enum`; the fetch never says `fetched` and the test fails in its setup | `sample-accurate.test.ts` › same `describe` and `it` names. The file is byte for byte the original's: it imports from `./helpers.ts`, and the change is in that `helpers.ts` alone (its world comes from `154-redraft-3525b`). Upstream's attribution, the offsets, the spacing, the tone, the score, the plan, the render and every assertion and expected value are the original's |

The file holds the original's one `describe` with its one test, so the swap drops nothing. No `t.test` subtests. No
twins: `154-oracle-redraft/` has no `twins.json`.

## What `scripts/lanes-lists.mjs` needs for the swap (not edited here)

- `tests/acceptance/154-oracle-redraft/` is in `alone` today (line ~633, with `tests/acceptance/154-redraft/`). It is in
  neither `timed` nor `byHand`. The redraft starts its own hub as the original does, so:
  - `redrafted['tests/acceptance/154-oracle-redraft/sample-accurate.test.ts'] =
    'tests/acceptance/154-oracle-redraft-redraft-3525/'`, and the same for `tests/acceptance/154-oracle-redraft/helpers.ts`
    if helpers are mapped as #1830's are;
  - `byHand.push('tests/acceptance/154-oracle-redraft/sample-accurate.test.ts')`;
  - `alone.push('tests/acceptance/154-oracle-redraft-redraft-3525/')`. Not `timed`: the original isn't.
- `LANE_FILE` matches only numeric folder names, so a `lane.json` can't place this folder; the `alone` line is needed.
- The helper folder `tests/acceptance/154-redraft-3525b/` has its own tests and its own lane entry to settle.

## Runs

`BASE-RUN.txt`: one run on the checkout (base `b134dd38f` plus #3525's blind suite, `d9b9015ff`), with deep-show built
from it, node 24.22.0, starting at a 1-minute load of 98 and ending at 122. The test failed, as it must on the base:
`deep_job` there has no `fetch` form, so the take's fetch is refused with `unlisted_field` at `/params/arguments/pack`,
and `fetchLibrary` (`../154-redraft-3525b/helpers.ts:61`) fails on `fetched`. That shows the redraft reaches the new
form. It doesn't show the test passes on a right program: no #3525 implementation exists, so that is `INCONCLUSIVE`.
`tsc -p` on this folder's `tsconfig.json` exits 0.
