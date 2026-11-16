# Acceptance tests for #506: insets and overlays: screens in a part's faces, second-camera and eye insets, projected insets, picture in picture and cards over 3D

Written first, from issue #506 (its Scope, its Fields block, its nine acceptance criteria, its Proof line "The terrain
heatmap, eye-inset parallax, view-overlay and card fixtures on one machine, with the planted frustum failing" and its
Depends on), the design sections it links and those they lean on, and base commit `ef869ad87` ("Merge pull request
#2321 …", main), by a job that never saw an implementation, a plan or anyone's notes for this issue. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The suite is lean: one file per criterion (two `it`s where a criterion has two legs that need their own runs), and the
planted wrong programs the issue names: the centred frustum (criterion 6), one core per kept state (criterion 7) and
the premultiplied sample (criterion 8). Every other criterion fails at the base on its own assertions (`BASE-FAILURE.txt`),
and a program that ignores its feature fails it, so no other plant is added.

**Not run against a binary.** The surfaces plainly don't exist at the base (no inset kind, no `overlay.view@1`, no
overlay drawn into a frame, no `overlays` reply, no `camera.framing` module), so no Rust was built; `BASE-FAILURE.txt`
says where each test fails there, read from the base's code. The type check passes. A scratch test (not kept) ran the
fixtures' own numbers through the references below; they are listed under Fixtures.

## What was read

- Issue #506, live (`gh issue view 506 --repo windoliver/deepbuild`).
- `docs/canvas-primitives.md`: Overlay, Overlay: clamped to the edge, Inset, Inset: projected (4585–4781); Camera
  `camera@1`, its lens and framing (4460–4524); Shot (4560); Material: mirror (4022); Light and the light policy
  (4088); Level of detail (5039); Control (5564); the status-color rules (72–76); the document envelope (296–317);
  Check input: loop kinds, `camera.framing` (8545–8601).
- `docs/technical-design.md`: the Inset and Camera and overlay rows (1355–1378); What done means: Who drafts it, Proven
  on the base (2147–2149); How we know version 0 works: Criteria to tests, Criteria in a checked shape, Wrong programs,
  the edit guard, Dogfooding, the share-of-pixels rule (2634–2682). `AGENTS.md`.
- At the base, only to find the surfaces: `crates/deep-gpu-layer/src/main.rs` (`--planted`, `Planted::parse`,
  `bad_input`, `refused`), `view3d.rs` (`parse`: the call's fields and targets, `assets`, `light_cut`, `clicks`; the
  reply: `pixel_hash`, `final`, `ids`, `picks`, `light_cut`; overlays painted only into a window),
  `crates/deep-canvas-scene3d/src/scene.rs` (`overlay.frame@1` placed at its anchor's projection, its circle and rect
  children; `overlay.text@1`), `builders.rs` (`display@1`: its `body` and `screen` parts, the screen 0.1 mm proud of
  half its 0.04 m depth), `spec.rs` (`display@1`'s `screen: inset ID`; `material@1`'s `mirror`, `transmission`,
  `unlit`), `crates/deep-canvas/src/document/check.rs` (an unknown kind is skipped with the notice `unknown_kind`),
  `crates/deep-canvas/src/scope.rs` (#504's Tab stops, `focus`, Return on a focused target), `crates/deep-show/src/kinds.rs`
  (`overlay.frame@1`'s and `image@1`'s params); `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs`
  (`twins.json`).
- For conventions and reused tools only: `tests/acceptance/462/`, `424/`, `504/`, `423/`, `449/`, `465/`, `428/`, and,
  read-only from its open branch, #1938's `README.md` and `helpers.ts` (how `camera.framing` is called: a claim's
  requirement judged by `deep-show run`'s `verdict`). No implementation code of #1938 was read.

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/506 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/506/tsconfig.json    # type-check
rm -rf tests/acceptance/506/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`: `cargo build --locked --bin deep-gpu`, and for criteria 4 and 5
also `cargo build --locked --bin deep-show --no-default-features --features full`, honoring `CARGO_TARGET_DIR`, with
`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0` and `NO_COLOR=1` unless set, Homebrew's rustup first on `PATH`, and
copies each binary into a temporary folder. Every `it` passes its own one-hour timeout. Each test writes into its own
temporary folder, deleted after it; processes are started by `spawnSync` and stopped only by their own timeout. The
taste test writes its pictures to `docs/evidence/506/`.

Gates: no cargo is `BLOCKED:` (a failed test, never a pass). Every pixel here is drawn on macOS's Metal device: off
macOS, or wherever a reply says `unsupported_platform`, a test fails with a message starting `INCONCLUSIVE:`. The one
test that reads no pixel (criterion 4's framing verdict) runs anywhere. `taste.test.ts` is INCONCLUSIVE until the
owner's call is recorded.

**The line the implementer adds outside this folder** (this job edits nothing else), in `scripts/lanes.mjs` beside the
other GPU suites, because these files build cargo binaries and draw on the Metal device:

```js
alone.push('tests/acceptance/506/');
```

## The surface under test

No new binary and no new subcommand: `deep-gpu run` (`{out, calls}` in, `{ok, replies}` out, #377) with its `view3d`
call (#378), and `deep-show run` (#393's scenarios) with #403's claims and `verdict`, #96's stored documents, #383's
scope on the virtual clock and #504's Tab stops. Times are whole flicks (705,600,000 a second); frame n at fps is
⌊n × flicks ÷ fps⌋; world places are metres, +Y up, rotations R = Rz·Ry·Rx in degrees; frame px from the frame's top
left corner, x right, y down, a pixel's centre at (i + 0.5, j + 0.5).

### Surfaces this job invents

The issue and the design name fields but not these shapes. **The implementer builds exactly these, or a dispute goes to
a blind redraft.**

1. **The kind `inset@1`**, an item: `{kind: "inset@1", parent?, at?, params: {face?, size, px_per_unit?, recess?,
   content? | view?, overflow?, project?}}`, the Fields block's names. Its texture is `size × px_per_unit` texels.
2. **`content` entries** are written inline: `content: {<entry ID>: {kind, order, params, role?}}`, each a 2D mark
   (`rect@1`, `image@1`) with its own params, in texels of the inset's texture, origin at its top left, y down. A face
   inset's u runs along the face's own +x and v down its +y (texel row 0 at the window's top). A projected inset cast
   `down` lays its texture over its box, the box centred on `at.pos` in x and z, `size[0]` along x and `size[1]` along
   z, texel (0, 0) at the box's (−x, −z) corner, u along +x and v along +z. An entry with `role: "data"` is the content
   holding data (Inset: projected, "an item with role data").
3. **`face`** as `ID#part` names a built part (`display@1`'s `screen`): the window is that part's face, centred on it,
   `size[0]` along the item's +x and `size[1]` along +y, facing the part's normal (+Z). As `ID#anchor` it names an item
   anchor (5).
4. **The projected inset's defaults**: `project: {}` is a projected inset with every field at its default (onto its
   parent, from down, depth auto, fade 0.5 m and 75°, shading auto, opacity 1); `fade.edge: 0` is a hard edge.
5. **Item anchors**: an item-level `anchors: {<name>: {pos: [m, m, m], rot: [deg, deg, deg]}}` in the item's own space.
   A face named by an anchor is centred on it, `size[0]` along its +x and `size[1]` along its +y, facing its +Z;
   `view.through: "ID#anchor"` names one the same way.
6. **The kind `overlay.view@1`**: `{camera, include: [collection], exclude?, size: [f32, f32], border: role}`, as Fields
   gives it. `size` is a share of the safe frame's width and height; with no `anchor` the rect sits in the safe frame's
   bottom-right corner, so `size: [0.5, 0.5]` is its bottom-right quarter. The rect's pixels are its camera's render at
   the rect's pixel size; its border draws within 2 px of the rect's edges. A collection in `include` may hold lights
   and the sky.
7. **Overlays draw into `view3d`'s final target** (`overlay.frame@1`, `overlay.view@1`): at the base an anchored frame
   paints only into a window.
8. **`view3d`'s `overlays: true`** adds to each frame `overlays: [{id, at: [x, y] | null}]`: each overlay anchored to an
   item's point, `at` the place its frame's top left corner draws (the point's projection plus `offset`), f64 px, or
   null while it's hidden.
9. **`view3d`'s `assets: {sha256 → path}`** (#423's) also holds the image files an inset's content or an overlay's frame
   names (`image@1`'s `asset`).
10. **A refusal at check** of a `view3d` document: the reply carries a `code` (not pinned), no `frames`, and names each
    item it's about somewhere in its JSON (its `reason`, a path, `ids`). Used for: nine projected insets in one view
    (all nine named), a view overlay inside another view (the inner one named), an eye inset that names a camera (the
    inset named).
11. **The card's close button** is a control in the envelope's `controls`: `close-card: {kind: "toggle", class: "view",
    label: "Close", role: "button", binds: ["items/card/visible"], default: true, handle: {item: "card-close"}}`, drawn
    by the frame's child `card-close` (a `rect@1`). It is a Tab stop as every control is (the scope's `focus` names
    `close-card`), and Return (the scope's name for Enter) on it while it has focus presses it, which hides the card.
12. **The card's image** is the frame's child `card-image`, `image@1 {asset: <sha256>, box, fit: "fill", alt}`; its bytes
    reach `view3d` through `assets` (9) and `deep-show` through the scenario's evidence store (`<2 hex>/<62 hex>`).
13. **`camera.framing` reads overlays**: as #1938 calls it, a claim's requirement `{kind: "camera.framing", keep:
    ["hero"]}` judged by `verdict`; it treats each `overlay.view@1`'s rect as an overlay to keep the kept items clear of
    (`overlay: avoid`, its default), and a failure is a camera.framing issue whose `ids` name the item.
14. **`deep-show run`'s `view`** renders the panel's 3D document with its overlays and its view-class control state.
15. **Planted programs**, each reached only by `deep-gpu run --planted <name>` (added to `Planted` in
    `crates/deep-gpu-layer/src/main.rs`):

| Name | Criterion | The wrong program |
|---|---|---|
| `eye_inset_centred_frustum` | 6 `#506.0c1bce3a` | an eye inset renders from the same eye through a frustum centred on the eye's line to the window's centre, symmetric, its image mapped onto the face's corners |
| `one_backdrop_per_frame` | 7 `#506.1bab76b5` | a view overlay's (and view inset's) see-through parts read the main view's backdrop from the same frame |
| `one_mirror_per_frame` | 7 | a view overlay's mirror parts read the main view's mirror pass from the same frame |
| `one_light_cut_per_frame` | 7 | a view overlay is shaded with the main view's light cut from the same frame |
| `inset_premultiplied_as_straight` | 8 `#506.2b4f3d4f` | an inset's premultiplied render is sampled as straight alpha (no conversion), so its color is c·a where c is meant |

`twins.json` maps each criterion to these names (empty for the criteria with none). Existing surfaces used as they
stand: `view3d`'s `size`, `fps`, `from`, `frames`, `capture`, `targets: ["final", "ids"]`, `picks`, `light_cut: true`
(`{shaded: [{light}], left_out}`, #428's reading), the envelope's `assemblies` and #504's take-apart follow channel,
`display@1`, `material@1` (`unlit`, `mirror`, `transmission`), `plate@1`, `ball@1`, `mesh.asset@1`, `light.point@1`,
`light.sun@1`, `sky@1`, `overlay.frame@1 {frame, anchor: {item, point}, offset}`, `frame@1`, `rect@1`, `text@1`,
`image@1`, the scope's `focus`, Tab and Return, and #1938's `verdict` row.

## Fixtures (helpers.ts)

Every document is a whole session document (one writer layer `main`, `seed: 506`, `requires.modules` scene3d, marks2d
and effects, budget class showpiece). The look is #424's plain physical look (tone map none at the exposure whose scale
is 1, so the final target is the sRGB code of the linear target) with this suite's roles: `glow` #28c85a, `beacon`
#2c8fd6, `tint` #f59a3c, `card` #f4ecd8, and the heatmap's `heat-0` to `heat-7` #2b1b5e, #2c8fd6, #33c3b0, #8fd64a,
#f2e34c, #f59a3c, #ff3cc8, #9fe8ff, each at least 0.12 OKLab from every status color. No text item holds a number.

- **The masked screen** (AC1, AC9): a `display@1` (0.8 × 0.5 m, bezel 0.02 m, unlit white) at (0, 1.2, 0), turning about
  +Y from −20° to 20° over 4 s, in assembly `stage` (apart (0, 0.5, 0.4) m) over a stand in `base`; the take-apart
  (#504's follow, 0.5 s linear) moves it apart from 1 s to 1.5 s and back from 3 s to 3.5 s. Its inset fills the
  `screen` part (0.76 × 0.46 m, 400 px a metre: 304 × 184 texels) with content past every edge. 480 × 360, perspective
  from (0.6, 1.6, 3.4). The scratch run: the window's quad stays inside the frame in all 40 frames.
- **The second-camera inset** (AC1, AC9): the same display at the origin seen straight on (orthographic, 1 m across 480
  px: the window from (57.6, 69.6) to (422.4, 290.4) px); its inset shows `shown` from `side` (perspective at (50, 1, 8),
  fov 40°): an unlit red ball 0.3 m in radius rolling from x = 48 m to 52 m over 4 s before a grey wall. One frame's
  roll moves the ball's image 6.3 px.
- **The terrain** (AC2, AC9): a JSON glTF heightfield written by the test, 128 m square on a 1 m grid, y = 20 sin(kx)
  sin(kz), k = tan 60° ÷ 20: relief 39.994 m, steepest triangle 59.99° (scratch run). The heatmap: 64 × 64 cells over a
  64 m box at 4 px a metre (texel 0.25 m), cell (i, j) in `heat-((i + 3j) mod 8)`, role `data`; `onto: terrain`,
  `fade.edge: 0`. A tree 0.5 × 8 × 0.5 m on the cell corner (10, 10). Views A and B: perspective, 120 m away, 65° up,
  from +Z and −Z, 800 × 600. Scratch run: about 43,400 judged pixels in each view, all 4,096 cells judged in A or B,
  about 155,700 pixels outside the box, about 200 tree pixels.
- **The draped lid** (AC3): a ball 0.8 m in radius on a floor, 480 × 360 from 4.5 m at 45°; its child inset has only
  `size: [4, 4]`, `content` and `project: {}`. Scratch run: 20,668 judged lid pixels, 78,800 floor pixels in the box.
- **The film** (AC4, AC9): 640 × 360, safe 24 px; `hero` (0.6 × 1 × 0.6 m at (−1.7, 1.5, 0)) projects to x 89 to 172 px,
  y 68 to 183 px, clear of the rect (x ≥ 320, y ≥ 180); the twin's channel takes it to (1.9, 0.6, 0) by 3 s: x 488 to
  571, y 167 to 284, inside the rect.
- **The room** (AC5, AC9): the lamp's point (0, 0.7, 0); the orbit keeps it at least 146 px inside the safe frame; at
  frame 0 the ray from the eye to the point enters the sofa at 3.87 m of 6.35 m, and the card's background spot
  (120, 70) px into the frame lands on the sofa; the fly-through puts the point behind the camera at 29 of its 60
  frames and shows it inside the safe frame at 21.
- **The wall and window** (AC6): 1280 × 960, fov 40°; the window covers about 180,000 to 300,000 pixels; the ball's
  projection lies inside the window from all three cameras; no point of the through twin's ball or backdrop is in any
  camera's view directly.
- **The figure** (AC7): see `figureDoc`; each view's cut keeps 32 of 40 lights, and the test checks they differ.
- **The disc** (AC8): 580 texels of partial alpha on the rim; the disc's middle, alpha 128, reads code 188 drawn directly.

## Criteria to tests

IDs are `#506.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue. Every test title starts `AC<n> #506.<id>`.

### AC1 `#506.ed43cc07`: `ac1-screen-masked.test.ts` (2 tests)

- **Masked through motion and taking apart**: the masked screen at 10 fps, all 40 frames (the turn throughout; taken
  apart in 24 of them). Each frame: no pixel showing the content (`glow` or `beacon`, or their blend with the body or
  sky) lies more than 1.5 px outside the window's quad, which the test works out from the document (the take-apart's
  share times the apart vector, then the display's position and turn, the screen's plane z = 0.0201 m); at least 98% of
  the pixels 2 px or more inside the quad show the content. Fails on: the base; content not masked; an inset left
  where the part was.
- **The same evaluated frame**: the second-camera inset at 10 fps, all 40 frames: the ball's redness-weighted centre
  inside the window within 2 px of the side camera's projection of the ball at that frame's own time, mapped from texels
  onto the window (a frame late it's 6.3 px off). Fails on: the base; an inset a frame late or from another time.

### AC2 `#506.9d6f96ee`: `ac2-terrain-heatmap.test.ts` (1 test)

Rays through every pixel corner against the terrain's own f32 triangles and the tree's box. A pixel is judged where all
four corners land on the terrain in one cell, each at least one texel (0.25 m) inside it. Asserts: view A under the sun
at 10°, 45° and 80° (3 lx, day sky), each at the look's exposure and 2 EV brighter, and view B at 45°: every judged
pixel reads its cell's swatch within 1 code value on every channel; every one of the 4,096 cells is judged in A or B;
view A at 45° with and without the heatmap: every tree pixel (tree in the object-ID target with its 8 neighbours) and
every pixel whose corners all land at least a texel outside the box, past one side, are equal (0 codes). Guards: the
fixture's relief within 0.5 m of 40 and its steepest slope 59° to 61°; at least 50 tree pixels and 2,000 outside; 2 EV
brighter lifts most outside pixels.

### AC3 `#506.fad8bc6e`: `ac3-drape-defaults.test.ts` (2 tests)

- **Drapes onto its parent, lit or unlit**: judged lid pixels (all five rays through centre and corners on the ball,
  the surface within 50° of up) and floor pixels in the box (rays miss the ball and land on the floor within 1.9 m of the
  centre; floor in the object-ID target with its neighbours). Without data: every judged lid pixel equals the lid
  painted `tint` within 1 code; with data: every one reads the `tint` swatch (245, 154, 60) within 1 code; in both, the
  floor in the box equals the frame without an inset within 1 code. Guard: the painted lid differs from the swatch by
  over 3 codes on at least 30% of judged pixels.
- **Nine refused**: nine projected insets on the floor in one view are refused at check, naming `patch-1` to `patch-9`;
  eight draw.

### AC4 `#506.2393e811`: `ac4-view-overlay.test.ts` (2 tests)

- **Pixels and nesting**: frames 1, 3, 5, 7 at 2 fps (0.5 s to 3.5 s), one run: every pixel of the rect (320, 180) to
  (616, 336) at least 2 px inside its edges equals within one code value the same place in the film without `pip`
  through `pip-cam` at 296 × 156 at that frame. Guard: that render changes between 0.5 s and 3.5 s. The film with
  `pip2` inside `pip`'s collection is refused naming `pip2`.
- **Framing**: `deep-show run`, the film and its twin stored, each a claim with the requirement `{kind:
  "camera.framing", keep: ["hero"]}`: the film is PASS with no error or warning; the twin is FAIL with a camera.framing
  issue naming `hero`.

### AC5 `#506.f7b7c9cf`: `ac5-lamp-card.test.ts` (3 tests)

- **Over the sofa, on the point through the orbit**: 120 frames at 10 fps of the 12 s orbit: the card shown at every
  frame with `at` within 0.5 px (Euclidean) of the lamp's point projected through that frame's camera; at frame 0 the
  sofa lies between the eye and the point, and the 3 × 3 spot (120, 70) px into the card reads `card` within 2 codes
  where the frame without the card shows the sofa.
- **Hidden behind the camera**: 60 frames at 15 fps of the fly-through: where the point is behind the camera, `at` is
  null and no pixel is within 2 codes of `card`; where it projects 2 px or more inside the safe frame, `at` is within
  0.5 px of it (at least 10 of each).
- **Tab and Enter**: Tab until the scope's `focus` is `close-card` (at most 8), then Return: the panel's `view` shows at
  least 2,000 card-background pixels before and none after.

### AC6 `#506.0c1bce3a`: `ac6-eye-inset.test.ts` (2 tests)

- From (0, 0, 4), (1, 0.5, 4) and (−0.8, −0.4, 3), in one run: the inset frame's ball centre (redness-weighted, inside
  the window) within 1 px of the projection of (0, 0, −3); its window pixels (1 px or more inside) within 2 codes of the
  hole frame's on at least 99.9% of them; the through frame's ball centre within 1 px of the same projection and its
  window pixels within 2 codes of the inset frame's on 99.9%; an eye inset naming `camera` refused, naming `portal`.
  Guard: through the hole the ball centres on its projection.
- `--planted eye_inset_centred_frustum`, from the two off-axis cameras: each fails, its failure naming the camera, the
  pixel the ball drew at and the pixel it should.

### AC7 `#506.1bab76b5`: `ac7-view-state.test.ts` (1 test)

One run: the figure with `pip`; the figure without it through `pip-cam` at 296 × 156 (final, ids, light cut); through
`cam` at 640 × 360 (final, light cut). Guards: each cut shades 32 lights, and they differ. Every rect pixel 2 px inside
its edges within one code of the render alone from `pip-cam`; every main-view pixel 2 px outside the rect within one
code of the render alone from `cam`. Then each of the three plants: the comparison fails, and a failure names `view pip`
and its state: rect pixels that differ are grouped by what the render alone shows there, the mirror floor (`mirror`),
the glass (`backdrop`), anything else (`light cut`).

### AC8 `#506.2b4f3d4f`: `ac8-straight-alpha.test.ts` (1 test)

Every pixel over the disc's edge (texels with 0 < alpha < 128 and their 8 neighbours, about 1,700 pixels) reads the disc
drawn directly on the face, round(255 × encode(a ÷ 255)), within one code value on every channel; the disc's middle
reads 188 within one. Under `--planted inset_premultiplied_as_straight` the edge reads darker and a failure names
`disc-inset`.

### AC9 `#506.58529d4d`: `taste.test.ts` (1 test)

See The taste call.

## Readings where the issue and design leave a choice

- **Tolerances the issue doesn't give.** Criteria 1, 3 and 5 state none for some legs; these are this job's, each with
  its reason: a mask's edge 1.5 px (antialiasing) and 98% of the window's inner pixels (criterion 1); the ball within
  2 px, against 6.3 px a frame (criterion 1); the lid and the floor within 1 code value, the issue's tolerance elsewhere
  (criterion 3); the card's color within 2 codes (criterion 5). Equalities the issue states ("equal") are exact.
- **"The same evaluated frame"** is read by position: the second camera's picture shows the scene at the frame's own
  time, not the frame before, so a ball that moves 6.3 px a frame lands within 2 px of where the side camera sees it
  then. Pixel equality is not asked, since the inset's texels are resampled onto the face.
- **"Taking apart"** is #504's take-apart (assemblies, an apart vector and a follow on `assemblies/apart`), drawn by
  `view3d`. "Masked to its window" is read as nothing of the content past the window, and the window filled.
- **"Legend swatches"** are the look's role colors the cells are painted in; no legend item is drawn.
- **"Every cell's centre within one inset texel of its x and z"** is read through pixels that land at least a texel
  inside a cell: a heatmap off by up to a texel still paints them in their cell's swatch, one off by more doesn't.
- **"Lit when its content holds no data"** is read as the content taking the base color's place in shading (it equals
  the lid painted in that color); "unlit" as the swatch exactly. The rest of the box (the floor under it) stays as it
  was, which is "drapes onto its parent".
- **"In the bottom-right quarter of the safe frame"** and **"at a quarter of its size"** are both `size: [0.5, 0.5]` of the
  safe frame (half its width and half its height). "Rendered at t from that camera at the rect's size" is the document
  without the overlay, its envelope `camera` set to the overlay's camera, at the rect's pixel size. "On one machine" is
  one run here.
- **"A view overlay asked inside another view"** is a second `overlay.view@1` held in the first one's `include`.
- **"camera.framing finds the kept items clear of the rect at every sampled time"** is its verdict over the main shot:
  PASS; it is shown able to fail by the twin, not by a plant.
- **"Stays within 0.5 px of the lamp's projected point"** reads the card's frame origin from the reply (8 above), which
  the pixels check at frame 0; sub-pixel places can't be read from antialiased pixels in an unknown blend space.
- **The close button** is a toggle bound to the card's `visible` (11 above): the design gives a frame's controls a place
  in the Tab order but no control kind that closes a card.
- **"Its pixels match a frame with a hole"**: the window's pixels are those whose centres lie at least 1 px inside its
  projection. The share-of-pixels rule's per-pixel ceiling and small-window bound (technical design) aren't set,
  since the issue gives none.
- **"The disc drawn directly on that face"** is the straight-alpha white disc over the black face in linear light, coded
  to sRGB, texel by texel at a one-to-one texel-to-pixel mapping: what drawing that content onto that face gives, with
  no second rendering path to disagree about. The content is an `image@1` of the disc's PNG, so its texels are known.
- **"Naming the view and the state"** reads the state off the pixels that differ: where the render alone shows the
  mirror floor, the glass, or anything else.

## What couldn't be tested without guessing, and isn't

- A face inset's `recess`, `px_per_unit: proxy: auto`, text shrinking below the look's minimum, a view inset nested
  deeper than one, see-through insets sorting back to front.
- A projected inset `from: axis` or from a camera, `opacity`, `fade` widths and angles, a moving projector, and its
  "carry a status color" and "feed a check" refusals.
- Overlays: templates, runs, leaders, `hide: clamp`, `hide: off_frame`'s own frames (the fly-through asserts only frames
  behind the camera and frames well inside the frame), a split screen of two view overlays, and the "status colors
  exact" clause of view overlays (no criterion names it).
- Level of detail per view (criterion 7 names a backdrop, a mirror and a light cut; the Scope also names depth and level
  of detail, which no criterion tests).

## The taste call

`taste.test.ts` writes, from this run's own frames: `screen-inset.png` (the masked screen at 1.5 s, turned and taken
apart, 480 × 360), `second-camera-inset.png` (the second-camera inset at 2 s, 480 × 360), `terrain-heatmap.png` (view A
at 45°, 800 × 600), `overlay-view.png` (the film at 1.5 s with its bottom-right overlay, 640 × 360) and `lamp-card.png`
(the card over the sofa at the orbit's start, 640 × 360), and `masked-inset.apng` (the masked screen's 40 frames at 10
fps, the renderer's PNGs moved into one animated PNG unchanged), all in `docs/evidence/506/`, printing each SHA-256.
Show them to the owner in the session and attach them to the PR; record the one answer in
`tests/acceptance/506/TASTE.json` (this job writes none):

```json
{"issue": 506, "criterion": "#506.58529d4d", "verdict": "looks_right" | "looks_wrong", "who": "...", "when": "<ISO 8601>",
 "screenshots": {"screen-inset.png": "<sha256>", "second-camera-inset.png": "<sha256>", "terrain-heatmap.png": "<sha256>",
                 "overlay-view.png": "<sha256>", "lamp-card.png": "<sha256>"},
 "recordings": {"masked-inset.apng": "<sha256>"}, "note": "..."}
```

With no file, or one made on other bytes, the test is INCONCLUSIVE; `looks_wrong` fails it. No other test reads a
picture to judge it.
