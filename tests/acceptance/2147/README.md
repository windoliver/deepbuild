# Acceptance tests for #2147: the slot check passes on main

Written first, blind, by a job that never saw an implementation of #2147. On November 10, 2026 it read:

- issue #2147: its body, Scope, 2 checkbox criteria and Proof
- `AGENTS.md` and `docs/technical-design.md` (Dogfooding)
- the base commit `2b05d52df`: `scripts/slots-check.mjs`, `packages/conformance/src/slot-check.ts`,
  `packages/conformance/src/slots/kits.ts`, `packages/contracts/hub-slots.json` (the `deep.registerSource, library`
  row: interface `asset.library@1`, `kit: null`), `packages/extension-host/src/sources.ts`, and
  `tests/acceptance/349` (slot-table.test.ts and slotting.ts, whose way of planting a row with `--api`/`--table`
  this suite copies) and `tests/acceptance/1731` for conventions

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

```sh
npm run build --workspaces      # slots-check.mjs imports packages/*/dist
node node_modules/vitest/vitest.mjs run tests/acceptance/2147
```

Planted contracts are written to `/tmp/dh2147-slots-*` and removed after the file. The real contract files are never edited.

## Criterion → test

| Criterion | Tests |
| --- | --- |
| AC1 `#2147.328da474` `node scripts/slots-check.mjs` exits 0 on main | the shipped check exits 0 with `PASS slots` and no `FAIL slots` line; the `deep.registerSource, library` row names a kit `slotKits()` ships, plants at least one wrong fill that kit lists, and `slotProblems` finds nothing for it; no `FAIL` line names `deep.registerSource` or `deep.registerChannel` |
| AC2 `#2147.6a9b3c54` A slot added with no kit still fails it, naming the slot | a planted `deep.registerFoo` row with `kit: null` makes the check exit 1 with a `FAIL` line naming it and the kit; a planted new `deep.registerSource` variant with `kit: null` does the same, naming `deep.registerSource, planted2147` |

AC2's tests are regression protection: the check already refuses a kitless slot at the base, so they pass there,
and they fail on a fix that makes AC1 pass by dropping the kit requirement.

## Linux note

On Linux, `environment@1`'s planted fill `leaves-grandchild` is refused for the wrong reason because `lsof` can't
read the listening ports here, so the shipped check prints that FAIL line and exits 1 even with #2147 fixed. AC1's
first test fails on Linux for that reason alone; it isn't special-cased. Run it on macOS for the verdict.
