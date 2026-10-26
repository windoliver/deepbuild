# Unicode 17.0.0 conformance files

Unicode's own conformance test files for line breaking (UAX #14), bidi (UAX #9) and grapheme clusters (UAX #29),
at the Unicode version the canvas's one shaper takes its segmentation and bidi data from at base `d122341`
(issue #381, AC3; read by `tests/acceptance/381/unicode.test.ts`). Copied byte for byte from unicode.org on
2026-10-25; each file keeps Unicode's own header with its copyright line and terms of use.

| File | Source | SHA-256 |
|---|---|---|
| `LineBreakTest.txt` | <https://www.unicode.org/Public/17.0.0/ucd/auxiliary/LineBreakTest.txt> | `e69884e0dde6a8724873f885d68c52dc14518abf9ae4ca9e2283b8773db3b752` |
| `GraphemeBreakTest.txt` | <https://www.unicode.org/Public/17.0.0/ucd/auxiliary/GraphemeBreakTest.txt> | `e2d134d2c52919bace503ebb6a551c1855fe1a1faec18478c78fff254a1793ec` |
| `BidiCharacterTest.txt` | <https://www.unicode.org/Public/17.0.0/ucd/BidiCharacterTest.txt> | `a3e6e905ab5afbe318a96df5401d0372a04cd73ef139ab5e3cf0ae241c255488` |

Why 17.0.0: at the base, `deep-text` shapes with parley 0.12, whose `parley_engine` breaks lines and finds grapheme
clusters with `icu_segmenter` 2.3 (compiled data from `icu_segmenter_data` 2.3) and resolves bidi with its own
resolver over `icu_properties` 2.3 data (`icu_properties_data` 2.3); `parley_data` 0.12's composite trie is checked
against the same `icu_properties` 2.3. Both data crates say they were generated from ICU 78 (`release-78.1rc`) and
CLDR 48.2.1, which carry Unicode 17.0.0. The `LineBreakTest.txt` and `GraphemeBreakTest.txt` here are byte for byte
the files `icu_segmenter` 2.3 ships in `tests/testdata/` (same SHA-256). Cargo.lock pins all of these.

Don't edit these files. A newer pinned Unicode version gets its own `vendor/unicode-<version>/` folder.
