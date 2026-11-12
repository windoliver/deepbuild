# deep-canvas-physics

## What it is for

The physics canvas module (issue #2009, `physics.world@1`, measured, with backend_bytes state): the world document's reader with the design's defaults, the caps a backend declares and the check that refuses what they rule out, naming the field and the backend, and the backend interface a backend implements. Everything here is this crate's own types, so no backend type crosses the interface. Issue #2010 adds the bake key, the runtime digest and the outputs sampled at the document's frame rate (`src/bake.rs`), and step hashes, the golden comparator and where a golden stands across machines (`src/golden.rs`). Issue #2011 adds roles that expand through a first-party table into collision groups (`src/roles.rs`), the check kind `physics.pairs` over the whole interaction matrix (`src/pairs.rs`), inline `convex`, `mesh` and `compound` shapes, `budget.step_p95`, and sensor entries and exits in the backend interface's `occurrences`. Issue #1918 adds the occurrence list, made canonical and sorted from what a backend reports (`src/occurrence.rs`), the module that fills the core's `column.source@1` with `<world ID>.occurrences` and `<world ID>.<ID>.<read>` (`src/module.rs`), and the reader's kinematic bodies, `follow`, channel motor targets, `breaks_at`, `tag`, `solve` and outputs (`src/doc/reads.rs`).

## Where new code goes

- A world, shape, body, joint or force field goes in `src/doc.rs`, with its default and range; #1918's fields and the outputs go in `src/doc/reads.rs`.
- The occurrence list's kinds, canonical order, bytes and rows go in `src/occurrence.rs`; the manifest and the `column.source@1` entries in `src/module.rs`.
- What a backend can't run goes in `src/caps.rs` as data, and its refusal in `src/check.rs`.
- The backend interface is `src/backend.rs`; a backend lives in its own crate (Rapier's is `crates/deep-physics-rapier`).
- A part of the bake key or how outputs are sampled goes in `src/bake.rs`; a hash, the comparator or a golden's cross-machine verdict in `src/golden.rs`. What the build resolved reaches them as a `Build` the backend's crate passes in. A golden's runtime digest is the seal's, of the set that holds this module alone (`Build::runtime_digest`, #1920).
- A role's groups go in `TABLE` in `src/roles.rs`; a rule a role promises, which physics.pairs holds whatever the table says, goes in `src/pairs.rs`.
- The codes it adds to the check catalog are `CODES` in `src/check.rs`.
- The acceptance tests are in `tests/acceptance/2009`, `2010`, `2011`, `1918` and `1920`.

## What it may import

A canvas module crate under `scripts/canvas-lint.mjs`. It reaches the core through `deep-canvas` by crate name and reads JSON with `serde_json`. It depends on no physics engine and does no float math beyond comparisons.

## Deviations

- `src/module.rs`'s manifest names the backend's crate as `physics@1`'s implementation, measured with backend_bytes state, with the pins the build resolved (#1920). The interface has no behavior part until #191, so a build admits only its reference, Rapier. It registers no stepper, operator or kind: the host bakes a scene's worlds at check, as the logic module's items are baked.
- `src/backend.rs` declares `id`, `caps`, `build`, `step`, `occurrences`, `read`, `canonical`, `checkpoint` and `restore`; `query`, `move_character` and `drive_vehicle` join it with #1919, #182 and #251.
- `src/doc.rs` refuses by name, with the issue that brings each, the fields no criterion of #2009, #2010, #2011 or #1918 runs: character and vehicle bodies, heightfield shapes and shapes built `from` an item or asset (#927), swing and twist, a drag medium, a spring point or a strength set by input, inputs, the wind, buoyancy, inverse-square, magnetic and Lennard-Jones forces, and an output's `reduce`, `average`, `sample`, `keep`, `expr` and `unit` (#2248), skins and soft or character reads; `src/check.rs` refuses gear, rack, pulley and path joints in kinematic mode (#523).
- `src/bake.rs` keys the scene's channels and drivers a world reads as the values they give at every step (`reads`), and the input track as given, which no world reads before #522.
- `src/occurrence.rs`'s rows carry no time: a host stamps each with its step's time (`timed`) where a scene's readers read it.
- `budget` reads only `step_p95`; `memory` and `bake_10s` are accepted and not yet held. The hosts block (`host@1`) that will say which hosts have a reference Mac doesn't exist yet, so `scripts/physics-budget.mjs` takes it in its request.
