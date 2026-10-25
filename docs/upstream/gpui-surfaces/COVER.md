# Cover text for the upstream pull request (zed-industries/zed)

Title:

    gpui: BGRA paint_surface pixel buffers, composited premultiplied, and per-frame surface reports

Body:

---

`paint_surface` takes only 4:2:0 YCbCr video frames today: the Metal renderer asserts the pixel
format and draws them opaque, which is what screen sharing needs. A renderer that draws into an
IOSurface-backed BGRA pixel buffer (a 3D view, a canvas drawn by wgpu or Metal in the same
process) has no way to show that texture in place; it has to read it back and upload it as an
image, which on an M3 Pro costs about 6.6–6.8 ms per 1936 × 1584 frame against 0.7–0.9 ms for
the handoff this series allows.

Two commits, each with a test in `metal_renderer.rs` beside `render_core_video_surface`:

1. **Composite `kCVPixelFormatType_32BGRA` pixel buffers premultiplied.** Their one plane is
   sampled texel for texel through a second surface pipeline whose blend has source factor one
   and destination factor one minus source alpha, since such a buffer holds color premultiplied
   by alpha: a texel with color and zero alpha, as a glow beyond an object's edge leaves behind,
   still adds its light to what is behind it. YCbCr surfaces are unchanged. The test renders a
   BGRA surface headlessly over the opaque black target and checks a half-covered red texel keeps
   its premultiplied value (a straight-alpha blend halves it) and a zero-alpha green texel keeps
   its light (dividing alpha out loses it). `paint_surface`'s doc comment now names both formats.

2. **Report the surfaces each frame samples and when it completes.** A producer that draws into
   a few pixel buffers in turn needs to know when GPUI's frame command buffer has finished reading
   one before it draws into it again or lets it go. `metal_renderer::surface_reports` is one
   process-wide hook that gets, for every frame command buffer that samples at least one surface,
   a `Committed` event naming the pixel buffers it samples (by address) as `render_frame` returns
   the buffer to its caller, which commits it, and a `Completed` event from the buffer's completed
   handler, with the GPU time the buffer took. Frames that sample no surface report nothing, so
   the hook costs nothing where `paint_surface` isn't used. The test installs the hook, renders a
   BGRA surface headlessly, and checks a `Committed` event names that pixel buffer alone and a
   `Completed` event follows for the same command buffer.

Both have shipped in a vendored copy of `gpui_apple` in DeepBuild (windoliver/deepbuild#377),
where an IOSurface handoff from a wgpu device into a GPUI window runs on them; the tests here
were also checked against the wrong programs they must reject (a straight-alpha blend, a
compositor that divides alpha out, a frame that never reports completion), and each fails on them.

`cargo test -p gpui_apple --lib metal_renderer` and `cargo clippy -p gpui_apple --tests` pass on
macOS (Apple silicon) at the base commit 93d7456.

Release notes:

- N/A

---

The series is against `93d745668805029476e6d7fbb19652116fed51de`; rebase it onto current `main`
before opening the PR (see README.md).
