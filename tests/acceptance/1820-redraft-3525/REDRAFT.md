# Blind redraft of #1820's fetch tests under #3525

#3525 moves the asset fetch out of `deep_kinds`: `deep_kinds {op: "fetch", ...}` is refused with `enum` at
`/params/arguments/op`, and the fetch becomes a form of `deep_job`. #3525's blind suite (`tests/acceptance/3525/README.md`,
The new form) fixes the call as `deep_job {op: "fetch", library, id}`, and `{op: "fetch", pack, asset}` for a pinned pack
asset, with the base `deep_kinds` fetch's fields and replies (`held` with an ask, `fetched` with the asset, `refused`
with a reason, `BLOCKED` with an unblock ask); the fetch itself is unchanged (same bytes and hash, one authority ask,
the same refusal offline). Every test of `tests/acceptance/1820/` that fetches calls `deep_kinds`, through #1731's
`kinds` and #1820's `until`, so on a right program after #3525 each gets the `enum` refusal and fails.

This folder redrafts them from #1820's criteria, #3525 and the base `b134dd38f`, by file. The originals are not edited
or deleted; a person approves the swap. Once it lands an original file runs by hand only, so each redrafted file
carries every test of its original, in order.

## The one change

`helpers.ts` here re-exports `../1820/helpers.ts` unchanged and adds `job(w, args)`: #1731's `kinds` with the tool's
name `deep_job` (the reply read the same way: a JSON-RPC error or `isError` as an error, `structuredContent` or the text
as the value), and `until`, #1820's own, calling `job`. `fetchA` / `fetchB` already give `{op: "fetch", pack, asset}`,
which is the new form's arguments as they are, so they are reused. `export-redraft/world.ts` re-exports
`../../1820/export-redraft/world.ts` and redefines only `fetchAfterYes` on `job`. In every test file the only changes
are a first comment line, import paths to the unchanged `../1820/` modules (`pack.ts`, `scope/world.ts`,
`export-redraft/png.ts`), and `kinds(w, …)` → `job(w, …)` where the call is a fetch (plus one comment naming the
surface). Names, criterion IDs, scenes, waits, assertions and expected values are the original's, line for line.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `1820/fetch.test.ts` › holds on one authority ask with the plan, fetches nothing before the yes, lands by sha256, and a second use fetches nothing | `#1820.34edde87` | its first, repeat, `until` and second-use fetches are `deep_kinds {op: fetch}`: refused `enum`, never `held` | `fetch.test.ts` › same name; the four fetches through `job` / `until` |
| `1820/fetch.test.ts` › refuses a file whose bytes don't match its listed sha256, removes it, and names the asset | `#1820.34edde87` | the `enum` refusal is an error, so `isError` holds, but it names no asset path and no fetch ran: the mismatch rule is never exercised (fails on the path, for the wrong reason) | `fetch.test.ts` › same name, through `job` / `until` |
| `1820/disk.test.ts` › refuses an asset listed at 0.6 of the free space … naming its size and the free space | `#1820.bd8f8f74` | the `enum` refusal names neither size | `disk.test.ts` › same name, through `job` / `until` |
| `1820/license.test.ts` › refuses a CC BY-SA asset, naming CC BY-SA; … CC BY-NC …, naming NC; … GPL …, naming GPL; control: a CC0 asset is not refused for its license … | `#1820.a489b5cd` | `fetched` (in `refusedNaming` and the control) calls `deep_kinds`: the refusals name `op`, not the license; the control is never `fetched` | `license.test.ts` › the four, same names, `fetched` through `job` / `until` |
| `1820/offline.test.ts` › no fetch starts without an answered ask …; a standing rule for one pack …; offline, a fetch of an unfetched asset is BLOCKED … | `#1820.09114f60` | each fetch is `deep_kinds`: never `held`, never `fetched` under the rule, never BLOCKED offline | `offline.test.ts` › the three, same names, through `job` / `until` |
| `1820/scope/license-file.test.ts` › the four (SA, NC, GPL by license file; CC0 control) | `#1820.a489b5cd` (supplement) | `fetched` calls `deep_kinds` | `scope/license-file.test.ts` › the four, through `job` / `until` |
| `1820/scope/resume.test.ts` › a download cut midway resumes …; a resumed download whose rest does not match …; judge self-check … | `#1820` (supplement, scope 1) | `fetchAfterYes` calls `deep_kinds`; the judge self-check has no fetch and is carried with its file | `scope/resume.test.ts` › the three, through `job` / `until`; `judgeResumed` still exported |
| `1820/scope/reuse.test.ts` › two versions list one path …; a re-export with the network gone … | `#1820` (supplement, scope 4) | `fetch` and the offline re-fetch call `deep_kinds` | `scope/reuse.test.ts` › the two, through `job` / `until` |
| `1820/export-redraft/export.test.ts` › the three scope tests and the AC4 export test | `#1820` scope 4; `#1820.09114f60` | `fetchAfterYes` (world.ts) and the AC4 test's last check call `deep_kinds`. The not-installed test has no fetch; it is carried with its file | `export-redraft/export.test.ts` › the four, same names; `fetchAfterYes` and the last check through `job` |

## Kept as they are

- `1820/judges.test.ts` (both tests): no hub and no fetch; it runs from the original folder unchanged.
- `1820/helpers.ts`, `pack.ts`, `scope/world.ts`, `export-redraft/world.ts`, `export-redraft/png.ts`: imported unchanged.
- The original READMEs' surface item 2 (`deep_kinds {op: "fetch", pack, asset}`) reads `deep_job {op: "fetch", pack, asset}` here; every other surface (install, `pack.rule`, asks, the document, the store) is unchanged.

## Lanes

`scripts/lanes-lists.mjs` puts `tests/acceptance/1820/` in `alone` (line 361), and `scripts/lanes.mjs` lists it in
`shared: the sandbox log stream`. No `lane.json`. The swap needs, beside it: `alone.push('tests/acceptance/1820-redraft-3525/')`;
`tests/acceptance/1820-redraft-3525/` in the same `shared: the sandbox log stream` group; and `redrafted` entries mapping
each of `1820/{disk,fetch,license,offline}.test.ts`, `1820/scope/{license-file,resume,reuse}.test.ts` and
`1820/export-redraft/export.test.ts` to `tests/acceptance/1820-redraft-3525/`, with those originals in `byHand`.
`1820/judges.test.ts` stays in its lane. Not edited here.

## Runs

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"
npm run build --workspaces
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-show
NO_COLOR=1 npx vitest run tests/acceptance/1820-redraft-3525/ --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1820-redraft-3525/tsconfig.json
```

Typecheck: clean (0 errors). `BASE-RUN.txt`: the run on `b134dd38f` at load ~280, with `deep-show` not built (disk
tight, the job built nothing). All 8 files stop in `beforeAll` with BLOCKED: `deep install` of the pack folder exits 3,
"No canvas core is built under ~/…/target; run cargo build --bin deep-show first", so all 23 tests are skipped and no
fetch was reached. The base's expected failure for every fetch test, not observed here: the base's `deep_job` lists only
`op` (`list`, `run`), `kind`, `tool`, `params`, `inputs` (`packages/hub/src/tools.ts`), so `deep_job {op: "fetch", pack,
asset}` is a tool error (`unlisted_field` or `enum`), never `held`, `fetched` or BLOCKED. The run must be repeated with
`deep-show` built to show it.
