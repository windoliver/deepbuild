# The GPUI patch offered upstream (#711)

`0001-gpui_apple-premultiplied-BGRA-surfaces-and-per-frame-surface-reports.patch` is the part of
this crate's `DeepBuild patch (windoliver/deepbuild#377)` changes that isn't DeepBuild's own,
rebased onto zed-industries/zed `main` at `08cbb88` (October 25, 2026) as one commit, with a test
of its own. `0002-...patch` is the review-round-4 follow-up: a replaced hook dropped outside the
lock (with its test), the hook test lock timing out instead of hanging a failed run, the `Hook`
doc on panics, `gpu_surfaces` re-exported from `gpui_macos::metal_renderer`, and
`parking_lot::RwLock`.

What it carries:

- `paint_surface` accepts a `kCVPixelFormatType_32BGRA` pixel buffer beside the 4:2:0 YCbCr video
  frames it took before: one format branch in `draw_surfaces`, one pipeline (source factor one,
  destination factor one minus source alpha, as path sprites blend) and the 7-line
  `surface_bgra_fragment` shader, so a premultiplied slot keeps its color where alpha is zero.
- `metal_renderer::gpu_surfaces`: each frame that samples a BGRA surface reports the buffers it
  samples once its command buffer is encoded (`Event::Encoded { frame, surfaces }`) and its
  completion with the GPU time it took (`Event::Completed { frame, gpu_ns }`), through one
  `set_hook`. This is this crate's `gpu_surfaces` module without `Planted`. The vendored copy
  was aligned with it on 2026-10-25: the hook is called outside the lock (so a hook may replace
  itself from Metal's completion thread, `surface_hook_may_replace_itself` in this crate's
  `metal_renderer::tests`), the report and its frame number are skipped when no hook is
  installed, and the events are named `Encoded { frame }` (the report precedes the commit) and
  `Completed { frame }`; deep-app's `gpu_view.rs` is the one consumer.
- The BGRA shader samples linear, as the YCbCr one does; this crate's samples nearest. At 1:1 on
  snapped bounds both read texel for texel, which is what #377's handoff fixture checks.
- `render_bgra_surface_premultiplied`, in `metal_renderer::tests`: a half-alpha red and an
  alpha-zero green BGRA surface beside a gray YCbCr surface in one batch, rendered headless;
  pixels and both reports checked. A straight-alpha blend for the BGRA pipeline fails it at the
  alpha-zero half; a dropped `sampled_surfaces.push` fails it at the report count; a dropped
  YCbCr pipeline bind after a BGRA surface fails it at the gray half. `surface_hook_may_replace_itself`
  fails (times out) when the hook is called under the lock. The two tests that install a hook take
  one test-only mutex, since the hook is process-wide and `cargo test` runs tests in parallel.
- Reviewed in four rounds by fresh reviewers (this folder's PR). Round 1 found the hook called
  under the lock, the report named for a commit it precedes and the pipeline switch untested; round
  2 found the hook tests racing each other; round 3 found nothing; round 4 (two reviewers, on the
  rebased branch) found the old hook dropped under the write lock, a failed hook test hanging the
  test binary, and the module unreachable from gpui without a direct `gpui_apple` dependency, all
  fixed in `0002`. Round 4 also raised design questions only zed can settle: a process-global
  single-slot hook rather than per-renderer state, surfaces identified by `CVPixelBuffer` address
  as bare `u64` rather than a newtype or `IOSurfaceID`, and whether to split the BGRA format
  support from the reports. The PR description already offers the per-renderer change. Each fix is
  in the patch with a check that fails without it.

What it leaves out, on purpose: the planted twins `DividesAlpha` and `AfterScene` (#377's
acceptance tests only), `gpu_ledger` and `ColorSpace::OklabExact` (#391, a separate offer), and
`paint_mask_sprite` (#390, in `vendor/gpui-pre`).

Reproduce the proof on a Mac:

```sh
git clone --depth 1 https://github.com/zed-industries/zed && cd zed
git fetch --depth 1 origin 08cbb88 && git checkout FETCH_HEAD
git am ../deepbuild/vendor/gpui-pre-apple/upstream/000*.patch
cargo fmt -p gpui_apple --check
cargo clippy -p gpui_apple --all-targets -- -D warnings
cargo test -p gpui_apple
```

Zed's `CONTRIBUTING.md` asks for a discussion before feature code, a signed CLA, and a human
author who understands the change and writes the PR description themself; it doesn't accept pull
requests from autonomous agents. So the pull request is the owner's to open, from their fork;
The pull request is open and ready for review from the owner's fork, with the CLA signed:
https://github.com/zed-industries/zed/pull/66114 (`JingW6/zed`, branch `gpui-bgra-surfaces` at
`a639e72d`, these two commits on `08cbb88`, zed main of 2026-10-25; `cargo fmt --check`, clippy
on `gpui_apple` and `gpui_macos`, and the 14 `gpui_apple` tests pass there), linked from #711;
`PR-DESCRIPTION.md` is its description as posted. GitHub reports it MERGEABLE; its merge state is
BLOCKED only for the maintainer review zed requires, and its test, bundling and nix workflows wait
on a maintainer approving a first-time contributor's runs. If upstream takes it, `vendor/gpui-pre-apple` moves back toward upstream and keeps only
#391's exact gradient mode and the two planted twins.

How it was opened, for a redo on a new base (sign the CLA at https://zed.dev/cla first):

```sh
gh repo fork zed-industries/zed --clone=false            # once
git clone --depth 1 https://github.com/zed-industries/zed && cd zed
git remote add fork https://github.com/<you>/zed.git
git fetch --depth 1 origin 08cbb88
git checkout -b gpui-bgra-surfaces FETCH_HEAD
git am ../deepbuild/vendor/gpui-pre-apple/upstream/000*.patch   # keep or amend the author line
cargo test -p gpui_apple                                  # 14 pass; attach the output to the PR
git push -u fork gpui-bgra-surfaces
gh pr create --repo zed-industries/zed --base main --head <you>:gpui-bgra-surfaces \
  --title "gpui_apple: premultiplied BGRA surfaces and per-frame surface reports" \
  --body-file ../deepbuild/vendor/gpui-pre-apple/upstream/PR-DESCRIPTION.md   # in your words
```

Then on windoliver/deepbuild#711: paste the PR link under criterion 1.
