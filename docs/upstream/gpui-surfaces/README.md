# The GPUI surface patch, offered upstream (#711)

Part of windoliver/deepbuild#711, which follows #377. `vendor/gpui-pre-apple` is a snapshot of
Zed's `gpui_apple` crate at zed@`93d745668805029476e6d7fbb19652116fed51de` (its `Cargo.toml`,
`[package.metadata.gpui-pre]`), carrying DeepBuild's patches. This folder holds the two of #377's
patches that aren't DeepBuild's own, as a patch series against that upstream commit, each with a
test of its own in upstream's style, and the record of how the series was checked. Opening the
pull request in zed-industries/zed is the owner's call, so nothing here is published.

## What's in the series

| Patch | Upstream files | What it does |
| --- | --- | --- |
| `0001-gpui-Composite-32BGRA-paint_surface-pixel-buffers-pr.patch` | `crates/gpui_apple/src/metal_renderer.rs`, `crates/gpui_apple/src/shaders.metal`, `crates/gpui/src/window.rs` (doc comment only) | `paint_surface` accepts `kCVPixelFormatType_32BGRA` pixel buffers, drawn through a second surface pipeline (`bgra_surfaces`, fragment `bgra_surface_fragment`) that blends with source factor one, as premultiplied color needs. Test `render_bgra_surface_premultiplied`. |
| `0002-gpui-Report-the-surfaces-each-frame-samples-and-when.patch` | `crates/gpui_apple/src/metal_renderer.rs` | `metal_renderer::surface_reports`: one hook that gets `Committed { buffer, surfaces }` for every frame command buffer that samples a surface, and `Completed { buffer, gpu_ns }` from its completed handler. Test `report_the_surfaces_a_frame_samples`. |

`COVER.md` is the pull request's title and body. `checks/` holds the run outputs named below.

## What's left out, and why

Every hunk marked `DeepBuild patch` in `vendor/gpui-pre-apple/src/metal_renderer.rs` and
`shaders.metal` was sorted as follows:

- **Offered (#377):** the `kCVPixelFormatType_32BGRA` import, the premultiplied BGRA pipeline and
  its fragment shader, the BGRA branch of `draw_surfaces` and `draw_bgra_surface`, the
  `sampled_surfaces` field, the `Committed` and `Completed` reports in `render_frame`, and the hook
  module (vendored as `gpu_surfaces`; upstream as `surface_reports`, with `Planted` removed).
- **Left out, planted twins (#377):** `Planted::DividesAlpha` with `surfaces_bgra_divided` and
  `surface_bgra_divided_fragment`, and `Planted::AfterScene` with the `surfaces_last` pass in
  `draw_primitives_to_texture`, plus `gpu_surfaces::plant` and `planted()`. They exist only so
  `tests/acceptance/377/` can prove the right compositor by catching the wrong ones; upstream has
  no use for a knob that draws wrong on purpose. The upstream tests reject the same wrong programs
  as mutants instead (see Checks).
- **Left out, not this issue (#391):** `gpu_ledger` (a process-wide count of frame command buffers
  and their GPU time) and the sRGB and Oklab exact-gradient shader functions. The `Completed`
  event keeps `gpu_ns`, read from the command buffer's `GPUStartTime` and `GPUEndTime` in the
  handler itself, so the upstream API matches what `crates/deep-app/src/gpu_view.rs` consumes.

Two small departures from the vendored copy, both deliberate: upstream reports every surface a
frame samples, YCbCr ones too (the vendored copy notes only BGRA; the app paints only BGRA, so
its behavior is the same), and the pipeline and shader are named `bgra_surfaces` /
`bgra_surface_fragment` after upstream's `surfaces` / `surface_fragment`.

## How it was checked (October 25, 2026, Apple silicon, rustc 1.98.1 per zed's `rust-toolchain.toml`)

In a shallow clone of zed-industries/zed at `93d7456`, with the two commits applied:

- `cargo test -p gpui_apple --lib metal_renderer`: 3 passed (`render_core_video_surface`,
  upstream's own, and the two new ones). `checks/cargo-test-gpui_apple-metal_renderer.txt`.
- `cargo clippy -p gpui_apple --tests`: no warnings beyond cargo's own cache note (zed's workspace
  lints apply).
- `rustfmt --edition 2024 --check` on the touched Rust files: clean.
- Each test fails on the wrong programs it exists to reject (AGENTS.md, Proof):
  - patch 1, `checks/mutants-patch1.txt`: a straight-alpha blend for the BGRA pipeline (the test
    sees red 32 where 64 is expected); the `divides_alpha` twin, ported as a mutant (green 0 where
    200 is expected); the base's `draw_surfaces` with no BGRA branch (the format assertion fires
    inside the encoder and the test process aborts on Metal's `endEncoding` assertion).
  - patch 2, `checks/mutants-patch2.txt`: a completed handler that reports nothing (no
    `Completed` within 5 s); a BGRA draw that doesn't note its pixel buffer (no `Committed`).
- The exported patches re-apply with `git am` onto a pristine checkout of `93d7456`, give a tree
  identical to the working commits', and the three tests pass again:
  `checks/git-am-then-test.txt`.
- `tests/acceptance/377/` on the app's own build (the vendored copy, untouched by this change):
  run 1 (whole suite): 29 passed, 7 skipped as INCONCLUSIVE by the budgets gate (Low Power Mode was on), 1 failed, the handoff conformance run's `budget` timing while this task's cargo builds shared the machine; run 2 (handoff file alone, machine quiet): 9 of 9 passed. `checks/acceptance-377.txt` and the two run logs beside it.

## Applying it

```sh
git clone https://github.com/zed-industries/zed.git && cd zed
git checkout -b gpui-bgra-surfaces 93d745668805029476e6d7fbb19652116fed51de
git am /path/to/deepbuild/docs/upstream/gpui-surfaces/000*.patch
cargo test -p gpui_apple --lib metal_renderer
git rebase origin/main        # the series is small; conflicts, if any, are in draw_surfaces
```

The commits carry the committer identity of the DeepBuild checkout they were made in; pass
`--reset-author` to `git am` to sign them as yourself. The files keep upstream's Apache-2.0 notice
exactly as the vendored crate has it (`vendor/gpui-pre-apple/LICENSE-APACHE`, Zed's own), since
the code goes back to the project it came from.

## What the owner does by hand

1. Fork zed-industries/zed (or use an existing fork), apply the series as above, rebase onto
   `main`, and rerun the test there.
2. Push the branch and open the pull request with `COVER.md`'s title and body; Zed's template asks
   for a release-notes line, which is `N/A`.
3. Link the pull request on #711. Its first criterion is proven when the PR carries both parts
   with their tests; the second ("#377's suite still passes on whichever GPUI the app builds
   with") holds today on the vendored copy and is re-run if the vendored copy moves.
4. If upstream takes it: bump `vendor/gpui-pre-apple` toward a snapshot that contains it, map
   `gpu_surfaces` to `surface_reports` in `crates/deep-app/src/gpu_view.rs`, and keep only the
   planted twins (for `tests/acceptance/377/`) and the #391 patches as DeepBuild's own. That is
   #711's third scope line and its own change.
