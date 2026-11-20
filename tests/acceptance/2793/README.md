# Acceptance tests for #2793: the hub-slot row for `deep.registerPort`

Written first and blind, by a job that saw no fix for #2793. On November 17, 2026 it read:

- issue #2793: What is wrong, Where it bites and its three acceptance criteria
- `AGENTS.md` (Proof) and `docs/technical-design.md`: Composition and its Hub slots table, Socket roles and
  contract versions (frozen `d1:` digests), the Dogfooding rule
- at the base commit `0f34aacbe` (main): `packages/contracts/hub-slots.json`, `extension-api.json`, `digests.json`
  and `src/slots.ts`; `packages/conformance/src/slot-check.ts` and `slots/kits.ts`; `scripts/slots-check.mjs`;
  `tests/acceptance/349` (its README, `slot-table.test.ts`, `helpers.ts`, `slotting.ts`, `wrong.ts`) and the
  layout of `tests/acceptance/2698` and `2744`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## Run

```sh
npm ci && npm run build --workspaces     # once: scripts/slots-check.mjs reads packages/*/dist
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2793 --no-file-parallelism
```

One file, `slot-row.test.ts`, five tests. It took 150 s at a load of 115; AC3 starts a second vitest on
`tests/acceptance/349/slot-table.test.ts`, which runs the slot check four times. It uses #349's test tools
(`../349/helpers.ts`, `slotting.ts`, `wrong.ts`), so its temp folders are `/tmp/dh349-*`, removed after the file,
and `HOME` is a temp folder. No network, nothing skipped, no process stopped.

## Expected values

The design's slot table row:

| Slot | Interface | Fills | Planted wrong fills its kit must fail | Lands |
|---|---|---|---|---|
| `deep.registerPort` | `port@1` | many, at most 8 on a document | a port that sends on a seek | R6 |

- **Interface and digest:** `interface` is `port@1`, and `digest` is the value `packages/contracts/digests.json`
  holds for `port@1`, where every other row's frozen digest lives. The base has no `port@1` there, so the tests
  name no hex of their own: they need the entry to exist as `d1:<64 hex>` and the row to equal it.
- **Fills:** `fills` is `many, at most 8 on a document`, the design table's words (`HubSlot.fills`, `src/slots.ts`).
- **Kit:** the criterion says "a kit", so no name is fixed: the row's `kit` must be a slot kit `slotKits()` ships.
- **Planted fill:** fill names are the kit's own, so the tests fix only this job's reading of "a port that sends
  on a seek": at least one name in `planted` contains `seek`.

## Criterion, test and pass rule

| Criterion | Test | Passes when |
|---|---|---|
| AC1 | `AC1 one row: …` | `hub-slots.json` has exactly 1 row with method `deep.registerPort`; its `variant` is null, and its interface, digest, fills, kit and planted fill are as above. Two rows, another interface, a digest that isn't `digests.json`'s, `fills: "many"`, no kit or no seek fill each fail it. |
| AC1, the kit refuses the fill | `AC1 the row's kit ships …` | `slotProblems` over the API's `deep.registerPort` entry, that row and the shipped kits is empty: the kit exists, plants every fill the row names and refuses each. |
| AC1, wrong program | same test | The same kit with its seek fill replaced by its reference fill (`admittingKit`, #349's) gives a problem whose `fill` is that name and whose `method` is `deep.registerPort`. A kit that never ran its planted fill would pass both ways and fails here. |
| AC2 | `AC2 the slot check on the shipped contract` | `node scripts/slots-check.mjs` exits 0, prints a line starting `PASS slots`, and no line of its output contains `deep.registerPort` or starts with `FAIL` or `BLOCKED`. |
| AC3, unchanged | `AC3 the file and what it imports …` | `tests/acceptance/349/slot-table.test.ts`, `slotting.ts`, `wrong.ts` and `helpers.ts` have the git blob IDs they have at `0f34aacbe`. Passes at the base; it is the guard on "unchanged". |
| AC3, passes | `AC3 vitest runs its four cases …` | vitest on that one file reports 4 cases, each `passed`, and exits 0. |

`BASE-FAILURE.txt` is this suite's output at the base commit.
