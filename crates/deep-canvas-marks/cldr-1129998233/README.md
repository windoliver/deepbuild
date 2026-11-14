# CLDR plural rules at commit 1129998233

CLDR's cardinal plural rules, the one file the text module's keyed copy picks a plural form by (issue #538; Text
`text@1`: keyed copy, "CLDR's cardinal rules at a pinned release"). `crates/deep-canvas-marks/src/plural.rs` reads it
with `include_str!`, so every build picks the same form for the same number on every machine, whatever the platform's
own locale data says.

| File | Source | SHA-256 |
|---|---|---|
| `plurals.xml` (upstream `common/supplemental/plurals.xml`) | <https://github.com/unicode-org/cldr/blob/11299982335beb974c1c63c45265184e759c0f41/common/supplemental/plurals.xml> | `d701d8b461afd2ba5eb21f9c1d645c8a661de225596afcf0f492ee36c69d727d` |

Copied byte for byte on 2026-11-12. The file keeps Unicode's own header with its copyright line, its terms of use
(<https://www.unicode.org/copyright.html>) and its SPDX identifier, Unicode-3.0. The commit is the one the issue's
oracle page pins, so the oracle lane's samples and the module read the same rules.

It sits inside the crate because the canvas lint reads an `include_str!` only from a file in it. Don't edit this
file. A newer pinned release gets its own `cldr-<commit>/` folder here, and the module's `include_str!` moves to it in
the same change.
