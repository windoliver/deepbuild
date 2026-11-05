# deep-canvas-scene3d

## What it is for

The scene3d canvas module's R2 subset (issues #378, #379, #381): marks in 3D (boxes, cylinders, spheres, lines, points, text) registered through the registry and seal, and a document's 3D writer layers evaluated at t into what the GPU layer draws: instance records, the camera's reversed-Z projection, the look's exposure and tone map, labels' glyphs in the core's atlas, and 2D overlays anchored to 3D points. deep-scene3d-render draws it; deep-show and deep-gpu-layer register the module.

## Where new code goes

- Evaluating a document at t goes in `src/scene.rs`; frame-after-frame evaluation that rewrites only what moves goes in `src/frames.rs`.
- Labels in depth go in `src/label.rs`; anchored overlays in `src/overlay.rs`; what a 3D layer reads of the look in `src/look.rs`.
- The manifest, kinds and the passes the module adds go in `src/module.rs`.
- Tests sit in a `#[cfg(test)]` module in the file; acceptance tests are in `tests/acceptance/378`, `379` and `381`.
- Anything that touches the GPU goes in deep-scene3d-render, not here.

## What it may import

A canvas module crate. It reaches the core through `deep-canvas`, motion through `deep-canvas-motion` and shaping through `deep-text`, by crate name only, and uses third-party crates listed in `lint/canvas/crates.json` (vello_cpu rasterizes glyphs and overlays, which feed drawn pixels only). Its name puts it under `scripts/canvas-lint.mjs` and `canvas_text = true` under `scripts/text-lint.mjs`. No GPU crate, no app.

## Deviations

None.
