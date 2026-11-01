# Acceptance tests for #385: 2D on Vello GPU — masks, isolated groups and blend modes on the GPU path, with no conflation seams

Written first, blind, from issue #385 (its scope, the Fields of Frame and group: blend modes, its eight acceptance
criteria, its proof line and its two owner comments: what #373 left, the live view's `module_missing` refusal in
`gpui_draws`, and what #96 left, children drawn in their parent's space), its Oracle page
(`doneright/oracles/issues/385.md`) and the upstream tests it pins, the design sections it links and those they lean on,
and base commit `c9225aa3` ("Merge pull request #976 …"), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

What was read:

- `docs/technical-design.md`: Rules every primitive follows; The canvas core (the module table's marks2d row; the
  Conventions paragraph: 2D writer layers composite in sRGB-encoded space, gradients in OKLab, GPUI's own gradients
  dither by up to two codes and use a 2.2 curve, so the GPUI patch adds an exact gradient mode, the core hands Vello
  each OKLab ramp as sRGB stops within 0.001 ΔEOK, "Vello CPU's blending is checked in its R2 spike"); 2D marks and
  paint; How it installs (headless rendering "wgpu offscreen on each backend plus Vello CPU"); How we know version 0
  works (the canvas line, "GPUI's 2D against Vello CPU through the perceptual oracle, interior pixels within one code
  value"; the parity suite: planted twins, a CPU reference counting as an oracle only once it reproduces a stated
  value, the perceptual oracle as reviewed test code, the blank guard, per-fixture ceilings, reftests "a 2D writer
  layer on GPUI and the same layer on the GPU layer"; Dogfooding); Numbers version 0 has to hold (five runs, p95,
  margin, reference Macs); the Decided rows "The 2D renderer", "Depth and 2D blending" and "The canvas's GPU layer".
- `docs/canvas-primitives.md`: The trusted compositor; Draw path: GPUI or the GPU layer (a 2D writer layer moves to
  the GPU layer only for an operator or, after the 2D renderer decision, a Vello GPU feature; 2D goldens and snapshots
  keep rendering with Vello CPU); Frame and group (isolation, rounded masks); Frame and group: blend modes (the
  formulas in f64 on "the same 8-bit premultiplied inputs the renderer composites"; add is Porter and Duff's plus;
  blends with what its own writer layer drew before it, in sRGB-encoded space or in linear light inside a 3D writer
  layer; never across writer layers, the shell, the card or a status color); Paint (OKLab over premultiplied colors,
  the exact mode); Mask (shape, alpha, luminance, feather); Conventions every primitive uses and the status-color
  rule; the writer-layer paragraph ("a writer layer that holds any 3D item is a 3D writer layer, fixed at check, and
  draws its 2D items as marks in 3D or overlays"); Canvas module: interface and implementation; Status guard.
- The Oracle page: three criteria (2, 3, 4) have upstream tests — Vello's `vello_tests` (mix.rs, compose.rs, gradient.rs,
  the `vello_test` macro and diff.rs) at `235739c4f0`, WPT's canvas compositing grid at `2f57f45d21`, resvg's
  mix-blend-mode and isolation tests at `77b12f4951`, and the color crate at `38280797d1`. Vello's repo at that commit
  was read for the crate names: `vello_gpu` 0.3.0 (wgpu ^30, vello_common ^0.3) and `vello_cpu` at the top level, and
  the compute renderer `vello` 0.11.0 with `vello_encoding` and `vello_shaders` under `research/`.
- At the base: `crates/deep-marks-render` (`deep-canvas-render`: `raster`, `render`, `frames`, `session`, `geometry`;
  `layer.rs`, #140's one layer drawn by GPUI and by Vello CPU with its edges and runs; `macos.rs`'s `gpui_draws`),
  `crates/deep-marks-vello` (Vello CPU at `Level::fallback()`, the f32 pipeline), `crates/deep-canvas-marks` (scopes:
  clip, mask, opacity; `mask_r2` for shapes and feathers), `crates/deep-gpu-layer` (`deep-gpu run` and #140's
  `live_frame` and `snapshot`), `crates/deep-canvas-scene3d` (3D layers; a role-map look has no tone map), the suites
  `tests/acceptance/373/`, `377/`, `378/`, `380/` and `140/` (layout, helpers, planted twins, gates), and
  `scripts/lanes.mjs`. `Cargo.lock` holds `vello_cpu` 0.3.0 and wgpu 29 and 30, and no `vello_gpu`.

What the base already does and these tests don't credit: Vello CPU draws R2's 2D marks for goldens at the scalar
level with the f32 pipeline (#373); GPUI draws two-stop gradients through the exact mode (`render`), with GPUI's own
OKLab option behind `planted: "gpui_oklab_gradient"`; #140's `deep-gpu run` draws a layer by GPUI and by Vello CPU.
There is no Vello GPU anywhere, no blend mode on a group, and the live view refuses R2's marks with `module_missing`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/385 --no-file-parallelism
npx tsc -p tests/acceptance/385/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds what it uses once (`cargo build --locked --bin deep-canvas-render`, `--bin deep-gpu`, and `--bin
deep-gpu --features test-spike`), copies each binary out of `target/debug` under its own name into a temporary folder,
and fails each test that uses a build that failed. Each test writes into its own temporary folder and deletes it. The
tests use node built-ins and vitest. A run with `--root` may leave Vitest's cache in
`tests/acceptance/385/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base.

`scripts/lanes.mjs` needs this folder in `alone` (the files build cargo binaries and drive the GPU), as #377's and
#140's are; this README is the instruction, the implementer makes the edit.

**Where each test can run.** Everything is headless: GPUI draws offscreen through its Metal renderer and the GPU layer
draws on the Mac's wgpu device, as #377's and #140's suites do. No test needs a display, a person, Screen Recording or
Accessibility permission.

- Vello CPU parts run anywhere. Every part that draws with GPUI or Vello GPU needs macOS with Metal; anywhere else the
  test fails `INCONCLUSIVE:`, never passing (`needsMac`).
- The NEON half of criterion 4 needs an aarch64 machine, else `INCONCLUSIVE:`.
- `spike.test.ts` (criterion 5's timing) counts only on a quiet reference Mac (Mac15,7 or Mac15,12, Low Power Mode
  off, thermal state nominal, 1-minute load at most half the cores; #377's gate) and is `INCONCLUSIVE:` anywhere else.

## The surface under test

The issue names Vello GPU, Vello CPU goldens at a SIMD level and pipeline, the spike and its 1 ms handoff, mask layers,
blend modes on `group@1`, a 3D writer layer, the dependency tree, and four planted programs, but no binary, call or
field. These tests extend the two binaries the base already proves 2D drawing through, `deep-canvas-render` and #377's
`deep-gpu`, with the smallest set of fields and calls they need. No new binary.

### The document: `blend` on `group@1`

The Fields as the issue gives them. This suite uses `blend` in `normal | multiply | screen | overlay | darken | lighten
| color_dodge | color_burn | hard_light | soft_light | difference | exclusion | hue | saturation | color | luminosity |
add`; the check and `raster` must take them. The fixtures also rely on what the design already names: `frame@1` with
`radius` and `overflow: mask` (a mask by shape), `group@1` `opacity`, multi-stop gradients with a stop's `opacity`,
`mask@1` `mode: alpha | luminance` and `feather`, path `at.pos` moved by channels, and, in a 3D writer layer, `rect@1`
and `text@1` items drawn at their 2D positions in view px (the layer "draws its 2D items as marks in 3D or overlays").

### `deep-canvas-render raster` (Vello CPU goldens), new fields

- `simd`: `"scalar" | "neon" | "detected"`, default `"scalar"`; `"detected"` is the level Vello CPU detects on this
  machine (`neon` on Apple silicon).
- `pipeline`: `"f32" | "u8"`, default `"f32"`.
- `golden`: bool, default `true`. A golden asked with `simd` other than `"scalar"` or `pipeline` other than `"f32"` is
  refused `{"ok": false, "code": "golden_config", "path": "simd" | "pipeline"}` (the first setting that is off; `simd`
  before `pipeline`) and writes nothing. `golden: false` draws a reading at the settings asked.
- Every drawing answer adds `"golden": bool` and `"renderer": {"name": "vello_cpu", "version": <the locked version>,
  "pipeline": "f32" | "u8", "simd": "scalar" | "neon" | …}` naming what drew it (a detected level by its own name).
- `blend_inputs`: a folder. For each group whose `blend` isn't `normal`, `raster` writes the two inputs it composites
  that group from, at the document's size in device px, as 8-bit RGBA PNGs whose color channels are premultiplied by
  alpha (as Vello's pixmaps hold them): `<folder>/<group>.backdrop.png`, what the group's own writer layer drew before
  it (transparent where it drew nothing), and `<folder>/<group>.source.png`, the group's content drawn isolated over
  transparent. The answer adds `"blend_inputs": [{"group": ID, "mode": blend, "backdrop": path, "source": path}]`.
- `planted: "sectors_source_over"`: the wrong program of criterion 8 (below).

### `deep-gpu run`: new calls

#377's protocol holds: one scenario `{"out": dir, "calls": [Call]}` per stdin line, answered with exactly one line
`{"ok": true, "replies": [Reply]}`, one reply per call; files go in `out` named by the SHA-256 of their bytes
(`<sha>.png`, `<sha>.json`). A call it doesn't hold, or a value outside what it takes, is answered `{"ok": false,
"code": "bad_input", …}`. `doc` is a document, `look` a look as `deep-canvas-render` takes it (a shipped look's ID, a
look@1, or a role map), `t` a time in flicks (default 0), `states` a map of status sources to states as `raster` takes
them.

**`{"call": "layers", "doc", "look", "t"?, "states"?, "by": [Renderer]}`**, `Renderer` one of `"gpui"` (GPUI's offscreen
Metal renderer, as the app's frame draws a layer; #140's `layer::gpui`), `"gpu_layer"` (the GPU layer: Vello GPU on the
app's wgpu device into an offscreen target read back, or, for a 3D writer layer, the GPU layer's own 3D path with its
2D items) and `"vello_cpu"` (Vello CPU as goldens draw, #140's `layer::vello`). Each writer layer is drawn alone over
transparent black at the document's size, scale 1, by each renderer `by` lists:

```json
{"layers": [{"layer": ID, "dim": "2d" | "3d",
             "path": "gpui" | "gpu_layer" | {"ok": false, "code": "module_missing", "path": "items/<id>"},
             "edges": sha256,
             "drawn": {"<renderer>": {"png": sha256, "runs": [{"id": item ID, "kind": "glyphs" | "stroke", "png": sha256}]}
                                     | {"ok": false, "code": string, "path"?: string}}}],
 "backends": {…}}
```

- `dim`: whether the layer is a 3D writer layer (it holds any 3D item; fixed at check).
- `path`: the draw path the live view picks for this layer, whatever `by` asks: `gpui` when GPUI draws it exactly,
  `gpu_layer` when it needs the GPU layer (a 3D layer, an operator, or a Vello GPU feature while Vello GPU is on), else
  the live view's refusal naming the first item no path can draw (#373's `module_missing`).
- `edges` (a JSON array of `[x0, y0, x1, y1]` in device px): every edge the layer draws, flattened, as #140's.
- `drawn.<renderer>.png`: the layer drawn by that renderer, straight alpha. `runs`: each glyph run (a text item's) and
  each stroke (a path's) the layer draws, drawn alone by that renderer in white, its alpha the coverage (#140's).
- A renderer that can't or mustn't draw the layer answers its side as a refusal: GPUI for what it can't draw
  (`module_missing`); `gpu_layer` while Vello GPU is off, or for a mask that waits on its mask layers; `gpui` and
  `vello_cpu` for a 3D layer. A refusal never comes with a picture.

**`{"call": "window2d", "doc", "look", "t"?, "states"?, "card"?: Card}`**: the document's view as the app's window shows
it, headless: each writer layer on the path `layers` names (GPUI's own, or the GPU layer's surface through the
handoff, #377's), status marks and their legend, and the shell's question card last in its slot when given (#377's
`card`: `{"ask", "question", "options": [{"id", "label"}], "rect": [x, y, w, h]}` in window px). The window is the
document's size at scale 1. Reply `{"window": sha256 of a PNG of the whole window, "layers": [{"layer", "path"}]}`.

**`{"call": "vello_gpu"}`** → `{"renderer": {"name": "vello_gpu", "version": <the locked version>}, "spike":
SpikeRecord, "enabled": bool, "mask_layers": bool}`: the spike record in force, whether Vello GPU draws (the live view
and `layers`' `gpu_layer`), and whether its mask layers draw (Vello GPU 0.3.0 refuses them as unimplemented, so
`false`; while false, alpha, luminance and feathered masks never draw on it).

**`{"call": "spike2d", "doc", "look", "frames": n}`**: the spike. The document's 2D writer layer is drawn by Vello GPU on
the GPU layer's device into a GPU surface of its own, beside the GPU layer's, and shown in the app's headless window
through the handoff (#377's zero-copy path), redrawn every frame, `n` frames. Reply `{"renderer": {"name": "vello_gpu",
"version"}, "size": [w, h], "frames": [{"frame": i, "handoff_ms": ms}]}`, `handoff_ms` being the time the handoff adds
to the frame (#377's `handoff_ms`), measured by the binary on the host's clock.

**The spike record** (`SpikeRecord`) is reviewed data shipped with the GPU layer (its path is the implementer's),
written from five runs of `spike2d` on a reference Mac:

```json
{"spike": "vello_gpu_2d_handoff", "renderer": {"name": "vello_gpu", "version": "0.3.0"},
 "machine": {"model": "Mac15,7", "chip": "Apple M3 Pro"}, "size": [1936, 1584], "budget_ms": 1,
 "runs": [{"handoff_ms": [ms, …]}, …]}
```

Vello GPU is on exactly when the record's five or more runs of at least 300 frames each have a p95 `handoff_ms` within
`budget_ms` (1), the design's judge PASS; the tests recompute this from `runs`.

**#140's `snapshot`** (`deep-gpu run --headless`, scene and case) keeps its record; criterion 5 reads its `layers[].png`.

### `deep-gpu`: builds and startup

- Shipped build: `cargo build --locked --bin deep-gpu`.
- `test-spike` (`--features test-spike`) adds `--spike-record <file>`: the spike record the run reads instead of the
  shipped one, with `run` and `run --headless`. No shipped build has it.
- New `--planted` names (with `run`): `shifts_fill_two_codes`, `shifts_glyph_quads`, `ignores_spike`,
  `sectors_source_over` (below). An unknown name answers one `{"ok": false, "code": "bad_input"}` line and exits 2 (#377).

### Planted programs

| Name | Where | The wrong program | Criterion |
|---|---|---|---|
| `shifts_fill_two_codes` | `deep-gpu run --planted` | the GPU layer draws every solid fill with its red channel two codes higher (clamped at 255) | 1 (issue-named) |
| `shifts_glyph_quads` | `deep-gpu run --planted` | GPUI draws each glyph's quad (the tinted mask sprite) half a device px to the right | 1 (issue-named) |
| `ignores_spike` | `deep-gpu run --planted` | Vello GPU draws whatever the spike record says | 5 |
| `sectors_source_over` | `raster`'s `planted`; `deep-gpu run --planted` | each path of a group is composited source-over on its own, each with its own anti-aliased coverage (GPUI, Vello GPU and Vello CPU alike) | 8 (issue-named) |

Criterion 4's "golden asked at a detected SIMD level or through the u8 pipeline" is a request, not a program: the
test asks for it and the refusal is the criterion. Criterion 3's parenthesis is the base's `render` planted
`gpui_oklab_gradient`, which the C3 test runs through the same measure.

## Criterion → test

| Criterion | Test |
|---|---|
| C1 GPUI against the GPU layer through the perceptual oracle; planted two-code fill and half-pixel glyph quads | `parity.test.ts`: one `layers` call drawing `writerDoc` (a full-layer solid fill, a two-stop gradient band, a disc, the glyph run `title`, the stroke `rule`) by all three renderers; the blank guard (`BLOCKED`); interior pixels (farther than 1.5 device px from every edge) GPUI against the GPU layer within one code on 99.9%; each glyph run and stroke on each live side against Vello CPU: summed coverage within 2%, centroid within 0.1 device px. Planted twins: `shifts_fill_two_codes` fails the interior share with a worst pixel of exactly 2 codes; `shifts_glyph_quads` fails naming `title:glyphs` with a centroid about 0.5 px off, and names neither the stroke nor the GPU layer. |
| C2 each W3C mode and add: Vello CPU against the f64 formula, Vello GPU against the goldens; never another writer's layer, the card or a status color | `blend.test.ts`: 17 goldens of Vello's mix scene (a five-stop gradient at alpha 0.86 in a group over a three-stop ramp) with `blend_inputs`; the inputs checked (backdrop = the figure without the group, pixel for pixel; source = the same bytes in every mode); each golden within one code of `blendPixel` on 99.9% of its pixels, and each mode's formula apart from normal's (so ignoring the mode fails); Vello GPU's layer within 1 code of the golden (6 color dodge, 2 color burn) at every pixel. Across writers: on the right half, where the group's own layer drew nothing, the golden is the group's result source-over the other writer's plate (blending with the plate is shown apart); the other writer's layer is the same pixels with and without the group by Vello CPU and Vello GPU. The status mark (clean look, pinned `pass`) is the same pixels and shows `#007429` under the group, in the golden and in `window2d`; the card's interior in `window2d` is the same pixels with and without the group; beside them the group's wash differs from the same group in `normal`, so a renderer that ignores `blend` fails. |
| C3 OKLab black → grey 51 reads 13 at its midpoint; rows identical | `oklab.test.ts`: the expected 13 (and 20 for a 2.2 curve) computed from the conventions; a 257 px-wide gradient whose column 128 is t = 0.5, by Vello CPU (`raster`), GPUI's exact mode (`render`) and Vello GPU (`layers`): column 128 reads (13, 13, 13) in every row and every row equals row 0; GPUI's own OKLab option (`gpui_oklab_gradient`) fails the same measure. |
| C4 goldens scalar f32; NEON within one code; detected or u8 refused | `goldens.test.ts`: 20 fixtures drawn as goldens and as NEON readings: every golden names `vello_cpu` at the locked version, `f32`, `scalar`, `golden: true`; every NEON reading within one code per channel at every pixel. A golden at `simd: "detected"` is refused `golden_config` naming `simd`, through `pipeline: "u8"` naming `pipeline`, and writes nothing; the same as readings draw and name their settings. |
| C5 Vello GPU only after the spike; masks only with mask layers; goldens and snapshots Vello CPU | `gate.test.ts`: the shipped record judged here from its frames, and `enabled` equal to that verdict, which must be PASS; `mask_layers` false; with Vello GPU on, a rounded mask, an isolated group at 0.5 and a three-stop gradient take `gpu_layer` and draw; alpha, luminance and feathered masks are refused `module_missing` naming the mask and never drawn by Vello GPU. With test records over (1.4 ms) and under (0.6 ms) budget the gate follows them; `ignores_spike` fails naming the layer. Goldens name Vello CPU; #140's headless snapshot is Vello CPU's pixels under both records. `spike.test.ts`: five `spike2d` runs of 600 frames at 1936 × 1584 after a warm-up, each p95 within 1 ms (reference Mac). |
| C6 3D writer layer blends in linear light; 2D in sRGB-encoded space | `linear.test.ts`: the multiply group around a title over a backdrop, with and without a box in the layer: `dim` is `3d` and `2d`; on the title's plate, the 3D layer (GPU layer) within one code of the linear-light product (4, 7, 77) and the 2D layer (Vello CPU and Vello GPU) of the encoded one (10, 13, 78). |
| C7 links Vello GPU and Vello CPU, never the compute renderer | `deps.test.ts`: `cargo tree -p deep-gpu-layer` holds `vello_gpu` 0.3 and `vello_cpu` 0.3; `vello_gpu`'s wgpu is the one `deep-gpu-layer` uses; `cargo tree --workspace -e normal,build,dev` and Cargo.lock hold no `vello`, `vello_encoding` or `vello_shaders` (the check is shown to find `vello` in a tree that has it); `vello_gpu`'s renderer and the spike record's are Vello GPU at the locked version. |
| C8 eight sectors: shared edges within one code; still after moving apart and back; planted source-over seam over 20 codes, naming the edge | `seams.test.ts`: the sectors at t = 0, 0.5, 1 and 2 s in one process per renderer (Vello CPU `raster`; GPUI and Vello GPU `layers`): at 0 and 2 s every pixel within 0.75 px of a shared edge and 2 px inside the rim within one code of the disc's color, at least 800 such pixels; at 1 s the sectors are apart. `sectors_source_over` in each renderer: a seam more than 20 codes lighter, failing with the edge named `s<k−1>|s<k>`. |

Proof line: the spike's handoff timing (`spike.test.ts`, and the shipped record judged in `gate.test.ts`), each blend
mode against its formula in Vello CPU and Vello GPU (`blend.test.ts`), the sector edges (`seams.test.ts`).

## Readings where the issue and design leave a choice

- **"The GPU layer"** in criterion 1 is the GPU layer drawing the 2D writer layer through Vello GPU on the app's wgpu
  device. Both live sides are read back offscreen, each layer alone over transparent black, as #140's oracle reads
  them; the oracle is #140's (interior pixels by centre distance to the listed edges; "within one code value" per
  channel, alpha included; coverage is alpha ÷ 255 summed, its centroid weighted by pixel centres; "within 0.1 device
  px" Euclidean). "Summed over its pixels in the window" is read as summed over the run's mask, which is the layer's
  window. The per-fixture ceiling for every pixel and bound for a small window have no numbers in the issue, so they
  aren't asserted.
- **"A fill whose color a planted fault shifts by two codes"** is planted on the GPU layer's side, the side under
  comparison; **"the glyph quads"** are GPUI's (GPUI draws glyphs as quads, the tinted mask sprite).
- **"The same 8-bit premultiplied inputs"** are the renderer's own, so `raster` writes them (`blend_inputs`); the test
  checks them against what it can draw independently before using them. Pixels are compared over the whole 256 × 128
  figure, the source inset so the backdrop alone also counts. W3C's general form is used (`co = cs(1 − αb) + cb(1 −
  αs) + αs·αb·B(Cb, Cs)`), unpremultiplying in f64; add is `min(1, cs + cb)`.
- **"As Vello's own snapshot suite holds them"** means every pixel within the tolerance (diff.rs's per-pixel check), on
  the layer drawn alone, which in the C2 figure is opaque, so it equals the golden frame.
- **"Never changes another writer's layer"** is read twice: the composite on the right half is source-over the other
  writer's plate (not blended with it), and the other writer's layer drawn alone is unchanged. **"The card"** is the
  shell's question card over the window (`window2d`); **"a status color"** a status mark under the group, in the
  golden and in the window.
- **"Reads 13 at its midpoint"** is column 128 of a 257 px gradient, whose pixel centre is t = 0.5 exactly; "rows are
  identical" is byte-equal rows.
- **"A detected SIMD level"** is `simd: "detected"`. NEON readings are compared at every pixel of 20 fixtures; the test
  doesn't require them to differ from scalar.
- **"Its spike shows"** is a shipped record of five runs judged by the design's budget rule, recomputed by the test
  from the frames; `spike.test.ts` re-runs it on the reference Mac. **"A second 2D handoff"** is a 2D layer's own GPU
  surface beside the GPU layer's, at the GPU layer's spike size, 1936 × 1584.
- **"Draws on it only once its mask layers do"** is read against `mask_layers`, which for 0.3.0 is false; the live
  view then refuses such a layer, as it does today.
- **"Goldens and snapshots render with Vello CPU either way"**: a golden names Vello CPU, and #140's headless snapshot
  is Vello CPU's pixels under a passing and a failing record.
- **"A title"** in the 3D writer layer is a `text@1` in a multiply group with its plate; the plate, away from the
  glyphs, is what's read. The role-map look gives the 3D layer no tone map and unit exposure.
- **"The canvas"** on the dependency tree is `deep-gpu-layer` (the package whose `deep-gpu` draws the live 2D path and
  the spike) for what it must link, and the whole workspace and Cargo.lock for what nothing may link.
- **"Shared edges"** are the eight radii from the centre to the rim; "on" them is a pixel centre within 0.75 px of a
  radius and more than 2 px inside the rim (the rim is the disc's own edge against white). **"While the sectors move
  apart and back"** is the sequence 0, 0.5, 1, 2 s in one process: tiled again at 2 s after the motion, and apart at
  1 s, so the channels are shown to move them.

Not tested, because no criterion asks: multi-color SVG; the eleven other modes (R6) and `dancing`; the `blend(mode)`
step; children drawn in their parent's space (#96's comment: no criterion of #385 states a value for it); budgets of
blended groups; the 32-group cap.

## Upstream tests (the Oracle lane)

The Oracle page links tests for criteria 2, 3 and 4. None is run through its own harness here (#136: a linked test
counts only when run against our output): Vello's PNG snapshots render Vello's own scenes, whose gradients interpolate
in sRGB, while our documents' ramps interpolate in OKLab, so no document of ours draws them. What is taken, as "port;
formula": Vello's mix scene (a five-stop gradient at alpha 0.86, blended over a ramp) as criterion 2's figure; its
GPU tolerances (1, 1 + 5 for color dodge, 1 + 1 for color burn) as the issue states them; the `vello_test` golden
configuration (the f32 pipeline at the scalar level, other SIMD levels within 1) as criterion 4's; Vello's own
non-separable checks (`mix_color_with_solid` (106, 106, 0), `mix_saturation_with_solid` (213, 52, 0)), which this
suite's `blendPixel` reproduces; the color crate's OKLab conversion for criterion 3's 13. WPT's compositing grid and
resvg's mix-blend-mode SVGs aren't run: the first needs a browser canvas and the second an SVG importer, neither of
which this issue builds. A lane that feeds our output to them is the oracle map's to add.
