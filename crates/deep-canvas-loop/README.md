# deep-canvas-loop

## What it is for

The loop canvas module's check kinds (issue #453 lands the first, `geometry.shading`): on every `mesh.asset@1` a document holds, its positions welded, then its flipped, degenerate, non-manifold, inconsistent and boundary defects counted per face or edge, its signed volume, and its quad ratio, which a mesh that deforms must keep; then (issue #1935) each UV set's charts, flipped triangles, overlap, area outside the unit square, fill, smallest gap and texel density, and the mesh's hidden faces, unused vertices and islands. A primitive it can't read raises `BLOCKED` naming it. It never repairs or remeshes anything. deep-show registers the module in its full build set.

## Where new code goes

- Counting on one mesh (welding, defects, fans, quad pairing, unused vertices, islands) goes in `src/count.rs`.
- Reading one UV set (charts, raster, gaps, texel density) goes in `src/uv.rs`.
- The check's report, its codes, the requirement it reads and the planted wrong programs go in `src/lib.rs`.
- Kit fixtures, one per code, go in `src/fixtures.rs`.
- Reading a glTF's primitives and UV sets goes in deep-canvas-scene3d's `src/gltf.rs`, and casting the fixed directions for hidden faces in its `src/measures.rs`, not here.
- Acceptance tests are in `tests/acceptance/453` and `tests/acceptance/1935`.

## What it may import

A canvas module crate. It reaches the core through `deep-canvas` and glTF reading through `deep-canvas-scene3d`, by crate name only, and uses third-party crates listed in `lint/canvas/crates.json` (serde_json for documents and reports), under `scripts/canvas-lint.mjs`. No GPU crate, no render crate, no app.

## Deviations

None.
