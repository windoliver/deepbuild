# deep-text-gpui

## What it is for

The canvas's text where GPUI draws a 2D writer layer (#390): a `Label` is shaped once by deep-text, its glyphs rasterized into the canvas's atlas, and drawn through the GPUI patch's tinted mask sprite. Nothing here calls GPUI's text system, so a label's pixels don't depend on the user's font-smoothing setting. deep-app, deep-canvas-render (crates/deep-marks-render), deep-text-render and deep-show call it.

## Where new code goes

- `src/lib.rs`: labels, their atlas pages as GPUI sees them, and painting them.
- Shaping, fonts and the atlas itself go in deep-text.
- No tests here: deep-text-render's `tests/frame.rs` and tests/acceptance/390 read what it draws.

## What it may import

A thin GPUI adapter over deep-text: deep-text and gpui-kit (at its pinned git revision), each through its crate root. Its name puts it in scripts/text-lint.mjs's scope, so it never calls GPUI's text system (`text_system`, `shape_line`, `StyledText` and the rest that lint names).

## Deviations

None.
