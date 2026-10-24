# Acceptance tests for #377: the GPU layer — one wgpu device, the surface handoff with fences, encode workers and the noop lane

Written first, from issue #377 (its scope, its GPU surface fields and "It can never" list, its ten acceptance
criteria and its proof line), its Oracle page (`doneright/oracles/issues/377.md`) and the upstream test it names,
the design sections it links and those they lean on, and base commit `50c6de1` ("Merge pull request #702 …"), by
a job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: The canvas core (where it sits: "the only part that draws or touches the GPU",
  clients hand it "documents and patches, never pixels"; canvas modules; render modules adding passes "only into
  the frame's places"; Conventions); the GPUI patch and the IOSurface handoff in How it installs (2456); the
  Decided row "The canvas's GPU layer" (the October 10 spike: three IOSurface-backed BGRA textures, 0.7–0.9 ms
  zero copy against 6.6–6.8 ms by copy at 1936 × 1584, "Both paths give pixel-identical frames"); Numbers version 0
  has to hold (the canvas row; Every task carries its own budgets: five runs after warm-up, PASS / FAIL /
  INCONCLUSIVE with a margin of the larger of 5% and the spread, a stated p95 taken over every frame of the run, at
  least 300 frames; the reference Macs); How we know version 0 works (conformance kits, a probe the backend can't
  make is BLOCKED, the noop backend and the GPU lease, the parity suite, "A blank guard runs first … luma at most
  0.06 over at least 98% of its pixels, film.blank's measure … makes the comparison BLOCKED and voids its other
  numbers", Dogfooding); the Threats rows on extensions and panels; Cut, or deferred (raw plug-in shaders).
- `docs/canvas-primitives.md`: The trusted compositor (Writer connection, Document session, Frame clock and
  scheduler, Frame callback and presentation feedback with `zero_copy | copy`, Band, Question card, GPU surface,
  GPU surface: HDR output, Render worker, Panel runtime and panel host ("Reach a GPU API" it can never), Meter and
  degrade ladder, Liveness and recovery, Render-back); Draw path: GPUI or the GPU layer; Check input: export kinds
  (`film.blank`); the perceptual oracle's glossary row.
- Issues #60 (the gpui-kit spike's parts), #64 (the canvas core's parts: scene3d #378 and effects #380 are not
  this task), #140 (the platform seams that fill this issue's traits), #136 (a linked upstream test counts only
  when run against our output). The Oracle page's one upstream test, wgpu's
  `tests/tests/wgpu-validation/noop.rs` at `eddf0b4c8f2c50b7895ad26ee946401e563cdd32`.
- At the base: AGENTS.md; `tests/acceptance/387/` and `305/` (the binary per feature set, `--planted` at startup,
  the reference-Mac gate and the judge, the README's layout), `393/` (a scenario standing in for what the hub
  knows; the shell's question card and its isolated render; GPUI's offscreen Metal renderer for window pixels;
  the PNG reader), `338/` (live tests by hand), `684/` and `313/` (reading `scripts/lanes.mjs`'s `checks`), `96/`
  (fixtures kept in the suite's own `fixtures/parity/` until the corpus lands); `crates/deep-show`,
  `crates/deep-app` (its panels and the `deepbuild` script module, the `Canvas` component),
  `crates/deep-replica` (headless windows and `capture_screenshot`), `vendor/gpui-pre` (`paint_surface` takes
  only CVPixelBuffer video frames; the scene's `surfaces` primitive list), `vendor/gpui-pre-apple` (the Metal
  renderer, the DeepBuild patches so far), `.cargo/config.toml`, `Cargo.lock` (wgpu 29 and 30 only through
  GPUI's Linux renderer crates), `scripts/lanes.mjs`, `scripts/parity.mjs` (a CLI parity check, no `parity/` tree).

What the base already does and these tests don't credit: GPUI draws windows offscreen through its Metal renderer
(#391, #393), the shell's question card is drawn in its slot by `deep-show screen`, and the document check refuses
unknown kinds and fields. There is no GPU layer: no workspace crate depends on wgpu, no `deep-gpu` binary, no BGRA
surface path in GPUI's Metal renderer, no fences, no encode workers, no blank guard, no `noop` lane. So these tests
define the surface below.

## Run them

They build a cargo binary per feature set, as #305's and #387's do, so they run with `--no-file-parallelism`.
`scripts/lanes.mjs` needs this folder added to both unit-lane lines: `--exclude tests/acceptance/377/**` on the
parallel vitest line (it comes from the `alone` list) and `tests/acceptance/377/` in `alone`, the one-at-a-time
line; and criterion 4 needs the new lane `noop` in `checks`. This README is the instruction; the implementer makes
those edits.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/377 --no-file-parallelism
npx tsc -p tests/acceptance/377/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds each feature set it uses, once, with `cargo build --locked --bin deep-gpu [--features
test-pool]` in the checkout, copies the binary out of `target/debug` under its own name in a temporary folder, and
fails each test that uses a build that failed. Each test writes into its own temporary output folder and deletes
it. The tests use node built-ins and vitest. A run with `--root tests/acceptance/377` leaves Vitest's cache in
`tests/acceptance/377/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base.

Everything runs headless: the window is drawn and captured offscreen with GPUI's Metal renderer, as #391's, #392's
and #393's GPU tests are, on the reference Mac's GPU, so no Screen Recording permission is needed (see Readings:
window capture). `budgets.test.ts` skips with an `INCONCLUSIVE` message off a reference Mac (Mac15,7 or Mac15,12,
Low Power Mode off, thermal state nominal; on battery or mains, by the owner's change below), as #305's does; it never passes by skipping. The design's GPU
lease has no entrypoint at the base; the budget file runs alone in the unit lane instead, with nothing beside it.
Expect a long run: the conformance runs draw 10,000 frames at 1936 × 1584 and more.

## The surface under test

The issue names the GPU surface's fields, the copy path, fences, health, encode workers, a test pool, the noop
lane, the compile thread, the blank guard, a plug-in fixture and three planted programs, and one scene path, but no
binary or API. So these tests define the smallest surface they need, after #305's and #393's conventions.

### The binary and its builds

One binary, `deep-gpu`, a bin target in whichever workspace crate the implementer puts it, found at
`target/debug/deep-gpu`. Builds: the shipped build (`cargo build --locked --bin deep-gpu`), and `test-pool`
(`--features test-pool`), which adds the test encode pool (below) and nothing else; no shipped build has it.

`deep-gpu run [--backend noop] [--planted <name>]` reads one JSON scenario per stdin line and writes exactly one
JSON line per input line, in order, then exits 0. `--backend noop` runs the GPU layer on wgpu's noop backend;
without it the GPU layer uses the platform's (Metal on macOS) and never the noop backend. An unknown argument or
planted name answers one `{"ok": false, "code": "bad_input"}` line and exits 2 (#305). A line that isn't a scenario
answers `{"ok": false, "code": "bad_input"}`. A scenario is `{"out": dir, "calls": [Call]}` and is answered
`{"ok": true, "replies": [Reply]}`, one reply per call, whatever the calls' outcomes. All calls of a scenario run
in one process, on one device, in one window: a scene's session (its resources, its slots, its frame clock) carries
from one call to the next. Paths in calls are absolute.

### The window and window capture

Each scene names its window (`window: [w, h]`, px at scale 1), the 2D page GPUI draws over the whole window (a
checker of `page.cell` px cells, colors `page.colors` as RGB, the cell at (0, 0) first, alternating in x and y),
and where the GPU-layer view sits (`view: [x, y]`, its size the frame's). The binary draws the window headless
with GPUI's offscreen Metal renderer at scale 1: the page, the GPU-layer view over it through the handoff, and the
shell's question card last when a call gives one. A capture is that renderer's image of the whole window: it is
written as an 8-bit RGB or RGBA PNG to `<out>/<sha256 of the file's bytes>.png`, and `window_hash` is the SHA-256 of
its pixels as 8-bit RGBA, rows top-down, no padding.

### The scene format (`fixtures/parity/gpu/*.scene`, JSON)

A scene stands in for a document whose GPU-layer view draws an exact picture, so the tests can compute every byte
of every frame. Fields: `scene` (its name), `format` (`bgra8_premultiplied`), `color_space` (`srgb`), `size`
([w, h], the frame's), `frames` (the length of a run), `window`, `view`, `page`, `background` (BGRA), and either
`regions` or `layers`; the handoff scene adds `fence_frames`, `stale_frames`, `resize: {every, sizes}` and
`device_loss_at`; the settling scene adds `budget_class: {upload_bytes_per_frame}`.

Frame `n` of a scene with `regions`, at size [w, h], is exactly: every pixel `background`, then each region painted
in order, each replacing (not blending) what is under it within its rect, clipped to the frame. All values are BGRA8
premultiplied, rows top-down. A region's `rect` is `[x, y, w, h]` in frame px; a `null` w or h runs to the frame's
edge. `moves: {dx, dy, period}` shifts the rect by `(dx, dy) × (n mod period)`. Fills:

- `color: [b, g, r, a]`;
- `ramp: {step, channels, alpha?}`: at column x, `v = min(255, floor((x − rect.x) / step))`; `channels: "bgra"` is
  `[v, v, v, v]`, `"bgr"` is `[v, v, v, alpha]`;
- `stamp: {bits, cell, one, zero}`: cell k (`cell` px wide, k from 0 at the left) is `one` when bit `bits − 1 − k` of
  `n mod 2^bits` is set, else `zero`;
- `texture: {w, h, pattern: "xor"}`: the texel at (tx, ty) = (x − rect.x, y − rect.y) is
  `[tx & 255, ty & 255, (tx ^ ty) & 255, 255]`, drawn 1:1; it is the scene's upload (`w × h × 4` bytes);
- `pipeline: k, color`: the cell drawn `color` by render pipeline `k`, whose shader module is its own (WGSL with k
  and the color as constants), so the scene's `n` such regions need `n` distinct pipelines.

A scene with `layers` holds that many independent writer layers, each a region (rect, `fill.color`, `moves`)
composited in index order over the background with the premultiplied over (source factor one, destination factor
one minus source alpha), each encoded on its own and submitted in frame order by index. `helpers.ts` `slotBytes`
is this formula; the tests hash its output with SHA-256.

The five scenes:

| Scene | What it is | Read by |
|---|---|---|
| `surface-handoff.scene` | The issue's fixture: 1936 × 1584 premultiplied BGRA; an alpha ramp (premultiplied white, 0 to 255), a grey ramp (opaque), a "3D object" (an opaque rect) inside a glow (premultiplied color with alpha 0: light beyond the object over the page), a 50% pane (alpha 128), a 16-bit frame stamp, and an opaque full-height marker that moves 8 px every frame over 23 places; window 2000 × 1648 with the view at (32, 32); 600 frames a run; 10,000 for the fence run; 250 for the stale run, resized every 50 frames through four sizes, the smallest 968 × 792, which every region fits in, with the device lost at frame 125 | criteria 1, 2, 4, 6, 7, 9 |
| `encode-layers.scene` | Eight writer layers of 256 px that overlap with partial alpha and move every frame, 512 × 512, 30 frames | criteria 3, 10 |
| `settling.scene` | A still 1024 × 1024 frame that is one 4 MiB texture, under `upload_bytes_per_frame` 1 MiB | criterion 3 |
| `pipelines.scene` | 48 cells, each drawn by its own pipeline | criterion 4 |
| `blank.scene` | A 256 × 256 frame that draws nothing (background transparent) over a black page | criterion 5 |

### Calls

`scene` is a scene file's absolute path.

**`{"call": "frames", "scene", "from"?: 0, "count"?: scene.frames, "path"?: "zero_copy" | "copy", "layer"?: true,
"card"?: Card, "capture"?: "every" | [frame], "window_hash"?: false, "resize"?: false, "lose_device_at"?: frame,
"fences"?: false, "timings"?: false, "workers"?: n, "pool"?: Pool}`** drives the scene's frames `from` …
`from + count − 1` on a virtual clock in the window: each frame, the GPU layer draws scene frame n into a slot and
the window presents it in the view over the page. It answers `{"frames": [Frame], "fences"?: [Fence],
"device_losses": n}`, one Frame per presented frame, in presentation order:

```json
{"frame": n, "size": [w, h], "path": "zero_copy" | "copy", "pixel_hash": sha256 | null, "settling": bool,
 "window"?: sha256, "window_hash"?: sha256, "handoff_ms"?: ms, "ui_ms"?: ms,
 "encodes"?: [{"layer": i, "completed": rank, "submitted": rank}]}
```

- Without `resize` or `lose_device_at`, every frame of the range is presented once, in order (the virtual clock
  waits for the GPU, never the UI thread).
- `pixel_hash`: the SHA-256 of the slot the frame showed, as BGRA8 rows top-down with no padding, at the frame's
  size; `null` on a backend that can't make pixels. On the noop backend frames are drawn on noop and listed with
  `pixel_hash` null, and the window isn't asked for (no capture, no `window_hash`).
- `path`: the handoff the frame took; without `path` in the call, the surface's current path.
- `layer: false` draws the window without the GPU-layer view (the page alone, and the card if given).
- `card: {"ask", "question", "options": [{"id", "label"}], "rect": [x, y, w, h]}`: the shell's question card,
  presented in its slot (window px), drawn last, as #393's.
- `capture`: capture the window after the listed frames are presented (`"every"`: all), giving `window`.
  `window_hash: true` gives `window_hash` for every frame without writing files.
- `resize: true`: the surface's size for frame n is `resize.sizes[floor(n / every) mod len]`, resized as frame n
  draws; without it, `size`.
- `lose_device_at: d`: the device is lost, forced, while frame d draws; the GPU layer rebuilds and goes on. Frame d
  may be missing; every later frame is presented. `device_losses` counts the losses in this call.
- `fences: true` adds the fence record (Fences, below).
- `timings: true` adds per frame `handoff_ms`, the time the handoff adds to the frame on the GPU layer's path to
  the window, and `ui_ms`, the UI thread's time on the GPU layer in that frame (latching and composing it, the
  handoff's UI-thread part included), both measured by the binary on the host's clock.
- `workers`: the number of encode workers. `pool` (`test-pool` builds only): `{"order": "reverse"}` finishes each
  frame's encodes in reverse layer order, `{"order": "seeded", "seed": n}` in a random order drawn from the seed;
  `encodes` then lists, per layer, the rank its encode finished at and the rank its command buffer was submitted at
  (0 first).

**Fences.** `fences: [{"seq", "event", "slot"?, "frame"?, "cb"?}]` in one order, `seq` rising: `render` (the GPU
layer starts drawing `frame` into `slot`), `gpu_done` (that slot's `gpu_done` fence signalled), `show` (GPUI's
frame whose command buffer is `cb` composites `slot` holding `frame`), `gpui_done` (GPUI's command buffer `cb`
completed), `release` (`slot`'s `released` fence signalled: the slot is free). `slot` is 0 to the slot count − 1.

**`{"call": "surface"}`** → the GPU surface of the run's current scene:
`{"device": {"backend": "metal" | "noop" | …, "count": n}, "path", "size_px": [w, h], "scale", "internal_scale",
"format": "bgra8_premultiplied", "color_space": "srgb", "slots": [{"state": "free" | "rendering" | "ready" |
"on_screen"}], "msaa": "transient", "fps_cap": n | null}`. `device.count` is the app's wgpu devices.

**`{"call": "resources"}`** → `{"device_epoch": n, "resources": [{"module", "name", "kind", "device_epoch"}]}`:
every GPU resource the core and canvas modules declared so far in this run, with the device epoch it was created
on; `device_epoch` is the current device's (one more after each loss).

**`{"call": "conformance", "scene"}`** runs the handoff's conformance fixture on this machine, the platform's
handoff against the copy path, and answers `{"platform": "macos" | …, "result": "pass" | "fail" | "blocked",
"parts": [{"part", "result": "pass" | "fail" | "blocked" | "inconclusive"}], "path"}` with exactly the five parts
`identical` (every frame pixel-identical to the copy path's), `premultiplied` (the glow and the pane over the page),
`fences`, `stale_or_torn` (the resizes and the device loss) and `budget` (1 ms at p95, 0.1 ms on the UI thread).
Its image comparisons go through the blank guard. From then on in the run, the surface takes `path`: on `pass`,
the platform's zero copy; otherwise the copy path at `fps_cap` 30 and `internal_scale` 0.5. Before any
`conformance` call a run starts on the platform's recorded result: macOS, which passes it in this task, on zero
copy (`fps_cap` null).

**`{"call": "health"}`** → `{"readings": [{"code", "part"?, …}]}`: the GPU layer's health readings. Each failed
conformance part shows as exactly one reading whose `part` is that part's name; no other reading has a `part`.

**`{"call": "render", "scene", "frame", "purpose": "canonical" | "export" | "snapshot"}`** → `{"frame",
"pixel_hash", "settling": false}`: a canonical render, an export's frame or a snapshot of that frame.

**`{"call": "compile", "scene"}`** compiles every pipeline the scene needs on the compile thread while the UI
thread runs its frames, and answers `{"pipelines": [{"key"}], "thread": name, "ui_thread": name, "ui_ticks": n,
"ui_max_stall_ms": ms}`: the pipelines' keys, the thread that compiled them, the UI thread, how many UI frames ran
during the compile, and the longest time the UI thread was held up by it, measured by the binary.

**`{"call": "buffer", "size": n, "writes": [{"offset", "bytes": [u8]}]}`** creates a buffer on the GPU layer's
device, writes each write through the queue, reads the whole buffer back and answers `{"size", "read": [u8]}`.

**The image comparison.** `{"call": "compare", "fixture": name, "a": png, "b": png, "tolerance"?: 0, "ids"?:
{"png", "items": {id → [r, g, b]}, "kept": [id]}}` compares two PNG files pixel for pixel within `tolerance` code
values, after the one blank guard: a side whose pixels are at most luma 0.06 (Rec. 709 weights on the 8-bit values
over 255) on at least 98% of them is blank, and the reply is `{"result": "BLOCKED", "reason", "blank": ["a" | "b",
…]}` with no number anywhere in it, unless that frame is declared dark for `fixture` by your decision, by the
SHA-256 of its file, and `ids` (its object-ID pass: a PNG and each item's color in it) shows every `kept` item in at
least one pixel; a dark frame whose pass misses one is BLOCKED too. Otherwise `{"result": "PASS" | "FAIL",
"max_diff", "differing"}`.
`{"call": "declare_dark", "fixture", "frame": sha256, "via": "you" | "agent"}` → `{"outcome": "recorded" |
"already_recorded" | "refused", "code"?}`: who declares it is the connection's, which the scenario stands in for,
as #393's `session` does; an agent's is refused. `{"call": "decisions"}` → `{"dark": [{"fixture", "frame"}]}`, each
declaration recorded once.

**The plug-in fixture.** `{"call": "plugin", "dir", "scene"}` loads the plug-in at `dir` as a plug-in (origin
`plugin`, its own writer) beside a live GPU-layer view drawing `scene`: its `main.js` as the plug-in's panel in the
app's panel runtime (gpui-shell with the app's registry and DeepBuild's `deepbuild` module), rendered for at least
one frame, and each document in its `documents.json` handed to the canvas core as that plug-in's revision. It answers
`{"panel": {"loaded": bool, "text": [string]}, "documents": [{"outcome": "presented" | "refused", "issues":
[Issue]}], "gpu": {"devices": n, "frames": n}}`: every text the panel drew, in tree order; one reply per document;
the app's devices and the frames the GPU layer drew meanwhile. `fixtures/plugin/gpu-probe` is the fixture.

### Planted programs (`--planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `divides_alpha` | The GPUI patch composites the GPU surface by dividing alpha out (unpremultiplying, then blending by source alpha) | 1 (issue-named) |
| `draws_surfaces_after_scene` | The GPUI patch draws GPU surfaces after the rest of GPUI's scene, the card included | 9 (issue-named) |
| `submits_on_completion` | Command buffers are submitted in the order their encodes finish | 10 (issue-named) |
| `releases_before_completion` | A shown slot is released when GPUI's frame is submitted, before its command buffer completes | 1 |
| `waits_on_gpu` | The UI thread waits on the frame's `gpu_done` fence every frame | 7 |
| `compiles_on_ui_thread` | The scene's pipelines compile on the UI thread | 4 |
| `exposes_gpu_to_panels` | The panel runtime gives plug-in scripts a global `deepGpu` holding the GPU layer's device and surface | 6 |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#305's command, with the issue's ten criterion lines on stdin). Each test's name starts
with its criterion's ID. Where a criterion names a wrong program, the test runs it through `--planted` or the test
pool and asserts it fails the way the criterion says; where it names none, a planted program or the check's own
twin (the check run on a doctored copy of the real output) shows the check can fail.

| ID | Criterion (the issue's text) | Tests, what each asserts, and the wrong programs |
|---|---|---|
| `#377.756c6dce` | Each platform's GPU surface handoff ships only after it passes one conformance fixture against the copy path on the same machine (parity/gpu/surface-handoff.scene: a 1936 × 1584 premultiplied BGRA frame with an alpha ramp, a grey ramp and a marker that moves every frame): every frame is pixel-identical to the copy path's; captured from the window, a glow beyond a 3D object over a 2D page and a 50% pane match the f64 premultiplied over of the slot onto the page within one code value, and a planted patch that divides alpha out loses the glow and fails; over 10,000 frames no slot is drawn into while on screen or released before GPUI's command buffer completes, as the fences record; a resize every 50 frames and one forced device loss show no stale or torn frame; and the handoff costs at most 1 ms at p95 at that size, with at most 0.1 ms on the UI thread. macOS passes it in this task; a platform that fails any part uses the copy path, capped at 30 fps at a render scale of 0.5, and health shows one reading naming the part that failed | `handoff.test.ts`: the fixture is the issue's (size, format, the regions, 30 frames give 30 slots); the surface's fields (one device, BGRA8 premultiplied, sRGB, 2 or 3 slots in the four states, transient MSAA, internal scale in 0.5..1, zero copy on macOS) and each slot equal to the scene's bytes. All 600 frames on the zero-copy and the copy paths: each `pixel_hash` the scene's frame, each `window_hash` equal across the paths, the first capture not blank and hashing to its `window_hash`. Frame 0 captured on both paths and the page alone: in `glow`, `pane` and `alpha_ramp` every non-opaque pixel within one code value of slot + page × (1 − α) in f64; `divides_alpha` fails that check naming `glow`. 10,000 frames' fence record replayed: every frame rendered once and shown, no `render` into a slot on screen, no `release` before every command buffer that showed the slot completed, no `show` before `gpu_done`; the check's twins (a release moved before its completion; a render into the shown slot) fail it; `releases_before_completion` fails it naming the slot. 250 frames resized every 50 and the device lost at 125, on both paths: one loss, frames in order with only frame 125 allowed missing, each slot its own frame at its scheduled size, each window equal to the copy path's; frames 49–51, 99–101, 149–151, 199–201, 124, 126 and 127 captured: every opaque slot pixel exactly in the window and everything outside the view's rect exactly the page; the check's twins (frame 50 judged as 49; rows of 51 over 50) fail it. `conformance` passes all five parts on this Mac, keeps zero copy, and health names no part; with `divides_alpha` it fails `premultiplied`, takes the copy path, `fps_cap` 30, `internal_scale` 0.5, and health holds one reading for each failed part, naming it, `premultiplied` among them. `budgets.test.ts`: five runs of 600 frames, zero-copy `handoff_ms` p95 ≤ 1 ms and `ui_ms` p95 ≤ 0.1 ms by the judge; every copy run's p95 above every zero-copy run's (the measure sees the handoff). Wrong programs: the base (no binary); the alpha-dividing patch; a release before completion; a draw into the shown slot; a stale or torn frame after a resize or the loss; a blank pair compared as identical; a fixed copy path for every platform |
| `#377.e281b005` | A forced device loss in the middle of a scene rebuilds every declared GPU resource, and the next frame's pixel hash equals a clean start's | `device-loss.test.ts`: the handoff scene, frames 0–119, `resources`, frames 120–239 with the device lost at 120, `resources`: one loss; the device epoch one more; every resource declared before is declared after, of the same kind, on the new epoch (the check's twin, one resource left on the old epoch, fails naming it); frame 121's `pixel_hash` equals a fresh process's frame 121, which is the scene's; every frame but 120 is the scene's, and every frame after 120 is presented. Wrong programs: a resource not rebuilt; a rebuild that restarts the scene's time or draws from stale state |
| `#377.6fcbd42e` | A frame's pixel hash is the same with 1 and 4 encode workers, and no canonical render, export or snapshot uses a frame that reports settling | `encode.test.ts`: the eight-layer scene's 30 frames with 1 worker (each drawn, each different) and with 4: every frame's hash equal. `settling.test.ts`: live frames: at least the first three report settling, in a row, none holding the whole texture, and every settled frame exactly the texture; a `canonical`, `export` and `snapshot` render of frame 0 each in a fresh process and each asked for after two live frames that report settling: `settling: false` and exactly the texture. Wrong programs: a result that depends on worker scheduling; a canonical render, export or snapshot of a settling frame |
| `#377.8131b7ba` | The noop lane runs the render-logic tests without a GPU, and compiling a document's pipelines on the compile thread never stalls the UI thread for more than 2 ms on the reference Mac | `noop.test.ts`: a lane named `noop` in `scripts/lanes.mjs`'s `checks`, each of its commands exiting 0; wgpu's `noop.rs` ported to our device (`--backend noop` gives a noop device that writes 1–8 at offsets 0 and 4 and reads them back; without it the device is never noop, Metal on macOS); on noop the declared resources, the 48 pipeline keys and the frames (sizes, settling) equal the default backend's, which draws the scene, and noop reports no pixels. `budgets.test.ts`: five runs compiling `pipelines.scene`: 48 pipelines on a thread other than the UI thread, with UI frames during it, the longest UI-thread stall ≤ 2 ms by the judge; `compiles_on_ui_thread` judged FAIL. Wrong programs: no lane; a noop backend that is Metal; render logic that depends on the backend; a compile on the UI thread |
| `#377.5a0d84fc` | One blank guard runs before every image comparison the parity fixtures make: a frame that is blank or black on either side (luma at most 0.06 over at least 98% of its pixels) makes the comparison BLOCKED with no other number, never PASS, unless your decision declared that frame dark for the fixture, recorded once with its hash, and its object-ID pass still shows each kept item; an agent's dark declaration is refused; a fixture where the GPU layer and its CPU reference both draw nothing is BLOCKED | `blank.test.ts`: black against content, content against black and black against black are BLOCKED with no number in the reply, naming the blank sides; two equal content frames PASS and two grey-16 frames a pixel apart FAIL with numbers. Grey 15 everywhere BLOCKED, grey 16 not; exactly 98% at grey 15 BLOCKED, 97.99% not. An agent's declaration refused and the frame still BLOCKED; yours recorded, the second `already_recorded`, `decisions` holding one record with the frame's hash; the declared frame then compares (PASS) while its ID pass shows `lamp` and `chair`, and is BLOCKED when `chair` is missing, in another fixture, or for another dark frame. `conformance` on `blank.scene`: `blocked`, and its `identical`, `premultiplied` and `stale_or_torn` parts `blocked`. Wrong programs: no guard (two blank frames PASS); numbers beside BLOCKED; a guard any declaration lifts |
| `#377.84a84b5e` | No plug-in or agent code path reaches the GPU or the window's drawing surface, checked by a plug-in fixture that tries | `plugin.test.ts`, the `gpu-probe` plug-in beside a live view: its panel's probe ran to its end, searched every global and the exports of `gpui-kit`, `gpui-base`, `gpui-component` and `deepbuild`, found `navigator.gpu` absent and reached nothing; one device; the GPU layer drew meanwhile. Its documents: the plain one presented; raw pixels, a `gpu.surface@1` item, a `surface` field and a WGSL shader each refused with an error issue. `exposes_gpu_to_panels` is caught, naming `found:global:deepGpu`. Wrong programs: a panel route to the GPU or surface; a document route for pixels or a surface |
| `#377.f6925067` | The UI thread spends at most 0.1 ms per frame on the GPU layer | `budgets.test.ts`: five runs of 600 frames, each run's worst frame's `ui_ms` ≤ 0.1 ms by the judge; `waits_on_gpu` judged FAIL. Wrong program: a UI thread that waits on the GPU |
| `#377.66576129` | No game engine is a dependency of the app; the canvas draws with its own wgpu renderer | `deps.test.ts`, from `cargo metadata --locked`: a workspace crate of ours (not under `vendor/`) depends on wgpu directly; the `deep-gpu` binary's crate is it or depends on it; no game engine (bevy, fyrox, godot, macroquad, ggez, piston, amethyst, rend3, kiss3d, raylib, nannou, three-d and the like) in the normal dependency tree, any target, of `deep-app`, the GPU layer's crate or the binary's crate; the same metadata with `bevy` planted under `deep-app` fails the check naming it. Wrong programs: an embedded engine; no wgpu renderer of our own |
| `#377.30608b7b` | With a GPU-layer view under the card's slot, the card's interior pixels in a window capture equal its isolated render on the zero-copy and the copy paths; a patch that draws surfaces after GPUI's scene covers the card and fails | `card.test.ts`: the handoff scene's frame 0 with the card in a 480 × 240 slot over the view's opaque background and the marker's path, captured on both paths, and the card's isolated render (the same window without the view): the view draws under the slot (its pixels there differ from the card's), the interior (16 px in) isn't blank and equals the isolated render pixel for pixel on both paths; `draws_surfaces_after_scene` changes the interior. Wrong program: the patch that draws surfaces last |
| `#377.8ae4f399` | With a test pool that finishes encodes in reverse and in 20 seeded random orders, every frame's pixel hash equals the 1-worker run's; a planted submit-on-completion fails on the reverse order, naming the frame | `encode.test.ts`, the `test-pool` build, 4 workers: the reverse pool and seeds 1–20: every frame's encodes finish once each (in reverse for the reverse pool; more than five distinct orders across the seeds) and are submitted in index order, and every frame's hash equals the 1-worker run's; `submits_on_completion` on the reverse pool changes a frame's hash, the failure naming the frame. Wrong program: submission by completion |

## Blind redraft that replaced a first draft

One first draft couldn't pass on any implementation, so it went to a blind redraft of this job (design:
Dogfooding). On October 24 the owner approved the redraft in place of the first draft, and the first draft and its
fixture were removed. The criteria table above describes the first draft; for this criterion, read the redraft.

| Criterion | First draft (removed) | Why it couldn't hold | Redraft | Notes |
|---|---|---|---|---|
| `#377.84a84b5e` | `plugin.test.ts` and `fixtures/plugin/gpu-probe`, all three tests | its probe's word list matched gpui-shell's own `__gpui` and `__gpui_components`, the panel runtime's element bridge, since "gpui" contains "gpu"; and it required the raw-pixels, `gpu.surface@1` and WGSL documents refused, where the design skips an item of a kind the build doesn't carry with the notice `unknown_kind`, never drawing it | `plugin-redraft.test.ts` and `fixtures/plugin/gpu-probe-redraft` | `A6-REDRAFT.md` |

## The owner's change to the reference-Mac gate

On October 24 the owner dropped the mains-power requirement from this suite's reference-Mac gate: the budget
tests judge on battery or mains alike. The gate still requires a reference Mac, Low Power Mode off and a nominal
thermal state. The change is `environmentProblem` in `helpers.ts` (the mains check removed) and the comment in
`budgets.test.ts`.

## Readings where the issue and design leave a choice

- **One binary standing in for the app's GPU layer.** The issue names fields and behaviors, not an API, and the app
  can't be driven headless with a fixture document at the base; so a `deep-gpu` binary drives the GPU layer, the
  GPUI patch and the shell's window offscreen from JSON lines, as `deep-show` does for #393. The scenes stand in
  for documents whose GPU-layer views draw exact pictures, since no 3D or effect kind lands in this task (#378,
  #380); render modules' named places, declared targets, cost and determinism class aren't on the surface.
- **Window capture.** "Captured from the window" and "in a window capture" are read as GPUI's own offscreen Metal
  render of the whole window, with the handoff composited by GPUI as on screen; the design keeps render-back off
  your screen, and this needs no Screen Recording grant. A capture of the window as the window server composites it
  on a shown display is not covered: no `*.live.test.mjs` is included, because the criteria name nothing the
  window server adds over GPUI's frame.
- **The glow, the 3D object and the page** are pixels of the scene, not a bloom pass (#380): light beyond an object
  is premultiplied color with alpha 0 ("Bloom adds to color and leaves alpha"), which survives only when the
  surface stays premultiplied; the over is checked on every non-opaque pixel of the glow, the pane and the alpha
  ramp, against the page captured alone. The f64 over is clamped at 255; the scene's colors never reach it.
- **"Every frame is pixel-identical to the copy path's"** is read on both the slot's bytes and the window's pixels,
  frame by frame, over a 600-frame run; "the fixture" is the scene, run at its `frames`.
- **Fences.** "As the fences record" makes the binary's record the evidence; it is replayed slot by slot. "Released
  before GPUI's command buffer completes" counts every GPUI frame that showed the slot since it was drawn.
- **Stale or torn.** Every presented frame's slot must be its own frame at its scheduled size, and its window must
  equal the copy path's; frames around each resize and the loss are also captured and held exactly where the slot
  is opaque and outside the view. The frame the device is lost in may be dropped; no other may.
- **The budget.** "At most 1 ms at p95 at that size" is each run's p95 of `handoff_ms` over 600 frames at 1936 × 1584,
  judged over five runs; "with at most 0.1 ms on the UI thread" is the same p95 of `ui_ms`. Criterion 7's "per frame"
  is read as each run's worst frame. The times are the binary's own, as #387's `scheduler_ms` is; that the copy
  costs more than zero copy in every run, and that the planted `waits_on_gpu` and `compiles_on_ui_thread` are
  judged FAIL, show the measures can see what they measure.
- **"A platform that fails any part"** is a failed `conformance` run, driven on macOS by `divides_alpha`; "uses the
  copy path, capped at 30 fps at a render scale of 0.5" is read on the surface's `path`, `fps_cap` and
  `internal_scale`, and on the frames after it. Health's "one reading naming the part that failed" is one reading
  with `part` for each failed part: the planted patch may also fail `identical`, if only its zero-copy composite
  divides alpha out.
- **Device loss** is forced by the binary (`lose_device_at`); "every declared GPU resource" is what `resources`
  lists; "a clean start's" hash is a fresh process drawing the same frame first.
- **Encode workers and the test pool.** Independent writer layers that overlap with partial alpha make submission
  order show in the hash; `encodes` lets the tests see that the pool did what it says.
- **Settling** is driven by an upload four times the class's `upload_bytes_per_frame`. "Uses a frame that reports
  settling" is read on the render's pixels: they must be the settled frame's, computed from the scene.
- **The noop lane.** Its tests are the implementer's; these tests require the lane by name and its commands to pass,
  and check the noop backend the GPU layer offers: the port of wgpu's noop tests against our device, render logic
  equal to Metal's, and no pixels (the design: a probe the noop backend can't make is BLOCKED, never faked).
  That the lane's own tests open no Metal device can't be seen from outside on macOS; it isn't checked.
- **The compile stall** is the binary's longest UI-thread hold-up while `pipelines.scene`'s 48 pipelines compile.
- **The blank guard.** Luma uses Rec. 709 weights on the 8-bit values over 255 (the threshold probes are grey, so the
  weights don't decide them); "no other number" is no JSON number anywhere in the reply; "your decision" and "an
  agent's" are the connection's identity, which the call's `via` stands in for; "recorded once with its hash" is one
  `decisions` row with the file's SHA-256, a second declaration answered `already_recorded`; "still shows each kept
  item" is each kept item's ID color in at least one pixel of the pass. "The GPU layer and its CPU reference both
  draw nothing" is read twice: two blank images compared, and the handoff fixture's own comparisons on a scene that
  draws nothing over a black page.
- **Plug-in and agent code paths.** A plug-in reaches the canvas by documents and by its panel script; the fixture
  tries both. The probe can only find what a script can name, so it searches globals and module exports by GPU and
  surface words; the planted route is a global so the probe reaches it. An agent's only path is the document one
  (deep_show), whose refusals #393's suite holds; it has no panel.
- **Game engines** are named by crate; the list is the suite's, and the check reads normal dependencies on every target.

Not tested, because no criterion asks or the surface can't reach it: Linux's and Windows' handoffs (R3); the
upscale and sharpen (#386); HDR output; reversed Z, OKLab ramps and the exact gradient mode beyond #391's; pass
timestamps and the meter (#379); the draw-key replay of unchanged batches; the GPU lease; a shown window's capture by
the window server; the merge-base comparison of the budgets, which is the perf lane's.

## Upstream tests (the Oracle lane)

The Oracle page links one upstream test, for criterion 4: wgpu's `tests/tests/wgpu-validation/noop.rs` at
`eddf0b4c8f2c50b7895ad26ee946401e563cdd32`, marked "port". Its three tests (`device_is_not_available_by_default`,
`device_is_available_when_requested`, `device_and_buffers`) are ported in `noop.test.ts` and run against our GPU
layer's device through `deep-gpu`, as #136 requires, not against wgpu's build. The other nine criteria have none;
these tests are their local proof.
