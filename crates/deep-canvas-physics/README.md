# deep-canvas-physics

## What it is for

The physics canvas module (issue #2009, `physics.world@1`, measured, with backend_bytes state): the world document's reader with the design's defaults, the caps a backend declares and the check that refuses what they rule out, naming the field and the backend, and the backend interface a backend implements. Everything here is this crate's own types, so no backend type crosses the interface.

## Where new code goes

- A world, shape, body, joint or force field goes in `src/doc.rs`, with its default and range.
- What a backend can't run goes in `src/caps.rs` as data, and its refusal in `src/check.rs`.
- The backend interface is `src/backend.rs`; a backend lives in its own crate (Rapier's is `crates/deep-physics-rapier`).
- The codes it adds to the check catalog are `CODES` in `src/check.rs`.
- The acceptance tests are in `tests/acceptance/2009`.

## What it may import

A canvas module crate under `scripts/canvas-lint.mjs`. It reaches the core through `deep-canvas` by crate name and reads JSON with `serde_json`. It depends on no physics engine and does no float math beyond comparisons.

## Deviations

- No manifest or `module()` yet: no build registers the physics module before #1920 seals `physics@1`, so `src/lib.rs` exports the reader, the check and the interface only.
- `src/backend.rs` declares `id`, `caps`, `build`, `step`, `read`, `checkpoint` and `restore`; `occurrences`, `query`, `move_character`, `drive_vehicle` and `hash` join it with #1918, #1919, #182, #251 and #2010.
- `src/doc.rs` refuses by name, with the issue that brings each, the fields no criterion of #2009 runs: kinematic, character and vehicle bodies, mesh, convex, heightfield and compound shapes, breaks, swing and twist, channel-valued targets, inputs, outputs, and the wind, buoyancy, inverse-square, magnetic and Lennard-Jones forces.
