# deep-lottie

## What it is for

The import job's first tool, `lottie-import` (#162; canvas primitives: Asset job: Lottie import): a Lottie 1.0.1 file in, and out a canvas document by hash, the look@1 it names and its issues. Layers become items and groups, precomps groups with their layers placed in time, shapes paths with ops, keys Bézier keys, and masks, mattes and markers their own kinds; literal colors become roles of a generated look built on the shipped clean look, or the nearest roles of a named one. Expressions, text layers, merge paths, layer effects and everything else the document can't hold come back as issues naming their layer, never as code. It also holds the kind's three output checks (`import.document`, `import.colors_mapped`, `import.no_expression`). It is built to WebAssembly by `node scripts/lottie-wasm.mjs` and run by `packages/jobs/import/tool/lottie.mjs`, outside the canvas core and never per frame.

## Where new code goes

- `src/read.rs`: Lottie's values (static or keyed properties, Bézier shapes, slots) and what reads as script.
- `src/shapes.rs`: a shape layer's tree as the items it draws, by the spec's shape rendering model, and the export's repeater copies rebuilt.
- `src/items.rs`: one drawn item's kind, geometry, ops and paint.
- `src/layers.rs`: layers, precomps, transforms, parenting, spatial positions as `follow_path`, visibility, masks, mattes and markers.
- `src/geom.rs`: the spec's rectangle, ellipse and polystar as Bézier paths, path strings, boxes and flattening.
- `src/out.rs`: the document being built, its channels and keys, and the issues; `src/ids.rs`: IDs and order keys; `src/colors.rs`: colors into roles.
- `src/check.rs`: the output checks; `src/lib.rs`: the params, the envelope and the WebAssembly calls.
- Tests: `tests/round_trip.rs` (a file written by the export's convention back to the same item values), `tests/mapper.rs` (the mapper on small files), and a `#[cfg(test)]` module per file.

## What it may import

The canvas core (`deep-canvas`), the marks2d and motion modules (`deep-canvas-marks`, `deep-canvas-motion`) for the document check, `deep-text` for the faces a look may name, and `serde_json`. Its math goes through `deep_canvas::ops`; its maps iterate in key order.

## Deviations

- The marker a Lottie file gives a span that runs exactly to the next marker (or to the end, for the last) comes back with no span, since that is how the export writes a marker of none.
- A fill and a stroke over the same shapes are one item with both paints, so the stroke draws over the fill even where the file lists the fill above it.
- A Lottie parent is `child_of` the parent's pose in the composition both sit in (`parent: items/<id>/at/pos`), so the draw order stays the file's; the parent's anchor is taken off the child's position, which holds for a still anchor only.
- An ellipse's trim starts where `circle@1` starts its outline, at 3 o'clock, not at Lottie's 12 o'clock; an exported circle reads back unchanged.
