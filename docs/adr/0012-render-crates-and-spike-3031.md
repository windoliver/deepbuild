# 0012: The scene renderer's shared targets, a shell's replay in the replica, and spike #3031's readers

Status: accepted (#3715). The decisions below were held in comments that main's comment ratchet counted past their files' ceilings; they are written nowhere else. Spike #3031's write-up (`docs/spikes/3031/README.md`) states how the spike read its frames, and only what it leaves out is here.

## One depth for the occluders and the geometry pass

- **The cull's occluders draw into the geometry pass's multisampled depth.** `crates/deep-scene3d-render/src/cull.rs`, `Pyramid::depth` and `Pyramid::new`; `crates/deep-scene3d-render/src/lib.rs`, where a frame makes the pyramid from `depth_ms`. The pyramid reads that depth before the geometry pass clears it, so the prepass needs no depth target of its own (#3506). `Pyramid::new` takes the geometry pass's depth at `size` and `samples`; under the planted `own` it makes the pyramid over a depth of the occluders' own instead.
- **The estimate counts no depth for the occluders.** `crates/deep-scene3d-render/src/held.rs`, `of`. While a list is culled on the GPU it counts the cull's pyramid alone, since the occluders draw into the geometry pass's depth (#3506).

## One resolved image

- **Motion blur, the depth of field and the local tone map resolve into one image.** `crates/deep-scene3d-render/src/lib.rs`, `ensure_resolved` and `RESOLVED`; `renderer.rs`, `resolved`. It is made at the targets' size while wanted and let go otherwise. Motion blur and the depth of field each copy it into the linear target before the next pass starts, and the local tone map, which the output then reads, runs after both, so one image serves all three (#3506). On Metal a texture with all three's usages holds what one with either's does.
- **The depth of field copies the shared image back into the linear one.** `crates/deep-scene3d-render/src/dof.rs`, `job`. It resolves into `resolved`, the image motion blur shares, and copies that back into `linear` (#3506).
- **The local tone map resolves into the shared image, which the output then reads.** `crates/deep-scene3d-render/src/local_tone.rs`, `job`, its `into` (#3506).

## A shell's journeys in the replica

- **A `replay` journey plays a level's track as a piece with no shell.** `crates/deep-replica/src/drive/game_shell.rs`, `run` and `replay`. The moves journey's check compares it with its run (#3605). `replay` takes level `shell.of`'s document from the shell's own and plays it alone over the track the call gives, for `shell.steps` steps, with each array `shell.values` names at each step: the replica's piece play.
- **A level named by hash is one the call or its evidence gives.** `crates/deep-replica/src/drive/game_shell.rs`, `replay`.
- **A relaunch journey's plays keep the shell's profile record in one store, under the replica's out folder.** `crates/deep-replica/src/drive/game_shell.rs`, `run`, its `shell.store` (#3605).
- **Each driven data value is written where the screen's templates read it, as the scheduler writes it, before the screen is drawn.** `crates/deep-replica/src/drive/game_shell.rs`, where a screen's document is compiled. `{data/ch1} of 3` reads over the shell's `done` (#3605).

## Spike #3031's readers

- **A frame's start is marked in the trace by a buffer.** `spikes/3031/src/main.rs`; `docs/spikes/3031/trace.mjs`. The harness names a buffer `spike3031 frame <k>` where frame k starts. Frame k is at k ÷ F seconds of the document's clock.
- **The frame before lets go of its snapshot inside its own part of the trace.** `spikes/3031/src/main.rs`. The listing after the last frame is read with that frame's snapshot still held, beside the device's own total read in the same moment.
- **A run takes the machine's GPU lease, and says so when it ran without it.** `spikes/3031/src/main.rs`, the lease at `~/.cache/deepbuild-gpu/lease`, as the kit and exports take it with no hub. It waits up to `--lease-wait` seconds (600). A lease whose holder is gone was left by a killed run. The run prints one JSON summary and exits 0 when it finished, 1 with `BLOCKED` and why when it could not.
- **A read-back's buffer is kept alive until it is read.** `spikes/3031/src/held.rs`, `keep` and `kept`. The renderer lets go of a read-back's buffer as soon as it has read it, so every buffer of the asked length the device makes stays alive until `kept` takes it. A buffer's length is what was asked, or that rounded up to the device's alignment. A buffer the CPU can't read gives no bytes. The overdraw view's count target is a half float a pixel, in rows padded to the copy's alignment as the renderer's read-back lays them out.
- **A call the swap could not find goes unlisted, and is named.** `spikes/3031/src/held.rs`, the swap of the four calls a Metal device makes a texture or a buffer with. The tracer is adapted from #2189's (`docs/evidence/2189/alloctrace.rs`), which listed label and size; this one also reads each texture's own descriptor back.
- **A record crosses threads because its weak slot is read only through the runtime's own weak-reference calls.** `spikes/3031/src/held.rs`, `Rec` and its `Send`.
- **The raw Metal device is reached only to read its address, to find its class.** `spikes/3031/src/main.rs`, `listed`.
- **A resource the layer made for itself keeps Metal's label and is named `i<n>`.** `docs/spikes/3031/count.mjs`, the device's listing with the trace's names. No call of the renderer asked for it, so it has no descriptor in the trace. Each other listed resource is the trace's next resource of that kind, label and shape still alive at the listing; one the renderer let go of that the device still holds (a bind group keeps it) is the newest such in the trace.
- **A depth draw the renderer doesn't name stops the count of a solid's draws.** `docs/spikes/3031/count.mjs`, the solids each of a pass's draws draws. The renderer names its color pass's mesh draws itself, in the order it issues them (`Counts::draws`); any other draw that writes depth from a mesh is not guessed.
- **The trace itself is read and dropped.** `docs/spikes/3031/count.mjs`, `take`. It is some 18,000 lines a frame of the every-pass scene; `take` keeps `out/<fixture>.frames.json` and `out/<fixture>.overdraw.json`, and `record` reads only those.
- **A view of one layer or one mip reads as well as writes.** `docs/spikes/3031/trace.mjs`. A pass that writes through it leaves the rest of the texture as it was. A layout taken from a pipeline binds what the pipeline's shaders declare in that group.
- **The trace's reader knows only the RON that wgpu-core's trace writes.** `docs/spikes/3031/ron.mjs`. `Some(x)` reads as x and `None` as null; a variant with no fields reads as its name; `Name(a: 1)` reads as `{$: 'Name', a: 1}`, `Name(1, 2)` as `{$: 'Name', _: [1, 2]}`; an unnamed `(a: 1)` as `{a: 1}` and `(1, 2)` as `[1, 2]`. It throws, naming the place, on anything it doesn't know. The file is read in pieces, an action starting at column 0, so its size is no limit.

## What the names mean

- **`DofReadsSharedBeforeWrite`, `reads_shared_before_write`.** `crates/deep-gpu-layer/src/main.rs`; `crates/deep-scene3d-render/src/dof.rs`, `Planted`. The wrong program of #3506: the depth of field copies the image it shares with motion blur into the linear one before its gather writes it, so the frame shows motion blur's resolved image in this pass's place.
- **`occluders_own_depth`.** `crates/deep-scene3d-render/src/planted.rs`. The wrong program of #3506: the cull's occluders draw into a multisampled depth of their own, not the geometry pass's.
- **`estimate_counts_occluders_depth`.** `crates/deep-scene3d-render/src/planted.rs`. The wrong program of #3506: the estimate still counts a multisampled depth of the occluders' own.
- **`ShellDoneOnEnter`.** `crates/deep-replica/src/drive/plant.rs`. The wrong program of #3605: a game shell marks a level done when it is entered.
- **`ShellDoneInSave`.** `crates/deep-replica/src/drive/plant.rs`. The wrong program of #3605: a game shell keeps `done` in a run's save, not its profile record.
- **`ShellSettingInReadRegion`.** `crates/deep-replica/src/drive/plant.rs`. The wrong program of #3605: a game shell hands a level a setting through its read region, with no entry on its track.
- **`hidden`.** `crates/deep-scene3d-render/src/renderer.rs`. The hidden views' pipelines and targets, made when a frame first draws one (#290).
- **`seen`.** `crates/deep-scene3d-render/src/renderer.rs`. The scene it draws as a mirror's or a view inset's view, kept from frame to frame (#3016).
- **`Checked`.** `crates/deep-show/src/sandbox.rs`. A program's check and rewrite: its rewritten bytes, or why the check refused it.
- **`FLICKS`.** `spikes/3031/src/main.rs`, the constant of flicks a second: the unit of a document's time.
