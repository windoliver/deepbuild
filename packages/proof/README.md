# @deepbuild/proof

## What it is for

The proof check plug-in (#685): it registers check kind `proof` through `deep.registerCheck`, running a machine-checked proof (Lean 4 through `lake comparator`, or Kani for a Rust crate) as a check that returns a closed run outcome, never a verdict. Its default export is the plug-in's register function; `tests/acceptance/685` drives it.

## Where new code goes

- `src/index.ts`: the plug-in entry and its fill; `src/check.ts`: one run; `src/lean.ts` and `src/kani.ts`: the two runners; `src/run.ts`: what both share.
- `src/kit.ts`: the `check.kind@1` kit, its cases on the crates in `fixtures/`; `src/types.ts`: the shapes.
- There is no `test/` folder: its tests are the acceptance suite in `tests/acceptance/685` (never edited), run by hand with Lean and Kani installed.

## What it may import

A plug-in on the core: only `@deepbuild/conformance` and `node:` built-ins, through its public entry. It never imports the record, the hub, CLI or app, and never installs a toolchain.

## Deviations

- `fixtures/lean/Kit/Proofs.lean`: `twice_sorry` ends in `sorry` on purpose; it is the kit's `lean-sorry` case, which must not pass.
- `fixtures/kani/Cargo.toml`: declares an empty `[workspace]` so the kit's crate stands on its own, outside the repo's workspace.
- `fixtures/lean/lean-toolchain`: pinned to Lean 4.35, whose `lake comparator` the Lean runner calls (`scripts/repo-rules.json`).
