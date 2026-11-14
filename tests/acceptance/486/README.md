# Acceptance tests for #486: lobe outputs and core.bump@1 — material operators that set lobes, occlusion and relief per pixel

Written first, from issue #486 (its scope, its seven acceptance criteria and its proof line), the design sections it
links and those they lean on, and the base commit `d51be2c3` ("Merge pull request #2108 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean: one file per criterion, at most two tests each, plus exactly the
planted wrong programs the criteria name.

## What was read

- Issue #486 (no oracle page was given to this job).
- `docs/technical-design.md`: GPU operator; Dogfooding (tests first, wrong programs); taste calls and "Shown to you";
  The reference Macs (no criterion here names a time, so none is used).
- `docs/canvas-primitives.md`: GPU operators, as data (GPU operator; Step and the closed step list, with the derivative
  rule and `use`; Operator output, its lobe outputs, `occlusion` and their rules; Operator output: light response;
  Place in the frame; Compile, validate and cache, the warm-up at check; Shipped operators and composed graphs: pack
  graphs and step functions, `core.bump@1` and `gpu.function@1`; Every public step, the Geometry row); Material (every
  lobe and when it is on); Material: texture maps (the occlusion map); Look `look@1`: ao; Light and the light policy;
  Sky `sky@1`: environment (`studio`); Light probe `light.probe@1`.
- At the base: `crates/deep-gpu-layer` (`main.rs`: the calls, `--backend noop`, the `Planted` table and `bad_input`;
  `view3d.rs`: its targets and `binding_refusals`; `live.rs`: `admit`, session rows, `input` events, `created`;
  `warm.rs`: toggles and their `binds`); `crates/deep-canvas-effects` (`emit.rs`: `MAT_OUTPUTS`, the material entry;
  `check.rs`: outputs typed against the core's list; `graph.rs`: `inline_functions`, `use@1` and the divergent-flow rule;
  `module.rs`: `operator_rule`, `binding_rules`, `binding_refusals`); `crates/deep-canvas/src/registry/core_lists.rs`
  (`OUTPUTS`); `crates/deep-canvas/src/steps.rs` (the op table); `crates/deep-canvas/src/document/mod.rs` (an issue's
  JSON); `crates/deep-canvas-scene3d/src/{light,scene,uv,look,probe}.rs` (`material@1`'s fields and lobes, `at.scale`
  and `at.rot`, the look's `ao`, probes); `crates/deep-scene3d-render/src/{op.rs,op.wgsl,mesh.rs,scene3d.wgsl,created.rs}`
  (how a material operator draws, the unit box's uv0 and tangents, the normal map's tangent frame, the coat, the
  ambient term and the occlusion map, feature-set names); `scripts/lanes.mjs`; `scripts/proof-change.mjs`
  (`criterionId`); and the suites `tests/acceptance/481/` (the layout), `428/` (lobes, the furnace), `429/`
  (operators as items), `431/` (`use@1`, the divergent-flow rule), `432/` (the noop lane, `created`, toggles) and
  `1637/` (a probe in a document).

## What the base already does, which these tests don't credit

`material@1` has #428's lobes and #481's subsurface; a `gpu.material@1` named by a material's `op` writes `base_color`,
`alpha`, `emission`, `metallic` and `roughness` (the core's entries of `gpu.output@1`), and any other output is refused
by the operator check with `operator_type`; the op table has `normal@1` but no `uv0`, `position` or `tangent` step; `use@1`
calls a pack's step function and the check refuses one holding a derivative inside a repeat with a `stop_if`; no
`core.bump@1` exists. `view3d` draws a part whose operator the check refuses with its material's own values (it doesn't
refuse the document); `live` refuses a session whose document fails its check; the warm-up compiles every reachable
state's feature sets, and `live` lists the pipelines a frame creates; an occlusion map scales the ambient term alone;
probes are captured on the CPU and shade nothing. None of this suite's planted names is in `Planted`.

## Run them

They build `deep-gpu` (`cargo build --locked --bin deep-gpu`, adding the pinned toolchain's `bin` to PATH when it is
installed, as #166's and #481's suites do), so they run one file at a time. `scripts/lanes.mjs` needs
`'tests/acceptance/486/'` added to its `alone` list, beside `'tests/acceptance/481/'`; this README is the instruction,
the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/486 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/486/tsconfig.json
```

Pixel tests draw on macOS's Metal device; off macOS they fail with a message starting `INCONCLUSIVE:`, never pass.
Counting and refusal tests (`missing-lobe.test.ts`'s first, `relief.test.ts`'s second, `warm-furnace.test.ts`'s first)
run on the noop lane (`deep-gpu run --backend noop`) on any platform the binary builds on. Nothing needs a reference
Mac or the network. `taste.test.ts` writes into `target/acceptance/486/` and keeps what it writes; every other test
writes into its own temporary folder and deletes it. `reference.ts` imports no vitest, so it runs on its own
(BASE-FAILURE.txt).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped (`scripts/proof-change.mjs: criterionId`). Each test's name starts with `AC<n> #486.<id>`; each file's header
gives its fixture and numbers.

| ID | Criterion (short) | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#486.fccdc529` | Coat written per pixel (1 where uv0.u < 0.5, else 0) on a coat-0.5 plate matches the plate as halves at coat 1 and 0 within one 10-bit code on 99.9%; 1.5 draws as 1; planted scaling output draws the left at 0.5 and fails naming the operator | `coat.test.ts` (2). 1: `coat_split` and `coat_split_15` (1.5) each against the halves, on the linear target, pixels 1 px inside the plate, the two columns within a pixel of the split dropped, at most 0.1% more than one code off, at least 10,000 judged. 2: `--planted lobe_output_scales_field` fails naming `coat_split`, and its left half matches halves at coat 0.5. Catches: the base (output refused, coat 0.5 everywhere); an output that scales the field; an unclamped 1.5; a per-part or wrongly split output |
| AC2 `#486.f7c1ed7f` | Occlusion 0 matches the plate with the environment and probes removed (square keeps its emission); occlusion 1 matches no operator; planted occlusion that scales direct light or emission fails naming the pixel | `occlusion.test.ts` (2). 1: a stone plate and an emissive square under a sun, the studio environment and a reflection probe, ao off; both materials under `occ`; occlusion 0 against the same parts with no environment, no probe and no operator, occlusion 1 against no operator, every pixel 2 px inside a part within one code; the fixture requires the environment to brighten ≥ 90% of the plate by more than a code. 2: `--planted occlusion_scales_direct`: failures name `pixel (x, y) on plate|square`, one darker than the reference. Catches: the base; an occlusion that misses the environment's specular or the probe; one that scales the sun or the emission |
| AC3 `#486.d12f88ca` | Sheen on a sheen-0 material and coat_roughness on a coat-0 material refused with operator_kind_rule naming output, operator, material; on a velvet (0.6) the same operator checks, shows sheen only where written > 0, no pipeline after the first frame on the noop lane; planted check compiles at first run and fails naming the material | `missing-lobe.test.ts` (2). 1 (noop): `live` plays `felt` (sheen 0) and `matte` (coat 0) and `velvet` (0.6), each plate turned on at frame 3: felt refused naming `sheen`, `glaze`, `felt`; matte naming `coat_roughness`, `polish`, `matte`; velvet live, frame 3 drawn, nothing created after the first frame; `--planted missing_lobe_turned_on` creates a pipeline at frame 3 naming the material `felt`. 2 (Metal): the velvet under `glaze` (0.6 left, 0 right) matches velvet and bare halves within one code on 99.9%; the velvet's sheen shows on ≥ 90% of the left half. Catches: the base (operator_type everywhere); a check that misses the material or refuses the velvet; a lobe turned on late; sheen where 0 is written |
| AC4 `#486.5d0001c4` | core.bump@1 of 0.2 × uv0.v at strength 1 tilts the normal 11.31° toward −v within 0.5° at 100 pixels on the plate and on its handedness −1 twin; planted bump ignoring handedness tilts the twin 22.6° toward +v and fails naming the part; a call inside a repeat with stop_if is refused naming the call | `relief.test.ts` (2). 1 (Metal): plate (v up, +1) and twin (u reversed, −1), white Lambertian, drawn under three suns; each sampled pixel's normal by photometric stereo (`reference.ts`) within 0.5° of normalize(0, −0.2, 1); `--planted bump_ignores_handedness` fails naming `twin`, its median 22.62° ± 1° off, tilted toward +v. 2 (noop): `live` admits the relief document and refuses the looped call with operator_kind_rule naming `relief_call`. Catches: the base (no uv0, no core.bump@1, no normal output); a bump by another gradient or strength; the handedness ignored; a derivative left to naga in divergent flow |
| AC5 `#486.c1e9a9b8` | coat 1 with coat_normal 11.31° toward −v under a sun 45° from the normal: the coat's peak moves by the tilt, the base lobe's stays, each within 0.5° of a CPU reference; planted output bending the base normal fails naming the operator | `coat-normal.test.ts` (2). 1: a red metal plate (roughness 0.2) under coat 1 (0.1); `coat_tilt` writes the coat normal; on the centre columns the coat's peak (green) and the base lobe's (red − green), each as a half-vector angle, within 0.5° of `reference.ts`'s (−11.32° and +0.03°); the reference's own peaks sit the tilt apart within 0.5°. 2: `--planted coat_normal_bends_base` fails naming `coat_tilt`, the base lobe's peak among the failures. Catches: the base (both peaks at 0°); a coat normal in another frame; one that bends the base too or neither |
| AC6 `#486.0887c8cd` | A material whose operator writes lobe outputs compiles its set at check; turning it on later creates 0 pipelines on the noop lane; a white furnace with every lobe at full strength from outputs of 1 stays ≤ 1 within 1% | `warm-furnace.test.ts` (2). 1 (noop): `lacquer` (every lobe on at half strength) under `lacquer_op`, writing all fourteen of the issue's lobe outputs, its plate turned on at frame 3: the session is live, frame 3 drawn, no pipeline created from the first frame on. 2 (Metal): the furnace document admitted by `live` on the noop lane first (its operators check), then #422's furnace drawn, eight balls each with one lobe at half strength in its field and at full strength (1) from its output: background 1 within 1%, no channel above 1.01, mean luminance ≥ 0.5, and 99.9% of pixels within 0.01 of the same ball with the field at full strength. Catches: the base (outputs unknown); a warm-up that misses an operator's lobe set; an output read in one term while the field is read in its compensation (energy over 1) |
| AC7 `#486.8b403bfa` | Shown to you: the coat plate, the occlusion plate and the core.bump@1 relief plate; one taste call recorded, else INCONCLUSIVE | `taste.test.ts` (1): writes the three pictures from this run's output (The taste call), then reads `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's |

Proof line: "the per-pixel coat … against their references" is AC1's comparison; "occlusion" AC2's; "bump fixtures"
AC4's normals against the analytic one; "the missing-lobe refusal" AC3's first test.

## Assumed surfaces

The issue and design name the behaviors but not all of these; each is this job's choice, the plainest one beside the
base's own calls. The implementer provides exactly these. No new call, target or report field is added.

1. **Lobe outputs on `gpu.material@1`**, in its item's `params.outputs`, each naming the step it takes, as the base's
   outputs do: the issue's `coat`, `coat_roughness`, `specular_level`, `sheen`, `translucency`, `transmission`,
   `subsurface`, `sheen_roughness`, `iridescence_thickness` (nm) and `diffuse_roughness` as `f32`; `anisotropy` as `vec2`
   (strength, rotation in deg); `sheen_color` and `specular_color` as `vec3` (linear); `coat_normal` as `vec3` (tangent
   space); and the design's `occlusion` (`f32`, 0..1) and `normal` (`vec3`, tangent space). A material has a lobe as
   Operator output says: its weight, strength, amount or thickness off 0 or its color off white (coat for
   `coat_roughness` and `coat_normal`, sheen for `sheen_color` and `sheen_roughness`, iridescence for
   `iridescence_thickness`); `specular_level` and `occlusion` need none.
2. **Tangent space** for `normal` and `coat_normal`: x along the tangent (uv0's +u), y along the bitangent cross(n, t) ×
   w (uv0's +v), z along the shading normal, w the tangent's handedness after the item's transform: the frame the
   base's normal map reads (`scene3d.wgsl`).
3. **The Geometry step `uv0@1 {}`** gives a `vec2`, the part's uv0 at the pixel (Every public step: Geometry `uv0`),
   named `<name>@1` as the base's steps are.
4. **`core.bump@1`** is called as the base calls a step function (#431): `{op: "use@1", args: {name: "core.bump@1",
   height: <f32 step>, strength: <f32>}}`, read as `<call>.normal`, with no pack installed (scene3d fills it in
   `gpu.function@1`); height in metres.
5. **The plates** are `mark.box@1`s, whose faces carry uv0 from 0 to 1 across them (the base's unit box): on the front
   face u runs along the box's own +x and v along its own −y, handedness −1 by the base's convention (cross(n, t) × w
   along +v). Mirrored by `at.scale: [1, −1, 1]`, v runs up and the handedness is +1: AC4's and AC5's plate. Turned by
   `at.rot: [0, 0, 180]`, u runs the other way with v up, handedness −1: AC4's twin.
6. **Refused at check** is `live` (#379) refusing a session: its row `state: "refused"` with `issues`, the document
   check's issue JSON (`code`, `severity`, `path`, `step` for a path under `params/steps/`, `ids`, `what`). The
   missing-lobe refusal is an error `operator_kind_rule` whose `path`, `step`, `ids`, `what` (or an added `item`,
   `output`, `operator` or `material`) name the output, the operator and the material, each as a whole word, as the
   base's #431 rule for `shadow_filter` names them (path `items/<op>/params/outputs/<output>`, the material in `what`).
   The divergent-flow refusal names the call by its `step` or a path ending in it; its `reason` isn't required.
7. **Counted on the noop lane** is `deep-gpu run --backend noop` and `live`'s per-view `created` rows (#432).
   **Turning a material on in a later frame** is its part shown from frame 3 by a toggle control (`role: "switch"`,
   `class: "document"`, `binds: ["items/<part>/visible"]`, default off) and #432's `input` event at frame 3.
8. **`view3d`** as at the base: `targets: ["final", "linear", "ids"]` with `picks`; a part's pixels by object ID.
9. **The studio environment** is `sky@1.environment: {from: "studio", intensity: 1}` over a black sky with no ambient,
   so the environment is the only ambient light; **a probe** is `light.probe@1 {type: "reflection"}` whose box holds the
   plate; "the environment's lighting and the probes removed" is the same document with the environment and the probe
   item removed; "the look's ao off" is `ao: "none"`.
10. **The white furnace** is #422's (`sky@1` white at both ends, no ambient, `environment: {from: "sky", intensity: 1}`).
11. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
    `crates/deep-gpu-layer/src/main.rs`:

| Name | The wrong program | Criterion |
|---|---|---|
| `lobe_output_scales_field` | A lobe output multiplies its material field instead of replacing it (coat written 1 on a coat-0.5 material draws 0.5); everything else as shipped | AC1 |
| `occlusion_scales_direct` | The `occlusion` output scales the whole shaded color, the direct light and the emission with the ambient term; everything else as shipped | AC2 |
| `missing_lobe_turned_on` | The check doesn't refuse an operator that writes a lobe its material lacks: it admits it, the warm-up leaves the material's feature set without that lobe, and the frame a part first runs the operator compiles the set with the lobe on | AC3 |
| `bump_ignores_handedness` | core.bump@1 builds its tangent-space normal with the bitangent cross(n, t), whatever the tangent's handedness; everything else as shipped | AC4 |
| `coat_normal_bends_base` | The `coat_normal` output also replaces the base lobes' shading normal; everything else as shipped | AC5 |

12. **`tests/acceptance/486/TASTE.json`** records the taste call, the one file anyone adds to this folder after this
    commit, and only to record the owner's answer: `{"issue": 486, "criterion": "#486.8b403bfa", "verdict":
    "looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {name → sha256 for the three PNGs},
    "note"?}`.

The fixtures use only what the base has besides these: `mark.box@1` with `at.rot` and `at.scale`, `ball@1`,
`light.sun@1`, `light.probe@1`, `camera@1` perspective and orthographic, `sky@1`, `look@1`, `material@1`'s fields,
controls, and the op table's `const`, `split`, `lt`, `select`, `mul`, `add`, `sin`, `ge`, `compose`, `repeat` and `use`.

## The CPU references

`reference.ts`, in f64, from published forms; nothing is taken from the renderer.

- **AC4.** The analytic normal of height 0.2 × v on a plate whose +v runs along +y is normalize(0, −0.2, 1), atan 0.2 =
  11.31° from the plate's. A white Lambertian surface under a sun of π lx reads n · l, so three frames under three
  non-coplanar suns give n ∝ M⁻¹ L, M's rows the directions toward the suns (photometric stereo): the albedo and the
  illuminance cancel. The suns are straight on, 40° toward +x and 40° toward +y; with the analytic normal they read
  0.981, 0.751 and 0.625, all lit; the round trip recovers it within 1e-6°, and from f32 values within 1e-5°.
- **AC5.** The base lobe is glTF 2.0 Appendix B's GGX with height-correlated Smith visibility and Schlick's Fresnel, α =
  roughness²; the coat is KHR_materials_clearcoat's layer, the same lobe at α = coat_roughness² about the coat's own
  normal with F0 0.04, over the base dimmed by 1 − coat × F(v · n_coat). Both are evaluated at the same two centre
  columns' pixel centres, through the same pinhole and plane as the frame, and each peak is read by the same reader.
  For this fixture the coat's peak lies at a half vector −11.32° from the plate's normal and the base lobe's at
  +0.03°, 11.35° apart; under the planted program the base lobe's would lie at −11.28°. A row is 0.045° of half
  vector there, so 0.5° is about 11 rows. Factors the reference leaves out (the design's multiple-scattering
  compensation, the exact form of the coat's visibility) change slowly with the view across either lobe's half width,
  a few dozen rows, and move a peak by far less than 0.5°.

## Readings where the issue and design leave a choice

- **One 10-bit code value** is #429's reading on the linear target: |got − want| × 1023 ÷ max(1, |want|) per channel.
  "99.9% of pixels" allows 0.1% of the judged pixels; AC2's "matches within one 10-bit code value" has no share, so
  every judged pixel must.
- **"Away from the one-pixel column at the split"**: the split line u = 0.5 lies on x = 0, which the camera's centre
  plane holds, so it falls on the frame's centre line, a pixel edge; the pixel column on each side of it is dropped.
  Pixels 1 px from the plate's outline are dropped too, where MSAA mixes the plate with the background.
- **"The same plate drawn with coat 1 on its left half and with coat 0 on its right"** is the plate as two half-size
  boxes with no operator, each its own material; "a written coat of 1.5 draws as coat 1" is the operator writing 1.5
  on the left against the same halves.
- **"The plate with the environment's lighting and the probes removed"** has no operator: with no ambient light,
  occlusion has nothing to scale. Both materials (plate and square) run the occlusion operator, so the square's emission
  is under it too. The fixture holds only where the environment visibly lights the plate.
- **"With no channel, driver or control that can move it off 0"**: the documents' only control shows the part; nothing
  touches a material. **"Shows sheen only where it writes above 0"**: the operator writes 0.6 (the velvet's own weight)
  on the left and 0 on the right, so the plate must match the velvet on the left and the velvet at sheen 0 on the right;
  the sheen must visibly show on the left. **"Creates no pipeline after the first frame"** is read from the session's
  first drawn frame on, the frame its plate turns on included. **"In the frame the operator first runs"** is frame 3,
  where the plate first draws.
- **"Naming the output, the operator and the material"** is each ID as a whole word in the issue's path, step, IDs or
  message (`felt_plate` doesn't name `felt`); **"naming the material"** for the planted check is a created pipeline at
  frame 3 whose items, each mapped from its part to its material, name `felt`.
- **"Tangent handedness −1"** is the base's convention (cross(n, t) × w points along +v): the issue's plate is +1 and
  its twin, u the other way, −1, so a bump that takes w as +1 is right on the plate and flips the twin's v.
- **"Shades with a normal"** is the normal the shading reads, recovered from a Lambertian frame by photometric stereo
  rather than a normal target the base doesn't have. **"100 sampled interior pixels"** is a 10 × 10 grid over the
  central 60% of each part's extent in the frame. The planted twin's "22.6° from the analytic one" is held to within 1°
  at the median, tilted toward +v at every sample.
- **"A call to core.bump@1 inside a repeat that has a stop_if"**: its body takes derivatives (the surface gradient of
  height and position), so the design's derivative rule refuses it with `operator_kind_rule`, naming the call.
- **"The coat's specular peak" and "the base lobe's peak"** are where each lobe's light along the frame's centre column
  is greatest, read as the centroid of the rows within 90% of the maximum, and placed by the half vector between the
  eye and the sun there. The lobes are told apart by color: a red metal's lobe is red, the coat's is white, so green is
  the coat's (a red metal's Fresnel tail puts under 0.01% of it there) and red − green is the base lobe's alone.
- **"Compiles its set at check"** is that no pipeline is created from the first frame on; **"turning that material on in
  a later frame"** is the part shown at frame 3. **"Every lobe at full strength"** is each of eight lobes alone on its own
  ball at value 1 (coat, sheen, translucency, transmission, subsurface, specular level, anisotropy [1, 0], diffuse
  roughness), as #428 and #481 bound field-driven lobes one at a time; the fields sit at half strength, so a ball that
  reads the output in one term and the field in another goes over 1 or off the field-driven ball. **"At or under 1
  within 1%"** is no channel above 1.01 (pbrt-v4's rule as #422 ported it), with the ball lit (mean ≥ 0.5) and the
  background at 1 within 1%. A white furnace can't tell a lobe at half strength from one at full, since every lobe
  that keeps its energy reads about 1 there, and `view3d` draws a part whose operator the check refuses with its own
  fields; so the furnace's document must first be admitted by `live` on the noop lane, the outputs in effect.
- **The pictures** are drawn under a filmic look: AC1's coat plate; AC2's plate at occlusion 0 and 1 side by side; and,
  for the relief, ripples 3 mm high, six to the metre each way, through core.bump@1 under a low sun, since AC4's linear
  height draws a plain tilted plate that shows nothing to judge.

## The taste call

`taste.test.ts` writes these to `target/acceptance/486/`, printing each SHA-256:

| File | What it shows |
|---|---|
| `coat-plate.png` | AC1's plate, coat 1 on the left and 0 on the right from its operator; the renderer's final PNG byte for byte |
| `occlusion-plate.png` | AC2's plate and emissive square under occlusion 0 and 1, their final targets side by side |
| `relief-plate.png` | A clay plate with ripples from core.bump@1 under a low sun and the studio environment; the renderer's final PNG byte for byte |

They are attached to the PR and shown to the owner in the session; the answer is recorded in `TASTE.json` (Assumed
surfaces, 12). No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on
exactly this run's pictures passes. No other test reads these pictures or the call.

## Not tested, because no criterion asks

The per-pixel effect of `coat_roughness`, `specular_level`, `sheen_color`, `sheen_roughness`, `specular_color`,
`anisotropy`, `translucency`, `transmission`, `subsurface`, `iridescence_thickness` and `diffuse_roughness` against a
reference at values other than 1 or under other light (AC1 holds coat to its field per pixel; AC6's furnace holds eight
lobes written at 1 to their fields at 1, and its warm-up holds the other outputs only to compiling at check); clamping
of any field but coat; a channel, driver or control that moves a lobe off 0 admitting the operator; occlusion
multiplying the look's ao and an occlusion map; a refusal in `view3d` or `check_operator`; core.bump@1 on a curved part
or at another strength; seeking equals playing; the cost of a lobe output; glTF export. The implementer owes these a
mapping or a note (AGENTS.md: review requirement → change → proof).
