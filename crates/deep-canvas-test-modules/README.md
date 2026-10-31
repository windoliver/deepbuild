# deep-canvas-test-modules

## What it is for

Test canvas modules named by the #305 and #488 acceptance READMEs, each one manifest and one register call: `test.a` and `test.b`, the fault modules the seal must refuse, and `test.tick` and `test.cache` for seeking against playing. A test build of deep-show compiles them in under its `test-*` features, and deep-gpu-layer under `test-meter`; no shipped build holds them.

## Where new code goes

- Registry and seal test modules go in `src/lib.rs`; time and checkpoint test modules go in `src/time.rs`.
- Add one only when an acceptance README names it, and give it its own Cargo feature in the crate that builds it in (deep-show or deep-gpu-layer).
- A real canvas module goes in its own `deep-canvas-<name>` crate, never here.

## What it may import

A canvas module crate. It reaches the core only through the `deep-canvas` crate and uses third-party crates listed in `lint/canvas/crates.json`, under `scripts/canvas-lint.mjs`. It never imports another module crate, a GPU crate or the app, and nothing but a test feature may depend on it.

## Deviations

- `src/lib.rs`: the fault modules (two writers of one array, a read of a later phase, a cycle, a missing dependency) are wrong on purpose; they are the planted faults the seal must refuse.
- `src/time.rs`: `test.cache` keys its cache by frame number on purpose; it is the wrong program a warm play against a cold seek must catch.
