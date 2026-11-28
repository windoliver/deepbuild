# Spike #3031: what a 3D frame holds while nothing reads it, and how often it draws depth

Both of the issue's drafted thresholds are passed on the every-pass scene, and neither on a class's fixture. A task
is filed for each: #3506 for sharing targets and #3507 for the geometry pass's overdraw.

- Targets on `every_pass`: 1,787,357,764 B in the table, 1,793,851,392 B allocated on the device
- Sharing on `showpiece`: 0 B returned, at least 32 MB: no
- Sharing on `every_pass`: 219,906,048 B returned, at least 32 MB: yes
- Overdraw: largest mean 1.79 on `every_pass`, past 1.5: yes

Read on main at `9e77c2ad6`, on 2026-11-25, on a Mac17,10 (Apple M5 Max, macOS 26B8119), on Metal, headless, under
the GPU lease's file, on mains power with a one-minute load of 14 to 18 on 18 cores. The readings are bytes and
counts, which don't move with load. Every reading is from one run on one machine and sets no budget. The spike
changes no renderer code and no budget.

## How it was read

`spikes/3031/` is a headless program outside the workspace. It draws a document's frames offscreen through the scene
renderer's public entry (`draw_offscreen_texture`, `draw_offscreen_diag`), with two readers the renderer doesn't know
of:

- **The device's own log.** The device is opened as `deep_gpu::device::Device::open` opens it, with wgpu's `trace`
  feature on, so wgpu-core writes every call the frame makes: each texture and buffer with its descriptor, each bind
  group, each pass with its attachments, the groups it sets and the draws it issues. `trace.mjs` reads that into a
  pass list. A pass binds a target when it attaches it, resolves into it, sets a bind group that holds it, uses it as
  a vertex, index or indirect buffer, or copies from or to it
- **The device's own bytes.** Metal's calls that make a texture or a buffer are swapped for ones that keep a weak
  reference, as #2189's tracer did, so a listing holds everything alive with its `allocatedSize`, beside the device's
  `currentAllocatedSize` read in the same moment. Each listed resource is matched to the log's by label, shape and
  order

Each fixture is 300 frames at 5 a second: the whole of its 60 s. The six class fixtures are
`benchmarks/canvas/<class>.json` as they stand, under the perf lane's look: `core_view`, `data_view`, `figure`,
`work_product`, `showpiece` and `export`. `every_pass` is #1903's scene with a depth of field effect and a pane of
glass added, under #1903's look with motion blur by velocity, ao and the local tone map added
([`fixtures/`](fixtures/), made by `fixtures.mjs`). Its camera turns once around in the 300 frames.

```sh
(cd spikes/3031 && cargo build --release --locked)
node docs/spikes/3031/count.mjs take      # the seven fixtures: out/<fixture>.frames.json and .overdraw.json
node docs/spikes/3031/count.mjs record    # record.json, and the lines and tables below
```

## What the every-pass scene holds

At 3456 × 2234 the device holds 1,793.9 MB for this frame: 65 textures (1,668.9 MB) and 212 buffers (118.4 MB). The
table has a row for each of the 277; those of 1 MB and more are below, and all are in `record.json`. The 6.5 MB the
rows don't name (0.36%) includes the 1.1 MB the device held before the renderer was made.

By pass: the view's core targets 377.4 MB, depth of field 350.3, motion blur 219.8, the cull's depth and pyramid
211.8, the sun's cascades 135.3, the lamp's shadow map 135.3, glass 106.0, the mirror's core targets 94.8, the local
tone map 72.4, ao 50.3. Depth of field's targets and its buffer are 280.2 MB in the view, 36.3 bytes a pixel, as
the issue read from the formats.

| Target | Size | Format | Usage | Device MB | First pass | Last pass |
|---|---|---|---|---|---|---|
| `scene3d ids ms` (t14) | 3456 × 2234, 4 samples | rg16uint | RENDER_ATTACHMENT, TEXTURE_BINDING | 126.0 | scene3d.geometry | scene3d.sample_resolve |
| `scene3d depth ms` (t15) | 3456 × 2234, 4 samples | depth32float | RENDER_ATTACHMENT, TEXTURE_BINDING | 126.0 | scene3d.geometry | scene3d.sample_resolve |
| `scene3d occluders' depth` (t26) | 3456 × 2234, 4 samples | depth32float | RENDER_ATTACHMENT, TEXTURE_BINDING | 126.0 | scene3d.occluders | scene3d.depth_pyramid |
| `scene3d.motion velocity` (t29) | 3456 × 2234 | rgba32float | RENDER_ATTACHMENT, TEXTURE_BINDING | 124.9 | scene3d.motion velocity | scene3d.motion resolve |
| `scene3d.dof scattered` (b209) | 92,648,448 B | buffer | COPY_DST, STORAGE | 92.7 | clear | scene3d.dof |
| `scene3d.glass` (t16) | 3456 × 2234, 12 mips | rgba16float | COPY_DST, COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 84.2 | scene3d.geometry | scene3d.glass |
| `scene3d.cascade` (t23) | 2048 × 2048 × 4 | depth32float | COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 67.6 | scene3d.cascade | scene3d.glass |
| `scene3d.local_shadow` (t25) | 4096 × 4096 | depth32float | COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 67.6 | scene3d.local_shadow | scene3d.glass |
| `scene3d.cascade` (t55) | 2048 × 2048 × 4 | depth32float | COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 67.6 | scene3d.cascade | scene3d.glass |
| `scene3d.local_shadow` (t57) | 4096 × 4096 | depth32float | COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 67.6 | scene3d.local_shadow | scene3d.glass |
| `scene3d linear` (t10) | 3456 × 2234 | rgba16float | COPY_DST, COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 62.5 | scene3d.geometry | scene3d.local_tone |
| `scene3d.motion resolved` (t28) | 3456 × 2234 | rgba16float | COPY_SRC, STORAGE_BINDING | 62.5 | scene3d.motion resolve | copy |
| `scene3d.dof base` (t64) | 3456 × 2234 | rgba16float | STORAGE_BINDING, TEXTURE_BINDING | 62.5 | scene3d.dof | scene3d.dof |
| `scene3d.dof coc` (t65) | 3456 × 2234 | rg32float | COPY_SRC, STORAGE_BINDING, TEXTURE_BINDING | 62.5 | scene3d.dof | scene3d.dof |
| `scene3d.dof resolved` (t67) | 3456 × 2234 | rgba16float | COPY_SRC, STORAGE_BINDING | 62.5 | scene3d.dof | copy |
| `scene3d.local_tone resolved` (t74) | 3456 × 2234 | rgba16float | COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 62.5 | scene3d.local_tone | scene3d.output |
| `scene3d.depth_pyramid` (t27) | 3456 × 2234, 12 mips | r32float | STORAGE_BINDING, TEXTURE_BINDING | 43.1 | scene3d.depth_pyramid | scene3d occlusion |
| `scene3d ids` (t11) | 3456 × 2234 | r32uint | COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 31.5 | scene3d.sample_resolve | scene3d.mirror |
| `scene3d depth` (t12) | 3456 × 2234 | depth32float | COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 31.5 | scene3d.sample_resolve | scene3d.flare |
| `scene3d.motion depth` (t30) | 3456 × 2234 | depth32float | RENDER_ATTACHMENT | 31.5 | scene3d.motion velocity | scene3d.motion velocity |
| `scene3d ids ms` (t46) | 1728 × 1117, 4 samples | rg16uint | RENDER_ATTACHMENT, TEXTURE_BINDING | 31.5 | scene3d.geometry | scene3d.sample_resolve |
| `scene3d depth ms` (t47) | 1728 × 1117, 4 samples | depth32float | RENDER_ATTACHMENT, TEXTURE_BINDING | 31.5 | scene3d.geometry | scene3d.sample_resolve |
| `scene3d occluders' depth` (t58) | 1728 × 1117, 4 samples | depth32float | RENDER_ATTACHMENT, TEXTURE_BINDING | 31.5 | scene3d.occluders | scene3d.depth_pyramid |
| `scene3d snapshot` (t373) | 3456 × 2234 | bgra8unorm | COPY_SRC, RENDER_ATTACHMENT | 31.5 | scene3d.output | scene3d.output |
| `scene3d.dof scattered` (b208) | 23,162,112 B | buffer | COPY_DST, STORAGE | 23.2 | clear | scene3d.dof |
| `scene3d.glass` (t48) | 1728 × 1117, 11 mips | rgba16float | COPY_DST, COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 21.8 | scene3d.geometry | scene3d.glass |
| `scene3d ao normal` (t20) | 1728 × 1117 | rgba16float | RENDER_ATTACHMENT, TEXTURE_BINDING | 15.6 | scene3d.ao_prepass | scene3d.ao_blur |
| `scene3d linear` (t42) | 1728 × 1117 | rgba16float | COPY_DST, COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 15.6 | scene3d.geometry | scene3d.mirror |
| `scene3d.dof base` (t60) | 1728 × 1117 | rgba16float | STORAGE_BINDING, TEXTURE_BINDING | 15.6 | scene3d.dof | scene3d.dof |
| `scene3d.dof coc` (t61) | 1728 × 1117 | rg32float | COPY_SRC, STORAGE_BINDING, TEXTURE_BINDING | 15.6 | scene3d.dof | scene3d.dof |
| `scene3d.dof resolved` (t63) | 1728 × 1117 | rgba16float | COPY_SRC, STORAGE_BINDING | 15.6 | scene3d.dof | copy |
| `scene3d.depth_pyramid` (t59) | 1728 × 1117, 11 mips | r32float | STORAGE_BINDING, TEXTURE_BINDING | 11.3 | scene3d.depth_pyramid | scene3d occlusion |
| `scene3d.ao_prepass` (t19) | 1728 × 1117 | depth32float | RENDER_ATTACHMENT, TEXTURE_BINDING | 8.1 | scene3d.ao_prepass | scene3d.glass |
| `scene3d ao raw` (t21) | 1728 × 1117 | rg16float | RENDER_ATTACHMENT, TEXTURE_BINDING | 8.1 | scene3d.ao | scene3d.ao_blur |
| `scene3d ao blurred` (t22) | 1728 × 1117 | rg16float | RENDER_ATTACHMENT, TEXTURE_BINDING | 8.1 | scene3d.ao_blur | scene3d.glass |
| `scene3d ids` (t43) | 1728 × 1117 | r32uint | COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 8.1 | scene3d.sample_resolve | scene3d.glass |
| `scene3d depth` (t44) | 1728 × 1117 | depth32float | COPY_SRC, RENDER_ATTACHMENT, TEXTURE_BINDING | 8.1 | scene3d.sample_resolve | scene3d.dof |
| `scene3d.local_tone grid` (t73) | 54 × 35 × 129 | rgba16float | STORAGE_BINDING, TEXTURE_BINDING | 4.3 | scene3d.local_tone | scene3d.local_tone |
| `scene3d ao normal` (t52) | 864 × 559 | rgba16float | RENDER_ATTACHMENT, TEXTURE_BINDING | 4.2 | scene3d.ao_prepass | scene3d.ao_blur |
| `scene3d.local_tone level` (t68) | 864 × 559 | rgba16float | STORAGE_BINDING, TEXTURE_BINDING | 4.2 | scene3d.local_tone | scene3d.local_tone |
| `scene3d.ao_prepass` (t51) | 864 × 559 | depth32float | RENDER_ATTACHMENT, TEXTURE_BINDING | 2.1 | scene3d.ao_prepass | scene3d.glass |
| `scene3d ao raw` (t53) | 864 × 559 | rg16float | RENDER_ATTACHMENT, TEXTURE_BINDING | 2.1 | scene3d.ao | scene3d.ao_blur |
| `scene3d ao blurred` (t54) | 864 × 559 | rg16float | RENDER_ATTACHMENT, TEXTURE_BINDING | 2.1 | scene3d.ao_blur | scene3d.glass |
| `scene3d.local_tone level` (t69) | 432 × 280 | rgba16float | STORAGE_BINDING, TEXTURE_BINDING | 1.0 | scene3d.local_tone | scene3d.local_tone |
| `(wgpu internal) Indirect draw validation destination buffer` (i397) | 1,048,560 B | buffer | internal | 1.0 | none | none |
| `(wgpu internal) Indirect draw validation metadata buffer` (i399) | 1,048,560 B | buffer | internal | 1.0 | none | none |
| 231 more, each under 1 MB (23 textures, 208 buffers) | | | | 2.1 | | |
| **277 rows** | | | | **1787.4** | | |

The first and the last pass are those of a frame after the first. `clear` and `copy` are a clear and a copy outside
a pass. Two rows of one label are the view's and the mirror's view's, which draws at half the size.

## What could be one texture

A set is offered where textures share a size, mips, samples, format and usage, hold bytes, and have spans that never
meet in any of the 300 frames. A target whose first pass in a frame reads it carries the frame before's pixels, so
its span runs over the frame's start; a pass that writes one layer or one mip leaves the rest, so it reads too. That
keeps the cascades, the shadow maps and the glass copy's mips out.

| Set | Size, format, usage | Spans | Returns |
|---|---|---|---|
| `scene3d depth ms` and `scene3d occluders' depth` | 3456 × 2234, 4 samples, depth32float, RENDER_ATTACHMENT, TEXTURE_BINDING | occluders to depth pyramid, then geometry to sample resolve | 126.0 MB |
| The same pair in the mirror's view | 1728 × 1117, 4 samples | the same | 31.5 MB |
| `scene3d.motion resolved` and `scene3d.dof resolved` | 3456 × 2234, rgba16float, COPY_SRC, STORAGE_BINDING | motion resolve to its copy, then dof to its copy | 62.5 MB |

One texture in each set's place returns 219.9 MB of the 1,793.9. At the 1728 × 1117 a showpiece draws at while it
moves, a quarter of the pixels, that is about 55 MB by arithmetic; it was not read there. The showpiece's own fixture
holds 56.9 MB in all and no two targets that could be one, so sharing returns nothing on it. No other class's fixture
offers a set either.

Three more targets of 3456 × 2234 in rgba16float are never live together and differ only by usage:
`scene3d.motion resolved`, `scene3d.dof base` and `scene3d.local_tone resolved`, 62.5 MB each. They are not offered:
one texture would need all three usages, and what that holds on Metal was not read.

- **Returns:** 219.9 MB on the every-pass scene at full screen, nothing on a class's fixture
- **Puts at risk:** no pixel hash, since each pass clears or overwrites the shared target before it reads it. A test
  or a tool that reads `scene3d occluders' depth` or a resolved image after the frame by its label would read the
  later pass's
- **Recommendation:** do it, as #3506 scopes it

## Overdraw, and how often depth is drawn

The count is the diagnostic mode's own. The program keeps the buffer the mode reads its count target back into, and
counts pixels by fragments from it; each frame's largest count is the mode's `max_overdraw`. Mean overdraw is
fragments over all of the frame's pixels, as the cost model multiplies by it, averaged over the 300 frames.

| Fixture | Size | Frames | Mean overdraw | Over drawn pixels alone | Largest | Depth draws of each opaque solid |
|---|---|---|---|---|---|---|
| `core_view` | 480 × 270 | 300 | 0.756 | 2.000 | 2 | q1 1, q2 1, q3 1, q4 1 |
| `data_view` | 640 × 360 | 300 | 0.756 | 2.000 | 2 | q1 1, q2 1, q3 1, q4 1 |
| `figure` | 640 × 400 | 300 | 0.681 | 2.000 | 2 | q1 1, q2 1, q3 1, q4 1 |
| `work_product` | 800 × 600 | 300 | 0.568 | 2.000 | 2 | q1 1, q2 1, q3 1, q4 1 |
| `showpiece` | 1280 × 800 | 300 | 0.681 | 2.000 | 2 | q1 1, q2 1, q3 1, q4 1 |
| `export` | 1280 × 720 | 300 | 0.756 | 2.000 | 2 | q1 1, q2 1, q3 1, q4 1 |
| `every_pass` | 3456 × 2234 | 300 | 1.792 | 2.105 | 9 | the table below |

The mode counts every triangle's fragments, both faces, with depth ignored. The geometry pass culls back faces and
tests depth, so the count bounds from above what that pass shades. On a class's fixture every drawn pixel takes
exactly 2: a bar's front and its back. On the every-pass scene 14.9% of pixels take none, 47.0% take 1 (the floor),
30.0% take 3, 7.3% take 5, 0.8% take 7 and 0.03% take 9. Front faces alone come to about 1.32 a pixel, and the pixels
anything covers to 0.85. What the geometry pass shades lies between those two, by the order its batches draw in.
Nothing counts it. The sky also draws first over the whole frame.

A class's camera stands still; its 300 poses are the bar's as it eases forward. Each bar of each class's fixture is
drawn into depth once a frame, by the geometry pass, in all 300 frames. The every-pass scene's draws that write a
depth target, in a frame after the first:

| Pass | Pipeline | Draw | A frame issues |
|---|---|---|---|
| scene3d.occluders | scene3d.occluders, culls back | indirect | 2 |
| scene3d.cascade | scene3d.shadow | 36 indices × 12 | 6 |
| scene3d.cascade | scene3d.shadow | 6 indices × 1 | 3 |
| scene3d.cascade | scene3d.shadow | 36 indices × 1 | 6 |
| scene3d.cascade | scene3d.shadow | indirect | 6 |
| scene3d.local_shadow | scene3d.local_shadow | 3 indices × 1 | 0 to 12 |
| scene3d.local_shadow | scene3d.shadow | 36 indices × 12 | 0 to 12 |
| scene3d.local_shadow | scene3d.shadow | 36 indices × 400 | 0 to 12 |
| scene3d.local_shadow | scene3d.shadow | 6 indices × 1 | 0 to 6 |
| scene3d.ao_prepass | scene3d.ao_prepass | 36 indices × 12 | 2 |
| scene3d.ao_prepass | scene3d.ao_prepass | 36 indices × 400 | 2 |
| scene3d.ao_prepass | scene3d.ao_prepass | 6 indices × 1 | 1 |
| scene3d.geometry | scene3d.opaque, culls back | 36 indices × 12 | 2 |
| scene3d.geometry | mesh_row_vs, culls back | indirect | 2 |
| scene3d.geometry | scene3d.opaque, culls back | 6 indices × 1 | 1 |
| scene3d.sample_resolve | scene3d.sample_resolve | 3 indices × 1 | 2 |
| scene3d.glass | scene3d.transmission | 36 indices × 1 | 2 |
| scene3d.motion velocity | scene3d.motion velocity | 6 indices × 1 | 1 |
| scene3d.motion velocity | scene3d.motion velocity | 36 indices × 1 | 413 |

`36 indices × 12` is the twelve boxes, `36 indices × 400` and the indirect draws the crowd, `6 indices × 1` the
floor, and `36 indices × 1` under the cascades and the glass pass the pane. So a frame draws each box into a depth
target 11 times: 6 cascades, 2 ao prepasses, 2 geometry passes and motion blur's velocity draw, five of them for the
mirror's view. A crowd element goes up to 13, with the two occluder passes, as far as the cull keeps it. In the
camera's own view a crowd element is drawn into depth four times, not three: the occluders, the ao prepass, the
geometry pass and the velocity draw, which keeps a depth of its own. The first frame also draws the lamp's map, 12
passes. The every-pass scene's draws are counted by pipeline and shape; they are not named solid by solid.

- **Returns:** not known in fragments. At most 1.32 − 0.85 = 0.47 a pixel on the every-pass scene if opaque solids
  shaded only where they show; nothing on a class's fixture, where no bar hides another
- **Puts at risk:** every pixel hash with an opaque solid in it, if color is drawn against a depth another pass made:
  the four depths have three shapes (4 samples at full size, 1 sample at half size, 1 sample at full size), and an
  equal-depth test across two of them would miss
- **Recommendation:** count what the geometry pass shades before any pass moves. #3507 does that first, and changes
  a pass only if that count passes its own line

## The tasks

Both thresholds are passed, so both tasks are filed, with five criteria each (`tasks.json`, which `count.mjs record`
puts in the record):

- #3506: one depth for the occluders and the geometry pass, and one resolved image for motion blur and depth of
  field. 220 MB back on the every-pass scene at full screen
- #3507: the geometry pass's shaded fragments are counted, and opaque solids shade a pixel once where the count says
  they don't

## What this did not read

- **The live view.** The frames are offscreen, at internal scale 1. A live view's slots, upscale targets, history
  window and HDR surface are not in the table, and its passes are not in the pass list
- **The spans on another machine.** The issue allows any machine for them; they were read from this Mac's run
- **What the geometry pass shades.** Only the mode's count, which bounds it
- **A texture made with two passes' usages.** Whether it holds more bytes than one made with either's
- **Motion blur's first frame.** Its shutter opens at the document's start, not before it

## Also found

- `scene3d.motion velocity` is rgba32float, 16 bytes a pixel and 124.9 MB here, and motion blur keeps a depth of its
  own, 31.5 MB. The design's Cost line for Motion blur: velocity says a 4-byte velocity target a pixel
- The mirror's view runs depth of field, ao, the glass copy and the cull of its own: 70 MB of depth of field targets
  for a picture the view blurs again
- The check's estimate (`held::of`) gives 939.8 MB for this scene, where the device holds 1,793.9 MB. It counts no
  target of depth of field, motion blur, glass, ao or the local tone map
- The lamp's 4096 px shadow map is held in both views, 135.3 MB, and drawn in the first frame alone
