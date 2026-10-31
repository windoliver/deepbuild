# deep-canvas-graph

## What it is for

The graph canvas module's R1 slice (issue #394, `graph@1`, `layout@1`): the basic layered layout and its layout memory, `{id → (rank, order, x, y)}` by stable ID, deterministic by sorting on ID. It draws nothing; deep-show and deep-gpu-layer register the module, and the `deep-graph layout` binary is its proof surface.

## Where new code goes

- Layout steps, the memory rule and reading graphs go in `src/lib.rs`.
- The manifest and the per-item operator go in `src/module.rs`.
- CLI subcommands go in `src/main.rs`.
- Tests go in `tests/` (`tests/memory.rs`); the acceptance tests are in `tests/acceptance/394`.
- Drawing nodes and edges is marks2d's and the render crates' work, not this crate's.

## What it may import

A canvas module crate. It reaches the core only through the `deep-canvas` crate and uses third-party crates listed in `lint/canvas/crates.json`, under `scripts/canvas-lint.mjs`, since a check reads the positions it writes. No GPU crate, no app.

## Deviations

- `src/main.rs`: built as the `deep-graph` binary, not `deep-canvas-graph`, because that name is the surface the #394 acceptance README names.
