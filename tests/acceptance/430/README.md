# Acceptance tests for #430: GPU operators — a group's passes, backdrop groups and the eleven blend modes

Written first, from issue #430 (its scope, fields, five acceptance criteria and proof line), its Oracle page
(`doneright/oracles/issues/430.md` in `DeepBuildAI/deepbuild`, branch `doneright`) and the WPT files it pins, the design
sections it links and those they lean on, and base commit `80ba48fe` ("Merge pull request #1403 …"), by a job that never
saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, at most two tests each, plus the
planted twins the criteria need.

What was read:

- `docs/canvas-primitives.md`: Frame and group; Frame and group: draw order, blend modes, passes, backdrop; GPU
  operators, as data (GPU operator, Operator input and output, Place in the frame, Compile, validate and cache, pass
  fusion, Determinism class, Status guard, Shipped operators and composed graphs, Draw path, Every public step: Color and
  Seeded); Pack: fx@1 named operators; the status-color rule.
- `docs/technical-design.md`: Dogfooding; the parity suite's rules (a CPU reference as an oracle, a tolerance's ceiling);
  Every task carries its own budgets.
- At the base: AGENTS.md; `tests/acceptance/385/`, `428/`, `429/` (READMEs, helpers, a test or two each);
  `crates/deep-gpu-layer/src/{main,marks2d,film,effects,view3d,parity}.rs`; `crates/deep-canvas/src/steps.rs` (`hash`,
  `rand`); `packs/fx-1.0.0/pack.json`; `crates/deep-canvas-marks/looks/clean.json`.

What the base already does and these tests don't credit: `blend` takes #385's 17 modes through Vello; `layers`,
`window2d` and `film2d` draw 2D writer layers; #429's composed `gpu.pass@1` items run in a view's chain; fx@1 holds 17
pack graphs, among them `fx.directional_blur@1` and `fx.invert@1`. Nothing runs a group's pass (only draw order's isolation test looks at the field), nothing reads `backdrop` or `dancing`, the
eleven modes don't exist and no 2D call answers a float or a pixel hash.

## Run them

They build `deep-gpu` and drive the GPU, so they run with `--no-file-parallelism`, and `scripts/lanes.mjs` needs this
folder in its `alone` list beside `tests/acceptance/385/` and `429/`. This README is the instruction; the implementer
makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/430 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/430    # type-check
```

Each file builds its binary once (`cargo build --locked --bin deep-gpu`), copies it to a temporary folder and fails each
test that uses it if the build failed. Each test writes into its own temporary folder and deletes it. Delete Vitest's
cache in `tests/acceptance/430/node_modules/.vite` after a run.

- Everything is headless. Anything the GPU layer draws runs on Metal: off macOS a test fails `INCONCLUSIVE:`, never
  passing. `film2d` and `window2d` open the headless window #385 and #417 use.
- No test here takes an outside input, so none reads `BLOCKED`. The oracle's Blender row stays open: see The oracle page.
- `BASE-FAILURE.txt` says why the suite can't pass at the base; it wasn't run there beyond the type-check.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged (one
scenario `{"out", "calls"}` per line, one `{"ok": true, "replies"}` line back, files under `out` named by SHA-256), the
document fields the issue names, more fields on two calls, and eleven planted programs.

### The document

- `group@1` `params`, as the issue gives them:
  - `passes: [{"op": name@major | <gpu.pass@1 item ID>, "params": {…}, "grow": u}]`; `grow` defaults to 0.
  - `backdrop: "none" | "below"`.
  - `blend`: the suite uses `subtract`, `divide`, `linear_burn`, `linear_dodge`, `linear_light`, `vivid_light`,
    `pin_light`, `hard_mix`, `darker_color`, `lighter_color`, `dissolve`.
  - `dancing: bool`.
- A composed pass is #429's item: kind `gpu.pass@1`, an item of the group's writer layer, its operator fields in
  `params`. These fixtures give it `origin`, `about`, `inputs: {"src": {"type": "texture", "from": {"texture":
  {"target": {"op": "core", "output": "color"}}}}}`, `steps`, `outputs: {"color": "out", "blend": "replace"}`,
  `resolution: "full"`, `cost`, `fallback`, and no `chain` or `order`.
- **New reading, the one thing these documents need that the design doesn't spell out:** an operator a group's `passes`
  names runs there and nowhere else, not also in the view's chain; and inside a group, its `core` `color` texture input
  is the group's target (the previous pass's result for all but the first; with `backdrop: below`, the copy of what its
  writer layer drew). `pixel@1` + `load@1` offsets and `screen_uv@1` + `sample@1` both have to read that target at the
  place they name, in the px of the frame, whether or not the target is cropped to bounds + grow.
- Documents name the pack as `packs: ["deepbuild/fx@1.0.0"]`.

### `layers` (#385's call): fields added

```json
{"call": "layers", "doc", "look", "t"?, "states"?, "by": ["gpu_layer"], "float"?: true, "packs"?: [folder | {"id", "dir"}]}
```

- `packs`: as `view3d` takes it, installed before the document's check.
- `float: true` adds to a `gpu_layer` side:
  - `"f32": sha256`, a `<sha>.f32` file of the layer as the GPU layer holds it: RGBA little-endian f32, rows top-down,
    `w × h × 16` bytes, **premultiplied**, in the space the layer composites in (sRGB-encoded in a 2D layer, linear light
    in a 3D one). It holds the group's blend at 10 bits or better: a file read from an 8-bit target can't meet AC3.
  - `"blend_inputs": [{"group": ID, "mode": blend, "backdrop": sha256, "source": sha256}]`, one per group whose `blend`
    isn't `normal`, each an `.f32` file as above: what its own layer drew before it, and its content drawn isolated over
    transparent; the same inputs the blend took (#385's `blend_inputs`, on this call). The test holds them to independent
    draws within 1.01/255 before using them.
- `path` stays #385's, and reads `gpu_layer` for a 2D writer layer with passes or with one of the eleven.
- Its `png` stays #385's: straight alpha, 8 bits.

### `film2d` (#417's call): fields added

```json
{"call": "film2d", "doc", "look", "fps"?, "frames", "from"?: n, "hash"?: true}
```

`from` (default 0) opens the film at that frame with nothing drawn before it; the film draws frames `from` to `from +
frames − 1`, and each reply row's `frame` is that absolute index. `hash: true` adds to each row `"pixel_hash"`: the GPU
pixel hash of the frame's surface (`view3d`'s `pixel_hash`, the core's `pixel_hash@1`), so `film2d` draws passes and the
eleven modes as `layers` does.

### `window2d` (#385's call)

Unchanged. It draws a backdrop group and passes in `main` on the GPU surface, with `under` on GPUI, as `layers` names.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `group_pass_at_layer_end` | A group's passes run after the whole writer layer is drawn, over the group's bounds + grow, so an item drawn after it is blurred too | AC1 |
| `group_pass_reads_earlier` | A group's target starts from what its layer drew before, so the blur smears earlier items | AC1 |
| `group_pass_past_grow` | A blur reads and writes past bounds + grow: the pass runs over the whole frame | AC1 |
| `backdrop_reads_other_writer` | A backdrop reads the frame composited so far, another writer's layer in it | AC2 |
| `backdrop_reads_later_items` | A backdrop runs after the whole writer layer is drawn, so it reads items drawn after it | AC2 |
| `backdrop_past_coverage` | A backdrop's result replaces its bounds + grow, not its coverage | AC2 |
| `backdrop_reads_status` | A backdrop reads status colors (the status mark drawn into its copy) | AC2 |
| `vivid_light_as_linear_light` | `vivid_light` runs the linear light formula | AC3 |
| `dissolve_reads_playback` | A dancing dissolve keys its hash by the session's frames drawn, not ⌊t × frame_rate⌋ | AC3 |
| `pass_linear_in_2d` | A pass in a 2D layer decodes to linear light and encodes back | AC4 |
| `pass_encoded_in_3d` | A pass in a 3D layer encodes to sRGB and decodes back | AC4 |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped.
Each test's name starts with `AC[n] #430.<id>`.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `AC1 #430.e93f3c0b` | 1: a blurred group at its draw order | `group-passes.test.ts`: the fixture's answer in f64 (the square's 25-tap blur, cut at bounds + grow, at opacity 0.75, over the before bars, under the after bar); 0 codes outside bounds + grow and on the after bar, 2 inside; grow 3 under radius 6. `fx.directional_blur@1` by name, grow 16: nothing past it, the after bar sharp, the group moved. Twins: the three `group_pass_*`. |
| `AC2 #430.618fe52c` | 2: a backdrop group | `backdrop.test.ts`: each layer alone: the blur of `main`'s own earlier rectangles inside coverage to 2/255, `under` and the outside of coverage 0 codes, the after bar sharp, nothing of `under` in `main`; WPT's two no-root figures on their own answers. The window: with and without the group, in both status states: status pixels, the card and the other writer's pixels 0 codes, and the flip moves only the status mark's own pixels. Twins: the four `backdrop_*`. |
| `AC3 #430.09804d01` | 3: the eleven modes; seek equals play | `blend-modes.test.ts`: `reference.ts` reproduces its stated numbers; the inputs held to independent draws; the figure tells all twelve apart on at least 10% of its pixels; each mode within one 10-bit code on 99.9%, 2 codes off a formula's discontinuity. Dancing: frame 90 sought in a fresh process has frame 90's played hash; two plays agree; frames 30, 89, 90 differ; undancing frames 30 and 90 agree; frame 90.5 is the reference at 90 on 99.9%. Twins: `vivid_light_as_linear_light`, `dissolve_reads_playback`. |
| `AC4 #430.f859c44c` | 4: the pass's space | `spaces.test.ts`: the fill's interior, by the PNG, exactly (200, then 100) in 2D, exactly (200, then 146) in 3D; the 3D f32 at 0.578 then 0.289 to the criterion's three digits. Twins: `pass_linear_in_2d`, `pass_encoded_in_3d`. |
| `AC5 #430.9e7e049e` | 5: shown to you | `taste.test.ts`: below. |

Proof line: "group and backdrop fixtures with every pixel outside their bounds unchanged" is AC1's and AC2's 0-code
checks; "each blend mode against its CPU reference" is AC3's first test.

## The taste call

`taste.test.ts` writes, from one run, the renderer's own pictures to `docs/evidence/430/`: `blurred-group.png` (AC1's
figure with a grow that reaches the blur's whole radius), `backdrop-group.png` (AC2's `main`), `blend-<mode>.png` for each
of the eleven, byte for byte the renderer's PNGs, and `dancing-dissolve.apng`, an animated PNG of frames 0 to 29 drawn by
`layers`, at 15 frames a second. It prints each SHA-256. Show them to the owner, attach them to the PR, and record the one
call in `tests/acceptance/430/TASTE.json`:

```json
{"issue": 430, "criterion": "#430.9e7e049e", "verdict": "looks_right" | "looks_wrong", "who": "…", "when": "<ISO 8601>",
 "screenshots": {"<name>": "<sha256>", …}, "note": "…"}
```

`screenshots` names all fourteen. No file, or one made on other pictures, is `INCONCLUSIVE:`; `looks_wrong` fails.
No other test reads these pictures or the call. The issue's "shown to you" has no section in the design; this is the
form #428's suite uses.

## The oracle page

| Row | Status |
|---|---|
| WPT `backdrop-filter-paint-order.html` | **Ported as behavior.** What's painted after the filter is no part of its backdrop: `later`, inside coverage, with the pixels beside it held to the blur of the earlier rectangles alone. WPT's green boxes sit beside its filter box; here the bar sits inside coverage, so a tap can't reach it past the unjudged edge band. |
| WPT `backdrop-filter-clipped.html` | **Ported, on WPT's colors and answer**: `#ff7fff` under a filter in a rounded clip, invert, "A green box": (0, 128, 0) within one code. A frame with `overflow: mask`, radius 1, stands for the parent; a composed premultiplied invert for `invert(1)`. |
| WPT `backdrop-filter-isolation-isolate.html` | **Ported, on its geometry and answer**: a filter in an isolated parent reads both boxes, the one outside the parent included. Its overlap reads inverted in both. The page's yellow filter background is left out, so the answer is the plain invert. |
| WPT `backdrop-filter-backdrop-root-{opacity,filter,mask,clip-path,mix-blend-mode}.html` | **Not ported.** Each makes an ancestor the Backdrop Root. Ours has one root, the writer layer, and no ancestor group makes another, so the rule that survives is the writer layer's: `under` in `main`'s backdrop is `backdrop_reads_other_writer`. These files' pictures don't apply. |
| Blender sequencer `blend_modes_float`, `sequencer_render_tests.py`; compositor `node_mix_{divide,substract,linear_light}.blend`, `compositor_render_tests.py` | **Could not run**: they need Blender, and the page says its formulas must match ours before its images serve as answers. The published formulas stand in (`reference.ts`), as asked. So by the technical design's rule ("a CPU reference counts as an oracle only once it reproduces at least one fixture whose expected numbers … the formula source its oracle page names gives") **AC3's reference is checked only against numbers worked by hand from those formulas and its identities, and against its own planted twin.** That gap is open until someone runs Blender. |
| Criteria 1, 4 and 5 | No upstream test, as the page says. |

## Readings where the issue and design leave a choice

- **A group's bounds** are its children's drawn bounds: a group "has no bounds of its own", so "bounds" in Frame and group:
  passes can't be anything else. Bounds + grow is that box grown on every side.
- **A pass cut at bounds + grow** is cut hard. AC1 sets grow under the blur's radius so the cut shows.
- **Each `passes` entry has its own `grow`.** Whether they accumulate is left open: AC1 uses one pass.
- **Backdrop coverage.** "Inside the group's coverage, and the result replaces those pixels": AC2 judges inside coverage
  only where every tap lands inside coverage too, and doesn't judge the band a blur's reach wide along its edge, where
  what a tap past coverage reads is the implementer's (with `grow` = the reach, the design's "copy … at the group's
  bounds" would read real pixels). Outside coverage, 0 codes.
- **Nothing outside changes** means 0 codes on the PNG against the same figure with no group, by the same renderer: it
  says "nothing", and the proof line says "unchanged".
- **Group content over transparent.** A premultiplied blur of what the layer drew over a transparent area gives partial
  alpha, and the file says so; AC2's reference is the mean of premultiplied color.
- **The eleven's formulas.** The design says they're "shipped as WGSL and reviewed with the app" and gives only names.
  `reference.ts` holds the published forms in W3C's general form on sRGB-encoded inputs. Darker and lighter color compare
  W3C's Lum, since the group's other non-separable modes do; Photoshop's total of the channels would differ. Divide reads
  0/0 as 0 and x/0 as 1. The figure's source stops sit off 0 and 1, so these poles decide no pixel of a gradient's ends.
- **Dissolve's hash.** The design's `hash(document seed, item ID, pixel)` is read in its own vocabulary: `seed` is the
  operator input "hash of the document seed and item ID", `hash` and `rand` are the public steps, the pixel is (x, y) in
  device px, and "under the group's opacity" is `rand(hash(seed, x, y)) < opacity`. "Adds the video frame index to the
  hash" is a fourth argument: `rand(hash(seed, x, y, frame))`. A kept pixel is the source over the backdrop at full
  strength; the rest are the backdrop. `reference.ts` holds those steps as `crates/deep-canvas/src/steps.rs` and
  `item_seed` define them at the base.
- **One 10-bit code value** is per channel, alpha included: the difference of `round(v × 1023)`.
- **AC3's ceiling.** The technical design's rule sets a ceiling beside any share; the fixture's is 2 codes, off a formula's
  discontinuity (pixels a 1e-5 nudge of the source jumps): reference and renderer see equal inputs, so a continuous formula
  has no way to stray further. A discontinuity's pixels fall to the 0.1%.
- **Seeking** is `film2d` with `from`, in a fresh process; **playing** runs from frame 0. "The played frame" is frame 90 at
  60 fps, the document's default `transport.frame_rate`.
- **A fill that reaches it at linear 0.578** is a `rect@1` of role `fill200` in a group in a 3D writer layer, under the
  role map's look (no tone map, unit exposure). The control is the same group with no pass.
- **Halves each channel** means r, g and b; alpha stays, so the fill stays opaque.
- **Blurs in AC1 and AC2 are composed graphs** with a known kernel, so the answer is arithmetic. The pack's blur shows a
  name reaches a group; its `direction` is in uv of a target whose extent is the implementer's, so it has no f64 answer.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof). They are in the issue's
fields or scope and in no acceptance criterion:

- A shipped pass operator by name in `passes` (the base's shipped library has no `blur` by that name; the Oracle page's
  "composed pass split around the shipped blur" has no criterion either).
- Refusals: a ninth pass; `backdrop` with no passes.
- A group with no children covering its frame.
- `blend(mode)` as a step, for every mode but dissolve.
- The eleven in a 3D writer layer's linear light.
- The status guard moving a pass's pixels; AC2 proves only that a backdrop reads and covers no status color.
- More than one pass in order, and `grow` across passes.
- `z_inside_isolated`, the isolation count and the Vello CPU golden of a 2D layer with passes ("display only").
- Budgets. The design's "Every task carries its own budgets" says an issue's criteria name them, and #430's name none, so
  no timing test exists here. That's a gap in the issue, for the owner, not a pass.
