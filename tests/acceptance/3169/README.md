# Acceptance tests for #3169: the Metal tests of deep-scene3d-render off Metal, and on the Mac

I wrote these tests blind. The sources were:

- issue #3169, as saved word for word for this job
- `AGENTS.md`
- `docs/technical-design.md`: How we know version 0 works, and Dogfooding
- `docs/parallel-proof.md`, section 3, and its paragraph on skips: platform and GPU skips are never listed, and they
  leave the lane INCONCLUSIVE (platform)
- the base commit `ccafae68f`

At the base I also read `scripts/lanes.mjs` (`cargoResults`, `crates`, `readSkips`, `isPlatform`, `readRun`),
`scripts/proof-runs.mjs` (the before lane: the merge base with the change's test files, twins, `atAssertion`),
`crates/deep-scene3d-render/tests/held_memory.rs`, `crates/deep-scene3d-render/Cargo.toml`,
`tests/acceptance/3016/{metal.rs,views.rs,fixture.rs}` and its `fixtures/inset-cascades.json`, and
`crates/deep-gpu/src/memory.rs` and `device.rs`. For their shape I read `tests/acceptance/1121/` (its
`cargo-test.test.mjs` reads a cargo run through lanes.mjs the same way), `2243/` and `2629/`. The helpers are written
here and import nothing from another suite. I didn't read any pull request or branch about this issue. Under AGENTS.md
the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

## Running them

```sh
# Each machine runs both files. The test for the other machine skips.
node --test tests/acceptance/3169/*.test.mjs
```

You need `cargo` and Node 24 on `PATH`. A cold build of deep-scene3d-render's three test targets takes minutes, and
`CARGO_TARGET_DIR` and `CARGO_BUILD_JOBS` are passed through to cargo. The files are `*.test.mjs` under
`tests/acceptance/`, so the unit lane doesn't pick them up. They run by hand on both machines, the Mac and the Spark,
as the issue's Proof says.

Each file runs the issue's Proof command, narrowed to the three targets that hold the named tests:

```sh
cargo test -p deep-scene3d-render --locked --no-fail-fast --test held_memory --test acceptance_3016_metal --test acceptance_3016_views
```

Its output, stdout and stderr in the order written, is read in a child process by lanes.mjs's own readers:
`cargoResults(output, status, crates(checkout))`, then `readRun(results, status, checkout, timed)`, with `isPlatform`
applied to each skipped row's note. That is how the unit lane reads a cargo command. Nothing is mocked.

**A test that can't prove its criterion on this machine skips.** Its note starts `INCONCLUSIVE (platform):` and names
the machine. A skip is unrun and never a pass. Each criterion is proven only on its own machine:

- `#3169.7cec9f4a` runs on any machine whose GPU device isn't Metal. At the base, Metal is wgpu's GPU backend on macOS
  only, so the test runs where `process.platform !== 'darwin'`: the Spark.
- `#3169.bb7defda` runs on the Mac.

## The tests, by target and name

The tests are picked by cargo target and libtest name, never by file path. #3016's files are that issue's frozen blind
tests, and a fix may redraft them elsewhere under the same targets and names. A test's ID is the one `cargoResults`
gives it, `cargo -p deep-scene3d-render --test <target> › <name>`:

| Target | Name | Kind |
|---|---|---|
| `held_memory` | `a_scene_that_stopped_using_them_holds_none_of_their_memory` | memory |
| `held_memory` | `a_frame_no_post_module_reads_the_key_lights_map_in_holds_no_map` | memory |
| `held_memory` | `a_scene_with_no_label_holds_no_glyph_atlas` | memory |
| `acceptance_3016_metal` | `ac3_the_third_scene_holds_the_scene_once_and_each_views_own_targets` | memory |
| `acceptance_3016_metal` | `ac7_the_estimate_counts_what_each_view_holds` | memory |
| `acceptance_3016_views` | `ac7_planted_estimate_counting_the_maps_per_view_fails_naming_the_bytes` | memory |
| `acceptance_3016_metal` | `ac5_a_view_insets_frame_hashes_as_on_the_merge_base` | hash |
| `acceptance_3016_views` | `ac5_planted_inset_takes_the_views_cascades_fails_naming_the_frame` | hash |

**The issue says "nine tests", but its "What fails" section names eight:** three, two plus one, and two. I test the
eight it names. If the Spark's whole-crate run at the base shows a ninth Metal test, `BASE-FAILURE.txt` records it.

## Criteria to tests

Each criterion's ID is `#3169.` plus the first 8 hex digits of the SHA-256 of its text with white space collapsed. Each
test carries its ID at the start of its name. There is one test per criterion. It reads all eight named tests from one
run and fails on any that is wrong, listing each one with its reading.

| Criterion | Test (file) | Runs on | What it asserts |
|---|---|---|---|
| `#3169.7cec9f4a` Off Metal, each test states it needs Metal or the reference Mac, and the unit lane reads it INCONCLUSIVE (platform), never FAIL, BLOCKED or PASS | `off-metal.test.mjs` | Spark (non-Metal) | `readRun` has exactly one row for each of the eight IDs. That row is `skipped` (libtest's `ignored`) and in state `INCONCLUSIVE`, its note passes `isPlatform`, and the note matches `Metal` or `reference Mac`. A row that is PASS, FAIL or BLOCKED, a skip with no platform in its note or with a note starting `BLOCKED`, or a test missing from the run fails it |
| `#3169.bb7defda` On the Mac the tests run and judge as they do today | `on-mac.test.mjs` | Mac | On every Mac, each of the eight has exactly one row and none is skipped: each runs, as today. **On the reference Mac** (`hw.model` = `Mac17,10`, the model the merge-base hash fixture names) each one is PASS. **On any other Mac** each hash test is FAIL, and libtest's section for it holds its own `BLOCKED` panic (the same-machine hash can't be compared), as today. The memory tests' verdicts there aren't the reference's. At the base on this Mac18,1, #3016's ac3 fails when its target runs whole and passes alone. So once the checks above pass, the test skips with `INCONCLUSIVE (platform): … judged only on the reference Mac …`, which lists each test's state, and is never PASS |

### The surface (my choice where the issue leaves it open)

- **The reference Mac is `Mac17,10`.** That is the model `tests/acceptance/3016/fixtures/inset-cascades.json` names at
  the base. The value is kept as a constant in `helpers.mjs`, so the test never reads #3016's files by path.
- **"Judge as they do today" on a Mac that isn't the reference Mac** means the eight still run there, and the hash
  tests read their own BLOCKED, the way they do at the base. A fix that ignores any of them on a Mac changes how they
  judge, so it fails `#3169.bb7defda`. Only the reference Mac proves the PASS verdicts. Every other Mac leaves the
  criterion INCONCLUSIVE (platform).
- **"States that it needs Metal or the reference Mac"** means libtest's `ignored, <reason>` with a reason that names
  `Metal` or the `reference Mac` and that the lane reads as a platform skip (`isPlatform`). libtest's only outcomes
  are ok, FAILED and `ignored[, reason]`. A test that returns early is ok, and the lane reads ok as PASS.

## Twins

`twins.json` names each planted wrong program by criterion. Each twin is a file under `twins/<name>/` at the repository
path it replaces, laid over the change. Each one is the base's `crates/deep-scene3d-render/tests/held_memory.rs` with a
single planted attribute on each of its three tests and a comment that names the twin. It is built with the rest of
the change, so it fails at the test's assertion, not at a build.

| Criterion | Twin | Plants | Fails on |
|---|---|---|---|
| `#3169.7cec9f4a` | `unplatformed-note` | Off macOS the three held_memory tests are `ignore = "the device reports no allocated size here"`. The note names no platform, so the lane reads them INCONCLUSIVE but not INCONCLUSIVE (platform), and the note doesn't say they need Metal | The Spark |
| `#3169.7cec9f4a` | `blocked-note` | Off macOS the three are `ignore = "BLOCKED: no Metal device reports its allocated size"`. `readSkips` reads a note starting BLOCKED as BLOCKED, and the issue forbids BLOCKED | The Spark |
| `#3169.bb7defda` | `ignored-on-mac` | The three are `ignore = "needs Metal"` on every machine. On the Mac they no longer run | The Mac |

Criterion 1's test already fails at its assertion on the base, on the Spark. Its twins also cover a fix that lives
only in test files: the before lane runs the merge base with the change's test files laid over it.

## Base results

See `BASE-FAILURE.txt`: each test's run at `ccafae68f` on the Mac and on the Spark, with `uptime` load.
