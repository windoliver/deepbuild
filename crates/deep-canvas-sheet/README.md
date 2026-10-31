# deep-canvas-sheet

## What it is for

The sheet canvas module (issue #394, `sheet@1`): a taste call's candidates on a variant sheet, near copies dropped by their stills' OKLab ΔE, and the view that draws the sheet beside the question card's slot, where a cell click only preselects. deep-show and deep-gpu-layer register the module; the `deep-sheet` binary (`taste`, `view`, `render`) is its proof surface.

## Where new code goes

- Candidates, the ΔE rule, the view and cell rendering go in `src/lib.rs`.
- The manifest and the per-item operator go in `src/module.rs`; CLI subcommands in `src/main.rs`.
- Tests go in `tests/` (`tests/cells.rs`); the acceptance tests are in `tests/acceptance/394`.
- The question card itself is the app's (deep-app), not this crate's.

## What it may import

A canvas module crate. It reaches the core through `deep-canvas` and marks through `deep-canvas-marks`, by crate name only, and uses third-party crates listed in `lint/canvas/crates.json`. Its name puts it under `scripts/canvas-lint.mjs`: the ΔE a check reads is f64 through deep-canvas's color and ops modules. No GPU crate, no app.

## Deviations

- `src/main.rs`: built as the `deep-sheet` binary, not `deep-canvas-sheet`, because `taste` and `view` are the surface the #394 acceptance README names.
