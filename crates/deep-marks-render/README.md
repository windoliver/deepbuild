# deep-marks-render

## What it is for

The binary `deep-canvas-render`, the proof surface for the line's 2D marks (#391): a document's view drawn headless with GPUI's offscreen Metal renderer only when the frame clock arms a frame, with path, text and writer-layer caches. #392 adds `check`, `look`, status marks and stale bound values; #373 adds `raster` and `geometry` on every platform, R2's 2D marks drawn by Vello CPU. The acceptance suites in tests/acceptance/391, 392, 373 and 381 drive it.

## Where new code goes

- `src/main.rs`: subcommands, request parsing and the `planted` values.
- `src/macos.rs`: the GPUI view and its session caches (macOS only).
- `src/raster.rs`: `raster` and `geometry` through deep-marks-vello. `src/status.rs`: where status marks and the legend go, shared by both renderers. `src/asset.rs`: assets read from the content-addressed store by sha256.
- Tests: `tests/*.rs` drive the built binary; the GPUI ones are macOS only.
- Vello drawing both CPU renderers share goes in deep-marks-vello; mark logic in deep-canvas-marks.

## What it may import

A proof binary at the top of the 2D stack: the canvas crates, deep-marks-vello, deep-marks-gpui, deep-text, deep-text-gpui and deep-replica (its headless context), each by crate name. It draws canvas text (`canvas_text = true`), so scripts/text-lint.mjs holds it to the canvas's shaper, never GPUI's text system.

## Deviations

- `tests/no_alloc.rs`: the per-frame allocation count for deep-canvas-motion lives here, beside the frame loop that calls it, because a counting allocator needs `unsafe`, which the canvas crates' lint refuses.
