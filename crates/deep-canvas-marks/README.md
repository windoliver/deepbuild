# deep-canvas-marks

## What it is for

R1's and R2's 2D marks on the CPU (issues #391, #374, #375): a writer layer's draw list, paths flattened and tessellated by content key and zoom bucket, paint, looks and the status guard, R1's data slice (mark sets, scales, one axis), dirty classes and auto layout by Taffy with text measured by deep-text. It also lays the text, look, marks2d and data modules out as canvas modules. It draws nothing: deep-marks-render, deep-marks-gpui and deep-marks-vello draw its list, and deep-app reads its status map.

## Where new code goes

- Draw-list building goes in `src/scene.rs`; where an item draws (its scale, position and turn about z) in `src/place.rs`; path geometry in `src/path.rs`; stars, polygons and arcs in `src/outline.rs`; gradients and adjustments in `src/paint.rs`.
- Looks and the status guard go in `src/look.rs`; a shipped look is data in `looks/`.
- Mark sets, scales and axes go in `src/data.rs`; auto layout in `src/layout.rs`; content keys in `src/key.rs`; dirty classes in `src/dirty.rs`; the module manifests in `src/modules.rs`; the module check in `src/check.rs`.
- Tests sit in a `#[cfg(test)]` module at the end of each file; acceptance tests are in `tests/acceptance/<issue>`.
- GPU drawing goes in deep-marks-render, deep-marks-gpui or deep-marks-vello, not here.

## What it may import

A canvas module crate. It reaches the core through the `deep-canvas` crate, shaping through `deep-text` and a drawn look's data through `deep-canvas-drawn` (#149), by crate name only, and uses third-party crates listed in `lint/canvas/crates.json`. Its name puts it under `scripts/canvas-lint.mjs` and `canvas_text = true` under `scripts/text-lint.mjs`: no GPUI text system, no GPU crate, no app.

## Deviations

- `src/main.rs`: built as the `deep-layout` binary, not `deep-canvas-marks`, because `deep-layout solve` is auto layout's proof surface (#375).
- `src/warp.rs` (#223): the split rule measures a piece's stray at a third and two thirds against the point's own image, and asks the map's interval form only when that lands within 10% of the tolerance; at a point the interval form is the point's value widened by rounding, so the two agree everywhere else, and asking it at every sample cost about ten point evaluations each. A flow has no interval form, so its image stands for itself.
- `src/warp.rs` (#223): a carried path is kept in a process-wide map by its content key (at most 512), so a still warp maps nothing per frame; the design's flow bake "by the group's content key" is this same map, keyed by each item's pre-warp outline, the warp's inputs and the stream table's bytes.
- `src/warp.rs` (#223): an item under nested warping groups takes the nearest group's warp only; status marks, a union outline's rings and `vector.glyphs` boxes draw unwarped; `max_points` is checked on the frame the check draws (the document as written), so a warp that grows only later is refused at that frame, not at check.
