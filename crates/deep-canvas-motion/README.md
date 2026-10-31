# deep-canvas-motion

## What it is for

The line's slice of the motion module (issue #391): channels and keys (linear, hold, Bézier, the follow spring), placements with start, repeat and extend, the transport's loop and the frame clock's `valid_until`. Every frame is the document evaluated at a flick. deep-canvas-scene3d, deep-marks-render, deep-show and deep-gpu-layer use it; the `deep-motion` binary (`eval`, `insert`, `run`) is its proof surface.

## Where new code goes

- Reading transport, channels, clips and placements goes in `src/doc.rs`; segment mixing in `src/curve.rs`; one evaluation in `src/eval.rs`.
- The compiled per-revision program goes in `src/program.rs`, its canonical bytes in `src/canonical.rs`; evaluation after the first frame allocates nothing.
- Key insertion goes in `src/insert.rs`; the frame clock in `src/clock.rs`; the manifest and operators in `src/module.rs`.
- Tests go in `tests/` or a `#[cfg(test)]` module in the file; the acceptance tests are in `tests/acceptance/391`.

## What it may import

A canvas module crate. It reaches the core only through the `deep-canvas` crate and uses third-party crates listed in `lint/canvas/crates.json`. Its math is f64 through deep-canvas's ops module on pinned libm, as `scripts/canvas-lint.mjs` requires. No GPU crate, no app.

## Deviations

- `src/main.rs`: built as the `deep-motion` binary, not `deep-canvas-motion`, because that name is the surface the #391 acceptance README names.
