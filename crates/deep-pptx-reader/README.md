# deep-pptx-reader

## What it is for

The pptx export's fidelity reader (#732; design: Export): an Office Open XML reader that shares no code or library with the writer, and the pinned LibreOffice run headless, which draws each slide to a PNG. deep-show's export reads every deck back through it before the deck takes its name, so the fidelity check reads the file with tools its writer doesn't control.

## Where new code goes

- `src/lib.rs`: `read`, the package's entries (its own walk of the zip's central directory, deflated entries through zune-inflate) and each part through roxmltree, following the package's relationships from `presentation.xml` as any reader does: slides in order, their shapes in z-order with names, boxes, geometry, fills, outlines, runs and pictures, speaker notes, embedded fonts and every part's content type.
- `src/render.rs`: `find`, the pinned LibreOffice (`PINNED`) on PATH or at the macOS app's place, and `render`, which starts it headless with a throwaway profile under the caller's folder and drives it over a pipe with a small UNO script in LibreOffice's own Python: the deck loads hidden and read-only and each slide goes through LibreOffice's graphic export filter at the size asked for.

## What it may import

roxmltree and zune-inflate, each at its exact version. No workspace crate: it knows nothing of documents or the writer.

## Deviations

- LibreOffice is a system install (Homebrew's cask on macOS), not vendored; without the pinned version the export is BLOCKED, never delivered.
