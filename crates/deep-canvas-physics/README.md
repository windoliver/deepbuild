# deep-canvas-physics

## What it is for

The physics canvas module (issue #2009, `physics.world@1`, measured, with backend_bytes state): the world document's reader with the design's defaults, the caps a backend declares and the check that refuses what they rule out, naming the field and the backend, and the backend interface a backend implements. Everything here is this crate's own types, so no backend type crosses the interface. Issue #2010 adds the bake key, the runtime digest and the outputs sampled at the document's frame rate (`src/bake.rs`), and step hashes, the golden comparator and where a golden stands across machines (`src/golden.rs`). Issue #1920 adds the module's manifest and register call (`src/module.rs`): it implements `physics@1`, and its implementation is the backend's crate with the pins the build resolved, so a build seals it and the seal's runtime digest names it.

## Where new code goes

- A world, shape, body, joint or force field goes in `src/doc.rs`, with its default and range.
- What a backend can't run goes in `src/caps.rs` as data, and its refusal in `src/check.rs`.
- The backend interface is `src/backend.rs`; a backend lives in its own crate (Rapier's is `crates/deep-physics-rapier`).
- A part of the bake key or how outputs are sampled goes in `src/bake.rs`; a hash, the comparator or a golden's cross-machine verdict in `src/golden.rs`. What the build resolved reaches them as a `Build` the backend's crate passes in.
- The manifest and the register call are `src/module.rs`. A golden's runtime digest is the seal's, of the set that holds this module alone (`Build::runtime_digest` in `src/bake.rs`).
- The codes it adds to the check catalog are `CODES` in `src/check.rs`.
- The acceptance tests are in `tests/acceptance/2009`, `tests/acceptance/2010` and `tests/acceptance/1920`.

## What it may import

A canvas module crate under `scripts/canvas-lint.mjs`. It reaches the core through `deep-canvas` by crate name and reads JSON with `serde_json`. It depends on no physics engine and does no float math beyond comparisons.

## Deviations

- `src/module.rs` registers no kind, array, operator or check kind yet: a world runs through its backend's runner until a scene lists it (#522), so `physics@1`'s digest covers no shape. The interface has no behavior part until #191, so a build admits only its reference, Rapier.
- `src/backend.rs` declares `id`, `caps`, `build`, `step`, `read`, `canonical`, `checkpoint` and `restore`; `occurrences`, `query`, `move_character` and `drive_vehicle` join it with #1918, #1919, #182 and #251.
- `src/doc.rs` refuses by name, with the issue that brings each, the fields no criterion of #2009 or #2010 runs: kinematic, character and vehicle bodies, mesh, convex, heightfield and compound shapes, breaks, swing and twist, channel-valued targets, inputs, outputs other than a body's position, and the wind, buoyancy, inverse-square, magnetic and Lennard-Jones forces.
- `src/bake.rs` keys the scene's channels, drivers and input track as given; until #522 and #1918 a world reads none, so the backend's crate passes them empty.
