# deep-physics-rapier

## What it is for

physics.world@1's backend (issue #2009): Rapier 0.36.1, pinned with enhanced-determinism and serde-serialize and without simd8 or parallel, behind `deep-canvas-physics`'s backend interface. A world is built in canonical order into one `PhysicsWorld` and stepped once a step, the world's substeps being Rapier's solver iterations. A deep checkpoint is that world's own bytes, stamped with the backend and version that wrote them, and restore refuses another version's, naming both. The `deep-physics` binary runs worlds over JSON lines for the acceptance tests. Issue #2010 adds what the build resolved (`build.rs`), keyed bakes kept in a store, playback, goldens and the floating-point control register's guard (`src/fp.rs`). Issue #2011 adds convex, mesh and compound colliders, the narrow-phase tests each pair of shape uses ran in a step, and the runner's `pairs`, `time`, `time_build` and `time_end` calls, which `scripts/physics-budget.mjs` uses to hold `budget.step_p95` natively and in headless Chrome. Issue #1918 adds each step's occurrences, read from the world after the step (`src/occurrences.rs`): contacts, hits, sensor entries and exits tested on the step's poses, rest and wake, and breaks; kinematic bodies, channel motor targets, a kinematic solve and breaking joints; and a world inside the scene that lists it (`src/scene.rs`). Issue #523 adds each joint's own state and readings (`src/joints.rs`): a hinge's whole turns, kept with its steps past `breaks_at` in the joint's `user_data` so a checkpoint carries them, its force from its locks' and limits' impulses only, `fault {kind: speed_cap}` for each cap a step meets and an output's crossings; and the kinematic solve (`src/kinematic.rs`), which places each body a hinge, slider or fixed joint carries and solves the undriven coordinates so gears, pulleys and closing joints hold, writing `fault {kind: jam}` when its iteration cap ends past its tolerance.

## Where new code goes

- Building, stepping and reading a world, and checkpoints, go in `src/lib.rs`.
- What the build resolved goes in `build.rs`, read by `build()` in `src/lib.rs`.
- The physics module's manifest is deep-canvas-physics's (`module::module`), built from `build()`: deep-show's full build links this crate for it, so the plan it publishes and a golden recorded here name the same implementation and pins (issue #1920).
- The control register's guard goes in `src/fp.rs`.
- What a step wrote (contacts, hits, sensors, rest and wake, breaks) goes in `src/occurrences.rs`; it only reads the world, so a world's bytes and checkpoints are what they were. The `test-reverse-pairs` feature builds #1918's test backend, which reads every pair last to first from its second collider's side.
- What a world reads of its scene (paths, the cycle check, the key's reads) goes in `src/scene.rs`.
- The JSON-lines runner goes in `src/runner.rs`, shared by the `deep-physics` binary (`src/main.rs`, stdin and
  stdout) and the wasm32 build (its `wasm` module: a module with no imports, one call line in, one reply line out),
  which `scripts/physics-wasm32.mjs` builds and runs (issue #2012).
- Rapier's own determinism tests (`snapshot_portability`, `simd_backend_determinism`, `simd_backend_parity`,
  `snapshot_roundtrip`) are this crate's `tests/`, upstream's files unchanged below a license header, so they build
  against this crate's pinned rapier3d (issue #2012). Their `#![cfg(feature = …)]` reads this crate's default
  `serde-serialize` and `enhanced-determinism` features, which forward to rapier3d's; never edit their bodies.
- The acceptance tests are in `tests/acceptance/2009`, `2010`, `2011`, `2012`, `1918` and `523`; `scripts/physics-build.mjs` refuses a build with a feature or flag that changes results; `scripts/physics-budget.mjs` times release builds of this crate on each host.

## What it may import

`deep-canvas-physics` for the world, the caps, the interface, the bake key, the golden and the occurrence list; `deep-canvas-motion` to evaluate the paths a world reads of its scene; `rapier3d` at `=0.36.1`; `bincode` for checkpoint bytes; `serde_json` for the runner; `simba` (`=0.10.2`, a dev-dependency) for Rapier's own `simd_backend_parity`. Outside the canvas lint: no Rapier type leaves this crate through the interface, and the build script and the guard's register reads, which the lint forbids, live here.

## Deviations

- `src/lib.rs` keeps Rapier's own contact prediction distance and sleep's angular threshold, which no world field sets.
- `build.rs` runs `cargo tree --locked` for the build's own resolution: the lockfile is never changed, but cargo may fetch a git source the outer build never needed (issue #2012: with `--frozen`, a build in fresh linux containers failed on gpui-shell's quickjs-jit), so an offline build without those sources can't read its pins and fails.
- `src/main.rs` keeps bakes in a store folder by key as JSON, not yet in the evidence store, which no criterion of #2010 reads.
- `src/occurrences.rs` writes contact_begin, contact_end, hit, sensor_enter, sensor_exit, break, rest and wake, and `src/joints.rs` and `src/kinematic.rs` fault (speed_cap and jam) and crossing; no world here declares what writes `force` rows, and `tear` is a soft body's (#1786), so neither is written yet.
- `src/joints.rs` counts a body's speed cap when a step starts past it or ends at it having started below it, since Rapier caps inside its solver and reports nothing; a body held at the cap writes one fault, not one a step, and so does a jam (`src/kinematic.rs`), written on the step it starts.
- `src/kinematic.rs` writes `fault {kind: jam}` on the step its solve first ends past its tolerance, naming the joint with the largest residual, and while jammed holds the nearest placement it can reach; it reports no residuals or branch flips to an audit, and a slider can't close a loop.
- `src/scene.rs`'s cycle check follows drivers' vars and lists back to the world's outputs and forms; a follow channel or a parent that reads a physics pose isn't traced.
