# deep-canvas-marks

## What it is for

R1's and R2's 2D marks on the CPU (issues #391, #374, #375): a writer layer's draw list, paths flattened and tessellated by content key and zoom bucket, paint, looks and the status guard, R1's data slice (mark sets, scales, one axis), dirty classes and auto layout by Taffy with text measured by deep-text. It also lays the text, look, marks2d and data modules out as canvas modules. It draws nothing: deep-marks-render, deep-marks-gpui and deep-marks-vello draw its list, and deep-app reads its status map.

## Where new code goes

- Draw-list building goes in `src/scene.rs`; path geometry in `src/path.rs`; stars, polygons and arcs in `src/outline.rs`; gradients and adjustments in `src/paint.rs`.
- Looks and the status guard go in `src/look.rs`; a shipped look is data in `looks/`.
- Mark sets, scales and axes go in `src/data.rs`; auto layout in `src/layout.rs`; content keys in `src/key.rs`; dirty classes in `src/dirty.rs`; the module manifests in `src/modules.rs`; the module check in `src/check.rs`.
- Tests sit in a `#[cfg(test)]` module at the end of each file; acceptance tests are in `tests/acceptance/<issue>`.
- GPU drawing goes in deep-marks-render, deep-marks-gpui or deep-marks-vello, not here.

## What it may import

A canvas module crate. It reaches the core through the `deep-canvas` crate and shaping through `deep-text`, by crate name only, and uses third-party crates listed in `lint/canvas/crates.json`. Its name puts it under `scripts/canvas-lint.mjs` and `canvas_text = true` under `scripts/text-lint.mjs`: no GPUI text system, no GPU crate, no app.

## Deviations

- `src/main.rs`: built as the `deep-layout` binary, not `deep-canvas-marks`, because `deep-layout solve` is auto layout's proof surface (#375).
