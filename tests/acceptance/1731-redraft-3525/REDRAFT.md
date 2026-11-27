# Blind redraft of #1731's fetch tests under #3525

#3525 moves the asset fetch out of `deep_kinds`: a `deep_kinds {op: "fetch", ...}` call is refused with `enum` at
`/params/arguments/op`, and the fetch becomes a form of `deep_job`. The issue drafts the place ("a job, run through
`deep_job`"); #3525's blind suite (`tests/acceptance/3525/README.md`, "The new form") fixes the call as

```json
{"name": "deep_job", "arguments": {"op": "fetch", "library": "ext.shelf.library", "id": "oak-chair"}}
```

with the base `deep_kinds` fetch's fields and its replies (`held` with an ask, `fetched` with the asset, `refused` with
a reason, a reply saying `BLOCKED`), every other `deep_job` field left out. The fetch itself is what it is today (#3525,
Scope: the same bytes and hash, the same one authority ask, the same refusal offline). `tests/acceptance/1731/helpers.ts`
sends every fetch through `kinds` (`deep_kinds`): directly in `fetch.test.ts`, `off.test.ts` and `offline.test.ts`, and
through `fetchUntilDone` and `judgeUnknown` (which `unknown.test.ts` calls). After #3525 each of those calls is refused
`enum`, so every test that fetches fails on a right program. This folder redrafts them from #1731's criteria, #3525 and
the base `b134dd38f`.

The originals are not edited or deleted; a person approves the swap. Run with:

```sh
NO_COLOR=1 npx vitest run tests/acceptance/1731-redraft-3525/ --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1731-redraft-3525/tsconfig.json
```

(needs what #1731's README "Run them" needs: built workspaces, deep-hook and deep-show, `openssl`, a shell that may
start the supervisor's sandbox).

`helpers.ts` here holds only what must change: `job(w, args)`, the original's `kinds` line for line but naming
`deep_job`; `fetchUntilDone` and `judgeUnknown`, the original's line for line but calling `job`. Everything else (the
world, hub, fixture library, `deep mcp`, `fetchArgs` = `{op: 'fetch', library, id}`, asks, store, `search`, which stays
`deep_kinds {op: "assets"}` as #3525 keeps `assets` a lookup) is imported unchanged from `../1731/helpers.ts` and
`../1731/library.ts`. Each test file differs from its original only in its import lines, a two-line header, one
comment word (`deep_kinds` → `deep_job` in fetch.test.ts's `asserts:` line), and `kinds(w, fetchArgs(...))` →
`job(w, fetchArgs(...))` (`diff tests/acceptance/1731/<f> tests/acceptance/1731-redraft-3525/<f>`).

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `1731/fetch.test.ts` › fetching the CC-BY oak chair raises one authority ask naming the library, its bytes and CC-BY 4.0; after the yes it is stored by hash with its license and upstream, and an asset.game@1 item names it with that license | #1731.e4d0ddba | The first fetch and `fetchUntilDone` call `deep_kinds {op: fetch}`, refused `enum` after #3525: no `held`, no ask | `fetch.test.ts` › same name. Both fetches go through `deep_job {op: fetch, library, id}`; the ask, store, show assertions and the 900 s timeout are the original's |
| `1731/fetch.test.ts` › under a standing rule for the library and CC0 only, the same fetch is refused naming CC-BY 4.0, while a CC0 chair fetches under it with no ask | #1731.e4d0ddba | The CC0 control fetch (`fetchUntilDone`) is refused `enum`, so it never reads `fetched`; the CC-BY "refusal" would be the enum refusal, not one naming the license | `fetch.test.ts` › same name, both fetches through `deep_job` |
| `1731/unknown.test.ts` › the unknown-license armchair is BLOCKED at fetch with one unblock ask, and an asset.game@1 item naming it is refused | #1731.0d3831dc | `judgeUnknown`'s two fetches are refused `enum`: not BLOCKED, no unblock ask | `unknown.test.ts` › same name; `judgeUnknown` from `./helpers.ts` fetches through `deep_job`, its failure words the original's |
| `1731/unknown.test.ts` › the planted fill that reports it as CC0 fails, naming the row, because the license is read from the library's own record | #1731.0d3831dc | It runs the same `judgeUnknown`; its fetch failures change from the plant's to the enum refusal's (the row failure it counts is from the search and still holds, but the file is swapped whole) | `unknown.test.ts` › same name, through the redrafted `judgeUnknown` |
| `1731/off.test.ts` › turned off, the library leaves the search and a fetch by an id it gave is refused, naming it, with no request to it | #1731.826a5cb7 | The fetch is refused `enum`, a refusal for the wrong reason that need not name `ext.shelf.library` | `off.test.ts` › same name, the fetch through `deep_job` |
| `1731/offline.test.ts` › offline, the search answers from its cache, stale with its age, and a fetch is BLOCKED with one unblock ask | #1731.19849fe1 | The two offline fetches are refused `enum`: not BLOCKED, no unblock ask | `offline.test.ts` › same name, both fetches through `deep_job` |

Each redrafted file holds every test of its original, in the original's order, under the original's `describe` (with
its `#1731.<id>` tag) and `it` names. No t.test subtests.

## Kept as they are

- `1731/search.test.ts` (#1731's AC1 search and its planted fill): it calls `deep_kinds {op: "assets"}` only, which
  #3525 keeps in `deep_kinds`, and no fetch. It stays where it is.
- `1731/helpers.ts`, `library.ts`, `fixtures/`: imported unchanged.
- No twins: `tests/acceptance/1731/` has no `twins.json`.

## Lanes

`tests/acceptance/1731/` has no `lane.json`; `scripts/lanes-lists.mjs` puts it in `alone`
(`alone.push('tests/acceptance/1731/')`). The redraft needs, in `scripts/lanes-lists.mjs` (not edited here):

- `alone.push('tests/acceptance/1731-redraft-3525/')`: each file starts a hub with a sandboxed fill and a TLS library,
  as its original does. A `lane.json` would not do it: `LANE_FILE` matches numeric folder names only.
- `redrafted` entries mapping `tests/acceptance/1731/{fetch,off,offline,unknown}.test.ts` to
  `tests/acceptance/1731-redraft-3525/`, and those four in `byHand`, as #3549's block does; `search.test.ts` stays in
  the lanes.

## Runs

On the base `b134dd38f` (with the blind #3525 suite commit `d9b9015ff` beside it), macOS, Node 24.22.0, one run, 160 s;
1-minute load 165 at its start and 384 at its end (other sessions' tests running; not waited for). Output in `BASE-RUN.txt`, home paths
redacted to `~`. The base's `deep_job` schema lists only `op` (`list`, `run`), `kind`, `tool`, `params`, `inputs`, so
every redrafted fetch is expected to be refused there; the per-test results are below.

Every refused call reads `{"code":"unlisted_field", "path":"/params/arguments/library", "remediation":"Leave out
library: the schema lists only op, kind, tool, params, inputs."}`.

| Test | Criterion | On the base |
|---|---|---|
| `fetch.test.ts` › fetching the CC-BY oak chair … | #1731.e4d0ddba | fails: `the fetch waits on your answer`, status undefined, not `held` (unlisted_field) |
| `fetch.test.ts` › under a standing rule … | #1731.e4d0ddba | fails: `the rule lets a CC0 chair fetch`, status undefined, not `fetched` (unlisted_field) |
| `unknown.test.ts` › the unknown-license armchair … | #1731.0d3831dc | fails: `judgeUnknown` gives `the fetch of shelf-armchair isn't BLOCKED` (unlisted_field) and `two fetches … raised 0 unblock asks, not one` |
| `unknown.test.ts` › the planted fill that reports it as CC0 fails … | #1731.0d3831dc | passes: it counts only the judge's row failure (`row shelf-armchair … own record`), which comes from the search, not the fetch; the fetch failures it doesn't count are there too. It is carried because the swap is by file |
| `off.test.ts` › turned off, the library leaves the search … | #1731.826a5cb7 | fails: `the refusal names the library`; the call is refused (unlisted_field), but its words don't name `ext.shelf.library` |
| `offline.test.ts` › offline, the search answers from its cache … | #1731.19849fe1 | fails: `offline, the fetch is BLOCKED`, false (unlisted_field); the search half before it passed |

Not run: the redraft on a program with #3525's fetch form (none exists), so no run here shows these tests pass on a
right program.

`tsc -p tests/acceptance/1731-redraft-3525/tsconfig.json` passed with no error.
