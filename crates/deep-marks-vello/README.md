# deep-marks-vello

## What it is for

The 2D marks module's draw list in Vello CPU terms (#373): paints with each OKLab ramp as sRGB stops, outlines flattened finer than Vello's own 0.25 px, and the scopes a mark draws inside (scissors, alpha and luminance masks, group opacity), at the scalar SIMD level on one thread so every platform draws the same bytes. Both CPU renderers share it: deep-canvas-render's `raster` (crates/deep-marks-render) and deep-show's render-back snapshots. It draws no text.

## Where new code goes

- `src/lib.rs`: a new paint, scope or outline rule in Vello terms, so both renderers draw it the same way.
- Tests: the `#[cfg(test)]` module at the end of `src/lib.rs`.
- What a mark is and how it tessellates belongs in deep-canvas-marks; text in deep-text.

## What it may import

A CPU render layer: deep-canvas, deep-canvas-marks and vello_cpu only, each through its crate root. No GPU crate, no GPUI and no app crate.

## Deviations

None.
