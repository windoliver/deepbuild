# Blind redraft of #154's redraft files that fetch through `deep_kinds`, under #3525

#3525 moves the asset fetch out of `deep_kinds`. After it, `deep_kinds {op: "fetch", ...}` is refused with `enum` at
`/params/arguments/op`, and the fetch is a form of `deep_job`. The issue drafts the place ("a job, run through
`deep_job`"); #3525's blind suite fixes the call (`tests/acceptance/3525/README.md`, The new form) as
`deep_job {op: "fetch", library, id}`, or `{op: "fetch", pack, asset}` for a pinned pack asset, with the base
`deep_kinds` fetch's fields and replies: `held` with an ask, `fetched` with the asset, `refused` with a reason, BLOCKED
with an unblock ask. Every other `deep_job` field is left out. The fetch itself is what it is today (#3525, Scope).

`tests/acceptance/154-redraft/helpers.ts` fetches a take through `deep_kinds` (`fetchArgs`, `deepKinds`) in two
places: `fetchTake`, which `offline.test.ts` calls, and `fetchLibrary`, which `scoreWorld` calls to fetch each library
under your standing rule before a file's first test. So every file that builds its world with `scoreWorld`, or calls
`fetchTake`, stops on a right program after #3525: `scoreWorld` asserts `fetched` and gets the `enum` refusal. This
folder redrafts those six files from #154's criteria and the 154-redraft's own scenes. The originals are not edited
or deleted; a person approves the swap. Run with:

```
node_modules/.bin/vitest run tests/acceptance/154-redraft-3525b/ --no-file-parallelism
```

`helpers.ts` here re-exports `../154-redraft/helpers.ts` unchanged and shadows two of its exports, `fetchTake` and
`scoreWorld`, so the take's fetch is `deep_job {op: "fetch", pack: "<id>@<version>", asset: "<path>"}`. The fields
and the retry on `held`/`pending` are the original's. `fetchLibrary`, `control` (the cli-socket call for
`pack.rule`), `tool` and `parse` are the original's, line for line. The original module doesn't export them, so they
are copied. Each test file is the original's, byte for byte. The one exception is a comment in `offline.test.ts`'s
header, which named `deep_kinds` as the fetch's path. Each file still imports `./helpers.ts`, which now resolves to the
helpers here. `tsconfig.json` is the original's.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `154-redraft/offline.test.ts` › AC5 online: the score plans BLOCKED naming its unfetched library with no request; the take's fetch holds on one authority ask … then the score plans | #154.87a31a62 | `fetchTake` calls `deep_kinds {op: fetch, pack, asset}`. After #3525 that call is refused with `enum`, never `held`, so `held.value.status` is not `held` on a right program | `offline.test.ts` › same name. The only change: `fetchTake` calls `deep_job {op: fetch, pack, asset}` |
| `154-redraft/offline.test.ts` › AC5 with no network: … its fetch is BLOCKED twice with exactly one unblock ask and no authority ask … | #154.87a31a62 | Both fetches are refused with `enum`, a refusal and not BLOCKED, and they raise no unblock ask | `offline.test.ts` › same name, the same change |
| `154-redraft/determinism.test.ts` › AC1 two runs in two fresh hubs …; adding one note to a stem changes no other note's noise …; over 1,024 notes … no note repeats the previous note's take (3 tests) | #154.c8c95dbc | `world1`/`world2` = `scoreWorld([KEYS, BELLS])`, whose `fetchLibrary` asserts `fetched` from `deep_kinds` and gets the refusal. Every test fails in its setup | `determinism.test.ts` › the same three, in order. The only change: `scoreWorld` fetches through `deep_job` |
| `154-redraft/onsets.test.ts` › AC2 each event's note_on … within one sample …; score.pitch fails … 50 cents sharp … (2 tests) | #154.8b0e5b99 | `scoreWorld([TUNED, SHARP])`, the same refusal in setup | `onsets.test.ts` › the same two, the same change |
| `154-redraft/cache.test.ts` › AC3 a plucked note's pitch edited: only the guitar stem misses; then one more keys note: only the keys stem misses | #154.6e31be7c | `scoreWorld([KEYS])`, the same refusal in setup | `cache.test.ts` › same name, the same change |
| `154-redraft/loop.test.ts` › AC7 the looped stem's loop points sit on 5:1 and 9:1 exactly … | #154.54798db1 | `scoreWorld([BED])`, the same refusal in setup | `loop.test.ts` › same name, the same change |
| `154-redraft/budgets.test.ts` › AC9 the canvas side only plans …; on the reference Mac a 60 s six-stem score renders in under 60 s … (2 tests) | #154.d6804da4 | `scoreWorld([KEYS, BELLS])`, the same refusal in setup | `budgets.test.ts` › the same two, the same change |

## Kept as they are

- Carried unchanged into `budgets.test.ts` here: `154-redraft/budgets.test.ts` › AC9 #154.d6804da4 "the perf lane has
  a task whose reason names #154, and the budgets are valid against the merge base's". It never awaits the world, so it
  never fetches. It is here because the swap is by file: each file holds the original's tests in the original's order
  (budgets 3, cache 1, determinism 3, loop 1, offline 2, onsets 2: 12 tests). Every name, ID, scene, wait, assertion
  and expected value is the original's, and no test uses `t.test` subtests.
- Staying where they are: `154-redraft/limits.test.ts` (AC6 #154.74061b19). It builds films for `deep show` with
  `writeLibrary` and never calls `scoreWorld` or `fetchTake`. Also `154-redraft/README.md`, `DISPUTE.md` and
  `BASE-FAILURE.txt`. `tests/acceptance/154/` is another job's.
- Not covered by this brief: `tests/acceptance/154-oracle-redraft/sample-accurate.test.ts`. Its `helpers.ts` does
  `export * from '../154-redraft/helpers.ts'`, and the test builds its world with `scoreWorld([TONE])`, so it reaches
  the fetch through `deep_kinds` too. After #3525 it fails the same way. It needs the same swap (pointing its
  `export *` at a helpers that shadows `scoreWorld`), and someone has to decide it.

## scripts/lanes-lists.mjs (not edited)

Today 154-redraft is listed as `alone.push('tests/acceptance/154-redraft/', 'tests/acceptance/154-oracle-redraft/')`
and `timed.push('tests/acceptance/154-redraft/budgets.test.ts')`. None of its files is in `byHand` or `redrafted`. The
swap needs:

- `Object.assign(redrafted, Object.fromEntries(['budgets', 'cache', 'determinism', 'loop', 'offline', 'onsets'].map((f) => [`tests/acceptance/154-redraft/${f}.test.ts`, 'tests/acceptance/154-redraft-3525b/'])))`
- the same six originals in `byHand`, as the #3549 block does
- `alone.push('tests/acceptance/154-redraft-3525b/')`: its files start hubs that render stems and each builds
  deep-show, as the original's do
- `timed.push('tests/acceptance/154-redraft-3525b/budgets.test.ts')`

`154-redraft/limits.test.ts` keeps running from the original folder's `alone` entry.

## Runs

There is one run on the base, `d9b9015ff` (b134dd38f plus #3525's blind suite), saved in `BASE-RUN.txt` with home
paths redacted. Setup: macOS, Node v24.22.0, 1-minute load 260 at the start and 147 at the end, 2026-11-27T07:20:56Z
to 07:23:46Z, 122 s. Per the brief no cargo build was allowed, so `~/.cargo/bin` was left off PATH, and deep-show is
not built in this checkout (`target/debug/deep-show` is absent).

| Run | Program | Expected on a right program | Result here |
|---|---|---|---|
| the six files | the base (deep_job has no `fetch` op) | the 11 fetching tests fail at the fetch (deep_job refuses `fetch`). This base is the wrong program for this redraft | `INCONCLUSIVE` for the 11. Each failed before the fetch: `deep install` of the library exits 3, "No canvas core is built under …/target; run cargo build --bin deep-show first". The original files would fail the same way here. 1 passed: AC9 "the perf lane has a task whose reason names #154 …", which doesn't fetch |
| the six files | a program with #3525 | all 12 pass where #154's do | not run: no such program exists here |

Checked without a test run, which proves nothing about behaviour: `tsc --noEmit -p` on this folder exits 0, and every
test file is byte-identical to its original except the one comment. To get a real base reading, build deep-show
(`cargo build --locked --bin deep-show`) and rerun. On this base the 11 should then fail at `scoreWorld`'s or
`fetchTake`'s `deep_job` fetch, and the originals should pass.
