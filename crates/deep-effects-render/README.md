# deep-effects-render

## What it is for

The effects module's render side on the GPU layer (#380): each shipped operator's WGSL, which deep-canvas-effects writes from its checked steps, is validated by naga with every check and no optional capability, compiled once per key, and run as a full-screen pass in its place in a 3D view's frame (glow's mip chain, the ground grid, the shadow filter, sparks and the selection outline), each pass timed with wgpu-profiler. deep-gpu-layer's `deep-gpu` binary calls it.

## Where new code goes

- `src/compile.rs`: reading, checking, validating and caching an operator's WGSL. `src/runner.rs`: one checked operator's pipeline and bind groups on wgpu.
- `src/frame.rs`: the effects chain inside scene3d's post passes, and the `Planted` wrong programs.
- `src/glow.rs`: the glow's mip-chain plan, shared by the frame, the GPU run and the CPU reference. `src/reference.rs`: a shipped pass against its CPU reference in f64.
- No tests here: tests/acceptance/380 proves it through `deep-gpu` (crates/deep-gpu-layer).
- An operator's graph, checks and WGSL emitter belong in deep-canvas-effects, which touches no GPU.

## What it may import

A render crate on the GPU layer: deep-canvas-effects, deep-gpu and deep-scene3d-render through their crate roots, plus naga, wgpu, wgpu-profiler and serde_json. No GPUI and no app crate.

## Deviations

- `src/particles.wgsl`: the one hand-written shader here, the instanced draw of the particles a shipped compute operator wrote this frame; every operator's own WGSL comes from the emitter. Its header notes nothing in it is ported.
- `src/frame.rs`: `Planted` holds wrong programs (no Karis average, off-by-two, a slow glow), each reachable only through the binary's `--planted`.
