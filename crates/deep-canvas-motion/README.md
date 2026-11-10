# deep-canvas-motion

## What it is for

The line's slice of the motion module (issue #391): channels and keys (linear, hold, Bézier, the follow spring), placements with start, repeat and extend, the transport's loop and the frame clock's `valid_until`. Every frame is the document evaluated at a flick. deep-canvas-scene3d, deep-marks-render, deep-show and deep-gpu-layer use it; the `deep-motion` binary in `crates/deep-motion` (`eval`, `insert`, `run`) is its proof surface. Issue #489 adds the rest of `motion@1`: eases, springs with velocity, auto tangents, extrapolation, modifiers, follow channels, drivers on world poses, motion's ten `constraint@1` kinds and the per-component order. Issue #492 adds the rest of Placement (`in`, `span`, `rate`, ping-pong, `hold_at`, `quantize`, `blend`, `influence`, `add_from`, fades, `start_on`, `switch`), every time remap preset, `quat`, `angle` and `vec` channels, quantize jumps and the look's `quantize_hz`. Issue #1487 makes the clock's `valid_until` count only the items whose bounds meet a view (`Program::valid_until_in_view`, the clock's `View`), so an item out of view stops the clock.

## Where new code goes

- Reading transport, channels, clips, placements, controls and shots goes in `src/doc.rs`; the input track and what it moves (#417) in `src/input.rs`; segment mixing in `src/curve.rs`; one evaluation in `src/eval.rs`.
- The compiled per-revision program goes in `src/program.rs`, its canonical bytes in `src/canonical.rs`; evaluation after the first frame allocates nothing.
- Key insertion goes in `src/insert.rs`; the frame clock in `src/clock.rs`; the manifest and operators in `src/module.rs`.
- Eases go in `src/ease.rs`, the spring's closed form in `src/spring.rs`, modifiers in `src/modifier.rs`, follow channels in `src/follow.rs`, constraint solves in `src/constraint.rs` with their `constraint@1` entries and kit fixtures in `src/kit.rs`, and the per-component order in `src/schedule.rs`.
- The tempo map (#491) goes in `src/tempo.rs`, cue alignment on markers in `src/cue.rs`, the occurrence-list reads drivers make in `src/occurrence.rs`; `first` markers are solved and layout glides mixed in `src/program.rs`, beside the other compiled reads.
- A placement's time from `in` through `quantize` goes in `src/eval.rs`, how its value lands on a path in `src/blend.rs`, time remaps in `src/remap.rs`, rotations in `src/quat.rs`; `first`-marker-style late reads (occurrences, the input track) are resolved in `Program::resolve_times`.
- Tests go in `tests/` or a `#[cfg(test)]` module in the file; the acceptance tests are in `tests/acceptance/391`.

## What it may import

A canvas module crate. It reaches the core only through the `deep-canvas` crate and uses third-party crates listed in `lint/canvas/crates.json`. Its math is f64 through deep-canvas's ops module on pinned libm, as `scripts/canvas-lint.mjs` requires. No GPU crate, no app.

## Deviations

- A `start_on`, a mark set's rows and a driver read a logic item's occurrences (#544) from the rows its host baked into the document's `occurrences`, keyed `<logic ID>.occurrences`, not through the core's column view, which serves only mark-set columns.
- A placement places a clip, not a recipe; a time remap reaches a recipe instance through its target.
