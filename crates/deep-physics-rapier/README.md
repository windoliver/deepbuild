# deep-physics-rapier

## What it is for

physics.world@1's backend (issue #2009): Rapier 0.36.1, pinned with enhanced-determinism and serde-serialize and without simd8 or parallel, behind `deep-canvas-physics`'s backend interface. A world is built in canonical order into one `PhysicsWorld` and stepped once a step, the world's substeps being Rapier's solver iterations. A deep checkpoint is that world's own bytes, stamped with the backend and version that wrote them, and restore refuses another version's, naming both. The `deep-physics` binary runs worlds over JSON lines for the acceptance tests. Issue #2010 adds what the build resolved (`build.rs`), keyed bakes kept in a store, playback, goldens and the floating-point control register's guard (`src/fp.rs`).

## Where new code goes

- Building, stepping and reading a world, and checkpoints, go in `src/lib.rs`.
- What the build resolved goes in `build.rs`, read by `build()` in `src/lib.rs`.
- The physics module's manifest is deep-canvas-physics's (`module::module`), built from `build()`: deep-show's full build links this crate for it, so the plan it publishes and a golden recorded here name the same implementation and pins (issue #1920).
- The control register's guard goes in `src/fp.rs`.
- The JSON-lines runner goes in `src/runner.rs`, shared by the `deep-physics` binary (`src/main.rs`, stdin and
  stdout) and the wasm32 build (its `wasm` module: a module with no imports, one call line in, one reply line out),
  which `scripts/physics-wasm32.mjs` builds and runs (issue #2012).
- Rapier's own determinism tests (`snapshot_portability`, `simd_backend_determinism`, `simd_backend_parity`,
  `snapshot_roundtrip`) are this crate's `tests/`, upstream's files unchanged below a license header, so they build
  against this crate's pinned rapier3d (issue #2012). Their `#![cfg(feature = …)]` reads this crate's default
  `serde-serialize` and `enhanced-determinism` features, which forward to rapier3d's; never edit their bodies.
- The acceptance tests are in `tests/acceptance/2009` and `tests/acceptance/2010`; `scripts/physics-build.mjs` refuses a build with a feature or flag that changes results.

## What it may import

`deep-canvas-physics` for the world, the caps, the interface, the bake key and the golden; `rapier3d` at `=0.36.1`; `bincode` for checkpoint bytes; `serde_json` for the runner; `simba` (`=0.10.2`, a dev-dependency) for Rapier's own `simd_backend_parity`. Outside the canvas lint: no Rapier type leaves this crate through the interface, and the build script and the guard's register reads, which the lint forbids, live here.

## Deviations

- `src/lib.rs` keeps Rapier's own contact prediction distance and sleep's angular threshold, which no world field sets.
- `build.rs` runs `cargo tree --locked` for the build's own resolution: the lockfile is never changed, but cargo may fetch a git source the outer build never needed (issue #2012: with `--frozen`, a build in fresh linux containers failed on gpui-shell's quickjs-jit), so an offline build without those sources can't read its pins and fails.
- `src/main.rs` keeps bakes in a store folder by key as JSON, not yet in the evidence store, which no criterion of #2010 reads.
