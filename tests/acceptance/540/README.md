# Acceptance tests for #540: the point control on grids and the ground, surface hits with the stored ray, box drags and a throw along a click

Written first, from issue #540 (its Scope, its Fields, eleven acceptance criteria, its Proof line and its Oracle line),
the parent #187 for what the sibling parts own, the design sections the issue links and those they lean on, and the base
commit `9b77cd2cd` ("Merge pull request #2438"), by a job that never saw an implementation; none existed, and no other
worktree, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, each test carrying its
criterion's ID, and exactly the ten planted twins the criteria name. The Oracle line's lane is
`tests/acceptance/540-oracle/`.

## What was read

- The issue (`gh issue view 540`) and its parent #187: #539 owns picks on rows, grid focus and hover; #541 actions, key
  repeat and pads; #542 text and scroll; #543 the camera's goto and edge pan, mouse look, and sealing the new kinds in
  `control@1` and `deep_kinds`. Their behaviour isn't tested here.
- `docs/technical-design.md`: Control and input track; Camera and overlay; Dogfooding (and Proven on the base).
- `docs/canvas-primitives.md`: Scope and input classes; Input router, focus and gesture serial; Spatial index; Control;
  Control: picks on rows and grid focus; Control: point; Control: kinds as a registry; Input track; Input track entries
  (`on`, `data`, `launch.from`); Occurrence list; Golden; Selection (session state) (`hit.margin`); Builder plate:
  terrain; Camera `camera@1` (its user fields); Logic `logic@1` (the read region); Check input: logic kinds
  (`logic.determinism`); Net `net@1`; Net: rollback; Net: lockstep; Check input: net kinds.
- The Oracle page `doneright/oracles/issues/540.md` on branch `doneright` of `DeepBuildAI/deepbuild` and the vendor
  copies of the three files it pins (the Oracle lane's README).
- At the base, only for surfaces and conventions: AGENTS.md; `scripts/proof-change.mjs` (`criterionId`),
  `scripts/lanes.mjs`, `scripts/public-text.mjs`; `crates/deep-show` (`main.rs`'s calls, `input.rs` (a click's entry
  stamped at the press's `at`; `mods` on events), `terrain.rs` (`terrain_rays`), `golden.rs`, `physics.rs` (a scene's
  worlds baked on its track)); `crates/deep-canvas` (`camera.rs`: the pose, `screen_basis`, the projector; `scope.rs`: a
  3D drag turns the camera by `user.turn`; `area.rs`: the panel is a closed rectangle; `heights.rs`: the plate's split);
  `crates/deep-canvas-input/src/session.rs` (the control kinds); `crates/deep-canvas-physics/src/doc/inputs.rs` (a
  launch from a control's entries; `data` and `from` refused, naming #522); `crates/deep-canvas-scene3d/src/scene.rs`
  (the 3D camera); `crates/deep-gpu-layer/src/view3d.rs` (`clicks`, `hit.margin`); the suites `539/` and `539-oracle/`
  (the scenario, `logic`, programs, planted names), `539-oracle-redraft/DISPUTE.md`, `537/` and `537-oracle/` (logic-fed
  instancers, glTF fixtures), `424/` (the 3D pick margin), `2014/` (the terrain plate), `2013/` and `1897/` (another
  machine's record by an environment variable), `2012/helpers.ts`, `525/`, `1918/`, `2009/` (worlds in scenes, bakes,
  occurrences), `544/wat` (the assembler).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design, `geometry.ts` and this
suite's own programs and fixtures.

## What the base already does, and these tests don't credit

A click on a row a pick control names writes one entry (#539), and `logic` replays the track with logic.determinism. A
3D drag turns the scope's camera about its target by `user.turn` (0.25° a px). `deep-gpu run view3d` answers a 3D click
from the object-ID target with the hit margin, nearest on screen, ties to the nearer depth (#424), and a CPU hit on the
evaluated triangles (#1976), for the viewer's selection only. `terrain_rays` (#2014) gives the ground point a ray makes
on a terrain plate's height-field triangles, rounded to 1/1024 m. A world's `launch` can be derived from a control's
entries (#525) with fixed velocities. None of it is a point control: the base's `control@1` holds nine kinds (slider,
toggle, choice, stages, transport, drag_along, turn, press, hover) and refuses `kind: point` as `out_of_range` at
`controls/<id>/kind`; there is no `world` or `match` call, no net module, and a world input's `data` and `from` are
refused, naming #522. So no test here can pass at the base, and none is a guard. `BASE-FAILURE.txt` says why none was run.

## Run them

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/540 --testTimeout=1800000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/540
```

Each file builds `deep-show` once, in `beforeAll` (`cargo build --locked --bin deep-show`, the default `full` set),
honoring `CARGO_TARGET_DIR`, with rustup's bin on PATH where it exists, copied to a temporary folder; files with logic
programs also build #544's assembler (`tests/acceptance/544/wat`, read only) into `target/acceptance-540-wat/`. Every
test passes its own 30-minute timeout; none reads a timing or the machine's load (no criterion states a time). Evidence
stores and binaries are temporary and deleted; the one file kept is criterion 2's record of this machine,
`target/acceptance-540/box-entries-<platform>-<arch>.json`. Node built-ins, vitest and `../467/helpers.ts`'s PNG writer
(imported, read only); no process is started but `cargo`, the assembler and `deep-show`, each waited for, none stopped
by name or port.

**The lanes line.** The implementer adds this to `scripts/lanes.mjs`, beside #539's (this README is the instruction):

```js
// #540's files each build deep-show (most also #544's assembler), run logic programs, draw 3D and bake a world.
alone.push('tests/acceptance/540/', 'tests/acceptance/540-oracle/');
```

Gates: no cargo is `BLOCKED:`; an assembler that doesn't build is `BLOCKED:`; criterion 2's third test is `BLOCKED:`
without the other machine's record (below). None is a pass.

## The surface under test

The issue names a control's fields, entries, read-region bytes, step hashes, a contact, a check, copies of a match and
planted programs, but no call. As #539's suite does, everything is driven through `deep-show run` (one JSON scenario on
stdin, one answer `{"ok": true, "replies": [...]}`, one reply per call) on the scope's virtual clock (`clock:
{refresh_hz: 120, lead: 2 ms, check: 0.5 ms}`, a 2560 × 1600 display), each document in a panel of its own whose `rect`
is `[0, 0, w, h]`, its document's `size`, so a frame pixel is a panel pixel. **Every field, call, reply field, byte code
and planted name below that the issue or the design doesn't give is this job's choice, the smallest the criteria need;
the implementer builds exactly these, or a dispute goes to a blind redraft.** Times are flicks (705,600,000 a second).

### Calls

| Call | What the tests send | What they read | At the base |
|---|---|---|---|
| `deep_show` | `{session, doc, document, include: ["issues"], at}` | `outcome`, `issues` (`code`, `severity`, `ids`, `path`, `actual`) | exists (#393) |
| `scope` | `{panel, at}` | `state.camera`: `position`, `target`, `azimuth`, `fov`, `view_width` (a 3D pose; a figure's `target` and `view_width`) | exists (#383) |
| `input` | `{panel, at, event}`; `event: {type: "down" \| "move" \| "up", pos: [x, y], button}`, pos in panel px, **`button: "primary" \| "secondary" \| "middle"`** (the button pressed, moved with or released) | `appended` (#504): the entries the input wrote | exists; `button` and point entries new |
| `logic` | `{doc, steps, check?: "logic.determinism", at}` | `steps: [{step, t, hash: {item: hex}, arrays: {"<item>.<name>": [value]}}]`, `track`, `check: {kind, verdict, failures}` | exists (#539) |
| **`world`** | `{doc, world, at}` | `step_hashes: [string]` (one a step), `bodies: {<body>: [State]}` (#2009's: index j the state after j steps, `pos`, `linear`), `occurrences: [Row]` (#1918's: `step`, `kind`, `a`, `b`) | new |
| **`match`** | `{doc, steps, at}` | `copies: [{player, steps, track}]`, each copy's `steps` and `track` as `logic` gives them | new |
| scenario `planted` | one of the ten names below | | form exists, names new |

- **`world`**: the named world of the document's scene baked again, as the hub bakes a scene's worlds (#1918), from step
  0 over the transport's span on the document's input track as the hub holds it now: a replay, whatever the camera did
  since. Its inputs derived from controls read their entries' stored values (Input track entries).
- **`match`**: the document's match as its `net@1` item declares it, every copy run in this process over a test relay
  with no network (Check input: net kinds), `steps` match steps: player 1's copy plays the entries the panel recorded
  (each stamped `delay` match steps after its gesture, Net), the others none; each copy reports its logic items' steps.
- **The orbit.** A drag with the middle button turns a 3D view about the camera's target as the base's plain drag does
  (`user.turn`, 0.25° a px: 160 px 40°, 360 px 90°, a drag to the right lowering the azimuth): a drag that starts with a
  point control's button belongs to the control (Control: point), so the viewer's turn moves to the middle button. Each
  test checks the turn through `scope` before reading anything after it.
- **Stamps.** A press's entry is stamped at the press's `at` on the scenario's clock, as #504's and #539's clicks are;
  criterion 5's press comes at exactly 0.5 s, and criterion 7's entries `delay` steps later.

### Documents (fixtures.ts)

| Field | As written | At the base |
|---|---|---|
| A point control | `controls.<id>: {kind: "point", class: "document", label, role: "application" (a grid's: "grid"), on, drag?, targets?, margin?}`; `on`: a mark set ID, a terrain plate ID, `{plane: {y}}` or `"surface"`; `drag: "path" \| "box"`; `margin: 3` (px) | new (`kind: point` refused) |
| A 3D scene | `{format: 1, profile: "scene", title, description, size, seed: 540, camera: "cam", transport: {span: "4s", frame_rate: [60, 1]}, requires: {modules}, items, assets?, controls, channels?, worlds?}` | exists |
| Cameras | `camera@1 {projection: "perspective", position, target, fov, near, far}` or `{projection: "orthographic", position, target, view_width, near, far}` | exists |
| The grid (criterion 1) | #539's figure: `marks@1` atlas tiles, cell [16, 16], grid.size [12, 12], at (8, 8), from the logic item `world` | exists |
| The terrain plate | `plate@1 {terrain: {height: "0.01 * position.x * position.z", size: [64, 64], spacing: 1, tile: 64, lod_levels: 1}}` | exists (#2014) |
| The quad, the triangles | `mesh.asset@1 {sha256, node: {scene: 0}}`, a JSON glTF in the evidence store, listed in `assets` | exists (#537) |
| Marks | `mark.box@1 {size}` at `at.pos`; `mark.point@1 {size: px, paint}`; `mark.line@1 {points, width: 1, paint}` | exist |
| Units | `instance@1 {of: [unit], live, gen, pos}` read from the logic item `army` (`{array, as}`) | exists (#537) |
| The cube's turn | `channels.spin: {target: "items/cube/at/rot/1", type: "f32", keys: 0° at 0 s, 360° at 4 s, linear}` | exists |
| The lab's world | `worlds.lab`: `physics.world@1` (rapier3d =0.36.1, 120 Hz), static `base` and `top`, the ball (1 kg, `gravity_scale: 0`), and `inputs.throw: {kind: "launch", targets: [ball], on: {control: aim, each: entry}, from: "pose", data: {"from.pos": "aim.ray.origin", linear: "20 * aim.ray.dir"}}` | `data` and `from` refused (#522) |
| The match | `net@1` item `{relay: "https://relay.test/540", players: 2, step_rate: 20, delay: 4, window: 0}` | new |

### An entry

`appended` (and `logic`'s `track`) gives each entry as `{t, seq, control, value, writer: "you", …}`, `value` the issue's
Value in JSON: `{phase: "press" | "move" | "release", button: "primary" | "secondary" | "middle", mods: {shift, ctrl,
alt, meta}, cell: [cx, cy], ground: [x, y, z], hit: {set, key: [k0, k1]}, corners: [[x, y, z] | null] × 4, surface:
{point, normal, uv: [u, v] | null, face}, ray: {origin, dir}}`, a field the entry doesn't hold `null` or absent. A box
release in 3D whose `targets` name an instancer also holds **`units: {keys: [[slot, gen]], truncated: bool}`** (the
issue's Scope), the units drawn inside the box at the gesture. An item's `hit` is its index in `targets` with key [0, 0].

### The read region

A logic item reading a point control finds, as Logic `logic@1` lays a control out, a u32 count and 4 zero bytes, then
each entry as a u32 player (1 alone), 4 zero bytes and the entry's row. The row is the issue's 248 B, offsets from its
start:

| Offset | Bytes | Field |
|---|---|---|
| 0 | u8 | phase: **0 press, 1 move, 2 release** |
| 1 | u8 | button: **0 primary, 1 secondary, 2 middle** |
| 2 | u8 | mods, **bit 0 shift, bit 1 ctrl, bit 2 alt, bit 3 meta** (the Value's order) |
| 3 | u8 | flags, **bit 0 cell, bit 1 ground, bit 2 hit, bit 3 corners, bit 4 surface, bit 5 uv, bit 6 ray** (the issue's order), **bit 7 units** (this job's: a unit-key tail follows) |
| 4 | 4 | zero |
| 8, 16, 24 | f64 × 3 | x, y, z: a cell as cx, cy, 0; a ground point; a surface's point |
| 32 | u32 | set |
| 36 | 4 | zero |
| 40, 48 | i64 × 2 | key[0], key[1] |
| 56 | f64 × 12 | the four corners, each x, y, z, in the entry's order |
| 152 | f64 × 3 | a surface's normal |
| 176 | f64 × 2 | a surface's uv |
| 192 | u32 | face |
| 196 | 4 | zero |
| 200 | f64 × 3 | the ray's origin |
| 224 | f64 × 3 | the ray's direction |

A field the flags don't hold is zero bytes. **The unit-key tail** (this job's, flags bit 7, on a box release with unit
keys): right after the row, `u32 n` (at most 256), `u32 truncated` (0 or 1), then n × (`u32 slot`, `u32 gen`); the next
entry follows it. Criterion 2's corners all hit; the bytes of a corner that meets nothing are left to the implementer.
The programs read the region at 1024 and write theirs at 65,536 (two pages), past the largest read region one point
control can fill a step (16 entries: 8 + 16 × (256 + 8 + 8 × 256) B).

### Planted twins

Each is one criterion's wrong program, reachable only through the scenario's `planted`, and changes nothing else; any
other value stays `bad_input`. `twins.json` maps each criterion's ID to its twins.

| Name | Criterion | The wrong program | The test fails |
|---|---|---|---|
| `press_cell_next_frame` | 1 | a path drag's press entry takes the cell under the pointer at its next sample, one frame later | "no belt on (2, 2)", naming the press entry |
| `box_corners_on_replay` | 2 | a box release keeps the pointer's screen corners and every replay meets them again through the camera as it is then | another set selected after the turn; logic.determinism FAIL naming the release |
| `ground_meets_behind_eye` | 3 | the ground test meets the whole line through the pointer, behind the eye too | ground written above the horizon, naming the press |
| `surface_uv_nearest_vertex` | 4 | a surface hit's uv is the uv of the hit triangle's vertex nearest the point | uv (1, 0), naming the press |
| `surface_hit_on_replay` | 4 | a surface entry keeps the pointer's position and every replay meets the item again through the camera as it is then | another point read after the orbit; logic.determinism FAIL naming the press |
| `surface_at_rest` | 5 | a surface hit meets the item as it stands at rest, not as evaluated at the press's flick | (0.2, 0, 0.5), normal (0, 0, 1), naming the press |
| `throw_reads_camera` | 6 | a launch derived from a point entry reads the ray from the pointer's position through the camera at the replay | a step hash differs after the second orbit, naming the step |
| `box_keys_at_apply` | 7 | a box release's unit keys are filled at the step the entry applies, from the units' positions then | 4 units, naming the release |
| `point_pick_one_pixel` | 8 | a point control's hit reads only the object-ID pixel under the pointer, no margin | nothing at column 302, naming the press |
| `point_pick_nearest_depth` | 9 | inside the margin the target pixel nearest in depth wins | near named 1 px from far, naming the press |

## Programs

`programs.ts`, WebAssembly text assembled by #544's assembler; each exports `memory` (2 pages), `init`, `step`,
`reads_at` (1024 when it reads) and `writes_at` (65,536); arrays in declaration order on 8-byte boundaries. Each walks
the region's entries by the layout above.

- `world`: the 12 × 12 grid's `tiles` and `alive` (#539's). `belts` (criterion 1): reads `place`; each entry whose flags
  hold a cell lays a belt on (x, y), kept across steps: `belts: bool × 144`, row-major.
- `pins` (criteria 4, 11): reads `aim`; keeps the last press entry's 256 B (player word, zero word, row) as `rec: i32 ×
  64`.
- `army` (criteria 2, 7): ten units, live, gen 1, unit i at (x_i + v (k − k0), h(x, z), z_i). Standing (criterion 2): v 0,
  h 0.01 x z. Moving (criterion 7): 0.5 m a 20 Hz step, k0 20, h 0.
- `select` (criterion 2): reads `box`; on a release holding corners, selects the units whose x and z lie inside the
  corners' polygon (crossing rule), `selected: bool × 10`, and keeps the release's 256 B as `rel`.
- `orders` (criterion 7): reads `box`; on a release holding unit keys, selects the slots whose key has generation 1,
  `selected: bool × 10`, and counts releases, `releases: i32 × 1`.

## Fixtures and expected values

`fixtures.ts` and `geometry.ts`. Cameras follow the core's conventions (Camera `camera@1`): a perspective field of view
across the wider side, an orthographic view width across the width, screen right from forward × +Y, pixel y down; a
perspective ray from the eye, an orthographic one from the near plane. The tests of criteria 1 to 4, 6 and 11 read the
scope's camera and check it is the one their numbers come from, or turned as far as they assume.

- **Criterion 1**: the grid, `place` (`on: board`, `drag: path`), `belts`; the drag through the centres of cells (2, 2)
  to (9, 2), (8 + 16 cx, 40) u, one sample a 120 Hz frame apart.
- **Criterion 2**: the plate (a saddle, so the split matters: the base's, each cell from its (c, r + 1) sample to its
  (c + 1, r) one), units at (−11, −1), (−5, 1), (0, −1.5), (4, 1.5), (9, 0), (12.5, −1) inside and (−20, 0), (20, 1),
  (0, −10), (2, 10) outside (2.1 m and 5.1 m clear of the expected quad), the camera at (0, 40, 30) on 1000 × 800, the
  box from (250, 340) to (750, 470) px. Expected corners: each corner ray met with all 8,192 triangles in f64. After a
  90° turn the twin's recomputed quad holds another set.
- **Criterion 3**: the camera at (0, 10, 0) aimed at (0, 0, 10 ÷ tan 30°), fov 90° on 800 × 800; presses at (400, 400)
  and (400, 100).
- **Criterion 4**: the quad (face 0 is vertices 0, 2, 1; face 1 is 0, 3, 2; normal (0, 1, 0) by winding), the press at
  (416.376…, 259.510…), the projection of (0.25, 0.5, −0.5); uv by barycentric weights on face 0.
- **Criterion 5**: the 1 m `mark.box@1`, the channel, the orthographic camera 4 m across 400 × 400; the press at 0.5 s at
  (220, 200), the beside press at (350, 200); `cubeDoc([])` shown as a second document.
- **Criterion 6**: the lab; after the 40° orbit the eye is at (−6.428, 1.5, 7.660) and the top box's +Z face centre
  (0, 1.5, 0.5) at (423.15…, 300) px; that ray enters the top box there (about 58 steps at 20 m/s).
- **Criterion 7**: the top-down orthographic camera (20 px a metre); units 0 to 5 inside the square at steps 18 to 22,
  units 0 to 3 alone from step 23; the release at 1 s (step 20), applied 4 steps on.
- **Criteria 8 to 11**: the camera at the origin along −Z, fov 90° on 1000 × 1000 (500 px focal): the line at column
  300; points on pixel centres (500.5, 500.5) and (504.5, 500.5); the wall's edge at x = 701 or 702 px, the 3 px mark on
  (700.5, 500.5), the block to x = 301, the second line at 302.5.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#540.` + the first 8 hex digits of the SHA-256 of each criterion's text, trimmed,
white space collapsed, from the live issue. Each test's name starts with `AC<n> #540.<id>`; each file quotes its
criterion in full. Test count: 2 + 3 + 2 + 4 + 2 + 3 + 2 + 2 + 2 + 1 + 1 = 24 (and 2 in the Oracle lane).

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#540.ba264743` | `ac1-path-belts.test.ts` (2) | Nine entries of `place`: press (2, 2), moves (3, 2) … (9, 2), release (9, 2), primary, by you; the logic track holds them; `belts` holds exactly (2..9, 2), 8 belts. Twin: the press at (3, 2), "no belt on (2, 2)" naming the press |
| AC2 `#540.88ffa39f` | `ac2-terrain-box.test.ts` (3) | The release's four corners within 1/1024 m of the expected hits, read at their offsets by `select`; exactly units 0 to 5 selected; after a 90° turn the same entries, selection and step hashes, logic.determinism PASS. Twin: another set, FAIL naming the release. Cross-machine: this machine's box entries and release row written, equal to the other machine's record byte for byte, `BLOCKED:` without it |
| AC3 `#540.c9bfe882` | `ac3-plane-ground.test.ts` (2) | The centre press's ground within 1/1024 m of (0, 0, 17.3205…) and 17.3205 m from the foot; the press above the horizon ground none. Twin: a point written, naming the press |
| AC4 `#540.5ca93239` | `ac4-surface-quad.test.ts` (4) | hit {0, [0, 0]}, point, normal, uv, face 0, ray within the issue's tolerances; `pins` reads them at their offsets (flags 116, the zero words); after a 90° orbit the same entry and bytes, logic.determinism PASS. Twins: uv (1, 0) naming the press; another point read after the orbit and FAIL naming the press |
| AC5 `#540.4d24f725` | `ac5-turning-cube.test.ts` (2) | The press stamped at 0.5 s writes (0.2, 0, 0.5071) within 1/1024 m and (0.7071, 0, 0.7071) within 1e-4; beside, hit and surface none; `targets: []` refused with an error (not an unknown kind or field) naming `aim`. Twin: (0.2, 0, 0.5) and (0, 0, 1), naming the press |
| AC6 `#540.097a4bdc` | `ac6-throw.test.ts` (3) | The press's ray from the orbited eye to the face centre; the ball's first motion 20 m/s along it from on its line, unchanged until the first contact, a contact_begin of `ball` and `top`; after the second orbit the same step hashes and contact. Twin: a step hash differs, naming the step |
| AC7 `#540.cd0a870f` | `ac7-lockstep-box.test.ts` (2) | The release records units 0 to 5, generation 1, untruncated, stamped 4 or more match steps after the gesture; both copies select exactly those 6, reading one release. Twin: 4 units, naming the release |
| AC8 `#540.430b1895` | `ac8-line-margin.test.ts` (2) | The line projects to x = 300; the press at column 302 names it, at 304 nothing. Twin: nothing at 302, naming the press |
| AC9 `#540.3d447f83` | `ac9-nearest-on-screen.test.ts` (2) | The press 1 px from far names far; 100 presses at equal screen distance each name near. Twin: near, naming the press |
| AC10 `#540.a41e287c` | `ac10-hidden-margin.test.ts` (1) | Targets [mark]: the press on the wall names the mark through the sliver, and nothing when the wall hides it; targets [mark, wall, block, rail2]: the wall, and the block 2 px from the line |
| AC11 `#540.2aa57686` | `ac11-line-nearest-point.test.ts` (1) | The press 2 px from the line names it, stores the eye's ray, and its surface point is within 1/1024 m of the segment's point nearest that ray; after a 90° turn the same entry and bytes, logic.determinism PASS |

## The other machine (criterion 2)

The criterion's pair is macOS on arm64 and Linux on aarch64: one CPU architecture on two systems (Node names both
`arm64`). This machine writes `target/acceptance-540/box-entries-<platform>-<arch>.json` (`platform`, `arch`, `entries`:
each box entry's `control`, `t` and `value`; `release_row`: the release's 248 B as `select` read them, in hex) and reads
the other machine's from the path `DEEP_540_OTHER_RECORD` names. Without it, with a missing file, or with a record from
anything but the other member of the pair, the test is `BLOCKED:`, never a pass. The unblock: run this file on the Linux
aarch64 machine (or the Mac) and point the variable at the record it writes there. The x86_64 comparison waits for the
first x86_64 target, as the issue says; no test asks for it.

## Readings where the issue leaves a choice

- **Criterion 10 contradicts the Scope's rule as written**, and this is the reading chosen. The Scope says the pixel
  under the pointer wins when it holds a target; then a press on the wall names the wall whenever the wall is a target,
  and the sliver could never be named "only while the sliver draws". So the sliver is tested with `targets: [mark]` (the
  wall not a target: named through the sliver, never when fully hidden) and "and the wall is" with `targets: [mark,
  wall, block, rail2]` (fully hidden: the wall named). The mesh beside the line is in the second form.
- **"A replica given the same synthetic pointer path"**: the same `deep-show run` scenario on each machine. **"Byte-identical
  entries"**: the box entries' JSON and the release's 248 B as the logic item read them, both equal.
- **"Turning the camera"**, **"orbits"**: the viewer's turn by a middle-button drag (The orbit, above).
- **"Names"** for a point control: the entry's `hit`. **"Names what lies under it, or nothing"** (criterion 8): over
  nothing drawn, hit none. **"Topmost drawn target"** for an item: `{set: its index in targets, key [0, 0]}`.
- **"A margin hit on a line stores the point"** (criterion 11): with `on: surface`, as `surface.point`.
- **"The same on 100 runs"** (criterion 9): 100 presses at the same point in one run, each entry checked.
- **"One frame later"** (criterion 1): the pointer's next sample, one 120 Hz frame after the press.
- **"Derives one launch"** (criterion 6): a launch derives from each entry (`each: entry`); the design gives no filter by
  phase, so the press's release comes at 3.2 s, after the 3 s span, and the press alone launches within the bake. The
  test checks the ball's first motion and that it doesn't change before the first contact.
- **"Selects at the apply step takes 4"** (criterion 7): the twin fills the unit keys when the entry applies; `orders`
  selects from keys, so its copies take 4.
- **"With a delay of 4 steps"**: the release's stamp lies 4 or more match steps after its gesture.
- **"A press at 0.5 s"** (criterion 5): its call at 0.5 s; its entry stamped exactly 0.5 s, as the base stamps a click.
- **"Ahead of the camera's foot"** (criterion 3): the horizontal distance from (0, 0, 0), the foot of the eye at (0, 10, 0).
- **"Fails logic.determinism, naming the entry"**: verdict FAIL and a failure holding the entry's control and `t`.
- **"Refused at check, naming the control"** (criterion 5): an error other than `unknown_kind` or `unknown_field` whose
  `ids` hold `aim`, whose `path` is under `controls/aim`, or whose `actual.control` is `aim`.
- **A box drag's moves** aren't asserted: the design writes a move per cell only with `drag: path`.

## Not tested, because no criterion reaches it here

Hover on a point control; hex lines on a path; a ground path's `spacing`; `buttons` other than primary and the `button`
and `mods` bytes past their zero values; Enter on a focused grid cell; a corner that meets nothing; more than 256 units
(`truncated`); an instancer element as a surface target; a skinned item; the cost lines; the kit at the seal (#543).
They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- The lanes line above.
- In `deep-show`: the point control in the input module (2D cells, ground points on planes and terrain plates, box
  corners and unit keys, surface hits on the CPU at the gesture's flick, the stored ray, the margin search), `button` on
  `input` events with the middle-button orbit, the `world` and `match` calls, a world input's `data` and `from` (with
  #522), the net module's lockstep, and the ten planted names. In the logic module: the 248 B row and the unit-key tail.
