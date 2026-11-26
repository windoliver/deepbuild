# Blind redraft of #3016's Metal and views tests: off Metal they say so (#3169)

Written from issue #3169 (the dispute), issue #3016, the design and the base `ccafae68f` ("Merge pull request #3168
…"), by a job that never saw #3169's implementation or any other redraft of these tests (AGENTS.md, Proof; design:
Dogfooding, "A disputed test goes to a fresh run of that job"). `metal.rs` and `views.rs` here are each a whole redraft
of the first draft's file of that name, every test of it under the same name with the same criterion tags; the
`acceptance_3016_metal` and `acceptance_3016_views` entries of `crates/deep-scene3d-render/Cargo.toml` run them in the
first drafts' place (that swap is the implementer's; this folder doesn't touch Cargo.toml). Both use the first draft's
`../3016/fixture.rs` by `#[path]`, frozen and unchanged. No criterion text, test name, measurement, limit or message
changes. None of these tests was redrafted before.

## Why a redraft

On a machine whose device isn't Metal (the Spark: Linux aarch64, an NVIDIA GB10 reached through Vulkan),
`Gpu::open(Backend::Gpu)` opens a device, so the first drafts' "BLOCKED: no Metal device" never fires, and then:

- `metal.rs` `ac3_the_third_scene_holds_the_scene_once_and_each_views_own_targets`, `ac7_the_estimate_counts_what_each_view_holds`
  and `views.rs` `ac7_planted_estimate_counting_the_maps_per_view_fails_naming_the_bytes` call `fixture.rs`'s `held_on`,
  whose `deep_gpu::memory::allocated(device).expect("Metal reports what it holds")` (line 376) panics: `allocated` is
  `None` off macOS by `cfg` (`crates/deep-gpu/src/memory.rs`). libtest reads the panic FAILED, which states no platform.
- `metal.rs` `ac5_a_view_insets_frame_hashes_as_on_the_merge_base` and `views.rs`
  `ac5_planted_inset_takes_the_views_cascades_fails_naming_the_frame` call `inset_frame_failures`, whose
  `assert_eq!(model(), base_model, "BLOCKED: …")` (line 357) panics with `sysctl -n hw.model` read empty. libtest reads
  it FAILED too; its message says BLOCKED, which #1121's Spark criterion forbids as much as FAIL.

#3169 asks that off Metal each states that it needs Metal or the reference Mac and the unit lane reads it INCONCLUSIVE
(platform), never FAIL, BLOCKED or PASS; and that on the Mac each runs and judges as today.

## What was read

- Issues #3169 and #3016 (body and comments). `AGENTS.md`. `docs/technical-design.md`: How we know version 0 works
  (Dogfooding). `docs/parallel-proof.md`: section 3 and section 10a's skip rules ("platform and GPU skips are never
  listed and leave the lane INCONCLUSIVE (platform)").
- At the base: all of `tests/acceptance/3016/` (README, `fixture.rs`, `metal.rs`, `views.rs`, `BASE-FAILURE.txt`,
  `fixtures/inset-cascades.json`), `crates/deep-scene3d-render/Cargo.toml`'s `[[test]]` entries for 3016,
  `crates/deep-gpu/src/memory.rs`, `crates/deep-gpu/src/device.rs` (`Backend::Gpu` is "the platform's own GPU: Metal on
  macOS"), `scripts/lanes.mjs` (`cargoResults`, `isPlatform`/`PLATFORM`, `readSkips`, `readRun`), and for form
  `tests/acceptance/995/redraft/README.md` and `tests/acceptance/1018-redraft-1830/README.md`.

## How the lane reads a test (what forces the shape)

`cargoResults` reads libtest's lines: `ok` is PASS, `FAILED` is FAIL whatever the panic says, and
`ignored[, <reason>]` is a skip whose note is the reason. `readSkips` makes an unlisted skip INCONCLUSIVE, BLOCKED when
its note starts `BLOCKED`; `isPlatform` (a note not starting `BLOCKED` that names macOS, Linux, darwin, Metal, GPU or
platform) marks it a platform skip no `skips` entry can list. So off Metal the only outcome #3169 allows is `ignored`
with a reason naming Metal and not starting `BLOCKED`. libtest decides `ignored` when the test binary is built, never
while a test runs (an early return is `ok`, a PASS; a panic is FAILED), so the gate is a build-time one:

```rust
#[cfg_attr(not(target_os = "macos"), ignore = "INCONCLUSIVE (platform): needs Metal: …")]
```

`target_os = "macos"` is exactly the line between Metal and not: `deep_gpu` reaches Metal only on macOS
(`memory::allocated` returns `None` under `cfg(not(target_os = "macos"))`, so off macOS the device is never Metal and
the helper can't state a platform), and on macOS `Backend::Gpu` is Metal. The gate sits on the test, before any
`fixture.rs` helper is called, so the frozen helpers' `expect` and BLOCKED assert never run off Metal.

## The tests, one by one

On macOS nothing is added to any test: the `cfg_attr` expands to nothing, so each runs and judges as the first draft
does, its "BLOCKED: no Metal device" on a Mac with no GPU and its BLOCKED model assert on a Mac other than the Mac17,10
included. What changes is off macOS only.

`metal.rs` (all three tests read Metal; the file's other items are the first draft's):

| Test | Off macOS |
|---|---|
| `ac3_the_third_scene_holds_the_scene_once_and_each_views_own_targets` (`#3016.127ccb4d`) | ignored, `INCONCLUSIVE (platform): needs Metal: what the device holds is Metal's currentAllocatedSize, which deep_gpu::memory::allocated reads only on macOS` |
| `ac7_the_estimate_counts_what_each_view_holds` (`#3016.a8b1d957`) | ignored, `INCONCLUSIVE (platform): needs Metal: the device's peak is Metal's currentAllocatedSize, which deep_gpu::memory::allocated reads only on macOS` |
| `ac5_a_view_insets_frame_hashes_as_on_the_merge_base` (`#3016.548510a3`) | ignored, `INCONCLUSIVE (platform): needs Metal on the reference Mac (Mac17,10) that drew the merge base's hash: a same-machine hash can't be compared off it` |

`views.rs`:

| Test | Off macOS |
|---|---|
| `ac2_each_pipeline_is_made_once_and_the_environment_filtered_once` (noop) | runs, unchanged |
| `ac2_planted_mirror_compiles_its_own_pipelines_fails_naming_the_pipeline` (noop) | runs, unchanged |
| `ac5_a_mirror_draws_what_only_it_sees` (`Backend::Gpu`, compares two frames of one run, no hash) | runs, unchanged |
| `ac5_planted_mirror_takes_the_views_culled_lists_fails_naming_the_item` (same) | runs, unchanged |
| `ac5_planted_inset_takes_the_views_cascades_fails_naming_the_frame` | ignored, the AC5 hash reason above |
| `ac6_a_mesh_any_view_drew_this_turn_is_kept` (noop) | runs, unchanged |
| `ac6_planted_cache_freeing_by_the_last_views_turn_fails_naming_the_mesh` (noop) | runs, unchanged |
| `ac7_planted_estimate_counting_the_maps_per_view_fails_naming_the_bytes` | ignored, the AC7 reason above |

Besides the five attributes, each file's `#[path]` points at `../3016/fixture.rs`, and its header says it is this
redraft. `fixture.rs`'s `include_str!("fixtures/inset-cascades.json")` resolves beside `fixture.rs`, so the base hash
is the first draft's.

## Run them

Point the two `[[test]]` entries at this folder (the implementer's swap), then as the first draft's README runs them:

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo test --locked -p deep-scene3d-render \
  --test acceptance_3016_metal --test acceptance_3016_views -- --test-threads=1
```

The files read process-wide gauges and the device's allocated size, as the first drafts do, so this folder belongs
in `scripts/lanes.mjs`'s `alone` list beside `tests/acceptance/3016/` (that edit is the implementer's).

## What this doesn't settle

- A Mac whose Metal device is missing still reads "BLOCKED: no Metal device", and a Mac other than the Mac17,10 still
  reads the AC5 model assert's BLOCKED, as today: #3169 asks for no change on the Mac.
- The Mac run here was on a Mac18,1, not the Mac17,10: both drafts read the hash tests' model-assert BLOCKED there, test
  for test the same; the Mac17,10 itself wasn't run.
- A non-macOS build reaching Metal some other way would be ignored too; `deep_gpu` has no such path at the base.
- The other four tests #3169 names (`tests/held_memory.rs`) are not #3016's blind files and are not redrafted here.

The runs on the Mac and the Spark, and the Spark output read through `cargoResults` and `readRun`, are in
`BASE-FAILURE.txt`.
