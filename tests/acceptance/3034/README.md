# Acceptance tests for #3034: a camera under the water

The surface seen from below shows the sky inside 48.8° and mirrors the deep outside it, and everything seen through
water dims with the distance seen.

Written first, from issue #3034 (its opening paragraph, its `Runs on:` line, its Scope, its six acceptance criteria
and its proof line: "The disk's edge, the card at two distances, the mirrored ball, the refusal on the merge base's
document, the hashes, and each planted surface failing"; it has no comments and no Oracle line), the design sections it
links and those they lean on, and base commit `c7dc0edc3`, by a job that never saw an implementation; none existed, and
no other checkout, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, one test per
criterion, plus exactly the three planted twins the criteria name: 9 tests.

## State of this folder: run at the base, on no implementation

- **Run at the base** (`c7dc0edc3`, `deep-gpu` built there, on a reference Mac): each of the six files once. 9 tests,
  9 fail, each at its own assertion, none at load, none `BLOCKED:` or `INCONCLUSIVE:`. `BASE-FAILURE.txt` holds each
  failure and the probes behind the fixtures. The type-check passes.
- **Probed at the base**: every fixture draws what it is meant to (What the base already does, below). No test file
  and no helper changed for it: the pinhole lands where `view3d`'s own `project` does, to the last digit it prints.
- **`base-hashes.json` is taken** from the base's own run of `ac5-hashes.test.ts` (The merge base's hashes), and a
  second run of that file at the base drew the same 23 hashes.
- **Not run on any implementation**: none existed. What each test does on a tree with the first change alone and on
  one with both (The two changes) is what the tests are written to do, not something seen on such a tree.
- **The passing paths were exercised once** against a stand-in for `deep-gpu` that this job wrote from the issue's
  closed forms alone (a ray cast of the still fixtures; not in this folder, and no evidence about any program). It
  shows only that the suite's own readers, geometry and thresholds agree with the issue's numbers: the edge read
  48.75° to 48.81°, the card 0.36783 and 0.13530, the ball's centroid 0.1 px from the mirrored point, each planted
  twin failed its check naming what it must, the refusal named 1,416,712,500 flicks, and the taste call's three ways
  out (none or other pictures `INCONCLUSIVE:`, `looks_wrong` fails, `looks_right` passes) each ended as written.

## What was read

- Issue #3034 as copied for this job, and #166's suite for what the issue says of #166.
- `docs/canvas-primitives.md`: Units and axes; Render-back; Look `look@1`; Material; Material: mirror; Material: water;
  Sky `sky@1`; Camera `camera@1`; Camera `camera@1`: lens; Determinism class; Not proposed, and why.
- `docs/technical-design.md`: Scenes, physics and the canvas core; Document check; How runs become one of five
  verdicts; Proven on the base; The reference Macs; Criteria to tests; Closed issues stay proven; Criteria in a checked
  shape; Wrong programs; Dogfooding; Built to be hard to get wrong. `docs/parallel-proof.md`: A suite's own lane file.
  AGENTS.md and CONTRIBUTING.md.
- At the base, for call shapes only: `tests/acceptance/166/` (the model: README, helpers and every test file, whose
  documents base166.ts writes out again), `2760/` (a check's refusal read from `view3d`, two planted programs, the
  README's sections), `268/`, `968/`, `465/`, `468/` (channels on a camera's fields, `project`), `980/` (the taste
  call's form), `971/` (`twins.json`), `3023/` (`lane.json`); `crates/deep-gpu-layer/src/{main,view3d}.rs` and
  `view3d/parse.rs` (the call's fields and targets, refusals as `{code, reason}` or `{code: "refused", issues}`,
  `Planted` and its `parse`, `no_device`); `crates/deep-canvas-scene3d/src/water.rs` (`parse`, `find`, how a check's
  issue carries `actual`); `crates/deep-canvas/src/camera.rs` (`Projector`, `screen_basis`);
  `crates/deep-scene3d-render/src/{water.rs,water.wgsl}` (what the water pass draws into the linear target);
  `scripts/benchmark.mjs` (`fingerprint`, `references`); `scripts/proof-change.mjs` (`criterionId`);
  `scripts/proof-runs.mjs` and `scripts/proof.mjs` (how a tagged test is proven); `scripts/lanes.mjs` and
  `scripts/proof-guard.mjs` (`lane.json`).

## What the base already does, which these tests don't credit

`view3d` draws #166's water for an eye above it (waves, ripples, rain, foam, a wake, and since then a shore, a flow and
rings), with `from` (a cold seek), `capture`, the targets `final`, `linear`, `pre_tone`, `depth` and `reflection`, and
each frame's `pixel_hash`; it answers a document its check refuses with `{code: "refused", issues}`. A camera's fields
are keyed by channels (`items/<id>/params/position/1`).

What the base does with an eye below the surface, as its code reads (`water.rs`, `water.wgsl`: the water pass shades
every pixel whose ID is a water part, on both faces, and never asks which side the eye is on; `water::parse` reads no
`ior`; no check compares a camera's eye with a water part) and as it ran:

- **A camera below a water part draws, with no issue**, straight up included, and a camera keyed through the surface
  draws every frame of its span: 121 different pictures at 30 fps, each equal to itself seeked cold.
- **From below, the still surface under a white sky is black** at every pixel of the `linear` target: no disk, no
  cone. The same camera with no water reads the white sky as (1, 1, 1) everywhere.
- **Nothing dims a surface seen under water**: the white card reads 1.0000 and the black one 0.0000 at 3 m and at 6 m,
  in water as in air.
- **No ball shows at the mirrored point**: both of criterion 3's frames are black. (Through a wider lens the base
  does draw a red patch in the surface, 99 px above the mirrored point: it mirrors something, by no rule.)
- **`water.ior` is ignored**: the lake's frame 1.49 m under the surface is the same picture at `ior` 1.5 and without
  `ior`, at 320 × 180 and at 1280 × 720.
- **`--planted` with one of this suite's names** answers `{"ok": false, "code": "bad_input"}` and exits 2.
- The fixtures are what they say: `view3d`'s own `project` puts every point where helpers.ts's pinhole does (straight
  up keeps +X as screen right, and +Z is screen up); `mark.sphere@1` of size 0.6 draws a ball 0.6 m across (3,448
  red pixels where such a ball covers 3,549); the channel holds the card's centre at z = −3.01 and −6.01 and the
  camera's height at 2.0078125 m at 0 s, 0.0078125 m at 2 s and −1.4921875 m at 3.5 s.

So at the base every test fails at its own assertion: there is no bright disk, the card reads its value in air, no
ball is mirrored at the mirrored point, the three planted names don't start, and the camera keyed through the surface
is neither refused nor drawn by a rule that reads `ior` (criteria 4, 5 and 6 fail at that one guard). Criterion 5's
first part, #166's hashes, holds at the base, as it must.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
export PATH="/opt/homebrew/opt/rustup/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease nice -n 10 cargo build --locked --bin deep-gpu      # once, under the machine's lease
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3034 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3034/tsconfig.json   # type-check
```

Each file builds `deep-gpu` once (`cargo build --locked --bin deep-gpu`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless the environment sets them; a build made the same way beforehand is found fresh),
copies the binary out of the target folder (`CARGO_TARGET_DIR` honoured) and fails each test whose build failed. The
files draw on the GPU, so they run one at a time: `lane.json` puts the folder in the lanes' `alone` block. Each test
writes into its own temporary folder and deletes it; `ac6-taste.test.ts` also writes two pictures into
`docs/evidence/3034/`. Imports: Node built-ins and vitest only; the machine is read by `scripts/benchmark.mjs` in a
child process. A run with `--root tests/acceptance/3034` leaves Vitest's cache in
`tests/acceptance/3034/node_modules/.vite`; delete it. (It also fills Vitest's module cache in the checkout's own
`node_modules/.vitest-cache`, which git ignores.) At the base the six files took about five minutes in all on a
heavily loaded machine, `ac5-hashes.test.ts` over two of them.

Where the criteria can be judged (the issue's `Runs on:` line: "A Mac of a reference model: the criteria read one
machine's pixels. Without a GPU they read BLOCKED, never PASS"). Every test starts with `requireMachine`:

- Off macOS, or where `deep-gpu` answers `no_device`, `unsupported_platform` or `gpu_unavailable`: the test fails
  `BLOCKED:`.
- On a Mac that isn't one of the lane's reference models (`scripts/benchmark.mjs`: `references`, by model, chip and
  memory): the test fails `INCONCLUSIVE:`, since what another machine draws is a reading.
- Neither is a pass.

### The two changes

The Scope says the work "may land as two changes. First the refusal … Then the view, which lifts it". Criterion 4
speaks of the first change alone, the other criteria of the view, and these files aren't edited between the two. The
same command runs on every tree. What each test does:

| Test | The merge base | The first change alone (the refusal) | Both changes (the view) |
|---|---|---|---|
| AC1 the disk's edge | fails: no bright disk, so no edge 48.8° off the axis | fails: the camera under water is refused at check | passes |
| AC1 planted `water_below_ior_one` | fails: the name doesn't start | fails, likewise or at the refusal | passes |
| AC2 the card | fails: the card reads its value in air | fails: refused at check | passes |
| AC2 planted `water_below_tint_by_depth` | fails: the name doesn't start | fails | passes |
| AC3 the mirrored ball | fails: no ball at the mirrored point | fails: refused at check | passes |
| AC3 planted `water_below_sky_at_every_angle` | fails: the name doesn't start | fails | passes |
| AC4 the refusal | **fails**: drawn with no issue, and `ior` changes nothing | **passes, by the refusal**: it names `diver`, `lake` and the first time | **passes, by the view**: drawn, and its frames below read `ior` |
| AC5 the hashes | #166's hashes hold; then fails: the shot's frames below read no `ior` | #166's hashes hold; then fails: the shot is refused at check | passes |
| AC6 the taste call | fails: the frame from below reads no `ior`; no picture is written | fails: refused at check | `INCONCLUSIVE:` until `TASTE.json` holds the owner's call on this run's two pictures; then passes |

What a reader should see:

- **On a tree with the first change alone**: `Tests  8 failed | 1 passed (9)`. `ac4-refusal.test.ts` passes and logs
  `AC4 #3034.311508f3: refused at check (the first change alone): <code> names diver, lake and t = <flicks> flicks …`.
  Each of the eight failures but the planted names' quotes the check's refusal (`… was answered, not refused (refused
  at check: …)`), and `ac5-hashes.test.ts` logs `#166's 23 frames hash as on the merge base` before it fails. Those
  eight are the criteria that change leaves open: it is `Part of #3034`.
- **On a tree with both**: `Tests  1 failed | 8 passed (9)`, the one `INCONCLUSIVE:` (AC6), until the taste call is
  recorded; then 9 pass. `ac4-refusal.test.ts` logs `AC4 #3034.311508f3: not refused: the shot draws; at 3.5 s the
  default ior draws …, ior 1.5 draws …`.
- **On the merge base**: 9 fail (BASE-FAILURE.txt).

Why criterion 4's test has two ways to pass is under Readings, 1. How the repo's lanes read the two changes
(`scripts/proof-runs.mjs`, `scripts/proof.mjs`, as the base has them): landed as one change, every test fails on the
merge base at its assertion and is proven there. Landed as two, the first proves criterion 4 against the merge base,
and the before lane lists the other eight tests as failing on that change; the second's merge base holds the refusal,
where criteria 1, 2, 3, 5 and 6's tests fail at their assertions, while criterion 4's test passes on both sides, so
that run proves it only by a mutant of the added lines it kills.

## The surface under test

**No new binary, no new call, no new call field and no new target.** #377's `deep-gpu run [--planted <name>]` with
its JSON-lines protocol unchanged (`{"out", "calls"}` in, `{"ok", "replies"}` out) and #378's `view3d` for every frame
and for the refusal. Names the issue and the design give are used as they give them; the rest are this suite's
choices, marked **bold**, each the least a criterion needs.

### Documents (scene3d, as #166's and #2760's suites write them)

One writer layer `main` (writer `agent:sess-alpha`), `seed: 3034`, `requires: {modules: {scene3d: "^1"}}`, items keyed
by ID, f32 channels with linear keys.

- `ior` sits in a `material@1` item's `params.water`, as the Scope says ("`water` gains `ior: f32 = 1.33`"); a water
  without it draws at 1.33. Every fixture but one leaves it out; the one spells 1.5:
  `"lake-water": {"kind": "material@1", "params": {"roughness": 0.05, "water": {"waves": […], "ripples": {"strength":
  0.3}, "absorption": {"depth": 8}, "ior": 1.5}}}`. It is not the material's own `ior` (transmission's, beside
  `water`).
- The water part is a `plate@1` whose material carries `water`, its surface at rest the plate's plane (`at.pos[1]`);
  the eye is a `camera@1`'s `position`.
- A camera keyed through the surface is a channel on the camera's height, as #468 keys a camera's fields:
  `"channels": {"dive": {"target": "items/diver/params/position/1", "type": "f32", "keys": {"k0": {"t": "0s", "value":
  2.0078125, "interp": "linear"}, "k1": {"t": "4s", "value": -1.9921875, "interp": "linear"}}}}`, in a document whose
  `camera` is `diver` and whose `transport` is `{"span": "4s", "frame_rate": [60, 1]}`.

### `view3d`: read as the base has it

`{"call": "view3d", "doc", "look", "size", "frames", "fps", "from"?, "capture"?, "targets"?}`; read: each frame's
`frame`, `pixel_hash`, `final` (PNG by SHA-256) and `linear` (#378: the 3D writer layers' linear target, before
exposure and the tone map, little-endian f32 RGBA, rows top-down, `w × h × 16` bytes, as `<sha256>.f32` under `out`).
Criterion 1 names the linear target; criteria 2 and 3 are read from it too. So **the view from below is in the
`linear` target**: the disk, the card's dimming and the mirrored ball.

### The check's refusal (the first change)

**`view3d` answers a document in which a camera's eye goes below a water part with `{"code": "refused", "issues":
[Issue]}`**, the form its other check refusals take, each Issue the canvas core's `{code, severity, ids, path, actual,
what, fix}`. The suite reads:

- **an issue with `severity: "error"` whose JSON names the camera's item ID and the water part's item ID (the
  plate's), each as a whole word** (`diver` and `lake`; `ids` is the natural place), and
- **whose `actual` holds `t`, the first time the eye is below, in whole flicks**, as the water's `over_budget` issue
  holds its time (Material: water).

For example: `{"code": "refused", "issues": [{"code": "<the implementer's>", "severity": "error", "ids": ["diver",
"lake"], "path": "items/diver/params/position/1", "actual": {"t": 1416712500}, "what": "…", "fix": "…"}]}`. The
issue's `code`, `path`, `what` and `fix` are the implementer's.

### Planted programs (`deep-gpu run --planted <name>`, reachable only there; `twins.json` maps each criterion to its name)

| Name | The wrong program | Criterion |
|---|---|---|
| **`water_below_ior_one`** | From below, every water's surface is drawn as if its `ior` were 1, whatever its material says: the cone is the whole hemisphere, so the surface shows what is above it at every angle a frame holds. Everything else as shipped | AC1 `#3034.e507438d` (issue-named: "a planted surface with `ior` 1") |
| **`water_below_tint_by_depth`** | Under water, a surface's share of its own color is exp(−h ÷ depth) with h its depth below the water's surface at rest, in place of its distance from the eye. Everything else as shipped | AC2 `#3034.b073da51` (issue-named: "a planted tint that uses the card's depth below the surface in place of the distance seen") |
| **`water_below_sky_at_every_angle`** | From below, the surface shows what is above it at every angle and mirrors nothing. Everything else as shipped | AC3 `#3034.f0c06eee` (issue-named: "a planted surface that shows the sky at every angle") |

The implementer adds the three names to `enum Planted` and `Planted::parse` in `crates/deep-gpu-layer/src/main.rs`.
Each planted test runs the check its shipped twin passes and must fail it: criterion 1's failure says the disk `has no
edge` and names `48.8°`; criterion 2's names `` card `card` `` at both distances, and the plant's two shares agree
within 2%; criterion 3's names `` ball `ball` `` and says it `doesn't show mirrored outside the cone`.

### Files and environment

- **`docs/evidence/3034/lake-from-above.png`** and **`docs/evidence/3034/lake-from-below.png`**: written by
  `ac6-taste.test.ts`, the renderer's own final PNGs.
- **`tests/acceptance/3034/TASTE.json`**: the owner's call (The taste call, below). The suite ships none.
- `tests/acceptance/3034/base-hashes.json`: the merge base's hashes of #166's suite (The merge base's hashes, below).
- No environment variable is read but cargo's own: `CARGO_TARGET_DIR`, `CARGO_INCREMENTAL`, `CARGO_PROFILE_DEV_DEBUG`.

## The fixtures

Metres, +Y up; every still fixture's water is #166's `STILL` (one wave of amplitude 0, no ripples, no rain) on a
plate 60 m × 60 m at y = 0 whose material has roughness 0, under **the white sky**: a `sky@1` white from the zenith to
the horizon with no ambient, so nothing is lit and every colored part is `unlit` and shows its own color.

- **The still water and the camera 5 m under it** (criterion 1, 1024 × 1024): clear water (absorption depth 10 km and
  a black absorption color, so the sky keeps its brightness through the water and the rest adds nothing); a black
  unlit bed 10 m down, which is what the surface mirrors outside the cone; the camera at (0, −5, 0) looking at
  (0, 0, 0), straight up, `fov: 120`. Its view axis is the vertical, so a pixel r px from the frame's centre looks
  atan(r ÷ 295.6 px) off the vertical: the cone's edge is a circle 338 px in radius, where a pixel is 0.08°.
- **The card at 3 m and 6 m, and the same card in air** (criterion 2, 400 × 400): the camera 2 m under the surface,
  looking level along −Z, `fov: 40`; the card `card`, an unlit box 2.4 m square and 2 cm thick on the view axis,
  whose near face a channel holds 3 m from the eye at 0 s and 6 m at 1 s; water with `absorption: {depth: 3}` and the
  default absorption color. In air: the same document without the plate and its material. The card is drawn white and
  black in each. It stays 2 m below the surface, so the planted tint reads exp(−2 ÷ 3) = 0.513 at both distances.
- **The red ball and its mirrored point** (criterion 3, 480 × 480, two documents): clear water over the black bed; the
  ball `ball`, an unlit red sphere 0.6 m across with its centre 2 m below the surface; the eye 2 m below the surface
  too, the ball L m from it along −Z. The mirrored point is the ball's centre mirrored in the surface, 2 m above it,
  seen atan(L ÷ 4) off the vertical: L = 6.93 m puts it 60° off (outside the cone; the ball's image spans 57.9° to
  62.1°), L = 2.31 m puts it 30° off (inside; 26.3° to 33.7°). The camera (`fov: 30`) is aimed 0.5 m beside and 0.3 m
  above the mirrored point, which lands at (184.0, 266.5) px outside and (144.7, 250.1) px inside; the ball itself,
  level with the eye, is out of both frames.
- **The lake, the camera keyed through its surface, and the shot that crosses it** (criteria 4, 5 and 6; helpers.ts
  `lakeDoc`): the plate `lake`, 200 m × 200 m, whose material `lake-water` carries three waves a few centimetres high,
  ripples at 0.3 and an absorption depth of 8 m; a sand bed 5 m down; five posts, red and white, standing through the
  surface; a red buoy and a rock under it; a day sky and a sun. The camera `diver` (`fov: 90`) stands 8 m from the
  posts and its height is keyed from 2.0078125 m above the surface at rest at 0 s to 1.9921875 m below it at 4 s, 1 m a
  second: its eye is at the surface at 2.0078125 s, 1,416,712,500 flicks, between two frames at 30 and at 60 frames a
  second, so no frame has the eye in the surface itself. Above, it looks across the lake; below, up at the surface
  from under it, with the cone's edge across the upper part of the frame from 2.5 s on, at `ior` 1.33 and at 1.5.
- **The lake seen from below and from above** (criterion 6): that document at 1280 × 720 under a filmic look, at 0.5 s
  (1.51 m above the surface) and at 3.5 s (1.49 m below it).
- **#166's suite** (criterion 5; base166.ts): 17 of its calls, 23 frames, listed under The merge base's hashes.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs`: `criterionId`), computed from the issue's body. Each `describe` and test title starts
with `AC<n> #3034.<id>`.

| ID | Criterion | File: what it asserts | What fails it |
|---|---|---|---|
| `#3034.e507438d` | 1: the disk's edge; planted `ior` 1 | `ac1-window.test.ts` (2): in the `linear` target the disk's centre is bright, the surface 57° to 59.5° off the axis is under half as bright, and on each of 72 radial lines the disk's edge lies 48.8° off the axis within 0.5°. Twin `water_below_ior_one`: the same check fails, saying the disk has no edge and naming 48.8° | the merge base; a cone of another angle; no cone; the twin |
| `#3034.b073da51` | 2: the card at 3 m and 6 m; planted tint by depth | `ac2-card.test.ts` (2): (white − black in water) ÷ (white − black in air) at the frame's centre is 0.368 at 3 m and 0.135 at 6 m, each within 2% of itself; in air white reads over 0.1 above black. Twin `water_below_tint_by_depth`: the same check fails naming `card`, its two shares within 2% of each other | the merge base (the share is 1); a share by another length; the twin |
| `#3034.f0c06eee` | 3: the mirrored ball; planted sky at every angle | `ac3-mirror.test.ts` (2): outside the cone the red pixels number at least half the image's disk (3,544 px) and their centroid lies within 2 px of the mirrored point; inside the cone no pixel is red. Twin `water_below_sky_at_every_angle`: the same check fails naming `ball` | the merge base; a mirror about another plane; a mirror at every angle; the twin |
| `#3034.311508f3` | 4: the refusal | `ac4-refusal.test.ts` (1): the whole span asked of `view3d`. Refused: an error issue names `diver` and `lake` and its `actual.t` lies from 1,416,712,500 flicks (less 1 ms) to one document frame after. Not refused: all 241 frames draw, frame 0 differs from the frame at 3.5 s, and that frame differs between the default `ior` and 1.5 | the merge base (drawn, `ior` changes nothing); a refusal naming no time, a later one, or no camera or part |
| `#3034.dd678c04` | 5: seek equals play across the surface; #166's hashes | `ac5-hashes.test.ts` (1): #166's 23 frames have the merge base's `pixel_hash` (and `depth`, `reflection`, `pre_tone` file hashes). Then the shot played at 30 fps: frames 6, 9, 13, 16, 25, 27, 29, 52, 57, 59 (above) and 68, 76, 81, 84, 85, 86, 89, 99, 103, 106 (below), each seeked cold, have the played hashes; the 20 are 20 pictures; the frame at 3.5 s differs between the default `ior` and 1.5 | the merge base (at the `ior` guard); a view that keeps state between frames; a change to the water seen from above |
| `#3034.20ebe811` | 6: taste | `ac6-taste.test.ts` (1): the two frames differ, the frame from below differs between the default `ior` and 1.5; both written to `docs/evidence/3034/` with their hashes; then `TASTE.json`: none or on other pictures `INCONCLUSIVE:`, `looks_wrong` fails, `looks_right` on exactly these passes | the merge base (at the `ior` guard); no call; a call on other pictures |

Proof line: "the disk's edge" is criterion 1's log line (the edge's least, greatest and mean angle over the 72 lines);
"the card at two distances" criterion 2's two log lines; "the mirrored ball" criterion 3's; "the refusal on the merge
base's document" criterion 4's log line on the tree with the first change alone; "the hashes" criterion 5's
`base-hashes` line and its 20 seeks; "each planted surface failing" the three twin tests.

## Readings where the issue and design leave a choice

1. **Criterion 4 on a tree that holds the view.** The criterion's wrong program is the merge base ("it draws with no
   issue, and the test fails"), so its test must fail there (Wrong programs; Proven on the base). Its test also stays
   on main after the view lifts the refusal and must hold there (Closed issues stay proven). A test that asked for
   the refusal always would fail once the view lands; one that passed whenever the camera draws would pass on the
   merge base. So the test holds the Scope's reason for the refusal, "so nothing draws a view nobody decided": the
   camera keyed through the surface is either refused, naming the first time, or drawn by the decided view. "Decided"
   is read through the one field the issue adds: the view's cone follows `ior`, so 1.49 m under the surface, with
   both cones' edges in the frame, `ior` 1.5 and 1.33 can't draw one picture. Criteria 1, 2 and 3 hold what the view
   draws; this guard only tells a view from none. The log line says which way the test passed.
2. **One test for criterion 5.** No wrong program fails "#166's suite hashes the same as on the merge base" on its
   own: the merge base hashes as itself, and the criterion names no twin. A tagged test that passes on the merge base
   is refused by the before lane, so the clause shares the criterion's one test with the shot, which fails on the
   merge base. #166's part runs first, so its result shows on every tree.
3. **"Refused at check"** is read from `view3d`'s reply, as #2760's suite reads the water's refusals: the Scope's
   "so nothing draws" is about the call that draws. `deep-show`'s `deep_show` isn't run.
4. **"Naming the first time its eye is below."** The time is the issue's `actual.t`, in whole flicks, as the design's
   water issues carry a time. The eye is below at every time after the crossing and at none before, so the named time
   may be the crossing itself or anything up to one frame interval of the document after it (a check that walks
   frames names the first frame below), with 1 ms of slack before it for a solver; a time further on, such as the
   last key, isn't the first. The Scope's "naming the camera, the part" is held too: both IDs as whole words anywhere
   in the issue. The call asks for the whole span, so the refusal doesn't hang on which frames a call draws.
5. **"A camera keyed through the surface" and "a shot that crosses the surface"** are one document: a `camera@1`
   whose height a channel keys through the plate's plane. No shot item of the motion module is used.
6. **The disk's edge.** Along a radial line the edge is the outermost point where the surface is still a quarter of
   the way up from the level outside (the median of the lines' means from 57° to 59.5°) to the disk's level (the mean
   at the centre). A cone drawn as a step puts that within a pixel (0.08°) of the step.
   A quarter rather than a half: the Scope's rule is a step, but a surface that also fades the sky toward the cone's
   edge, as the water's mirror fades by Fresnel from above, still ends its disk at the cone, and a half-way level
   would read such an edge up to 0.6° inside it. "No edge" is the planted case: 57° off the axis the surface is over
   half as bright as at the centre.
7. **The fixture of criterion 1.** The criterion gives the camera, the lens and the sky. Clear water keeps the disk
   one brightness to its edge; the black bed is "the deep" the surface mirrors outside the cone, so the outside is
   dark whatever a mirror shows where nothing lies below.
8. **"0.368 of its value in air"** is read as #166's tint test reads the bed's share, (white − black in water) ÷
   (white − black in air), so the Scope's "the rest the absorption color", and whatever light it takes, cancels and
   the default absorption color stays. "Within 2%" is 2% of the share (0.0074 and 0.0027), the stricter reading, as
   #166 took it. "3 m from the eye" is the card's near face on the view axis; "`depth` 3 m" is `absorption.depth`.
9. **"A red ball 2 m below the surface"** is its centre; "the mirrored point" is that centre mirrored in the surface
   at rest, projected by the pinhole; "its centroid" is that of the red pixels of the `linear` target (red over 0.05
   and over four times green and blue, as #166 reads its post). "Shows mirrored" also asks for at least half the
   image's disk, so a sliver at the right place fails. **"Outside the cone"** is held from both sides: the same ball
   seen 30° off the vertical must not be mirrored, or a surface that mirrors at every angle would pass.
10. **"20 sampled times"** are ten frames with the eye above the surface and ten with it below, drawn by a seeded
    generator from the shot's 121 frames at 30 fps; "seeked" is a session opened cold at the frame (`from`), as #166's
    seek test opens one.
11. **"#166's suite hashes the same as on the merge base."** The hashes are the pixel hashes #166's tests compare and
    the SHA-256s of the float targets its other tests read, for one draw or more of each of its ten test files (The
    merge base's hashes). They are one machine's (Determinism class: same machine), so they are held with the machine
    that drew them.
12. **`Runs on:`** "Without a GPU" is off macOS or a `deep-gpu` that finds no device: `BLOCKED:`. "A Mac of a
    reference model" is read through the lane's `references`; on another Mac the tests fail `INCONCLUSIVE:` (The
    reference Macs: "anywhere else the result is a reading").
13. **The taste call** takes #980's form: fixed file names under `docs/evidence/3034/`, the renderer's PNGs byte for
    byte, a `TASTE.json` bound to their hashes. `looks_right` stands for "the frame from below reads as under water".
14. **`distort`** is left at its default on the still fixtures (still water bends nothing), and the water's material
    has roughness 0 there so its mirror is sharp, as #166's mirror fixture has it.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- The cone's angle at any `ior` but the default (1.5 is read only as "another picture"); the range `ior` takes and
  what an `ior` under 1 does.
- "Bent by the waves' normal": the cone and the mirror are measured on still water only; the waves' lake is held to
  seek against play.
- What the surface shows inside the cone beyond a white sky: where a thing above the water lands when seen from
  below, and any Fresnel share. Whether the sky through the surface, the bed, or a mirrored thing takes the
  absorption, and over what length; the distance from the eye against depth along the view axis off the axis.
- "The rest the absorption color": the card's reading cancels it.
- "Above the surface nothing changes" beyond #166's 23 frames: the shore, flow and rings suites (#268, #968, #2760)
  aren't drawn again, and a water with `ior` seen from above isn't compared with one without.
- The refusal beyond criterion 4's camera: its `code`, `path`, `what` and `fix`; a camera below from the document's
  first instant; an orbit camera or one a driver, a shot or your hand moves; an eye lower than a water part but
  outside its rectangle; several water parts; `deep_show` raising the same issue. That the view lifts the refusal
  for every document is held only by the fixtures here drawing.
- A frame whose eye lies in the surface itself, and the Scope's "Not in this task" lines (a lens half in the water,
  light patterns on the bed, shafts of light, bubbles, sound under water): no fixture reaches them.
- `deep_kinds` listing `ior`, the amended Material: water in `docs/canvas-primitives.md`, the water's rows under
  Paths, and any budget (the issue has none).

## What the implementer adds outside this folder

- `crates/deep-gpu-layer/src/main.rs`: the three planted names in `enum Planted` and `Planted::parse`.
- Nothing in `scripts/lanes.mjs`: `lane.json` puts the folder in `alone`, and no test here is timed.
- `docs/evidence/3034/lake-from-above.png` and `lake-from-below.png`, as `ac6-taste.test.ts` writes them on the tree
  with the view, to show the owner; `tests/acceptance/3034/TASTE.json` is then the owner's to fill.
- The design is edited like code (CONTRIBUTING.md): Material: water gains `ior`, the view from below and the
  refusal's issue in the change that builds each.

## The merge base's hashes

`base-hashes.json` holds `{"base": "<the merge base's commit>", "machine": {"model", "chip", "memoryBytes",
"macosBuild"}, "hashes": {"<draw>, frame <n>": {"pixel_hash": "<sha256>", "depth" | "reflection" | "pre_tone"?:
"<sha256>"}}}`: what `view3d` drew at the merge base, on that machine, for #166's documents as base166.ts writes them
out again, seeded 166 and in #166's own looks:

| #166's test | Draw | Frames | Hashed |
|---|---|---|---|
| `waves.test.ts` | the 16 m lake from above, `from: 75` | 75 | `pixel_hash`, `depth` |
| `seek.test.ts` | the harbour with waves, ripples and rain, seeked to 17, 44 and 89; without rain and without ripples at 44 | 17, 44, 89, 44, 44 | `pixel_hash` |
| `mirror.test.ts` | the post in wavy water and in calm water, `from: 30` | 30, 30 | `pixel_hash`, `reflection` |
| `tint.test.ts` | the white bed and the black bed under the pool, played 61 frames | 0, 30, 60 each | `pixel_hash`, `pre_tone` |
| `defaults.test.ts` | `water: {}`, played 46 frames | 0, 20, 45 | `pixel_hash` |
| `rain.test.ts` | the lake in the rain, `from: 45`, `rings: true` | 45 | `pixel_hash` |
| `foam.test.ts` | foam and a boat's wake, `from: 600` | 600 | `pixel_hash` |
| `physics.test.ts` | a floating body's wake, `from: 600` | 600 | `pixel_hash` |
| `taste.test.ts` | the lake under the filmic look at 1280 × 720, `from: 30` | 30 | `pixel_hash` |
| `budgets.test.ts` | the lake filling half a 1080p frame, and the far pond, their first frame | 0, 0 | `pixel_hash` |

As held: taken at `c7dc0edc3690706adb84d678806301c3d14456ca` on a Mac17,10 (Apple M5 Max, 64 GB), macOS build
26B8119. The 23 frames are 21 different pictures: the black bed under the pool is one black frame at all three depths,
as #166's tint test expects of it. A second run of the file at the base drew the same 23.

To make the hashes again: on a checkout of the merge base with this folder copied in, build `deep-gpu` and run
`ac5-hashes.test.ts` as above. It logs one line, `AC5 #3034.dd678c04 base-hashes: {"machine": …, "hashes": …}`, before
it compares anything; that object, with `"base"` set to the commit, is the file. On a tree that changes nothing above
the surface the same line holds the same hashes. A run whose hashes differ on a machine or macOS build other than the
file's fails `INCONCLUSIVE:`, naming both; the file is then made again on the merge base on that machine, by an
approved proposal, since it is a check's own data.

## The taste call

`tests/acceptance/3034/TASTE.json` is the one file anyone adds to this folder after it lands, and only to record the
owner's call on exactly the two pictures criterion 6 writes: `{"issue": 3034, "criterion": "#3034.20ebe811",
"verdict": "looks_right" | "looks_wrong", "who", "when" (ISO 8601), "screenshots": {"lake-from-above.png":
"<sha256>", "lake-from-below.png": "<sha256>"}, "note"?}`. `looks_right` says the frame from below reads as under
water. No test judges a picture.
