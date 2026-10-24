# Draft for the upstream pull request (rewrite in your own words before posting)

Title: gpui_apple: premultiplied BGRA surfaces and per-frame surface reports

## Summary

`Window::paint_surface` takes only 4:2:0 YCbCr video frames today: the Metal renderer asserts the
pixel format. An app that renders 3D or effects with its own device (wgpu on Metal, in our case)
and wants to show the result in place has no zero-copy path into a GPUI window; copying a
1936 × 1584 frame through memory costs about 6.7 ms against 0.8 ms for an IOSurface handoff on an
M3 Pro.

This adds the small path that handoff needs:

- A `kCVPixelFormatType_32BGRA` pixel buffer draws through its own pipeline and a 7-line shader,
  premultiplied (source factor one, destination one minus source alpha, as path sprites blend), so
  color where alpha is zero still shows. YCbCr surfaces are unchanged.
- `metal_renderer::gpu_surfaces`: a buffer's owner must not draw into it again until GPUI has
  finished reading it, and only the renderer learns when that is. Each frame that samples a BGRA
  surface reports the buffers it samples once encoded (`Encoded`), and its completion with the
  GPU time it took (`Completed`), through one hook. The hook is process-wide because the window's
  owner has no handle on the renderer; if you'd rather have it per renderer or per window, I'm
  happy to change it.

The `paint_surface` doc names both formats.

## Testing

`cargo test -p gpui_apple` adds `render_bgra_surface_premultiplied`: a 16 × 16 BGRA IOSurface,
left half red at half alpha, right half green at alpha zero, beside the existing gray YCbCr
surface in the same batch, rendered headless; the pixels and both reports are checked. Swapping
the BGRA pipeline to the straight-alpha `build_pipeline_state` fails it (the alpha-zero half goes
black); dropping the `sampled_surfaces.push` fails it (no report); dropping the YCbCr pipeline
bind fails it (the gray half is drawn with the BGRA shader). `surface_hook_may_replace_itself`
checks a hook can uninstall itself from inside a report. `cargo clippy -p gpui_apple
--all-targets -- -D warnings` and `cargo fmt --check` pass.

[Fill in from your own run before posting: the macOS version and Mac you tested on, and what the
app showed. DeepBuild's #377 conformance run is the source: three IOSurface-backed slots shown
through `paint_surface`, released on `Completed`, pixel-identical to the copy path.]

## Self-review

- [x] I've reviewed my diff for quality, security, reliability, and performance.
- [ ] UI changes follow the checklist. (No UI change.)
- [x] Tests cover the new or changed behavior.

Release Notes:

- N/A
