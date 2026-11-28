# Blind redraft of #154's fetching files under #3525

#3525 moves the asset fetch out of `deep_kinds`. After it, `deep_kinds {op: "fetch", ...}` is refused with `enum` at `/params/arguments/op`, and the fetch is a form of `deep_job`. #3525 drafts the place only as "a job, run through `deep_job`"; its blind suite (`tests/acceptance/3525/README.md`, The new form) fixed the call as `deep_job {op: "fetch", library, id}`, or `{op: "fetch", pack, asset}` for a pinned pack's asset, with the base `deep_kinds` fetch's fields and replies: `held` with an ask, `fetched` with the asset, `refused` with a reason, BLOCKED with an unblock ask. Every other field of `deep_job` is left out. The fetch itself stays as it is today.

`tests/acceptance/154/helpers.ts` fetches each take with `fetchTake`, which is `deepKinds(w, {op: 'fetch', pack, asset})`. `fetchUntil`, `fetchLibrary` and `scoreWorld([lib, ...])` all reach it. On a right program after #3525, each of those calls is a tool error, so the tests below fail. This folder redrafts them from #154's criteria, #3525 and the base `b134dd38f`. The originals are not edited or deleted; a person approves the swap.

The files here are byte-for-byte copies of the originals (`cmp` equal). The only change is that their `./helpers.ts` is now this folder's `helpers.ts`. That file re-exports `../154/helpers.ts` unchanged (`export * from`) and shadows four names with copies:

- `fetchTake` calls `deep_job {op: "fetch", pack: ref(lib), asset: t.path}` in place of `deep_kinds`.
- `fetchUntil`, `fetchLibrary` and `scoreWorld` are copied line for line, unchanged. They must be copied because inside the original module each one calls that module's own `fetchTake` (or `fetchUntil`, `fetchLibrary`), and a re-export can't reach those calls.

The tests' names, criterion IDs, scenes, waits, assertions, expected values and order are the originals'. The swap is by file, so every test of each redrafted file is carried, in order. No test uses subtests.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `154/budgets.test.ts` › the perf lane has a task naming #154, valid against the merge base's budgets | AC9 #154.d6804da4 | Fetches nothing itself. It is carried because the swap is by file | `budgets.test.ts` › same name, unchanged |
| `154/budgets.test.ts` › the 60 s six-stem concert renders in under 60 s on the reference Mac's CPU, judged by the perf lane's rule | AC9 #154.d6804da4 | `scoreWorld([LIB])` fetches each take through `deep_kinds` fetch. That call is refused (`enum`), so `fetchLibrary`'s `fetched` expectation fails before any render | `budgets.test.ts` › same name. The takes are fetched through `deep_job {op: "fetch", pack, asset}` |
| `154/budgets.test.ts` › a cached stem costs nothing, and every render ran in a process of its own, off the UI thread | AC9 #154.d6804da4 | The same `scoreWorld([LIB])` | `budgets.test.ts` › same name, the same change |
| `154/cache.test.ts` › editing one guitar note re-renders strings alone, and keys and pads are cache hits with no process | AC3 #154.6e31be7c | The same `scoreWorld([LIB])` | `cache.test.ts` › same name, the same change |
| `154/fetch.test.ts` › offline, the score whose library isn't fetched is BLOCKED with one unblock ask, and nothing is fetched | AC5 #154.87a31a62 | Each `fetchTake` is refused by schema, not answered BLOCKED, so "each fetch of a take, offline, is BLOCKED" fails. A refusal also raises no unblock ask | `fetch.test.ts` › same name. The fetch is made through `deep_job` |
| `154/fetch.test.ts` › no take is fetched before your answer to its ask or your standing rule, and the plan answers once every take is in | AC5 #154.87a31a62 | `fetchTake` and `fetchUntil` are refused, so there is no `held`, no authority ask and no `fetched` | `fetch.test.ts` › same name, the same change |
| `154/licences.test.ts` › libraries under CC-BY-SA-4.0, CC-BY-NC-4.0 and GPL-3.0-only, and one with a CC-BY-NC-4.0 take, are refused at install naming the licence; CC0 and CC-BY-4.0 install | AC4 #154.ee9b85a0 | This one wouldn't fail on a right program, but its probe would become empty. "No take of a refused library is fetched" would hold because the `deep_kinds` call is refused by schema, not because the hub refuses the library | `licences.test.ts` › same name. The probe is made through the fetch's new form, so the hub's refusal of the library is what it reads |
| `154/onsets.test.ts` › each event's note_on lands on its resolved flick through a tempo map with a ramp, and the render puts it on that sample | AC2 #154.8b0e5b99 | Fetches nothing (`scoreWorld([])`). It is carried because the swap is by file | `onsets.test.ts` › same name, unchanged |
| `154/onsets.test.ts` › score.pitch fails a4_held on the sample 50 cents sharp, naming it, passes it in tune, and a planted check reading the event's pitch fails this test | AC2 #154.8b0e5b99 | `scoreWorld([intuneLib, sharpLib])` fetches through `deep_kinds` | `onsets.test.ts` › same name. The takes are fetched through `deep_job` |

## Kept as they are

- `154/stems.test.ts` (AC1) reaches the fetch through `scoreWorld([LIB])`. It is already by hand only (`byHand.push('tests/acceptance/154/stems.test.ts')`, `scripts/lanes-lists.mjs`), and `tests/acceptance/154-redraft/` covers AC1 in the lanes, so it is not redrafted here.
- `154/loop.test.ts` (AC7, `scoreWorld([])`), `154/rules.test.ts` (AC6) and `154/registry.test.ts` (AC8) never fetch, so they stay as they are. `tests/acceptance/2362/score.test.ts` runs `154/rules.test.ts`, which this redraft doesn't touch.
- `tests/acceptance/154-redraft/` and `154-oracle*/` are other jobs' suites and are not reviewed here. `154/README.md` still states the fetch as `deep_kinds`; it is the frozen suite's README and is not edited.
- `154/` has no `twins.json`, so there are no twins to carry.
- `proof()` still writes to `$TMPDIR/deep-154-proof/` (the original helper's directory), shared with the original suite.

## What `scripts/lanes-lists.mjs` needs (not edited here)

```js
// #3525 moves the asset fetch from deep_kinds to deep_job {op: "fetch", ...}; #154's files that fetch through
// deep_kinds no longer hold their scene there. Their blind redraft runs in their place, alone as #154's suite does.
Object.assign(redrafted, Object.fromEntries(['budgets', 'cache', 'fetch', 'licences', 'onsets']
  .map((f) => [`tests/acceptance/154/${f}.test.ts`, 'tests/acceptance/154-redraft-3525/'])));
byHand.push(...['budgets', 'cache', 'fetch', 'licences', 'onsets'].map((f) => `tests/acceptance/154/${f}.test.ts`));
alone.push('tests/acceptance/154-redraft-3525/');
timed.push('tests/acceptance/154-redraft-3525/budgets.test.ts');
```

- `alone`: these files start hubs that render through the supervisor and build deep-show, as `154/`'s do.
- `timed`: `budgets.test.ts` times the 60 s six-stem render, as `154/budgets.test.ts` (already `timed`) does.
- `154/` stays in `alone` for its remaining files (`loop`, `rules`, `registry`).
- The swap lands with #3525, or the redraft fails on the base (see Runs).

## Runs

Run with:

```
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/154-redraft-3525 --testTimeout=600000 --no-file-parallelism
```

The suite needs `target/debug/deep-hook` and `deep-show` (`cargo build --locked --bin deep-show`). Every file but `licences.test.ts` calls `useShow()`, whose `beforeAll` runs that cargo build. `deep-show` is not built in this checkout, and this job didn't build it because disk is tight. So only `licences.test.ts` ran, once, on the base `b134dd38f` plus the blind #3525 suite commit. It ran with Node 24.22.0 on macOS, with a 1-minute load of 345 at the start (`BASE-RUN.txt`).

| File › test | Criterion | Program | Expected | Result |
|---|---|---|---|---|
| `licences.test.ts` › … refused at install naming the licence; CC0 and CC-BY-4.0 install | AC4 #154.ee9b85a0 | base | passes: the base refuses `deep_job {op: "fetch", pack, asset}` with `unlisted_field` (`3525/README.md`), so nothing is fetched | `INCONCLUSIVE`: failed for the environment. The control install exits 3, "No canvas core is built under ~/…/target; run cargo build --bin deep-show first." |
| `budgets.test.ts` (3), `cache.test.ts` (1), `fetch.test.ts` (2), `onsets.test.ts` (2) | AC9, AC3, AC5, AC2 | base | the fetching tests fail: `deep_job` refuses `pack`/`asset` (`unlisted_field`); `budgets` 1 and `onsets` 1 pass | `INCONCLUSIVE`: not run, because they need a deep-show build |
| the whole folder | all | a #3525 change | passes, as the originals did on the base | `INCONCLUSIVE`: no change exists |

Checked without a test run, which proves nothing about behavior:

- `tsc -p tests/acceptance/154-redraft-3525/tsconfig.json` exits 0 with no output.
- Each test file is `cmp`-equal to its original.
