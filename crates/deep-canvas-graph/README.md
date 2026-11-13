# deep-canvas-graph

## What it is for

The graph canvas module (issues #394 and #399; `graph@1`, `layout@1`, `route@1`, `label@1`, `labels@1`): the layered layout and its layout memory, `{id → (rank, order, x, y)}` by stable ID, deterministic by sorting on ID; new nodes laid into a kept picture, re-placing only the ranks they join; groups laid out in titled boxes; orthogonal routes around nodes, node labels and titles; and label placement by priority on an occupancy bitmap, per √2 zoom bucket chained from the base zoom. It draws nothing itself: deep-marks-render draws a graph and its labels as marks2d's items, deep-show and deep-gpu-layer register the module, and the `deep-graph layout` binary (`crates/deep-graph`) is its layout's proof surface.

## Where new code goes

- Layout steps, the memory rule, groups and reading graphs go in `src/lib.rs`.
- Routing goes in `src/route.rs`, label placement in `src/labels.rs`, and a graph item's view (layout choice, ports, routes) in `src/view.rs`.
- The manifest and the per-item operator go in `src/module.rs`.
- The `deep-graph` binary's line handling goes in `crates/deep-graph`.
- Tests go in `tests/` (`tests/memory.rs`); the acceptance tests are in `tests/acceptance/394` and `tests/acceptance/399`.
- Drawing nodes and edges is marks2d's and the render crates' work, not this crate's.

## What it may import

A canvas module crate. It reaches the core only through the `deep-canvas` crate and uses third-party crates listed in `lint/canvas/crates.json`, under `scripts/canvas-lint.mjs`, since a check reads the positions it writes. No GPU crate, no app.

## Deviations

None.
