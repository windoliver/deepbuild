# Acceptance tests for #537: live game state in 3D, instancers fed by logic, terrain overlays and 3D lines

Written first, from issue #537 (its Scope, its Fields, five acceptance criteria, its Proof line and its Oracle line),
the parent #186 for what the sibling parts own, the design sections the issue links and those they lean on, and the base
commit, by a job that never saw an implementation; none existed, and no other worktree, branch or pull request was read.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). Lean: one file per criterion (criterion 4's GPU budget in a file of its own), each test carrying
its criterion's ID, and exactly the four planted twins the criteria name. The Oracle line's lane is
`tests/acceptance/537-oracle/`.

The job was asked to write against `cbd5e4f98` (origin/main then); the worktree it was given stood at `db8d9ed76`
("Merge pull request #2290"), whose only changes since `cbd5e4f98` are the app's list rows, the hub's doing line and
two other suites (none in deep-show, deep-gpu-layer, scene3d, the logic module or the design sections read here). The
tests were written and run there.

## What was read

- The issue (`gh issue view 537`) and its parent #186 (#535 merged; #536 hex grids, #538 text and cells, #960 icons and
  bars belong to the siblings, so the `icon` band, the 3D `bar` and `seen` aren't tested here).
- `docs/canvas-primitives.md`: Units and axes; Instance `instance@1` and Instance `instance@1`: logic columns; Builder
  plate: terrain and Builder plate: terrain overlays; Marks in 3D and Marks in 3D: lines; Mark set: logic columns; Array
  and table: column view; Logic `logic@1`; Selection; the mesh asset's node walk (Asset: a glTF's scene).
- `docs/technical-design.md`: Modeling steps; The canvas core; Mark set, scale and encode; Dogfooding.
- The Oracle page `doneright/oracles/issues/537.md` and the vendor copy of the one upstream file it pins (README of the
  oracle lane).
- At the base, only for surfaces and conventions: `AGENTS.md`; `scripts/proof-change.mjs` (`criterionId`),
  `scripts/lanes.mjs` (`alone`, `timed`), `scripts/benchmark.mjs` (`judgeLimit`); `crates/deep-show` (`run`'s calls and
  the planted match in `main.rs`, `hub.rs`'s `deep_show`, `logic.rs`, `frames.rs`' `eval`, `time.rs`, `geometry.rs`,
  `scene3d.rs`); `crates/deep-gpu-layer` (`view3d.rs`: `frame_order`, `seeks`, `viewer`, `clicks`, `evaluate`,
  `counts` with `element_uploads`, `segments` and `meshes_built`, `timings`, `capture` and `targets`; `main.rs`'s
  `--planted`); `crates/deep-canvas-scene3d` (`PLANTED`, `spec.rs`'s `mark.line@1`, `cut.rs`'s instancer columns,
  `terrain.rs`, `gltf.rs` and `scene.rs`'s glTF scene import, material `base_color: {role}`, `look.rs`'s roles);
  `crates/deep-canvas/src/camera.rs` (`screen_basis`); the suites `535/` (logic programs, `offsets`, the taste call),
  `544/wat` (the assembler), `2014/` and `2014-oracle/` (the terrain plate, the oracle layout), `1921/`, `424/`, `484/`,
  `1297/` (view3d documents, looks, IDs, uploads, timings), `1700/` (the perf lane's rule), `2013/` (`from: distribute`).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and this suite's own
programs.

## Run them

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  npx vitest run --root tests/acceptance/537 --testTimeout=600000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/537
```

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, and copies it to a temporary folder:
`cargo build --locked --bin deep-gpu` (every file) and `cargo build --locked --bin deep-show` (`ac1`, `ac2`, `ac3`), and
#544's assembler (`tests/acceptance/544/wat`, read only) into `target/acceptance-537-wat/`. Every test passes its own
timeout (an hour; the budget two). Folders are temporary and deleted; only `ac5-taste.test.ts` writes outside them, its
pictures to `docs/evidence/537/`. Node built-ins, vitest, `../467/helpers.ts`'s PNG reader and writers and
`scripts/benchmark.mjs`'s `judgeLimit` and `fingerprint` (imported, never copied); no process is started but `cargo`,
the assembler, `deep-show` and `deep-gpu`, each waited for, none stopped by name or port.

**The lanes lines.** The implementer adds these to `scripts/lanes.mjs` (this README is the instruction):

```js
// #537's files build deep-gpu (most also deep-show, and #544's assembler), run logic programs and draw on the GPU;
// ac4-budget times 2,000 units at 1080p against the showpiece class's GPU budget.
alone.push('tests/acceptance/537/', 'tests/acceptance/537-oracle/');
timed.push('tests/acceptance/537/ac4-budget.test.ts');
```

Gates: off macOS (the GPU layer's Metal device), or when `view3d` answers `unsupported_platform` or `gpu_unavailable`, a
test that draws fails `INCONCLUSIVE:`; an assembler that doesn't build fails `BLOCKED:`; neither is a pass.
`ac4-budget.test.ts` is a timing: by the perf lane's rule it is INCONCLUSIVE off a reference Mac or under load (the load
above the cores at a run's start or end), never a pass. Criterion 5 is `INCONCLUSIVE:` until its taste call is
recorded. No other reading depends on load, timing or a device.

## The surface under test

The issue names fields, element addresses, a selection, seeds, frames seeked and played, pixel hashes, uploads, an issue,
a budget and planted programs, but no call. Two binaries at the base each hold part of what it needs, so the readings
split between them:

- **`deep-gpu run`'s `view3d`** (#378) for everything a frame shows: it draws a scene on the GPU frame by frame at a
  virtual 60 fps, applies seeks inside one session (`seeks`), clicks through the object-ID target (`clicks`, `picks`),
  holds viewer-only selection (`viewer`), reports evaluated paths (`evaluate`), uploads (`counts`'s `element_uploads`),
  mesh builds (`meshes_built`), line segments (`segments`) and GPU time (`timings`). It runs no logic at the base, so it
  gains the logic module, as it gained the physics module for #1921. `deep-show` draws 3D only as one GPU frame at the
  last time of a play (`determinism`'s 3D side, render-back), with no uploads, picks, selection or GPU times.
- **`deep-show run`** for what the document check says and the issues a frame raises: `deep_show` refuses or presents
  a revision (#393), `eval` returns the frame's `column.out_of_range` issues (#535), and `geometry` returns a built
  item's content key and mesh at a time (#420). These are the agent's own surfaces, and `deep-show` already runs the
  logic module.

**Every field, reply field and planted name below that the issue or the design doesn't give is this job's choice, the
smallest the criteria need; the implementer builds exactly these, or a dispute goes to a blind redraft.**

### Documents

A `view3d` document is a scene as a session holds it (#378's form: an `id`, one writer layer `main`, `seed: 537`,
camera `cam`, `transport: {span: "12s", frame_rate: [60, 1]}`, `requires.modules: {scene3d, logic}`), written to a file;
`deep_show` gets the same items in the agent's form (no `id`, no layers), each program listed in `assets` with its
license. Programs (and the tank's glTF) are in `view3d`'s `assets` map `{sha256: path}`, as glTFs are at the base, and in
`deep-show`'s evidence store. The look is #424's plain physical look (tone map none, exposure scale 1) with three more
roles: `fog` (#c9ced8), `dim` (#3d4b6e) and `sand` (#e6d3a3).

| Field | As written | Source |
|---|---|---|
| A logic item | `{kind: "logic@1", params: {program: <sha256>, step_rate: 60, reads: [], writes: {<name>: {type, count}}}}` | Logic `logic@1`; #535's form |
| Instancer columns from logic | `params.live: {array: "<logic>.live", as: "bool"}`, `params.gen: {…, as: "u32"}`, `params.pos: {array: "<logic>.pos", as: "f32"}` (a vec3 array read whole), `params.yaw: {…, as: "f32"}` | the issue's Fields |
| Distribute | `params.from: {distribute: {on, mode: "poisson", min_distance, seed}}` | #2013's form |
| Part poses | `params.parts: {turret: {yaw: <column>}, barrel: {pitch: <column>}}`, the instancer's `of` a `mesh.asset@1 {sha256, node: {scene: 0}}` (the glTF's whole scene) | the issue's Scope |
| Overlays | `params.overlays: [{grid: "<logic>.<name>", size: [128, 128], roles: ["fog", "dim", "none"], opacity: 1}]` on the `plate@1` beside `params.terrain`; `origin` and `cell` left to their defaults | the issue's Fields |
| Line points from logic | `params.points: {array: "laser.points", rows: "all"}` on `mark.line@1` with `mode: "segments"`, `width: 4` (px), `cap: "butt"`, `fog: false`, `paint: {fill: {role: "sand"}}` | Marks in 3D: lines |
| Prototypes | `visible: false`, drawn only as elements (#2013's convention) | |

### `view3d`: what this suite adds

| Field | Meaning |
|---|---|
| Logic | A scene's `logic@1` items run in the call: each program read from `assets` by its SHA-256, stepped on the one clock over the frames the call draws, each frame at t reading the arrays as the last step at or before t left them (Logic `logic@1`), so frame n at 60 fps shows step n. A seek (`from`, `seeks`) is a seek: the frame it opens reads the arrays at its own t, and every row is uploaded again (Array and table: column view). |
| `evaluate: ["items/<instancer>/elements"]` | Per frame, one entry per live slot in slot order: `{id: "<instancer>#<slot>.<gen>", slot, gen, seed}`, `seed` the element's u64 seed (decimal text, or a number) |
| `evaluate: ["items/<instancer>/nodes/<node>"]` | Per frame, one entry per slot in slot order: that glTF node's world position `[x, y, z]` in m as the frame drew the element, null for a slot not live |
| `selection` on every frame | The session's selection as that frame presents it: the call's `selection`, then `viewer` entries' (base fields), less what Selection's rules drop: an element of an instancer fed by logic leaves it at the first frame its slot's gen or live changes |
| Element IDs | A logic-fed instancer's element is `<instancer>#<slot>.<gen>` in `picks`, in the object-ID target (`ids`) and in `clicks` |
| `counts`: `element_uploads` | For an instancer fed by logic, the slots whose records the frame wrote (numbers; `<slot>.<gen>` text is read too) |
| `counts`: `row_uploads` | `{"<item>": [row]}`: for an item other than an instancer whose column reads a logic array (here the line), the array's rows the frame wrote to the GPU |
| `counts`: `segments` | Beside mesh-edge lines (base), each line whose points read a logic array: one entry per segment in order, `[[x, y, z], [x, y, z]]` in world m as the frame uploaded it, `null` for a hidden one |
| `--planted <name>` | The four names below |

`final` (an 8-bit PNG named by its SHA-256), `ids` with `picks`, `pixel_hash`, `clicks`, `seeks`, `from`, `viewer`,
`meshes_built`, `indirect_draws`, `gpu_ms` and `counts`/`timings`/`capture`/`targets` stand as the base has them.

### `deep-show`: what this suite reads

- `deep_show` presents the documents above or refuses them at check with error issues (`ids`, `path` and their own
  fields), as for any revision (#393).
- `eval` at t (#387) returns, among its `issues`, the `column.out_of_range` a line whose points read a logic array
  raises at a row's first step out of range, in #535's flattened form `{code, severity, ids, path, reader | set, column,
  row, value, step}`, the line named by any of its fields.
- `geometry` at t (#420) returns the plate's row `{id, key, positions, indices}`.

### Planted twins

Each is a value of `deep-gpu run --planted`, reachable only there, and changes nothing else; `twins.json` maps each
criterion to its twin. At the base an unknown name is `{"ok": false, "code": "bad_input"}`.

| Name | Criterion | The wrong program |
|---|---|---|
| `instancer_addresses_by_slot` | 1 | an instancer fed by logic names its elements `<instancer>#<slot>` (picks, IDs, selection), dropping the generation |
| `overlay_keeps_grid_on_seek` | 2 | after a seek the overlay keeps the grid it uploaded for the frame drawn before the seek, uploading only rows later steps change |
| `line_reads_previous_step` | 3 | a line whose points read a logic array draws the array as the step before the frame's left it |
| `part_pose_in_world_space` | 4 | a part's pose turns the node about the world's axes through its pivot, instead of its parent node's |

## Programs

`programs.ts` holds the logic programs as WebAssembly text, assembled by #544's assembler. Each exports `memory`,
`init`, `step`, `reads_at` (0) and `writes_at` (4096), and lays its write region out as the issue's brief says: arrays
in declaration order on 8-byte boundaries, a bool or an i32 4 bytes, an f64 8, a vec2 16, a vec3 24 (three f64), a quat
32 (#535's `offsets` lacked vec3 and quat; this suite's has them). Each writes every element at every step.

- `slots` (`brains`): `live` bool × 16, `gen` i32 × 16, `pos` vec3 × 16. Slot i at (−6 + 4 (i mod 4), 0, −6 + 4 ⌊i ÷ 4⌋),
  live with gen 1; slot 3 not live at steps 50 to 59 and gen 2 from step 60. The seeds' reference: slot 3 gen 2 from step 0.
- `fog` (`fogger`): `fog` i32 × 16,384, index 128 cz + cx: (cx + cz + k) mod 3 before step 600 (every cell changes every
  step), and from step 600 2 in the square of cells 60 to 68 each way (centred on (64, 64)) and 0 elsewhere.
- `grids`: `fog`, `a`, `b` i32 × 16,384 each, all zero (the overlay refusal).
- `laser`: `points` vec3 × 64. Segment s joins points 2s and 2s + 1: column ⌊s ÷ 8⌋, row s mod 8, from (−16 + 8 col, 0,
  −14 + 4 row) 4 m along +x, every point 0.0625 min(k, 99) m further along +x; segment 5 (elements 10 and 11) 1.5 m
  along +z from step 100; element 7's x NaN at steps 120 to 129.
- `army-1000`: `live`, `gen`, `pos`, `yaw`, `turret`, `barrel` (f64 in degrees) × 1,000 on a 40 × 25 grid 10 m apart:
  yaw (37 i) mod 360, turret ((13 i + 3 kk) mod 360), barrel 2 ((i + kk) mod 8) − 5, kk = min(k, 199); tank 417's turret
  45° more from step 210. `army-2000`: 2,000 on a 50 × 40 grid 8 m apart, kk = k (everything moves at every step).

## Fixtures

`fixtures.ts`. Cameras straight above are orthographic, `view_width` m across the frame; looking straight down the core's
screen basis keeps +X right, so +Z is down (`deep_canvas::camera::screen_basis`).

- **The units** (400 × 400 px, 20 m across): the 1.6 × 1 × 1.6 m box `unit` in an unlit color, instanced by `units`.
- **The fog** (2,048 × 2,048 px, 128 m across: 16 px a metre): `ground`, a `plate@1` whose `terrain` is `{height: "0",
  size: [128, 128], spacing: 1, tile: 64, lod_levels: 1}` in `soil` (a lit green), its overlay from `fogger.fog`, one
  sun casting no shadow, a black sky. Its references: the same plate with no overlay in `soil`, and in `fogged`, whose
  `base_color` is `{role: "fog"}`.
- **The line** (800 × 800 px, 40 m across: 20 px a metre): `links`.
- **The tanks** (480 × 320 px from above at an angle; the budget's 1,920 × 1,080 in the showpiece class): the tank is a
  JSON glTF of one scene, nodes `hull` (a root at (0, 0.5, 0), a 3 × 1 × 5 m box), `turret` (at (0, 0.75, −0.375) on the
  hull, 1.5 × 0.5 × 1.5 m), `barrel` (at (0, 0.125, 0.75) on the turret, 0.25 × 0.25 m from 0 to 2.5 m along +Z) and
  `tip` (an empty node at (0, 0, 2.5) on the barrel), no rotations or scales, every number exact in f32, a material each.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#537.` + the first 8 hex digits of the SHA-256 of each criterion's text, trimmed,
white space collapsed, from the live issue. Each test's name starts with `AC<n> #537.<id>`; each file quotes its
criterion in full. Test count: 4 + 5 + 4 + 3 + 1 + 1 = 18.

| ID | File (tests) | What it asserts, and the wrong programs it fails |
|---|---|---|
| AC1 `#537.fdb98a26` | `ac1-slots.test.ts` (4) | `view3d` of the units, steps 0 to 69: at every step the object-ID target at each slot's centre names `units#<i>.1`, slot 3 `units#3.1` to step 49, no unit at 50 to 59, `units#3.2` from 60, and `items/units/elements` holds exactly the live slots. Seeds: 16 distinct at step 0; `units#3.2`'s ≠ `units#3.1`'s, = `units#3.2`'s in a run where slot 3 holds gen 2 from step 0, ≠ that run's at document seed 538. A click on slot 3 at step 49 picks `units#3.1`; selected (viewer entry) and seeked to step 60, the selection holds it at 49 and nothing at 60. `instancer_addresses_by_slot`: the click picks `units#3`, which the selection still holds at step 60, and the judge fails naming `units#3`. `deep_show` refuses the instancer with array columns and `from: distribute` with an error (not `unknown_field`) naming `units`, `from` (or `distribute`) and an array column; without `from` it is presented. Fails: slot-only IDs, a reused ID, a seed by slot or by step, a selection kept or moved to the next occupant, a check that takes both or refuses every logic instancer |
| AC2 `#537.f46857ff` | `ac2-fog.test.ts` (5) | Played to step 600 at 2,048 px: at all 16,384 cell centres the frame is within 1 code value of the reference (the soil frame inside the square, the fogged frame outside), and at 72 pixels 0.1 m either side of the square's four edges, each side within 1 code value of its own reference. `meshes_built` is 0 at steps 1 to 600 (each changes the grid), and `deep_show`'s `geometry` of `ground` at steps 0, 30, … 600 has one key and one mesh. Seeked from step 10 to 600, the frame shows the fog role's color at cell (0, 0) and the plate's own cover at (64, 64) (so a frame with no overlay can't pass), and its pixel hash is the played one's. `overlay_keeps_grid_on_seek`: the seek against play fails naming cell (0, 0), the first cell that differs. A plate with three overlays is refused with an error (not `unknown_field`) naming `ground` and `overlays`; with two it is presented. Fails: a filtered or offset grid, a tint over the wrong cells, a status color, a cover replaced instead of tinted under the light, a rebuild per step, a stale grid after a seek, a third overlay taken |
| AC3 `#537.04600c21` | `ac3-lines.test.ts` (4) | Played (steps 0 to 130) and seeked (95, 90, … 0): at the 20 sampled steps every segment's reported ends, projected, lie within 0.5 px of the array's values projected, each segment is drawn at its midpoint, and the two pixel hashes are equal. Step 100 uploads rows 10 and 11 alone (`row_uploads`). Step 120: segment 3 reported null and not drawn, the other 31 at their values; `eval` at step 120 raises `column.out_of_range` naming the line, row 7 and step 120, and at step 119 none. `line_reads_previous_step`: step 100's judge fails naming segment 5. Fails: points a step late, a seek that draws other pixels, an upload of every row, a NaN that hides more or less than segment 3 or raises nothing |
| AC4 `#537.3f91633c` | `ac4-tanks.test.ts` (3) | Played (0 to 190) and seeked (190, 180, … 0): at the 20 sampled steps every tank's `tip` node lies within 1e-4 m of `tipAt`, the f64 reference. Step 210, which turns tank 417's turret alone, uploads slot 417 alone. `part_pose_in_world_space`: step 10's tips fail, naming a unit `tanks#<i>.1`. Fails: a pose in world space or about the wrong axis or sign, parts posed in another order, a tip off by f32 error past 1e-4 m, uploads of every slot |
| AC4 `#537.3f91633c` | `ac4-budget.test.ts` (1, timed) | 2,000 units with 3 parts, showpiece class, 1080p: a warm-up shows indirect draws of `tanks` in at least 3 batches and a GPU time on every frame; then the perf lane's rule on five runs, each the median `gpu_ms` of frames 10 to 119, against 10 ms |
| AC5 `#537.7f9c9403` | `ac5-taste.test.ts` (1) | The check run (below) writes the six pictures and prints their SHA-256s, then reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture |

## The taste call

`ac5-taste.test.ts` is the check run. It draws the criteria's own fixtures through `view3d` and takes each picture from
the frame's final target (the PNG the canvas wrote), re-encoded so the same pixels always give the same bytes, into
`docs/evidence/537/`:

- `slot3-live-gen1.png`, `slot3-off.png`, `slot3-live-gen2.png`: the units at steps 49, 55 and 60;
- `fog-overlay.png`: the fog at step 600, 1,024 px;
- `line-segments.png`: the line at step 50;
- `slot-and-fog.apng`: the recording, the units from step 45 to 65 then the fog from step 590 to 600, 400 px, 12 frames a
  second.

Each SHA-256 is printed. `tests/acceptance/537/TASTE.json`, written by whoever records the call after the pictures are
attached to the PR and shown in the session: `{"issue": 537, "criterion": "#537.7f9c9403", "verdict": "looks_right" |
"looks_wrong", "who", "when": ISO 8601, "screenshots": {<each of the six names>: sha256}, "note"?}`. A call stands while
this run's six hashes equal the ones it names. No agent records a call it wasn't given; this job wrote none.

## Readings where the issue leaves a choice

- **The surfaces** (above): frames through `view3d`, which gains the logic module; the check, frame issues and the
  plate's key through `deep-show`.
- **"Draws units#3.1"** is the stable ID the object-ID pass writes at the slot's centre (Instance `instance@1`: "the
  object-ID pass writes each element's stable ID"), with the element list beside it. **"Nothing in slot 3"**: no unit's ID
  there.
- **"Whose seed is hash(seed, 3, 2), not gen 1's"**: the design names no hash function, so the seed is read as a function
  of (the document's seed, slot, gen) alone: equal to the seed of `units#3.2` in a run whose slot 3 holds gen 2 from step
  0, unequal to `units#3.1`'s and to `units#3.2`'s under another document seed; the 16 seeds at step 0 differ.
- **When the selection drops.** The design drops a logic element "at the first frame its slot's gen or live changes".
  Played frame by frame, a selection made at step 49 would drop at step 50, when slot 3 stops being live. The criterion
  has it held into step 60's first frame, so the suite selects at step 49 and seeks to step 60: that frame is the first
  one presented after the gen changed. Under the planted slot-only addressing the same selection, `units#3`, lands on
  the new unit. **"Fails, naming the element"**: the judge's failure names what the selection holds.
- **"Naming both"** (AC1) is one error naming the instancer and, in its own fields, `from` (or `distribute`) and one of
  its array columns (or arrays); the base's `unknown_field` doesn't count. **"A third overlay is refused"**: an error
  naming `ground` and `overlays`, `unknown_field` excepted; two overlays are presented.
- **Overlays' place.** `params.overlays` on the plate, beside `params.terrain` ("on a terrain plate"). The grid's rows run
  along z: cell (cx, cz) is index 128 cz + cx, at x from −64 + cx m (the default origin, the plate's corner, for a plate
  centred on its origin as #2014 builds it).
- **The reference frame** (AC2). `cover` isn't built at the base and isn't this issue's, so "the same plate whose cover
  outside that square is the fog role's color" is built from two frames of the same plate, camera, sun and look with no
  overlay: the plate's own material inside the square, and outside it a material whose `base_color` is `{role: "fog"}`.
  With opacity 1 a fog cell's base color is the role's, lit as the plate is lit ("light and shadow still fall on it").
  **"Within 1 code value"**: every channel of the 8-bit final target. **"Pixels 0.1 m either side of the edge"**: the
  pixel holding the ground point 0.1 m out and 0.1 m in, at each of the nine cells along each of the four edges; at 16 px
  a metre neither touches the edge's pixel. **"Unmixed"**: each within 1 code value of its own side's reference.
- **"Content key and mesh the same across 600 steps"**: `geometry`'s `key` and its positions and indices at 21 steps from
  0 to 600, and no mesh built by `view3d` at steps 1 to 600.
- **"Seeking to t and playing to t"**: step 600 drawn by a session that played every step from 0, and by one that drew
  steps 0 to 10 and then sought to step 600, by `pixel_hash`. **"The first cell that differs"**: row by row from cell
  (0, 0), the first whose centre's pixel differs; for step 10's grid against step 600's that is cell (0, 0).
- **"Ends at the array's values at t, projected within 0.5 px"**: the segments the frame uploaded (`segments`), each end
  projected through the camera against the array's value projected; that each is drawn, its midpoint's pixel against the
  empty sky's (40 code values apart). **"Seeked or played"**: one session played from step 0, another visiting the 20
  steps backwards, each a seek. **"Only that row range uploads"**: `row_uploads.links` is exactly rows 10 and 11.
- **`rows: [from, to]`** isn't read: the line writes `rows: "all"`, and no criterion reads a range. Were it read, this job
  would take `to` as inclusive, as the column view's `range: [min, max]` is.
- **A NaN at element 7** is its x alone. **"Hides segment 3 alone"**: its entry null and its midpoint undrawn, the other
  31 drawn at their values. **"Naming the line, row 7 and the step"**: the issue's own fields name `links`, `row` is 7,
  `step` 120.
- **Part poses.** A part's pose turns its node in its parent's space at the node's rest translation: yaw about +Y, pitch
  about +X, right-handed, in degrees, as Units and axes turns Euler angles (R = Rz·Ry·Rx), so a positive pitch turns a
  barrel along +Z toward −Y. The fixture's nodes carry no rest rotation, so whether a pose goes before or after it
  doesn't arise. An element is its `pos`, turned by its `yaw` about +Y (world × TRS). The barrel tip is the `tip` node,
  read by `evaluate`.
- **The turret and barrel default** isn't tested: no criterion names it, and the fixture writes `parts` in full. This
  job reads it as a node named `turret` posed by yaw and one named `barrel` by pitch, each from a column the document
  still names.
- **"Uploads one slot"**: `element_uploads.tanks` at step 210 is exactly `[417]`.
- **The budget.** "Within the showpiece class's 10 ms of GPU at 1080p": the document in `budget: {class: showpiece}`,
  drawn at 1,920 × 1,080, each run's median `gpu_ms` over frames 10 to 119, judged by `scripts/benchmark.mjs`'s
  `judgeLimit` (five runs after a warm-up; INCONCLUSIVE off a reference Mac or under load).
- **Roles** `fog` and `dim` come from the look, and `none` leaves the cover as it is (Builder plate: terrain overlays);
  none is a status color.

## Not tested, because no criterion reaches it here

`hidden`, `rot`, `scale`, `proto` and `attrs` from logic; `seen`, the `icon` band and the 3D `bar` (#960's); a written
`ids` column beside logic columns; terrain overlays' `origin`, `cell`, opacity below 1, the second overlay's order and
`terrain.overlay_range`; overlay row uploads; a line's `rows: [from, to]`; part `rot` columns and the turret/barrel
default; a picked element's input entry keeping its gen; the 100,000-slot cap. They are follow-ups for the
implementer's own tests.

## What the implementer adds outside this folder

- The lanes lines above.
- In `deep-gpu`'s `view3d`: the logic module, `evaluate`'s `elements` and `nodes`, `selection` on every frame,
  `row_uploads`, `segments` for logic lines, slots in `element_uploads`, and the four `--planted` names.
- In `deep-show`: nothing beyond the behavior itself (the check's refusals, `eval`'s issue for a line, `geometry` of a
  plate with overlays).

`BASE-FAILURE.txt` is the run at the base.
