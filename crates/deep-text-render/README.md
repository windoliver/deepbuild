# deep-text-render

## What it is for

`deep-text-render render`, the proof surface for canvas text (#390): JSON lines in, each a card and its labels drawn headless with GPUI's offscreen Metal renderer at scale 1, every label from the canvas's atlas through the GPUI patch's tinted mask sprite, written as a PNG with a report of what was drawn. Off macOS every line answers `unsupported_platform`. tests/acceptance/390 drives it.

## Where new code goes

- `src/main.rs`: the whole binary, request parsing and the macOS renderer.
- Tests: `tests/frame.rs` (macOS only) drives the built binary.
- Label drawing goes in deep-text-gpui and shaping in deep-text; this crate only renders and reports.

## What it may import

A proof binary at the top of the text stack: deep-text, deep-text-gpui, deep-replica (for its headless GPUI context) and gpui-kit with `test-support`, each by crate name. Its name puts it in scripts/text-lint.mjs's scope: canvas text never goes through GPUI's text system, which serves only the replica's chrome.

## Deviations

None.
