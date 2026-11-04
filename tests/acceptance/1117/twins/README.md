# Twins for the 1117 tests

The base has no `scripts/bays.mjs`, so every test already fails there at its assertion (`../BASE-FAILURE.txt`).
The issue's Proof also asks for three planted wrong programs shown failing, and `../twins.json` names them. No
implementation existed when these tests were drafted, so their folders aren't here yet: each twin is to be
`twins/<name>/scripts/bays.mjs`, the merged implementation's `bays.mjs` with exactly one rule broken as below, and
nothing else changed (same CLI, same record lines). A twin folder holds only that file. Until a folder exists, the
before lane never needs it: every tagged test here fails on the merge base at its assertion first.

Each was checked against a throwaway planted `bays.mjs` (`../BASE-FAILURE.txt`), and failed the tests listed.

| Criterion | Twin | The one rule it breaks | Tests it fails |
|---|---|---|---|
| `#1117.b2c7cfc4` (AC2) and `#1117.af1d4c7e` (AC3) | `blob-id-compare` | Replace in place decides which files to write by comparing blob IDs (the ID it last wrote at a path, or the previous recipe's, against the new tree's), never the bytes on disk. A file the previous run's command rewrote is kept | `replace.test.mjs`, both tests: the bay's bytes differ from the tree |
| `#1117.e77894d3` (AC1) and `#1117.029c15e6` (AC7) | `relocated-target` | Each run gets a workspace at a new path (for example `<pair>/run-<random>`), the warm `target/` moved in before the command and back after | `warm.test.mjs` AC1 (another bay path; or, if the record still names the fixed path, the command runs elsewhere), `target-dir.test.mjs` (nothing written to the fixed bay's `target/`) |
| `#1117.4ebbfb21` (AC4) | `trusted-seal` | At claim, a seal that exists is taken as intact: its stat listing (path, size, mtime_ns, inode) is never compared with the bay's `target/` and `node_modules/` | `seal.test.mjs`, both tests: the record says `"seal":"intact"` |

Two more wrong programs were checked with the planted program, though the issue doesn't name them: writing a changed
file with an old mtime (`backdate`, as `git archive | tar -x` does) fails both `replace.test.mjs` tests, and
ignoring a pair held by an ancestor fails the inside test in `proofs.test.mjs`.
