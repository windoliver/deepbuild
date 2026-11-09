# Acceptance tests for #1480: a new glyph uploads its rectangle, not a 1 MB page

Design: docs/canvas-primitives.md, "Text `text@1`" (Semantics: "A new glyph uploads its own rectangle into its atlas page; a page's generation changes only when the page restarts, and each window tracks how far it has read.").

Run: `npx vitest run --root tests/acceptance/1480 --no-file-parallelism` on the reference Mac (macOS only; off macOS the tests report INCONCLUSIVE). The tests drive `deep-text-render render` as tests/acceptance/390 does.

| Criterion | Test |
| --- | --- |
| 1. One new 26 px glyph on a warm page uploads at most (w+2) x (h+2) bytes; a planted whole-page upload fails naming 1,048,576 | `AC1` (both tests) |
| 2. Over 1,000 new glyphs on one page in a frame, bytes never exceed one page (and the scope's 32-rect ring: 33 rects take one whole-page upload) | `AC2` (both tests) |
| 3. A frame that adds a glyph clones no page, by the counting allocator (and the counter sees the planted clone) | `AC3` (both tests) |
| 4. Pixels byte-equal to the whole-page path over a typing journey on two windows; a second frame of an updated glyph never shows the first (equal to a cold render) | `AC4` (both tests) |

## Surfaces these tests read

The base binary has none of these; the implementation supplies exactly these names. Parsing stays as today (`bad_input` for a non-finite number, a side at or below zero, etc.).

Request (new, an alternative to the single-frame `out`/`labels` form, which stays):

- `frames: [{labels: [...], out?: [path]}]`: frames drawn in order, each exactly once per window (no second warm-up frame), all windows drawing every frame, into windows that open at scale 1; labels as today; `out` is one PNG path per window, in window order (omit it to skip capture).
- `windows: n` (integer >= 1, default 1): the number of windows that draw every frame; each has its own sprite atlas and its own read position.
- `upload: "rect" | "whole_page"` (default `"rect"`): `"whole_page"` is the planted twin, the pre-#1480 path that hands GPUI a fresh copy of the whole page per changed page per window. Only the render binary offers it.

Report (new, beside `ok`):

- `frames[i].new_glyphs: [{w, h}]`: the glyphs rasterized into the atlas during frame i, each as its bitmap size in pixels without padding.
- `frames[i].windows[k].upload_bytes`: bytes of atlas pixels frame i handed to window k's GPUI atlas (a rect counts its own bytes including padding; a whole page counts 1,048,576).
- `frames[i].windows[k].upload_rects: [{page, x, y, w, h}]`: the rects uploaded (a whole-page upload is not listed here).
- `frames[i].windows[k].upload_whole_pages`: how many whole-page uploads frame i made in window k (a reader that fell behind, or more than 32 rects on a page).
- `frames[i].windows[k].page_allocs`: allocations of at least 1,048,576 bytes made while frame i painted window k, read from a counting global allocator in the render binary.
- `frames[i].windows[k].pages: [page]`: the distinct atlas pages frame i drew from in window k.
