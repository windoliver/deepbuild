# Acceptance tests for #2053: normal pages on images in a lit 2D group, a picture's surface turns toward each light, and a flat page changes nothing

Written first, blind, from issue #2053 (its opening paragraph, its scope, its seven acceptance criteria, its proof line
and its "Runs on" line), the design sections it links and those they lean on, and base commit `5f5791e2d` ("Merge pull
request #3068 …"), by a job that never saw an implementation; none existed, and no other worktree, branch or pull
request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding). Lean: one test per criterion clause that needs its own run, plus exactly the planted
wrong programs the criteria name. The issue's oracle page says no upstream test checks these criteria, so there is no
oracle lane.

Out of scope here, as the issue says: normal pages on atlas tile sets, specular pages, a draw mode that shows an item
only where light falls, a sun's direction on a page, and pages in an indexed look.

## What was read

- The issue, live (`gh issue view 2053`); #2031's and #2032's suites only for the surfaces they drive.
- `docs/canvas-primitives.md`: Time and the flick; Units and axes; the path grammar; Image `image@1` (the `normal`
  sentence at its end); Frame and group `frame@1`, `group@1` (the `light` field, a light's `height`, and the semantics
  of lights, shadows and normal pages); Material: texture maps (a normal map's two channels, z rebuilt in shading, read
  as stored).
- `docs/technical-design.md`: 2D marks and paint; Dogfooding; Tests written first.
- At the base, only to learn how surfaces are driven: AGENTS.md; `tests/acceptance/2031/` (README, helpers, every
  test), `2032/` (README), the helpers of `467/`, `535/`'s turned image and `1486/`'s store; `crates/deep-canvas-marks/
  src/{light,turn}.rs` and `scene/placed.rs` (the `image@1` arm); `crates/deep-marks-render/src/{asset,gpu,lib}.rs`,
  `raster.rs` (an image's draw) and `raster/path_answer.rs`; `crates/deep-gpu-layer/src/{main,marks2d}.rs`;
  `crates/deep-groups-render/src/lightfx.rs`; `crates/deep-canvas/src/document/{mod,check}.rs` (issues and notices);
  `scripts/{lanes.mjs,lease}`. No expected value comes from them.

## What the base already does, which these tests don't credit

#2031 and #2032 are in the base: a lit group lights its children on the GPU layer (`window2d`, `film2d`) and on Vello
CPU (`raster`), and `path` answers a lit group's evaluated light list (`at`, `color`, `range`, `energy`; no `height`).
`check`'s document pass raises the notice `unknown_kind` on every 2D item, each image among them ("kind `image@1` is
not registered in this build; the item is skipped"), page or no page, lit group or not, and its marks pass reads no
`normal`, so a page of any size passes unseen; nothing reads a light's `height`, so a height of 0 passes. `deep-gpu run`'s `window2d` and `film2d` take no
store, so Vello GPU there is never given one and every image answers `asset_missing`. None of the planted names below
exists (`bad_input`). BASE-FAILURE.txt shows each answer.

## Run them

Every file builds `deep-gpu` or `deep-canvas-render` and most draw on the GPU, so they run one file at a time.
`ac6-unpaged.test.ts` also builds both binaries at the merge base, and `ac7-budget.test.ts` judges a GPU budget. The
implementer adds these lines to `scripts/lanes.mjs`; this README is the instruction, and this job edits nothing outside
its folder.

```js
// #2053's files each build deep-gpu or deep-canvas-render and draw on Metal; ac6 also builds both at the merge base,
// and ac7 judges the paged lights' GPU budget on the reference Mac.
alone.push('tests/acceptance/2053/');
timed.push('tests/acceptance/2053/ac7-budget.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/2053 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2053/tsconfig.json    # type-check
rm -rf tests/acceptance/2053/node_modules/.vite
```

- **Build.** Each file builds what it drives once (`cargo build --locked --bin <bin>`, #467's `useBin`) and copies it out
  of the target folder, honoring `CARGO_TARGET_DIR`; a failed build fails each test that uses it. AC6 also exports the
  merge base's tree and builds `deep-canvas-render` and `deep-gpu` there through #2031's `useMergeBase`, which keeps
  both under `<target>/acceptance-2031-base` for the next run of the same merge base: a cold build the first time.
- **Platform.** The issue's "Runs on" line: "Spark for the evaluated fields, the refusals and the CPU reference values;
  the reference Mac for frames and the budget, INCONCLUSIVE elsewhere". The evaluated fields are `path`'s light list
  (AC5's first two tests), the refusals and the notice are `check`'s (AC4's first, second and fourth tests), and the CPU
  reference values are this suite's own f64 form; these run anywhere. Every frame needs macOS's Metal device and fails
  `INCONCLUSIVE:` off it, never passing; a `deep-gpu` answer `unsupported_platform` does the same.
- **Timing.** Only AC7 reads a time; it is INCONCLUSIVE wherever the perf lane can't judge one (Readings).
- **Isolation.** The PNGs are made in code into a store under the OS temp folder, deleted after each test; AC6 keeps
  the merge base's tree and build under the target folder. `BASE-FAILURE.txt` holds the run at the base.

## The surface under test

**No new binary and no new call.** The criteria enter through the document fields the issue lists, `check` and `path`
as the base has them, and one field more on two `deep-gpu run` calls: `store`.

### Documents

Built with #2031's helpers: `{format: 1, id, profile: "figure", title, description, size, budget: {class: "figure"},
layers: {main}, items}`, items `{id, kind, layer, name, order, params, parent?, at?}`, with #391's `transport` and
`channels`. Every call takes the shipped look `clean`; its role `ground` is #ffffff, the white of every light here. No
text holds a digit.

| Field | As the tests write it |
|---|---|
| a paged image | `image@1` `wall`: `{asset: <sha256>, normal: <sha256>, box: [−32, −32, 64, 64], fit: "fill", sampling: "linear", alt}` with `at: {pos: [160, 160, 0], rot: [0, 0, 0]}`, a child of the group `lamps` |
| a turned image | the same with `at.rot: [0, 0, 180]`: turned about its origin, its box's centre (#535) |
| no page | the same with no `normal` |
| a lit group | `group@1` `lamps` with `params.light: {ambient: 0, lights: [{at: [x, y], color: "ground", energy: 0.5, range: 400, height: 100}]}` |
| a group with no light | `group@1` `lamps` with no `light` field |
| the default height | a light that names no `height` (AC7, and every #2031 fixture in AC6) |
| a height driven by t | an f32 channel, linear keys, targeting `items/lamps/params/light/lights/0/height`, beside `…/at/0` and `…/at/1` |

### Pictures and the store

Every picture is an 8-bit RGBA PNG made in code (#467's `encodeRgbaPng`: IHDR, IDAT and IEND only, so no gamma or
colour chunk), named in a flat folder by the SHA-256 of its bytes, as `deep-canvas-render`'s `store` is (#674), and
named in a document by that hash. The image is white, every pixel (255, 255, 255, 255). A page holds the normal in red
and green; its blue is 0, since z is rebuilt and never read, and its alpha 255: AC1's page is (128, 204, 0, 255) at
every texel, AC2's flat page (128, 128, 0, 255), AC4's smaller page AC1's texel at 32 × 32, and AC7's 1920 × 1080 page
seeded sine bumps.

### `deep-gpu run`: `window2d` and `film2d` with `store` (macOS): every frame

The one extension the tests need: both calls take `"store": "<folder>"`, read as `deep-canvas-render`'s calls read it,
so every image and page a document names by hash is read from it, on whichever path a layer draws.

- `{"call": "window2d", "doc", "look": "clean", "store"}` → `{"window": sha256, "layers": [{"layer", "path"}]}` as at
  the base: the document as the app's window shows it, its PNG named by its SHA-256 in `out`, read back at 1 px a unit.
  "Byte-identical" frames are the same `window` hash.
- `{"call": "film2d", "doc", "look": "clean", "store", "fps", "from", "frames", "hash": true}` → `{"frames": [{"frame",
  "gpu_ms", "pixel_hash", …}], …}` as at the base (#417's, #430's `from` and `hash`).

`--planted <name>` takes this suite's names (Planted programs).

### `deep-canvas-render check` (every platform): the refusals and the notice

`{"doc", "look": "clean", "store", "planted"?}` → `{"ok", "issues": [{"code", "severity", "ids", "path", …}],
"notices": [{"code", "severity": "notice", "ids", "path", …}], …}` as at the base. Codes are the implementer's and
aren't asserted.

- **A page of another size**: an error that names both sizes (Readings).
- **A light with `height: 0`**: an error that names the light: its `path` is `items/lamps/params/light/lights/0` or
  under it (such as `…/height`), or its `ids` hold that path, as #2031's suite names a light.
- **A page outside a lit group**: accepted, and the page adds exactly one notice naming the image (its `ids` hold
  `wall`, or its `path` is `items/wall` or under it) to those the same document without the page raises (Readings).

### `deep-canvas-render path` (every platform): the evaluated height

As #2031's suite drives it (`{doc, item, times, look, planted?}` → `{ok, frames}`): with `item` a lit group, each
frame's `light.lights[k]` now also holds `height`, a number, the light's height evaluated at that time (range ÷ 4 when
the light names none). The tests read `at` and `height` and compare the whole `light` object between a play and a
seek, so its other fields may take any form, the same each time.

### AC6's surfaces

As #2031's AC7 drives them (its `framesOf`): `raster` (Vello CPU, with an empty store), `window2d` and `layers {…, by:
["gpui", "gpu_layer", "vello_cpu"]}` with no store, compared by the SHA-256 of each PNG, each refusal by its code and
path, and each layer's draw path.

### Planted programs

| Where | Name | The wrong program | Criterion |
|---|---|---|---|
| `deep-gpu run --planted` | `normal_flipped_green` | A page's green is read as 255 − g: its normal's y flips, so a surface leaning toward the image's top edge leans toward its bottom | AC1 |
| `deep-gpu run --planted` | `normal_dot_alone` | A paged pixel's light term is multiplied by max(0, N·L) and not divided by L.z | AC2 |
| `deep-gpu run --planted` | `normal_unturned` | A page's normal is taken in the frame's axes as if its image weren't turned | AC3 |
| `deep-canvas-render check`, `"planted"` | `normal_accepts_smaller_page` | The check lets a page whose pixel size differs from its image's through, and the draw stretches it over the image | AC4 |
| `deep-gpu run --planted` and `path`'s `"planted"` | `light_stale_height` | The evaluator keeps each light's height from the frame before: a played frame's lights take the height of the frame drawn before it | AC5 |

Each is reachable only there and only for this proof; any other value stays `bad_input`. The names are snake_case, as
the base's planted names are. Where each must fail and what names what:

- `normal_flipped_green`: the centre pixel reads 84 with the light toward the top edge and 206 toward the bottom, and
  the f64 judgement fails with a line naming `pixel (160, 160)`.
- `normal_dot_alone`: the centre reads 151, and the judgement against the frame with no page and against 177 fails
  with a line naming `pixel (160, 160)`.
- `normal_unturned`: the turned image's centre reads 206, and the judgement fails with a line naming the image `wall`.
- `normal_accepts_smaller_page`: `check` takes the name and accepts the 32 × 32 page, so the refusal judgement fails.
- `light_stale_height`: a seek's light list (`path`) and a seek's pixel hash (`film2d`) differ from the play's, with a
  line starting `frame 30:`, `frame 60:` or `frame 90:` that names the seek.

## Criteria to tests

IDs are `#2053.` and the first 8 hex digits of SHA-256 of each criterion's text, as its `- [ ] ` line reads after that
prefix. Each test's name starts with `AC[n] #2053.<id>`, and the file that carries a criterion quotes it in full.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `AC1 #2053.2bd7063d` | 1: a white 64 × 64 image with a page of (128, 204) under a light 100 u toward its top edge reads 206, toward its bottom 84; every pixel against the CPU f64 form; the planted flipped green | `ac1-leaning.test.ts` (2): the form gives 206 and 84 at pixel (160, 160); the frames read them within 1 code there, and every pixel of the image's box is within 1 code of the form from the page's bytes. Twin: `normal_flipped_green` reads 84 and 206, and the judgement fails naming `pixel (160, 160)`. |
| `AC2 #2053.9e8b1c74` | 2: a flat page is within 1 code of the frame with no `normal` at every pixel and reads 177; the planted N·L alone | `ac2-flat.test.ts` (2): every pixel of the 320 × 320 frame is within 1 code of the frame with no page, and the centre reads 177. Twin: `normal_dot_alone` reads 151 at the centre, and the judgement fails naming `pixel (160, 160)`. |
| `AC3 #2053.dca1cc61` | 3: the image turned 180° reads 84 at its centre under the light toward the top; the planted unturned normals | `ac3-turned.test.ts` (2): the centre reads 84 within 1 code. Twin: `normal_unturned` reads 206 there, and the judgement fails naming `wall`. |
| `AC4 #2053.07ff75d0` | 4: a 32 × 32 page refused naming both sizes; `height: 0` refused naming the light; a page in a group with no light draws byte-identical and raises one notice naming the image; the planted check | `ac4-refusals.test.ts` (4): the 64 × 64 page under a light of height 100 passes with no error; the 32 × 32 page is refused by an error naming 64 × 64 and 32 × 32; height 0 is refused naming `items/lamps/params/light/lights/0`. In a group with no light the page is accepted and adds one notice naming `wall`, and adds none in the lit group; its window hashes as the same document with no page, over a backdrop the white image covers. Twin: `check` takes `normal_accepts_smaller_page` and the small page's judgement fails. |
| `AC5 #2053.cf7f4bb1` | 5: one light's `at` and `height` driven over 4 s: seeking equals playing at 1, 2 and 3 s; the planted stale height | `ac5-seek-play.test.ts` (4): `path`'s light list at frames 30, 60 and 90, each sought in a fresh process, equals the play's, and every played frame's `at` and `height` are their channels' values; `film2d`'s played frames 30, 60 and 90 hash apart from one another and from the same frames with the height held, and each sought frame hashes as played. Twins: `light_stale_height` makes a seek differ from the play on each surface, the failure naming frame 30, 60 or 90. |
| `AC6 #2053.a3831a78` | 6: every fixture of #2031 and every 2D fixture already in the repo draws byte-identical to the merge base | `ac6-unpaged.test.ts` (1): #2031's documents, rebuilt from its helpers, and every file under a `fixtures/parity/2d/` folder in the merge base's tree, drawn at 0 and 1 s by the merge base's binaries and the checkout's with the same inputs: every `raster`, `window2d` and `layers` picture the same SHA-256, every refusal the same, every layer's draw path the same. A fixture the merge base draws no picture of is INCONCLUSIVE. |
| `AC7 #2053.1e05370b` | 7: 16 lights over a 1920 × 1080 paged image under 1.5 ms of GPU time a frame | `ac7-budget.test.ts` (1): one run, its reading printed: the paged side's first frame hashes apart from the plain side's and from the same side with no page. Then, on a reference Mac at rest only, five runs judged against 1.5 ms by the perf lane's `judgeLimit`: FAIL fails, anything but PASS is INCONCLUSIVE. |

Proof line: "the planted flipped green, N·L alone and unturned normals shown failing first" are AC1's, AC2's and AC3's
twins; "then the closed-form match, the refusals and the seek-equals-play hashes" are AC1's first test, AC4's first
test and AC5's frame test.

## Readings where the issue and design leave a choice

- **"A frame" and "reads"** are the app's window, `window2d`, read back at 1 px a unit, as #2031's suite reads them.
  "Reads code c within 1 code" is each of R, G and B within 1 of c.
- **The fixture's geometry.** A 320 × 320 document; the image `wall`'s box is centred on its origin, placed at
  (160, 160), so it covers pixels 128 to 191 on each axis and each pixel shows one whole texel at its centre. "100 u
  from the image's centre toward its top edge" is `at: [160, 60]`, toward its bottom edge `[160, 260]`; "toward the top
  of the frame" (AC3) is `[160, 60]` too.
- **"The centre pixel"** is pixel (160, 160), whose top-left corner is the image's centre. There the f64 form gives the
  criteria's codes: 206 and 84 (AC1), 177 and 151 under N·L alone (AC2), and 206 with the normals unturned (AC3). For
  the turned image (AC3) it gives 83 at (160, 160) and 84 at (159, 159), its mirror through the centre; both are within
  1 code of the criterion's 84, which the test asserts.
- **The CPU f64 form** (helpers `pagedLit`), the issue's and the design's sentences in f64:
  - N: the texel under the pixel, its red r and green g read as stored, never decoded from sRGB, each c ÷ 255 × 2 − 1
    (a material's normal map, as glTF maps 0..255 to −1..1), z rebuilt as √(max(0, 1 − x² − y²)). Its frame is the
    image's, +y toward the image's top edge, so in the document's axes (y down) it is (x, −y, z), z toward the viewer,
    then turned with the image by `at.rot`'s z as #535 turns its pixels.
  - L: from the pixel's centre (x + 0.5, y + 0.5) to (`at`, `height`): (at.x − x − 0.5, at.y − y − 0.5, height),
    normalized. d is its 2D part's length, and #2031's reach is (1 − (d ÷ range)²)² inside the range.
  - Each light's term is energy × reach × max(0, N·L) ÷ L.z; white (1 in linear light) × (ambient + Σ terms) is clamped
    to 1, encoded once with the sRGB curve, × 255 and rounded. With no page, N = (0, 0, 1), N·L ÷ L.z = 1, and this is
    #2031's form.
  - The criteria's numbers come out of it at pixel (160, 160) with ambient 0, energy 0.5, range 400 and height 100.
    The light toward the top edge: d = 100.50, reach 0.8777, L ≈ (−0.0035, 0.7089, 0.7053) in the image's frame,
    N·L ÷ L.z = 1.4030, term 0.6157, code 205.78 → 206. Toward the bottom edge: d = 99.50, reach 0.8801, N·L ÷ L.z =
    0.2030, term 0.0893, code 84.30 → 84. The flat page under the first light: N·L ÷ L.z = 1.0039, term 0.4406, code
    177.17 → 177 (no page: 1, term 0.4389, 176.86 → 177). N·L alone on the flat page: 0.7081, term 0.3108, code
    151.29 → 151. A flipped green swaps the first two (84 and 206 within 1 code), and unturned normals under the
    turned image give 206.
- **"Every pixel is within 1 code value of the CPU f64 form"** (AC1) is every pixel of the image's box under each
  light: outside it is the document's ground, which no light reaches. "At every pixel" (AC2) is every pixel of the
  frame.
- **"The frame with no `normal`"** (AC2) is the same document without the field, drawn in the same process.
- **"The refusal names both sizes"** (AC4): an error whose JSON holds each size, 64 × 64 and 32 × 32, as text (`64 ×
  64`, `64×64`, `64x64` or `64 x 64` inside one of its strings), as a pair `[64, 64]`, or as `{width: 64, height: 64}`.
  "A light with `height: 0` … naming the light": a light has no ID, so it is named by its path, the path grammar's list
  index. The documents that must be refused differ from the accepted one only in what is refused.
- **"Raises one notice naming the image"** (AC4): the notices naming `wall` that `check` gives the paged document,
  less those it gives the same document without the page (matched one for one by code and path), are exactly one; and
  the same page in a lit group adds none, so the notice is the one the design gives an image with a page outside a lit
  group. Counted as what the page adds because the base already raises `unknown_kind` on every `image@1`, and nothing
  in this issue asks for that to change. Read at check, the surface that reports notices; no frame call reports one
  at the base.
- **"Draws a frame byte-identical to the same image without the page"** (AC4): the two windows' PNGs have the same
  SHA-256. Both hold an `accent` backdrop behind the image, and the frame without the page must show white at the
  centre, so a frame that drew no image can't pass for one that drew it the same way.
- **"A planted check that accepts the smaller page and stretches it fails"** (AC4): `check` under the plant accepts the
  page, and the small page's judgement fails on its answer. How a draw stretches it isn't read.
- **AC5.** "By playing" is one process from frame 0 in order at 30 fps; "by seeking" is a fresh process opened at the
  frame with nothing drawn before it (`film2d`'s `from`; `path` with that one time), as #2031's suite reads them. 1 s,
  2 s and 3 s are frames 30, 60 and 90. The light crosses the image from (100, 60) to (220, 260) while its height rises
  from 20 u to 420 u, linearly over the 4 s span; "above the paged image" is read as the light's height over its plane.
  A seek equals a play even where nothing reads `height`, so the frame test also holds each played frame apart from
  the same frame with the height held at 520 u (only `at` driven), and the list test holds each played `at` and
  `height` to its channels within 1e-3 u, the scope's "drivable by t".
- **AC6.** "Every fixture of #2031" is each document #2031's suite draws, rebuilt here with the values its tests write,
  since its tests build them in code and no file holds them: AC1's to AC5's and AC8's lit documents, AC6's accepted
  sixteen lights, and the twins with the group's `light` removed that AC3, AC4 and AC8 draw. "Every 2D fixture already
  in the repo" is the parity suite's 2D area as #2031's AC7 reads it (`fixtures/parity/2d/` in the merge base's tree,
  each with what drawing it needs). A fixture that names a `normal` or a light's `height` is left out and printed;
  #2031's reader also leaves out one that names a `light`, which none at this base does. Each is drawn by every
  surface at 0 and 1 s; one the merge base draws no picture of can't be judged and is INCONCLUSIVE.
- **AC7.** "16 lights over a 1920 × 1080 paged image cost" is the paged side's median `gpu_ms` over 120 frames at
  60 fps less the plain side's (the same document with the group's `light` removed, where the page is outside a lit
  group), in one process, read as 0 when negative, as #2031's AC8 reads its lights' cost. The lights take the default
  height, a 4 × 4 grid at range 400 and energy 0.5, so most of the image is within several. `tick`, a small rect
  outside the group that moves every frame, keeps both sides drawing every frame. The timing counts only where
  scripts/benchmark.mjs's `judgeLimit` passes the machine and the load is within the cores; the debug build is timed,
  as #2031's is, since it is GPU time.

## Ambiguities

Each is read above; none is decided by the text alone, and a dispute goes to a blind redraft.

- **The 8-bit normal's mapping.** "Read as stored … as on a material's normal map" is read as glTF's c ÷ 255 × 2 − 1,
  which maps 204 to exactly 0.6, the criterion's y, and 128 to 0.0039, which the criterion rounds to 0. A mapping of
  (c − 128) ÷ 127 maps 128 to exactly 0 and 204 to 0.598; it stays within 1 code of the criteria's codes at the centre
  pixel but differs from this form by up to 4.5 codes at some of AC1's pixels, so AC1's every-pixel clause tells the two
  apart. AC2's flat page is within 0.49
  code of no page under the form here, so its "within 1 code" holds under either mapping.
- **"Turned and mirrored with the image".** At the base an `image@1` box with a negative scale is normalized
  (`Place::rect`), so no `image@1` draws mirrored; only atlas tile flips mirror, and atlas tile sets are out of this
  task. Mirroring is read as: when an image draws mirrored, its normal's x (or y) flips with it. No criterion names a
  mirror and no test reads one; AC3 turns the image 180°, which for a uniform page tests the turn of N, not which texel
  is read.
- **"The centre pixel" of an even-sized image** (Readings): four pixels share the centre; (160, 160) is taken, and the
  turned image's code there (83) is within 1 of the criterion's 84.
- **A page's blue and alpha.** A page is "two channels" but a PNG holds three or four; blue is written 0 and alpha 255.
  Blue 0 also means a renderer that read z from blue instead of rebuilding it would read every surface as edge-on and
  fail AC1 and AC2.
- **Where the notice is read, and which.** The design says the image "raises one notice"; `check` is the base's surface
  for notices, so AC4 reads it there, and a notice raised only by a draw would fail AC4's second test. The base's
  `unknown_kind` notice on every `image@1` also names the image; "one notice" is read as one that the page adds, so an
  implementation may keep or drop that notice.
- **The `store` on `window2d` and `film2d`.** The issue names no surface for an image's bytes in a frame; the base's
  `deep-gpu run` calls take no store and its Vello GPU is never given one, so the smallest extension, a `store` field as
  `deep-canvas-render`'s calls take it, is the one the frames use.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- `height`'s default of range ÷ 4 as a value (AC7's lights and #2031's fixtures take it, but no test reads the
  number), a negative `height` refused, and a channel key that carries `height` to 0 or below.
- A page that varies across the image (only uniform pages are judged per pixel; AC7's bumps are drawn but only timed),
  a page sampled as its image is (`crop`, `fit`, `sampling`, a level below 1:1).
- Paged images on Vello CPU (`raster`): no criterion says a page is drawn there.
- A sun over a page (reads flat, by the design), a page with occluders' shadows (#2032), several lights over a page.
- The notice's code and wording, and a page's sRGB or ICC chunks being ignored (the pages here carry none).
