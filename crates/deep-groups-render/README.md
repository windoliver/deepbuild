# deep-groups-render

## What it is for

A 2D writer layer's frame on the GPU layer (#1561), as a render crate both `deep-gpu` (crates/deep-gpu-layer) and `deep-show` draw through: the group compositor (#430: a layer's marks drawn run by run by Vello GPU, each composited group isolated, its passes, blend and backdrop), a drawn look's passes and the page they read (#149: the paper ground, a mark laid through its medium, relief), the paint and light built from a mark's coverage (#467, #2031, with #2032's cast shadows), and a 2D document's frame under a look as `film2d` draws it. It moved here from deep-gpu-layer, which no crate may depend on, so the live window, `film2d` and deep-show's `frames` draw one picture of a drawn look.

## Where new code goes

- `src/groups.rs` and `src/groups/compose.rs`: the compositor and its shader (`groups.wgsl`).
- `src/drawn.rs`: a frame's `Page`, the drawn passes (`drawn.wgsl`) and a drawing look's 3D post pass. `src/paintfx.rs`, `src/lightfx.rs`: a mark's paint and a lit group's light, each beside its shader.
- `src/frame2.rs`: a 2D frame as `film2d` draws it: its items through the 2D camera, its page, the layer the compositor takes, and `Frames2`, a host's frames drawn off any window.
- `src/read.rs`: a texture read back from the device.
- `src/lib.rs`: the `Planted` wrong programs these modules hold, each reachable only through a binary's `--planted`.
- Tests: the acceptance suites drive it through `deep-gpu` and `deep-show` (tests/acceptance/430, 149, 467, 2031, 2032, 1561); the one unit test, in `src/drawn.rs`, validates the passes' shader.
- A film's shots, print finishes, indexed looks and look regions stay in deep-gpu-layer's `film.rs`; a look's fields as read and checked belong in deep-canvas-drawn, which touches no GPU.

## What it may import

A render crate on the GPU layer: deep-canvas, deep-canvas-marks, deep-canvas-drawn, deep-canvas-effects and deep-canvas-scene3d, deep-gpu, deep-effects-render, deep-scene3d-render and deep-marks-render (for Vello GPU), each through its crate root, plus image, serde_json and wgpu. No app crate, and neither proof binary's crate.

## Deviations

- `src/lightfx.rs`: `--planted light_stale_list` keeps each lit group's last light list in a thread-local, as it did in deep-gpu-layer.
- `src/drawn.rs` holds a drawing look's 3D post pass beside the 2D passes, since both draw through one set of pipelines.
