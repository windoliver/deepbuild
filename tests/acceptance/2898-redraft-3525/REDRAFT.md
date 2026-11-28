# Blind redraft of #2898's AC2, AC3 and AC4 (`table`, `reads`, `repeats`) under #3525

#3525 makes `deep_kinds` hold lookups only and lists it `readOnlyHint` true and `idempotentHint` true, still
open-world and not destructive (`scripts/skill.mjs` `HINTS` → `packages/hub/annotations.json`). The asset fetch leaves
`deep_kinds`: `deep_kinds {op: "fetch"}` is refused with `enum` at `/params/arguments/op`, its fetch fields leave its
schema, and the fetch becomes a form of `deep_job`, which stays listed as changing something. #3525's blind suite fixed
that form as `deep_job {op: "fetch", library, id}` (`tests/acceptance/3525/README.md`, The new form), with the base
`deep_kinds` fetch's fields and replies.

Three files of `tests/acceptance/2898/` read #2898's drafted table (`helpers.ts` `TABLE`), whose `deep_kinds` row is
open-world only (`row(F, F, F, T)`), and so fail on a right program after #3525:

- `table.test.ts` (AC2): `drift` holds every listed hint to `TABLE`, so `deep_kinds`' `readOnlyHint` and
  `idempotentHint` true are drift;
- `reads.test.ts` (AC3): the listed read-only set is held to `tableSays('readOnlyHint')`, which lacks `deep_kinds`; and
  its planted table lists `deep_kinds` read-only and must fail on `deep_kinds`' fetch. After #3525 that hint is right
  and `deep_kinds` takes no fetch form, so the plant can't fail;
- `repeats.test.ts` (AC4): the listed idempotent set is held to `tableSays('idempotentHint')`, which lacks `deep_kinds`.

A fourth thing #3525 forces, which no assertion shows: #2898's `forms` sends every `deep_kinds` form with each field of
the base's schema, null where the form doesn't set it, the fetch's `library`, `id`, `pack` and `asset` among them.
`check` (`packages/hub/src/tools.ts`) refuses a field the schema doesn't list (`unlisted_field`), null or not, so once
#3525 takes those fields out every `deep_kinds` lookup in AC3's and AC4's loops would be refused and the check would pass
on nothing. Those null fields are left out where the listed schema doesn't hold them (as #3525's README's Forms keep
"to the fields the listed schema holds"); on the base each is listed, so the calls there are unchanged.

This folder redrafts the three files from #2898's criteria, #3525, the design and the base `b134dd38f`. AC3's
criterion's wrong program is a table that lists read-only a tool with a form that brings an asset in; after #3525 that
tool is `deep_job`, by its fetch. The originals are not edited or deleted; a person approves the swap.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `2898/table.test.ts` › AC2 #2898.195c199f every server's listing states the issue's final table … a planted tools.ts that states deep_status destructive fails the drift check, naming the tool and the hint | #2898.195c199f | `drift` holds `deep_kinds` to `row(F, F, F, T)`; after #3525 deep mcp lists it read-only and idempotent, so the first assertion reads `deep_kinds readOnlyHint lists true, the table false` (and `idempotentHint`) on a right program | `table.test.ts` › same name and ID. The only change: `drift` from `./helpers.ts`, #2898's line for line over #2898's table with #3525's `deep_kinds` row. The planted tools.ts (`deep_status` `destructiveHint` true) is still wrong after #3525 and is kept, with its expected line; the bytes check, the generated-table checks and every expected value are the original's |
| `2898/reads.test.ts` › AC3 #2898.dee08b24 each tool listed read-only is called in every form its schema takes … a planted table that lists deep_kinds read-only fails on its fetch, naming the asset it brought in | #2898.dee08b24 | (1) The listed set is held to #2898's table, which lists `deep_kinds` not read-only; after #3525 it is, so the first assertion fails on a right program. (2) The planted table lists `deep_kinds` read-only and calls its fetch; after #3525 that hint is right and `deep_kinds {op: "fetch"}` is refused, adding nothing to the record, so the plant's assertion fails on a right program. (3) The `deep_kinds` lookups would be refused for the fetch fields (above) | `reads.test.ts` › same name and ID (the name is the criterion's text). (1) `tableSays` from `./helpers.ts`. (2) The planted table lists `deep_job` read-only (the same `hint` plant of `2898/fixtures/plant.mjs`, unchanged, in #1731's library world as before) and the check calls deep_job's fetch, `{op: "fetch", library: "ext.shelf.library", id: <the search's library asset>}`; it must fail on a failure starting `deep_job (op: fetch` that names the asset's id. (3) `readOnlyFailures` from `./helpers.ts` (#2898's line for line over `formsOf`). Every other line (the world, the four servers, the planted `deep_query` and its expected failure, the asset's search, the BLOCKED preconditions) is the original's |
| `2898/repeats.test.ts` › AC4 #2898.4e085daf each tool listed idempotent is called twice with the same input … a planted deep_job that runs its tool again fails, naming the job | #2898.4e085daf | (1) The listed idempotent set is held to #2898's table, which lists `deep_kinds` not idempotent; after #3525 it is, so the first assertion fails on a right program. (2) `deep_kinds`' first form (`op: list`) would be refused for the fetch fields (above), so its repeat would prove nothing | `repeats.test.ts` › same name and ID. (1) `tableSays` from `./helpers.ts`. (2) Each tool's first form from `formsOf` with the tool's listed schema. The planted `deep_job` (#1922's hub plant `job-second-call`) is unaffected by #3525 and is kept, with its expected failure; `repeatFailures`, `callAction`, `jobRepeat` and every expected value are the original's |

### What `helpers.ts` adapts from #2898's

`tests/acceptance/2898/helpers.ts` is imported unchanged, and only what must change is here:

- `TABLE`/`tableSays`: #2898's `TABLE` with #3525's `deep_kinds` row; `drift`, #2898's line for line over it.
- `formsOf`: #2898's `forms`, plus deep_job's fetch built from the `{library, id}` the test passes, as the original passed
  them for deep_kinds' fetch (fields the form doesn't need left out, as #3525's README says), and, for `deep_kinds`, its
  null fields that the listed schema doesn't hold left out. #2898's `forms` knows no form of `deep_job` (it is no read):
  given `deep_job` the original `readOnlyFailures` would only report "knows no form of it to call", naming no asset.
- `SELECTORS` (#2898's plus deep_job's `op`, so another op deep_job's schema lists is named as a form not called), and
  `formsMissed` and `readOnlyFailures` copied line for line over those.

## Kept as they are

- Each file holds its original's one test, in the original's order. No `t.test` subtests.
- The rest of #2898 (`listed`, `together`, `ownkind`, `bytes`, `capture`) stays where it is and isn't redrafted:
  none reads `TABLE` (by `grep`). `bytes.test.ts` is left out on the coordinator's word that it already fails on this base.
- No twins here: `2898/twins.json` maps only #2898.c0392358 (`bytes`).

## Lanes

#2898's folder runs alone by `scripts/lanes-lists.mjs` (`alone.push('tests/acceptance/2898/')`, line 1385), not by a
lane.json. A `lane.json` here wouldn't count (`LANE_FILE` takes `tests/acceptance/<digits>/` only), so none is written.
The swap needs, in `scripts/lanes-lists.mjs` (not edited here):

```js
// #3525 lists deep_kinds read-only and idempotent and moves its fetch to deep_job, so #2898's table, reads and repeats
// files, which read the issue's drafted deep_kinds row, fail on the right program. Kept as written, by hand only; their
// blind redraft runs in their place, alone (real hubs, plug-ins, jobs, 40 s deep_wait).
for (const name of ['table', 'reads', 'repeats']) {
  redrafted[`tests/acceptance/2898/${name}.test.ts`] = 'tests/acceptance/2898-redraft-3525/';
  byHand.push(`tests/acceptance/2898/${name}.test.ts`);
}
alone.push('tests/acceptance/2898-redraft-3525/');
```

## Runs

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2898-redraft-3525 --no-file-parallelism --testTimeout=900000
node node_modules/typescript/bin/tsc -p tests/acceptance/2898-redraft-3525/tsconfig.json
```

The same builds as #2898's README (workspaces, deep-hook, deep-show). `tsc` over this tsconfig: exit 0. Each file ran
once on the base (`BASE-RUN.txt`): `reads` alone first, then `table` and `repeats` together, before `helpers.ts`'s
`deep_kinds` field filter was added; the filter is the identity on the base's schema, and `reads` wasn't rerun.

| Run | Program | Expected | Result |
|---|---|---|---|
| `reads.test.ts` here | the base `b134dd38f` | fails at the listed set: the base lists `deep_kinds` `readOnlyHint` false | failed as expected (19.7 s, load 151 → 148): listed `[deep_query, deep_search, deep_status, deep_wait, find, find_actions, read]` against the table's set, which adds `deep_kinds` |
| `table.test.ts` here | the base | fails at the drift check: `deep_kinds` `readOnlyHint` and `idempotentHint` list false, the table true | failed as expected (32 s with repeats, load 126 → 151): `deep mcp: deep_kinds readOnlyHint lists false, the table true` and `deep mcp: deep_kinds idempotentHint lists false, the table true`, nothing else |
| `repeats.test.ts` here | the base | fails at the listed idempotent set, which lacks `deep_kinds` | failed as expected: listed `[call_action, deep_job, deep_query, deep_search, deep_status, deep_wait, find, find_actions, read]` against the table's set, which adds `deep_kinds` |
| all three here | #3525's change | pass | not run: no implementation exists |

Not checked: anything past each file's first assertion. In particular AC3's planted table needs #3525's deep_job fetch
(on the base deep_job refuses `library` as an unlisted field, so the plant couldn't fail there anyway).
