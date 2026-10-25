# Acceptance tests for #378: scene3d in 3D — 3D marks and the city, picking, depth at city scale, and instanced draws that replay

Written first, from issue #378 (its scope, the "Marks in 3D: lines" fields and their "It can never" line, its eight
acceptance criteria and its proof line), the design sections it links and those they lean on, and base commit
`6173ee0` ("Merge pull request #718 …"), by a job that never saw an implementation; none existed. There is no
Oracle page for #378, so no upstream test is ported. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Rules every primitive follows (863: pure evaluation, "drawn as instanced, batched GPU
  calls", "Composites such as the city … with no special path", units: 3D in meters, +Y up); The canvas core (1050),
  Canvas modules (1056, the scene3d row 1073: "marks in 3D (`mark.point`, `mark.line`, `mark.box` and the rest) with
  their facing"; render modules add passes into the frame's places), Conventions (1089: reversed Z from R2, "a
  `Depth32Float` target cleared to 0, compared greater-or-equal, with an infinite far plane for perspective cameras;
  the far distance only bounds culling"; "3D shades in linear light, then tone-maps and encodes"; "a figure is a scene
  with a card, an isometric camera and an audit"); Look (1305); Camera and overlay (1313); GPU operator (1332); Dirty
  classes and content key (1492: "A move uploads one instance record and never rebuilds a mesh. A batch whose draw
  list is unchanged since the last frame replays what it encoded then"); Render-back (1500); How we know version 0
  works (2476), with the canvas modules' kit on "wgpu's noop backend (R2)" and a probe the noop backend can't make
  BLOCKED (2505), Dogfooding (2518), the parity suite (2538: "CPU references … stay reviewed test code"; "depth,
  normal and object-ID passes each have one exact encoding"; the blank guard), Tests written first (2549).
- `docs/canvas-primitives.md`: Units and axes (28); Writer layer (428: one layer per writer; "A writer layer that
  holds any 3D item is a 3D writer layer … and draws its 2D items as marks in 3D or overlays"); Frame clock and
  scheduler (721: `frame_seq` per window); Frame callback and presentation feedback (754: `{session, rev,
  frame_seq, presented_at_ns | discarded, refresh_ns, flags}`); Band (769); Spatial index (811: "3D picking uses
  the object-ID target … holding stable IDs"); GPU surface (827: "A 2D layer anchored to a 3D layer's items draws
  from the evaluated data of the `frame_seq` its shown slot carries, and presentation feedback reports that
  `frame_seq`"; "Shows the newest ready slot"); Render worker (860: `draw_key`, "a reusable encoding wgpu keeps",
  transform and shading keep the encoding, feature set, geometry or presence encode again); Path `path@1` (1520,
  ends); Mark set: logic columns (2095); Look `look@1` (2405: `tone_map`, `exposure: EV100`, `finish: [effect]` "with
  identity defaults"), its tone mapping (2433: agx's analytic curve, neutral after Khronos's reference, "`filmic`
  names the ACES fit the prototype uses") and deband (2499: physical looks deband by default); Object (2765: one
  instance record per object, "a 3×4 world matrix, material slots, a `u32` pick ID, flags", "A move touches 64 B,
  never a mesh"); Camera `camera@1` (4381); Overlay (4502: "An overlay anchored to an item's point in a 3D writer
  layer draws in screen pixels at that point's projection at t plus its offset"); Marks in 3D (4544), its lines
  (4566), facing (4603: "`upright` turns it about +Y only so text stays level"); Level of detail (4951); Dirty
  classes (5036: "presence (shown, created, deleted) changes batch membership"); Content key (5052).
- Issues #377, #372, #305, #387 (this issue's dependencies) as the base holds them, and #64's parts.
- At the base: AGENTS.md; `tests/acceptance/377/` (the `deep-gpu` binary, `--backend noop`, `--planted`, the
  window and its capture, scenes, PNG files named by their hash, `pixel_hash`), `372/` (camera@1 fixtures, the
  pinhole projection, `test.dot`), `393/` (`deep-show run | screen`, deep_show documents as an agent sends them,
  the evidence store), `387/` and `305/` (criterion IDs, the build-per-binary helpers), `391/` and `392/` (GPU
  tests INCONCLUSIVE off macOS; looks as `look@1` objects); `crates/deep-gpu`, `crates/deep-gpu-layer` (`deep-gpu
  run` and its calls), `crates/deep-show` (its calls), `crates/deep-canvas` (kinds, `apply.rs`'s ops and its one
  layer per writer, camera), `crates/deep-canvas-marks/looks/clean.json`, `crates/deep-canvas-motion` (channels by
  path), `scripts/lanes.mjs` (the `noop` lane is `cargo test -p deep-gpu`), `packages/evidence`.

What the base already does and these tests don't credit: `deep-gpu` (#377) runs a GPU layer on Metal or wgpu's noop
backend and draws parity scenes into slots composited by GPUI's offscreen window; `deep-show` presents 2D deep_show
documents with render-back snapshots through Vello CPU and draws the window; channels drive item paths. There is no
scene3d canvas module: no `mark.*` kind is registered (deep_show refuses the figure with `module_missing` naming
`items/base/kind: mark.box@1`), no 3D writer layer, no linear target, tone map or object-ID target, no instance
records, no draw keys or batch replay, no overlay anchored to a 3D item. So these tests define the surface below.

## Run them

They build two cargo binaries, as #377's and #393's suites do, so they run with `--no-file-parallelism`.
`scripts/lanes.mjs` needs this folder in its `alone` list (the one-at-a-time unit-lane line, and so excluded from the
parallel line), beside `tests/acceptance/377/`. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/378 --no-file-parallelism
npx tsc -p tests/acceptance/378/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds the binaries it uses, once, with `cargo build --locked --bin deep-gpu` or `--bin deep-show`
in the checkout, copies each out of `target/debug` under its own name in a temporary folder, and fails each test that
uses a build that failed. Each test writes into its own temporary output folder and deletes it. The tests use node
built-ins, vitest and `packages/evidence`'s public entry. A run with `--root tests/acceptance/378` leaves Vitest's
cache in `tests/acceptance/378/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base.

The tests that read pixels draw them with the GPU layer on Metal, on macOS, headless, as #377's, #391's, #392's and
#393's GPU tests do: off macOS, and wherever the binary answers `unsupported_platform`, they fail with a message that
starts `INCONCLUSIVE:`; they never pass there. The counting tests (criteria 4 and 7) run on wgpu's noop backend
(`deep-gpu run --backend noop`), with no GPU, on every platform. No test is gated on power, Low Power Mode or load:
no criterion here has a time budget.

## The surface under test

The issue names marks, fields, the depth fixture, the draw-key replay, the noop lane, presentation feedback and four
planted programs, and `deep_show` for criterion 1, but no code API. So these tests define the smallest surface they
need, on the two binaries that exist: **one new call, `view3d`, on #377's `deep-gpu run`**, and **#393's `deep-show
run | screen` unchanged** (criterion 1 needs no new field). No new binary.

### `deep-gpu run [--backend noop] [--planted <name>]`

#377's JSON-lines protocol holds unchanged: one scenario `{"out": dir, "calls": [Call]}` per stdin line, answered
with exactly one line `{"ok": true, "replies": [Reply]}`, one reply per call whatever its outcome, in order, then
exit 0; a line that isn't a scenario answers `{"ok": false, "code": "bad_input"}`; an unknown argument or planted
name answers one `{"ok": false, "code": "bad_input"}` line and exits 2. All calls of a scenario run in one process
on one device. Files are written under `out`, each named by the SHA-256 of its bytes with its extension
(`<out>/<sha256>.png`, `<out>/<sha256>.f32`), as #377's captures are.

### The `view3d` call

```json
{"call": "view3d",
 "doc": path, "look": look@1, "size": [w, h],
 "frames"?: 1, "fps"?: 60,
 "patches"?: [{"frame": n, "writer": string, "ops": [Op]}],
 "targets"?: ["final" | "linear" | "ids"], "capture"?: "every" | [n],
 "window"?: {"size": [w, h], "view": [x, y], "page": [r, g, b]},
 "latency"?: [k],
 "counts"?: false}
```

It opens the document at `doc` (a JSON file: a whole document with its `layers`, each with its `writer`, and every
item's `layer`, as a session holds it) as one document session drawn by the GPU layer into a view of `size` device px
at scale 1 and internal scale 1, with `look` as its look (a `look@1` object, standing in for the look asset, as
#392's calls take one), and latches frames 0 … `frames − 1`, frame n for t = n ÷ `fps`, on a virtual clock. Each
frame's 3D writer layers draw through the GPU layer into a slot; with `window`, the view sits at `view` in a
headless window of `size` whose page is the flat color `page`, the document's 2D writer layers are drawn by GPUI over
the view in the view's px (by band), and the window is presented once per latched frame. The camera is the item the
document's `camera` names.

- `patches`: each patch's `ops` (#389's `create`, `set`, `unset` and `delete`) apply as `writer` (standing in for its
  connection) before frame `frame` latches, so frame `frame` is the first to show them.
- `targets` and `capture`: for each frame in `capture` (`"every"`: all), the named targets are read back and written:
  `final`, the slot's pixels as an 8-bit RGBA PNG (the slot's BGRA8 bytes with the channels reordered, values
  unchanged); `linear`, the 3D writer layers' linear target, before exposure and the tone map, as read back: raw
  little-endian f32 RGBA, rows top-down, `w × h × 16` bytes (`.f32`); `ids`, the object-ID target as an 8-bit RGBA PNG
  whose pixel holds the pick ID `r + 2^8·g + 2^16·b + 2^24·a`, 0 where nothing draws. With `window`, every captured
  frame also writes the window capture (GPUI's offscreen render of the whole window, as #377's) as `window`.
- `latency` (a fault fixture, reachable only through this field): the slot drawn for frame n is held not ready (its
  `gpu_done` withheld) until frame n + kₙ is presented, kₙ = `latency[n mod len]`. Each present shows the newest
  ready slot (GPU surface), so it may show an earlier frame's slot. The tests use k ∈ {0, 1}.
- `counts: true` adds the per-frame counters below.

It answers `{"frames": [Frame], "passes": [Pass]}`, one Frame per latched frame in order:

```json
{"frame": n, "frame_seq": s, "pixel_hash": sha256 | null,
 "final"?: sha256, "linear"?: sha256, "ids"?: sha256, "picks"?: {"<pick ID>": item ID}, "window"?: sha256,
 "encoded"?: [{"batch": name, "items": [item ID]}], "replayed"?: n, "instances_written"?: n, "meshes_built"?: n}
```

- `frame_seq`: presentation feedback's `frame_seq` for the present at frame n: the frame whose evaluation the shown
  slot carries, where the frame latched for t = n ÷ fps has frame_seq n. With no `latency` it equals `frame`.
- `pixel_hash`: SHA-256 of the slot drawn for frame n as BGRA8 rows top-down with no padding (#377's definition),
  every frame; null on a backend that makes no pixels (noop), where no target or window is written either. `final`,
  `linear`, `ids` and `picks` describe the slot drawn for frame n; `window` is the window as presented at frame n.
- `picks`: every pick ID in the frame's ID target, in decimal, mapped to the item it stands for.
- `encoded`: the batches the render worker encoded for frame n, each named (`batch`, a name stable for that batch
  across the call) with every item it draws; `replayed`: how many batches frame n replayed from an earlier encoding
  (Render worker). `instances_written`: the instance records written for frame n; `meshes_built`: the meshes built
  for frame n (Object, Dirty classes).
- `passes`: the passes of the view's frame in order, `{"name", "reads": [target], "writes": [target]}`, where the
  target named `linear` is the 3D writer layers' linear target and `final` is the slot. Exactly one pass writes
  `final`.
- Off the reference platform a reply may be `{"code": "unsupported_platform"}`; any other `code` is a refusal.

### Documents and the look (`fixtures/`)

Documents use the base's envelope and item shape (#372's, #389's), with scene3d's kinds as `family.name@major`:
`mark.box@1` (`size: [m, m, m]`, centred on `at.pos`), `mark.cylinder@1`, `mark.line@1` (the issue's fields:
`points` as `[x, y, z]` or an item ID, `mode`, `width` as one number or one number per point, `size_space`, `paint`),
`mark.text@1` (`text`, `font`, `size`, `size_space`, `facing`, `paint`) and `mark.point@1` (`size`, `shape`,
`paint`); `camera@1` as #372 reads it, with `near`; channels on paths (`items/cam/params/orbit/azimuth`); a 2D
writer layer's `frame@1`, `circle@1` and `overlay.frame@1` (`frame`, `anchor: {item, point}`, `offset`). Paint is by
role, never a literal color.

`look.json` is a `look@1`: the clean look's status map, glyphs, legend and fonts, `basis: physical`, a black
`ground`, one role per fixture color, `tone_map: none`, `exposure` −log₂ 1.2 (the EV100 whose scale is 1),
`finish: []` and `deband: none`. Tests change `tone_map` and `exposure` only.

| Fixture | What it is | Read by |
|---|---|---|
| `city-depth.json` | 640 × 480, a perspective camera at (0, 2, 0) looking down −Z, fov 40, `near` 0.1, no `far`: pair A (near face listed first) and pair B (listed last), each a 300 m face 0.5 m in front of a 600 m face at 5 km; a post 1.5 m away; twelve blocks 12 m to 24,576 m away, each sized to about 26 px | criterion 2 |
| `thin-lines.json` | 800 × 600, orthographic, 40 px per m: lines of 0.25, 0.5 and 1 px, each centred on a pixel row | criterion 3 |
| `move.json` | nine 1 m boxes under a still camera | criterion 4 |
| `wires.json` | 800 × 600, orthographic: one six-point wire, widths 6, 18, 6, 18, 6, 30 px, drawn as `strip`, `segments` and `loop` | criterion 5 |
| `upright.json` | 640 × 480, orthographic orbit at 60° elevation turning 90° a second: "FFFF" in 1.5 m type, `facing: upright` (red) and `facing: camera` (green) | criterion 5 |
| `grey-bands.json` | 512 × 512, orthographic: 32 grey 16 px bands from 0 to 255, 188 among them, filling the frame | criterion 6 |
| `orbitDoc()` in `helpers.ts` | generated: 40 writer layers (each its own writer's) of 50 one-paint 1 m boxes on a 2.5 m grid, and a camera layer whose orbit camera turns 900° in 10 s | criterion 7 |
| `anchored.json` | 480 × 360: a 3D writer layer with a red 16 px `mark.point` 3 m from the target; a 2D writer layer with a green dot in a 16 px frame, shown by an `overlay.frame@1` anchored to the point with offset (−8, −8); a perspective camera turning 90° a second | criterion 8 |
| `machine-figure.json` | the figure as a skill's agent sends it through deep_show (no `id`, no `layers`): an isometric camera on a pump (base, housing, piston, flywheel, crank), a rod joining the piston and the crank by their IDs, three labels with leaders, and channels that move the piston and turn the crank over a 2 s loop | criterion 1 |

### `deep-show` (criterion 1)

#393's surface, unchanged: a `deep-show run` scenario binds the agent session `sess-alpha`, one panel over the
800 × 600 window, and the minted document `01JB7F00000000000000000378` on it, and makes deep_show calls with the
figure, `t`, `size` and `include: ["issues", "pixels"]`; snapshots are read from the evidence store through its
public entry; `deep-show screen` draws the window and lists each item with its box in window px. Both are run with
`DYLD_PRINT_LIBRARIES=1`, so dyld lists on stderr every library the process loaded.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `forward_z` | Forward Z: depth cleared to 1, compared less, with a finite far plane at 10 km | 2 (a mutant: the criterion names none) |
| `encodes_twice` | The pass that writes the final frame sRGB-encodes its result and writes it into an sRGB-format target, so it's encoded twice | 6 (issue-named) |
| `skips_encode` | That pass writes its tone-mapped linear value into the 8-bit target unencoded | 6 (issue-named) |
| `encodes_every_frame` | The render worker encodes every batch every frame, never replaying; it is also criterion 7's run "that encodes every draw each frame" | 7 (issue-named) |
| `replays_after_add` | A batch whose membership changed by an add keeps replaying its old encoding | 7 (issue-named) |
| `pairs_newest_slot` | The compositor draws the current frame's 2D layers over whatever slot it shows | 8 (issue-named) |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped, computed with #607's command (as #305's README gives it) with the issue's eight criterion
lines on stdin. Each test's name starts with its criterion's ID. Where a criterion names a wrong program, the test
runs it through `--planted` and asserts it fails the way the criterion says; where it names none, a planted mutant or
the check's own twin (the check run on a doctored copy of the real output, or on another part of it) shows the check
can fail.

| ID | Criterion (the issue's text) | Tests, what each asserts, and the wrong programs |
|---|---|---|
| `#378.6ab4aece` | A skill's figure (an isometric machine with labeled parts and motion) renders natively through `deep_show`, with no web view | `figure.test.ts`: three deep_show calls of the figure at 0 s, 0.5 s and 0 s: each presented with no error issue and one snapshot of 640 × 480, not blank by the blank guard's measure, at least 5% of it off the ground; 0.5 s differs from 0 s (motion), and 0 s twice is one PNG. `deep-show screen`: every part and label has a box inside the window; each part's box isn't bare ground; each label's box is 2–80% dark ink. Neither process loads WebKit, WebKitLegacy, WebCore, JavaScriptCore, a Chromium embedder or a WebView2 loader (dyld's list, at least 20 libraries seen), and `cargo metadata --locked` puts no web-view crate (wry, tauri, webkit2gtk, webview2-com, objc2-web-kit, cef, servo, …) in the normal tree of deep-show's crate or deep-app. Twins: a WebKit load added to the real list, and wry planted under deep-show, each fail, named. Wrong programs: the base (no 3D marks: refused `module_missing`); a figure drawn in a web view; a still or blank render |
| `#378.29d4b8e6` | A fixture with surfaces 0.5 m apart at 5 km shows no depth fighting, and no part of the city is clipped by a far plane | `depth.test.ts`: the fixture first holds what the criterion asks (0.5 m at 5 km, near 0.1, no far, a block past 20 km, everything inside the frame by the test's projection). In the ID target, every pixel of each near face (inset 3 px) is that face in both draw orders, every pixel of the far face around it is the far face, and the 25 pixels at each block's and the post's projected centre are that item; in the final frame no pixel of a near face is nearer the far face's median color than its own. `--planted forward_z` fails it, naming a fighting pair and both blocks past 10 km as clipped. Wrong programs: forward Z (fights at 5 km); a finite far plane; draw order standing in for depth |
| `#378.cbedd951` | A 3D line requested at 0.25 px draws at one pixel with its alpha scaled to 0.25, within 5% | `thin.test.ts`, from the linear target: coverage = (value − ground) ÷ (the 1 px line's value − ground) per column over 560 columns; the 0.25 px line covers its row at 0.25 ± 5% in every column, and each row beside it at most 5% of 0.25; the 0.5 px line at 0.5 the same way; the 1 px line draws its row fully and nothing beside it. Twins: the 1 px and 0.5 px lines fail the 0.25 check. Wrong programs: a thin line drawn at full alpha, not at all, or spread over two rows |
| `#378.f24f1923` | A move updates one instance record and rebuilds no mesh | `move.test.ts`, counted on the noop backend: frame 0 builds at least one mesh and writes at least nine records (the counters count); the move's frame writes exactly one instance record and builds no mesh; the still frames around it write and build nothing. Twins: the reply doctored to build a mesh, or to write nine records, on the move fails, naming frame 2. On the GPU, the moved frame's pixel hash equals a fresh run of the moved document's and differs from the frame before. Wrong programs: a move that rebuilds the mesh or rewrites the batch's records; a move that doesn't show |
| `#378.9c0b9845` | A wire with per-point width draws in strip, segment and loop modes, and a label set to stay upright stays upright while the camera orbits | `wire.test.ts`: in the ID target, each wire draws exactly its mode's segments (strip: 0→1 … 4→5; segments: 0→1, 2→3, 4→5; loop: strip and 5→0), each 1.5 px of its two points' widths interpolated at 30%, 50% and 70% along, and none of the others; each wire fails the other two modes' checks. The upright label, over 30 captures of a 4 s orbit at 90° a second: its ink's major axis within 4° of level and 2° of frame 0's; its size within 3 × 2 px of frame 0's; where its ink sits in its box within 0.06 of frame 0's and of the camera-facing label's (not mirrored or upside down); its width the camera-facing label's within 3 px and its height cos 60° of that label's within 2.5 px (it turns about +Y only). Twin: the camera-facing label fails the upright check on its height. Wrong programs: one mode for all; one width for a whole wire or a step per point; a label fixed in the world (it turns edge-on) or facing the camera |
| `#378.a263a507` | In a 3D writer layer under each tone map, with the finish at identity, every 8-bit pixel of the final frame equals within one code value the CPU's sRGB encoding of the look's exposure and tone map applied to the same frame's linear target read back; a planted output that encodes twice (a linear 0.5 reaching the encode reads 223, not 188) or not at all (128) fails, naming the pass | `tone.test.ts`: for none, filmic, agx and neutral, at EV100 −log₂ 1.2 (scale 1) and 3 stops brighter (scale 8), all 262,144 pixels of the final frame within one code value of this suite's CPU reference applied to the linear target (the final frame is the slot `pixel_hash` names; the bands' linear values rise down the frame). Under none at scale 1, the 188 band's pixels (a linear 0.5029 reaching the encode) read 188; `--planted encodes_twice` reads 223 there and `--planted skips_encode` 128, and each fails the comparison with one problem naming `pass <the pass that writes final>`. Wrong programs: an output encoded twice or not at all; a wrong exposure or curve; a finish or deband that moves pixels |
| `#378.9e1f580f` | Unchanged draw lists replay: a static 3D fixture of 2,000 boxes in 40 batches, all in view while the camera orbits it for 10 s, encodes each batch once, in the first frame, counted on the noop lane, and every frame equals by pixel hash on one machine a run that encodes every draw each frame; a patch that moves one box or recolors it encodes nothing again, and one that adds a box encodes only that box's batch again, each next frame equal to the clean run; a planted worker that keeps replaying after the add leaves the new box out and fails, naming the batch, and one that encodes every batch each frame fails the count | `replay.test.ts`, 600 frames at 60 fps: on noop, frame 0 encodes 40 batches, each exactly one row's 50 boxes, 2,000 in all; no later frame encodes anything (the move at 200 and the recolor at 300 included) but frame 400, the add, which encodes one batch, row 29's 50 boxes and b29-50, and replays the other 39. `--planted encodes_every_frame` fails at "frame 1 encodes 40 batches again"; `--planted replays_after_add` fails naming row 29's batch (by its frame-0 name) at frame 400. On the GPU: every frame's pixel hash equals the `encodes_every_frame` run's, frames differ as the camera turns, the counts hold, and every box (and b29-50 from frame 400) has pixels in the ID target at frames 0, 150, 300, 399, 400 and 599; the `replays_after_add` run equals the reference before frame 400, differs at frame 400, named, and leaves b29-50 out of frame 400's ID target. Wrong programs: no replay; replay across a membership change; encode on a move or a recolor |
| `#378.c16ba7c3` | While a camera orbits at 90° a second, a 2D marker anchored to a 3D point stays within 0.5 px of it in a capture of every presented frame, and presentation feedback reports the `frame_seq` the shown slot carries; a planted composer that pairs the newest slot with the current 2D layers fails, naming the frame | `anchor.test.ts`, 60 frames, every present captured: run A (no latency) reports frame_seq = frame, the point moves more than 1 px every frame, and the green marker's weighted centroid is within 0.5 px of the red point's in every capture; run B (latency 0, 1, 1, 0, 1, 0, 1, 1) shows an earlier frame in at least a third of its presents, each present's point sits within 0.5 px of where run A's frame `frame_seq` draws it (feedback names the shown slot's frame), and the marker stays within 0.5 px of the point. `--planted pairs_newest_slot` fails, naming `presented frame n (frame_seq s)`. Wrong programs: the planted composer; feedback that reports the newest frame instead of the shown one |

## Blind redrafts that replaced first drafts

Three first-draft tests couldn't pass on any implementation, so they went to a blind redraft of this job (design:
Dogfooding). On October 25 the owner approved the redrafts in place of the first drafts, and the first drafts were
removed. The criteria table above describes the first drafts; for these tests, read the redrafts. The redrafts'
run at the base is `BASE-FAILURE-REDRAFT.txt`.

| Criterion | First draft (removed) | Why it couldn't hold | Redraft | Notes |
|---|---|---|---|---|
| `#378.6ab4aece` | `figure.test.ts`, both tests | `machine-figure.json` names no `requires.modules`, and the document check (#305) refuses a kind of a canvas module outside R1 that `requires.modules` doesn't name, as the design asks ("A document declares the canvas modules its kinds need") | `figure-redraft.test.ts`, on `fixtures/machine-figure-requires.json` (the same figure with `requires: {modules: {scene3d: "^1"}}`) | `C1-REDRAFT.md` |
| `#378.29d4b8e6` | `depth.test.ts`, second test (`--planted forward_z`) | every face of `city-depth.json` faces the camera square on, so each face has one depth, and whether forward Z shows the near face is one f32 rounding per face, not fighting per pixel; on this Mac's Metal device both near faces won | `depth-redraft.test.ts`, on `fixtures/city-depth-oblique.json` (the fixture turned 36.87° about the camera's vertical axis), with a clean-run control | `C2-REDRAFT.md` |

## Readings where the issue and design leave a choice

- **One call on an existing binary.** The GPU layer's device, the noop backend, the window and its capture, `--planted`
  and the JSON-lines protocol are #377's `deep-gpu`; this issue's 3D documents draw through it, so `view3d` is one
  more call there rather than a new binary. Criterion 1 names `deep_show`, so it goes through #393's `deep-show`.
- **Batches.** "2,000 boxes in 40 batches" is the fixture's 40 writer layers: each layer is its own writer's (the base
  refuses two layers with one writer), holds fifty boxes of one mesh and one paint, and independent writer layers
  encode on their own (Render worker), so a batch never spans layers and each layer is one batch. A recolor changes
  a paint's role and is a shading change (Dirty classes: "shading touches only a material or paint buffer"); the
  criterion requires that it encodes nothing.
- **The orbit** is a linear channel on the camera item's `orbit.azimuth`, 90° a second, so runs replay exactly; it
  turns the camera a document's data holds rather than the viewer's camera, which a test can't drive by input here.
- **Exposure.** The look's `exposure: EV100` scales linear light by 1 ÷ (1.2 × 2^EV100), the saturation-based
  photometric exposure (the camera model the design's lens formula EV100 = log₂(N² ÷ t) − log₂(ISO ÷ 100) belongs
  to); EV100 −log₂ 1.2 is scale 1. The linear target read back is the 3D writer layers' before exposure.
- **The tone maps** are this suite's reviewed CPU reference (parity suite: "CPU references … stay reviewed test
  code"): `none` clamps to [0, 1]; `filmic` is the ACES filmic fit (Narkowicz 2015), x(2.51x + 0.03) ÷ (x(2.43x +
  0.59) + 0.14), since the prototype the design names isn't in the public repo; `agx` is the design's analytic curve
  with contrast 1.25 and white 16.29; `neutral` is Khronos PBR Neutral. AgX's inset and outset matrices map grey to
  grey, so the fixture holds only grey pixels and their values never enter. Then the sRGB transfer function and
  rounding to 8 bits. "With the finish at identity" is `finish: []` and `deband: none` (physical looks deband by
  default).
- **"Naming the pass"** is the pass the reply's `passes` says writes `final`: the comparison's failure names it.
- **The linear 0.5.** Grey 188 decodes to 0.5029, which at scale 1 under `none` reaches the encode as 0.5029:
  sRGB gives 188, twice gives 223, none gives 128 (the criterion's numbers).
- **Depth.** "Shows no depth fighting" is read in the object-ID target (one exact encoding) and the final frame; the
  near face must win in both draw orders. "No part of the city is clipped by a far plane": blocks out to 24.6 km,
  with no `far` set (auto, from bounds), each drawn at its projected place. The projection is #372's pinhole
  (position, target, +Y up, fov across the wider side). `forward_z` is a mutant for a criterion that names none.
- **Thin lines** are measured in the linear target against the 1 px line on the same frame, so neither the ground's
  value nor how a role decodes enters; a 1 px line on a pixel-centred row covers that row only.
- **Per-point width** is an inline array, one width per point, in px with `size_space: screen`; between two points
  the width interpolates linearly. Thickness is read across the segment in the ID target, within 1.5 px.
- **Upright.** In world size space under an orthographic camera at elevation e, a label turned about +Y only is
  cos e as tall as one facing the camera and as wide; that and a level baseline through the orbit are what
  "stays upright" is read as. "FFFF" reads differently mirrored or upside down, which the ink's place in its box shows.
- **The anchored marker** is an `overlay.frame@1` in a 2D writer layer whose frame's origin draws at the anchor's
  projection plus `offset` (Overlay), its dot centred in the frame. Latency is a fault fixture that withholds a
  slot's `gpu_done`, so the compositor has an earlier slot to pair the 2D layers with; feedback is checked by where
  the point sits in the shown slot. Centroids are weighted by how red or green a pixel is.
- **Criterion 1's figure** has no card overlay (an R6 overlay set); "labeled parts and motion" are its three labels
  with leaders and its two channels. "Natively, with no web view" is read as: drawn by the canvas core through
  `deep_show` into its render-back snapshots and GPUI's window, by processes that load no web engine and builds that
  hold no web-view crate. The deep_show snapshot of a 3D layer needs the GPU, so these tests are INCONCLUSIVE off
  macOS.

Not tested, because no criterion asks: points, curves, arcs, tubes, raised areas, spheres, images and glTF meshes;
dash, caps, joins and `ends`; points read from a piece's logic array; composites (graph, tree, treemap, timeline,
charts, flows, the transit line) and the Map in 3D (#643); levels of detail and R-tree culling; picking by pointer
(the ID target is read only as a measure); the registry and seal for scene3d (#305's suite); per-component
scheduling and content keys (#387's); status colors through a status binding.
