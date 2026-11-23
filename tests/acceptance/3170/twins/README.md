# Twins for the 3170 tests

Each is the base's file with one fault planted, and replaces the one file its path names, and no test or helper. A
copy goes stale as that file changes, and still holds its fault. `../twins.json` names them by criterion.

| Criterion | Twin | Replaces | The planted fault | Fails on |
|---|---|---|---|---|
| `#3170.f6002c7f` (AC1) | `lane-names-var-tmp` | `scripts/lanes.mjs` | runLanes gives every command it runs `DEEP_TEST_COW_DIR=/var/tmp`, the test's default, so a lane's cargo test is named a folder on the Spark's ext4, which makes no reflink copy, whatever the machine sets | The Spark, once it has the folder |
| `#3170.4db366cf` (AC2) | `clone-drops-mode` | `crates/deep-hook/src/main.rs` | On Linux `clone_one` no longer gives a reflinked file its source's permissions, so `run.sh` comes out 0644 or 0664, not 0755. Only the copy-on-write half of the cli test sees it, so the cli target fails only where that half runs | The Spark, once it has the folder |
| `#3170.618b6b1f` (AC3) | `blocked-reads-pass` | `crates/deep-hook/tests/cli.rs` | The copy-on-write test, given a folder that can't reflink, prints a note and returns, so it passes unrun where it read BLOCKED | Linux, the Spark among them |

The base can't yet tell the first two twins from the base: there AC1 and AC2 fail already, because the Spark has no
reflink folder and nothing names one. Each twin was run on the Spark at the base anyway (`../BASE-FAILURE.txt`); it
fails there, `lane-names-var-tmp` at a later assertion than the base (the folder is named, and can't reflink), and
`clone-drops-mode` for the base's reason. Whoever first gives the Spark its folder shows each failing for its own
fault.

`lane-names-var-tmp` assumes what AC3's test assumes: a variable in the process's environment wins over a cargo config's
`[env]` entry without `force`. A machine setting made with `force = true` would win over the plant too.

To run one: in a throwaway copy of the base with this suite in it, copy the twin's file over the file it replaces and
run the criterion's test file, then put the file back.
