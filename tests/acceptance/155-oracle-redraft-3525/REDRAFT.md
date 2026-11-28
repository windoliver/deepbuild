# Blind redraft of #155's Oracle lane under #3525

#3525 moves the asset fetch out of `deep_kinds`: `deep_kinds {op: "fetch", ...}` is refused with `enum` at
`/params/arguments/op`, and the fetch becomes a form of `deep_job`. The issue drafts the place only as "a job, run
through `deep_job`"; #3525's blind suite (`tests/acceptance/3525/README.md`, The new form) fixed the call as
`deep_job {op: "fetch", library, id}`, or `{op: "fetch", pack, asset}` for a pinned pack's asset, with the base
`deep_kinds` fetch's fields and replies (`held` with an ask, `fetched` with the asset, `refused`, BLOCKED), every other
`deep_job` field left out. The fetch itself is what it is today (#3525, Scope).

`tests/acceptance/155-oracle/sample-accurate.test.ts` brings the click library's one take into the hub's store with
`deepKinds(w, { op: 'fetch', pack, asset })` before it renders anything. After #3525 that call is refused, its `status`
is never `fetched`, and the test fails at `clicksWorld` on a right program. This folder redrafts the file from #155's
criterion 8 (`#155.ec088f1d`) and the Oracle lane's own scene (`tests/acceptance/155-oracle/README.md`), at base
`b134dd38f`. The original is not edited or deleted; a person approves the swap. Run with:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/155-oracle-redraft-3525 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/155-oracle-redraft-3525/tsconfig.json
```

It needs what the original needs (`tests/acceptance/155/README.md`): the built workspaces, `deep-hook` and `deep-show`
in `target/`, `openssl`. It imports `tests/acceptance/154/helpers.ts` and `tests/acceptance/155/helpers.ts`, unchanged,
for the same names the original imports, less `deepKinds`. `tsconfig.json` is the original's.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `155-oracle/sample-accurate.test.ts` › AC8 #155.ec088f1d impulses started by nine stroke occurrences inside and across 128-sample quanta land on exactly their sample and nowhere else; a mixer that starts voices per quantum is rejected | #155.ec088f1d | `clicksWorld` fetches test/clicks's take with `deep_kinds {op: "fetch", pack, asset}`. Under #3525 that call is refused `enum` at `/params/arguments/op`, so the take never reaches `fetched`, the test fails on "is fetched under your standing rule", and upstream's check never runs, on a right program | `sample-accurate.test.ts` › same `describe` and test names. The only change: the fetch in `clicksWorld` is `deepJob(w, { op: 'fetch', pack: ref(CLICKS), asset: t.path })` (and `o`'s type reads `typeof deepJob`). The standing rule, the retry while `held` (500 ms steps, 120 s deadline), the `fetched` assertion and its message, the library, score, film, offsets, quantum, planted fault, every assertion, expected value and the `2 * TIMEOUT` bound are the original's, line for line |

Besides those lines, a four-line comment under the license header names this redraft; the license notice is kept.

## Kept as is

- The file has one test; it is carried, in its place. Nothing else in `tests/acceptance/155-oracle/` is a test.
- `tests/acceptance/155/` and `tests/acceptance/155-redraft-ac9/`: not in this brief. `tests/acceptance/154/helpers.ts`
  has its own `deep_kinds` fetch (`fetchTake`), which the original doesn't call; this file doesn't either.
- No twins: the planted fault is built inside the test from its own mix, as in the original.

## What the swap needs (not edited here)

Today `scripts/lanes-lists.mjs` runs the original in the lanes: `alone.push('tests/acceptance/155/',
'tests/acceptance/155-oracle/')` (line 638); `scripts/lanes.mjs` also lists `tests/acceptance/155-oracle/` in `shared:
the sandbox log stream` (line 237). No `lane.json` names it. It is not by hand only. For the swap:

- `scripts/lanes-lists.mjs`: map the original to this folder and keep the original by hand, e.g.
  `Object.assign(redrafted, { 'tests/acceptance/155-oracle/sample-accurate.test.ts': 'tests/acceptance/155-oracle-redraft-3525/' });`
  `byHand.push('tests/acceptance/155-oracle/sample-accurate.test.ts');` and
  `alone.push('tests/acceptance/155-oracle-redraft-3525/');` (it builds deep-show, starts a hub and renders a score
  stem through the supervisor, as the original).
- `scripts/lanes.mjs`: add `tests/acceptance/155-oracle-redraft-3525/` beside `tests/acceptance/155-oracle/` in `shared:
  the sandbox log stream` (score.render runs sandboxed, as in the original). That list is in `lanes.mjs`, whose edits
  need a signed tag.
- **The wait ratchet.** `node scripts/wait-ratchet.mjs` reports
  `FAIL waits: tests/acceptance/155-oracle-redraft-3525/sample-accurate.test.ts:123:13: sleep(…) is a fixed wait`. It
  is the original's `await sleep(500)` between fetches while the hub says `held` (its fetch in flight), carried line
  for line; the original holds it under its ceiling of 1 in `scripts/wait-ceilings.json`, and a file the merge base
  doesn't list starts at zero. The swap needs the owner's ruling: an entry of 1 for this file (moved with the
  original's), or a redraft of the wait itself, which this brief doesn't allow.

## Runs

| Run | Program | Expected | Result |
|---|---|---|---|
| `node node_modules/typescript/bin/tsc -p tests/acceptance/155-oracle-redraft-3525/tsconfig.json` | the base | no errors | exit 0 |
| `node scripts/wait-ratchet.mjs` | the base with this folder | (see The wait ratchet) | one `FAIL waits` for this file's line 123, as above |
| vitest `--root tests/acceptance/155-oracle-redraft-3525` (`BASE-RUN.txt`) | the base `b134dd38f`, deep-show not built | fails at the fetch: the base's `deep_job` lists only op, kind, tool, params, inputs, so `{op: fetch, pack, asset}` is refused `unlisted_field`, not `fetched` | `INCONCLUSIVE` for the fetch: 1 failed, at `deep install` of test/clicks ("No canvas core is built"), before the fetch. deep-show wasn't built (disk; the brief forbids it; another job's build of it was still compiling after 25 min), and `RUSTUP_TOOLCHAIN` was pointed at a missing toolchain so the suite's own `cargo build --bin deep-show` couldn't build it |
| the same, on a right program of #3525 | — | passes as the original passes on #155's work | not run: no implementation exists |

Load at the run: 1-minute average about 97 to 100 (up to 359 earlier in the job). 2026-11-27T07:37Z.
