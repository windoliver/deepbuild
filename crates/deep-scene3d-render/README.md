# deep-scene3d-render

## What it is for

scene3d's render module on the GPU layer (#378): each 3D writer layer is a batch whose instance records are written only where one changed and whose draws replay from a render bundle while its draw key holds; depth is reversed Z, an object-ID target carries pick IDs, and one output pass applies exposure and the tone map and encodes sRGB into the slot. It also draws the key light's shadow map (#380) and the status guard and status colors after the finish (#382). deep-effects-render, deep-gpu-layer and deep-show call it.

## Where new code goes

- `src/lib.rs`: the renderer, its batches and passes, and the `Planted` twins. `src/mesh.rs`: unit meshes. `src/shadow.rs`: the shadow map. `src/status.rs`: the status passes.
- WGSL sits beside the Rust that loads it with `include_str!`, one file per pass.
- Unit tests sit in a `#[cfg(test)]` module in the file they test; tests/acceptance/378, 380, 382, 383 and the later 3D issues prove the passes through `deep-gpu` (crates/deep-gpu-layer).
- What a 3D item is and how it is checked belongs in deep-canvas-scene3d, which touches no GPU; a 2D effect pass goes in deep-effects-render, and a pass that reads the 3D targets goes here.

## What it may import

A render crate on the GPU layer: deep-canvas-scene3d, deep-canvas-effects (a material operator's graph), deep-canvas-marks (the look's print fields) and deep-gpu through their crate roots, plus wgpu, wgpu-profiler and bytemuck. No GPUI and no app crate.

## Deviations

- `src/busy.wgsl`: the planted slow_gpu_frame twin's pass (#383), never in a shipped frame; it is not dead code.
- `src/lib.rs`: `Planted` holds wrong programs (forward Z, encoding twice, skipping the encode, stale replays), each reachable only through the binary's `--planted`.
