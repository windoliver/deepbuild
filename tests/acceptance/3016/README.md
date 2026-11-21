# Acceptance tests for #3016: a mirror, a view inset and a look region draw the view's own scene

Written first, from issue #3016 (its Scope, nine acceptance criteria and Proof line), the design sections it links
(`node scripts/design-section.mjs --issue 3016`: Material: mirror, Inset, Look `look@1`: regions and edges, Material:
texture maps, The cost model, GPU surface, Numbers version 0 has to hold) and the merge base `b6b99ad8c` ("Merge pull
request #3003 …"), by a job that never saw an implementation. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read at the base: `crates/deep-scene3d-render` (`renderer.rs`: `Renderer`, its `meshes`, `maps`, `env`,
`log`, `counts`, `mirrorer`, `views`; `mirror.rs`: `Mirrorer` and its own `view: Box<Renderer>`; `lib.rs`: `prepare`,
`prepare_views`, `mesh`/`built_mesh`, `turn`/`free_unused`, `log_new`; `created.rs`: `Created`, `Log`; `module.rs`:
`Counts` with `env_builds` and `meshes_built`; `maps.rs`: `Store`, `TEXTURES`; `mesh.rs`: `MESHES`, 15 floats a vertex;
`held.rs`: `of`; `planted.rs`; `tests/held_memory.rs`, `tests/evaluate_alloc.rs`), `crates/deep-gpu` (`counted.rs`:
`Counts`/`Reading`, pipelines kept per device by content; `device.rs`: `Backend::Noop`; `memory.rs`), `crates/deep-canvas`
(`gauge.rs`: process-wide gauges; `cost.rs`), `crates/deep-canvas-scene3d` (`mirror::view`, `views::seen`, `gltf.rs`,
`frames.rs`, `light.rs` maps and texels), `crates/deep-gpu-layer` (`live.rs`'s estimate through `held::of`,
`liveview.rs`'s warm-up and `Looked`), `crates/deep-show` (`query.rs`'s `cost_reply`, `sizes.rs`), and the suites
`tests/acceptance/1903`, `1801`, `2189`, `465`, `506`, `462`, `166`.

## Run them

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
# noop lane (criteria 1, 6, 9): any machine
scripts/lease nice -n 10 cargo test --locked -p deep-scene3d-render --test acceptance_3016_noop -- --test-threads=1
# heap (criterion 4): any machine
scripts/lease nice -n 10 cargo test --locked -p deep-scene3d-render --test acceptance_3016_heap
# Metal (criteria 3, 7 and criterion 5's inset frame): a Mac; BLOCKED without a GPU
scripts/lease nice -n 10 cargo test --locked -p deep-scene3d-render --test acceptance_3016_metal -- --test-threads=1
# the new surfaces and the plants (criteria 2, 5, 6, 7): noop and Metal
scripts/lease nice -n 10 cargo test --locked -p deep-scene3d-render --test acceptance_3016_views -- --test-threads=1
# criterion 5's four suites (Metal, hours) and criterion 8's deep_query (builds deep-show)
npx vitest run frames.test.ts --root tests/acceptance/3016 --no-file-parallelism
npx vitest run query.test.ts --root tests/acceptance/3016
```

The noop, Metal and views files read process-wide gauges or the device's allocated size, so their tests take turns on a
mutex; `--test-threads=1` only saves the waiting. `scripts/lanes.mjs` needs `tests/acceptance/3016/` in its `alone` list
(frames.test.ts runs four Metal suites one after another, for hours, and must have the GPU to itself; query.test.ts
builds `deep-show` and runs a cargo test); this README is the instruction, the implementer makes that edit.

## Fixtures (fixture.rs; nothing large is committed)

- **The heavy scene** (criteria 1, 2, 3, 7, 8): at 320 × 240, four `mesh.asset@1` items, each its own 100,000-triangle
  grid (a GLB written at test time: 250 × 200 quads, 50,451 vertices, 300,000 u32 indices; rippled by its index so each
  is its own `Shape::Built`), each under a material whose `maps.base_color` is a 2,048 px map: RGBA8 sRGB with all 12
  mips, 22,369,620 B, handed to the renderer in `Scene::texels` as the decode worker hands a PNG's texels over. A 40 m
  floor plate, a shadowed sun over materials (so the key sun draws through its cascades) and a sky whose environment is
  filtered from the sky (`environment: {from: "sky", size: 256}`). Opened plain; with the floor a mirror; with the mirror
  and two view insets `pip_a`, `pip_b` (`inset@1` on two `display@1` faces, `view: {camera}`, no `include`, so each keeps
  every item: 304 × 184 px each); or with an eye inset `portal` (`view: {map: eye}`). Asset keys are hash-shaped
  strings; nothing at the base checks a key against its bytes. criterion 8's TS side writes the same grid and 2,048 px
  PNGs into the evidence store under their real hashes.
- **Ten items** (criterion 6): ten small meshes (12 × 12 quads) of their own, each with a 256 px map of its own, under the
  heavy scene's sun and sky, a display, and a view inset `pip` that keeps the collection `kept` (`item3`, `item7`); its
  twin keeps the display and has no inset.
- **Seventy items** (criterion 6's plant): 70 small meshes of their own (past the mesh cache's 64 entries), a mirror
  floor and a view inset that keeps every item but `item69` (`exclude: ["odd"]`).
- **10,000 solids** (criterion 4): 9,998 boxes, a floor and a display (so the layer is culled on the GPU), with the floor
  a mirror and one view inset keeping every item, or with neither.
- **mirror_cull** (criterion 5's first plant): 300 small boxes (a layer culled on the GPU) on a mirror floor, the
  camera at (0, 5.7, 8.2) looking at the origin, and a 1 m box `odd` at (0, 3, −11.8): above the top of the camera's
  frustum, its reflection inside it; the sun casts no shadow, so `odd` shows only in the mirror.
- **inset_cascades** (criterion 5's second plant): the camera close on a display whose view inset `pip` looks from
  (40, 6, 12) at five boxes 40 m away under a shadowed sun: outside the view's frustum, so only the inset's own cascades
  cover them. `fixtures/inset-cascades.json` holds its first frame's FNV-1a hash on the merge base and the model it
  was drawn on.
- **fixtures/base-frames/** (criterion 5): every frame hash the four suites drew on the merge base, written by
  `frames/record-base.sh` (run from the checkout root on the merge base), with the machine's model in `machine.json`.

## Surfaces

Read through surfaces the base has: the counted device's `Reading` (`uploaded`), `Renderer::mirror_px`,
`Renderer::counts` (`draws`, `meshes_built`, `env_builds`), the gauges `Renderer::meshes` and `Store::textures`
(`deep_canvas::gauge::all`), `deep_gpu::memory::{drain, allocated}`, `held::of`, `draw_offscreen`, `deep-show run`'s
deep_query `cost`, and `deep-gpu`'s replies' `pixel_hash`.

New, for the implementer to add (each the smallest the criterion needs); `views.rs` doesn't compile until they exist:

| Surface | Shape | Meaning |
|---|---|---|
| `created::Log::made` | `pub fn made(&self) -> impl Iterator<Item = &Created>` | Every pipeline the log holds, the warm-up's included, in the order made. |
| `Renderer::second_views` | `pub fn second_views(&self) -> Vec<(String, &Counts, &created::Log)>` | Each view this renderer drew beside its own in its last frame, by name: `mirror`, `inset <id>` for each view inset, `inset <id> mirror` for an inset's mirror; with that view's own counts this frame (its `draws`, `meshes_built`, `env_builds`) and its own pipeline log. A view's log lists the pipelines that view made, and its `env_builds` the environment cubes that view prefiltered: a pipeline or cube made once for the scene is in the log or count of the one view that made it, never again in another's. |
| `Planted::mirror_compiles_own` | `bool` | Criterion 2's wrong program: the mirror's view compiles its own pipelines at its first frame, as each renderer did at the base, instead of drawing with the scene's. |
| `Planted::mirror_takes_view_cull` | `bool` | Criterion 5: the mirror's view draws the view's culled lists, not its own. |
| `Planted::inset_takes_view_cascades` | `bool` | Criterion 5: a view inset shades with the view's cascades, fitted to the view's frustum, not its own. |
| `Planted::frees_by_last_turn` | `bool` | Criterion 6: the shared mesh and map caches start a turn at each view's prepare, so past a bound what an earlier view drew this frame is freed when the last view to prepare didn't draw it. |
| `Planted::estimate_maps_per_view` | `bool` | Criterion 7: the estimate counts the scene's maps once for each view that draws them. |
| `held::of_planted` | `pub fn of_planted(scene: &Scene, planted: &Planted) -> Held` | The estimate under `planted`; `held::of(s)` is `of_planted(s, &Planted::default())`. |

Each `Planted` field is reachable only by setting it, as the proof binary's `--planted` does; the shipped program never
reads one set.

## Criteria to tests

IDs: `criterionId` in `scripts/proof-change.mjs` over each criterion's text. Each test's message starts with its ID.

| ID | Criterion | Tests, and the wrong programs each fails on |
|---|---|---|
| `#3016.f4add153` | 1: uploads of the three scenes ≤ 1.05 × plain, from the counted device | `noop.rs` `ac1_a_mirror_and_two_view_insets_upload_the_scene_once`: each scene on a fresh noop device; bytes uploaded from before the renderer is made to the end of its first frame. Guards: the plain scene uploads at least its four maps' and meshes' bytes; the mirror's picture is drawn; each inset keeps every item and the view draws its window. Fails on the base, naming the bytes. |
| `#3016.af11fa84` | 2: each pipeline once by feature set, target and sample count; the environment filtered once | `views.rs` `ac2_each_pipeline_is_made_once_and_the_environment_filtered_once`: warm-up at check (`log.warming`), then the first frame; across the view's log and each second view's, no `Created::key` (name, feature set, target, sample count) twice and none made at the first frame; the `env_builds` of all views together equal the plain scene's (at least 1); every view draws the four meshes; the second views are the five the scene names. `ac2_planted_mirror_compiles_its_own_pipelines_fails_naming_the_pipeline`: `mirror_compiles_own` fails it naming a pipeline. Fails at the base by not compiling (BASE-FAILURE.txt). |
| `#3016.127ccb4d` | 3: on Metal the third holds ≤ plain + each extra view's own, within 4 MiB | `metal.rs` `ac3_…`: see Readings. Fails on the base, naming the bytes and the copies. |
| `#3016.151aa36c` | 4: heap of a whole prepare, 10,000 solids, mirror + one inset, < plain + 1 MiB | `heap.rs` `ac4_a_mirror_and_a_view_inset_copy_no_scene`: the third prepare (after two warm frames) on the noop lane, counted as `evaluate_alloc.rs` counts. Fails on the base, naming the bytes. |
| `#3016.548510a3` | 5: the four suites' frames hash as on the base; two plants | `frames.test.ts` (every frame of 465, 506, 462, 166 against `fixtures/base-frames`); `metal.rs` `ac5_a_view_insets_frame_hashes_as_on_the_merge_base` (the inset-cascades frame against its base hash); `views.rs` `ac5_a_mirror_draws_what_only_it_sees` and `ac5_planted_mirror_takes_the_views_culled_lists_fails_naming_the_item` (`odd`), `ac5_planted_inset_takes_the_views_cascades_fails_naming_the_frame`. Passes on the base by construction (the base is the reference). |
| `#3016.bac3f522` | 6: an inset keeping two of ten uploads nothing the view doesn't draw, frees nothing the view draws when removed; plant | `noop.rs` `ac6_a_view_inset_keeping_two_of_ten_items_holds_no_mesh_or_map_of_its_own`: with the inset the gauges hold exactly the view's distinct meshes and its ten maps; for two frames after the inset is removed, no mesh is built and no map's bytes are uploaded, and the view's meshes and maps are still held. Fails on the base (the inset's own copies). `views.rs` `ac6_a_mesh_any_view_drew_this_turn_is_kept` and `ac6_planted_cache_freeing_by_the_last_views_turn_fails_naming_the_mesh` (`frees_by_last_turn`, naming `item69` or `floor`). |
| `#3016.a8b1d957` | 7: the estimate within 10% of the device's peak for mirror, eye inset and third; plant | `metal.rs` `ac7_the_estimate_counts_what_each_view_holds`; `views.rs` `ac7_planted_estimate_counting_the_maps_per_view_fails_naming_the_bytes`. Fails on the base, naming the inset. |
| `#3016.102eb480` | 8: deep_query's cost names each asset once, within 10% of the device's bytes for it | `query.test.ts` with `noop.rs`'s ignored reading `ac8_device_bytes_reading`. Fails on the base (a copy per renderer). |
| `#3016.b66dee2c` | 9: the three Cost lines say what a second view holds; the design links and names lane passes | `noop.rs` `ac9_the_cost_lines_say_what_a_second_view_holds`: each of the three sections' `**Cost:**` line says what the view holds (`hold`), its own targets (`target`) and the scene held once (`once`, `share(d)` or the like); `node scripts/design-links.mjs` exits 0 (BLOCKED offline). Fails on the base. |

## Readings where the issue leaves a choice

- **"Upload"** is the counted device's `uploaded` (buffer initial contents, `create_texture_with_data`, queue writes),
  from before the renderer is made to the end of its first frame, on a fresh noop device per scene. 1.05 × is against the
  plain scene's figure.
- **"Read from the renderer's pipeline log"**: the counted device keeps pipelines by content, so its `pipelines` count
  doesn't show a second renderer's copies; the renderer's `created::Log` does. A pipeline is its `Created::key`
  (name, feature set, target, sample count). "Created once" is: across the view's log and every second view's, each key
  once, and nothing made at the first frame after the warm-up (#432), so the plant that compiles the mirror's pipelines
  at its first frame fails either way.
- **"Filtered once, read from `env_builds`"**: the sum over the view and its second views, each counting the cubes it
  prefiltered (Surfaces), equals the plain scene's. The plain scene's is at least 1, so a renderer that filters nothing
  fails.
- **"Each extra view's own targets, stored samples, cull and cascades"** (criterion 3): for each extra view, at its size
  (the mirror at half the frame, each inset at its `View::size`, an eye inset at the frame's size, each inset's mirror at
  half the inset's): 48 B a pixel (linear 8, IDs 4, depth 4, and four stored samples of the IDs in two 16-bit halves
  and of depth, 32), as `held.rs` counts them; no cull (no layer of the scene is culled on the GPU); and under the
  cascaded sun its four 2,048² Depth32Float cascades, 64 MiB. The five extra views of the third scene come to 5 × 64 MiB
  plus 1.4 MiB of targets; 4 MiB is the drafted tolerance on top.
- **"The device's peak"** (criterion 7) is what a fresh renderer holds on the device (`held_memory.rs`'s reading: the
  device's allocated size, drained, less before) at the most of two frames. **"The check's GPU memory estimate"** is
  `held::of(scene)` at the scene's size, the part of the live check's `Shape` the renderer holds (the slots and the
  upscale are no renderer's). "Holds nothing for a view inset" is read as the estimate's figure for the scene less the
  same scene without its insets, against the device's same difference; that comparison names the inset.
- **"The scene with a mirror"** is criterion 1's second scene; **"the scene with an eye inset"** is the plain heavy scene
  with one eye inset keeping every item; **"the third scene"** is criterion 1's.
- **"The bytes the device holds for it"** (criterion 8) is the meshes' and the maps' gauges' bytes (the bytes their
  holders keep on the device) once the third scene's first frame is drawn, divided by four, since the four meshes are
  one size and so are the four maps. Note: at the base `deep-show`'s sizes count a mesh vertex at 32 B while the renderer
  uploads 15 floats, 60 B, a vertex; the criterion asks for the device's bytes within 10%.
- **"A whole prepare"** (criterion 4) is `Renderer::prepare` of the evaluated scene, the third on one renderer, so the
  first-frame builds are behind it and what remains is what every frame allocates.
- **"Every frame of the four suites"** (criterion 5) is every `pixel_hash` any child process of those suites prints
  while each runs whole as its README runs it, but the suites' own planted programs' children (`--planted`): those are
  wrong programs, not the renderer, and 166's `water_foam_keeps_state` draws other frames from run to run on the merge
  base itself (BASE-FAILURE.txt). A frame the base drew that a run doesn't draw fails, so a suite that stops early never
  passes. Running the suites rewrites their own evidence (506 rewrites `docs/evidence/506/lamp-card.png`); restore it
  after a run. The planted programs of criterion 5 are read on two scenes of this
  suite's own (mirror_cull, inset_cascades), since the four suites run without them.
- **The design** (criterion 9): "says what a second view holds" is read as the Cost line naming what the view holds,
  its own targets, and the scene held once; "the design links and names lane" is `scripts/lanes.mjs`'s `design links
  and names` (`node scripts/design-links.mjs`).

## Not tested

A light's own shadow map shared by two views, the IES and DFG tables, terrain tints and 2D inset pictures one per scene
(Scope lines no criterion reads), look regions' renderers (`liveview.rs`'s `Looked`) beyond what 462's frames show, the
cache bounds at 256 MB, the frame budget, and anything timed.
