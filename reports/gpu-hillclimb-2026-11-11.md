# Hill-climb audit: GPU usage, package by package

Base: `435141d51` (main, 2026-11-10 23:01), merged with main at `9d0d58511` before the PR. Branch `audit/gpu-hillclimb-1110`. 5 source files differ from main, +517 −137, of which about 250 lines are three new tests and their helpers.

Seven changes cut what the 3D renderer creates and uploads each frame. None changes a pixel, a pass list or a public count. The rest of what the audit found is listed under [Found and not applied](#found-and-not-applied), with the reason each one waits.

## Measured

Counts on the noop lane, which do not move with load (the machine's load average was between 150 and 600 throughout). The first three rows are `envelope_counts` on `deep-gpu run --backend noop` (the `test-meter` build), 60 frames at 1280 × 720, frames 1 to 59. The last three are the new unit tests' counts on the path the app's view and `deep-show` draw through (`Renderer::prepare` then `Renderer::jobs`).

| What | Base | Change |
|---|---|---|
| #1903's every-pass scene (`docs/evidence/1903/run.mts`): buffers created per frame | 3 (177 over 59 frames) | 0 |
| Same scene: bytes uploaded per frame | 4,096 to 4,224 (245,968 total) | 3,508 to 3,636 (211,276 total) |
| 32 `puff@1` clouds under an orbiting camera: buffers created per frame | 1 (59 total) | 0 |
| Same scene: bytes uploaded per frame | 1,848 typical (109,112 total) | 312 typical (32,312 total); 1,860 on a frame whose back-to-front order changes |
| Puffs, a mirror and a flare through `jobs()`: buffers and bind groups in frame 1 | 5 and 3 | 0 and 0 |
| A post module that hands the output pass its own target: bind groups per frame | 1 | 0 |
| A frame on the moved path with 4 neighbouring records moved: queue writes | 4 | 1 |

Why the counts matter, from wgpu-core 30.0.1's source (`device/queue.rs:662`, `device/resource.rs:1163`): `Queue::write_buffer` makes a staging buffer of its own per call, and a buffer made with its contents makes two (the buffer and a staging buffer). So a buffer created per frame is two device allocations and a copy, and a write per record is one each.

Not measured: GPU time and device memory. No change here is expected to move either by a measurable amount; the memory findings below are the ones that would, and none of them is applied.

## What changed

All in `crates/deep-scene3d-render` unless named.

- **Puffs keep their buffer.** `prepare_puffs` made and filled a new vertex buffer every frame, on the moved path too. The records now live in a `Set`, as every other instance family does: a frame whose puffs keep their order writes nothing, and one that reorders them writes into the buffer it has. `lib.rs`
- **The mirror's overlay binds what it made.** Its uniform and its part-ID buffer are made again only when their values change, and its bind group only when the picture or the ID target does. A frame with no mirror drops the bind group, so it holds no target. `mirror.rs`, `lib.rs`
- **The flare writes its parameters into one buffer.** The buffer and the draw's bind group are made once; a frame uploads the words that changed (`write_changed`). The reduction's bind group is kept while the one target it reads holds. `Flarer::job` takes `&mut self`. `flare.rs`, `lib.rs`
- **The output pass reuses its bind group over a post module's target.** With the effects module attached it made one every frame. The geometry's own target binds as the targets bound it; another target binds as last frame did while it and the covered mask hold. `lib.rs`
- **The key light's frame uniform uploads what changed.** It was written whole every frame a single shadow map is on. `lib.rs`
- **The moved path writes runs.** `Set::write` gathered one queue write per moved record; it now gathers neighbours and `Set::flush` uploads each run once. `instances_written` still counts one per record. `lib.rs`
- **The history uniform is written when it changes.** Once the window is full its count never changes; it was written every frame. `crates/deep-gpu-layer/src/liveview.rs`
- **The counted device also counts queue writes** (`Reading::writes`), which the third test reads. It is not in `envelope_counts`' reply. `crates/deep-gpu/src/counted.rs`

## Verification

| Check | Result |
|---|---|
| The three new tests on main's renderer (only `counted.rs` and the tests added) | fail for the expected reason: `queue writes left 4 right 1`; `bind groups made left 1 right 0`; `buffers and bind groups made left (5, 3) right (0, 0)` |
| `cargo test -p deep-scene3d-render --lib` | 20 pass, the three new ones unchanged since their failing run |
| `cargo test -p deep-gpu -p deep-effects-render` | all pass: deep-gpu 31 and 6 (1 ignored, as on main), `acceptance_1312` 3 |
| `cargo build --bin deep-gpu --features test-meter` | builds, so deep-gpu-layer, deep-effects-render, deep-marks-render, deep-app and deep-replica compile against the edits |
| `cargo clippy -p deep-gpu -p deep-scene3d-render --all-targets` | no warning on a line this change touches. Main's own stay: `over_class.rs:37`, `sway.rs:12`, `lib.rs:6780` |
| `rustfmt --check` on the five files | no finding on a line this change touches. Main's drift in `lib.rs` and `liveview.rs` is left as it is |
| `tests/acceptance/1903/counts.test.ts` (noop, `test-meter` build, on the changed tree) | 6 of 6 pass: no later frame of `separate-items` creates a bind group, a buffer or a pipeline; an unchanged orbit uploads at most 1 KB a frame and a one-item move at most 256 bytes more; the three planted renderers fail |
| On Metal, `cargo build --bin deep-gpu` of the changed tree, one run each: `1285/puffs`; `465/mirror`, `occlusion`, `streaks`, `edge`; `378/move`, `replay`; `418/bloom` | 8 files, 17 tests, all pass: the puffs draw, the mirror's and the flare's pixels hold, a move writes one record and equals a fresh run by pixel hash, and the output reads the effects' target |
| After merging main at `9d0d58511` (36 commits, none in a file this change touches): `cargo test -p deep-scene3d-render --lib` | 20 pass. Nothing else was run again on the merged tree |

Each edit was re-read against its callers after it compiled. Two things were checked by reading, not by a test: a set's pending run is always flushed before `prepare_moved` returns (no return sits between its write loop and the flush, and a whole prepare never leaves a run behind), and the puffs' set passes a throwaway generation because no draw key names their buffer.

## Not run

- **Most pixel suites did not run.** Eight files ran on Metal (above). The rest of `tests/acceptance/378`, `418`, `465` and `1285`, and all of `380`, `422` (the castle's clouds, the cascades) and `419` were not run. The 465 files left out are `ghosts` (1,000 captured frames), `budgets` and `taste`.
- **`node scripts/affected.mjs` was not run.** `--list` selects 17 parallel and 422 alone vitest files, 14 node files, 33 timed files, 16 slow files and `cargo test` for ten crates. At this load that is many hours. No WIDE or INCONCLUSIVE line exists to report.
- `cargo test` for deep-gpu-layer, deep-show, deep-app, deep-marks-render, deep-replica, deep-panel-host and deep-text-render was not run.
- Builds ran through `scripts/lease`, which said each time that no hub is set up on this Mac, so they ran unleased, at `nice 19` with six jobs. The throttle table's build queue held over 25 requests and was not used.

## Scope: what was audited

Read in full or along the whole frame path: `deep-gpu` (`view.rs`, `encode.rs`, `surface.rs`, `counted.rs`), `deep-scene3d-render` (`lib.rs`'s prepare, moved and jobs paths, `mirror.rs`, `flare.rs`, `motion.rs`, `print.rs`, `sway.rs`, `oit.rs`, `targets.rs`, `held.rs`, `water.rs`'s prepare), `deep-effects-render` (`frame.rs`, `runner.rs`, `docops.rs`'s plan), `deep-marks-render/src/gpu.rs`, `deep-gpu-layer` (`liveview.rs`, `envelope.rs`'s counts), `deep-show` (`scene3d.rs`, the 3D branch of `window.rs`, `export_shard`), `deep-app/src/gpu_view.rs`, `deep-canvas-scene3d` (`frames.rs`, `mirror.rs`'s view).

Searched for device calls, not read line by line: the rest of deep-scene3d-render (`cull.rs`, `env.rs`, `local.rs`, `ao.rs`, `sss.rs`, `op.rs`, `maps.rs`, `surface.rs`, `status.rs`), the rest of deep-gpu and deep-gpu-layer, deep-show, deep-marks-render's `macos.rs` and `raster.rs`.

Not audited: the vendored GPUI crates (`vendor/gpui-pre*`), and the crates that reach the GPU only through GPUI (deep-marks-gpui, deep-text-gpui, deep-text-render, deep-panel-host, deep-replica, deep-app beyond `gpu_view.rs`).

No GPU work: the 37 folders under `packages/`. `@deepbuild/leases` and the hub's `heavy.ts` lease a GPU as a resource, and `doctor.ts`, `canvas-doctor.ts`, `runs.ts`, `hosts.ts` and the gate's scheduler name one; none draws or allocates. They were searched, not read. The other Rust crates (the canvas core and modules, codecs, hook, logic, relay, sandbox, text shaping, typeset, physics) hold no device call.

## Found and not applied

"Needs a decision" means the fix changes something a person or a test can see. Line numbers are at `435141d51`.

### deep-scene3d-render

- **A mirror renders at half the full size, not half the internal size.** `mirror.rs:145` takes `half(scene.size)`. Below internal scale 1 the main view shrinks and the mirror does not: at the showpiece's base rung (scale 0.5) the mirrored view has as many pixels as the main view. #2189's table puts the mirror's own renderer at 213.8 MB of the every-pass scene's 659 MB at 3456 × 2234; its targets, stored samples and cull would be a quarter of their 137.6 MB at half the internal size, and the mirrored pass would shade a quarter of the pixels. Needs a decision: the reflection gets coarser on live frames below scale 1. Canonical renders, at scale 1, would not change.
- **The mirror's renderer makes a glyph atlas it never reads** (8.7 MB): `mirror::view` clears the labels, and every `Renderer::new` makes the 8 × 1024² atlas (`lib.rs:3287`). Making the atlas with the first label would also save it in every view with no label. Not applied: `held.rs` counts the atlas in #2189's estimate, whose criterion (within 10% of the device's peak) is checked on Metal with a release build, which was not run here.
- **What a frame stops using stays allocated for the view's life.** The mirror's renderer after a revision removes the mirror (`lib.rs:4710`); motion blur's velocity, depth and resolved targets, 16 bytes a pixel, after blur turns off (`motion.rs:489`); the sun's cascades, 67.6 MB (268 MB at the climb's 2× rung), after its shadow turns off (`lib.rs:3723` returns before anything frees the texture). The effects chain was given this fix on Nov 9. Each needs the estimate in `held.rs` kept in step and a Metal run.
- **Motion blur makes two buffers and four bind groups a frame**, and the core velocity target two and one more (`motion.rs:432`, `:479`). It also uploads each deforming solid's two side meshes whole, with tangents and index buffers nothing binds (`motion.rs:214`; finding G3 of Nov 9, still open).
- **The print pass makes two buffers and a bind group inside its encode job** (`print.rs:368`), and **the water makes a path buffer, and a uniform and a bind group per part, every frame** (`water.rs:533`, `:720`).
- **`mod.sway@1` submits a command buffer of its own every frame** (`sway.rs:186`) and writes each mover's parameters whether or not they changed.
- **The mesh cache never evicts** (`lib.rs:4397`; M1 of Nov 9): a mesh that deforms with time leaves a vertex and an index buffer behind per frame. Needs a decision: evicting changes `meshes_built` when a shape returns.
- **The key light's single shadow map is redrawn every frame**, with no key (`lib.rs:7038`). Needs a decision: keying it changes which frames list `scene3d.shadow`, which tests read.
- `adjust_buffer` and `lobe_buffer` are written whole on every whole prepare that has entries (`lib.rs:4670`); `sss.rs:426` and `op.rs:90` write a uniform every frame. Each is one small write.
- `draw_offscreen` makes a snapshot texture and a read-back buffer the size of the frame, submits twice and waits, on every call (`lib.rs:9079`, `:1454`). `deep-show` calls it per 3D frame of an export (`export.rs:88`).

### deep-effects-render

- **Every pass of every operator makes two uniform buffers and two bind groups each frame** (`Runner::bind_with`, `runner.rs:260`): the shipped effects (`frame.rs:290`, `:414`), sparks' draw (`frame.rs:450`) and each document operator (`docops.rs:1533`, `:1615`, `:1631`). The glow alone is a pass per level down and up (up to six levels) and a mix. Not counted here: no measured scene had an effect on. The fix is a slot of persistent buffers per pass, owned by the caller, since one runner serves several passes and views. It touches every caller, so it is its own change.
- A compute output's clear makes a buffer and a bind group per texture per frame (`docops.rs:1506`, `mips.rs:146`; 07 F7 of Nov 9, still open).

### deep-gpu-layer

- **The live view prepares a mirror and a flare every frame and never draws them.** `liveview::View::draw` records the cull, cascades, occlusion, geometry, operators, history, output, outlines and labels (`liveview.rs:957` to `:1035`). The mirror's, flare's, water's, glass's, per-pixel resolve's, subsurface's and motion blur's passes are only in `Renderer::jobs`, which the live view does not call. The counts show it: on main the every-pass scene made the mirror's two buffers and the flare's one every frame and none of their bind groups. So the 213.8 MB of the mirror's renderer in #2189's table drew nothing in that run. Verified by reading and by those counts, not on Metal. Whether the live view should draw them or skip their prepare is the owner's call.

### deep-gpu

- `View::render` submits a second, empty command buffer per frame on the zero-copy path (`view.rs:392`). `Times::handoff` is measured between the two callbacks, so one submit changes what it reads.
- The copy path keeps a read-back buffer per slot: 92.7 MB for three slots at 3456 × 2234 in #2189's table. The app's path on macOS is zero copy; the envelope plays on the copy path.

### deep-marks-render, deep-show

- `Vello2d::picture` and `read_back` make a texture and a read-back buffer per call (`gpu.rs:455`, `:495`), as `draw_offscreen` does.
- `Gpu3::draw` clones the document and evaluates it whole per call (`scene3d.rs:52`). CPU, not GPU.

### deep-canvas-scene3d

- A document off the fast path is cloned and its motion program compiled again every frame (`frames.rs:261`; C2 of Nov 9, still open). CPU, listed because it runs before every whole prepare.
