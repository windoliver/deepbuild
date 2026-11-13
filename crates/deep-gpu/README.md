# deep-gpu

## What it is for

The GPU layer for 3D and effects (#377): one wgpu device per app drawing offscreen into a GPU surface's slots off the UI thread, with fences and a release signal (an IOSurface GPUI composites in place on macOS, a copy through memory elsewhere), encode workers, uploads that settle over frames, the compile thread, the blank guard and the handoff's conformance decision; and the meter, degrade ladder and content-key results of #379. The canvas side is its only client (deep-app, deep-show, deep-gpu-layer and the render crates); nothing in a plug-in or an agent links it.

## Where new code goes

- One module per concern under `src/`, declared in `src/lib.rs`: `device.rs`, `ring.rs` and `surface.rs` (device, slots and fences, handoff storage), `view.rs` and `render.rs` (views and render modules), `encode.rs`, `upload.rs`, `compile.rs`, `guard.rs`, `meter.rs`, `frame_budget.rs` (the frame-budget check's five-run verdict, #1899), `frame_checks.rs` and `frame_checks.wgsl` (the export's per-frame GPU checks, #157: stats beside each frame's BLAKE3, non-finite texels, NV12 and fidelity scores), `memory.rs`, `cache.rs`, `alloc.rs`; and `seam.rs`, the GPU seam (#140): its backend, the tier's feature table, the quirk table (`quirks.json`, reviewed data) and the adapter it picks.
- Tests: unit tests in a `#[cfg(test)]` module beside the code; render logic that needs no GPU in `tests/noop.rs`, the noop lane (`cargo test -p deep-gpu` on wgpu's noop backend). Pixel and budget proofs are in tests/acceptance/377 and 379, through `deep-gpu` (crates/deep-gpu-layer).
- What a render module draws goes in its render crate (deep-scene3d-render, deep-effects-render); the proof binary's calls go in crates/deep-gpu-layer.

## What it may import

The bottom of the Rust GPU stack: deep-canvas through its crate root, deep-canvas-seams (the backend type every seam names), wgpu, pollster, serde_json and, on macOS only, the objc2 Metal, IOSurface and CoreVideo bindings; in tests only, blake3 (the CPU hash `src/blake3.rs` is checked against). It never imports GPUI, deep-app or a render crate; those depend on it.

## Deviations

- `build.rs`: reads wgpu's version from the workspace's Cargo.lock into the GPU seam's backend version, as deep-gpu-layer's build script does, so a new wgpu is a new backend in every key it feeds (#140).

- `src/alloc.rs`: every build marks wgpu's calls, but only a test build installs the counting allocator that reads the marks, so #379's zero-allocations-per-frame count leaves out what wgpu or the driver allocates.
- `src/memory.rs`: the `unsafe` reads Metal's own `allocatedSize` through wgpu's HAL, since memory is counted as the device reports it, never a formula; elsewhere a count that needs it is BLOCKED.
- `src/cache.rs`: the `Planted` caches are wrong programs the acceptance tests must catch, reachable only through a binary's `--planted`.
- `src/blake3.rs`: the `Planted` frame hash (#501) joins a parent's children in the wrong order, a wrong program a test must catch.
- `src/frame_checks.wgsl`: the `carry_dropped` override (#157) makes the stats pass's difference sum 32 bits, a wrong program a test must catch; only the module's tests set it.
- `src/encode.rs`: the test pool (feature `test-pool`, never in a shipped build) finishes encodes in a chosen order and the planted pool submits as they arrive, so a test can show the order never reaches the pixels.
