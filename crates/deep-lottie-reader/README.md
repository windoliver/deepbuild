# deep-lottie-reader

## What it is for

The Lottie export's fidelity reader (#162; design: Export: Lottie): a pinned reference Lottie renderer that reads a written Lottie file and renders the export frames asked for, as straight-alpha RGBA rows at the size asked for. deep-show runs it as its own process (`deep-show lottie-reader`), so the fidelity check reads the file with a tool its writer doesn't control.

## Where new code goes

- `src/lib.rs`: `render` and the process entry `serve`. The pinned engine's version is `ENGINE`, which the receipt names.

## What it may import

The pinned engine's binding at its exact version, built from its vendored source with the system's C++ compiler. No workspace crate: it knows nothing of documents or the writer.

## Deviations

- The engine snaps an axis-aligned rectangle's edges to whole pixels, so a rectangle moving by a fraction of a pixel lands up to half a pixel from where the 2D frames draw it. The reader draws each frame at twice the size (once for a frame over about 2 million pixels) and box-filters it down, which brings that to a quarter pixel; the receipt's `fidelity.reader` says so.
