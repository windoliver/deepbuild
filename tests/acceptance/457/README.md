# Acceptance tests for #457: the loop: camera.framing's occluded share and camera paths, with the loop's budgets

Written first, blind, by a job that never saw an implementation; none existed. The writer had issue #457 (its scope,
its Fields, its ten acceptance criteria, its proof line "A hidden tower caught and fixed by its patch, a walkthrough's
clearance failure at its deepest point, and the loop's timings", its Oracle line), its Oracle page, its epic #310, its
parent #133 and its dependencies #456, #424 and #468 (titles and bodies, so nothing here tests their parts), the design
sections the issue links and those they lean on, and the base: this worktree's HEAD `1ab891283` ("Merge pull request
#2597 …"). No other branch, PR, worktree or stash was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The suite is lean: one file per criterion, a criterion with several parts holding one `it` per part, and the planted
wrong programs the issue names plus two this job judged needed.

## What was read

- Issue #457, live (`gh issue view 457 --repo windoliver/deepbuild`), and its Oracle page
  (`doneright/oracles/issues/457.md` on DeepBuildAI/deepbuild, branch `doneright`): no upstream test checks any of the
  ten criteria, so nothing is ported.
- #310 (the epic), #133 (the parent: the loop's checks and its parts), #456 (render.review's ID view), #424 (cutaways,
  additive surfaces), #468 (the lens, dof, `verticals_max`).
- `docs/canvas-primitives.md`: Check input (the generic `except`, `render.widths`, `sweeps` fields); Check input: loop
  kinds; …: occluded share; …: camera paths; …: ID view and observations; Control sweep; Render-back; Camera `camera@1`,
  its lens and framing sections; Shot (`keyed`); Channel and key and its auto tangents; Driver (`time`, controls,
  `fallback`); Cutaway `cutaway@1`; Effect: dof (through #468); The closed function list (the interval forms).
- `docs/technical-design.md`: Render-back, Document check ("the loop's checks: … framing with each kept item's occluded
  share (seen through cutaways as drawn) and the camera's path (clearance, smooth moves, zooms past a recording's
  pixels, focus on kept items)"), Dogfooding and "Tests written first".
- At the base, for surfaces and what already exists only: `AGENTS.md`; `crates/deep-canvas-loop/src/{framing,scene,lib}.rs`;
  `crates/deep-show/src/{main,verdict}.rs` (the scenario, `planted`, `environment`, a claim's `brief`, a row's
  `results`, `timing.check_ms`); `crates/deep-canvas-scene3d/src/{cut,spec,scene}.rs` (`cutaway@1`, `material@1`'s
  `transmission` and `alpha_mode`, `tube@1`); `crates/deep-canvas-motion/src/{shots,doc}.rs` (keyed shots, `auto`
  keys, driver vars); `scripts/{proof-change,benchmark,lanes}.mjs`; and the suites `tests/acceptance/1938/`, `1941/`,
  `456/`, `468/`, `405/`, `405-redraft-ac4/`, `424/`, `506/`, `409/`, `169/` and `1903/` for conventions and fixture
  shapes. #1938's helpers (its build-free readers, `run`, scenario, patch-op checks, PNG encoder) and #456's (its review
  room, stub model and PNG decoder) are imported as they are, as #468's suite imports #1938's.

Every expected value comes from the issue and the design; code was read only to learn surfaces.

## What the base already does

- `camera.framing` (#1938, #468, #506) is the loop module's check: it projects the kept items through the evaluated
  camera at each checked time and fails a cut, a fill outside [0.2, 0.9], a tilted horizon, and with `verticals_max`
  a leaning edge, each fix one patch op on the camera. Its row carries `results`, one per checked time:
  `{t, keep, cut, fill, range, horizon, under, verticals}`. A film's main shot is checked at 30 Hz from each shot's
  start to its end, with nothing bounded between samples (#506).
- No occluded share, no `except`, no camera path measure (clearance, corners, raster_max, focus_coc_max), and no sweep
  from a claim's brief exist. Unknown check-input fields are ignored, not refused. A claim's `brief` is parsed (any
  object) and only render.review reads it.
- The geometry audit's control sweep (#405) bounds a slider between samples and names `sweep: {control, value}` on its
  failures; requirement rows of the audit and of film.layout carry `timing.check_ms`.
- `render_back`, alpha's `deep_show` patch, `read` and `verdict` with `key.revisions` behave as #1941's suite reads them;
  #138's scenario `environment: {os, driver}` is a run's machine.
- None of this suite's planted names exists, so a scenario naming one is refused (`ok: false`).

So every test fails at the base (BASE-FAILURE.txt). Nothing here credits what the base does.

## What the implementer meets

- **A lens camera in a shot.** The base poses a shot's camera by writing `position`, `target`, `roll` and `fov` into
  its params (#506's `shots::posed`), so a camera with a `lens` in a shot is refused (`out_of_range` at
  `items/cam/params/fov`: lens and fov together). AC5's focus shot needs a lens in a keyed shot; without its shot the
  same document passes framing at the base.
- **2D films.** The base's camera.framing evaluates through scene3d, so a 2D film is BLOCKED (`out_of_range` at
  `items/cam/params` with its shot, `not_drawn` without). AC5's raster pair is a 2D film (README: Readings); its
  documents pass `document.validate`.
- **Auto keys** are taken on f32 channels only, so the glides and the 60 s film key the camera's x and z as one f32
  channel each.

## Run them

Every file builds `deep-show` with cargo and most draw nothing; AC1's second test, AC9 and AC10 draw on Metal. The
implementer adds these lines to `scripts/lanes.mjs` (this README is the instruction; this job edits nothing outside its
folder):

```js
// #457's files each build deep-show; ac1, ac9 and ac10 draw on the Metal GPU. ac9-budgets judges the loop's budgets on
// the reference Mac, and ac10-shots writes docs/evidence/457/ and waits on your taste call in tests/acceptance/457/TASTE.json.
alone.push('tests/acceptance/457/');
timed.push('tests/acceptance/457/ac9-budgets.test.ts');
```

```sh
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
npm ci --ignore-scripts          # once, if node_modules is missing
export NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/457 --no-file-parallelism --testTimeout=600000 <file>
node node_modules/typescript/bin/tsc -p tests/acceptance/457/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/457/node_modules/.vite
```

Each file runs `cargo build --locked --bin deep-show --no-default-features --features full` before its tests (AC9 also
`--release`, only once judgeLimit says this machine can judge a timing), copies the binary out of `target/` (honoring
`CARGO_TARGET_DIR`), and fails each test if the build failed; without cargo, INCONCLUSIVE. Tests write into temporary
folders they delete, except AC10, which writes `docs/evidence/457/`. Off macOS, or where a drawing row is BLOCKED
`gpu_unavailable`, `unsupported_platform` or `software_adapter`, a test that draws fails with a message starting
`INCONCLUSIVE:`; none passes or skips. Tests print the issue's proof as lines starting `PROOF #457`.

## Surfaces this suite assumes

**No new binary and no new call.** Everything runs through `deep-show run` (one scenario line in, one answer line out)
with #96's stored documents (alpha's writer layer `alpha-main`, opened as revision 0), #403's claims and `verdict`,
#393's `deep_show` patch and `render_back`, #387's `planted` and #138's `environment`. Each check is a claim's
requirement judged by `verdict`, as #1938's suite reads the loop's kinds. Every name below that the issue and design
don't give is this job's; an implementation builds exactly these, or disputes them.

### Check inputs

`camera.framing` with `keep` naming the kept items, every #457 field at the issue's default unless a criterion sets it:
`occluded_max 0.4`, `occluded_samples 64`, `path_rate 30`, `clearance auto`, `corners refuse`, `raster_max 1.5`,
`focus_coc_max 1.5`, `sweeps from_brief`. Set here: `except: [pillar]` (AC2, Check input's generic `except`),
`clearance: 0.15` (AC7, AC8), and `render: {widths: [1920]}` (AC5's raster pair): **the export width the raster
measure divides by is the check input's `render.widths`** (Check input's generic `render`), since a check sees no export.

### The brief's control sweeps

**A claim's `brief: {sweeps: {control → samples}}`** (Control sweep's `sweeps` shape) is the brief's sweeps that
`sweeps: from_brief` reads: `{sweeps: {s: 5}}` (AC8) and `{sweeps: {explode: 2}}` (AC5; a toggle's every value is
audited). A claim with no brief sweeps nothing.

### The row's results

The camera.framing row's `results` stay one entry per checked time (`t` in flicks, 705,600,000 a second) and gain:

- **`occluded: [{item, share, occluders, points}]`**: one per kept item. `share` is hidden in-frame points ÷ in-frame
  points; `occluders` the IDs of the items that hide them (none listed when nothing does); **`points`** the item's
  `occluded_samples` sample points at that time, `[x, y, z]` in world metres (f64), in the pattern's own order (AC3
  reads them: on the item's true shape, unmoved by adding an item elsewhere).
- **`paths: [{shot, t, measure, item, value}]`**: the camera path readings. `measure` is the check-input field it
  measures (`clearance`, `corners`, `raster_max`, `focus_coc_max`; `raster` and `focus` are read as aliases); `t` in
  flicks; `value` in the measure's unit: clearance the least distance in m, raster_max export px per source px,
  focus_coc_max the circle of confusion in px, corners the velocity jump. They list, at least, for each shot and each
  measure that applies, the worst reading (the least clearance, the largest magnification or circle of confusion)
  whether it passes or fails: AC5 reads the 2× zoom's passing magnification and AC9 the film's clearance readings.

### Failures

Each failure is an error (or warning) by `check: camera.framing` with the item it is about in `ids` and a `code` (any;
the base's is `loop.framing`). The fields below are read **on the issue itself, else in its `actual`** (as #405's
suite reads `sweep`):

- an occlusion failure carries `share` and `occluders` (and, as the design says, a fix as patch ops: `fix_ops`, or
  `fix` as a list or `{ops}`, read by #1938's `fixOps`);
- a path failure carries `measure`, `shot`, `t` (flicks) and `value`, as its `paths` entry has them; corners names the
  key it fails at by its ID somewhere in the issue (a string equal to it or a path ending in `/<id>`);
- a failure found under a control sweep carries **`sweep: {control, value}`** (#405's shape), the value the control's
  (a toggle's `true` or `1`).

### Timings (AC9)

On the requirement's row, `timing` in ms unless said, each a finite number ≥ 0:

| Row | Field | What it times |
|---|---|---|
| scene.scale, camera.framing, geometry.shading | `check_ms` | the check's own time on the requirement (as #405 and #408 define it) |
| geometry.audit | `check_ms` | as the base has it |
| camera.framing | `occluded_ms` | the occluded share over every kept item and checked time |
| camera.framing | `paths_ms` | the camera path measures, bounds and splits included, over every shot and sweep |
| render.exposure | `gpu_ms`, `readback_bytes`, `times` | the GPU time its own work (reduction and readback) added, the bytes it read back, both over its `times` checked times |
| render.review | `id_view_ms` | what drawing its ID view (flat pass and numbers) added to the render-back of its snapshot |

### Planted programs (the scenario's `planted`, reachable only there)

The implementer adds each beside the loop module's `PLANTED` (or deep-show's) and names it in
`crates/deep-show/src/main.rs`'s planted match:

| Name | The wrong program | Criterion |
|---|---|---|
| `occluders_count_add` | an item in `alpha_mode: add` counts as an occluder (named by the issue) | `#457.a2efe6ef` |
| `occluded_samples_by_order` | each kept item's sample pattern is seeded by its place in the document's item order, not by its ID | `#457.20f148ec` |
| `cutaway_hides_whole_items` | an item a cutaway in effect reaches never occludes, whichever side of its planes it lies on | `#457.352f4bf3` |
| `clearance_half_diagonal` | `clearance: auto` is the near plane's half-diagonal alone (named by the issue) | `#457.ca859a60` |
| `paths_sampled_at_30hz` | path measures are read at path_rate's samples alone, nothing bounded between them (named by the issue) | `#457.b79d8a1e` |
| `framing_sweeps_samples_only` | camera.framing runs at the brief's sweep samples alone, nothing bounded between them (named by the issue) | `#457.0a6c6b77` |

No Cargo feature is needed: every test builds `full`.

## Fixtures (helpers.ts)

Metres, +Y up; 2D in u, y down. 3D fixtures are `scene` documents of 320 × 240 px (AC5's focus shot 1920 × 1080)
viewed through `cam`, a perspective `camera@1` (40° across the wider side, near 0.1 m) unless said. Every solid has an
unlit `material@1` (the pane a lit one with transmission), so nothing a check reads depends on light; no visible text
shows a number. Films with shots use one keyed shot (`keyed: true`), whose pose the camera's own channels and drivers
write. A scratch script (not kept) checked the numbers marked ✓ by sampling 200,000 area-even points and projecting
every kept item: no twin is cut or outside fill [0.2, 0.9].

| Criterion | Fixture |
|---|---|
| AC1, AC3, AC10 | `castle`: the kept tower (1 × 5 × 1 m box) 20 m in front of a camera at 3.05 m looking level; a 2 × 3.05 × 1 m market stall 10 m out whose top is at the eye's height, so it hides exactly the tower below 3.05 m, (4 × 3.05 + 1) ÷ (4 × 5 + 2) = 0.6 by area (✓ 0.5999); a curtain wall behind, the ground 1 cm below. Twin: the stall 4 m aside (✓ 0). AC3 adds a well 8 m to the side, ordered before the tower |
| AC2 | `gallery`: the kept statue (1 × 2 × 0.4 m) 8 m out; a pane (transmission 0.9) over all of it, a banner (blend) over its upper part, a beam (add) over 75% of its points by area (✓ 0.749), a pillar (opaque, excepted) over 19% (✓ 0.193), apart from the beam |
| AC4, AC10 | `engine`: six 0.1 m walls of a 2 m casing round the kept piston (0.5 m cylinder) and crank (0.4 m box), both behind z = 0; a 0.26 m valve 0.15 m behind the plane hides the crank's 17% (✓ 0.171); with the cutaway `section` (`cutaway@1`, plane normal +z, offset 0, view class) z > 0 is removed; the camera 5 m out on +z |
| AC5 walk | `walkthrough(x)`: a door frame, a `tube@1` of radius 0.05 m up x = −0.5, across at 2.1 m, down x = 0.5; the camera at 1.6 m walks z 3.05 → −1.95 over 2 s along x = −0.4 (0.05 m from the post at t = 1.22 s, inside auto ≈ 0.11 m) or x = 0 (0.45 m) |
| AC5 corners | `glide(interp)`: the camera's x and z keyed (one f32 channel each) at `start` (0, 4), `turn` (0, 0), `end` 4 m on at 40°, 1 s apart, at 1.6 m: linear (a 2.74 m/s jump, 68% of 4 m/s) or `auto` |
| AC5 raster | `screenFilm(zoom)`: a 2D film 1440 × 900 u, a 1440 × 900 px PNG (2 px per u) over the middle 720 × 450 u, the kept button over it, the 1 s shot viewing 480 u (3×) or 720 u (2×) |
| AC5 focus | `focusShot`: kept 0.8 m box 4 m out, 50 mm at f/1.4, sensor 36 × 24 mm fitted horizontally, 1920 × 1080, `effect@1` dof focused at 3 m: 8.07 px |
| AC5 explode | `explodeFigure`: body and lid, both kept; toggle `explode` binds the lid's x, 0 at rest, 4 m apart (✓ cut) |
| AC6 | `nearPlane(at)`: camera near 0.1 m, fov 2·atan(0.4) = 43.6° across 320 px (near plane 0.08 × 0.06 m); sphere `dot` of radius 1 mm centred on the axis 0.1 m or 0.12 m out; kept crate 4 m out |
| AC7 | `bobbing`: a ceiling slab underside at 1.6 m; driver `bob` sets the camera's height to 1.4 + 0.1·sin(30πt) through the 1 s shot `hall`; kept marker 6 m on |
| AC8 | `tableShot`: a table top at 0.75 m; slider `s` over [0, 1] sets, through driver `lower`, the camera's height above it to 0.3 − 0.25·exp(−((s − 0.6) ÷ 0.05)²) in the 1 s shot `overhead`; kept vase 4 m on |
| AC9 | `bigScene` (a plate and 999 boxes: 1,000 parts, ten kept, collection `hero`); `torusDoc` (a closed torus GLB of 250 × 200 quads = 100,000 triangles); `longFilm` (a 60 s keyed shot circling a kept fountain, its x and z keyed every 5 s, auto); #456's review room |

## Criteria to tests

IDs are `#457.` and the first 8 hex digits of SHA-256 of each criterion's text, `- [ ] ` dropped, trimmed and white
space collapsed (`criterionId` in `scripts/proof-change.mjs`); `spans` reads every test name below.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#457.a5a83f86` | `ac1-occluded-share.test.ts` (2) | The castle FAILs: an error names the tower, `stall` among its occluders, its share within 0.1 of 0.6, a fix as patch ops; the results read the same. The twin PASSes, the tower's share 0. The fix applied as alpha's patch is the next revision; render-back presents it; the verdict on it reads the tower's share under 0.4 and raises no occlusion failure |
| `#457.a2efe6ef` | `ac2-see-through.test.ts` (1) | The statue PASSes with nothing raised, its share 0 with no occluders; under `occluders_count_add` it FAILs naming the beam |
| `#457.20f148ec` | `ac3-stable-samples.test.ts` (1) | On macOS the tower's 64 points lie on its true shape and are the same numbers with a well added; on Linux the row is `machines: any` and the tower's share, occluders and points are macOS's; under `occluded_samples_by_order` the well moves them |
| `#457.352f4bf3` | `ac4-cutaway.test.ts` (1) | With the cutaway: PASS, nothing raised, no except; the piston's share 0; the crank's occluders hold the valve with a share above 0. Without: the piston's share above 0.9. Under `cutaway_hides_whole_items` the valve isn't named |
| `#457.d97d57d2` | `ac5-paths.test.ts` (5) | Walk: clearance error naming the frame, shot `walk`, t within 1/30 s of 1.22 s; centre walk PASSes. Corners: an error naming key `turn`; auto PASSes. Raster: an error naming the recording at 2.0 (± 0.05); the 2× zoom PASSes, its paths reading 1.33 (± 0.005). Focus: an error naming the subject at 8.1 px (8.05 to 8.15). Explode: an error naming the lid with `sweep: {control: explode, value: true}`; with no brief sweep, PASS |
| `#457.ca859a60` | `ac6-near-plane.test.ts` (1) | The sphere on the near plane FAILs clearance naming `dot`; 0.12 m out it PASSes; under `clearance_half_diagonal` the one on the near plane PASSes |
| `#457.b79d8a1e` | `ac7-between-samples.test.ts` (1) | FAIL; the earliest clearance error naming the ceiling and shot `hall` is at 1/60 s (± 1/300 s) at 0.1 m (± 0.005); under `paths_sampled_at_30hz` PASS |
| `#457.0a6c6b77` | `ac8-sweep.test.ts` (1) | FAIL; a clearance error names the table, shot `overhead` and `sweep: {control: s, value}` in [0.56, 0.64]; under `framing_sweeps_samples_only` PASS |
| `#457.5b7ca30a` | `ac9-budgets.test.ts` (1) | Debug run: every reading taken (Timings), the readback within 8 KiB a checked time; lanes.mjs times the file; then judgeLimit gate, release, warm-up, five runs: each budget judged by the lane; FAIL fails, else INCONCLUSIVE unless PASS |
| `#457.08351b79` | `ac10-shots.test.ts` (1) | Render-back's own snapshots of the castle before and after its fix and the engine with the cutaway on and off, written to `docs/evidence/457/`, each existing, decoding at its size and hashing to render-back's SHA-256; then TASTE.json as below |

## Readings where the issue and design leave a choice

- **AC1's "share 0.6" and its tolerance.** The fixture hides 0.6 of the tower's true shape by area, every point in
  frame. 64 points quantize a share at 1/64, and the pattern seeded by the tower's ID is the implementer's, so the share
  it reports differs from 0.6 by the pattern's unevenness. The test allows 0.1 (about six points of 64): the issue
  states 0.6 to one decimal, an area-even pattern lands well inside, and the band stays clear of 0.4. A pattern of
  independent random points lands inside about 90% of the time (σ ≈ 0.06), which the design's "pattern" doesn't call
  for.
- **AC1's "on the next render-back"** is #1941's reading: render-back presents the patched revision, and the verdict
  judges that same revision; nothing reads the picture.
- **AC4's valve.** The piston's share is 0 with the cutaway, so the valve the check "still counts as an occluder" must
  hide another kept item: the crank, both kept, the valve on the kept side of the plane before the crank. "Passes with
  no except entry" is the row's PASS with nothing raised, the crank's share (about 0.17) under 0.4. "With it off" is the
  same document without the cutaway item; a view-class cutaway in the document counts as pinned (the design).
- **AC5's walk "0.05 m inside a door frame"** is a path through the doorway 0.05 m from the frame's inner surface, its
  deepest point the nearest approach. The walk is a keyed shot whose camera's position a linear channel moves, since
  the base has no `follow(path)` move. "A time within 1/30 s" is the failure's `t` in flicks ÷ 705,600,000.
- **AC5's raster.** "A 1440 u wide screen" is a 2D film 1440 u wide; "a 1920-wide export" is the check input's
  `render.widths`; "a recording captured at 2 px per u" is an `image@1` PNG of 2 source px per u. A zoom is the shot's
  view width (1440 ÷ zoom u). "Passes at 1.33" is read from `paths`.
- **AC5's focus** is the circle of confusion's diameter at the kept item's centre on the optical axis, in px of the
  1920-wide frame, from the closed form #468 uses; 8.1 is read at one decimal.
- **AC5's corners "naming the key"** is the key's ID, `turn`, anywhere in the issue.
- **AC5's explode** "at that sweep sample": the brief sweeps the toggle; the failure names the lid (cut by the frame,
  #1938's framing failure) with the toggle's apart value. The same document without a brief sweep passes, so the
  failure comes from the sweep.
- **AC7's time and distance tolerances**: t within 1/300 s of 1/60 s is where the distance stays within 5 mm of its
  least, 0.1 m (± 0.005) its value at two decimals. "First" is the earliest clearance failure reported.
- **AC3's machines** are #138's scenario environments named macOS and Linux, as #1938's machines test proves a reading
  equal across machines; "from evaluated data" is the row's `machines: any`.
- **AC9.** "The cheap loop checks" are the evaluated-data kinds on the 1,000-part scene: scene.scale and camera.framing
  (its occluded share included); "a few kilobytes" is at most 8 KiB a checked time; each budget is the issue's absolute
  limit judged by the lane's judgeLimit on five release runs after a warm-up, in the lanes' `timed` list. "Off the UI
  thread": `deep-show run` is headless. "Compared with the merge base" is #405's redraft's reading: the preflight's
  edit guard runs this file on the merge base, where it fails; no budgets.json task.

## The taste call

`ac10-shots.test.ts` writes `docs/evidence/457/castle-before.png`, `castle-after.png`, `piston-cutaway-on.png` and
`piston-cutaway-off.png` and prints each SHA-256. After a run, show them to the owner, attach them to the PR, and record
the answer in `tests/acceptance/457/TASTE.json`, the one file anyone adds to this folder after it is written:

```json
{"issue": 457, "criterion": "#457.08351b79", "verdict": "looks_right" | "looks_wrong", "who": "...",
 "when": "<ISO 8601 time>", "screenshots": {"castle-before.png": "<sha256>", "castle-after.png": "<sha256>",
 "piston-cutaway-on.png": "<sha256>", "piston-cutaway-off.png": "<sha256>"}, "note": "..."}
```

No call, or one made on other pictures, is INCONCLUSIVE; `looks_wrong` fails. No other test reads the pictures.

## Not tested

No criterion states an observation for these, so none is tested; they are the implementer's own tests: the
occluded-share fix's exact orbit or elevation step (only its effect, AC1); points outside the frame and a kept item
with none in it (`cut`'s); a moving occluder's bound; clearance against a moving solid and solids counted as the scene
audit counts them; corners' 0.01 m/s and 0.5°/s rule for a shot that barely moves, and its exceptions (a hold key, a
slam, a shake, a cut); a span the bound can't settle, refused naming the shot and span; sweeps' estimates for a control
that moves through physics; the path fixes as patch ops (move the path, auto tangents, cap the zoom, move the focus);
"can never" rows (reading pixels, moving the camera, checking a viewer camera, skipping a key).
