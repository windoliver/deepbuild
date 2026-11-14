# deep-canvas-loop

## What it is for

The loop canvas module's check kinds (canvas primitives: Check input: loop kinds).

- `geometry.shading` (issue #453): on every `mesh.asset@1` a document holds, its positions welded, then its flipped, degenerate, non-manifold, inconsistent and boundary defects counted per face or edge, its signed volume, and its quad ratio, which a mesh that deforms must keep. A primitive it can't read raises `BLOCKED` naming it.
- `scene.scale` and `camera.framing` (issue #1938), on the document evaluated on the CPU: a sized item's height against studio@1's range for its size, and the kept items against the safe frame, `fill` and the horizon. Each fix is a patch op the check applies to a copy and measures again before naming it. Both hold on any machine.
- `render.exposure`, `render.contrast` and `render.noise` (issue #1938), on frames the host draws as render-back does and hands over through `check_frames`. They hold on the machine that drew them.

It never repairs, remeshes or patches the document itself. deep-show registers the module in its full build set.

## Where new code goes

- Counting on one mesh (welding, defects, fans, quad pairing) goes in `src/count.rs`.
- The check's report, its codes, the requirement it reads and the planted wrong programs go in `src/lib.rs`.
- What the evaluated-data kinds share (evaluation, checked times, kept items, a fix applied to a copy) goes in `src/scene.rs`; what the pixel kinds share goes in `src/pixels.rs`; each kind has its own file.
- Kit fixtures, one per code, go in `src/fixtures.rs`.
- Reading a glTF's primitives goes in deep-canvas-scene3d's `src/gltf.rs`, not here. Drawing frames goes in the host (deep-show's `src/pixels.rs`), not here.
- Acceptance tests are in `tests/acceptance/453` and `tests/acceptance/1938`.

## What it may import

A canvas module crate. It reaches the core through `deep-canvas` and glTF reading and scene evaluation through `deep-canvas-scene3d`, by crate name only, and uses third-party crates listed in `lint/canvas/crates.json` (serde_json for documents and reports), under `scripts/canvas-lint.mjs`. No GPU crate, no render crate, no app.

## Deviations

None.
