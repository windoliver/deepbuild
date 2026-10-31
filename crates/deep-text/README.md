# deep-text

## What it is for

The canvas's one text shaper (#390): parley over HarfRust and skrifa on the bundled fonts only, the glyph atlas rasterized by Vello CPU at the scalar level, and the fit check; the shaper's UAX #14, #29 and #9 readings (#381); and one shaped-run cache per process, with long text shaped on the render worker (#856). deep-canvas-marks, deep-canvas-scene3d, deep-text-gpui and the render binaries call it; the `deep-text` binary is its JSON-lines proof surface.

## Where new code goes

- `src/shape.rs`: shaping and the fit check. `src/atlas.rs`: atlas pages. `src/fonts.rs`: the bundled faces by role. `src/unicode.rs`: breaks, graphemes and bidi. `src/cache.rs` and `src/worker.rs`: the shaped-run cache and off-thread shaping.
- `src/main.rs`: the CLI's subcommands (`fit`, `shape`, `fonts`, `breaks`, `graphemes`, `bidi`).
- A new font goes in `fonts/` with its license file, and in `src/fonts.rs`.
- Tests: `tests/shape.rs` for the shaper and atlas; the CLI's behavior is proven in tests/acceptance/390, 381 and 856.
- Drawing through GPUI belongs in deep-text-gpui, never here.

## What it may import

The bottom of the canvas text stack: no workspace crate, no GPUI, and no system font source (parley's `system` feature stays off, so CoreText, fontconfig and DirectWrite are never reached). It is a normal dependency of deep-canvas-marks and deep-canvas-scene3d, so it is in the canvas lint's scope: every third-party crate it reaches needs an audited entry in lint/canvas/crates.json.

## Deviations

- `fonts`: Inter and JetBrains Mono binaries checked in, the only fonts the canvas's text uses on every platform, each with its SIL Open Font License file beside it.
- `Cargo.toml`: fearless_simd is listed only for its `force_support_fallback` feature, so the atlas rasterizes at the scalar level and every platform computes the same alpha; icu_segmenter's `unstable` feature gives UAX #14 at Unicode 17.0, which parley's stable segmenter lacks.
- `src/cache.rs`: the `Planted` caches are #856's wrong programs for the acceptance suite, each set only by the binary's `--planted`.
