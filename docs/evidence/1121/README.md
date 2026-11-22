# Evidence for #1121 (T8): the workspace on Linux aarch64

Runs of 2026-11-22. The Spark is Linux aarch64 (20 cores, umask 002, ext4); the Mac is a Mac18,1 at a load of 56 to
100. Paths are cut to `<clone>`, `<checkout>` and `<home>`. On the Spark cargo ran with `-j 4`, no sccache
(`RUSTC_WRAPPER=`) and no debug info (`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`), for the disk.

| File | Commit | What ran |
|---|---|---|
| `spark-build-654c560c.txt` | main `654c560c` | `cargo build --workspace --locked --keep-going` on the Spark |
| `spark-test-654c560c.txt` | main `654c560c` | `cargo test --workspace --locked --no-fail-fast --exclude deep-player` on the Spark |
| `spark-suite-b7bf13b7.txt` | branch `b7bf13b7` | `tests/acceptance/1121/` on the Spark, file by file |
| `mac-suite-b7bf13b7.txt` | branch `b7bf13b7` | `tests/acceptance/1121/` on the Mac |
| `spark-twin-ac1-2d36d5d2.txt` | branch `2d36d5d2` | deep-app built on the Spark as it is and with the twin `mac-only-dependency`; deep-app's `hub_client` test with the CLI built |

The branch's Rust and TypeScript sources are main's at `654c560c`; it changes `scripts/lanes.mjs` and
`scripts/wait-ceilings.json` and adds the suite. `2d36d5d2` is an earlier head of this work, with the same Rust sources
and suite.

## What they show

- **Build.** 53 of 54 workspace crates build on the Spark. `deep-player` doesn't, on any native host: `secure_u64` in
  `crates/deep-player/src/net.rs` names `js_sys` and `wasm_bindgen`, which its manifest has for wasm32 only. That is
  #3100, open. deep-app and the five crates the issue names build.
- **The planted macOS-only dependency.** With the twin's `show.rs`, deep-app stops building on the Spark
  (`cannot find module or crate objc2`, exit 101); without it, it builds (exit 0).
- **cargo test.** The lane's command, `cargo test --workspace --locked --no-fail-fast`, compiles nowhere while
  `deep-player` doesn't, so it runs no test (`spark-suite`, AC2). With `--exclude deep-player`: 1,811 tests pass and 36
  targets fail (below).
- **The reference list.** On the Mac the lane's record holds `list`. On the Spark a run handed the Mac's record lists
  the six absent tests and reads `INCONCLUSIVE unit (platform)`; with no record it is never PASS.
- **The spool.** deep-hook refuses a symlinked spool file and a symlinked spool folder on the Spark and on the Mac.
- **lsof.** env-local's port kind finds a free port on the Spark through `/usr/bin/lsof`.

The planted wrong programs `x86-nofollow` and `sbin-lsof` are shown failing on the Spark, and `x86-nofollow` on the
Mac, in `tests/acceptance/1121/BASE-FAILURE.txt`, by the blind job on the base, whose sources these are.

## The 36 targets that fail on the Spark (`spark-test-654c560c.txt`)

18 are in #3100's list of what fails on the Mac too: deep-app `acceptance_1141`, `acceptance_1141_memory`,
`acceptance_34`; deep-canvas `--lib`; deep-motion `acceptance_1468`; deep-replica `acceptance_1425`,
`acceptance_1454_panel_redraft`, `acceptance_326_panels`, `acceptance_326_panels_redraft`, `acceptance_326_surfaces`,
`acceptance_327_card`, `acceptance_883`, `acceptance_992_app`, `acceptance_994_window`, `headless`; deep-show's own
tests, `recipe_frames` and `render_back_pipeline`.

18 fail on the Spark only:

| Cause | Targets | Whose |
|---|---|---|
| A custom harness prints `INCONCLUSIVE; … macOS only` and exits 1; the lane reads the target as FAIL | deep-app `spike_402`; deep-replica `acceptance_1425_ac3`, `acceptance_1620_planted_loader`, `acceptance_326_panels_planted`, `acceptance_326_panels_planted_redraft`, `acceptance_327_planted`, `acceptance_883_ac3_redraft`, `acceptance_994_sound`, `card_size` | #3100's third criterion (a stated state is read as that state) |
| A test panics `INCONCLUSIVE:` (the GPU is an NVIDIA GB10; no count of instructions retired) | deep-app `acceptance_995`; deep-scene3d-render `acceptance_2657_maps_lookup`, `acceptance_2657_sway`, `acceptance_3024_pixels` | #3100's third criterion |
| A test panics `BLOCKED:` | deep-hook `cli` (a reflink copy needs btrfs or XFS, and the Spark's disks are ext4); deep-scene3d-render `acceptance_3016_metal` and `acceptance_3016_views` (a same-machine hash) | open: #1121's second criterion says no BLOCKED |
| A plain FAIL: `expect("Metal reports what it holds")` | deep-scene3d-render `held_memory` (3 tests), and one test each of `acceptance_3016_metal` and `acceptance_3016_views` | open: a Linux fault of those tests |
| The CLI wasn't built in that clone | deep-app `hub_client` | none: it passes once `npm run build --workspaces` has run (`spark-twin-ac1`) |

## Not run

- The lane's whole `cargo test` on the Mac, and so the two machines' records of the repository on one commit: the
  command compiles on neither machine until #3100's first criterion holds.
- The proof lanes (guard, before, trace) on this branch.
