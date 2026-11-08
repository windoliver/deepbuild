# deep-canvas-input

## What it is for

The input module, `input@1` (#308; design: Control and input track): controls and the input track's handling, the `control@1` registry with its kit and its first nine kinds, the drag grammar and the keys every pack inherits, seek versus edit, the tour and the parameter tool.

## Where new code goes

- `src/module.rs`: the module's manifest and what it registers; `src/session.rs`: a control session, its behaviors and the kinds.
- `src/track.rs`: the input track, its entries, samples and writers; `src/kit.rs`: `control@1`'s kit and its planted fills.
- The proof binary is `crates/deep-input`, not here.

## What it may import

A canvas module crate. It reaches the core through `deep-canvas` and motion's follow through `deep-canvas-motion`, by crate name only, plus `serde_json`. Its name puts it under `scripts/canvas-lint.mjs`. No GPU crate, no app.

## Deviations

None.
