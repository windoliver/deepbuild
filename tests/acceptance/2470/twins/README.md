# Twins for the 2470 tests

The fix regenerates files, so once it lands, a later merge base holds both criteria and no test here fails there. The
`before` lane then proves each test only on a planted wrong program its criterion names in `../twins.json`. A twin's
files replace whole files of a checkout where the criteria hold, and none may sit under the test paths or
`node_modules`. `crates/deep-contracts/src/generated.rs`, where the issue's own fault lives, is 3.6 MB at the base, so
each twin plants the same kind of fault in a file small enough to commit.

| Criterion | Twin | What it plants | Why it is the criterion's wrong program |
|---|---|---|---|
| `#2470.16c0da75` (`cargo check --locked -p deep-contracts` passes) | `defined-twice` | A new file, `crates/deep-contracts/src/bin/defined-twice.rs`: a binary of the crate that defines `RULE_340` and `RULE_341` twice. Cargo takes each file in `src/bin/` as a binary of the package by itself, so `cargo check -p deep-contracts` checks it | The issue's fault, two definitions of each name, moved to a file of nine lines. The check fails with the issue's error, `error[E0428]: the name RULE_340 is defined multiple times`, and the same for `RULE_341`. It adds a file and replaces none, so whatever main does to `src/lib.rs` or the generator, the crate fails for this reason alone. The generator's outputs are untouched, so AC2 holds on it |
| `#2470.296a591a` (a second generate leaves no diff) | `slot-digest-by-hand` | `packages/contracts/hub-slots.json` as the base holds it, with one character edited by hand: line 6, the `deep.registerCheck` row's `digest` for `check.kind@1`, ends in `a7c8` where `digests.json` holds `a7c7` | A generated output that isn't the generator's, which is what the merged `generated.rs` is, and the hand edit the issue's Scope rules out. The package's README lists the digests in `hub-slots.json` among the generated files, and the generator rewrites each row's digest from `digests.json`, so a generate leaves a diff in that file. The crate doesn't read it, so AC1 holds on it |

`slot-digest-by-hand` replaces the whole of `hub-slots.json`, so laid over a later main it brings back the base's rows.
The generate keeps a table's rows and rewrites only their digests, from `digests.json`, which freezes a digest once and
never drops one, so the diff stays that one line. Neither twin changes a test file. `../README.md` gives each test's failure on
its twin, laid over a checkout where both criteria hold.
