# #3444: what the GPU backend adds that nothing of ours declares

Issue #3444 asks for three readings of what wgpu does on our behalf on Metal: what a pipeline's shader translation
costs on a cold start, what the validation pass before indirect draws costs on the forest, and how many timestamp
query sets the app's device holds against Metal's 32. It changes no renderer code and no budget. Everything here
was read on main at `390c3f390` on one reference Mac, a Mac17,10. The proof is `tests/acceptance/3444/`, written
blind from the issue before this spike.

**The answers.**

- **Pipelines.** With nothing kept by the system, the every-pass scene's 46 pipelines take 3,083.87 ms inside
  pipeline creation, of 3,223.12 ms to the first settled frame. naga's override step is 23.43 ms of that and its
  Metal source writer 14.85 ms. Metal's own compile is 3,039.98 ms. So translation is more than a fifth of the
  first settled frame (95.5%), and almost all of it is a compile the split doesn't touch. The split-module branch
  draws the same pixels, returns 4.34 ms of the override step and makes 32 more shader modules, which cost it
  51.89 ms. Keep the scene module joined. The task the readings justify is another: every pipeline is made on one
  thread, one after the other.
- **Indirect validation.** The flag adds 0.021 ms to the geometry pass's 0.068 ms of encode on the forest (30.4%),
  and nothing the readings can see on the GPU. Its checks hold by construction for every draw we make. Turn it off
  on the app's instance, with a bound of our own on the one count the GPU writes.
- **Query sets.** One window holds 1 live timestamp query set, four windows 1, a film's export 0. The 33rd set on a
  device of its own loses that device. No task: the largest count is 1 against the drafted 16.

## Files

- `run.mjs`: every reading. Its header gives each mode's command and what each number is. A run is one fresh
  process of a build that carries the probe, under the machine's GPU lease, with its load at the start and the end.
- `probe/`: the probe, three patches on the pinned `wgpu`, `wgpu-core` and `wgpu-hal` 30.0.1, and how a build takes
  them (`probe/README.md`). The repository's own crates are built unchanged against the patched copies.
- `split-module.patch`: the split-module branch, a patch on main. It was applied only in a checkout kept for the
  build.
- `own-device/`: the one-more-than-32 probe, a crate outside the workspace that opens a device of its own.
- `out/`: each run's output as `run.mjs` wrote it, and beside it the probe's rows its numbers were read from
  (`*.probe.jsonl`). Each output names its commit, its binary by sha256, the machine and the adapter.
- `analyze.mjs`: `node docs/spikes/3444/analyze.mjs` rewrites `record.json` from `out/`, and
  `node docs/spikes/3444/analyze.mjs tables` prints this file's tables.
- `record.json`: what the acceptance tests read: each kept run with its sha256, and the tasks.
- `base-runs.txt`: the six files of the blind suite run at the base, before any of this existed.

## How the readings were taken

- **The probe.** wgpu-hal does the three steps the issue names inside `load_shader`, with no hook, so the probe
  times them there: `process_overrides`, `msl::write_string` and `newLibraryWithSource`, a row for each stage of
  each pipeline. The time around a pipeline's call is read in `wgpu::Device::create_render_pipeline` and
  `create_compute_pipeline`. Metal's making of the pipeline state is a fourth time, shown in the table under
  compile as its own stage row in the outputs.
- **A cold start.** `deep-gpu`'s `envelope_opens` in a fresh process, #1903's first frame wait: the scene checked
  and opened, from the start of its check to its first presented frame. That is `first_settled_ms`. The process's
  own start and the device's opening come before it and are not in it.
- **Nothing kept.** The system keeps what Metal compiled, by its source, for every later process of the user. A
  second start of the same build then compiles almost nothing, as the second table below shows. #1903 defines the
  wait "with no kept caches", so each cold run appends a comment no earlier run wrote to every Metal source
  (`probe/README.md`, `DEEP_3444_UNKEPT`), and Metal compiles each anew, as on a Mac that never drew the scene.
- **The size.** 1280 × 800. Main refuses the every-pass scene at 3456 × 2234 at check: it needs 661.8 MB of GPU
  memory against the showpiece's 512 MB. Pipeline creation doesn't depend on the size. The time after it does.
- **The builds.** Release, for every `deep-gpu` run. The export state ran a debug `deep-show`: a release
  `deep-show` of this main refuses every run at its seal, since `scene3d`'s digest is no longer the one the
  committed kit ledger passed.
- **The machine and its load.** A Mac17,10 (Apple M5 Max, 64 GB, macOS 26B8119) on mains power, shared with other
  sessions. Its one-minute load was 16 to 34 on 18 cores during the runs, and 51 during the three one-more runs,
  whose thermal state read `fair`. No budget window was taken. Every number is a reading from one machine and sets
  no budget, as the issue says.
- **The lease.** No hub runs on this machine, so the lease is the file `~/.cache/deepbuild-gpu/lease`. `run.mjs`
  holds it around each `deep-gpu` and one-more run, and `deep-show` takes it itself for the export.

## 1. A shader translated for each stage of each pipeline

Times in ms, each pipeline's stages summed. `around` is the time inside the call that made the pipeline. A pipeline
made again from a source Metal has just compiled costs it almost nothing, which is why `#2` and `#3` read near 0.

| Pipeline | main override ms | main source ms | main compile ms | main around ms | split override ms | split source ms | split compile ms | split around ms |
|---|---|---|---|---|---|---|---|---|
| `look.history` | 0.41 | 0.28 | 155.62 | 156.57 | 0.27 | 0.26 | 152.12 | 152.99 |
| `scene3d env prefilter` | 0.13 | 0.27 | 84.86 | 85.44 | 0.30 | 0.15 | 83.35 | 83.97 |
| `scene3d.light_clusters` | 0.00 | 0.11 | 22.08 | 22.27 | 0.00 | 0.11 | 17.30 | 17.48 |
| `scene3d.opaque [mesh_vs+mesh_fs] #1` | 2.65 | 1.68 | 622.01 | 626.70 | 2.25 | 2.14 | 572.78 | 577.78 |
| `scene3d.opaque [mesh_vs+mesh_fs] #2` | 2.83 | 1.75 | 0.21 | 5.11 | 2.21 | 1.51 | 0.17 | 4.11 |
| `scene3d.opaque [mesh_vs+mesh_fs] #3` | 2.23 | 1.46 | 0.15 | 4.04 | 2.00 | 1.94 | 0.21 | 4.37 |
| `scene3d.output [out_vs+out_fs] #1` | 0.14 | 0.11 | 74.46 | 74.80 | 0.12 | 0.10 | 63.52 | 63.84 |
| `scene3d.output [out_vs+out_fs] #2` | 0.12 | 0.11 | 0.10 | 0.39 | 0.12 | 0.11 | 0.08 | 0.38 |
| `scene3d.sample_resolve` | 0.05 | 0.05 | 37.35 | 37.55 | 0.04 | 0.05 | 36.12 | 36.31 |
| `scene3d.outlines` | 0.23 | 0.24 | 127.62 | 128.24 | 0.35 | 0.32 | 100.92 | 101.77 |
| `scene3d.labels` | 0.42 | 0.22 | 137.26 | 138.09 | 0.13 | 0.14 | 120.34 | 120.72 |
| `cull` | 0.04 | 0.06 | 8.89 | 9.06 | 0.00 | 0.11 | 66.38 | 66.56 |
| `cull_kept` | 0.07 | 0.07 | 9.36 | 9.57 | 0.00 | 0.18 | 67.79 | 68.10 |
| `occlude` | 0.09 | 0.10 | 118.46 | 118.81 | 0.00 | 0.11 | 94.89 | 95.06 |
| `pyramid_first_ms` | 0.06 | 0.04 | 50.43 | 50.63 | 0.00 | 0.04 | 48.09 | 48.18 |
| `pyramid_first` | 0.05 | 0.04 | 56.61 | 56.76 | 0.00 | 0.03 | 58.03 | 58.11 |
| `pyramid_down` | 0.04 | 0.04 | 74.20 | 74.34 | 0.00 | 0.04 | 74.41 | 74.52 |
| `scan_tile` | 0.06 | 0.05 | 10.20 | 10.38 | 0.00 | 0.15 | 14.97 | 15.20 |
| `scan_add` | 0.07 | 0.03 | 6.23 | 6.39 | 0.00 | 0.09 | 13.61 | 13.76 |
| `compact_count` | 0.08 | 0.05 | 8.66 | 8.92 | 0.00 | 0.10 | 15.00 | 15.16 |
| `compact_scatter` | 0.12 | 0.08 | 9.42 | 9.73 | 0.00 | 0.11 | 16.15 | 16.34 |
| `sort_hist` | 0.09 | 0.07 | 13.43 | 13.65 | 0.00 | 0.13 | 19.92 | 20.11 |
| `sort_offsets` | 0.10 | 0.07 | 13.51 | 13.75 | 0.00 | 0.20 | 16.40 | 16.70 |
| `sort_scatter` | 0.13 | 0.12 | 23.46 | 23.78 | 0.00 | 0.14 | 20.24 | 20.45 |
| `dispatch_args` | 0.07 | 0.03 | 6.82 | 6.99 | 0.00 | 0.09 | 13.40 | 13.54 |
| `mesh_row_vs [mesh_row_vs+mesh_fs] #1` | 2.42 | 2.14 | 596.92 | 601.75 | 2.27 | 1.49 | 560.51 | 564.54 |
| `scene3d.occluders [mesh_row_vs+occluder_fs] #1` | 0.73 | 0.19 | 8.95 | 9.98 | 0.62 | 0.19 | 8.59 | 9.53 |
| `scene3d.occluders [mesh_row_vs+occluder_fs] #2` | 0.74 | 0.20 | 0.06 | 1.07 | 1.00 | 0.40 | 0.15 | 1.70 |
| `scene3d.occluders [mesh_row_vs+occluder_fs] #3` | 0.56 | 0.14 | 0.03 | 0.80 | 0.65 | 0.18 | 0.07 | 0.97 |
| `mesh_row_vs [mesh_row_vs+mesh_fs] #2` | 2.24 | 1.89 | 0.18 | 4.59 | 2.06 | 1.42 | 0.14 | 3.78 |
| `mesh_row_vs [mesh_row_vs+mesh_fs] #3` | 2.59 | 1.55 | 0.23 | 4.59 | 1.96 | 1.83 | 0.24 | 4.26 |
| `scene3d.shadow [mesh_row_vs+shadow_fs]` | 1.03 | 0.27 | 23.18 | 24.60 | 0.84 | 0.22 | 23.23 | 24.45 |
| `scene3d.local_shadow` | 0.00 | 0.02 | 4.92 | 5.00 | 0.00 | 0.02 | 4.86 | 4.93 |
| `scene3d.sky` | 0.82 | 0.19 | 120.95 | 122.11 | 0.68 | 0.20 | 117.88 | 118.89 |
| `scene3d.shadow [mesh_vs+shadow_fs]` | 0.89 | 0.21 | 0.16 | 1.35 | 0.60 | 0.21 | 0.17 | 1.06 |
| `scene3d.mirror [vs+fs] #1` | 0.07 | 0.08 | 85.91 | 86.26 | 0.06 | 0.07 | 83.79 | 84.05 |
| `scene3d.mirror [vs+fs] #2` | 0.06 | 0.07 | 0.07 | 0.25 | 0.06 | 0.07 | 0.10 | 0.29 |
| `scene3d.flare [visible]` | 0.05 | 0.06 | 30.00 | 30.17 | 0.00 | 0.09 | 32.38 | 32.52 |
| `scene3d.flare [emitted]` | 0.09 | 0.07 | 44.47 | 44.68 | 0.00 | 0.10 | 47.25 | 47.43 |
| `scene3d.flare [pick]` | 0.07 | 0.05 | 8.39 | 8.58 | 0.00 | 0.09 | 12.25 | 12.39 |
| `scene3d.flare [vs+fs]` | 0.23 | 0.16 | 22.12 | 22.63 | 0.13 | 0.15 | 21.25 | 21.66 |
| `upscale [full+upscale] #1` | 0.16 | 0.17 | 87.10 | 87.53 | 0.14 | 0.13 | 83.11 | 83.49 |
| `upscale_half` | 0.12 | 0.11 | 149.81 | 150.13 | 0.00 | 0.12 | 140.00 | 140.17 |
| `bilinear` | 0.08 | 0.04 | 50.18 | 50.41 | 0.04 | 0.04 | 40.88 | 41.06 |
| `upscale [full+upscale] #2` | 0.14 | 0.11 | 0.15 | 0.47 | 0.14 | 0.12 | 0.16 | 0.50 |
| `sharpen` | 0.05 | 0.03 | 134.82 | 134.97 | 0.05 | 0.05 | 71.02 | 71.19 |
| **sum of 46 and 46** | 23.43 | 14.85 | 3039.98 | 3083.87 | 19.09 | 15.50 | 2934.25 | 2974.36 |

Main's three times sum to 3,078.26 ms, 99.8% of the 3,083.87 ms around the calls. Its compile column holds
16.04 ms of pipeline states, and the split's 7.98 ms. The split's pixel hashes equal main's on each frame hashed:
frame 0 `7dc9b947c40a4daf2f52da9097369b817a2ff6883893dc748d28dbe22c33dcc9`, frame 30
`245e55b0c8fe2b4f624afffd449e5ee7bf0acd869443f5fb0798d5814166512d`, frame 59
`f83b01917eef57651dcc579b7c40dad5a243d0f16f70a1c8c9d5b095e1203b0a`.

The same two builds with nothing kept, as above, and with the system's compiles kept:

| Cold start | First settled frame ms | Override ms | Source ms | Compile ms | Around the calls ms | Shader modules made | Their making ms | Load |
|---|---|---|---|---|---|---|---|---|
| main, nothing kept | 3223.12 | 23.43 | 14.85 | 3039.98 | 3083.87 | 14 | 14.62 | 34 to 32 |
| split, nothing kept | 3158.45 | 19.09 | 15.50 | 2934.25 | 2974.36 | 46 | 66.51 | 32 to 31 |
| main, compiles kept | 172.26 | 21.74 | 13.78 | 7.83 | 46.78 | 14 | 13.73 | 28 to 28 |
| split, compiles kept | 197.98 | 16.29 | 12.00 | 6.98 | 38.20 | 46 | 57.65 | 28 to 27 |

What the readings say:

- **Metal's compile is the cold start.** 3,039.98 ms of 3,223.12 ms. Nine pipelines take over 100 ms each and
  2,177 ms together. The largest two are one fragment stage, `mesh_fs`, compiled as two feature variants that
  differ in the override `LOBES`: 581.17 ms and 559.08 ms.
- **They are made one after the other.** All 60 calls, 46 pipelines and 14 modules, run on one thread,
  `deep-gpu render`.
- **naga's two steps repeat on every start.** 38.28 ms with nothing kept, 35.52 ms with compiles kept. Kept, they
  are most of what translation still costs: 43.35 ms of a 172.26 ms first frame, still more than a fifth.
- **The scene module's 24 stages cost 19.73 ms of override on main and 17.12 ms split.** The patch cuts a
  pipeline's module down to its own entry points and keeps every helper function. The module still holds its one
  override, so naga clones and compacts all 139 functions for each stage as before.
- **The split makes other modules slower.** A compute stage whose module is cut to its one entry point comes
  back from the override step untouched, so naga never compacts it: 20 stages do on the split, 2 on main. The
  Metal sources of 15 of them grow, `cull`'s from 4,144 to 11,579 bytes, with its compile from 8.89 ms to
  66.38 ms.
- **wgpu makes two pipelines of its own as the device opens**, for the validation of part 2: 60.13 ms and 8.54 ms
  with nothing kept, 18.11 ms and 0.43 ms kept. They are before the first frame's clock starts.

What the split would return: 4.34 ms of 3,223 ms with nothing kept. With compiles kept its first frame read
25.72 ms later than main's. What it would put at risk: 32 more modules to make and hold; a build whose Metal
sources differ from main's in 15 stages by size, so that what the system kept for one build doesn't serve the
other; and a text scanner over WGSL to keep right.

**Recommendation:** don't split the scene module. File a task that makes a cold start's pipelines side by side,
on its own readings.

## 2. A validation pass before indirect draws

#484's forest of 100,000 trees at 960 × 540: 12 frames of warm-up, then its 61 frames, five rounds, the side that
runs first swapping each round. Each cell is the median over the 61 frames. Encode is the time inside wgpu-core's
encode of the frame's `scene3d.geometry` render pass. GPU is the time on the GPU, by Metal's own clock, of that
pass's command buffer and of the buffer wgpu-core puts before it, where the validation's compute pass runs. The
pre-pass columns are that buffer alone, and the pass timer is our own timestamp pair. A frame makes 10 indexed
indirect draws. Each run read the flags back from the instance: 32 on, 0 off.

| Round | First | on encode ms | off encode ms | on GPU ms | off GPU ms | on pre-pass GPU ms | off pre-pass GPU ms | on pass timer ms | off pass timer ms | Load |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | on | 0.065 | 0.048 | 8.223 | 8.344 | 0.058 | 0.000 | 6.328 | 6.466 | 25 to 25, 25 to 22 |
| 2 | off | 0.070 | 0.047 | 8.475 | 8.539 | 0.059 | 0.000 | 6.335 | 6.598 | 22 to 21, 22 to 22 |
| 3 | on | 0.064 | 0.046 | 8.142 | 8.643 | 0.057 | 0.000 | 6.322 | 6.772 | 21 to 24, 24 to 27 |
| 4 | off | 0.068 | 0.048 | 8.174 | 8.541 | 0.057 | 0.000 | 6.322 | 6.693 | 27 to 24, 27 to 27 |
| 5 | on | 0.068 | 0.047 | 8.248 | 8.653 | 0.060 | 0.000 | 6.387 | 6.652 | 24 to 22, 22 to 21 |

- **Encode.** The median of the five differences is 0.0205 ms, of a median 0.0677 ms with the flag on: 30.4%.
  Over a whole frame's passes it is 0.212 ms of 1.098 ms.
- **GPU.** The validation's own buffer takes 0.058 ms. The pass and that buffer together read 0.37 ms less with
  the flag on, in all five rounds, and our pass timer agrees (6.33 ms on, 6.65 ms off). The cause wasn't found.
  Validation is not more than 5% of the pass on the GPU.

Which of its checks our draws already meet, read in the code and not run:

- wgpu checks that the first index plus the index count fits the bound index buffer, that the first instance plus
  the instance count fits every instance-step buffer, and, without the first-instance feature, that the first
  instance is 0 (`validate_draw.wgsl` in wgpu-core). A draw that fails is drawn with zeros.
- Our arguments are `[index_count, 0, 0, 0, 0]`, written once by the CPU (`indirect_args`,
  `crates/deep-scene3d-render/src/cull.rs:443`). The cull pass writes one word of them, the instance count, copied
  from `compact`'s count (`cull.rs:349`, `:423`). `compact` counts the flagged rows of the batch's `n`, and the
  rows buffer the draw binds as its instance-step buffer holds `n` (`cull.rs:593`). So the count never passes it.
- The index count and the two zeros are never the GPU's to write. So the cull pass's output guarantees the
  instance check, and the other two hold for what the CPU wrote.

What turning it off would return: the encode above, the two pipelines at device open, and the bind groups
wgpu-core makes for each buffer usable for indirect calls. What it would put at risk: the same flag validates
indirect dispatches, whose arguments a structural step writes (`dispatch_args`); and a count past the rows would
no longer be zeroed by wgpu. wgpu-hal's Metal vertex stages also check each vertex and instance index against the bound buffers'
lengths (naga's vertex pulling, on in `load_shader`). The spike didn't test what a count past the rows draws with
the flag off.

**Recommendation:** file a task that turns the flag off on the app's instance, as the noop device already does,
with the bound proven by a planted `compact`.

## 3. A cap on timestamp query sets

The count is the device's own: wgpu-hal's `query_sets` counter, read as each submit began. It counts only with
wgpu's `counters` feature, which the probe build turns on. The windows are the `live` call's, headless, each with
one 3D view over 120 frames. The export is a 48-frame 3D film through `deep-show`.

| State | Live timestamp query sets, at most | Reads | Sets alive then |
|---|---|---|---|
| one window | 1 | 240 | live passes x128 |
| four windows | 1 | 240 | live passes x128 |
| export | 0 | 481 |  |

- The one set is the live view's pass timer, 128 queries (`crates/deep-gpu-layer/src/liveview.rs:240`). It is one
  for the app, not one a window. The other ten places that make a set weren't reached in these states.
- **One more than 32, on a device of its own** (`out/one-more.json`): 32 sets were created, the counter reading 1
  to 32. At the 33rd Metal answered `Cannot allocate sample buffer`, wgpu-hal returned an unexpected error, and
  wgpu-core lost the device. No error scope caught anything, and the device did no more work.
- **What the 32 counts.** Sets alive, not queries and not sets ever made. With 4,096 queries a set the device is
  lost at the same 33rd (`out/one-more-4096.json`). With 8 of 32 dropped, 8 more are created and the device still
  works (`out/one-more-drop.json`). Whether two devices of one process share the 32 wasn't read.

**Recommendation:** no task. The app holds 1 of 32. What stays true is that nothing counts them, and that the 33rd
costs the app its one device.

## The thresholds

All three are drafted in the issue. `Reading` and `Of` are worked out from the kept runs: translation is main's
three times against its first settled frame with nothing kept; validation is the median of the five rounds'
differences against the median with the flag on; query sets is the largest of the three states.

| Threshold | Reading | Of | More than | Task |
|---|---|---|---|---|
| translation | 3078.264 ms | 3223.123 ms | yes | #3523 |
| validation encode | 0.021 ms | 0.068 ms | yes | #3524 |
| validation gpu | -0.366 ms | 8.223 ms | no |  |
| query sets | 1 | 16 | no |  |

Translation and validation pass their thresholds, and a task is filed for each: #3523, a cold start makes its
pipelines side by side, and #3524, the app's instance turns indirect-call validation off with a bound of our
own. No state holds more than 16 live sets, so the query sets have none.

## What wasn't read

- The scene at 3456 × 2234, which main refuses, and any Mac but this one.
- A window on a screen: the three states are headless.
- Where inside Metal's compile the time goes, and what making pipelines side by side returns. The task measures it.
- A disk cache of our own (#579), the passes' coefficients (#3030), targets and overdraw (#3031) and a failed
  command buffer (#1552), which the issue leaves out.
