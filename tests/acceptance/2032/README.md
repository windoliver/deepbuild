# Acceptance tests for #2032: shadows in a lit 2D group, closed paths that block light cast hard shadows from point lights and a sun, pure in t

Written first, blind, from issue #2032 (its opening paragraph, its scope, its eight acceptance criteria, its proof line
and its "Runs on" line), the design sections it links and those they lean on, and base commit `e748313c3` ("Merge pull
request #2809 …"), by a job that never saw an implementation; none existed, and no other worktree, branch or pull
request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding). Lean: one test per criterion clause that needs its own run, plus exactly the planted
wrong programs the criteria name. The issue's oracle page says no upstream test checks these criteria, so there is no
oracle lane.

Out of scope here, as the issue says: soft penumbras, atlas tiles that occlude, normal pages on images, and shadows
cast by 3D items.

## What was read

- The issue, live (`gh issue view 2032`).
- `docs/canvas-primitives.md`: Time and the flick; Units and axes; The path grammar; The status-color rule; The cost
  model; Path `path@1` (the `occlude` field, the path's segments and its paint) and its ops; Paint (fill and stroke);
  Paint: shade; Paint: drop; Frame and group `frame@1`, `group@1` (the `light` field, a light's `kind` and a sun's
  `angle`, and the semantics of an occluding outline, a shadowed pixel, a sun's shadows and the 4,096-segment cap); Look
  `look@1`: light; and the fields that state which way a 2D angle turns (an overlay's `edge_angle`, a pan's `angle`,
  the `wipe` and `push` transitions, a key's `travel: arc`, a path's angle mark).
- `docs/technical-design.md`: 2D marks and paint; Films and figures on the canvas; the parity suite ("From R2, the
  canvas core's fixtures form a parity suite …") and the CPU reference ("A CPU reference counts as an oracle only once
  …"); Dogfooding; Tests written first.
- At the base, only to learn how surfaces are driven: AGENTS.md; `tests/acceptance/2031/` (README, helpers, every test,
  BASE-FAILURE.txt); the helpers of `467/` and `465/`; `494/`'s helpers (a path's position); `crates/deep-canvas-marks/
  src/light.rs`, `crates/deep-gpu-layer/src/{lightfx,main}.rs` (how a lit group, a planted name and a refusal are
  reported); `scripts/{lanes.mjs,lease}`. No expected value comes from them.

## What the base already does, which these tests don't credit

#2031 is in the base: a lit group draws its point lights and its ambient level on the GPU layer (`window2d`, `film2d`)
and on Vello CPU (`raster`), and the check refuses a 17th light, a nested lit group and a light in a status role. No
code reads `occlude` on a path or `kind` on a light: an occluding path draws and checks as a path without the field,
open or closed, and casts no shadow; a light with `kind: "sun"` and no `at` is refused (`bad_doc`, at the light's `at`);
a path with no paint at all is refused (`bad_paint`); and none of the planted names below exists (`bad_input`).

## Run them

Every file builds `deep-gpu` or `deep-canvas-render` and most draw on the GPU, so they run one file at a time.
`ac7-plain-lit.test.ts` also builds both binaries at the merge base, and `ac8-budget.test.ts` judges a GPU budget. The
implementer adds these lines to `scripts/lanes.mjs`; this README is the instruction, and this job edits nothing outside
its folder.

```js
// #2032's files each build deep-gpu or deep-canvas-render and draw on Metal; ac7 also builds both at the merge base,
// and ac8 judges the shadows' GPU budget on the reference Mac.
alone.push('tests/acceptance/2032/');
timed.push('tests/acceptance/2032/ac8-budget.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/2032 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/2032    # type-check
rm -rf tests/acceptance/2032/node_modules/.vite
```

- **Build.** Each file builds what it drives once (`cargo build --locked --bin <bin>`, #467's `useBin`) and copies it out
  of the target folder, honoring `CARGO_TARGET_DIR`; a failed build fails each test that uses it. AC7 also exports the
  merge base's tree and builds `deep-canvas-render` and `deep-gpu` there, through #2031's `useMergeBase`, which keeps
  both under `<target>/acceptance-2031-base` for the next run of the same merge base: a cold build the first time.
- **Platform.** The issue's "Runs on" line: "Spark for the CPU segment tests and the refusals; the reference Mac for
  frames and the budget, INCONCLUSIVE elsewhere". The CPU segment tests are this suite's own f64 test: each frame
  test first checks its fixture and that test on any platform, then needs macOS's Metal device and fails
  `INCONCLUSIVE:` off it, never passing; a `deep-gpu` answer `unsupported_platform` does the same. The refusals
  (`ac6-refusals.test.ts`) run anywhere.
- **Timing.** Only AC8 reads a time; it is INCONCLUSIVE wherever the perf lane can't judge one (Readings).
- **Isolation.** Temporary files go under the OS temp folder and are deleted; AC7 keeps the merge base's tree and build
  under the target folder. `BASE-FAILURE.txt` holds the run at the base.

## The surface under test

**No new binary and no new call.** The criteria are entered through the document fields the issue lists and the
surfaces the base already has for lit groups, as #2031's suite drives them.

### Documents

Built with #2031's helpers: `{format: 1, id, profile: "figure", title, description, size, budget: {class: "figure"},
layers: {main}, items}`, items `{id, kind, layer, name, order, params, parent?, at?}`, with #391's `transport` and
`channels`. Every call takes the shipped look `clean`; its role `ground` is #ffffff, the white of every floor, white
outline and white light here, and `accent` and `focus` are colored roles.

| Field | As the tests write it |
|---|---|
| an occluding closed path | a `path@1` child of a lit `group@1` with `params.d: "M x y L x y … Z"`, a `paint` and `params.occlude: true` |
| `occlude` off | `params.occlude: false`, or the field left out |
| an open path | the same `d` with no `Z`, its last point apart from its first |
| a point light | `{at: [x, y], color: role, energy, range}` in `params.light.lights`, with no `kind`, as #2031 writes it |
| a sun | `{kind: "sun", angle: 30, color: role, energy}` in `params.light.lights`, with no `at` and no `range` |
| a moving light | f32 channels, linear keys, targeting `items/<group>/params/light/lights/<k>/at/0` and `…/at/1` |
| a moving occluder | f32 channels, linear keys, targeting `items/<path>/at/pos/0` and `…/at/pos/1` (the path grammar's "an item's other fields") |

### `deep-gpu run`: `window2d` (macOS): the frames of AC1 to AC5

`{"call": "window2d", "doc", "look": "clean"}` → `{"window": sha256, "layers": [{"layer", "path"}]}` as at the base: the
document as the app's window shows it, its PNG named by its SHA-256 in `out`, read back at 1 px a unit. A lit group's
layer draws its lights and its shadows here. `--planted <name>` takes this suite's names (Planted programs).

### `deep-gpu run`: `film2d` (macOS): AC6's frames and AC8's times

`{"call": "film2d", "doc", "look": "clean", "fps", "from", "frames", "hash": true}` → `{"frames": [{"frame", "gpu_ms",
"pixel_hash", …}], …}` as at the base: each row's `frame` its absolute index, the lit group drawn with its lights,
its occluders and their shadows at that frame's time.

### `deep-canvas-render check` (every platform): the refusals

`{"doc", "look": "clean", "planted"?}` → `{"ok", "issues": [{"code", "severity", "ids", "path", …}], …}` as at the base.
Each refusal is an issue of severity `error`, so `ok` is false:

- **An open path with `occlude: true`**: an error that names the path: its `ids` hold the path's ID, or its `path` is
  `items/<path>` or under it (such as `items/<path>/params/occlude`).
- **More than 4,096 occluder segments in one group**: an error that reads the count and the cap: the text
  `segments: 4097, cap: 4096` in one of its strings, or `"segments": 4097` and `"cap": 4096` as fields of one object
  inside it, such as `"actual": {"segments": 4097, "cap": 4096}`.

Codes are the implementer's and aren't asserted.

### AC7's surfaces: `deep-canvas-render raster` and `deep-gpu run` `layers`, `window2d`

As at the base and as #2031's AC7 drives them (its `framesOf`): `raster` (Vello CPU), `window2d` and `layers {…, by:
["gpui", "gpu_layer", "vello_cpu"]}`, compared by the SHA-256 of each PNG, each refusal by its code and path, and each
layer's draw path.

### Planted programs

| Where | Name | The wrong program | Criterion |
|---|---|---|---|
| `deep-gpu run --planted` | `shadow_bounding_boxes` | The shadow test reads each occluding path's axis-aligned bounding box in place of its outline: a pixel is in a light's shadow when the segment from it to the light crosses a box's side, and a pixel inside a box is not shadowed by that box | AC1 |
| `deep-gpu run --planted` | `sun_far_point_light` | A sun is drawn as a point light with no range and no falloff, 2,000 u from the centre of the group's bounds against the sun's angle: a pixel is in its shadow when the segment from the pixel to that point crosses an occluding outline, and where it isn't the light is the sun's, energy × color | AC2 |
| `deep-gpu run --planted` | `shadow_inside_outline` | A pixel inside an occluding outline is shadowed by that outline as any other pixel is, so a wall's face takes none of a light outside it | AC3 |
| `deep-gpu run --planted` | `shadow_removes_ambient` | A pixel in a light's shadow loses `ambient` as well as that light, and keeps only the other lights | AC4 |
| `deep-gpu run --planted` | `shadow_edge_aliased` | A shadow's edge has no antialiasing: each pixel takes all of a light or none of it, by the segment test at its centre | AC5 |
| `deep-canvas-render check`, `"planted"` | `occlude_accepts_open_path` | The check lets an open path with `occlude: true` through | AC6 |
| `deep-canvas-render check`, `"planted"` | `occlude_accepts_past_cap` | The check lets more than 4,096 occluder segments in one group through | AC6 |

Each is reachable only there and only for this proof; any other value stays `bad_input`. The names are snake_case, as
the base's planted names are.

## Criteria to tests

IDs are `#2032.` and the first 8 hex digits of SHA-256 of each criterion's text, as its `- [ ] ` line reads after that
prefix. Each test's name starts with `AC[n] #2032.<id>`, and the file that carries a criterion quotes it in full.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `AC1 #2032.9291cae9` | 1: one point light and 8 occluding polygons of 200 segments; 256 seeded points against the CPU f64 segment test; the planted bounding-box test | `ac1-points.test.ts` (2): the window of the fixture; each of 256 seeded pixels more than 2 px from any shadow edge reads `shadowed` (137 within 1 code) or `lit` (the light's closed form within 1 code) as the f64 test says of its centre. Twin: under `shadow_bounding_boxes` point 4, pixel (376, 114), reads as a test against the boxes says, and the check's first failure names `point 4 at pixel (376, 114)`. |
| `AC2 #2032.49695bb6` | 2: a sun at 30° and two 100 u squares 600 u apart; 64 seeded points; two named where a far point light gives the other answer; the planted far point light | `ac2-sun.test.ts` (2): the two points where the far light differs are the two the fixture names, point 22 at pixel (640, 485) and point 32 at pixel (897, 280); each of the 64 pixels reads 137 or 188 within 1 code as the f64 test says under the sun. Twin: under `sun_far_point_light` point 22 reads the other answer, and the check's first failure names `point 22 at pixel (640, 485)`. |
| `AC3 #2032.e4dd3ca1` | 3: a wall's centre within 1 code of the frame with `occlude` off; a pixel behind it at ambient alone; the planted shadowed inside | `ac3-wall.test.ts` (2): pixel (128, 80) at the centre of `wall` is within 1 code on R, G and B of the same document with `occlude: false`, and pixel (200, 80) behind it reads 137 within 1 code. Twin: under `shadow_inside_outline` the centre reads within 1 code of the document with no lights, and the check fails naming `wall`. |
| `AC4 #2032.8db573d6` | 4: a shadowed white pixel reads 137, and 188 with a second light that isn't blocked; the planted shadow that removes ambient | `ac4-ambient.test.ts` (2): the test's form gives 137 and 188 at pixel (128, 64); with the blocked light alone it reads 137, with the open light too 188, within 1 code. Twin: under `shadow_removes_ambient` the pixel reads 0 within 1 code with the blocked light alone, and the check fails. |
| `AC5 #2032.f2f22b4c` | 5: on a row across a 45° shadow edge, a pixel strictly between, none farther than 2 px from the CPU edge; the planted edge with no antialiasing | `ac5-edge.test.ts` (2): on row 200, at least one pixel has R, G and B each more than 1 code inside the span from 137 to the lit value there, and no pixel whose centre is more than 2 px from the line y = x has any channel inside it. Twin: under `shadow_edge_aliased` the check fails with `no pixel reads strictly between`. |
| `AC6 #2032.94551e97` | 6, first sentence: 4 moving lights and 200 moving occluder segments over 6 s: seeking equals playing at 1, 3 and 5 s | `ac6-seek-play.test.ts` (1): `film2d`'s played frames 30, 90 and 150 each hash apart from the same frame with `occlude` off, hash apart from one another, and each sought frame hashes as played; a failure names the frame. |
| `AC6 #2032.94551e97` | 6, the rest: an open occluding path refused; 4,097 segments refused with `segments: 4097, cap: 4096`; the planted checks | `ac6-refusals.test.ts` (3): a closed occluding path and a group of 4,096 occluder segments (beside a path that doesn't occlude) pass with no error; the open path is refused by an error naming `fence`; 4,097 segments are refused by an error that reads the count and the cap. Twins: `check` takes `occlude_accepts_open_path` and the open path's judgement fails on its answer; `check` takes `occlude_accepts_past_cap` and the group's judgement fails on its answer. |
| `AC7 #2032.24e13df9` | 7: a lit group with no occluding path and no sun draws byte-identical to the merge base | `ac7-plain-lit.test.ts` (1): a lit group with three point lights, a closed path and an open one, none naming `occlude` or `kind`, drawn at 0 and 1 s by the merge base's binaries and the checkout's with the same inputs: every `raster`, `window2d` and `layers` picture the same SHA-256, every refusal the same, every layer's draw path the same. A merge base that can't be built or draws no picture is INCONCLUSIVE. |
| `AC8 #2032.1a4ae9f6` | 8: 16 lights and 4,096 occluder segments at 1920 × 1080 under 2 ms of GPU time a frame | `ac8-budget.test.ts` (1): one run, its reading printed: the shadowed side's first frame hashes apart from the same document with `occlude` off. Then, on a reference Mac at rest only, five runs judged against 2 ms by the perf lane's `judgeLimit`: FAIL fails, anything but PASS is INCONCLUSIVE. |

Proof line: "the planted bounding-box test, far point light and shadowed inside shown failing first" are AC1's, AC2's and
AC3's twins; "then the seeded points against the CPU test, the refusals and the seek-equals-play hashes" are AC1's and
AC2's first tests, AC6's refusals and AC6's frame test.

## Readings where the issue and design leave a choice

- **"A frame" and "reads"** are the app's window, `window2d`, read back at 1 px a unit, as #2031's suite reads them.
  "Reads code c within 1 code" is each of R, G and B within 1 of c. White is the role `ground` of the look `clean`,
  #ffffff, which decodes to exactly 1 in linear light.
- **The CPU f64 segment test** (helpers `blocked`) is the design's sentence, in f64: "a pixel is in a light's shadow
  when the straight segment from the pixel to the light's `at` crosses an occluding outline", and "a pixel inside an
  occluding outline is not shadowed by that outline". A point is a pixel, and the test is taken at its centre
  (x + 0.5, y + 0.5). Two segments cross when each one's ends lie on opposite sides of the other's line; a point is
  inside an outline by the crossings of a ray from it, which fill rules agree on for outlines that don't cross
  themselves, as every outline here.
- **"Lit" and "shadowed"** (AC1, AC2). On a white floor a shadowed pixel "takes none of that light and keeps
  `ambient`": white × 0.25, code 137, the issue's number. A lit pixel shows #2031's closed form for the light at that
  pixel (helpers `white`), or ambient plus a sun's energy. A point reads `lit` or `shadowed` when it is within 1 code
  of that code, and "exactly as the test says" is that word at every point; a pixel within 1 code of neither fails.
  Each fixture keeps the two codes more than 16 apart.
- **"At least 2 px from any shadow edge"** (helpers `clearance`): the pixel's centre is more than 2 px from every
  outline segment and from every ray a corner's shadow can run on (from the corner, away from a point light or along
  a sun's angle), leaving out corners where the outline crosses that ray's line, since both sides of such a ray are
  behind the outline. Shadow edges are among these, so every kept point is more than 2 px from every shadow edge;
  some points that far from the true edges are passed over too. AC1's points also keep that distance from the
  bounding boxes' edges and AC2's from the far point light's, so each planted program has one answer at every point.
  AC2 keeps the same clearance, though its criterion doesn't state one, since AC5 lets a pixel within 2 px of an edge
  read in between.
- **"8 occluding polygons of 200 segments in total"**: eight closed outlines of 25 corners each. A closed outline of n
  corners is n segments: its `Z` joins the last corner to the first, and no two corners in a row are equal. The
  polygons and the floor are white, so every point is a white pixel; a point inside a polygon is judged as the design
  says, not shadowed by that polygon. The base refuses a path with no paint, so every occluding path here has one.
- **"The first wrong point"** (AC1) is the first point, in the seeded order, where the frame doesn't read as the f64
  test says; the check lists its failures in that order. For the planted bounding-box test it is the first point
  where the f64 test against the boxes gives the other answer, which the test finds from the fixture: point 4.
- **A sun's angle** (AC2). "Its shadows run along that angle": the shadows of a sun at 30° run in the direction 30°.
  The design gives 2D positions with "y points down and the origin is the top left" (Units and axes), and where it
  states which way a direction's angle turns it says "0 to the right and clockwise, as screen y points down" (an
  overlay's `edge_angle`), "0 turns right and 90 down" (a pan) and "angle 0 moves from the left edge to the right, 90
  from the top down" (wipe and push). So 30° is the direction (cos 30°, sin 30°) in the document's axes, right and
  down, and the sun's light arrives from the upper left. The design doesn't say this of a sun in so many words; see
  "Left open by the issue and the design".
- **"To the group's bounds"**: each fixture's floor covers its whole document, so the group's bounds are the
  document's, every occluder is inside them, and a shadow that runs to them covers every pixel behind an occluder.
  The f64 test's segment runs against the angle to past those bounds.
- **"Two 100 u square occluders 600 u apart"**: axis-aligned squares of side 100 u whose centres are 600 u apart, along x.
- **"A point light 2,000 u away along that angle"**: 2,000 u from the centre of the group's bounds, on the line of
  that angle, on the side the sunlight comes from, so that it lights the squares from almost the sun's direction:
  (500 − 2000 cos 30°, 350 − 2000 sin 30°). Like the sun it replaces it has no range and no falloff.
- **"64 seeded points …, two of them named in the fixture"**: one seeded stream; the first 62 points where the sun and
  the far light give the same answer and the first 2 where they don't are kept, in the stream's order. The fixture
  names those two with what the sun gives each, the test checks that the stream gives exactly them, and one is lit by
  the sun and the other shadowed by it. Every point before the first of the two reads the same under the planted
  sun, so its first failure is that point.
- **AC3.** "A pixel at the centre of an occluding wall" is pixel (128, 80) of a wall over [120, 30, 16, 100]. The wall
  is filled in a colored role, so the centre shows the wall's face and not the floor. "The same frame with `occlude`
  off" is the same document with `occlude: false`. "The ambient level alone" behind the wall is white × 0.25, code
  137. For the planted pass, "reads ambient at the centre" is within 1 code of that pixel in the same document with
  `lights: []`, where ambient is all there is. "Naming the path" is a failure that starts with the path's ID, `wall`.
- **AC4.** "A second light that is not blocked and gives 0.25 there" is #2031's AC2 light: 60 u from the pixel's
  centre, range 100, energy 625/1024. "Reads 0" is within 1 code of 0 with the blocked light alone.
- **AC5.** The straight edge is the shadow edge from a wall's corner that lies on the 45° line from a point light, so
  the criterion doesn't lean on a sun's angle. "The shadowed and the lit value" are 137 and the light's closed form
  at that pixel. A pixel "reads strictly between" when each of R, G and B is more than 1 code above the first and
  more than 1 code below the second, so a reading within 1 code of either isn't between; for "none farther than 2 px
  does", any one channel between counts. "Farther than 2 px from the CPU edge" is the distance from the pixel's
  centre to the edge's line. The edge passes through the centre of pixel (200, 200), where a 1 px antialiased edge
  is half covered.
- **AC6, frames.** "By playing" is one process from frame 0 in order at 30 fps; "by seeking" is a fresh process opened
  at the frame with nothing drawn before it (`film2d`'s `from`), as #2031's suite reads them. "Moving occluder
  segments" are eight outlines of 25 corners, each moved by its item's position. A seek equals a play at the base
  already, where no shadow is drawn, so the test also holds each played frame apart from the same frame with
  `occlude` off, which is what fails there.
- **AC6, refusals.** An open path is one whose `d` has no `Z` and whose last point isn't its first. "A group of 4,097
  segments" is 41 occluding outlines in one group, straight segments only, so no flattening tolerance enters the
  count; a closed path beside them that doesn't occlude isn't counted, as the scope's "occluder segments" says.
  "Refused with `segments: 4097, cap: 4096`" accepts that text or the two numbers as fields of one object in the
  issue. "A planted check that accepts either" is read as two planted checks, one for each refusal, each of which
  must fail: one that accepted both would show only that one of the two judgements has teeth. The documents that
  must be refused differ from the accepted ones only in what is refused.
- **AC7.** "A lit group with no occluding path and no sun" is one new fixture: its paths don't name `occlude` and its
  lights don't name `kind`, so the merge base reads the same document. "A frame" is every picture the surfaces draw of
  it, as #2031's AC7 reads it, at 0 and 1 s with a light that moves between them. A merge base that can't be
  exported or built, or that draws no picture, can't be judged and is INCONCLUSIVE.
- **AC8.** "16 lights and 4,096 occluder segments cost" is the shadowed side's median `gpu_ms` over 120 frames at
  60 fps less the plain side's (the same document with the group's `light` and every path's `occlude` removed), in one
  process, read as 0 when negative, as #2031's AC8 reads its lights' cost. The occluders are 64 outlines of 64 corners,
  filled, on both sides, so the difference holds what lighting and shadowing them costs and not what drawing them
  does. The timing counts only where scripts/benchmark.mjs's `judgeLimit` passes the machine and the load is within
  the cores; the debug build is timed, as #2031's is, since it is GPU time.

## Left open by the issue and the design

Each is read above; none is decided by the text alone, and a dispute goes to a blind redraft.

- **Which way a sun's angle points.** "Its shadows run along that angle" fixes the line, and the readings above take
  the shadows to run in the angle's direction, turning clockwise on screen. The design's lights elsewhere name where
  the light is, not where shadows go (a shade is "offset away from the light"), and #467's bevel reads "lit from 135°"
  counter-clockwise on screen. AC2's expected values follow the reading above; AC1 and AC3 to AC8 don't use a sun.
- **Where the far point light's 2,000 u is measured from.** The issue says "2,000 u away along that angle" and not
  from where. The centre of the group's bounds is taken, since those bounds are what the design ties a sun to.
- **What runs on Spark.** "Spark for the CPU segment tests" is read as this suite's own f64 test and fixtures, which
  every frame test checks before it needs Metal. The base also lights groups on Vello CPU (`raster`), on every
  platform; no criterion says a shadow is drawn there, so no test reads it.
- **"A path that turns it on needs no other field".** The base refuses a path with no paint. The tests give every
  occluding path a paint and don't ask whether an occluding path without one is accepted.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- `occlude`'s default of false as a check on its own (AC7 holds that a closed path that doesn't name it draws as at
  the merge base), and `occlude: true` on a path outside a lit group.
- "Counted after curves flatten": a curved occluder's segment count, and its shadow.
- A sun's defaults, a sun that names `at` or `range`, a sun driven by t, several suns, and a sun beside point lights.
- A point light's `kind: "point"` written out.
- Shadows on Vello CPU (`raster`), and a status mark or an `unlit` item under a shadow.
- A light inside an occluding outline, outlines that overlap, and an outline with a hole or more than one sub-path.
- The antialiased edge's width beyond AC5's 2 px bound, and the hash of a shadowed frame across machines.
