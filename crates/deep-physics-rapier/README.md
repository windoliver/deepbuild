# deep-physics-rapier

## What it is for

physics.world@1's backend (issue #2009): Rapier 0.36.1, pinned with enhanced-determinism and serde-serialize and without simd8 or parallel, behind `deep-canvas-physics`'s backend interface. A world is built in canonical order into one `PhysicsWorld` and stepped once a step, the world's substeps being Rapier's solver iterations. A deep checkpoint is that world's own bytes, stamped with the backend and version that wrote them, and restore refuses another version's, naming both. The `deep-physics` binary runs worlds over JSON lines for the acceptance tests.

## Where new code goes

- Building, stepping and reading a world, and checkpoints, go in `src/lib.rs`.
- The JSON-lines runner goes in `src/main.rs`.
- The acceptance tests are in `tests/acceptance/2009`.

## What it may import

`deep-canvas-physics` for the world, the caps and the interface; `rapier3d` at `=0.36.1`; `bincode` for checkpoint bytes; `serde_json` for the runner. Outside the canvas lint: no Rapier type leaves this crate through the interface.

## Deviations

- `src/lib.rs` keeps Rapier's own contact prediction distance and sleep's angular threshold, which no world field sets.
