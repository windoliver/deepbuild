# Blind redraft of #2123's fetch-again test under #3525

#3525 moves the asset fetch out of `deep_kinds`: a `deep_kinds` call with `op: "fetch"` is refused with `enum` at
`/params/arguments/op`, and the fetch becomes a form of `deep_job`. The issue drafts only the place ("a job, run
through `deep_job`"); #3525's blind suite (`tests/acceptance/3525/README.md`, "The new form") fixed the call as
`deep_job {op: "fetch", library, id}`, with the same fields and the same replies as the base's `deep_kinds` fetch
(`held` with an ask, `fetched` with the asset, `refused` with a reason, BLOCKED), and every other `deep_job` field left
out. The fetch itself is what it is today. `tests/acceptance/2123/fetch-again.test.ts` fetches with
`kinds(w, fetchArgs(ID))` from `../1731/helpers.ts`, a `deep_kinds` call, so after #3525 its first fetch is refused at
the schema, the hub never reads the chair's file, and the test fails on a right program. This folder redrafts that one
test from #2123's criterion, #3525 and the base `b134dd38f`.

The original is not edited or deleted; a person approves the swap. Run with:

```
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/2123-redraft-3525/
node node_modules/typescript/bin/tsc -p tests/acceptance/2123-redraft-3525/tsconfig.json
```

It imports `onWorld`, `must` and `LIB` from `tests/acceptance/1731/helpers.ts`, `asset` from
`tests/acceptance/1731/library.ts` and `AC` from `tests/acceptance/2123/helpers.ts`, all unchanged. `helpers.ts` here
holds only `job(w, args)`, one `deep_job` call through `deep mcp`, read exactly as #1731's `kinds` reads a `deep_kinds`
call (`kinds` names its tool inside, so it can't be reused), and `fetchArgs(id)`, `{op: "fetch", library: LIB, id}`,
the same object as #1731's `fetchArgs`, kept here so the call's form is stated where it is used.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `2123/fetch-again.test.ts` › #2123.4627e131 under a standing rule, a chair whose file read throws the first time and answers the second: fetched twice, the second fetch is fetched | #2123.4627e131 | Both fetches are `deep_kinds {op: "fetch", library, id}`. After #3525 that call is refused with `enum` at `/params/arguments/op` before the hub reads anything, so the first assertion (the hub read the chair's file during the first fetch) fails on a right program, and the second fetch could never be `fetched` | `fetch-again.test.ts` › same name and ID. The only change: both fetches are `job(w, fetchArgs(ID))`, `deep_job {op: "fetch", library: "ext.shelf.library", id: "pine-chair"}`. The world, the standing rule (`library.rule`, CC0-1.0), the file taken away for the first read and put back in `finally`, the three assertions, their messages and expected values, and the 600 s limit are the original's, line for line |

## Kept as they are

- Staying where they are, unchanged: the rest of #2123 (`wiki-build`, `channel-stalled`, `thumbnail`,
  `review-threads`, `dispute-restart`). None calls a fetch: `thumbnail.test.ts` calls `deep_kinds` with
  `op: "assets"`, a search, which #3525 keeps in `deep_kinds`; the other four don't reach `deep_kinds` at all.
- The original file holds one test, carried here whole; nothing of it is left out.
- No twins: `tests/acceptance/2123/` holds no `twins.json` and no `lane.json`.

## What scripts/lanes-lists.mjs needs for the swap

`tests/acceptance/2123/` is not listed in `scripts/lanes-lists.mjs` today (not in `alone`, `byHand`, `timed` or
`redrafted`), and has no `lane.json`, so its files run in the unit lane's parallel block. The swap, made by a person
once the owner approves it, is the pattern the other redrafts use:

```js
Object.assign(redrafted, { 'tests/acceptance/2123/fetch-again.test.ts': 'tests/acceptance/2123-redraft-3525/' });
byHand.push('tests/acceptance/2123/fetch-again.test.ts');
```

Nothing else is needed for this folder. It starts #1731's world (a hub, a sandboxed fill through the supervisor, a TLS
fixture library), as the original did from the parallel block, so it can stay where the original ran;
`tests/acceptance/1731/` itself is in `alone` for the same world, so `alone.push('tests/acceptance/2123-redraft-3525/')`
is the stricter choice if the person wants this test to match. This job edits no lane list.

## Runs

| Run | Program | Expected | Result |
|---|---|---|---|
| `node node_modules/vitest/vitest.mjs run tests/acceptance/2123-redraft-3525/` | the base `b134dd38f` (origin/main), with #3525's suite commit `d9b9015ff` (tests only) | fails: the base's `deep_job` has no fetch form | fails, 17 s: `the hub's reads of /files/pine-chair.gltf during the first fetch: (no requests): expected 0 to be greater than 0` (`BASE-RUN.txt`) |
| `tsc -p tests/acceptance/2123-redraft-3525/tsconfig.json` | the checkout | exits 0 | exits 0 |

On the base the first `deep_job` fetch is answered without the hub reading the chair's file: the base's `deep_job`
schema lists `op` as `list` or `run` and only `kind`, `tool`, `params`, `inputs` beside it, so the call is refused at
the schema (#3525's own base run reads `unlisted_field` at `/params/arguments/library` for the same call). The test
stops at its first assertion, as the original would on a right program after #3525. It was not run on a program with
#3525 in it (none exists), so that it passes there is not shown. Run on macOS, Node 24.22, one run, a 1-minute load of
268 at its start; the load was recorded, not waited for. No process was started outside the run, and nothing was built.
