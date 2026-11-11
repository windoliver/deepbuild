# deep-canvas-physics

## What it is for

The physics canvas module (issue #2009, `physics.world@1`, measured, with backend_bytes state): the world document's reader with the design's defaults, the caps a backend declares and the check that refuses what they rule out, naming the field and the backend, and the backend interface a backend implements. Everything here is this crate's own types, so no backend type crosses the interface. Issue #2010 adds the bake key, the runtime digest and the outputs sampled at the document's frame rate (`src/bake.rs`), and step hashes, the golden comparator and where a golden stands across machines (`src/golden.rs`).

## Where new code goes

- A world, shape, body, joint or force field goes in `src/doc.rs`, with its default and range.
- What a backend can't run goes in `src/caps.rs` as data, and its refusal in `src/check.rs`.
- The backend interface is `src/backend.rs`; a backend lives in its own crate (Rapier's is `crates/deep-physics-rapier`).
- A part of the bake key, the runtime digest or how outputs are sampled goes in `src/bake.rs`; a hash, the comparator or a golden's cross-machine verdict in `src/golden.rs`. What the build resolved reaches them as a `Build` the backend's crate passes in.
- The codes it adds to the check catalog are `CODES` in `src/check.rs`.
- The acceptance tests are in `tests/acceptance/2009` and `tests/acceptance/2010`.

## What it may import

A canvas module crate under `scripts/canvas-lint.mjs`. It reaches the core through `deep-canvas` by crate name and reads JSON with `serde_json`. It depends on no physics engine and does no float math beyond comparisons.

## Deviations

- No manifest or `module()` yet: no build registers the physics module before #1920 seals `physics@1`, so `src/lib.rs` exports the reader, the check and the interface only.
- `src/backend.rs` declares `id`, `caps`, `build`, `step`, `read`, `canonical`, `checkpoint` and `restore`; `occurrences`, `query`, `move_character` and `drive_vehicle` join it with #1918, #1919, #182 and #251.
- `src/doc.rs` refuses by name, with the issue that brings each, the fields no criterion of #2009 or #2010 runs: kinematic, character and vehicle bodies, mesh, convex, heightfield and compound shapes, breaks, swing and twist, channel-valued targets, inputs, outputs other than a body's position, and the wind, buoyancy, inverse-square, magnetic and Lennard-Jones forces.
- `src/bake.rs` keys the scene's channels, drivers and input track as given; until #522 and #1918 a world reads none, so the backend's crate passes them empty. It computes the runtime digest itself, in the seal's shape, until #1920 seals `physics@1`.
