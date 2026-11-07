# Acceptance tests for #431: GPU operators — spline, homography, HSL, sample_grad, backdrop, shadow_filter, periodic noise and the velocity and emission targets

Written first, from issue #431 (its scope, nine acceptance criteria and proof line), its Oracle page
(`doneright/oracles/issues/431.md` in `DeepBuildAI/deepbuild`, branch `doneright`) and the three upstream files it pins,
the design sections it links and those they lean on, and base commit `c12a65bb` ("Merge pull request #1281 …"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, plus one per planted
twin a criterion names.

## What was read

- `docs/canvas-primitives.md`: GPU operators, as data (GPU operator; Step and the closed step list, with the derivative
  rule, `backdrop`, the period and `cells`; its structural steps; Operator input; Operator output and `shadow_filter`;
  Place in the frame; Compile, validate and cache, with the f64 interpreter; Operator cost and limits; Determinism
  class; Shipped operators and composed graphs: pack graphs and step functions; Every public step); Effect and GPU
  operator: target inputs (velocity and emission); Motion blur; Motion blur: velocity; Material (transmission's copy of
  the opaque scene); Material: texture maps (filtering along a footprint, `filter_taps`); Light policy: colored shadows;
  Meter and degrade ladder; Pack.
- `docs/technical-design.md`: GPU operator; Numbers version 0 has to hold; Dogfooding.
- The Oracle page's files, fetched from the vendored copies on the `doneright` branch: SciPy `e4e854eaa8`
  `scipy/interpolate/tests/test_polyint.py:543-670` (TestPCHIP), OpenCV `40738fb16c`
  `modules/imgproc/test/test_imgwarp.cpp:1082-1112` (issue_26916) and its license header, gpuweb/cts `e325d0bcc2`
  `src/webgpu/shader/validation/uniformity/uniformity.spec.ts` ('basics', 'functions').
- At the base: AGENTS.md; `tests/acceptance/429/` (README, helpers, taste, refusals, steps), `419/` (README, helpers,
  velocity-seek, taste), `424/` (helpers, taste), `430/` (README, BASE-FAILURE, TASTE.json), `483/` and `484/` (their
  surface sections), `379/` (the `live` call and memory); `crates/deep-gpu-layer/src/{main,effects,opframe,view3d,live,
  session3}.rs`; `crates/deep-canvas-effects/src/{check,graph,interp}.rs` (fields only); `crates/deep-canvas/src/steps.rs`
  (the op table); `scripts/lanes.mjs`.

What the base already does and these tests don't credit: the op table has `noise@1` and `fbm@1` with a scalar
`period`, `octaves`, `lacunarity` and `gain`, and refuses fbm with a period and a fractional lacunarity; the check
refuses `ddx`, `ddy`, `fwidth` and a `sample` with no `lod` inside a repeat with a `stop_if` with `operator_kind_rule`
at the step, its reason in the message only, and holds a material to 16 fetches whatever its class; `view3d` has `read`,
`seeks`, `pre_tone` and `assets`; `check_operator` has `assets` and #483's frames; `live` reports each writer's meter
count. There is no `spline`, `homography`, `sample_grad`, `backdrop`, `noise3`, `cells`, `use` or HSL step, no velocity
or emission target an operator may read, no `backdrop` target, no `reference`, `packs` or `class` on `check_operator`,
no target rows in the meter's count, and none of the planted names below. So these tests define the surface below.

## Run them

They build `deep-gpu` and draw on the GPU, so they run one file at a time, and `scripts/lanes.mjs` needs
`'tests/acceptance/431/'` added to its `alone` list beside `tests/acceptance/429/` and `483/`. This README is the
instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/431 --no-file-parallelism
npx tsc -p tests/acceptance/431/tsconfig.json   # type-check
```

Each file builds its binary once (`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-gpu`),
copies it out of `target/debug` to a temporary folder and fails each test that uses it if the build failed. Each test
writes into its own temporary folder and deletes it. Delete Vitest's cache in `tests/acceptance/431/node_modules/.vite`
after a run.

- Everything is headless and draws on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never
  passing. No criterion here names a time, so no test is gated on a reference Mac or on load.
- `taste.test.ts` keeps its four screenshots in `DEEPBUILD_EVIDENCE_DIR` (else `$TMPDIR/deep-431-taste`) and reads the
  taste call from the file `DEEPBUILD_TASTE_431` names (#429's convention); without it the test fails as `INCONCLUSIVE:`.
- `BASE-FAILURE.txt` says why the suite can't pass at the base; it wasn't run there beyond the type-check.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged (one
scenario `{"out", "calls"}` per line, one `{"ok": true, "replies"}` line back, files under `out` named by SHA-256),
#429's operators as data, new public steps, fields on `check_operator`, `view3d` and `live`, and seven planted programs.

### Operators, as these tests write them

#429's form: `{id, kind, origin: "composed", about, inputs, steps: {id: {op: "name@major", args}}, outputs, cost, …}`;
in a document an item `gpu.<kind>@1` of its writer's layer, its fields in `params`, a material attached by a
`material@1`'s `params.op`. Documents require `{scene3d: "^1", effects: "^1"}` and name a budget class.

- **Inputs used.** `{type: "texture", from: {texture: {target: {op: "core", output: "color" | "velocity" | "emission"}}}}`
  (velocity: rg16float, device px over the shutter at t ± s/2, x to the right; emission: rgba16float, the emitted
  radiance of what shows, before bloom; each built only when some operator or effect of the frame reads it);
  `{type: "texture", from: {texture: "<sha256>"}}`, a PNG the call's `assets` names; #483's storage data inputs.
- **Steps** (each a public entry of gpu.step@1, with its CPU reference in the f64 interpreter):

| Step | Args, as these tests write them | Result |
|---|---|---|
| `spline@1` | `{points: [[x, y], …], x}`; `points` a literal list of 2 to 16 points, x increasing. 17 points, or `points` naming an input (an image), is refused with an error whose `step` names it | f32: the monotone cubic (Fritsch–Carlson, as PCHIP builds it) at x |
| `homography@1` | `{quad: [[x, y] × 4]}`, a literal | mat3x3 H, square to quad in closed form: `mul@1 {a: H, b: vec3(u, v, 1)}` then x ÷ z, y ÷ z takes the unit square's corners (0, 0), (1, 0), (1, 1), (0, 1) to `quad[0]` … `quad[3]` |
| `sample_grad@1` | `{tex, uv, dx: vec2, dy: vec2}` | vec4, the level from the gradients given (with the look's `filter_taps`) |
| `backdrop@1` | `{uv, lod}` (material operators of see-through parts) | vec4 from the copy of the opaque scene at uv and mip lod |
| `noise@1`, `noise3@1`, `fbm@1` | `{p: vec2, seed, period: [8, 8]}`; fbm also `octaves`, `lacunarity`, `gain`; `period` a list, one whole number of lattice cells per axis of p | f32; noise3 vec3 |
| `cells@1` | `{p: vec3, seed, jitter: 0..1, metric: "euclidean" \| "manhattan" \| "chebyshev"}`, unit cells | ports `f1`, `f2`, `id`, `center`, read as `<step>.f1` |
| `use@1` | `{name: "<pack>.<fn>@major", <in port>: arg, …}` | the function's out ports, read as `<step>.<port>` |

- **A pack's step function**, as `pack.json` holds it: `functions: {"pom.edge@1": {about, ports: {in: {x: "f32"}, out:
  {w: "f32"}}, steps: {w: {op: "fwidth@1", args: {x: "x"}}}}}`; each out port is the body step of its name. A call
  counts as the derivatives its body holds.
- **Repeat bodies** (#429's `repeat@1 {count, index, accumulate, body, stop_if}`): inside a body an accumulator's name
  reads its value at the trip's start; the body step named after it gives its next value; `<repeat step>.<name>` is its
  value after the last trip (the trip whose `stop_if` was true included).
- **Small forms these tests lean on**: `compose@1` with `x, y` gives a vec2 and with `x, y, z` a vec3; `const@1`
  types `"vec2"`, `"vec3"`, `"u32"`; `split@1` picks `x` … `w`; `select@1 {f, t, cond}` with a bool cond and vec3 sides;
  `pixel@1` a vec2<u32> in a material; `load@1 {tex, ixy: pixel}` in a pass.
- **The refusal's form**: `{code: "operator_kind_rule", severity: "error", step: <the step's ID, or a path ending in
  it>, reason: "derivative_in_divergent_flow"}` — the design's `operator_kind_rule {step, reason}`, `reason` a field —
  with `reached` showing no naga.

### `check_operator` (#380, #429, #483): fields added

| Field | Form | Meaning |
|---|---|---|
| `assets` | `{sha256: path}` | as at the base: texture inputs by hash load from these files |
| `packs` | `[{"id", "dir"}]` | as `view3d`'s: packs installed before the check, so `use@1` resolves their functions |
| `class` | a budget class, as a document's `budget.class` | the class the check's limits apply under; absent, as today. AC6 passes `"showpiece"`: its loop's 32 fetches are a material's 17th to 32nd, which Operator cost and limits allows only in the showpiece and export classes |
| `reference` (single `operator`) | `{"size": [w, h]}` | once the operator passes and runs, it is drawn once by #429's step harness at `size` (a material as the material harness draws it: a full-screen surface, each pixel its base color plus emission, alpha 1; a pass over its inputs) on this GPU and through the step graph's f64 interpreter. Reply adds `reference: {"size", "gpu": sha256, "cpu": sha256}`, two `.f32` files, RGBA rows top-down. `reference` doesn't switch the call to a frame |
| `reference` (frame form) | `true` | each `dispatches[k]` adds `reference: {"<op>.<output>": Read}`: the f64 interpreter run over the same `data`, each output written as its `read` is (storage as `.u32` words holding the f32 bits) |

### `view3d` (#378, #419, #483, #484): target added

`targets: ["backdrop"]` adds to each captured frame `backdrop: {"format", "size", "file", "levels": [{"size", "file"}]}`
(#483's Read of a texture with mips): the copy of the opaque scene that transmission and `backdrop` read, as it stood
when the frame drew, each level a `.f32` file of RGBA rows top-down, level 0 first, level 0 at the view's size. Used as
they are: `read: ["<op>.color"]` (a pass's output as f32), `seeks: [{after, to}]`, `targets` `final`, `linear` and
`pre_tone`, `assets`, and `{"code": "refused", "issues"}` for a document whose check fails.

### `live` (#379): rows added to the meter's count

With `report: ["memory"]`, each `frames[].writers[]` row adds `targets: [{"session", "target", "bytes",
"device_bytes"}]`: one row per core target the writer's views hold (`color`, `depth`, …, `velocity`, `emission`),
`bytes` what the meter counts for it (inside `count_bytes`) and `device_bytes` the size the device reports for that
allocation (null if it can't say).

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `velocity_from_previous_frame` | The velocity target is the screen motion from the previous frame drawn to this one | AC2 |
| `emission_thresholds_color` | The emission target is max(color − 1, 0) of the color target | AC3 |
| `builds_unread_targets` | The core builds velocity and emission for every frame, read or not | AC4 |
| `sample_grad_implicit` | `sample_grad` takes the implicit derivatives of uv and ignores the gradients given | AC5 |
| `no_divergence_rule` | The check has no derivative rule; the graph goes on to naga | AC6 |
| `backdrop_after_see_through` | The opaque copy is taken after see-through parts draw | AC7 |
| `period_first_octave` | fbm wraps only its first octave on the period | AC8 |

### Environment

`DEEPBUILD_EVIDENCE_DIR` (where the taste screenshots go) and `DEEPBUILD_TASTE_431` (the taste call's file):
`{"criterion": "#431.6cd4c5b0", "by": "<who>", "screenshots": [sha256 × 4], "call": "looks_right" | "looks_wrong"}`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped.
Each test's name starts with `AC<n> #431.<id>`. Each file's header gives its fixture, numbers and wrong programs.

| ID | File | What it asserts |
|---|---|---|
| AC1 `#431.304e73e1` | `spline-homography.test.ts` | The f64 PCHIP reference reproduces NAG E01BEC within 5e-5. One frame: `spline@1` through 16 points at 1,000 f32 inputs within 1e-6 of it; every value within its piece's end values (± 1e-6); each piece's 10 samples monotone; NAG's 9 points at NAG's 11 abscissae within 5e-5; five homographies (the unit square, OpenCV's trapezoid, three seeded quads) take each corner to the quad's within 1e-5. 17 points and an image for `points` refused naming step `s`; 16 literal points check |
| AC2 `#431.a160b5c5` | `velocity.test.ts` (2) | Pass `vel` reads the velocity target at (760, 540), the box's centre at t = 1 s: (10, 0) ± 0.1 px played (frames 0 to 30) and after a seek from frame 150. `velocity_from_previous_frame`: the seek reads x in (−2,640, −2,160) and the check names pixel (760, 540) |
| AC3 `#431.bedb0727` | `emission.test.ts` (2) | The glint reaches linear 4. `pre_tone` with and without pass `glow`: each of 76 × 76 px of the sign's visible half gains [4, 0, 0] ± 0.04; every pixel 2 px or more outside it (the wall over the hidden half, the ball, the background) keeps its value within 1% (+ 1e-4). `emission_thresholds_color`: the check names a pixel on the ball |
| AC4 `#431.a1c2e028` | `targets-memory.test.ts` (2) | `live` memory at 1920 × 1080: reading only color, no velocity or emission row (and a color row); reading both, one velocity row of 8,294,400 B and one emission row of 16,588,800 B, the count up by exactly 24,883,200 B; every target row within 1% of its device size. `builds_unread_targets`: the first figure's count up by 24,883,200 B, its rows named velocity and emission |
| AC5 `#431.b452b8cc` | `polar-seam.test.ts` (2) | The ring's linear target at the 192 seam pixels (rows 255 to 258, radius 201 to 249 px, −x side) within 2 codes (2/255 linear) of the bilinear level-0 lookup in f64. `sample_grad_implicit`: the check names a pixel of rows 256 or 257 whose final PNG reads 188 ± 4 on each channel |
| AC6 `#431.84a91586` | `divergent-flow.test.ts` (2) | The POM material: the no-lod `sample` (step `s`), `ddx`, a `use@1` of a function holding `fwidth`, and the CTS port's `ddy` and `fwidth` (step `dd`) each refused with operator_kind_rule {step, reason: derivative_in_divergent_flow}, naga not reached; `sample_grad` with gradients before the loop and `sample` with lod 0 check; the `sample_grad` form against its `reference` at 256 × 256 within one 10-bit code per channel on all but 65 pixels (99.9%), the depth it finds spanning 0.2 or more. `no_divergence_rule`: the no-lod form isn't refused by the rule; refused at operator_compile with no `step`, naga reached |
| AC7 `#431.4f967b2e` | `backdrop.test.ts` (2) | On the card's pixels 2 px inside: at lod 0 each is lum(opaque frame) within 1/255; the read-back copy's level 0 is the opaque frame and its level 3 the 8 × 8 mean, within 1/255; at lod 3 each is lum(bilinear(level 3)) within 1/255. The opaque card's document refused with operator_kind_rule naming step `b`. `backdrop_after_see_through`: the check names a card pixel over the pane |
| AC8 `#431.800494a1` | `periodic-noise.test.ts` (2) | One frame: noise, noise3's three lanes and fbm (6, 2, 0.5) with period [8, 8]: at 1,000 points equal at p + (8, 0) and p + (0, 8) within 1e-6; all 3,000 values within one 10-bit code of the frame's `reference`; each spreading 0.1 or more; 3D cells, jitter 0, f1 = euclidean, manhattan and chebyshev distance to floor(p) + 0.5 within 1e-6 at 1,000 points; fbm with lacunarity 2.5 and a period refused naming step `n`. `period_first_octave`: the check names a point where fbm doesn't repeat |
| AC9 `#431.6cd4c5b0` | `taste.test.ts` (1) | Four screenshots (the ring; the card at lod 3; the sign without and with `glow` at an exposure of 1/8) copied from `view3d`'s final PNGs; INCONCLUSIVE until a call on exactly those SHA-256s is recorded; `looks_wrong` fails |

Proof line: "each step against its CPU reference" is AC1's, AC5's, AC6's and AC8's comparisons; "the targets read at their
test pixels with memory counted by the meter" is AC2, AC3 and AC4; "each planted twin failing" is the seven twins.

## The oracle page

| Row | Status |
|---|---|
| SciPy TestPCHIP (criterion 1) | **Ported** against our output in `spline-homography.test.ts`: test_overshoot (1e-6 for f32), test_monotone, test_nag (NAG's values, 5e-5, both as the reference's oracle and on the GPU). Its random data (20 points) exceeds our 16, so the 16-point data is our own. BSD-3-Clause notice kept in the file |
| OpenCV getPerspectiveTransform issue_26916 (criterion 1) | **Ported**: its trapezoid, scaled by 1/1280, is quad `hom1`, each corner within 1e-5 in f32 (theirs 1e-10 in f64). Intel License notice kept in the file |
| WebGPU CTS uniformity (criterion 6) | **Ported** as behaviour on our check: the collective ops it lists that we have (`sample` with no lod for textureSample, `ddx`, `ddy`, `fwidth`, and a function holding one) refused in non-uniform flow; the lod and grad forms not. Its WGSL harness isn't run: our check refuses before naga, which is the rule under test. BSD-3-Clause notice kept in the file |
| Criteria 2–5, 7–9 | No upstream test, as the page says |

## Readings where the issue and design leave a choice

- **Fritsch–Carlson reference** is SciPy's PCHIP, as the Oracle page names it (Fritsch–Carlson's monotone pieces with
  Fritsch–Butland's interior slopes), checked against NAG before use; evaluated at the f32 input the GPU holds.
- **"An image for its table"** is `points` naming a texture input instead of a literal list.
- **The homography's corner order** is (0, 0), (1, 0), (1, 1), (0, 1) → `quad[0]` … `quad[3]`, applied as mat × column.
- **Velocity** is in device px with x to the right; the frame at t = 1 s is frame 30 at 30 fps (the call's `fps` and
  the document's `transport.frame_rate`); the look sets no motion blur, so s is the design's 180° default, 1/60 s;
  "after a seek from 5 s" is frame 150 drawn, then #484's seek to 30 in the same session; "about −2,400" is within 10%.
- **AC3's "every sample"** is 2 px inside the visible half's edges; "every other pixel" is every pixel more than 2 px
  outside it; 1% of [4, 0, 0] is 0.04 a channel; "keeps its value within 1%" is 1% of the value plus 1e-4.
- **AC4's numbers** are the issue's, exact: 1920 × 1080 × 4 B and × 8 B. "Matches the device's sizes" is each target
  row within 1% of the device's own size for it (#379's reading), since a device may pad rows.
- **AC5's code values** are 8-bit steps of linear light read on the linear target. Tone map none makes the final PNG
  that target's sRGB encoding, whose steps near black are about 13 times finer than a GPU filter's 8-bit weights, so a
  2-code bound on the PNG would fail a correct bilinear lookup at dark edge pixels. The 188 of the twin is read on the
  final PNG, as the issue gives it.
- **AC5's checker** is shifted 4 texels on each axis: a square straddles u = 0/1 and each end of v, so the texels either
  side of the seam and of the ring's edges match and the reference doesn't hang on the wrap mode; it is still a 256 × 32
  checker of 8-texel squares, and every level of 32 × 4 texels or coarser is mid gray, 188.
- **AC5's ring** is centred on the pixel corner (256, 257), so the seam runs through the middle of the 2 × 2 quads of
  rows 256 and 257, where an implicit derivative of u jumps; centred on (256, 256) the seam would fall between quads.
- **AC6's CPU reference** is the f64 interpreter through #429's material harness at 256 × 256 (the design's CPU
  reference of a graph); "within one code on 99.9%" allows 65 pixels. The material's depth is interpolated between the
  last two layers so a stop the GPU and the interpreter take a trip apart doesn't jump.
- **AC7's code value** is 1/255 of linear light, as AC5's; "a composite of the opaque frame" is the same document with
  only its opaque parts, drawn in the same run; the read-back copy is held to that frame and its level 3 to the 8 × 8
  mean before the lod-3 card is judged against it.
- **AC8's period** is `[8, 8]`, a list, as the issue writes it (the base takes one number); its CPU reference is the
  renderer's interpreter, since the design gives no noise formula; cells are unit cells, jitter 0 putting each feature
  point at floor + 0.5, which is the nearest centre under all three metrics.
- **The taste call** follows #429's convention (`DEEPBUILD_EVIDENCE_DIR`, `DEEPBUILD_TASTE_431`). "The emission target
  brightening a sign" is shown as the sign without and with the pass, at an exposure of 1/8 so linear 4 and 8 read as
  half and full red instead of both clipping; the criteria's pixels use unit exposure.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- `to_hsl` and `from_hsl`; the blend step's group modes but dissolve; the adjust step's contrast, exposure, gamma and
  invert. Each is a public step, so #429's `steps.test.ts` (every public step against its reference) covers them once
  they are in the op table.
- `shadow_filter` in `gpu.output@1`, written in shadow passes by a part with `shadow: colored` (the scope's caustics).
- The derivative rule under a `when`, and for `triplanar`; `backdrop`'s cost (the copy paid once with transmission);
  the velocity and emission targets' same-machine class; noise3's and cells' own periods.
