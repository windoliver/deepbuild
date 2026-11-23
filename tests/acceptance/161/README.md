# Acceptance tests for #161: fx@1 — about 70 named operators for common effects, composed as data

Written first, blind, from issue #161 (its Scope, Fields, thirteen acceptance criteria, Proof and Oracle lines), the
design sections it links and those they lean on, and base commit `7a256fd4` (main), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean: one test per criterion, one more where a clause needs its own
run (a timed half, a refused pack), plus exactly the seven planted twins the criteria name.

## What was read

- The issue, as saved (`issue-161.md`, and `issue-161-body.md` for the criteria's IDs); it has no comments. Its Oracle
  page was not read: the brief gave what it says (The oracle lane, below).
- `docs/canvas-primitives.md`: Pack: fx@1 named operators; Frame and group (passes, backdrop, blend modes, draw
  order); GPU operators, as data (GPU operator; Step and the closed step list; Operator input; Operator output; Place
  in the frame; Compile, validate and cache, with its f64 interpreter; Operator cost and limits; Determinism class;
  Status guard; Shipped operators and composed graphs, and pack graphs and step functions; Draw path); Every public
  step; Operator budgets by class; The status-color rule; The cost model; Flicker check.
- `docs/technical-design.md`: Every task carries its own budgets; The reference Macs; the parity suite's rules (a CPU
  reference as an oracle, a tolerance's ceiling); Criteria to tests; Criteria in a checked shape; Wrong programs; the
  edit guard; Dogfooding; Built to be hard to get wrong.
- At the base, for call shapes only: `AGENTS.md`, `CONTRIBUTING.md`; the suites `tests/acceptance/430/`, `431/`,
  `429/`, `382/`, `386/`, `466/`, `466-redraft-ac3/`, `464/` (its `flicker`), `1436/`, `1720/`, `306/` (the pack
  store's calls), `2760/`, `2760-redraft-ac8/`, `2306/` (`twins.json`); `packs/fx-1.0.0/pack.json`;
  `crates/deep-canvas-effects/src/{fx,module,graph,check}.rs`, `crates/deep-canvas/src/{steps,budget,cost}.rs` and
  `document/check.rs`, `crates/deep-groups-render/src/groups.rs`, `crates/deep-gpu-layer/src/{main,marks2d,film,
  effects,effects/check_operator,steps_ref,interp_suite/mod,calibrate,live,liveview,flat,host,print2d}.rs`,
  `crates/deep-show/src/{packs,film_audit,frames/drawn2d}.rs`; `scripts/{proof-change,proof-runs,proof-guard,lanes,
  benchmark}.mjs`; `benchmarks/budgets.json`.

## What the base already does, and these tests don't credit

- fx@1 holds 17 of the 70 operators, each a pass graph `{id, kind: "pass", origin: "pack", grow, about, inputs, steps,
  outputs: {color, blend: "replace"}, cost: {ns_per_px}, resolution}`, a param an input `{type, unit, from: {param},
  range, default}`. A group's `passes` name them, `blur@1` or a composed pass (#430); `layers` answers a layer as
  premultiplied f32 (`float: true`), `film2d` plays a film with `from`, `hash`, `capture` and `flicker`.
- Its `fx.invert@1` inverts the premultiplied values (`1 − rgb`, alpha kept), its `fx.twirl@1` and `fx.radial_wipe@1`
  take `center` in the frame's uv and its `fx.directional_blur@1` takes `direction` in the frame's uv: a group's pass
  runs on a target of the frame's size, and no operator divides by alpha.
- `check_operator` (#380, #429, #431) checks a graph, compiles it off the UI thread with a `timing`, and with
  `reference: {size}` draws it on the GPU and through the f64 interpreter. Its harness leaves a target input blank,
  and an operator it splits around the shipped blur answers no `reference`.
- `spline@1` is Fritsch and Carlson's monotone cubic with Fritsch and Butland's slopes, exact per piece;
  `homography@1` maps the unit square's corners (0, 0), (1, 0), (1, 1), (0, 1) to `quad[0]` … `quad[3]`.
- The pack check (`deep-show run`, `install_pack`) puts every entry of a pack's `operators` through the whole
  operator check, so it already refuses shader text, a read of an earlier step and an op outside the table; it reads
  no operator's name against the shipped library.
- The document check sums no pass's cost; `calibrate` times shipped operators and its own fixture graphs, no pack's.
- `live` draws a 2D session through the group compositor, always at internal scale 1 whatever its `surface` says,
  times it as one pass named `flat` with no operator, numbers its frames from 1, and neither draws nor captures a
  frame that shows what the last one showed.
- A 3D writer layer's 2D items composite over its scene's picture, which is opaque (the look's ground where the scene
  draws nothing); `blend_inputs` (#430) answers a blended group's own texels.
- The status guard already runs over a group's passes in a 2D layer where the document binds status.
- `film2d`'s flicker check counts flashes of luminance only.

`BASE-FAILURE.txt` holds what was run at the base and how each test fails there.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/161 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/161/tsconfig.json   # type-check
```

`cargo` on `PATH` (the helpers put the pinned 1.99.1 toolchain first when it is installed). Each file builds what it
uses once, in `beforeAll`, and copies the binary out of `target/debug`; a test whose build failed fails with cargo's
error:

- `cargo build --locked --bin deep-gpu` (every file but `ac3-pack-check.test.ts`);
- `cargo build --locked --bin deep-show --no-default-features --features full` (`ac3-pack-check.test.ts`,
  `ac6-timed.test.ts`).

Each test writes into its own temporary folders and deletes them. Node built-ins and vitest only; no network. Delete
Vitest's cache in `tests/acceptance/161/node_modules/.vite` after a run.

**Lanes.** `lane.json` says the folder runs alone (its files build cargo binaries and draw on the GPU), so
`scripts/lanes.mjs` needs no `alone` line. The implementer adds the two timed files to `timed` in `scripts/lanes.mjs`:

```js
// #161's suite times its measured costs and its two budgets on the reference Mac.
timed.push('tests/acceptance/161/ac4-measured.test.ts', 'tests/acceptance/161/ac6-timed.test.ts');
```

**The perf lane's task.** The implementer adds this task to `benchmarks/budgets.json` and the mode `fx-pack` to
`benchmarks/canvas.mjs` (`ac6-budgets.test.ts` reads the entry; the mode's own measuring is the implementer's, in the
form the other `canvas.mjs` modes take):

```json
{"id": "canvas-fx-pack", "command": ["node", "benchmarks/canvas.mjs", "fx-pack"], "margin": 0.5, "limits": {},
 "targets": {"pack_check_ms": 2000, "operator_compile_ms": 20, "still_dispatches": 0},
 "criteria": ["#161.729a03cd"], "initialReason": "Issue #161 first measurement: …"}
```

**Where a test can't judge.** Everything the GPU layer draws runs on macOS's GPU device: off macOS a test fails
`INCONCLUSIVE:`, never passing. The two timed files fail `INCONCLUSIVE:` off a reference Mac, on battery, in Low Power
Mode, not thermally nominal or under load (the perf lane's own `judgeLimit`, read before anything is timed and with
each run's load). The taste test fails `INCONCLUSIVE:` until a taste call is recorded on exactly its run's files. No
test reads an outside tool, so none reads `BLOCKED:`; the oracle lane is `BLOCKED` (below).

## The surface under test

**No new binary and no new call.** `deep-gpu run [--planted <name>]` (#377: one scenario `{"out", "calls"}` per line,
one `{"ok": true, "replies"}` line back, files under `out` named by SHA-256) and `deep-show run` (one scenario
`{"evidence", "packs", "calls"}`), with the pack's data, a few fields on existing calls and replies, and seven
planted programs. **Every name marked *(ours)* is this job's choice; the implementer builds exactly these, or a
dispute goes to a blind redraft.** Everything else is the base's, used as it is.

### The pack: `packs/fx-1.0.0/pack.json`, installed as `deepbuild/fx`, named by documents as `deepbuild/fx@1.0.0`

`operators` holds exactly these 70 keys, each a pass graph in the base's form, its `id` its key. The 17 the base has
keep their IDs. *(ours)*: the other 53 IDs. An ID is `fx.<the issue's name>@1`, except that the blur list's five
kinds of blur are named as the base names `directional`: `fx.<name>_blur@1`.

| Category | IDs |
|---|---|
| color (14) | `fx.levels@1`, `fx.curves@1`, `fx.brightness_contrast@1`, `fx.exposure@1`, `fx.gamma_pedestal_gain@1`, `fx.channel_mixer@1`, `fx.black_white@1`, `fx.tint@1`, `fx.tritone@1`, `fx.gradient_map@1`, `fx.selective_color@1`, `fx.vibrance@1`, `fx.invert@1`, `fx.leave_color@1` |
| blur (7) | `fx.directional_blur@1`, `fx.radial_blur@1`, `fx.channel_blur@1`, `fx.bilateral_blur@1`, `fx.compound_blur@1`, `fx.sharpen@1`, `fx.unsharp@1` |
| distort (15) | `fx.bulge@1`, `fx.twirl@1`, `fx.ripple@1`, `fx.wave_warp@1`, `fx.polar@1`, `fx.spherize@1`, `fx.mirror@1`, `fx.offset@1`, `fx.corner_pin@1`, `fx.displacement_map@1`, `fx.turbulent_displace@1`, `fx.lens_distort@1`, `fx.magnify@1`, `fx.bend@1`, `fx.page_turn@1` |
| stylize (11) | `fx.find_edges@1`, `fx.emboss@1`, `fx.mosaic@1`, `fx.posterize@1`, `fx.threshold@1`, `fx.scatter@1`, `fx.roughen_edges@1`, `fx.motion_tile@1`, `fx.kaleida@1`, `fx.glass@1`, `fx.cartoon@1` |
| generate (6) | `fx.four_color_gradient@1`, `fx.cell_pattern@1`, `fx.checkerboard@1`, `fx.light_rays@1`, `fx.light_sweep@1`, `fx.light_burst@1` |
| noise (2) | `fx.noise@1`, `fx.dust_scratches@1` |
| channel (3) | `fx.set_channels@1`, `fx.arithmetic@1`, `fx.minimax@1` |
| keying (5) | `fx.linear_color_key@1`, `fx.color_difference_key@1`, `fx.luma_key@1`, `fx.spill_suppressor@1`, `fx.key_light@1` |
| matte (1) | `fx.choker@1` |
| transitions (5) | `fx.gradient_wipe@1`, `fx.radial_wipe@1`, `fx.block_dissolve@1`, `fx.venetian_blinds@1`, `fx.light_wipe@1` |
| in no list (1) | `fx.slice_shift@1` |

What the tests read of every operator:

- `cost: {"ns_per_px": n}`, finite and above 0 (1 ns a pixel is 1 ms a megapixel).
- With no params (`"params": {}`) it runs at its defaults, in a group's `passes` and in the operator check.
- **Its defaults change a picture.** AC1 needs 16 texels or more of its category's fixture changed by more than two
  10-bit codes, and AC10 needs 64 texels or more of the checker changed (the blur and distort operators): an operator
  whose defaults are the identity can't be told from one that does nothing. The base's 17 defaults already do.
- **The input that reads the pass's own target** is a texture input `from: {"texture": {"target": {"op": "core",
  "output": "color"}}}`, as the base's `src` is. AC1 binds every such input to a picture (The reference harness).
- It moves with its group (AC10, blur and distort), keeps to the status guard (AC5), and compiles off the UI thread
  (AC6).

Params a test sets or leans on. "As the pass sees it" is the value in the space the group's writer layer composites in
(sRGB-encoded in a 2D writer layer, linear light in a 3D one), divided by its alpha for a color.

| Operator | Param | Type | Unit | Range the tests use | Default | Example |
|---|---|---|---|---|---|---|
| `fx.levels@1` *(ours)* | `in_black`, `in_white`, `out_black`, `out_white` | f32 each | the color's value as the pass sees it | 0 to 1, `in_black` < `in_white` | not read; not the identity (above) | `{"in_black": 0.2, "in_white": 0.8, "out_black": 0.1, "out_white": 0.9}` |
| `fx.curves@1` *(ours)* | `points` | a list of 2 to 16 `[x, y]` pairs, x rising | the color's value as the pass sees it | each 0 to 1 | not read; not the identity | `{"points": [[0, 0.05], [0.2, 0.12], [0.45, 0.5], [0.7, 0.62], [1, 0.95]]}` |
| `fx.corner_pin@1` *(ours)* | `quad` | four `[x, y]` | uv of the group's bounds, (0, 0) its top left, (1, 1) its bottom right | 0 to 1 | not read; not the bounds' own corners | `{"quad": [[0.125, 0.25], [0.875, 0.125], [0.75, 0.875], [0.25, 0.75]]}` |
| `fx.linear_color_key@1` *(ours)* | `key` | vec3<f32> | linear rgb, as the base's color params (the color as the pass sees it) | 0 to 1 | not read | `{"key": [0, 1, 0]}` |
| `fx.slice_shift@1` *(ours, from the issue)* | `count` | `[u8, u8]` | strips, least and most | `[2, 4]` | not read | `{"count": [2, 4], "height": [10, 35], "shift": [18, 64], "step": 98784000, "seed": 9}` |
| | `height` | `[px, px]` | px at design size, least and most | `[10, 35]` | not read | |
| | `shift` | `[px, px]` | px at design size, least and most, either way | `[18, 64]` | not read | |
| | `step` | integer | flicks (705,600,000 a second) | 98,784,000 (0.14 s) | not read | |
| | `seed` | u32 | — | 9 | not read | |
| `fx.invert@1` | `amount` | f32 | ratio | 0 and 1 | 1 (the base's) | `{"amount": 0}` |
| `fx.twirl@1` | `center` | vec2<f32> | uv of the group's bounds *(ours: the bounds, not the frame)* | — | the bounds' middle, so the result moves with the group | `{}` |
| `blur@1` (shipped) | `radius` | f32 | px at design size | 8 | 8 (the base's) | `{"op": "blur@1", "params": {"radius": 8}}` |

What each means, kept to what a criterion reads:

- **`fx.levels@1`**: each of r, g and b of the color divided by its alpha goes through the monotone cubic through its
  two ends, (`in_black`, `out_black`) and (`in_white`, `out_white`), which is the line between them, held at
  `out_black` below `in_black` and at `out_white` above `in_white`; alpha kept. Any other param it has must leave that
  mapping as it is at its default.
- **`fx.curves@1`**: each of r, g and b of the color divided by its alpha goes through `spline@1`'s monotone cubic
  through `points`, held at its end values past either end; alpha kept. One curve for the three channels.
- **`fx.corner_pin@1`**: the picture inside the group's bounds is drawn into `quad`: the bounds' corners top left, top
  right, bottom right, bottom left land on `quad[0]` … `quad[3]` (`homography@1`'s order). Outside the quad it writes
  (0, 0, 0, 0). The test sets `grow: 0` and keeps the quad inside the bounds.
- **`fx.linear_color_key@1`**: a texel whose color is `key` is keyed out, written (0, 0, 0, 0); at its other defaults
  an opaque grey of linear 0.503 beside a key of (0, 1, 0) is left exactly as it was.
- **`fx.slice_shift@1`**: at each step k = ⌊t ÷ `step`⌋ it moves `count[0]` to `count[1]` horizontal strips, each
  `height[0]` to `height[1]` px high, sideways by `shift[0]` to `shift[1]` px, left or right, drawn from `seed` and k
  alone; every other row is left as it was. Strips are whole rows and don't overlap; a moved row is the row it was,
  read `shift` px to the side (README: Readings, for what fills the px a strip vacates).

### `check_operator` (#380, #429, #431): the reference harness

```json
{"call": "check_operator", "operator": <a pack graph>, "assets": {"<sha256>": "<path>.png"}, "reference": {"size": [128, 72]}}
→ {"outcome": "accepted", "issues": [], "timing": {"check_ms", "compile_ms", "thread", "ui_thread"}, "reference": {"size", "gpu": sha256, "cpu": sha256}}
```

All of it is the base's. AC1 hands it each pack graph as `pack.json` holds it (`origin: "pack"`, its `grow` kept),
with one change made by the test: every input that reads the pass's own target is rewritten to `from: {"texture":
"<sha256>"}`, the category's picture in `assets`, since the harness's own target is blank. The two `.f32` files are
RGBA little-endian f32, rows top-down, `w × h × 16` bytes: the operator at its defaults on this GPU and through the
f64 interpreter. AC6 hands it each graph unchanged and reads `outcome` and `timing`.

*(ours)*: `reference` is answered for **every** pack operator, one that calls the shipped blur among them (the base's
check splits such a graph into parts and answers `parts` with no `reference`): both sides run the parts in order.

### `layers` (#385, #430), `film2d` (#417, #430, #464) and `live` (#379, #386)

```json
{"call": "layers", "doc", "look", "by": ["gpu_layer"], "float": true, "packs": ["<repo>/packs/fx-1.0.0"], "states"?: {"<verdict>": "fail"}}
{"call": "film2d", "doc", "look": "clean", "fps": 50, "frames": 42, "from"?: 23, "hash": true, "capture": [0, …], "flicker": true, "packs": […]}
{"call": "live", "look": <look@1>, "fps": 60, "frames": 60, "packs": […], "report"?: ["passes"], "capture"?: [0, 1, 2, 3],
 "sessions": [{"session": "s", "writer": "agent:sess-alpha", "doc": "<path of a payload>", "size": [256, 96], "surface"?: {"internal_scale": 0.5, "upscale": "bilinear", "sharpen": 0}}]}
```

- `layers` is used as it is: `layers[].drawn.gpu_layer.{png, f32}`, `dim`, and #430's `blend_inputs: [{group, mode,
  backdrop, source}]`, whose `source` is a group's own texels after its passes, premultiplied, isolated over
  transparent (answered for a group whose `blend` isn't `normal`; AC8, AC9 and AC12 set `blend: "subtract"` to read
  it). *(ours)*, for criterion 12's planted keyer alone: a texel a pass wrote as (0, 1, 0, 0) shows, either in the layer
  where the group lies over black (a compositor that adds a premultiplied texel's rgb whatever its alpha) or in
  `source` (which then keeps a texel's rgb at alpha 0); the base does neither. The look is a role map `{"light": {role: [r, g, b]}}`, or a `look@1` with a status map for AC5.
- `film2d` is used as it is (`frames[].{frame, pixel_hash, final}`, `flicker.verdict`). *(ours)*: when a pass's
  drawing changes inside one of its own steps of quantized time, `flicker` answers `{"verdict": "FAIL", "reseed":
  [{"op": "fx.slice_shift@1", …}]}`: one entry per such pass, `op` the operator's ID; any other field of an entry is
  the implementer's.
- `live`, *(ours)*:
  - `packs`, as `layers` and `view3d` take it.
  - A 2D session honours its `surface`: below internal scale 1 it draws at the scaled size and returns to the view's
    size through `upscale`, and its view's row says `"internal_scale": 0.5`. `capture` keeps the view's `final` PNG at
    the view's size in a frame the view draws, as it does at the base.
  - With `report: ["passes"]`, each pass a group's `passes` run is a row of `frames[].passes` with `"operator":
    "<the pass's op>"` (`fx.levels@1`), as #429's rows name an operator item; a frame that draws nothing lists none.
  - The document check sums each pass's declared cost × its group's pixels into the class's operator budget (figure:
    1 ms). A session over it is `{"session", "state": "refused", "issues": [{"code": "over_budget", "severity":
    "error", "ids": ["<op>", "<op>", "<op>"], …}]}`: `ids` the three costliest passes' operator IDs, the costliest
    first, and nothing else.

### `calibrate` (#429) *(ours: its pack rows)*

`graphs` gains one row per operator of fx@1: `{"name": "fx.levels@1", "origin": "pack", "declared_ns": <its
cost.ns_per_px>, "p95_ns": [5 numbers], "own_pass": true, "warmup": true}`, timed as the base times its other graphs:
at 1920 × 1080, in its own pass, five runs after a warm-up, in ns a pixel.

### `deep-show run`: `install_pack` and `packs` (#306)

```json
{"evidence": "<dir>", "packs": [], "calls": [{"call": "install_pack", "id": "deepbuild/fx", "dir": "<repo>/packs/fx-1.0.0"}, {"call": "packs"}]}
→ [{"outcome": "installed", "pack": "deepbuild/fx", "version": "1.0.0", "issues": [], "check_ms": 412.5}, {"packs": [{"pack", "version", "state": "installed", "checks": 1, …}]}]
```

The base's, with *(ours)*: `check_ms` on `install_pack`'s reply, the pack check's wall time in ms from reading the
folder to its verdict; and the refusal of a pack one of whose operators is named as a shipped operator is (`blur@1`):
`outcome: "refused"` with an error whose text holds that name. A refusal over one operator's graph names that operator
in an error's text (the base's does).

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there) *(all ours)*

Each changes nothing but what its row says, exits 0 and answers every call; the judge that passes the shipped program
fails on it, naming what the criterion says it names. `twins.json` maps each criterion's ID to its twin.

| Name | The wrong program | Criterion |
|---|---|---|
| `fx_levels_gpu_off_by_two` | In `check_operator`'s `reference`, the GPU run of the operator whose `id` is `fx.levels@1`, and of no other, writes red 2/1023 higher on every texel; the interpreter's run is the shipped one | AC1 |
| `slice_shift_seeded_by_frame` | `fx.slice_shift@1` draws its strips from `seed` and the film's frame number (⌊t × fps⌋ at `film2d`'s `fps`) instead of the step index, so its drawing changes at every frame; all else as shipped | AC7 |
| `invert_on_premultiplied` | `fx.invert@1` writes `1 − rgb` of the texel as the pass holds it, mixed in by `amount`, alpha kept: the base's operator | AC8 |
| `invert_without_alpha_guard` | Where a texel's alpha is under 1/16, `fx.invert@1` writes `rgb = 1 − rgb` and keeps the alpha; everywhere else it is the shipped operator | AC9 |
| `twirl_center_from_frame_origin` | `fx.twirl@1` measures `center` and `radius` from the frame's origin, in the frame's uv (`[0.5, 0.5]` is the frame's middle), not in the group's bounds: the base's operator | AC10 |
| `blur_radius_in_device_px` | Below internal scale 1, `blur@1` takes `radius` as px of the scaled target, so at 0.5 it reaches twice as far at design size; at scale 1 it is the shipped blur | AC11 |
| `key_keeps_color_at_alpha_0` | `fx.linear_color_key@1` gives a keyed texel alpha 0 and keeps its rgb, where the shipped operator writes (0, 0, 0, 0) | AC12 |

### Environment and files

- `DEEPBUILD_EVIDENCE_DIR`: where the taste test keeps its fifteen files (else `$TMPDIR/deep-161-evidence`), each as
  `<name>-<sha256>.<ext>`, e.g. `category-color-3f…9a.png`.
- `DEEPBUILD_TASTE_161`: the path of the recorded taste call, `{"criterion": "#161.2dcc0047", "by": "you",
  "screenshots": ["<sha256>", … 15], "call": "looks_right" | "looks_wrong"}`.
- `benchmarks/budgets.json`: the task `canvas-fx-pack` (Run them).

## The fixtures

Nothing is on disk; `helpers.ts`, `fixtures.ts`, `title.ts` and the test files build every document and picture.
`measures.ts` holds what is measured on a picture (the monotone cubic, a drawn quad's corners, a sliced frame's
strips, an edge's width); it draws nothing.

- **AC1, a picture per category** (`fixtures.ts`): 128 × 72 px, 8-bit premultiplied RGBA. A smooth base (two low
  sinusoids a channel) plus what the category's operators need to change something: color, a soft alpha field from 0
  to 1 and two flat 8 × 8 patches, premultiplied (0.8, 0, 0, 1) at (8, 8) and (0.2, 0, 0, 64/255) at (24, 8); blur, a
  soft bump under a soft alpha; distort and transitions, the base, opaque; stylize, two soft bumps; generate and
  channel, the base under a soft alpha; noise, 24 one-texel specks half a unit brighter; keying, a backing of
  (0, 1, 0) with a soft-edged warm subject and a soft shadow; matte, a soft-edged opaque disc on transparent. `fx.slice_shift@1`, in no
  list, runs on distort's picture.
- **AC2**: a 256 × 64 px black-to-white ramp in a group, 288 × 96 frame; an opaque 160 × 96 px card at (48, 32) in a
  256 × 160 frame, pinned to the quad (68, 56), (188, 44), (168, 116), (88, 104) px.
- **AC3**: the shipped folder, and four copies of it made in a temporary place, each with one operator changed.
- **AC4**: one group of five passes over a 32 × 32 px card in a 256 × 144 figure, and over a card that fills a
  1920 × 1080, 2560 × 1440 or 3840 × 2160 figure.
- **AC5**: a 208 × 96 board: three 144 × 24 px bands, each a gradient between two data roles 0.11 to 0.12 OKLab
  lighter and darker than fail, pass and running ((234, 80, 78) to (145, 0, 0); (58, 153, 77) to (0, 81, 0);
  (54, 136, 224) to (0, 63, 145)), in one group over an opaque white ground, with one status mark bound in state
  fail, under a `look@1` of those roles with the clean status map.
- **AC6**: a 256 × 144 figure, one group over two rectangles with passes `fx.levels@1`, `fx.radial_blur@1` and
  `fx.turbulent_displace@1`; still, and with its card sliding 40 px over 4 s.
- **AC7** (`title.ts`): the 539 × 208 title card in the shipped clean look: a ramp across it, forty 2 px ticks at
  uneven places, five block letters; `fx.slice_shift@1 {count: [2, 4], height: [10, 35], shift: [18, 64], step:
  98784000, seed: 9}`; 42 frames at 50 frames a second (a step is 7 frames).
- **AC8**: 240 × 160, a 3D writer layer (a camera, a small box in a corner, a sun). A 180 × 80 px fill of the role
  (231, 0, 0) at alpha 64/255 in a group, over an opaque black fill and an opaque fill of the role (0, 0, 170); read
  at texels (60, 80) and (120, 80).
- **AC9**: 257 × 129, a 3D writer layer. A group whose one child is a 33 × 33 px rectangle of the role (231, 0, 0) at
  (112, 48), centre texel (128, 64); passes `blur@1 {radius: 8}`, then `fx.invert@1` with `grow: 8`; drawn with no
  pass, with the blur alone and with both.
- **AC10**: 257 × 129, a 2D writer layer. A 129 × 65 px group: one rectangle and the odd squares of a 16 px checker,
  in two roles, at (16, 16) and at (53, 35); 23 cases.
- **AC11**: 256 × 96, 2D. A group of a black and a white 96 × 64 px rectangle meeting at x = 128, under `blur@1
  {radius: 8}`; three `live` sessions.
- **AC12**: 240 × 160, a 3D writer layer. A group of a 200 × 80 px backing of the role (0, 255, 0) and a 30 × 40 px
  square of the role (188, 188, 188), over an opaque white fill and an opaque black fill; `{key: [0, 1, 0]}`.
- **AC13**: ten sheets of 96 × 64 px tiles (a ramp, a bar, a block, a dot; keying's on a green backing), one tile an
  operator; the same picture at 288 × 192 for levels, curves and corner_pin; the title.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs`). Every `describe` and test title starts with `AC<n> #161.<id>`. Each file's header gives
its fixture, numbers and wrong programs.

| ID | File (tests) | What it asserts | What fails it |
|---|---|---|---|
| AC1 `#161.66726728` | `ac1-reference.test.ts` (2) | (1) The pack's list is the 70. Each drawn by `check_operator`'s `reference` over its category's picture at its defaults: both sides drawn (16 texels or more not (0, 0, 0, 0)), the picture changed (16 texels or more over two codes), at most 9 of 9,216 texels over one 10-bit code from the CPU side, no 16 × 16 window with more than 4 of them. Before that, the CPU side of `fx.invert@1` reads (0.2, 1, 1, 1) on (0.8, 0, 0, 1) and (a − r, a, a, a) on (0.2, 0, 0, 64/255). (2) Under the plant, the color fixture fails and every failure is `fx.levels@1`'s | The base (17 of 70); `fx_levels_gpu_off_by_two` |
| AC2 `#161.2bd9eeb2` | `ac2-spline-homography.test.ts` (1) | The f64 reference reproduces Fritsch and Carlson's published data within 5e-5. Every texel of the ramp under `fx.curves@1`, and under `fx.levels@1`, is within one code of the monotone cubic through its points at that texel's input, the input read from the ramp with no pass (200 or more inputs across 0 to 1; over half moved by more than 8 codes). Each corner of the drawn quad is within 0.5 px of `quad[k]`; the measure finds the unpinned card's own corners | The base (none of the three); a curve through other slopes (19 codes off on this data); a quad in another order or in frame uv |
| AC3 `#161.3c68daec` | `ac3-pack-check.test.ts` (2) | (1) The list is the 70; `install_pack` admits the folder with no issue, its row `installed` after 1 check; a copy whose `fx.invert@1` carries a `wgsl` field, reads its target at `step: previous`, or uses the op `internal.mip_chain@1` is refused with an error naming `fx.invert@1`. (2) A copy with one more operator named `blur@1` is refused with an error naming `blur@1` | The base (17 of 70; it admits `blur@1`) |
| AC4 `#161.f2821130` | `ac4-cost.test.ts` (2), `ac4-measured.test.ts` (1) | (1) All 70 declare `cost.ns_per_px` above 0. (2) The five costliest over 32 × 32 px: session `live`, drawn; over a frame where they cost twice 1 ms or more: `refused`, `over_budget`, `ids` the three costliest in order. (3) On a reference Mac: `calibrate` lists 70 rows of origin pack, each in its own pass with a warm-up and five runs and its own declaration; each largest p95 within 25% of the declaration | The base (17; no cost summed; no pack rows); a refusal naming the group |
| AC5 `#161.8352d648` | `ac5-status-guard.test.ts` (1) | The roles keep the distance and the bands' middles don't. With no pass and no binding 200 or more pixels lie within 0.10. With the binding, under each of the 70 and under `fx.invert@1 {amount: 0}`, no pixel outside the status mark's box grown by 2 px is within 0.095 OKLab of a status color | The base (53 unknown); an operator past the guard |
| AC6 `#161.729a03cd` | `ac6-budgets.test.ts` (3), `ac6-timed.test.ts` (1) | (1) `budgets.json` holds `canvas-fx-pack` as above and passes the lane's validator against the merge base's. (2) Each of the 70 graphs is accepted by `check_operator` and compiled off the UI thread. (3) Each of three operators is a named pass in a frame up to 3 of the still figure and in none from 4 on; in the moving figure, in every frame from 4 to 60. (4) On a reference Mac: `check_ms` under 2,000 and each operator's `compile_ms` under 20, five runs after a warm-up, by `judgeLimit` | The base (no task; 17; no named pass; no `check_ms`) |
| AC7 `#161.01550f9e` | `ac7-slice-shift.test.ts` (2) | (1) Every row of the clean title changes when moved 18 px. Each step's 7 frames share one pixel hash; each step differs from the one before; each step's first frame moves 2 to 4 strips of 10 to 35 rows by 18 to 64 px and leaves every other row equal to the clean title; frames 23 and 30 sought in fresh processes have the played hashes; `flicker.verdict` is PASS. (2) Under the plant the same judge finds a frame that differs inside a step, named with `fx.slice_shift@1`, and `flicker` is FAIL with `reseed` naming the op | The base (no such operator); `slice_shift_seeded_by_frame` |
| AC8 `#161.6de2bd55` | `ac8-invert-premultiplied.test.ts` (2) | (1) The layer is 3D; without the group the fills read opaque black and opaque (0, 0, 0.4); the group's own texel reaches the pass as (0.2, 0, 0, 0.25); the pass leaves it (a − r, a − g, a − b, a) with no channel above alpha; composited, the layer reads that over the blue fill and that over black. (2) Under the plant the pass leaves (0.8, 1, 1, 0.25) and the judge fails naming `fx.invert@1` | The base (its invert is the plant's); `invert_on_premultiplied` |
| AC9 `#161.99d85364` | `ac9-alpha-guard.test.ts` (2) | (1) The group's own texels: the patch is (0.8, 0, 0, 1) and its centre still is after the blur alone; under both passes the centre reads (0.2, 1, 1, 1), every texel outside the bounds grown by 8 px is (0, 0, 0, 0), 200 or more band texels are soft, and no texel holds a channel over one code above its alpha. (2) Under the plant the fixture and centre hold and the judge names the first texel, in the band, a channel above 0.9 over an alpha under 1/16 | The base (white band); `invert_without_alpha_guard` |
| AC10 `#161.1392976e` | `ac10-moved-group.test.ts` (2) | (1) For each of 22 operators and the chain: drawn (64 texels or more), the checker changed (64 or more), and at most 8 of 8,385 texels differ by more than one code between (16, 16) and (53, 35). (2) Under the plant `fx.twirl@1` fails, naming it and the first texel that differs | The base (frame uv; 20 unknown); `twirl_center_from_frame_origin` |
| AC11 `#161.8ed2354e` | `ac11-internal-scale.test.ts` (2) | (1) Each view is live, captured at the design size, and says the internal scale it was asked; the blur widens the edge by 3 px or more; the 10%-to-90% widths at 1 and at 0.5 are within 1 px. (2) Under the plant the width at 0.5 is 1.6 to 2.4 times the width at 1 and the judge's one failure names internal_scale 0.5 | The base (a 2D view always draws at 1); `blur_radius_in_device_px` |
| AC12 `#161.6c7f6fc1` | `ac12-linear-color-key.test.ts` (2) | (1) The fixture reads white and black under the group, and the group's own texels the backing (0, 1, 0, 1) and the grey square; keyed, the backing's own texel is (0, 0, 0, 0), the square is as it was, and composited the backing reads (1, 1, 1, 1) over white and (0, 0, 0, 1) over black. (2) Under the plant the backing's own texel is (0, 1, 0, 0), which over black is (0, 1, 0), and the judge fails naming `fx.linear_color_key@1` | The base (no such operator); `key_keeps_color_at_alpha_0` |
| AC13 `#161.2dcc0047` | `ac13-taste.test.ts` (1) | Fifteen files from this run's renderer are kept; `INCONCLUSIVE:` until a call by you on exactly their SHA-256s is recorded; `looks_wrong` fails | No call; a call on other files |

Proof line: "the per-category fixtures with their CPU references" is AC1; "the cost table measured on the reference
Mac" is `ac4-measured.test.ts`; "a film whose group passes name levels, radial blur and turbulent displace" is AC6's
still and moving figure, whose group names exactly those three.

## The oracle lane

`BLOCKED`. The issue's Oracle line links upstream tests for criteria 1 and 2 only. For criterion 1 they are an
upstream renderer's compositor render tests, one node file per operation drawn on its CPU and its GPU device against
one stored picture each, in the categories color, filter, transform and keying; for criterion 2, the same renderer's
corner pin node file with its stored picture. None has data our code reads as it is, and every one needs that
renderer to run; this machine has none. So no oracle test is written here.

- **What would unblock it:** a runner for the upstream renderer (#136) that draws those node files and hands their
  pictures and ours to one comparison. That is the lane's one unblock ask.
- **No criterion's proof leans on it.** Criterion 1's bound, one 10-bit code against our own CPU reference, is ours
  (the Oracle page says so), and its reference is held to the issue's own numbers. Criterion 2's reference for levels
  and curves has no upstream test; it is the published monotone cubic, held to Fritsch and Carlson's own data, and
  corner_pin's corners are the quad the test gives.

## Readings where the issue and the design leave a choice

- **The 70 IDs.** The issue's lists give names, not IDs; the base spells the blur list's `directional` as
  `fx.directional_blur@1`. The list's other four kinds of blur (`radial`, `channel`, `bilateral`, `compound`) are read
  the same way, `fx.<name>_blur@1`: the issue's own text says "radial blur" twice, and `fx.radial@1` beside
  `fx.radial_wipe@1` would name nothing. `sharpen` and `unsharp` are whole names. Every other operator is
  `fx.<name>@1`, and slice_shift is `fx.slice_shift@1`.
- **"Runs over all 69"** is read as all 70 wherever a criterion says each, every or no (1, 3, 4, 5, 6), since
  slice_shift is an fx@1 operator too. Criterion 10 names the blur and distort operators: the 22 of those two lists.
- **A fixture per category** is a picture (AC1) the category's operators run on at their defaults. slice_shift is in
  no category; it runs on distort's, since it moves texels sideways.
- **The CPU reference** is the f64 interpreter through `check_operator`'s `reference` (#431). Its harness has no
  group, so its bounds are the whole target and its scale is 1.
- **One 10-bit code** is 1/1023 of max(1, |reference|) per channel, alpha included (#429's and #431's reading), with a
  thousandth of a code of room for f32.
- **AC1's share and ceiling.** 99.9% of 9,216 texels leaves 9. The design asks every share for a ceiling and a window
  bound, set per fixture with a reason. A pixel ceiling can't be set for all 70: an operator with a step in it
  (threshold, posterize, a mosaic's cell border, a wipe's edge) may put a texel on the other side of the step in f32
  and in f64, and that texel is off by the whole step. So the 9 may be off by any amount, and the bound is on the
  window: no 16 × 16 window holds more than 4 of them, so a defect in one place can't hide in the share.
- **The reference as an oracle.** The design counts a CPU reference only once it reproduces a fixture whose numbers
  the issue states. Criteria 8 and 9 state invert's, so AC1 holds the interpreter's `fx.invert@1` to them first.
- **"Through spline"** is read on the output: the criterion can only see what levels and curves compute. The reference
  is the one the base's `spline@1` builds (and #431's suite holds it to): Fritsch and Carlson's monotone cubic with
  Fritsch and Butland's slopes. For levels the points are its two ends, the least the criterion needs.
- **Levels' and curves' inputs** are read from the same ramp drawn with no pass, so the answer doesn't rest on how a
  gradient is rasterized. AC2 runs in a 2D writer layer; the criterion names no space.
- **"Puts a quad's corners within 0.5 px"** is read on what is drawn: the half-coverage outline of the pinned card,
  its edges fitted as lines, their meetings the corners. `quad` is in uv of the group's bounds, by the scope's rule
  that positions are measured in the group's own bounds.
- **"By the pack's own check run"** is `install_pack`, the check a version gets once. Admission proves the three
  "never"s only if that check refuses them, so three changed copies go through it too. "An internal step" has no name
  at the base (every entry of its op table is public), so the copy uses an op the public table doesn't hold. "Reads an
  earlier frame" is the one form the base's graphs have for it, a target read at `step: "previous"`.
- **"Takes a shipped operator's name"** is an operator keyed and named `blur@1`.
- **"Measured cost within 25% of its declaration"** is |measured − declared| ≤ 0.25 × declared, measured the largest
  of five runs' 95th percentiles at 1080p (#429's reading), through `calibrate`.
- **"Stays within the figure class's operator budget or is refused naming the top three."** The budget is the design
  table's 1 ms. A pass's cost is its declared ns a pixel × its group's pixels (Frame and group: passes), read at full
  resolution since every pack operator declares `resolution: full`. The test stays a factor of two clear of the
  boundary on each side, so a group's grown band or rounding decides nothing. "Naming the top three" is the base's
  `over_budget` field `ids`, here the three costliest passes' operator IDs: the group is one item, so its ID would
  name nothing.
- **"Wherever status can show"** is a document with a status binding (The status-color rule), drawn by `layers`. The
  distance is the look's 0.10 in OKLab; a guarded pixel may sit 0.005 inside it after 8-bit rounding (#382's reading).
  Pixels in the status mark's own box, grown by 2 px, are the status color's and aren't judged.
- **"A fixture that tries"** for 70 unknown operators is a picture most of whose pixels sit within the distance before
  any operator runs, plus one pass that passes it through untouched. No test shows that each operator on its own
  pushes a pixel there.
- **The budgets' times** are read from the debug builds the suite's other files use, as #429's budget tests read
  theirs. "The pack checks" is `install_pack`'s check in a fresh process; "each operator compiles" is
  `timing.compile_ms`, the compile alone, the process's first of that operator.
- **"A still canvas dispatches none"** is a `live` session of a figure nothing moves, judged from frame 4 on (#429's
  reading; `live` numbers its frames from 1), against the same figure moving.
- **The title** is a card of rectangles, not text: the criterion's rows need a picture every row of which changes when
  it moves, and the result must not hang on a font.
- **slice_shift's `step`** is 98,784,000 flicks; at 50 frames a second a step is 7 frames exactly, so a frame is
  never on a step's edge. "Identical" is the frames' pixel hashes; "different across steps" is each step against the
  one before (two steps apart may draw alike).
- **A strip** is a run of rows that share one shift. A moved row is judged only where its source is on the card, so
  what fills the px a strip vacates (the ground, the row's other end, its edge) is the implementer's. A shift may be a
  fraction of a px: the clean row is then read between texels, within 3 codes of 8 bits on 95% of the row. Two strips
  that touch and share a shift would read as one; the test takes that as a fail of the strip's height only past 35 px.
- **"Seeking equals playing"** is `film2d` with `from` in a fresh process against the played frame's hash (#430's
  reading). **"The flicker check"** is `film2d`'s `flicker` (#464's reading).
- **"Fails, naming the op"** (criterion 7) is read twice: the suite's judge names `fx.slice_shift@1` on the frame that
  differs inside a step, and the flicker check answers FAIL with `reseed` naming it (design: Flicker check, `reseed`).
- **The issue's numbers on 8-bit roles.** A document's colors are roles, 8-bit sRGB. Linear 0.8, 0.4 and 0.5 have no
  8-bit sRGB value within one 10-bit code: the nearest are 231 (0.7991), 170 (0.4020) and 188 (0.5029), and alpha
  0.25 is 64/255 (0.2510). So each of AC8, AC9 and AC12 reads what reaches the pass from the same figure drawn with
  no pass, holds it to the criterion's value within the role's step (1.5 codes for the fill and the patch, 2.5 for the
  blue, 3.5 for the grey), and holds the
  operator's result to one code of the criterion's arithmetic on that reading: a − c for invert, the composite over
  the fill, 1 − c at the patch's centre, "leaves the square" for the key. A right program is never failed for a
  role's rounding, and a wrong one is still codes away.
- **A texel of a 3D writer layer.** The base composites a 3D writer layer's 2D items over its scene's picture, which
  is opaque (the look's ground where the scene draws nothing), so the layer's f32 never shows a group's own alpha.
  "Leaves it at (0.05, 0.25, 0.25, 0.25)", "(0, 0, 0, 0) everywhere outside", "no texel holds a channel above its
  alpha" and "writes (0, 0, 0, 0) on the backing" are about the group's own texels, so they are read from #430's
  `blend_inputs` `source`, which the base answers for a group whose `blend` isn't `normal`: the group after its
  passes, isolated over transparent. The group is drawn once with `blend: "subtract"` for that reading and once with
  no `blend` for **"the group composites to"**, "over white" and "over black", which are the layer's f32 where the group
  lies over an opaque fill. No field is added for it.
- **A texel of alpha 0 that holds color.** Criterion 12's planted keyer "reads (0, 1, 0) over black": premultiplied
  (0, 1, 0, 0) over black is (0, 1, 0) by plain premultiplied over, its rgb added whatever its alpha. The base's group
  compositor leaves what lies under a texel of alpha 0 as it is, so the layer would hide the planted keyer. "Over
  black" is therefore read twice: on the layer (the shipped program's (0, 0, 0)), and as premultiplied over on the
  group's own texel. The planted test passes when the plant shows in either place; the base shows it in neither (its
  `source` answers (0, 0, 0, 0) for a texel a pass wrote as (1, 1, 1, 0)), so one of the two is the implementer's to
  make true.
- **Criterion 9's centre.** The base's `blur@1` leaves a flat texel 1.2 codes low (0.7979 for 0.7991: its 31 weights
  don't sum to one in f16). That is the blur's, not the invert's, so the test reads the centre as the blur alone
  leaves it, holds that to the criterion's (0.8, 0, 0, 1) within 3 codes, and holds the invert to one code of 1 − it.
- **"(0, 0, 0, 0) everywhere outside its bounds grown by 8 px"** is every texel of the group's own there, exactly 0.
  The patch is one rectangle, so the group's bounds are the patch. The base draws these two passes inside that box.
- **Criterion 10's space** is a 2D writer layer; the criterion names none. "At its defaults" is `params: {}` with no
  `grow`. "Inside its bounds" is the 129 × 65 px box.
- **`internal_scale`** is a live view's (`live`, #386's `surface`). The picture is the view's `final`, at the design
  size, after a bilinear upscale with no sharpen, so the blur alone shapes the edge. The 10% and 90% levels are of the
  way from the black level to the white, on the mean of r, g and b.
- **"Keyed to the backing color"** is `key: [0, 1, 0]`, linear, the space a 3D writer layer's pass sees.
- **The taste call** follows the base's newest (#2760): files in `DEEPBUILD_EVIDENCE_DIR`, the call in a file
  `DEEPBUILD_TASTE_161` names. "One fixture per effect category" is a sheet that shows every operator of the category.

## Contradictory or untestable as written

- **69 or 70.** The scope says "69 composed pass operators" and "every criterion runs over all 69", and also "adds the
  other 52 and slice_shift": 17 + 52 + 1 is 70. The tests hold the pack to 70.
- **"On a fixture per category"** and slice_shift, which has no category (above).
- **A group's own texels in a 3D writer layer** can't be read from the layer (above); criteria 8, 9 and 12 are read
  through #430's `blend_inputs`.
- **Linear values that no 8-bit role holds** (above): the criteria's (0.8, 0, 0), (0, 0, 0.4), (0.5, 0.5, 0.5) and
  alpha 0.25 are met to the role's step, not to one code.
- **"Every operator's measured cost"** can only be judged on a reference Mac at rest; anywhere else it is
  `INCONCLUSIVE`.
- **Criterion 5 for every operator.** The guard is one pass after the operators, so the test shows it reaches each
  operator's pixels; it can't show that each operator would have produced a clashing pixel.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- What any operator computes beyond its CPU reference and the numbers criteria 2, 7, 8, 9 and 12 give. No test holds
  an operator to a formula of this job's.
- Every param "typed with units, ranges and defaults and taking channels" (a scope line; the base's unit test in
  `fx.rs` reads the first three); a param driven by a channel.
- `grow` as a field of each operator; "calls the shipped blur for large blurs"; "32 fetches a pixel, repeats of at
  most 64" beyond the pack check's admission.
- An fx@1 operator in a backdrop or as a transition's operator; "takes a LUT image" as a refusal.
- "A texel of alpha 0 leaves every operator but a generate one at (0, 0, 0, 0)" for all operators (AC9 and AC12 read
  it for invert and the key); color operators other than invert dividing by alpha.
- Positions in the group's bounds for operators outside the blur and distort lists (a wipe's edge, a generator's
  centre); a param in px in an export; px params other than `blur@1`'s radius below scale 1.
- The other keying operators' premultiplied output.
- p50 and p95 against the merge base beyond the perf lane's task.

## What the implementer adds outside this folder

- The 53 operators in `packs/fx-1.0.0/pack.json`, and what the surface above marks *(ours)*.
- The seven planted programs in `deep-gpu`'s `--planted` table.
- `scripts/lanes.mjs`: the two `timed` entries (Run them).
- `benchmarks/budgets.json` and `benchmarks/canvas.mjs`: the task `canvas-fx-pack` and its mode (Run them).
- The taste call, by a person: the fifteen files shown and attached to the PR, and the record `DEEPBUILD_TASTE_161`
  names.
