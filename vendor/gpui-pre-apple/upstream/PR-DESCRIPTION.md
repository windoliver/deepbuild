## Summary

`Window::paint_surface` takes only 4:2:0 YCbCr video frames today: the Metal renderer asserts the pixel format. An app that renders 3D or effects with its own device (wgpu on Metal, in our case) and wants to show the result in place has no zero-copy path into a GPUI window; copying a 1936 × 1584 frame through memory costs about 6.7 ms against 0.8 ms for an IOSurface handoff on an M3 Pro.

This adds the small path that handoff needs:

- A `kCVPixelFormatType_32BGRA` pixel buffer draws through its own pipeline and a 7-line shader, premultiplied (source factor one, destination one minus source alpha, as path sprites blend), so color where alpha is zero still shows. YCbCr surfaces are unchanged.
- `metal_renderer::gpu_surfaces`: a buffer's owner must not draw into it again until GPUI has finished reading it, and only the renderer learns when that is. Each frame that samples a BGRA surface reports the buffers it samples once encoded (`Encoded`), and its completion with the GPU time it took (`Completed`), through one hook. The hook is process-wide because the window's owner has no handle on the renderer; if you'd rather have it per renderer or per window, I'm happy to change it.

The `paint_surface` doc names both formats.

## Testing

`cargo test -p gpui_apple` adds `render_bgra_surface_premultiplied`: a 16 × 16 BGRA IOSurface, left half red at half alpha, right half green at alpha zero, beside the existing gray YCbCr surface in the same batch, rendered headless; the pixels and both reports are checked. Swapping the BGRA pipeline to the straight-alpha `build_pipeline_state` fails it (the alpha-zero half goes black); dropping the `sampled_surfaces.push` fails it (no report); dropping the YCbCr pipeline bind fails it (the gray half is drawn with the BGRA shader). `surface_hook_may_replace_itself` checks a hook can uninstall itself from inside a report, and `set_hook_drops_the_old_hook_outside_the_lock` that replacing a hook drops the old one with the lock released. `gpui_macos::metal_renderer` re-exports `gpu_surfaces` beside the renderer's other items, so a gpui user can reach it (second commit, from a review pass). `cargo clippy -p gpui_apple --all-targets -- -D warnings` and `cargo fmt --check` pass.

Manually tested on macOS 14.6 (MacBook Air, M3): our app's GPU layer draws a 1936 × 1584 premultiplied BGRA frame with an alpha ramp, a grey ramp and a glow into IOSurface-backed slots and shows them through `paint_surface`, releasing each slot on `Completed`; the window capture matches the copy path's pixel for pixel, and a planted straight-alpha compositor loses the glow where alpha is zero.

Disclosure: the code and this description were prepared with Claude Code and reviewed by me; the design (the BGRA path and the surface reports) comes from our own GPU layer, where this patch has shipped vendored.

## Self-review

- [x] I've reviewed my diff for quality, security, reliability, and performance.
- [ ] UI changes follow the [checklist](https://zed.dev/docs/development/ui-checklist). (No UI change.)
- [x] Tests cover the new or changed behavior.

Release Notes:

- N/A

