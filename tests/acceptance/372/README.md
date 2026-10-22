# Acceptance tests for #372: camera@1 in the core, the camera you move, and a document's fixed frame in any panel

Written first, from issue #372 (its 3 acceptance criteria, scope, fields and proof), the design sections it
links (`docs/canvas-primitives.md`: Scope and input classes, lines 59–66; Units and axes, lines 28–36;
Document envelope, lines 291–319, for `aspect`, `camera` and the letterbox and extend rule; Camera `camera@1`
with its lens, framing and goto and edge pan sections, lines 4371–4456; Control, line 5459, for a control's
`class`; `docs/technical-design.md`: Rules every primitive follows, lines 855–876, Render-back, line 1491,
Dogfooding, line 2508) and base commit `554bebb`, by a job that never saw an implementation. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them (a root with no config of its own uses Vitest's defaults):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/372
```

Each file first runs `cargo build --locked -p deep-canvas --bin deep-canvas` (cached after the first file)
and fails each of its tests when that build fails. The suite uses only node built-ins and vitest, and
type-checks under the root `tsconfig.json`'s strict options with `allowImportingTsExtensions` (checked
against a config outside the repo that extends the root one). A run leaves Vitest's cache in
`tests/acceptance/372/node_modules/.vite`; delete it. `render` writes its frames under the OS temp folder.
`BASE-FAILURE.txt` is the run at the base: every test fails there because `deep-canvas` has no `session`
or `render` subcommand and exits 2 with its usage line.

## The surface under test

The issue names a camera, input classes and a frame in a panel, but no code API. #389 made
`crates/deep-canvas` with the binary `deep-canvas` (at `target/debug/deep-canvas`), driven by JSON lines;
these tests add the two smallest subcommands the criteria need to that binary and reuse #389's `canonical`
for the document's hash. Nothing else is read. The protocol is #389's: one JSON object per stdin line, exactly
one JSON object per line out, in order, exit 0; a run that writes fewer lines than it read, or exits non-zero,
fails every test that drove it. A session's batch is up to 100 lines; a render's is one line.

### `session`

Input `{"doc": Document, "viewport": [w, h], "inputs": [Input]}`. The document is the session's saved
document; `viewport` is the view's size in px (the tests always pass the document's `size`, so no letterbox
or extend applies). The inputs apply in order, on the document's own camera (the item the envelope's `camera`
names), with no shot active. Output:

```
{"ok": true, "hash": string, "doc": Document, "track": [Entry], "start": State, "trace": [State]}
```

- `hash`: the revision hash of the session's document after all the inputs: the SHA-256 of its canonical
  bytes, exactly as `canonical` gives it (#389).
- `doc`: the session's document after all the inputs, the form a save writes.
- `track`: the document's input track after all the inputs; the fixtures start with none, so it is `[]` at
  the start. A `document`-class control input appends an entry `{"control": ID, "value": JSON, …}` (other
  fields, such as a time, are allowed and not read). View and viewer inputs never append one.
- `start`: the session state before any input; `trace`: the session state after each input, one per input.
- State: `{"camera": Camera, "view": {control ID → value}, "hover": ID | null}`.
  - `view` holds every `view`-class control of the document, at its `default` until an input sets it.
  - `hover` is the ID of the drawn, pickable item under the last hover's pointer (picking: the nearest one
    whose drawn shape covers the pointer; an item a view control hides doesn't count), or null.
  - Camera: `{"position": [x, y, z], "target": [x, y, z], "azimuth": deg, "elevation": deg, "distance": m,
    "fov": deg, "view_width": m | u, "zoom": number}`, the evaluated camera, f64, with the user's offsets
    applied. `position` is the eye; `target` the point the view centres on (with `shift` [0, 0]);
    `azimuth` and `elevation` the orbit angles of the eye about the target, in the convention the document's
    `orbit` uses (a camera authored with `orbit {azimuth: 30}` starts at `azimuth` 30); `fov` the field of view
    across the wider side; `view_width` the width of the view in a 2D (orthographic) document, in u; `zoom` the
    user's zoom factor, 1 at the start. The tests read `position`, `target`, `azimuth`, `elevation` and `fov` in
    3D and `target` and `view_width` in 2D; the other fields must be present and numbers.

Inputs (pointer coordinates in viewport px, origin top left, y down):

| Input | Class | Meaning |
|---|---|---|
| `{"op": "drag", "at": [x, y], "delta": [dx, dy]}` | viewer | a one-button drag from `at` by `delta` px: in 3D, `dx` turns and `dy` tilts by `user.turn` and `user.tilt` deg per px (about the target, or about the eye with `user.pivot: eye`); in 2D, a plain drag pans |
| `{"op": "pinch", "at": [x, y], "scale": s}` | viewer | a pinch about the pointer `at` that multiplies the zoom by `s` (s > 1 zooms in), clamped to `user.zoom` |
| `{"op": "hover", "at": [x, y]}` | viewer | the pointer rests at `at` |
| `{"op": "control", "control": ID, "value": JSON}` | the control's own `class` | an entry on a control the document declares under `controls` |

A document that fails its check is answered `{"ok": false, "code": …}`; the tests don't send one.

### `render`

Input `{"doc": Document, "panel": [w, h], "ground": [r, g, b], "out": path}`. Renders the document's still
frame (t = 0, no session input) into a panel of `w` × `h` px and writes it to `out` as raw RGBA8 (sRGB bytes,
row-major from the top-left, no header, exactly w × h × 4 bytes, every pixel opaque). `ground` is the look's
ground color as 8-bit sRGB, standing in for the look asset (as #389's `writer` stands in for the connection).
Output `{"ok": true, "width": w, "height": h}`.

In a panel whose shape differs from the document's `size`, the envelope's `aspect` applies (default
letterbox for films and 2D documents, extend for 3D scenes and figures): `letterbox` scales the frame to fit,
centred, with bars in the ground, at whole-pixel offsets (a split of an odd remainder puts the extra row in
either bar); `extend` scales it to fit and widens the camera's view along the panel's longer side, keeping the
frame's centre at the panel's centre and its field of view or view width across the frame at `size`. A panel of
the document's own shape is the render-back snapshot of that frame at that size.

### What the fixtures need from the build

- `camera@1` items with the issue's fields, read from `params`: `projection`, `target`, `position` or `orbit
  {azimuth, elevation, distance}`, `fov`, `view_width`, and `user {turn, tilt, pitch, zoom, zoom_rate, pivot,
  yaw, pan {bounds, margin}}`, each at the issue's default where left out. In a 2D document (`projection:
  orthographic`) `target` is `[x, y, 0]` in u, y down. The envelope's `camera` names the item; `aspect` and
  `controls` are envelope fields.
- `controls` entries as Control defines them (`kind`, `class`, `label`, `role`, `binds`, `range`, `default`).
  `view.json`'s `cutaway` (class view) binds `items/roof/visible`: its value is the roof's visibility in the
  view, so `false` cuts the roof away. `throttle` is class document and binds `data/throttle`.
- Two test kinds the binary registers, as #389 registered `test.slab`, drawn flat and unlit with their
  `fill` written as the exact sRGB bytes (edge pixels may blend; a pixel inside a shape by more than a pixel is
  exactly its fill), in item `order`:
  - `test.rect@1` (2D): `w: f32, u = 100`, `h: f32, u = 100`, `fill: [u8, u8, u8] = [255, 255, 255]`; an
    axis-aligned rectangle covering `[x, x + w) × [y, y + h)` from `at.pos [x, y, 0]` (its top-left corner).
  - `test.dot@1` (3D): `radius: f32, m = 0.1`, `fill: [u8, u8, u8] = [255, 255, 255]`; a disc centred on the
    projection of `at.pos`, of radius `radius × focal ÷ depth` px (focal the projection's focal length in px,
    depth the centre's distance along the view axis), nearer dots over farther ones.
- A 2D document's content bounds (for `user.pan.bounds: content`) are the union of its drawn items' bounds;
  the camera is not content.

## Fixtures

All under `fixtures/`, written by this job before any implementation ran; layer `main`, writer `agent-a`.

- `film.json`: a `film`, size 1920 × 1080, `aspect` left at its default (letterbox for films), a 2D camera
  `cam` (orthographic, target [960, 540, 0], view_width 1920: the frame), and `test.rect@1` items: a backdrop
  over the whole frame (40, 44, 52), a red block (480, 272) 640 × 360, a green block (1280, 640) 320 × 240, and a
  64 × 64 marker in each corner, each its own color. Every edge is a multiple of 8 u, so at the panel's scale of
  0.625 every edge falls on a whole pixel.
- `scene.json`: a 3D `scene`, size 1920 × 1080, `aspect: extend`, a perspective camera at position [0, 0, 10]
  looking at [0, 0, 0] (so up is +Y and right is +X) with fov 40 (across the wider side), and `test.dot@1`
  dots in the plane z = 0: `a` [0, 0], `b` [1.5, 1], `c` [−2, −1.25] (radius 0.2), corner dots `tl`, `tr`, `bl`,
  `br` at [±3.25, ±1.75] (radius 0.15), and `sky` [0, 3] and `floor` [0, −3] (radius 0.2). By this job's own
  projection (focal 960 ÷ tan 20° px at 1920 wide), the corner dots sit about 78 px inside the frame's top and
  bottom edges at 16:9, and `sky` and `floor` project to y ≈ −251 and 1331, outside the 16:9 frame; in the
  1200 × 1200 extended panel they land at y ≈ 105 and 1095, inside the bands a letterbox would fill.
- `view.json`: a 3D scene, orbit camera (target origin, azimuth 45, elevation 30, distance 10, fov 40), a `core`
  dot at the target and a `roof` dot above it; controls `cutaway` (toggle, class view, default true, binds
  `items/roof/visible`) and `throttle` (slider, class document, binds `data/throttle`).
- `eye.json`: a 3D scene whose camera sits at position [2.5, 1.5, 4] (exact in f32) looking at [0, 1.5, 0], fov
  40, `user {pivot: eye, zoom: [0.5, 4], turn 0.2, tilt 0.2, pitch [−80, 80]}`.
- `yaw.json`: a 3D orbit camera (azimuth 30, elevation 20, distance 8), `user {yaw: [−60, 60], turn 0.5}`.
- `pan2d.json`: a 2D `board`, size 1600 × 900, blocks at (200, 100) 800 × 400 and (1200, 600) 400 × 300 (content
  bounds x [200, 1600], y [100, 900]), camera target [800, 450, 0], view_width 1600, `user.pan {bounds: content,
  margin: 0.1}`, zoom [0.5, 4].
- `pinch2d.json`: the same board with `user.pan.bounds: none`.

## Criteria to tests

Each test's name starts with its ID. Where a criterion names a wrong program, a comment at the assertion that
catches it says so, and the assertion's message names what the criterion asks for. Every random run is seeded
(`SEEDS` in `helpers.ts`), so a failure replays; messages name the input index and the input.

| ID | Criterion (short) | Tests, and how a failure names it |
|---|---|---|
| AC1 | hover, a camera moved on a view and a view's cutaway never change the saved document's hash | `session.test.ts` AC1, twice. A fixed run on `view.json`: hover, four drags, the cutaway, a pinch, a document-class throttle entry, hover; the session's `hash` and the hash of its handed-back `doc` must equal `canonical`'s hash of the fixture ("a view or viewer input changed the document"); and so the run is not one that ignored its inputs: the hover resolves to `core`, the camera turned, the cutaway reads false in `view`, and the track holds exactly the throttle's entry. A seeded run of 100 sessions × 10 random hovers, drags, pinches and cutaway toggles (1,000 inputs): every hash equal, every track empty |
| AC2 | pivot eye: 1,000 drags and pinches keep the position bit for bit and the fov in its zoom range | `session.test.ts` AC2 pivot eye: every state's `position` is `Object.is` equal, component by component, to the start's, which is the authored [2.5, 1.5, 4] (an orbit or a dolly under pivot eye fails, naming the input); `fov` stays in [2·atan(tan 20° ÷ 4), 2·atan(tan 20° ÷ 0.5)] ≈ [10.40°, 72.10°] and reaches both ends; the aim moves |
| AC2 | yaw [−60, 60]: the azimuth never passes 60° either side of the shot's | `session.test.ts` AC2 yaw: 800 drags and 200 pinches; every azimuth within 60° (+1e-6) of the authored 30°, wrapped; both limits reached (> 59.9°) |
| AC2 | a 2D pan with content bounds keeps the view's centre inside the bounds widened by the margin after every drag | `session.test.ts` AC2 pan: 1,000 drags of up to ±500 px; after each, the target is inside x [60, 1740], y [20, 980] (+1e-6), naming the drag and the box; the target takes many places |
| AC2 | a pinch at the pointer keeps the content point under it within 0.5 px | `session.test.ts` AC2 pinch: 750 pinches and 250 drags; for each pinch, the content point under the pointer before it (target + (pointer − viewport centre) × view_width ÷ W) lands within 0.5 px of the pointer after it (a zoom about the centre moves it by tens of px); more than 100 pinches change the view width |
| AC2 | the document's input track and hash are unchanged after all of them | each AC2 run ends with the AC1 assertions: `hash` and the handed-back `doc`'s hash equal the fixture's, `track` is `[]` |
| AC3 | a 1920 × 1080 film in a 1200 × 1200 panel: a 1200 × 675 picture centred between bars in the look's ground, equal by pixel hash to a 1200 × 675 snapshot | `frame.test.ts` AC3 film: the top bar is 262 or 263 whole rows of the ground and the two bars 525 rows together (a stretched or cropped letterbox has none); corner markers, blocks and backdrop at their scaled places in the picture and in the snapshot; SHA-256 of the picture's rows equals the snapshot's |
| AC3 | a 3D document with extend in the same panel: kept items' projected centres where they are at 16:9 within 0.5 px after scaling, more view above and below, nothing of the frame cropped | `frame.test.ts` AC3 extend: renders at 1920 × 1080 and 1200 × 1200; for `a`, `b`, `c` and the four corner dots, the centroid of the dot's exact-fill pixels in the panel is within 0.5 px of 600 + (x₁₆ₓ₉ − 960) × 0.625, 600 + (y₁₆ₓ₉ − 540) × 0.625, and its pixel count is within 15% of the 16:9 count × 0.625² (a crop to fill, a stretch or a refit fails, naming the dot); `sky` and `floor` draw nothing at 16:9 and show in the panel above y 262.5 and below 937.5 |

## Readings where the issue and design leave a choice

- **The surface** is two subcommands on #389's binary, since the issue names no API. A session reports the
  state after every input so the "after every drag" and "every pinch" criteria are observable without a
  renderer; `render` writes raw pixels so the tests compute every hash, bar and centroid themselves.
- **The document's hash** is #389's revision hash; **the input track** is the session's `track`. A
  document-class control entry is sent once in AC1 so that "the track is unchanged" can't pass by a session
  that never records anything. The tests don't say whether such an entry changes the hash.
- **Hover** is observed through picking (`hover` names the item under the pointer), the issue's "a click
  resolves to the part under it"; **the cutaway** is a view-class toggle bound to the roof's visibility.
- **The shot's azimuth** is the authored `orbit.azimuth` (no shot is active), and `user.yaw` is measured from it.
- **The zoom range under pivot eye** is a magnification: zoom z gives tan(fov ÷ 2) = tan(fov₀ ÷ 2) ÷ z, so
  [0.5, 4] bounds the field of view between about 10.40° and 72.10° for the authored 40°. In 2D, z divides the
  view width.
- **The pan margin** is a fraction of the content bounds' own extent on each axis (0.1 × 1400 u and 0.1 × 800 u
  here), and the view's centre is the camera's target.
- **The pinch test runs with `pan.bounds: none`**, since a bound that stops a pan could also move the point
  under the pointer; the pan test sends drags only. Each holds its own clause of the criterion.
- **The look's ground** is passed to `render` as a color; the look asset isn't in this slice. Bars and the
  ground are compared byte for byte, opaque.
- **The letterbox's half row**: 1200 − 675 = 525 is odd, so the picture sits at row 262 or 263; anything else,
  or a picture that isn't whole rows, fails. "The same frame on one machine" is the same binary rendering the
  film into a 1200 × 675 panel.
- **Kept items** in the extend criterion are the dots the 16:9 frame shows, its corners among them; the scene
  has an explicit pose and no `fit`, since framing is per shot and the document has none. Their projected
  centres are measured from the pixels, not reported.
- **Picking, `camera.goto`, edge pan, the key pan verb, `yield`, isometric projection, lens and framing** are in
  the issue's scope or fields but in no criterion; these tests don't cover them.

## The Oracle lane

Whether any of the three criteria is also checked by other projects' tests pinned in the private
`doneright/oracles` repo (`oracles/issues/372.md`) can't be read by this job, and a linked test counts only
when run against our output (#136). That lane is **BLOCKED** here with one unblock ask: give the runner read
access to `DeepBuildAI/deepbuild` at branch `doneright`, path `doneright/oracles/issues/372.md`, and the
runner of #136. These tests are the local proof for every criterion; they don't stand in for that lane.

## A note on this draft's checks

Before the base run, the tests were run against a scratch reference model of this surface (a Node script
outside the repo, written from this README) to check the tests' own arithmetic: all 8 pass on it, and each of
these planted twins fails the test that names it: a session that writes the camera into the document (AC1 and
every AC2 hash check), a pan with no bounds, a turn with no yaw clamp, an eye that moves by 1e-12 m, a zoom about
the centre, an unclamped zoom, a letterbox that stretches, and an extend that crops to fill.
