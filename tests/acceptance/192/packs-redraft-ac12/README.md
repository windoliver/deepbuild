# Blind redraft of #192's criterion 12 test (`#192.e8dea9d2`)

A redraft of `tests/acceptance/192/packs/budget-ceilings.test.ts`, written by the same blind job on a dispute (design:
Dogfooding). It saw the issue, the design, the base commit `06e231702` and the dispute's facts of the merge base,
and no implementation. The original file stays as it was. The implementing agent doesn't edit these files.

## The dispute, in the merge base's facts

The original's own leg passed on the work. Its merge-base leg failed at "the merge base 06e231702bb4 ran both refused
providers: expected 1 to be greater than or equal to 2". At the base, `Host::provide` (crates/deep-show/src/sandbox.rs)
keys a provider's output by hash(program, params, seed, assets, out, the sandbox module's version), never by its
budget. The original's two refused providers were the same quad program with the same params, the same `out` and
the default seed, so they shared one key: the base ran `fuel_over` and took `memory_over`'s output by that key. The
base's rewrite refuses `ceilings.at_ceiling` (its 256 MiB memory is past the base's 64 MiB default). So the base ran
one program, not two, though it refused neither provider and gave both documents the quad.

## What changed

- The two refused providers have different content keys at the base: `fuel_over` declares `out.mesh.max_vertices` 4
  and `memory_over` 8 (the program writes 4 vertices, under both caps). The base's key covers `out`, so each
  document's check runs its own provider.
- The base's runs are counted around each document's check (`sandbox` before the documents, after `fuelover`'s and
  after `memoryover`'s), and each must rise by at least one, so each refused provider's own run is seen.

Nothing else changed: the packs, programs, budgets, documents, this build's requirements (`failures`, in the same
order) and the merge base's first failure naming `budget/fuel` are the original's. The surface is the packs suite's
(`tests/acceptance/192/packs/README.md`, The surface), through its helpers (`../packs/helpers.ts`), which also build
the merge base into `target/acceptance-192-packs-base/<sha12>/`.

## Run it

As the packs suite (Homebrew's rustup on PATH, `npm ci` and `npm run build --workspaces` once in a fresh worktree):

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/192/packs-redraft-ac12 budget-ceilings.test.ts --testTimeout=600000
npx tsc -p tests/acceptance/192/packs-redraft-ac12/tsconfig.json
rm -rf tests/acceptance/192/packs-redraft-ac12/node_modules
```

`scripts/lanes.mjs` lists `'tests/acceptance/192/packs-redraft-ac12/'` in `alone`.

## Criterion to test

| Criterion | ID | File | The wrong programs it fails on |
|---|---|---|---|
| 12 | `#192.e8dea9d2` | `budget-ceilings.test.ts` (1 test) | the merge base (both refused providers install and run; the first failure names `budget/fuel`); a ceiling off by one (`ceilings` with 10,000,000,000 and 256 must install and run its 256 MiB program); a memory still read from `memory_mib` or left at 64 MiB |

`BASE-FAILURE.txt` is the run at the base.
