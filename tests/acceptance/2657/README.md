# Acceptance tests for #2657: a 3D frame's prepare does each thing once

Written first, from issue #2657 (its six findings, its scope, its seven acceptance criteria and its proof line), the
design sections it links (canvas primitives: The cost model, Motion blur, Level of detail; technical design: Numbers
version 0 has to hold) and base commit `3f02bf52b` ("Merge pull request #2885 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

What was read at the base: `crates/deep-scene3d-render/src/` (`motion.rs`'s `draw_list`, which builds each deforming
solid's two side meshes with `Mesh::of`; `mesh.rs`'s `vertices`, which derives a built mesh's tangents, and `upload`,
which makes its index buffer; `shadow.rs`'s `caster_corners` / `corners_of` and `cascades`; `lib.rs`'s `prepare`,
`prepare_placed` (the level-of-detail `chosen` and the water's `dry` copies), `prepare_cascades`, `ensure_casters`,
`prepare_core` and the `by_index` callers; `maps.rs`'s `Store::by_index`; `sway.rs`'s `move_all`; `planted.rs`;
`module.rs`'s `draw_offscreen` and `Counts`; `tests/evaluate_alloc.rs`), `crates/deep-gpu/src/counted.rs` and
`alloc.rs`, `crates/deep-canvas-scene3d` (`Motion`, `MotionSolid`, `geom::Mesh::bounds`/`reach`, `lod::select`, the
water and material readers), `crates/deep-gpu-layer/src/blur.rs` (how the view hands a renderer motion blur's
evaluations), `scripts/count-children.c` and `scripts/perf.mjs` (instructions retired on macOS), `scripts/lanes.mjs`,
and the suites `tests/acceptance/1903/`, `2016/`, `419/`, `1312/` and `1468/` (the last two: a Rust acceptance test a
crate's `[[test]]` runs).

## Run them

All six files are Rust integration tests of `deep-scene3d-render`, the crate the issue changes; they reach it, and
`deep-gpu`'s counted device, through their public entries. **The implementer adds these six entries to
`crates/deep-scene3d-render/Cargo.toml`** (this job may write only here; the precedent is `crates/deep-motion`'s
`acceptance_1468` and `crates/deep-effects-render`'s `acceptance_1312`):

```toml
# Issue #2657: the acceptance tests, written blind in tests/acceptance/2657.
[[test]]
name = "acceptance_2657_side_meshes"
path = "../../tests/acceptance/2657/side_meshes.rs"

[[test]]
name = "acceptance_2657_casters"
path = "../../tests/acceptance/2657/casters.rs"

[[test]]
name = "acceptance_2657_maps_lookup"
path = "../../tests/acceptance/2657/maps_lookup.rs"

[[test]]
name = "acceptance_2657_copies"
path = "../../tests/acceptance/2657/copies.rs"

[[test]]
name = "acceptance_2657_ensure_casters"
path = "../../tests/acceptance/2657/ensure_casters.rs"

[[test]]
name = "acceptance_2657_sway"
path = "../../tests/acceptance/2657/sway.rs"
```

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 120 -- \
  cargo test --locked -p deep-scene3d-render \
  --test acceptance_2657_side_meshes --test acceptance_2657_casters --test acceptance_2657_maps_lookup \
  --test acceptance_2657_copies --test acceptance_2657_ensure_casters --test acceptance_2657_sway
```

Each file is its own test binary, so a surface one criterion needs and the base lacks fails that file's build alone.
`common.rs` is shared by `mod common;`. Every file but `sway.rs` draws on wgpu's noop backend only, no GPU. `sway.rs`'s
two pixel tests draw on this Mac's GPU (Metal); off a GPU, or on a GPU other than the one the base's hashes were drawn
on, they fail with a message that starts `INCONCLUSIVE:`, never pass. No test reads a timing. `maps_lookup.rs` reads
instructions retired from macOS's `proc_pid_rusage`; elsewhere it fails `INCONCLUSIVE:`. The two files whose counters
are process-wide hold one test each (`side_meshes.rs`, `casters.rs`) or take turns on a lock (`sway.rs`), and
`maps_lookup.rs` holds one test so no other thread runs inside its count; nothing here needs `--test-threads=1`. No
lanes entry is needed: they run where `cargo test --workspace` runs (no vitest file, so no `lane.json` either).

The seventh criterion, #2657.13a91f2f ("On Metal: `tests/acceptance/422/`, `425/`, `446/`, `419/`, `2016/` and
`1285/` pass unchanged"), needs no new test. Run those suites as they stand, unchanged, on this Mac:

```sh
npm ci   # once, if node_modules is missing
for s in 422 425 446 419 2016 1285; do
  node scripts/throttle.mjs build --wait 120 -- npx vitest run --root tests/acceptance/$s --no-file-parallelism --testTimeout=600000
done
```

## Surfaces

Every name below is this job's; the issue gives none. Each is the smallest that lets its criterion be read, and none
changes a pixel, a pass list or a public count the base has (the issue's last scope line). At the base the files that
use them don't build, each error naming the missing surface (`BASE-FAILURE.txt`, run 1).

1. **`deep_gpu::counted::Reading::index_buffers: u64`** (and the same counter in `Counts`, read by `read()` and
   subtracted by `since()`): the buffers the device created through `Wgpu::create_buffer` or `Wgpu::create_buffer_init`
   whose `usage` contains `wgpu::BufferUsages::INDEX`. They also still count in `buffers`. (AC1: "makes no index
   buffer … read from the counted device".)
2. **`deep_gpu::counted::Reading::command_buffers: u64`** (likewise in `Counts`, `read()`, `since()`): the command
   buffers handed to `Queue::submit`, each counted as it is handed over, armed spans or not. (AC6: "submit no command
   buffer for sway".)
3. **`deep_scene3d_render::tangents_derived() -> u64`**, at the crate root: how many vertices' tangents this process's
   renderers derived from texture coordinates while building a mesh's vertices (at the base, `mesh::vertices` when the
   mesh carries no tangents of its own: `count` per call), process-wide, monotonic. A mesh's own tangents copied over
   don't count. (AC1: "derives no tangent for a side mesh … counted by the test".)
4. **`deep_scene3d_render::shadow::caster_scans() -> u64`**: one for each casting solid with a built mesh, each time
   the renderer scans that mesh's vertices to find its caster corners (at the base, `corners_of`'s `m.reach()`, which
   both `caster_corners` calls in a whole prepare make), whatever function makes the scan; process-wide, monotonic.
   (AC2: "scans each caster's vertices once, counted by the test".)
5. **`Renderer::ensure_casters(&mut self, device: &Device, scene: &Scene)` made `pub`** (it may be `#[doc(hidden)]`),
   the base's method with its signature. The test calls it with the frame's scene right after a whole prepare, the
   call that prepare made, so what it allocates can be read alone. (AC5: "allocates nothing in `ensure_casters`".)
6. **`Planted::casters_once_any: bool`**: AC5's wrong program, "a planted renderer that skips the check once any
   pipeline exists": `ensure_casters` returns before building anything once either caster kind's shadow pipeline
   (`scene3d.shadow` or `scene3d.shadow_mask`) exists.
7. **`Planted::sway_first_frame_only: bool`**: AC6's wrong program, "a planted renderer that never runs the pass after
   the first frame": once the sway pass has run in one frame, no later frame records or submits it.

The two planted switches are fields of the crate's public `Planted`, which the tests pass to `Renderer::new`, as the
render crate's own tests do; adding them to `deep-gpu`'s `--planted` names is not needed here.

Existing surfaces read: `Reading`'s `uploaded` and `bind_groups`, `deep_gpu::counted::compute_passes()` (which the
sway pass counts as it begins), `Renderer::{new, prepare, jobs, counts, compiled_names}`, `Renderer::core.want`,
`Counts::shadow_maps` (each cascade's light clip matrix), `deep_scene3d_render::draw_offscreen`, `Scene::motion` and
`Scene::texels`, and `deep_canvas_scene3d::scene::evaluate`.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId` (the first 8 hex digits of the SHA-256 of the criterion's text,
trimmed, white space collapsed). Each test's name starts `ac<N>_`, and each failure message starts with the ID.

| ID | Criterion | Test | What it reads and asserts | Wrong programs it fails |
|---|---|---|---|---|
| `#2657.88046eaf` | AC1, side meshes | `side_meshes.rs` | A built pot (lathe, 24 segments, 202 vertices) under a still camera with the core velocity target on (`core.want.velocity`) and the evaluations at t ∓ s/2 in its scene for both passes (`Scene::motion` for blur, `Scene::velocity` for the target), its pre-skins at t ∓ s/2 scaled by 1 ∓ 0.01 n in frame n (every side vertex moves each frame). Twin: the same frames with the pot's pre-skins left out (`meshes: None`). In frames 2 and 3: `index_buffers` equal to the twin's, and `tangents_derived()`'s rise equal to the twin's. Guard: the frame uploads at least 12 bytes a pot vertex more than the twin (one side's f32 positions), so the side meshes are drawn | the base (4 index buffers and 4 × the pot's vertices in tangents a frame); a side mesh built whole (`Mesh::of`) for either pass; a renderer that leaves the side meshes out (the guard) |
| `#2657.6e8cb3fb` | AC2, casters | `casters.rs` | 1,000 casting balls (built meshes, 12 segments) under a sun with a shadow and `cascades: 4`. Two whole prepares: each raises `caster_scans()` by exactly 1,000, draws from 4 cascades, and its 4 light clip matrices (`Counts::shadow_maps`) equal, bit for bit, the base's in `fixtures/cascades.json` | the base (2,000 scans a prepare); a program that scans a caster twice or not at all; one whose cascade matrices differ from the base's by one bit (a different fit, auto far end, snap or caster set) |
| `#2657.4baeffe3` | AC3, `by_index` | `maps_lookup.rs` | n boxes, box i wearing material i with its own 4 × 4 base color map, for n = 200 and n = 2,000, a renderer each, warmed by 3 frames. 15 rounds, each one frame of each at the round's t, the order alternating; a frame's instructions are this process's `ri_instructions` across a whole prepare, its jobs and one submit. The median of the rounds' ratios (instructions ÷ 2,000) ÷ (instructions ÷ 200) is at most 1.1. Guard: the warm-up made at least n bind groups (every material's maps bound) | the base, whose `by_index` walks every group for each set (the ratio rises with n); any lookup linear in the materials |
| `#2657.2d901bbb` | AC4, copies | `copies.rs` | 10,000 solids (9,998 boxes, a ball, a 20 × 6 × 20 m pool). With both: the ball has one proxy band, the pool's material is water. With neither: no band, a plain material. Each scene's renderer warmed by 2 whole prepares; the third's heap (a counting global allocator, this thread, bytes asked, as `evaluate_alloc.rs` counts them) is under 1 MiB more with both than with neither. The failure names the excess in copies of the scene (one clone's bytes, read the same way) | the base (its `chosen` and `dry` clones and the level-of-detail resolve's own copy of the layers: 4.21 copies' worth, Readings); one copy either way; a copy kept but made again each frame |
| `#2657.1e3f898a` | AC5, `ensure_casters` | `ensure_casters.rs` (3 tests) | A sun with a shadow and four cascades and a point lamp with a shadow over a receiving plate, an opaque box `a` and a mask-alpha box `m`. (1) Both casting, after 3 whole prepares (which compiled `scene3d.shadow` and `scene3d.shadow_mask`): `ensure_casters` with the frame's scene makes 0 allocations of 0 bytes. (2) Frames 1–2 cast nothing, frame 3 gains `a` (first opaque caster), frame 4 gains `m` (first mask-alpha caster): frame 3 adds `scene3d.shadow` to `compiled_names()`, frame 4 adds `scene3d.shadow_mask`. (3) The same with `casters_once_any`: it fails, naming frame 4 and `scene3d.shadow_mask` | the base (its names, target and caster lists before the check); `casters_once_any` (by test 3, and test 2 fails on it); a check that returns before a scene's first caster gets its pipeline |
| `#2657.92acfd65` | AC6, sway | `sway.rs` (3 tests) | The render crate's own sway tree (#2016's) and its still twin (`enabled: false`). Noop: frames at t = 0, 0, 0, 1.25 s; frames 2 and 3 (params held) hand the queue as many command buffers (`command_buffers`) and begin as many compute passes as the twin's; guard: frames 1 and 4 begin at least one compute pass more than the twin's. Metal: one renderer draws t = 0, 0 and 1.25 s with `draw_offscreen`; frames 1 and 3 differ in at least 10 pixels and each frame's FNV-1a 64 hash equals the base's (`fixtures/sway-hashes.json`). The planted `sway_first_frame_only` run fails naming frame 3 | the base (1 command buffer and 1 compute pass for sway in each held frame); a sway pass that never runs again after skipping (the planted renderer, frame 3's hash); one that skips with params that changed; one that draws the tree elsewhere than the base did |
| `#2657.13a91f2f` | AC7, Metal suites | none | Run 422, 425, 446, 419, 2016 and 1285 unchanged (Run them) | — |

Each test also fails if the device raised an error. None can pass on a renderer that draws nothing: AC1's guard needs
the side meshes uploaded, AC2 needs 1,000 scans and the base's four matrices, AC3 needs every material's maps bound
and is a ratio of counts that must exist, AC4 checks the scene has its band, its water and 10,000 solids, AC5 needs
both pipelines made and made in the frames that gain them, and AC6 needs the sway pass in frames 1 and 4 and the
base's pixels.

## Readings where the issue leaves a choice

- **"On the noop lane"** is wgpu's noop backend (`Backend::Noop`), the backend `scripts/lanes.mjs`'s `noop` lane runs.
  The tests live in the render crate, not `deep-gpu`, since they drive its renderer; they run wherever `cargo test
  -p deep-scene3d-render` runs.
- **A deforming solid** is one whose motion blur evaluations carry pre-skins (`MotionSolid::meshes`), vertex for vertex
  with its mesh at t, as `deep-gpu-layer`'s `blur::motion` hands them over where a surface deforms with its topology
  held. The test builds them from the pot's own mesh (scaled about its origin), so the renderer's mesh at t holds and
  frame 1 alone builds it. "A side mesh's" index buffers and tangents are what the frame makes beyond its rigid twin,
  the same frame without pre-skins; at the base the twin makes none and the deforming frame 4 index buffers (two
  sides for blur, two for the velocity target), which the failure names.
- **"Scans each caster's vertices once"** is the caster pass of a whole prepare: the scans of casting meshes the
  renderer makes for the cascades' caster corners, counted where it makes them, exactly one per caster. Other reads of
  a mesh's bounds (the batches' set bounds, the tie ranks) are not the cascades' and are not counted. Both prepares
  are read; the second is the same scene again.
- **"Its cascade matrices"** are the light clip matrices of the key sun's cascades (`Counts::shadow_maps`' third
  member), compared as the bits of each f64. They are CPU numbers, the same on any machine; the fixture was recorded
  from the base's run of this test with the probe (Base runs).
- **AC3's ratio over 15 alternated rounds** is the median of the 15 rounds' ratios: one outlier round doesn't decide
  it. A frame is the renderer's own work: the scene's evaluation and texels are made before the count starts. The
  frames orbit the camera, so each round's frame is a new view.
- **AC4's whole prepare** is the third, after two that build the meshes, pipelines and targets each scene needs once
  (the water's and the proxy's among them); "the same scene with neither" keeps the ball and the pool, without the
  band and with a plain material, so both scenes have 10,000 solids.
- **AC4's water part is a pool, not a planar lake.** A planar water part gets a mirror of its own (scene3d's
  `mirror::own`), and the mirror draws a whole mirrored view of the scene each frame through a renderer of its own
  (`mirror::view` copies the scene, and that renderer's prepare places and levels its copy again). The issue's
  finding (D1) is about the level-of-detail and dry copies, not the mirror, so the part is a 20 × 6 × 20 m box of
  water, which isn't planar and has no mirror; the test checks the scene has none. The mirror's own copies are a
  finding for a follow-up, not tested here.
- **What the base allocates for AC4.** One clone of this scene asks for 14,124,594 bytes. Measured at the base with
  this file's fixture and allocator (a diagnostic this job ran and removed): the third prepare with neither asks for
  163,316 bytes; with the water part alone, 14,289,232 (one copy: `dry`); with the band alone, 45,480,199 (3.2
  copies: `chosen`, and scene3d's `lod::resolve`, which keeps the unresolved layers as `scene.sources`, a second copy,
  and rebuilds each layer's solid list); with both, 59,606,115, which the test reports as 4.21 copies. So "two copies"
  in the issue counts the two `scene.clone()` calls; the bytes are about twice that. The limit is the issue's (under 1
  MiB): a change meets it by applying the choice and the dry set without copying the scene or its layers, or, as the
  scope allows, by keeping the copy while the choices and the scene hold (the fixture's scene and camera hold, so the
  third prepare could reuse what the first made).
- **AC5's "allocates nothing in `ensure_casters`"** is read across the method itself, called right after a whole
  prepare with that prepare's scene (surface 5): no allocation at all, of any size. "The second kind" is the
  mask-alpha casters' pipeline, gained after the opaque one exists.
- **AC6's "parameters hold"** is the same t again under a still camera. "Differ by pixel" is at least 10 pixels of 160
  × 120. The hash is FNV-1a over the BGRA8 bytes `draw_offscreen` reads back; the base's hashes are this Mac's GPU's
  (the fixture names the adapter, `Apple M5 Max`), so on another GPU the test reads INCONCLUSIVE rather than
  comparing. At the base, frames 1 and 2 (the same t) hash alike, and frame 3 differs.

## Not tested

The issue's scope line "each cascade then looks each caster up by ID three times" / "each caster looked up once" (no
criterion counts lookups); a scene whose level of detail or water copy is kept while it holds (the scope allows it;
AC4 judges heap per prepare either way); the copies a planar water part's own mirror makes (Readings); what a whole
prepare allocates outside `ensure_casters`; times, GPU memory and
the instruction budget lane (`scripts/perf.mjs`); the web player.

## Base runs

`BASE-FAILURE.txt` holds two runs at the base, `3f02bf52b`, with the six `[[test]]` entries above added: run 1 as the
base stands (the four files that use a new surface fail to build, naming it; `maps_lookup.rs` and `copies.rs` fail
their assertions), and run 2 with the surfaces above added to the base with its behavior unchanged and the two planted
switches wired, a probe this job reverted (it shows each count at the base and each plant failing as its test needs).
The fixtures were recorded from an earlier probe run of the same tests and checked by run 2 (AC2's matrices and AC6's
three hashes equal them there). A third run shows AC3's limit can be met: the same probe with `by_index` reading a
map from index to group passes `maps_lookup.rs` (median ratio under 1.1, against 1.606 at the base); that patch was
reverted too.
