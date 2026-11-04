# Acceptance tests for #1174: labels in 3D composited as 2D text is, on the device grid, and drawn after the upscale

Written first, from issue #1174 (its three findings, its two scope lines, its four acceptance criteria and its proof
line: "Masks compared across the two paths and across internal scales, on the reference Mac, with the merge base
beside them"), the design sections it links, and base commit `407d600d` ("Merge pull request #1205 …"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- AGENTS.md; `docs/canvas-primitives.md`: Labels `label@1`, `labels@1`; Text `text@1` ("where GPUI draws a 2D writer
  layer, the run's glyphs come from the core's atlas, rasterized by Vello CPU from their outlines"; "be measured by one
  engine and drawn by another" never); Marks in 3D (`mark.text` from the core's glyph atlas, `size_space: screen`);
  GPU surface (`internal_scale`, `upscale`, `sharpen`; canonical renders never upscale).
- The two issues it depends on through their suites: `tests/acceptance/381/` (labels in depth from the core's atlas,
  view3d's `labels` report) and `tests/acceptance/386/` (view3d's `surface`, the reference-Mac gate, `PLAIN_LOOK` and
  `typeDoc`, the frame of 12 px labels the audit read); `tests/acceptance/385/` (`layers`: a 2D writer layer drawn by
  GPUI, by Vello CPU and by the GPU layer, and the live view's `path` for it).
- At the base: `crates/deep-gpu-layer` (`main.rs`'s calls and `Planted`, `view3d.rs`: its `surface` and `passes`,
  `marks2d.rs`: `layers`, `path_of`), `crates/deep-scene3d-render` (`scene3d.wgsl`'s `text_vs`/`text_fs`: a glyph quad
  placed from the label's projected centre with no snapping, the atlas sampled through a linear sampler, coverage
  written as alpha into the linear target; `lib.rs`'s `scene3d label` sampler), `crates/deep-canvas-scene3d/src/label.rs`
  (a label's layout box centred on its projected point), `crates/deep-marks-render` (`layer.rs`, `macos.rs`: GPUI's
  2D text at sub-pixel phases), `scripts/proof-change.mjs` (criterion IDs).

What the base already does and these tests don't credit: scene3d draws a screen-size label's glyphs from the core's
atlas (#381), but places each quad wherever the label's centre projects, samples the atlas bilinearly, and writes
coverage as alpha in the linear target before the output encodes it to sRGB; below internal scale 1 those labels are
in the internal frame the upscale and sharpen stretch (#386), while outlines and status colors draw after. A 2D
text@1 is drawn by GPUI (or Vello CPU) from the same atlas with coverage applied in the encoded space.

## Run them

They build `deep-gpu`, as #381's and #386's suites do, so they run with `--no-file-parallelism`. `scripts/lanes.mjs`
needs this folder in its `alone` list, beside `tests/acceptance/386/`; this README is the instruction, and the
implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run tests/acceptance/1174 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1174/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first runs `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-gpu` in the
checkout (the shipped feature set), copies the binary to a temporary folder, and fails each test when the build fails.
Each test writes into its own temporary folder and deletes it; `taste.test.ts` also writes the screenshots to
`target/acceptance/1174/` (kept: they are what the owner is shown). The tests use node built-ins and vitest.
`BASE-FAILURE.txt` is the run at the base.

The proof line says "on the reference Mac": every test fails with a message that starts `INCONCLUSIVE:` off macOS or
off a reference Mac (`hw.model` Mac15,7 or Mac15,12), and on a reply of `unsupported_platform`; it never passes there.
No test is gated on power, Low Power Mode, thermal state or load (the owner's rule, as #386's suite).

"With the merge base beside them": the merge base is each criterion's wrong program. `BASE-FAILURE.txt` is this suite
run there; the implementation's PR shows this suite on the change beside the same run on its merge base.

## The surface under test

AC1 to AC3 need no new call and no new field: they read the base's `deep-gpu run` calls as they are.

- **`view3d`** (#378, with #386's `surface`): `{"call": "view3d", "doc": path, "look": look@1, "size": [w, h], "from":
  0, "frames": 1, "capture": [0], "targets": ["final"], "surface"?: {"internal_scale": 1 | 0.5}}`. The tests read
  `frames[0].final` (an 8-bit PNG in `out`, named by its SHA-256) and `surface.internal_scale` and `surface.upscale`
  (`none` at scale 1, `edge_adaptive` at 0.5, the default).
- **`layers`** (#385): `{"call": "layers", "doc": object, "look": role map, "by": ["gpui", "vello_cpu"]}`. The tests
  read the one layer's `path` (the live view's path for it) and `drawn[path].png`.

What the implementation must make true through them: at scale 1, scene3d's screen-size label composites as the 2D path
composites the same text and lands on the device grid as it does (AC1), its darkest pixel reaches the ink (AC2); at
internal scale 0.5 screen-size labels draw after the upscale and sharpen, at device resolution, so their pixels equal
scale 1's (AC3).

### Planted program (`deep-gpu run --planted <name>`, reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `labels_before_upscale` | Screen-size labels draw into the internal-size frame before the upscale and sharpen (the base's order), everything else as the shipped program | AC3 (issue-named: "a planted label drawn before the upscale") |

It is added to `Planted` in `crates/deep-gpu-layer/src/main.rs` beside #386's `outlines_before_upscale`. At scale 1
nothing upscales, so it draws as the shipped program there.

### The taste call (AC4)

`taste.test.ts` draws AC1's label by scene3d and by the 2D path and the shard view at internal scales 1 and 0.5 (the
same calls as the other files) and writes these 8-bit RGB PNGs of those pixels to `target/acceptance/1174/`, printing
each one's SHA-256:

| File | What it shows |
|---|---|
| `labels-2d-3d.png` | the 2D path's picture (left) and scene3d's (right) of the 13 px label, 1:1, on a grey strip |
| `labels-2d-3d-x4.png` | the same, cropped to the label and drawn 4 × 4 per pixel (nearest) |
| `shard-scale-1.png` | the shard view's final target at scale 1 |
| `shard-scale-0.5.png` | the shard view's final target at internal scale 0.5 |
| `shard-label-x4.png` | "Shard 7 lag 33.5 ms"'s region at scale 1 (left) and at 0.5 (right), 4 × 4 per pixel |

Those files are attached to the PR and shown to the owner in the session. The owner's answer is recorded in
`tests/acceptance/1174/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record that
answer:

```json
{"issue": 1174, "criterion": "#1174.20f41e3e", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"labels-2d-3d.png": sha256, "labels-2d-3d-x4.png": sha256,
 "shard-scale-1.png": sha256, "shard-scale-0.5.png": sha256, "shard-label-x4.png": sha256}, "note"?: string}
```

No file is INCONCLUSIVE; a call whose `screenshots` don't equal this run's SHA-256s (it was made on other pictures) is
INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this run's pictures passes. The pictures are this suite's
deterministic encoding (no filter, zlib level 9) of the renderer's pixels, so the same renderer on the same Mac draws
the same SHA-256s. No other test reads these pictures or the call.

## Fixtures (`helpers.ts`)

- `LOOK`: #386's acceptance look as the audit drew it: ink #16181d on paper #f7f6f2 (the paper of #386's
  `PLAIN_LOOK`, the look the Nov 3 audit measured "against ink #16181d"), basis physical, tone map none at the exposure
  whose scale is 1. `ROLE_MAP`, the same roles for `layers`.
- `labelScene()` (AC1, AC4): 320 × 96, an orthographic camera 3.2 m across, one screen-size `mark.text@1` "Shard 7 lag
  33.5 ms" at 13 px in ink, its centre projected at (160.37, 48.61) px, off the device grid.
- `labelBoard()` (AC1, AC4): 320 × 96, a 2D writer layer: a paper rect over the whole board and the same text, font,
  size and paint as a text@1 whose box's top left is at (100, 40).
- `shardScene()` (AC2, AC3, AC4): the shard view, #386's `typeDoc` labels alone: 1920 × 1080, an orthographic camera
  32 m across (60 px a metre), 48 labels of 12 px text in ink on a 6 × 8 grid 324 px by 123 px apart, the texts and
  places #386 gave them; `t-32` is "Shard 7 lag 33.5 ms". No lines and no motion (the lines go through the upscale by
  design, and a still frame is enough). Each label's region is 320 × 80 px about its projected centre; a fixture check
  in each test holds that each region holds its label at scale 1 (at least 100 pixels of mask 32 or more) and no ink (mask 32 or more) lies outside them.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text as the issue writes it, trimmed, with whitespace
collapsed and the leading `- [ ] ` dropped (`scripts/proof-change.mjs`'s `criterionId`). Each test's name starts with
its criterion's ID.

| ID | Criterion (the issue's text) | Tests, what each asserts, and the wrong programs |
|---|---|---|
| `#1174.46adb7ec` (AC1) | The same 13 px label drawn by scene3d at screen size and by the 2D path at the same device position gives glyph masks within 8 codes of each other at every pixel; the merge base fails, naming the largest difference | `masks.test.ts`: one run draws `labelScene` by view3d at scale 1 and `labelBoard` by `layers`; the 2D side is the one the layer's `path` names. Both pictures become glyph masks; the 2D mask is moved by whole pixels to its closest placement within 2 px of where the two ink boxes line up; at every pixel the masks are within 8 codes. Both have over 200 pixels of mask 32 or more and keep 8 px inside the view. The failure reads `the 13 px label "Shard 7 lag 33.5 ms": glyph masks differ by up to N codes, at device px (x, y): scene3d a, the 2D path (gpui) b, …`. Wrong program: the merge base, which fails naming that largest difference |
| `#1174.d79a0063` (AC2) | A 12 px ink label on paper reaches the ink's own value within 4 codes at its darkest pixel at internal scales 1 and 0.5 | `shard.test.ts`: the shard view at scale 1 and at internal scale 0.5 (edge-adaptive, sharpen 0.2), each reporting the surface it drew through; in `t-32`'s region ("Shard 7 lag 33.5 ms", 12 px), the darkest pixel (least R + G + B) is within 4 codes of #16181d in each channel, at both scales. Wrong program: the merge base (the audit read (60, 60, 61)), failing with the darkest pixel and its distance |
| `#1174.197f8e90` (AC3) | At internal scale 0.5 a label's pixels equal its pixels at scale 1 within 8 codes; a planted label drawn before the upscale fails, naming the label | `shard.test.ts`: the same two frames; for each of the 48 labels, every pixel of its region at internal scale 0.5 within 8 codes (each channel) of scale 1. A failure names the label: `t-32 "Shard 7 lag 33.5 ms": at internal scale 0.5 its pixel (x, y) is …, at scale 1 …: N codes apart`. Wrong programs: the merge base; `--planted labels_before_upscale`, which must fail naming a label |
| `#1174.20f41e3e` (AC4) | Shown to you: screenshots of the same labels in 2D and 3D side by side, and the shard view's labels at internal scales 1 and 0.5, taken by the check run from the renderer's own output, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it | `taste.test.ts`: writes the five screenshots above from one run's pixels (each showing ink), then reads `TASTE.json`: absent, or recorded on other SHA-256s, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these pictures passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

## Readings where the issue and design leave a choice

- **"The 2D path"** is the path the live view picks for a 2D writer layer holding that text, as `layers` reports it
  (`path`: GPUI on macOS, which draws the run's glyphs from the core's atlas, rasterized by Vello CPU, with coverage
  applied in the encoded space Vello uses). The test reads whichever side `path` names.
- **"Glyph masks"**: each picture is ink on paper; a pixel's mask is how far it has gone from the picture's own ground
  toward the ink, summed over R, G and B, as a share of the whole way, × 255 (`maskOf`). Coverage a composited in the
  encoded space reads a × 255, so "within 8 codes" is read on that 0 … 255 scale. "At every pixel" is every pixel of
  the 320 × 96 view.
- **"At the same device position"**: the 2D text's box sits on the device grid, and the test moves its mask by whole
  pixels (within 2 px of where the ink boxes line up) to the placement closest to scene3d's. The label in depth must
  therefore land on the device grid as the 2D text does (the scope's "snapped to the device pixel grid"); its exact
  integer place stays the implementer's. A label left between pixels, or sampled across glyphs, can't come within 8
  codes of a 2D text on the grid. The label's centre is put off the grid on purpose.
- **"A 12 px ink label on paper"** is the issue's own label, "Shard 7 lag 33.5 ms", in the shard view. "Its darkest
  pixel" is the least R + G + B in its region; "the ink's own value within 4 codes" is each channel within 4 of
  #16181d.
- **"A label's pixels"** are the pixels of its region (320 × 80 px about its projected centre, which holds its glyphs
  and the paper around them); "equal … within 8 codes" is each channel, every pixel. All 48 labels are held to it.
- **"The shard view"** is #386's frame of 12 px labels (the audit's), taken without its lines and motion, which this
  issue doesn't change.
- **The taste call's record.** The base has no file for an owner's taste call on a PR's screenshots, so this suite
  names `TASTE.json` and ties the call to the pictures by SHA-256, so a call can't outlive the pictures it was made on.

Not tested, because no criterion asks: labels in world size or with a halo; labels at internal scales other than 1
and 0.5; the bilinear upscale; a label's layout or placement against other labels (#381, Labels); the dark theme.
