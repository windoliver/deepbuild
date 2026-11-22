# #2360: the size ratchet and the format check, before and after

The issue's proof is the two commands' own runs.

- `size-ratchet-base-b6317234f.txt`: `node scripts/size-ratchet.mjs` at the base, b6317234f.
  It has 81 findings: 46 outside `tests/acceptance/` (the issue's Nov 22 list; `scripts/lanes.mjs` and `crates/deep-show/src/sandbox.rs` had grown a few lines since) and 35 inside it.
- `size-ratchet-head.txt`: the same command on this branch after merging main (5fcfb690b).
  It has 35 findings, every one under `tests/acceptance/`, which #3139 holds.
  None is outside it, including `crates/deep-physics-rapier/src/runner.rs`, which main's #2035 grew to 1,501 lines after the base.
- `fmt-unformatted-base-b6317234f.txt` and `fmt-unformatted-head.txt`: the files `cargo fmt --all -- --check -l` names, 36 at the base and 28 on the branch.
  The 8 that dropped off are files this branch touched, now formatted.
  None of the 82 Rust files this branch changes or adds is still named, and no file is named that wasn't at the base.
  `cargo fmt --check` exits 0 once #2149 formats the remaining 28.
