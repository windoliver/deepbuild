# #2360: the size ratchet and the format check, before and after

The issue's proof is the two commands' own runs.

- `size-ratchet-base-b6317234f.txt`: `node scripts/size-ratchet.mjs` at the base, b6317234f.
  It has 81 findings: 46 outside `tests/acceptance/` (the issue's Nov 22 list; `scripts/lanes.mjs` and `crates/deep-show/src/sandbox.rs` had grown a few lines since) and 35 inside it.
- `size-ratchet-head.txt`: the same command on this branch, with main c52dc3e73 merged.
  It has 40 findings, every one under `tests/acceptance/`, which #3139 holds (main has added blind suites since the base).
  None is outside it. That includes two files main pushed over 1,500 lines after the base: `crates/deep-physics-rapier/src/runner.rs` (#2035, 1,501) and `crates/deep-gpu-layer/src/main.rs` (#2149's format, 1,504).
- `fmt-unformatted-base-b6317234f.txt`: the 36 files `cargo fmt --all -- --check -l` named at the base.
- `fmt-unformatted-head.txt`: the same command on this branch. It names no file and exits 0, since #2149's format has landed.
  This branch formats every Rust file it changes or adds.
