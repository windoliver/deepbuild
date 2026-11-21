# Acceptance tests for #3024: a lake's mirror copies the scene on no frame whose scene holds

Written first, from issue #3024 (its finding, its scope, its three acceptance criteria and its proof line), the design
sections it links (canvas primitives: Frame budget, Material: mirror, Material: water, The cost model) and base commit
`b2e661bf7` (the head of PR #3022, which carries #2657's change and its blind suite `tests/acceptance/2657/`), by a job
that never saw an implementation; none existed. Issues #2657 and #3016 were read for context only. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read at the base: `crates/deep-scene3d-render/src/mirror.rs` (`Mirrorer::prepare`, which makes the mirrored
view with `deep_canvas_scene3d::mirror::view` every whole prepare, `Mirrorer::jobs`, `half`, `Renderer::mirror_px`);
`lib.rs`'s `prepare`, `placed`, `prepare_placed` (the level-of-detail and dry scenes #2657 keeps in `kept.rs`, the
mirror's step after `prepare_core`, the `keeps_mirror` plant), `prepare_water`, `keep_first`, `internal` and
`internal_size`; `kept.rs`; `renderer.rs`'s `surface`, `upscale` and `history` fields; `surface.rs` (`Surface`,
`scaled`, `Upscale`); `module.rs`'s `draw_offscreen`; `origin.rs`'s `moved` (a scene with water or a mirror draws as it
stands); `water.rs`'s own test lake and `water.wgsl`'s Fresnel mix of the mirror's picture;
`crates/deep-canvas-scene3d/src/mirror.rs` (`own`, `plane_of`, `view`), `scene.rs` (where a water's own mirror is set,
`Camera::project`, the box's model over the unit cube), `water.rs` (`parse`: `waves`, `ripples`, `distort`);
`crates/deep-canvas/src/camera.rs` (the orbit's convention, the field of view across the wider side);
`crates/deep-gpu-layer/src/session3.rs`'s `surface` (how a view draws below internal scale 1); and the suites
`tests/acceptance/2657/` (`copies.rs`, `sway.rs`, `common.rs`, README, BASE-FAILURE), `166/mirror.test.ts` and
`465/mirror.test.ts` (headers only).

## Run them

Both files are Rust integration tests of `deep-scene3d-render`, the crate the issue changes; they reach it through its
public entries. **The implementer adds these two entries to `crates/deep-scene3d-render/Cargo.toml`**, after #2657's
(this job may write only here):

```toml
# Issue #3024: the acceptance tests, written blind in tests/acceptance/3024.
[[test]]
name = "acceptance_3024_heap"
path = "../../tests/acceptance/3024/heap.rs"

[[test]]
name = "acceptance_3024_pixels"
path = "../../tests/acceptance/3024/pixels.rs"
```

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease nice -n 10 \
  cargo test --locked -p deep-scene3d-render --no-fail-fast --test acceptance_3024_heap --test acceptance_3024_pixels
```

Each file is its own test binary; `common.rs` is shared by `mod common;`. `heap.rs` draws on wgpu's noop backend only,
no GPU, and holds one test, so no other thread allocates inside its count (the count is per thread anyway).
`pixels.rs`'s two tests draw on this Mac's GPU (Metal); off a GPU, or on a GPU other than the one the base's hashes were
drawn on, they fail with a message that starts `INCONCLUSIVE:`, never pass. No test reads a timing, and nothing here needs
`--test-threads=1`. No lanes entry is needed: they run where `cargo test --workspace` runs (no vitest file, so no
`lane.json` either).

The third criterion, #3024.c7a412bf, needs no new test. Run those suites as they stand, unchanged, on this Mac:
`tests/acceptance/2657/` through the six `[[test]]` entries its README names (already in the crate's `Cargo.toml` at the
base), and the two vitest files:

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease nice -n 10 \
  cargo test --locked -p deep-scene3d-render --no-fail-fast \
  --test acceptance_2657_side_meshes --test acceptance_2657_casters --test acceptance_2657_maps_lookup \
  --test acceptance_2657_copies --test acceptance_2657_ensure_casters --test acceptance_2657_sway
npm ci   # once, if node_modules is missing
scripts/lease nice -n 10 npx vitest run --root tests/acceptance/166 mirror.test.ts --no-file-parallelism --testTimeout=3600000
scripts/lease nice -n 10 npx vitest run --root tests/acceptance/465 mirror.test.ts --no-file-parallelism --testTimeout=600000
```

(Each vitest file builds `deep-gpu` itself, as those suites' READMEs say.) This job ran none of the three at the base.

## Surfaces

None new. Both files use only what the base has: `Renderer::{new, prepare, jobs, mirror_px, internal_size,
keep_first}`, its public `surface` and `upscale` fields, `deep_scene3d_render::{draw_offscreen, Planted}`,
`mirror::half`, `surface::{Surface, Upscale}`, `deep_canvas_scene3d::scene::{evaluate, Scene, Solid, Camera::project}`,
`Scene::{water, mirror}`, and `deep_gpu`'s noop and GPU devices. Both files build at the base (BASE-FAILURE.txt).

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId` (the first 8 hex digits of the SHA-256 of the criterion's text,
trimmed, white space collapsed). Each test's name starts `ac<N>_`, and each failure message starts with the ID (an
`INCONCLUSIVE:` one with `INCONCLUSIVE: ` and then the ID).

| ID | Criterion | Test | What it reads and asserts | Wrong programs it fails |
|---|---|---|---|---|
| `#3024.d3ad772d` | AC1, heap | `heap.rs` | 10,000 solids: 9,999 boxes on a grid and a 40 × 40 m `plate@1` (16 × 16 cells) beside them. The lake: the plate's material carries `water: {}`. Its twin: the same material without `water`. Guards: both have 10,000 solids; the lake's water is the plate alone and its mirror (scene3d's `mirror::own`) is in the plate's plane over it; the twin has no water and no mirror. Each scene evaluated once, its own renderer on the noop lane, warmed by two whole prepares (each recorded and submitted); the third whole prepare's heap (a counting global allocator, this thread, bytes asked, as `2657/copies.rs` counts them) is under 1 MiB more with the lake than with the plain plate. Guard: the lake's third frame drew its mirrored view (`mirror_px()` is half the frame's size), the twin's none. The failure names the excess in copies of the scene (one clone of the lake scene's bytes, read the same way) | the base (1.01 copies, Readings); a mirror that makes its view again on a frame whose scene holds, by `mirror::view` or any other copy of the scene; a renderer that drops the mirror on a held frame to save the copy (the `mirror_px()` guard) |
| `#3024.324d6742` | AC2, pixels on Metal | `pixels.rs` (2 tests) | A calm lake (a 40 × 40 m plate, `water: {waves: [], ripples: {strength: 0}, distort: 0}`) under a sky, a camera 1.5 m over it looking across, and a magenta emissive beacon (8 × 3 × 1 m) hanging 4 to 7 m over the far water above the top of the frame, slid by a channel from x = −6 m at t = 0 to x = +6 m at t = 2 s. Guard (CPU): at both times the lake is water with a mirror of its own, every corner of the beacon projects above the frame, and every corner's mirror image projects inside it. One renderer, 160 × 120 px, `draw_offscreen`: (1) t = 0, (2) t = 0, (3) t = 2 s, (4) t = 2 s, (5) t = 2 s with `surface.scale` 0.5 and the upscale's pipelines (internal 80 × 60). Each frame's FNV-1a 64 hash over the BGRA8 bytes equals the base's (`fixtures/lake-hashes.json`, which names the adapter); frames 3 and 1 differ in at least 100 pixels; each frame shows at least 100 beacon-colored pixels; frames 1–4 draw at internal size 160 × 120 and frame 5 at another, and each frame's mirror drew at half its internal size (`mirror_px()`). The second test keeps the mirror's first picture (#506's planted core, `keep_first(false, true)` after frame 1) and must fail naming frame 3 | the issue's mutant, a mirror that reuses the first mirrored view whatever holds (probe, BASE-FAILURE.txt: frame 3); a mirror that keeps its view while the scene holds but not its size (probe: frame 5); a kept mirrored picture (the planted test: frame 3); a renderer that draws nothing or no reflection (the beacon-colored count, the hashes) |
| `#3024.c7a412bf` | AC3, suites unchanged | none | Run `tests/acceptance/2657/`, `166/mirror.test.ts` and `465/mirror.test.ts` unchanged (Run them) | — |

Each test also fails if the device raised an error. Neither can pass on a renderer that draws nothing: AC1 needs the
lake's mirrored view drawn in the frame it reads and the scene to hold its water, its mirror and 10,000 solids; AC2 needs
the base's five hashes, the beacon's reflection in every frame and its move between frames 1 and 3.

## Readings where the issue leaves a choice

- **"On the noop lane"** is wgpu's noop backend (`Backend::Noop`), the backend `scripts/lanes.mjs`'s `noop` lane runs.
- **"Read as `tests/acceptance/2657/copies.rs` reads it"**: the same counting global allocator (bytes each allocation
  and reallocation asks of the heap on this thread), the same fixture shape (each scene evaluated once at t = 0, its own
  renderer, two warm-up frames, then the third whole prepare alone inside the count, its jobs recorded after) and the
  same naming of the excess (the excess over one clone of the lake scene, read the same way).
- **AC1's lake** is a `plate@1`, the plate the render crate's own water test uses, whose material is `water: {}` (a lake
  in a light breeze); its twin keeps the plate and its material's other fields, so both scenes have 10,000 solids and
  the twin differs only in having no water, hence no mirror. No level of detail is in either scene: the kept scene the
  mirror is given is #2657's dry scene. The plate stands beside the boxes (at z = −130 m); where it stands doesn't change
  what a prepare copies.
- **What the base allocates for AC1.** One clone of the lake scene asks for 14,124,910 bytes. At the base the third
  whole prepare asks for 163,346 bytes with the plain plate and 14,451,054 with the lake: 14,287,708 more, which the
  test reports as 1.01 copies. That is `mirror::view`'s `scene.clone()` of the kept dry scene (the scene less the plate),
  plus what the mirror's own renderer asks to prepare that copy, about as much as the plain scene's whole prepare; #2657's
  dry scene itself is reused and copies nothing. The test prints both readings on every run, so the change's reading is
  in its output too. The limit is the issue's (under 1 MiB). Probe C (BASE-FAILURE.txt), a mirror that draws the view it
  made the frame before while the scene it is given and the size hold, asks 163,698 bytes more than the plain plate (the
  mirror's renderer preparing the held view) and passes.
- **"Visibly changes"** is read as AC2's two checks together: frames 3 and 1 differ in at least 100 pixels (of 19,200),
  and every frame shows at least 100 beacon-colored pixels (red and blue each at least 64 levels over green), which only
  the mirror can show since the beacon lies above the frame (the guard). At the base frames 3 and 1 differ in 2,376
  pixels, and the five frames show 1,167, 1,167, 1,169, 1,169 and 1,264 beacon-colored pixels. Both floors are under a
  tenth of what the base draws and far above what a kept view gives (frame 3 equal to frame 1: 0 pixels differ), so
  neither can fail a change that keeps the base's pixels, and a renderer that draws no reflection fails the second.
- **The lake in AC2 is calm** (no waves, no ripples, no distortion), so nothing on the water moves with t: what changes
  between frames 1 and 3 is the beacon's reflection alone. The scene is evaluated afresh for each frame, as a view does,
  so "a frame whose scene holds" is the same t evaluated again (frames 2 and 4), not the same `Scene` value.
- **"At a t or camera where the reflection visibly changes"** is t = 2 s, where the beacon has slid 12 m; the camera holds.
- **"Another internal scale"** is the GPU surface's scale 0.5 (the showpiece class's render scale while moving), set as
  the view's `surface` call sets it: `surface.scale` and the upscale's pipelines compiled, since a renderer draws below
  its full size only once those exist (`internal_size`). Frame 5 is at t = 2 s, the same scene as frames 3 and 4, so a
  mirror that keeps its view because the scene holds, without its size, draws it at the wrong size there.
- **The hashes** are FNV-1a 64 over the BGRA8 bytes `draw_offscreen` reads back, as `2657/sway.rs` hashes them. They are
  this Mac's GPU's (the fixture names the adapter, `Apple M5 Max`), so on another GPU the test reads INCONCLUSIVE rather
  than comparing. At the base frames 1 and 2 hash alike (`5e66536debae2f19`), frames 3 and 4 alike (`d2e7e5121092656b`),
  and frame 5 differs from both (`5abe27c834d58310`); the recording run and the checking run drew the same five.
- **"A mutant that keeps the mirrored view whatever holds"** is the base's `Mirrorer::prepare` changed to make the
  mirrored view once and draw that view in every later frame. The base has no switch for it, and the issue asks for none,
  so it was run as a probe (BASE-FAILURE.txt), not planted. The suite's planted test reaches the nearest wrong program the
  base already has: #506's `keep_first(false, true)`, which keeps the mirror's first picture rather than its view.

## Not tested

The mirror's copies on a scene with neither a level of detail nor water (a plain `mirror` material; the issue's scope
leaves it out), view insets, what a second renderer holds on the device (#3016); a lake with a level-of-detail band (the
kept level-of-detail scene the scope names: AC1 reads the dry scene, the only kept scene its criterion's lake has);
times, GPU memory, and heap outside the third whole prepare; the web player.

## Base runs

`BASE-FAILURE.txt` holds the runs at the base, `b2e661bf7`, with the two `[[test]]` entries above added for the run and
removed after: AC1 fails, naming the copies; AC2 passes (its fixture was recorded from an earlier run of the same test at
the base, with the hashes unrecorded, and checked by this one); and the probes, each a patch to the base's `mirror.rs`
reverted after its run: the issue's mutant fails AC2 naming frame 3, a mirror that keeps its view while the scene holds
but not at its size fails naming frame 5, and a mirror that keeps its view while the scene holds at the size it was made
at passes both AC1 and AC2.
