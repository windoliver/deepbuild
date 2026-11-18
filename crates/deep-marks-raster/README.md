# deep-marks-raster

## What it is for

The 2D writer layers' painter on Vello CPU (canvas primitives: Render-back, "2D snapshots render with Vello CPU"): a frame's draw list, with its pictures from the image service and its text from the bundled faces, at a size, on the scalar SIMD level so the same bytes come out everywhere. The app's headless renders and the web player (#172) both draw with it.

## Where new code goes

`src/lib.rs`: the draw list (`Drawn`), the painter (`Renderer`) and where its pictures come from (`Source`).

## What it may import

deep-canvas-marks, deep-canvas-motion, deep-marks-vello, deep-text, deep-images and vello_cpu, each through its crate root. No GPU crate, no GPUI, no app crate.

## Deviations

None.
