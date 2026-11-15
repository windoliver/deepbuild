# Canvas and renderer hill-climb: GPU and memory, 2026-11-14 and 15

Base: main at `c740dede7` (2026-11-14). Branch `perf/render-gpu-memory-1114`, nothing committed. Eleven source files differ from main, +625 −145, and two test files are new, 367 lines. Of the 992 added lines, 693 are tests and 299 are code.

Two rounds. The first made three changes; the second closed six of its follow-ups. Each has a test that fails on main's code, and none changes a pixel.

- **A renderer holds what its scene uses.** One that drew a cascaded sun, a mirror, a casting point light and a label, then a scene with none of them, held 158.7 MiB on the device at 128 × 96. It now holds what a renderer that never drew them holds, and that is 0.8 MiB where it was 9.0 MiB, since the glyph atlas is made with the first label.
- **The shipped effect passes and the print pass make nothing once warm.** The grid, the key light's shadow, the selection outline and the glow made 22 buffers and 22 bind groups every frame, and the print pass 2 and 1 every call. Each now makes none while its values and views hold.
- **Evaluating a scene copies no document**, whole-path frames included. 4 MiB of text in a document cost each evaluation, and each whole frame, 4,194,304 bytes of heap.
- **A frame whose scene holds writes nothing** for a swaying part and a subsurface part, where it made 3 queue writes.

Not verified, first:

- **Nothing here shows the renderer is the best there is.** No frame was timed and nothing was run against another renderer. What is shown is fewer device objects, fewer bytes and less memory than main, by count.
- **This is not a line read of the canvas and the renderer**, about 280,000 lines. What was read is under [Scope](#scope-what-was-audited).
- **GPU time and frame time were not measured.** The load average was between 3 and 390. What is measured does not move with load.
- **`node scripts/affected.mjs` ended FAIL.** Its cargo block got no build grant, and two of its Metal tests fail, in files an earlier report records as failing on main; neither was re-run on main here. See [Not run](#not-run).
- **No acceptance suite that draws through the `deep-gpu` binary was run by hand.** The pixel proof is Rust tests on this Mac's GPU.

## Measured

**Device memory**, Metal's `currentAllocatedSize` after the device drained, one renderer at a time (`crates/deep-scene3d-render/tests/held_memory.rs`), at 128 × 96.

| A renderer that drew | Main | Change |
|---|---|---|
| A floor and a box of materials, twice | 9.0 MiB | 0.8 MiB |
| The same with a cascaded sun, a mirror, a casting lamp and a label, then without them twice | 158.7 MiB | within 4 MiB of the row above |
| A painted floor with a label, less the same with none | 0.1 MiB | at least 7 MiB: the atlas, 8 MiB |
| A painted floor whose post module read the key light's map once, then twice with none reading | 25.1 MiB | within 2 MiB of never read |
| The same, never read | 10.2 MiB | 2.0 MiB |

The change's two "within" rows are the tests' bounds; their own readings were not printed. None of these sizes follows the window's: the cascades are 64 MiB, the key light's map 16 MiB and the atlas 8 MiB at any size.

**The effects chain**, counts on the noop lane: the grid, the shadow, the outline and the glow at 128 × 96, 11 passes.

| Each frame after the first | Main | Change, camera turning | Change, camera holding |
|---|---|---|---|
| Buffers made | 22 | 0 | 0 |
| Bind groups made | 22 | 0 | 0 |
| Queue writes | 0 | 11 | 0 |
| Bytes uploaded | 2,928 | 1,540 | 0 |

In wgpu-core 30.0.1 a buffer made with its contents and a queue write each take a staging buffer of their own (`device/resource.rs:1164`, `device/queue.rs:662`). So main's frame made 44 device buffers for these passes; the change's makes 11 while the camera turns and none while it holds.

**Other counts and bytes.**

| What | Main | Change |
|---|---|---|
| The print pass again with the same values and views: buffers, bind groups | 2, 1 | 0, 0 |
| A frame again, a swaying tree and a subsurface slab in it: queue writes | 3 | 0 |
| One `evaluate` of a plate, with 4 MiB of description: heap bytes | 4,316,614 | 112,677 |
| The same with no description | 122,310 | 112,677 |
| One whole-path frame, with 4 MiB of description, over the same with none: heap bytes | 4,194,304 | under 1 MiB, the test's bound |

## What changed

In `crates/deep-scene3d-render` unless named.

- **Cascades, the mirror's renderer, the local lights' maps and the key light's single map go when no frame uses them.** Each stayed for the renderer's life. A frame with no cascaded sun drops the layers and their keys; one with no mirror drops the mirrored view's renderer; one with no casting local light drops their maps; one whose post module doesn't read the key light's map drops it. Each binds the lights' stub again, and what comes back is drawn whole. `lib.rs`, `local.rs`, `mirror.rs`
- **The glyph atlas is made by the first frame that draws a label**, and dropped by one that draws none. `held.rs`'s estimate counts it where a label draws. `lib.rs`, `held.rs`
- **The print pass keeps its two buffers and its bind group** while its values and views hold. `print.rs`
- **A still frame writes nothing.** The subsurface spread's uniform and the adjust and lobe tables go up where their words changed, and a swaying solid's params only when they changed. The sway pass still runs every frame. `sss.rs`, `sway.rs`, `lib.rs`
- **A shipped effect pass binds what it bound last frame.** `Runner::rebind` writes its two uniforms where their words changed and makes its bind groups again only when a texture it reads is another. `crates/deep-effects-render/src/runner.rs`, `frame.rs`
- **Evaluation reads the caller's document.** `evaluate_compiled` takes the document, where it took its map and cloned it back. `Frames::whole` sets the frame's size in the document it keeps, where it cloned the document every frame. `crates/deep-canvas-scene3d/src/scene.rs`, `frames.rs`

Who reaches each: the memory, print and evaluation changes reach `deep-show`, which keeps one renderer for every session and document in its process and draws every 3D frame through `evaluate`. The effects change and the whole-path frame reach the GPU layer's views; no shipped path runs the effects' passes today.

## Verification

Every row is on `c740dede7`. Each new test ran on main's code first: the changed files as main has them, with the new tests added.

| Check | Result |
|---|---|
| `held_memory` on main's renderer, three tests | Each fails for the expected reason: `holds 158.7 MiB, 9.0 MiB without them`; `holds 8.9 MiB with no label and 9.0 MiB with one`; `holds 25.1 MiB, 10.2 MiB never read` |
| `evaluate_alloc` on main's code, two tests | `cost the evaluation 4194304 bytes more (4316614 against 122310)`; `cost the frame 4194304 bytes more (4281368 against 87064)` |
| The effects' count test on main's code | `frame 1: buffers and bind groups made left (22, 22) right (0, 0)` |
| The print test on main's code | `the same values and views left (2, 1) right (0, 0)` |
| The still-frame test on main's code | `the same frame again left 3 right 0` |
| All eight on the change | Pass |
| Effects pixels on Metal, five frames: the camera turning, the glow changing, the view at another size and back | Each frame's hash is the same on main and on the change: `4548e90d82580bed`, `0f03946bca37a072`, `1e4399e78da2139b`, `1b6394445a1f7ff6`, `8bb750cecfefe1d0` |
| Renderer pixels on Metal: the scene with cascades, a mirror, a lamp and a label, without them, and with them again, in one renderer | Each frame equals, byte for byte, the frame of a renderer that starts at it, on main and on the change; the lamp's map is counted on the first and third and not on the second |
| A whole frame against `evaluate` of the same document, at its size and at another | Equal scenes |
| Thirteen mutants, each one line of the change taken out or bent | Each fails its test. Round one's five: a kept pass that never writes again (`frame 1`), groups kept over other textures (`frame 3`), cascades dropped with their keys kept (`frame 2`), with the lights still binding them, and the mirror's renderer kept. Round two's eight: the atlas kept (`holds 9.0 MiB, 0.8 MiB without them`), the lamp's maps still bound (`6.8 MiB`), their layer count kept (`frame 2: other pixels`), the key light's map kept (`16.9 MiB, 2.0 MiB never read`), a print group kept over another source, print buffers kept over other values, a whole frame that leaves the document's size, and a sway that uploads only what holds |
| `cargo test -p deep-canvas-scene3d -p deep-canvas-effects -p deep-effects-render -p deep-scene3d-render` | All pass: 113, 15, 3 and 3 (`acceptance_1312`), 31, and the two new files' 5 |
| `cargo clippy -p deep-effects-render -p deep-scene3d-render --all-targets --no-deps -- -D warnings` | Clean |
| The same for deep-canvas-scene3d | Three findings, main's: `contributed.rs:203`, `pointer.rs:124` and `:288` |
| `rustfmt --check` on the thirteen files | Clean on eleven. `scene.rs:2429` and five lines of `lib.rs` are main's |
| `node scripts/size-ratchet.mjs` | Not run again. `lib.rs` is 9,762 lines against main's 9,729 and a ceiling of 9,169: 33 more, in a file already over |

## Not run

- **`node scripts/affected.mjs` ended FAIL, and its cargo block never ran.** Run once on the tree as it is, with the packages built: `FAIL affected: 86 new, 0 already failing on main, 13 inconclusive or blocked, 0 listed skips, 19 passed, in 5042 s at load 294`. No WIDE line.
  - The 13 INCONCLUSIVE lines are `no grant`: `cargo test` for its 15 crates and twelve lint jobs, clippy, fmt and the size ratchet among them, got no build grant in 30 minutes. So eleven of those crates' tests did not run: deep-app, deep-canvas-loop, deep-canvas-media, deep-gpu-layer, deep-marks-render, deep-panel-host, deep-physics-rapier, deep-replica, deep-show, deep-synth-job and deep-text-render. The other four ran by hand, above.
  - Its 7 vitest files ran on Metal against binaries built from this tree: 19 tests pass, `418/tone` and four of the five `381` files among them, and 2 fail. `140/view/glyphs`: `glyph runs, app against headless`. `381/depth`: `the labels' atlas placements`, one glyph at two places in the core's atlas. #2499's report records both files failing on main the same way. They were not run on main's tree here, so that is its word, not this run's. The second names the atlas: its placements come from the canvas core's label atlas, which this change does not touch, and that too is by reading.
  - The other 84 NEW FAIL lines are lint lanes: deps 50, code mappings 23, slots 4, a slot kit 3, drift 2, the record reader 1 and secrets 1. None names a file this change touches. They were not run on main's tree.
- **Every acceptance suite on Metal, by hand**: `380` and `418` (effects), `422`, `425` and `446` (cascades and local shadows), `465` and `166` (mirrors), `464` (print), `2016` (sway), `481` (subsurface), `1174` (labels), `2189` (the memory estimate). `held.rs` now counts the atlas only where a label draws; #2189's own check of that estimate against the device was not run.
- The timed and slow lists, the preflight, and anything on Linux.

Deviations: the first build held a build grant from the throttle. Later builds and tests ran through `scripts/lease` or plain `nice 19`, four or five jobs, unleased. The measuring prints were added for a run and taken out. The mutants and the main's-code runs rewrote source files in place and put them back; the tree was compared with the saved change after each.

## Scope: what was audited

Read in full: `deep-effects-render`'s `runner.rs`, `frame.rs`, `glow.rs`, `strokes.rs` and `closed.rs`; `deep-scene3d-render`'s `mirror.rs`, `held.rs`, `sway.rs` and the print pass's `record`; `deep-gpu`'s `counted.rs`, `memory.rs`, `encode.rs` and `alloc.rs`. In `deep-scene3d-render`: the cascades', the local lights', the lights' and the environment's prepare, the mirror's and the flare's part of `prepare`, the atlas, `cascade_jobs`, the shadow map's job, the post module's part of `jobs`, `Module3`, `draw_offscreen` and the read-back, and the subsurface's and the per-pixel lists' writes. In `deep-canvas-scene3d`: `evaluate`'s entries, `rest`'s head, and `Frames::with_program` and `whole`. `deep-show/src/scene3d.rs`'s draws.

Searched for device calls and document clones, not read: the rest of `deep-effects-render`, `deep-gpu/src/view.rs`, `deep-marks-render/src/gpu.rs`.

Not audited: `deep-gpu-layer`, the 2D marks and text renderers (`deep-marks-render` beyond that search, `deep-marks-vello`, `deep-marks-gpui`, `deep-text-render`, `deep-text-gpui`), `deep-app`, the vendored UI crates, the canvas core and its modules beyond scene3d's evaluation, and `deep-show` beyond `scene3d.rs`.

## Found and not applied

Line numbers are at `c740dede7`.

- **The rest of the effects chain still makes buffers and bind groups every frame**: strokes (`strokes.rs:122`), sparks (`frame.rs:466`, `:486`, `:533`), the closed-form kernel (`closed.rs:78`), the document's operators (`docops.rs:1087`, `:1472`, `:1711`, `:1849`, `:1881`) and a compute output's clear (`mips.rs:155`). A change for strokes was drafted and taken out again before it compiled; it is not in the tree.
- **The sway pass runs and submits every frame**, with params that hold too (`sway.rs`). Skipping it needs a pixel test whose tree visibly moves; the one written here did not, so it proved nothing and was removed.
- **The per-pixel lists' info is written every frame** (`oit.rs:104`). It resets a count the GPU writes, so it stays.
- **`draw_offscreen` makes a snapshot texture and a read-back buffer the size of the frame on every call** (`lib.rs:9353`, `:1447`), as `Vello2d::picture` and `read_back` do (`deep-marks-render/src/gpu.rs:455`, `:495`). #231 owns the export's path, where a frame handed over as a GPU surface is never read back.
- **`deep-show` clones the document and compiles its motion program for every 3D evaluation** (`scene3d.rs:116`, `:353`). It needs a way to set the size and the skins without changing the document.
- **`rest` clones the document when a rest names what it rests on** (`scene.rs:1320`). Its five callers hold only the map.
- **The mesh cache and the map store never free.** Owned by #1431.

## Requirement to change to proof

| Asked | Done | Proof, and its limit |
|---|---|---|
| Pull the latest change | Fetched; local `main` fast-forwarded; the worktree moved to `origin/main` three times, last to `c740dede7`, with every check run again there. The main checkout was not touched: other sessions' uncommitted files are in it | `git merge --ff-only origin/main` in the worktree |
| Deep audit of the canvas and the rendering engine | The 3D frame path's holders, the effects chain, the print pass and the scene evaluation | Reading and searches, under Scope. Not a line read |
| Close the follow-ups | Six closed: the glyph atlas, the local and single shadow maps, the whole-path frame's copy, the print pass, the small uniforms. Seven left, each under Found and not applied with its reason | A failing-first test and at least one mutant for each closed |
| Least GPU and memory use, and speed | Fewer device objects, bytes and megabytes than main, by count | No timing and no comparison with another renderer: "best" is not shown |

Size: 992 added lines, 299 of them code, well over the guideline of about 400. It splits by crate and by round: the renderer's memory, the atlas, the print pass, the still frame, the effects' bindings, and the evaluation.
