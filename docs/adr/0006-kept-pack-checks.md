# 0006: A pack check's result, kept

Status: accepted (#3611). The design states the rule under Pack: a check's result, kept (`docs/canvas-primitives.md`); the decisions below are the ones written nowhere else.

## The store's rows

- **A row's `planted` names every wrong program of the core, a row-taking one included.** `crates/deep-show/src/packs/checked.rs`, `given`. It joins the Cargo features beside `default` and `full` (`DEEP_FEATURES`, from `build.rs`), the `--planted` start argument (`started`) and the scenario's `planted`. Two builds of the same sources with different features share a source digest, so the row has to name the features.
- **No row for a twin, a version the core already holds, or a version with a provider.** `crates/deep-show/src/packs.rs`, `install`. A twin's manifest is rewritten after it is read. A republish is refused for the bytes the core holds, and a provider's output is checked against the layouts of the packs beside it; a row names neither.
- **A refused row keeps the host's own refusal.** `crates/deep-show/src/packs.rs`, `install`; `crates/deep-show/src/sandbox.rs`, `refusal` and `refuse_kept`. Its `left.programs` is the list the sandbox half held, or null when the core's half refused, so a document naming one of the version's providers fails as it did after the check.
- **A kept refusal puts `module_missing` issues back.** `crates/deep-canvas/src/document/packs.rs`, `Packs::refuse_kept`. A document that names the version is then refused with the same issue, as after `Packs::admit`.
- **A row that can't be written is no row.** `crates/deep-show/src/packs/checked.rs`, `Bound::write`. The part file is removed and the next core checks.
- **Marks are compared over every byte.** `crates/deep-show/src/packs/checked.rs`, `Bound::marked`. How long the comparison takes says nothing of where two marks differ.
- **A planted core's row stands with nothing admitted.** `crates/deep-show/src/packs.rs`, `install`; `checked.rs`, `Kept::forced`. A row taken past its digest or build, or a file that can't be read as text, may hold nothing this pack's bytes admit; the planted core still reports the row's outcome, which is its fault.

## What a taken row gives the core

- **The entries' kits come from the row, named by the registry's own rules.** `crates/deep-canvas/src/registry/lists.rs`, `KitResult::from_kept`. A rule's name and message are the build's statics; a kept rule that is none of the registry's makes the row unfit, and the check runs.
- **An entry the row lacks runs its kit, and then the whole check runs.** `crates/deep-canvas/src/document/packs.rs`, `Packs::admit_kept`. The kit that ran is counted before the row is given up.
- **The sandbox half is seeded, then asked as a later host is.** `crates/deep-show/src/sandbox.rs`, `Host::take`. It puts what the row holds into `VETTED` and the logic module's reply into `LIB_CHECKS`, then calls `vet`, which finds both. Rewritten programs are not restored: `rewrite_in` rewrites one when a piece first runs it.

## The counts

- **Kits and field checks ride on `Packs`.** `crates/deep-canvas/src/document/packs.rs`, `Ran`. The canvas lint refuses every static in the canvas crates, so the count is a field of the store the check already writes.
- **Rewrites and runs are counted where every caller passes.** `crates/deep-sandbox-wasmtime/src/lib.rs`, `rewrites_and_runs`; `service.rs`, `Sandbox::rewrite`; `Runner::call`. The sandbox host and the logic module both rewrite and run through that crate, which is outside the canvas lint.
- **A count is the difference around one install.** `crates/deep-show/src/packs/checked.rs`, `reading` and `ran`. The seal's own kits and a document's runs are no part of a pack check.

## The hub

- **The key is made with the pack store and handed out with it.** `packages/hub/src/packs.ts`, `Packs.checks`. Every world that names packs gets `pack_checks` from the same object: `canvasWorld` and `exportStill` in `hub-canvas.ts`, `checkPacks` in `canvas.ts`.
- **A world file can't name a store.** `packages/hub/src/hub-canvas.ts`, `canvasWorld`. `pack_checks` is set after the world file's fields are spread.
