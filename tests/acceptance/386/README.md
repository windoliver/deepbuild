# Acceptance tests for #386: upscaling the live view — an edge-adaptive upscale and sharpen below internal scale 1, with status drawn after

Written first, from issue #386 (its two scope lines, its four acceptance criteria and its proof line), the design
sections it links and those they lean on, and base commit `c9225aa3` ("Merge pull request #976 …"), by a job that
never saw an implementation; none existed. The issue's Oracle line says no upstream test checks these criteria, so no
upstream test is ported. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

What was read:

- AGENTS.md; `docs/technical-design.md`: Dogfooding and "Tests written first, by a job that never sees the code"
  (2518, 2549); the budgets table's canvas row (2405: "no heap allocation per frame after warm-up, under 256 MB of GPU
  memory per window measured on the device", a showpiece "full screen on the reference Mac's display at half
  resolution while moving"); Every task carries its own budgets (five runs after warm-up, PASS / FAIL / INCONCLUSIVE,
  the margin the larger of 5% and the spread, merge-base comparison); The reference Macs; the GPU memory decision
  (2630).
- `docs/canvas-primitives.md`: The trusted compositor (657): Document session ("check off the UI thread, ≤ 50 ms per
  10,000 items"), **GPU surface** (830: `internal_scale: 0.5 to 1 = 1`, `upscale: edge_adaptive | bilinear | temporal =
  edge_adaptive`, `sharpen: 0..1 = 0.2`; "Below internal_scale 1, a live view returns to full size through an
  edge-adaptive spatial upscale and a contrast-adaptive sharpen, two passes that read only this frame, instead of a
  bilinear stretch; canonical renders run at scale 1 and never use it"; Cost: "the upscale's two passes about 0.15 to
  0.3 ms at 1080p"; It can never: "upscale a canonical render, or read a frame from outside the live view's window to
  upscale"); Status binding (2178: on a 3D object "a status binding … takes its stroke slot, drawn as an outline around
  the object, or its badge"; "Draws unlit after tone mapping and effects, so the color is exact"); Look `look@1`
  (status map, `status_treatment`, `min_distance`, `lines`, `basis: drawing`) and its frame history (2554: "Status
  colors, text and overlays draw after the resolve"); Marks in 3D: mesh edges (4590: "draw thinner than one device px"
  never); the Pack looks (`drawing_ink`); Flicker check (8841: `max_flashes` 3 per s, `area` 0.25, `luminance_delta`
  0.1, `darker_max` 0.80; "A flash is a pair of opposing changes. Its area is the combined share of the view whose
  pixels make that change at once … flashes are counted in every one-second sliding window"); the frame order (9117:
  "… the status guard, the spatial upscale and sharpen or frame history's resolve, then status colors and overlays at
  display size, depth-tested against the core's depth target"); Determinism class (9200: the live upscale is live
  only; its fallback for canonical renders, exports, goldens and checks is scale 1).
- Issues #64, #241 (where this sits) and the three it depends on, #379, #382 and #140, through their suites.
- At the base: `tests/acceptance/379/` (the `live` and `canonical` calls, the meter's reports, the counting allocator,
  the reference-Mac gate and the judge, the perf lane), `382/` (`view3d`'s status bindings, `states` and `status`
  report, the ID target, PNG reading), `378/` (`view3d`, its documents, camera channels), `377/`, `140/` (gpu, view,
  platform: the budgets' merge-base pattern); `crates/deep-gpu-layer` (`main.rs`'s calls and `Planted`; `live.rs`,
  `liveview.rs`: the upscale's two pipelines `surface.upscale` and `surface.sharpen`, compiled for the ladder's
  `internal_scale_down` rung; `effects.wgsl`: the upscale and sharpen shaders; `view3d.rs`; `status.rs`: a stroke
  binding is refused with `status_slot_kind`, "the stroke slot's outline isn't drawn here yet"; `session3.rs`),
  `crates/deep-scene3d-render` (the status passes `status.guard` and `status.colors`), `crates/deep-canvas-scene3d`
  (`mark.text@1`, `mark.line@1`, `paint` reads only the fill), `benchmarks/canvas.mjs`, `benchmarks/budgets.json`,
  `scripts/benchmark.mjs` (`validateBudgets`), `scripts/lanes.mjs`.

What the base already does and these tests don't credit: #379's live window draws a session below scale 1 only on the
ladder's `internal_scale_down` rung, through an upscale shader and a fixed 0.2 sharpen; nothing lets a view or a session
choose its internal scale, its upscale or its sharpen, there is no bilinear stretch to compare with, `view3d` (the live
view whose pixels a test can read) always draws at scale 1, a stroke status binding is refused, a 3D object has no
stroke (its `paint` reads only the fill), and status colors draw as a layer composited after the guard with no depth
test. The base's document check also estimates `cityDoc` (10,000 boxes, a showpiece) at about 300 ms of CPU per
frame (about 0.03 ms a box) and refuses it with `over_budget` before it shows, so C2's live runs fail there at the
base. So these tests define the surface below.

## Run them

They build `deep-gpu` (the shipped set, and #379's `test-meter` set for the budgets), as #377's, #379's and #382's
suites do, so they run with `--no-file-parallelism`. `scripts/lanes.mjs` needs this folder in its `alone` list,
beside `tests/acceptance/379/` and `382/`. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/386 --no-file-parallelism
npx tsc -p tests/acceptance/386/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds what it uses, once, with `cargo build --locked --bin deep-gpu [--features test-meter]` (with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0`), copies the binary out of `target/debug` to a temporary folder,
and fails each test that uses a build that failed. Each test writes into its own temporary folder and deletes it. The
tests use node built-ins and vitest, and `scripts/benchmark.mjs`'s `validateBudgets` (as #379's do). A run with `--root
tests/acceptance/386` leaves Vitest's cache in `tests/acceptance/386/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base.

Every test that draws runs the GPU layer on Metal, on macOS: off macOS it fails with a message that starts
`INCONCLUSIVE:` and never passes there; a reply of `unsupported_platform` reads the same way. The budget tests (C2) also
fail `INCONCLUSIVE:` off a reference Mac (`hw.model` Mac15,7 or Mac15,12), and a timing between PASS and FAIL by the
design's rule fails `INCONCLUSIVE:` too. No test is gated on power, Low Power Mode, thermal state or load (the owner's
rule, as #379's suite). Tests marked "holds at the base" check this suite's own measures and fixtures; they prove
nothing about the implementation and are not criterion proofs on their own.

## The surface under test

The issue names the GPU surface's fields and the order the passes run in, but no code API. The live view whose pixels
a test can read is #378's `view3d` (a document's 3D writer layers drawn through a GPU-layer view, with seeks, captures,
the object-ID target and #382's status report); the live window of sessions, with the meter's timings, allocations and
memory and the canonical renders, is #379's `live`. So these tests add **one field, `surface`, to both**, a few reply
fields, the stroke slot of a 3D object, and planted programs. No new binary, no new call.

### `surface`: the view's GPU surface fields

```json
"surface": {"internal_scale": 0.5..1 = 1, "upscale"?: "edge_adaptive" | "bilinear" = "edge_adaptive", "sharpen"?: 0..1 = 0.2}
```

On a `view3d` call (top level) and on a `live` session (`{"session", "writer", "doc", "size"?, "surface"?}`), as the GPU
surface's `internal_scale`, `upscale` and `sharpen` (the issue: "set by the upscale and sharpen fields the GPU layer
part ships"). Below internal scale 1 the view renders its targets at `size × internal_scale` and returns to `size` through
the upscale: `edge_adaptive` is the edge-adaptive spatial upscale followed by the contrast-adaptive sharpen at `sharpen`;
`bilinear` is a bilinear stretch (the tests send `sharpen: 0` with it). At internal scale 1 nothing upscales.
`temporal` (frame history's, R6) isn't used here. Line marks 1 device px or thinner (mesh edges, outlines, strokes) and
status colors draw at `size` after the upscale and sharpen, depth-tested against the core's depth target (the issue's
second scope line). Canonical renders (render-back, export, frame budget) run at scale 1 and never upscale, whatever a
live session's surface says.

Replies:

- `view3d` adds `"surface": {"internal_scale", "upscale": "edge_adaptive" | "bilinear" | "none", "sharpen", "size_px":
  [w, h], "internal_px": [w, h]}`: what the view drew through (`none` at scale 1; `internal_px` within 1 px of `size ×
  internal_scale`). Its `passes` list (#382's) holds `surface.upscale` and `surface.sharpen` (the names the base's
  `liveview.rs` already gives them) below scale 1, in order: `status.guard` before `surface.upscale`, `surface.upscale`
  before `surface.sharpen`, `surface.sharpen` before `status.colors`, and `status.colors`' `reads` include `depth`.
- `live`: each frame's view adds `"upscale": "edge_adaptive" | "bilinear" | "none"` beside its `internal_scale`; each
  canonical render (`canonicals[]` and the `canonical` call) adds `"upscale"`, which is always `none`; each session's
  revision row adds `"check_ms"`, the time its check took before it could show (off the UI thread, from receipt to the
  check's verdict). With `report: ["passes"]`, a frame below scale 1 lists `surface.upscale` and `surface.sharpen`
  timed like every other pass.

### The stroke slot of a 3D object

- `paint.stroke: {role, width: px}` on a `mark.box@1` (any solid) draws an outline around the object in that role,
  `width` device px wide (C4's cube: `{role: "ink", width: 1}`).
- A status binding whose target is `items/<id>/params/paint/stroke` is accepted and draws the state's color exact as an
  outline around the object (Status binding), reported in `status.marks` with `slot: "stroke"` and the 8-bit color,
  with its legend (#382's). The base refuses it with `status_slot_kind`.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `bilinear_only` | The edge-adaptive upscale draws a bilinear stretch, with no sharpen | C1 (a mutant) |
| `upscale_reads_previous_frame` | The upscale blends in the view's previous frame (reading a frame from outside this one) | C1 (a mutant of the GPU surface's "It can never") |
| `exports_live_surface` | A canonical render takes the live session's internal scale and upscale | C1 (a mutant of "canonical renders never use them") |
| `slow_upscale` | The upscale's passes spin for about 1 ms at 1080p | C2 (a mutant: the reading sees the passes) |
| `status_before_upscale` | Status colors draw at internal size, before the upscale and sharpen | C3 (a mutant) |
| `status_without_depth` | Status colors draw after the upscale with no depth test | C3 (a mutant) |
| `outlines_before_upscale` | Outlines draw at internal size before the upscale | C4 (issue-named: "a planted path that draws outlines before the upscale") |

#379's `allocates_per_frame` (the meter grows a list every frame) is reused for C2's allocation check.

### The perf lane

`benchmarks/budgets.json` gains a task `canvas-upscale` with command `["node", "benchmarks/canvas.mjs", "upscale"]` and
an `initialReason` naming #386, valid by `validateBudgets` against the merge base's budgets; the command exits 0 on a
reference Mac. It is the merge-base comparison the criterion names (the perf lane runs each task on the change and on
its merge base); what it measures is the implementer's, beside the tests' own judgments of the limits.

## Fixtures (`helpers.ts`)

- Looks: `PLAIN_LOOK` (ink #16181d on paper #f7f6f2, tone map none at unit exposure, no status map), `STATUS_LOOK`
  (the clean look's status map as #382's suite has it, fail #bf232b; `tower` #d9dde3 and `hall` #e6d3a3 on a night
  ground), `INK_LOOK` (an ink look: `basis: drawing`, ink #141418 on paper #f4f1e8, tone map none).
- `typeDoc()` (C1, C2's passes): 1920 × 1080, an orthographic camera looking along −Z, 48 labels of 12 px text
  (`mark.text@1`, `size: 12`, screen size) and 24 diagonal lines 2 device px wide (`mark.line@1`, 15° to 75°); a label
  and a line move by channels over 2 s.
- `streetDoc({hall, binding})` (C3): a tower 1.4 × 3 × 1.4 m behind a hall 2.05 × 2.8 × 1 m that hides its lower left
  half from a camera on +Z at elevation 12°, on a floor, under a sun; `binding` binds the tower's stroke slot to a
  verdict, in state fail.
- `cubeDoc(outline)` (C4): a 1.6 m paper cube, with `outline` its stroke `{role: ink, width: 1}`, under a perspective
  camera whose azimuth a channel turns at 10° a second (30° to 50° over 2 s), no sun.
- `cityDoc()` (C2): 10,000 boxes on a 100 × 100 grid under an orbiting camera, one box sliding, so every frame
  evaluates; sent to `live` as a showpiece through `payload()` (#393's writer payload: no `id`, `layers` or item
  `layer`).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading
`- [ ] ` dropped, computed with #607's command (as #305's README gives it) on the issue's four criterion lines. Each
test's name starts with its criterion's ID.

| ID | Criterion (the issue's text) | Tests, what each asserts, and the wrong programs |
|---|---|---|
| `#386.2434f61e` (C1) | At internal scale 0.5, a frame of 12 px text and thin diagonal lines upscaled to 1080p scores at least 2 dB higher PSNR against the same frame drawn at scale 1 than a bilinear stretch does, seeking equals playing by pixel hash, and an export is byte-identical with the upscale on or off | `upscale.test.ts`: `typeDoc`'s frame 30 drawn by `view3d` at scale 1, at 0.5 edge-adaptive (sharpen 0.2) and at 0.5 bilinear (sharpen 0), each reporting the surface it drew through, its PNG equal to its pixel hash; the edge-adaptive view runs `surface.upscale` then `surface.sharpen`; PSNR (8-bit RGB, whole frame) against scale 1 of the edge-adaptive frame at least 2 dB above the bilinear frame's. Seek: frames 0 … 45 played at 0.5 edge-adaptive, then seeks to 20 and to 45: equal pixel hashes (and 20 ≠ 45). Export: a `live` session of the document with the upscale on (0.5, edge-adaptive) and off (scale 1), each drawn so on every frame, and a fresh `canonical` call: the export frame of frame 31 has one pixel hash in all three, each at internal scale 1 with upscale `none`. Wrong programs: the base (no `surface`); `bilinear_only` fails the 2 dB, naming the gap; `upscale_reads_previous_frame` fails, naming the frame; `exports_live_surface` fails, naming the export. Holds at the base: the fixture's frame at scale 1 has ≥ 10,000 ink pixels (relative luminance under 0.5), under 25% of the frame, and moves |
| `#386.b603e2cd` (C2) | Budgets, on the reference Mac in the local preflight, compared with the merge base: evaluating a 10,000-item document takes under 4 ms of CPU per frame with no heap allocation after warm-up; checking it before it shows takes under 50 ms; GPU memory stays under 256 MB per window; the upscale's two passes take under 0.3 ms at 1080p | `budgets.test.ts`: the perf lane's task `canvas-upscale` (valid against the merge base, naming #386; exits 0 on a reference Mac). On a reference Mac, `cityDoc` live full screen on its display at 0.5 edge-adaptive (every frame so drawn): a warm-up run and five fresh runs of 360 frames on `test-meter`: frames 61 … 360 count 0 heap allocations in every run, and each run's p95 `cpu_ms` over them judged under 4 ms; each run's first revision `current` with `check_ms`, judged under 50 ms; on the shipped build, 120 frames with `report: ["memory"]`: Metal's allocated size above `device_before` peaks above two full-size slots and under 256 × 10^6 B. `typeDoc` live at 1080p, 0.5 edge-adaptive, `report: ["passes"]`: every frame after warm-up has both passes timed by timestamps; each of five runs' p95 of their covered time judged under 0.3 ms. Wrong programs: the base (no task, no `surface`, no `check_ms`); `allocates_per_frame` fails naming frame 61; `slow_upscale` reads over 0.3 ms × 1.05 |
| `#386.5663e962` (C3) | At internal scale 0.75, a status-bound building half behind another reads its exact sRGB status value where it shows and doesn't show where it's hidden, since status colors draw after the upscale and sharpen, depth-tested against the core's depth target | `status-depth.test.ts`: `streetDoc` at 0.75 edge-adaptive with the tower's stroke bound (fail), with and without the hall, and both again at scale 1 for the object-ID target. Passes run `status.guard` → `surface.upscale` → `surface.sharpen` → `status.colors`, which reads `depth`; one stroke mark on `tower`, fail, #bf232b. Without the hall, the pixels of exact #bf232b (outside the legend's and mark labels' boxes) number at least half the tower silhouette's boundary pixels and all lie within 8 px of it: the outline. With the hall: each of those pixels 4 px or more from every hall pixel is still exactly #bf232b (at least 100 of them), and no pixel within 8 px of the tower's silhouette and 4 px or more inside the hall comes within 0.10 OKLab of fail (at least 30 outline pixels lie there). Wrong programs: the base (`status_slot_kind`, no `surface`); `status_before_upscale` fails (the outline isn't exact, or the pass order), naming the tower or the passes; `status_without_depth` fails, naming the outline where the hall hides it. Holds at the base: the hall hides between a third and three quarters of the tower |
| `#386.c280eed3` (C4) | At internal scale 0.5 in an ink look, a cube's 1 px outline over 120 frames of a 10°-a-second orbit stays 1 device px wide and flickers no more, by the flicker check's measure, than at scale 1; a planted path that draws outlines before the upscale draws them 2 px wide and fails, naming the item | `outline.test.ts`: `cubeDoc` in `INK_LOOK`, frames 0 … 119 at 60 fps, inked and bare, at 0.5 edge-adaptive and at scale 1. Per frame, the outline's width is its coverage area (inked against bare, same scale) over the cube's silhouette length (convex hull of its ID-target pixels at scale 1): at scale 1 and at 0.5 within [0.6, 1.5] device px and at 0.5 within 0.8–1.25 times scale 1's. The flicker check's measure on the inked frames: in every one-second window, the share of the view that flashes at 0.5 at most 1.05 × scale 1's + 10⁻⁴, and no pixel flashing more than the larger of 3 and scale 1's most. Wrong programs: the base (no `surface`, no stroke); `outlines_before_upscale` fails naming `cube` and a frame, its median width ratio ≥ 1.6. Holds at the base: the flicker measure on synthetic frames (a toggling pixel flashes ~30 times a second in a quarter of the view; a still view, a change of 0.1 and one above 0.80 never), the width measure on 1 and 2 px lines, the hull of a square; the cube is on screen and the orbit turns it |

## Readings where the issue and design leave a choice

- **Two calls, one field.** The issue says the upscale and sharpen are set "by the upscale and sharpen fields the GPU
  layer part ships"; the design's GPU surface holds `internal_scale`, `upscale` and `sharpen`. They're one `surface`
  object on a `view3d` call and on a `live` session, so a test chooses them directly instead of driving the ladder to a
  rung whose scale the design leaves to it. `view3d` is used for pixels (PSNR, seeks, outlines, the status outline);
  `live` for the export, the meter's CPU, allocations and memory, and pass timings.
- **The frame of 12 px text and thin diagonal lines** is a 3D document of screen-size labels and lines, since `view3d`
  and `live` draw 3D writer layers; 2D layers aren't drawn by the GPU layer here. The lines are 2 device px wide: the
  issue's scope draws lines 1 device px or thinner after the upscale, so those would prove nothing about it. Labels go
  through the upscale (the scope moves only line marks and status colors after it).
- **"A bilinear stretch"** is `upscale: "bilinear"` with `sharpen: 0`. PSNR is 10 log₁₀(255² ÷ MSE) over R, G and B of
  every pixel of the 1080p frame, against the frame drawn at scale 1 in the same process.
- **"Seeking equals playing"** is read at internal scale 0.5 with the upscale on (a seek is `view3d`'s `from`), on two
  frames, through the moving label and line.
- **"An export … byte-identical with the upscale on or off"** is the export frame's bytes, by #377's pixel hash, of a
  `canonical` event in a live window whose session draws at 0.5 edge-adaptive ("on") and at scale 1 ("off"), and of a
  fresh `canonical` call; each reports scale 1 with no upscale (Determinism class: the live upscale's fallback is scale
  1).
- **Budgets.** "Compared with the merge base" is the perf lane's task, as #379's and #140's budgets are; these tests
  judge the issue's limits on this machine by the design's rule. "A 10,000-item document" is a showpiece of 10,000
  boxes full screen on the reference Mac's display at internal scale 0.5 (the issue's subject, and the showpiece's
  "half resolution while moving"), at 30 fps; every frame evaluates (a channel slides a box and turns the camera).
  "CPU per frame" is the frame's `cpu_ms`, p95 over frames 61 … 360; warm-up is frames 1 … 60, as #379's suite reads
  it. Allocations are counted by #379's `test-meter` counting allocator, so the CPU runs are on that build too.
  "Checking it before it shows" is the first revision's `check_ms` in each fresh process. "Per window" is Metal's
  allocated size less its value before the call, at its peak over 120 frames; 256 MB is 256 × 10^6 B. "The upscale's two
  passes" is the union of `surface.upscale`'s and `surface.sharpen`'s timestamp intervals per frame, p95 per run.
- **The status-bound building** is a tower whose stroke slot is bound (the outline the Status binding row names for a
  3D object), not its badge: a badge is a chip at the item's screen box and would say nothing about depth. "Half behind
  another" is a nearer hall hiding between a third and three quarters of it. Where the outline belongs is read from the
  same street without the hall, at the same scale and camera, so the outline's width and offset stay the implementer's;
  "where it shows" and "where it's hidden" keep 4 px clear of the hall's edge, which the depth target at internal scale
  0.75 can't place exactly; "doesn't show" is no pixel within 0.10 OKLab (the look's status distance) of fail.
- **"A cube's 1 px outline"** is its stroke slot `{role: ink, width: 1}` (an outline around the object, so its
  silhouette, not its creases). "Stays 1 device px wide" is read by coverage, so antialiasing and the angle don't bias
  it: the area the ink takes from the bare frame, over the silhouette's length; [0.6, 1.5] admits a 1 px line drawn
  without antialiasing on a diagonal (0.71) and a slightly wide antialiased one, and the ratio to scale 1 (0.8–1.25)
  catches a 2 px outline. "The ink look" is a `basis: drawing` look of ink on paper, as the Pack's `drawing_ink`.
- **"Flickers no more, by the flicker check's measure"** applies the check's own definitions (a change counts when
  relative luminance moves by more than 0.1 with the darker frame below 0.80; a flash is a pair of opposing changes;
  one-second sliding windows) at both scales; the check's verdict thresholds (3 flashes, 25% of the view) would pass any
  thin outline, so the quantities they're compared with are compared instead: each window's share of the view that
  flashes, at most 5% (and 10⁻⁴ of the view) above scale 1's, and the most flashes a pixel makes, no more than the
  larger of 3 and scale 1's. The 120 frames are 0 … 119 at 60 fps, the orbit turning 20°.
- **"Naming the item"** is the check's failure sentence, which starts `cube: frame n: outline … device px wide at
  internal scale 0.5`; "2 px wide" is the planted outline's median width at least 1.6 times scale 1's.

Not tested, because no criterion asks or the surface can't reach it: `upscale: temporal` (frame history's, R6); mesh
edges and 2D strokes below 1 px (the C4 outline stands for line marks); the ladder choosing an internal scale (#379's);
the sharpen's value other than 0.2 and 0; HDR output under the upscale; status badges at internal scale below 1.

## Upstream tests (the Oracle lane)

The issue's Oracle line says no upstream test checks these criteria; these tests are their local proof.
