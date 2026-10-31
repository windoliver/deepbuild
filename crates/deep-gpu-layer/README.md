# deep-gpu-layer

## What it is for

The binary `deep-gpu`, the proof surface for the GPU layer (#377): `deep-gpu run` plays a JSON scenario of calls against one app's GPU layer, parity scenes drawn off the UI thread into a surface's slots and, on macOS, shown in a headless GPUI window over a page and under the question card and captured from it. It also runs the handoff's conformance, the blank guard's comparisons, the compile thread and the plug-in fixture, and later issues' calls: the meter (#379), 3D views (#378), effects (#380), status and hosts (#382) and levels (#383). The suites in tests/acceptance/377 to 383 drive it.

## Where new code goes

- `src/main.rs`: the command line, call dispatch and the `Planted` list; each call family in its own module (`frames.rs`, `conformance.rs`, `live.rs`, `view3d.rs`, `effects.rs`, `host.rs`, `levels.rs`, `golden.rs`, `timing.rs` and the rest).
- `src/worker.rs`: the render thread that owns all GPU work. `src/window.rs`: the headless window and its capture.
- Test-only modules (`src/allocations.rs`, `src/testgpu.rs`, `src/burn.wgsl`) build only under `test-meter`; keep new test fixtures behind a feature too.
- Tests: the acceptance suites drive the binary; the one unit module is in `src/plugin.rs`.
- Code the app also needs belongs in deep-gpu or a render crate, not here.

## What it may import

A proof binary at the top of the stack: deep-gpu, the canvas crates, the render crates, deep-app and deep-replica, each by crate name. No crate depends on it.

## Deviations

- `build.rs`: reads the workspace's Cargo.lock for the wgpu and wgpu-profiler versions, for a run's environment fingerprint and the profiler it names (#380).
- `src/reference.rs`: the CPU reference computes a scene's frame byte for byte from the scene alone and shares no code with the GPU path; it is what the conformance run checks the handoff against, so keep it apart from `src/scene.rs`.
- `src/main.rs`: its counting global allocator, the crate's one `unsafe impl`, is compiled only under `test-meter` (#379).
