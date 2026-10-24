# The GPUI patch offered upstream (#711)

`0001-gpui_apple-premultiplied-BGRA-surfaces-and-per-frame-surface-reports.patch` is the part of
this crate's `DeepBuild patch (windoliver/deepbuild#377)` changes that isn't DeepBuild's own,
rebased onto zed-industries/zed `main` at `347f171a3fd00a3b672382d78348b37bd969d17c`
(October 24, 2026) as one commit, with a test of its own.

What it carries:

- `paint_surface` accepts a `kCVPixelFormatType_32BGRA` pixel buffer beside the 4:2:0 YCbCr video
  frames it took before: one format branch in `draw_surfaces`, one pipeline (source factor one,
  destination factor one minus source alpha, as path sprites blend) and the 7-line
  `surface_bgra_fragment` shader, so a premultiplied slot keeps its color where alpha is zero.
- `metal_renderer::gpu_surfaces`: each frame that samples a BGRA surface reports the buffers it
  samples once its command buffer is encoded (`Event::Encoded { frame, surfaces }`) and its
  completion with the GPU time it took (`Event::Completed { frame, gpu_ns }`), through one
  `set_hook`. This is this crate's `gpu_surfaces` module without `Planted`, with the hook called
  outside the lock (so a hook may replace itself from Metal's completion thread), the report
  skipped when no hook is installed, and the names changed: `Committed { buffer }` here is
  `Encoded { frame }` there, since the report precedes the commit. The vendored copy keeps the
  old names until upstream decides; deep-app's `gpu_view.rs` is the one consumer to rename then.
- The BGRA shader samples linear, as the YCbCr one does; this crate's samples nearest. At 1:1 on
  snapped bounds both read texel for texel, which is what #377's handoff fixture checks.
- `render_bgra_surface_premultiplied`, in `metal_renderer::tests`: a half-alpha red and an
  alpha-zero green BGRA surface beside a gray YCbCr surface in one batch, rendered headless;
  pixels and both reports checked. A straight-alpha blend for the BGRA pipeline fails it at the
  alpha-zero half; a dropped `sampled_surfaces.push` fails it at the report count; a dropped
  YCbCr pipeline bind after a BGRA surface fails it at the gray half. `surface_hook_may_replace_itself`
  fails (times out) when the hook is called under the lock. The two tests that install a hook take
  one test-only mutex, since the hook is process-wide and `cargo test` runs tests in parallel.
- Reviewed in two rounds by fresh reviewers (this folder's PR). Round 1 found the hook called under
  the lock, the report named for a commit it precedes and the pipeline switch untested; round 2
  found the hook tests racing each other. Each fix is in the patch with a check that fails without
  it.

What it leaves out, on purpose: the planted twins `DividesAlpha` and `AfterScene` (#377's
acceptance tests only), `gpu_ledger` and `ColorSpace::OklabExact` (#391, a separate offer), and
`paint_mask_sprite` (#390, in `vendor/gpui-pre`).

Reproduce the proof on a Mac:

```sh
git clone --depth 1 https://github.com/zed-industries/zed && cd zed
git fetch --depth 1 origin 347f171a3fd00a3b672382d78348b37bd969d17c && git checkout FETCH_HEAD
git am ../deepbuild/vendor/gpui-pre-apple/upstream/0001-*.patch
cargo fmt -p gpui_apple --check
cargo clippy -p gpui_apple --all-targets -- -D warnings
cargo test -p gpui_apple
```

Zed's `CONTRIBUTING.md` asks for a discussion before feature code, a signed CLA, and a human
author who understands the change and writes the PR description themself; it doesn't accept pull
requests from autonomous agents. So the pull request is the owner's to open, from their fork;
`PR-DRAFT.md` is a starting point for the description. When it's open, link it from #711. If
upstream takes it, `vendor/gpui-pre-apple` moves back toward upstream and keeps only #391's
exact gradient mode and the two planted twins.
