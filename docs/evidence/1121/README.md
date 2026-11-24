# Evidence for #1121 (T8): the workspace on Linux aarch64

Two rounds, 2026-11-22. The Spark is Linux aarch64 (20 cores, an NVIDIA GB10 GPU, umask 002, ext4); the Mac is a
Mac18,1. Paths are cut to `<clone>`, `<checkout>`, `<run>`, `<tmp>` and `<home>`. On the Spark cargo ran with `-j 4`, no
sccache (`RUSTC_WRAPPER=`) and no debug info (`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`), for the disk.

## Round 2: branch `0c73a8a4`, main `c4337ea59` merged in (deep-player builds natively since PR #3121)

| File | What ran |
|---|---|
| `spark-build-0c73a8a4.txt` | `cargo build --workspace --locked --keep-going` on the Spark: exit 0 |
| `spark-test-0c73a8a4.txt` | `cargo test --workspace --locked --no-fail-fast` on the Spark: exit 101 |
| `spark-suite-0c73a8a4.txt` | `tests/acceptance/1121/` on the Spark, file by file |
| `mac-suite-0c73a8a4.txt` | `tests/acceptance/1121/` on the Mac |
| `mac-lane-0c73a8a4.txt` | The unit lane's cargo command through `runLanes` on the Mac, in a fresh clone |
| `spark-lane-0c73a8a4.txt` | The same on the Spark, with the Mac's record in its lanes folder (cargo's own output cut) |

The two lane runs are the lane's code and its cargo command, `cargo test --workspace --locked --no-fail-fast`, on the
repository itself; they are not the whole unit lane, whose vitest and node commands didn't run.

### What they show

- **Build (criterion 1).** Every workspace crate builds on the Spark; the suite's build test passes there. The planted
  macOS-only dependency was shown failing there in round 1 (`spark-twin-ac1-2d36d5d2.txt`).
- **cargo test (criterion 2).** Still fails. Raw: 1,819 tests pass, 30 fail, 36 targets fail. The suite's test reads 49
  FAIL or BLOCKED among 1,868 results. The list by owner is below.
- **The reference list (criterion 3).** The Mac's record holds `list`: 156 targets, 2,045 tests. The Spark's record,
  made with the Mac's in its lanes folder, carries it as `reference` and holds 188 rows `INCONCLUSIVE … absent on this
  platform (linux-arm64): in the Mac's reference list`, in 38 targets. Its lane reads `FAIL unit`, not `INCONCLUSIVE
  unit (platform)`, because of the 49 failures above; neither machine's lane is PASS. The suite's three tests of this
  criterion pass, one on the Mac and two on the Spark, on a fixture workspace.
- **The spool (criterion 4)** and **lsof (criterion 5).** Pass on the Spark; the spool test passes on the Mac too.

### The 36 targets that fail on the Spark, by owner

Nothing here is #1121's own code. No test was edited.

| Owner | Targets (tests) | Cause on the Spark |
|---|---|---|
| #3100, its failures (they fail on the Mac too) | deep-app `acceptance_1141` › ac2; deep-canvas `--lib` › `document::packs::tests::the_pack_schema_holds_the_checks_keys_and_lists`; deep-show `--bin deep-show` › `kinds::tests::every_structured_field_prints_forms_that_take_its_own_values`; deep-show `recipe_frames`; deep-show `render_back_pipeline` | Plain failures of main |
| #3100, its third criterion (a panic `INCONCLUSIVE:` or `BLOCKED:` read as FAIL) | deep-app `acceptance_1141` › ac3, `acceptance_1141_memory` › ac1, `acceptance_995` › `the_pictures_no_shown_revision_uses_are_freed_from_the_gpu`; deep-motion `acceptance_1468` (5); deep-scene3d-render `acceptance_2657_maps_lookup` (1), `acceptance_2657_sway` (2), `acceptance_3024_pixels` (2) | Each states INCONCLUSIVE: load, not a reference Mac, no count of instructions retired, or hashes drawn on another GPU |
| #3100 (`BLOCKED: setup`) | deep-app `acceptance_34` › ac11 | `the log should end at 898`, it ends at 900; on the Mac too |
| #3172 (a custom harness prints `INCONCLUSIVE;` or `BLOCKED;` and exits 1) | deep-app `spike_402`; deep-replica `acceptance_1425`, `acceptance_1425_ac3`, `acceptance_1454_panel_redraft`, `acceptance_1620_planted_loader`, `acceptance_326_panels`, `acceptance_326_panels_planted`, `acceptance_326_panels_planted_redraft`, `acceptance_326_panels_redraft`, `acceptance_326_surfaces`, `acceptance_327_card`, `acceptance_327_planted`, `acceptance_883`, `acceptance_883_ac3_redraft`, `acceptance_992_app`, `acceptance_994_sound`, `acceptance_994_window`, `card_size`, `headless` | Each says it needs macOS and ran nothing; the lane reads `FAIL … the target failed outside any test it reported`. `acceptance_992_app` says BLOCKED |
| #3169 | deep-scene3d-render `held_memory` (3), `acceptance_3016_metal` (3), `acceptance_3016_views` (2) | `expect("Metal reports what it holds")` (`held_memory.rs:113`, `tests/acceptance/3016/fixture.rs:376`), and `BLOCKED: … this machine is a :` (`fixture.rs:357`) |
| #3170 | deep-hook `cli` › `a_folder_is_cloned_copy_on_write_where_the_file_system_can_and_exits_3_where_it_cannot` | `BLOCKED: /var/tmp can't make a reflink copy` (`cli.rs:1362`); the Spark's disks are ext4 |
| #3171 | deep-gpu `--lib` › `spans::tests::a_span_holds_its_submission_and_not_the_gap_after_it` | `153.6 ms covered, the passes' own 13.6: the gap counted` (`spans.rs:508`) beside other GPU tests; alone it passed 5 times of 5 |
| #3173 | deep-show `--bin deep-show` › `tests::the_published_schedule_matches_its_committed_snapshot` | The schedule drifted from `schedule/full.json` (`tests.rs:223`); on the Mac too |

On the Mac the same command fails 25 targets (`mac-lane-0c73a8a4.txt`): 22 of the 36 above, and deep-codecs `--lib`,
deep-replica `drive` and `tree_state`, which are #3100's.

## Round 1: main `654c560c`, before deep-player built natively

| File | Commit | What ran |
|---|---|---|
| `spark-build-654c560c.txt` | main `654c560c` | `cargo build --workspace --locked --keep-going` on the Spark: 53 of 54 crates |
| `spark-test-654c560c.txt` | main `654c560c` | `cargo test --workspace --locked --no-fail-fast --exclude deep-player` on the Spark |
| `spark-suite-b7bf13b7.txt` | branch `b7bf13b7` | `tests/acceptance/1121/` on the Spark, file by file |
| `mac-suite-b7bf13b7.txt` | branch `b7bf13b7` | `tests/acceptance/1121/` on the Mac |
| `spark-twin-ac1-2d36d5d2.txt` | branch `2d36d5d2` | deep-app built on the Spark as it is and with the twin `mac-only-dependency`; deep-app's `hub_client` test with the CLI built |

`2d36d5d2` is an earlier head of this work, with the same Rust sources and suite. With the twin's `show.rs`, deep-app
stops building on the Spark (`cannot find module or crate objc2`, exit 101); without it, it builds (exit 0). The
planted wrong programs `x86-nofollow` and `sbin-lsof` are shown failing on the Spark, and `x86-nofollow` on the Mac, in
`tests/acceptance/1121/BASE-FAILURE.txt`, by the blind job on the base, whose sources these are.

## Not run

- The whole unit lane (its vitest and node commands) on either machine.
