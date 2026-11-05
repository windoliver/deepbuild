# deep-canvas-vector

## What it is for

The vector canvas module (issue #398, `vector@1`): SVG imported as static paths whose colors map to roles and whose ids become parts a channel can key, internal `<use>` and `<defs>` resolved, and formulas written on term by term. A vector item draws as marks2d's own items (a group per part, a path per drawn element), built from the item as evaluated at a time. deep-show registers the module; `deep-canvas-render`'s `check`, `raster` and `geometry` are its proof surface.

## Where new code goes

- The SVG import (the closed list of elements, refusals, transforms, paths, colors) goes in `src/svg.rs`.
- Placement, parts, the write and the items a vector draws as go in `src/lower.rs`.
- The import's issues over a document go in `src/lib.rs`; the manifest and its fixture in `src/module.rs`.
- The acceptance tests are in `tests/acceptance/398`.

## What it may import

A canvas module crate. It reaches the core through `deep-canvas` and marks through `deep-canvas-marks`, by crate name only, and uses third-party crates listed in `lint/canvas/crates.json` (roxmltree reads the XML; no float math). Its name puts it under `scripts/canvas-lint.mjs`: every number its geometry computes goes through deep-canvas's ops module. It reads no file: the caller hands it an SVG's bytes by sha256.

## Deviations

None.
