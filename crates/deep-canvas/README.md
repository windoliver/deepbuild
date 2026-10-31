# deep-canvas

## What it is for

The canvas core (issue #389 and on): the document grammars, the document model with kinds and versions, the check, patches, merge, the canonical form and revision hash, the registry and seal, the scheduler, time in flicks, the camera, the cost model and the f64 math checks read. Every `deep-canvas-*` module crate, deep-gpu, deep-show and the render crates build on it; the `deep-canvas` binary (`parse`, `check`, `apply`, `canonical`, `merge`, `color`, `session`, `render`) is its JSON-lines proof surface.

## Where new code goes

- Document rules, patches and merge go in `src/document/`; grammars (IDs, paths, handles, time and unit literals) in `src/grammar/`; the module registry and seal in `src/registry/`; the scheduler and content keys in `src/schedule/`.
- Every transcendental or power goes through `src/ops.rs`, never std's float methods (lint/canvas/clippy.toml refuses them).
- Unit tests sit in a `#[cfg(test)]` module in the file, or in `src/grammar/tests.rs` and `src/schedule/tests.rs`; CLI tests go in `tests/cli.rs`.
- A canvas module's own kinds and operators go in their own `deep-canvas-<name>` crate, registered through `src/registry/`, not here. Drawing on a GPU goes in deep-gpu or a render crate.

## What it may import

The bottom of the canvas: it imports no workspace crate, and only third-party crates audited in `lint/canvas/crates.json`. It registers a check kind, so `scripts/canvas-lint.mjs` holds it to: no platform libm, clock, hash-map iteration, OS path, glam or SIMD type, `unsafe`, build script or proc macro, and libm named only in `src/ops.rs`. It never imports a module crate, a GPU crate, the app or anything from the hub.

## Deviations

- `src/ops.rs`: the one file that may name `libm`; every other file reaches pinned libm through it so results match on arm64, x86_64 and wasm32. The lint fails any other file that names libm.
- `costs.json`: measured coefficients from a reference Mac, with its fingerprint and build profile, embedded by `src/cost.rs`. Rewrite it with `node benchmarks/canvas.mjs costs --write`, never by hand.
- `src/registry/semver.rs`: semver versions and ranges parsed by hand, so a manifest's versions are read without a dependency.
- `src/schedule/mod.rs`: `allow(clippy::large_enum_variant)` on the hasher state, since boxing the gathered bytes would allocate once per key.
