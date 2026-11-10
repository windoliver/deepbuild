# Acceptance tests for #485: light responses, a material operator's light and ambient in the core's light loop, and the operator registries it fills

Written first, from issue #485 (its scope, fields, eight acceptance criteria and proof line), its oracle page, the
design sections it links and those they lean on, and the base commit `a04378eb2` ("Merge pull request #2190 …"), by a
job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding). One file per criterion, plus exactly the planted
wrong programs the criteria name.

## What was read

- Issue #485, and its oracle page (`doneright/oracles/issues/485.md` in `DeepBuildAI/deepbuild`, branch `doneright`).
- `docs/technical-design.md`: GPU operator.
- `docs/canvas-primitives.md`: Light and the light policy; Operator output; Operator output: light response; Place in
  the frame; Registry and seal: registries; Shipped operators and composed graphs: pack graphs and step functions
  (`gpu.function@1`, "scene3d fills the defaults `core.light@1` and `core.ambient@1`"); Status guard; Compile, validate
  and cache.
- At the base: `crates/deep-gpu-layer` (`main.rs`: `Planted` and its parse; `view3d.rs`: the call's fields, `targets`
  including `linear` and `ids`, `pixel_hash`, `notices`, `light_cut`, `packs`, the refusal of a frame whose material
  operator can't draw; `lod.rs`: `cut_json`); `crates/deep-canvas-scene3d` (`light.rs`: `policy_by` and `scores`, 32
  shaded, the 10% margin; `gpu.rs`: scene3d's entries of `gpu.output@1` and `gpu.function@1`; `module.rs`);
  `crates/deep-canvas/src/registry/core_lists.rs` (`OUTPUTS`, `gpu.output@1` entries named `<kind>.<name>`,
  `gpu.function@1`); `crates/deep-canvas-effects` (`graph.rs`: `read` refuses unknown operator fields; `check.rs`:
  outputs typed against the registries; `module.rs`: effects' manifest requires scene3d); `crates/deep-canvas/src/steps.rs`
  (the op table); `crates/deep-scene3d-render/src/{lib.rs,resolve.wgsl}` (4× MSAA, the color resolved in the pass, an
  object ID from the first covered sample); `crates/deep-show` (`Cargo.toml`'s test features, `main.rs`: the module set,
  `test-leave-out-effects`, the planted layouts `test-steps-in-effects`, `test-ease-in-motion`, `test-camera-in-scene3d`,
  `test-export-target-in-media`, the seal; `scene3d.rs`: 3D snapshots); `packs/examples/castle.json` and its look;
  `scripts/proof-change.mjs` (`criterionId`); `scripts/lanes.mjs`; and the suites `tests/acceptance/486/` (the layout,
  the taste test), `446/` (the house, the light helpers), `422/` (the castle drawn in its look with its recipes), `200/`
  (deep-show builds, the startup refusal, `registries`, the merge base built apart), `489/` (`schedule`'s interface
  digests), `490/` (a planted layout with a module left out).

## What the base already does, which these tests don't credit

The light loop shades with the core's own WGSL; nothing calls a response. `gpu.output@1` and `gpu.function@1` are the
core's registries (#200): the core fills today's outputs (`material.base_color` …) and scene3d fills its lobe outputs,
`occlusion`, `normal` and `core.bump@1` (#486); there is no `light`, `ambient` or `vertex_offset` output and no
`core.light@1` or `core.ambient@1`. The operator reader refuses `light` and `ambient` as "not a field of an operator"
(`operator_type`), and `view3d` refuses a frame whose material operator can't draw. The light policy shades 32 lights
by score with a 10% margin, and `view3d`'s `light_cut: true` already reports the shaded lights with their weights and
those left out. `deep-show` already has `test-leave-out-effects`, `registries`, `schedule` and 3D snapshots. None of this
suite's planted names is in `Planted`, and `test-leave-out-scene3d` and `test-gpu-output-in-effects` aren't features.

## Run them

They build `deep-gpu` (`cargo build --locked --bin deep-gpu`, adding the pinned toolchain's `bin` to PATH when it is
installed, as #486's suite does) and, in `registries.test.ts`, four `deep-show` builds (`--no-default-features --features
<set>`), so they run one file at a time. `defaults.test.ts` and `castle-inputs.test.ts` also build the merge base
(`git merge-base HEAD origin/main`, exported with `git archive` into `target/acceptance-485-base/<sha>/` and built there
with its own target folder, kept so later runs build warm), only after this checkout's own frames are drawn.
`scripts/lanes.mjs` needs `'tests/acceptance/485/'` added to its `alone` list, beside `'tests/acceptance/486/'`; this
README is the instruction, the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/485 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/485/tsconfig.json
```

Pixel tests draw on macOS's Metal device; off macOS they fail with a message starting `INCONCLUSIVE:`, never pass.
`registries.test.ts`'s registry, digest and seal checks run wherever deep-show builds; its house comparison needs the
GPU. Nothing needs a reference Mac or the network. `taste.test.ts` writes into `target/acceptance/485/` and keeps what it
writes; every other test writes into its own temporary folder and deletes it. Every test passes an explicit timeout of
an hour or more. `reference.ts` imports no vitest, so it runs on its own (BASE-FAILURE.txt).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped (`scripts/proof-change.mjs: criterionId`). Each test's name starts with `AC<n> #485.<id>`; each file's header
gives its fixture and numbers.

| ID | Criterion (short) | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#485.6dd30866` | The castle and house with core.light@1 and core.ambient@1 on every material give the same pixel hash as with no response; a planted core.light@1 without Fresnel fails, naming the fixture and its first differing pixel | `defaults.test.ts` (2). `AC1 #485.6dd30866 the castle and the house with core.light@1 and core.ambient@1 set on every material give the same pixel hash …`: the castle (`packs/examples/castle.json` in its look, with its recipes) and #446's house at night, each with the defaults set (`withDefaults`), against the same fixture with no response drawn by this checkout and by the merge base: four `pixel_hash` comparisons. `AC1 #485.6dd30866 a planted core.light@1 that drops the Fresnel term (--planted light_drops_fresnel) …`: the same check fails, a failure naming the fixture and `first differing pixel is pixel (x, y)`. Catches: the base; defaults that aren't today's shading, named or by default; a Fresnel term dropped |
| AC2 `#485.f339bc40` | A cel sphere under a 45° sun with a post's shadow shows exactly three linear values per channel on its interior, the post's shadow at the lowest; a planted shadow of 1 fails naming the first such pixel | `cel-bands.test.ts` (2). `AC2 #485.f339bc40 the sphere under its cel response shows exactly three linear values per channel …`: on the linear target, interior pixels (5 × 5 block all the sphere's in the ID target), per channel the three most-held values are 0, m and 2m, every other value a 4× resolve of two adjacent bands on at most 0.1% of the interior; every interior pixel deep in the post's shadow (`reference.ts`) reads the lowest. `AC2 #485.f339bc40 a planted loop that hands the response a shadow of 1 (--planted loop_shadow_one) …`: fails with `pixel (x, y) in the post's shadow reads …`, the first in row order. Catches: the base; a response not called per light or handed another shadow, normal or light direction; bands smoothed or miscounted; an ambient added |
| AC3 `#485.ec6476de` | In a room whose policy shades 32 of 40 point lights, 0.01 a call gives 0.32 at a pixel inside every range; a planted loop that calls the cut lights gives 0.40 and fails naming the pixel; −1 counts as 0 and raises light_response.range once per operator and time | `policy-lights.test.ts` (3). `AC3 #485.ec6476de in a room whose policy shades 32 of 40 point lights …`: `light_cut` shows the 32 bright lights at weight 1 and the 8 dim ones left out; the centre pixel (on the back wall, ≤ 7.91 m from every light, ranges 40 m) reads 0.32 ± 0.001 per channel. `AC3 #485.ec6476de a planted loop that also calls the response for the 8 lights the policy cut (--planted loop_calls_cut_lights) …`: fails naming `pixel (240, 160)`, which reads 0.40 ± 0.001. `AC3 #485.ec6476de a response that returns −1 counts as 0 …`: frames 0 and 1 (30 fps) read 0 ± 1e-6 and each carries exactly one `light_response.range` notice naming `negative` at its own t. Catches: the base; a loop calling every light, none, or once a pixel; a light near the cut unweighted; a negative summed or clamped only in the sum; the range raised per pixel, per light or once per session |
| AC4 `#485.008d1e79` | A test build with scene3d and without effects seals with scene3d's vertex_offset, light and ambient in gpu.output@1 and core.light@1, core.ambient@1 in gpu.function@1, and the house has the full build's pixel hash; effects@1's digest is the same with and without scene3d; a planted effects module declaring gpu.output@1 is refused naming it | `registries.test.ts` (3). `AC4 #485.008d1e79 a test build with scene3d and without effects seals, with scene3d's vertex_offset, light and ambient in gpu.output@1 …`: `full,test-leave-out-effects` starts, holds scene3d and not effects, both registries `owner: core` with scene3d's five entries (module scene3d); then the house (no operator) presented in it and in `full` gives one snapshot hash. `AC4 #485.008d1e79 effects@1's interface digest is the same in builds with and without scene3d`: `schedule`'s `interfaces["effects@1"].digest` in `full` and `full,test-leave-out-scene3d`. `AC4 #485.008d1e79 a planted effects module that declares gpu.output@1 itself (test-gpu-output-in-effects) …`: the startup is the seal's refusal and names gpu.output@1. Catches: the base; scene3d's entries declared by a module; effects' digest holding scene3d's entries; a house that shades otherwise without effects |
| AC5 `#485.d789e487` | A sphere whose ambient is n × 0.5 + 0.5 and light 0 reads (0.5, 0.5, 1.0) ± 1/255 at its centre from 8 orbit positions; a planted world-space normal reads (1.0, 0.5, 0.5) after a quarter orbit and fails naming the pixel | `ambient-normal.test.ts` (2). `AC5 #485.d789e487 a sphere whose ambient returns n × 0.5 + 0.5 …`: azimuths 0° to 315° every 45°, the centre pixel (256, 256) of 513 × 513 on the linear target. `AC5 #485.d789e487 a planted loop that hands ambient the world-space normal (--planted loop_world_normal) …`: fails naming `azimuth 90°: the centre pixel (256, 256)`, which reads (1.0, 0.5, 0.5) ± 1/255. Catches: the base; n in world or object space; n unnormalized or flipped |
| AC6 `#485.8b6d2f45` | The same sphere with ambient max(dot(n, v), 0) reads 1.0 ± 1/255 at its centre and under 0.2 on interior pixels within 2 px of its outline; a planted v away from the eye reads 0 and fails naming the pixel | `ambient-view.test.ts` (2). `AC6 #485.8b6d2f45 the sphere with an ambient of max(dot(n, v), 0) …`: the centre pixel in every channel; each of ≥ 1,000 rim pixels (3 × 3 block the sphere's, 5 × 5 block not) under 0.2 in every channel (the reference allows at most 0.145 there). `AC6 #485.8b6d2f45 a planted v that points away from the eye (--planted loop_view_away) …`: fails naming `the centre pixel (256, 256)`, which reads 0 ± 1/255. Catches: the base; v constant (0, 0, 1) (reads 1 at the rim); v toward the light, away from the eye or in world space |
| AC7 `#485.05404a40` | With the two inputs added and unused, the castle keeps the pixel hash it has under the default responses; a planted core.ambient@1 adding 0.01 × n.z fails naming the fixture and its first differing pixel | `castle-inputs.test.ts` (2). `AC7 #485.05404a40 the castle under the default responses, core.ambient@1 taking n and v unused, keeps the pixel hash it had before …`: the castle with the defaults set against the merge base's castle. `AC7 #485.05404a40 a planted core.ambient@1 that adds 0.01 × n.z (--planted ambient_adds_nz) …`: fails naming `the castle` and its first differing pixel. Catches: the base; an ambient default that reads n or v; inputs that moved what it returns |
| AC8 `#485.977f4f15` | Shown to you: the cel sphere with the post's shadow and the room with 32 shaded point lights; one taste call recorded, else INCONCLUSIVE | `taste.test.ts` (1). `AC8 #485.977f4f15 the run writes the cel-banded sphere …`: writes both pictures from this run's output (The taste call), then reads `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's |

Proof line: "the castle and house fixtures equal under the default responses" is AC1's (and AC7's castle); "cel bands
under the scene's lights" AC2's; "the light loop's call counts" AC3's 0.32, 0.40 and the one notice per operator and
time.

## Assumed surfaces

The issue and design name the behaviors but not all of these; each is this job's choice, the plainest one beside the
base's own calls. The implementer provides exactly these.

1. **A light response on `gpu.material@1`**: `params.light` and `params.ambient` (Operator output: light response),
   each either the name of a step function (`"core.light@1"`, `"core.ambient@1"`) or a graph
   `{steps: {step ID → step}, outputs: {radiance: <step ID>}}`. A response's steps read its inputs by bare name, as a
   step function's body reads its in ports: `light` reads `n`, `v`, `l` (vec3, view space), `radiance` (vec3), `shadow`
   (f32), `light_hash` (u32) and each output its operator writes (`base_color` …); `ambient` reads `irradiance`, `env`,
   `n` and `v`. `outputs.radiance` names the vec3 step it returns. Steps take literal numbers as args and `mul@1` takes a
   vec3 and an f32, as at the base. An operator may hold no steps and `outputs: {}` beside its two responses and still
   check (`withDefaults`' `responses`). View space: x right, y up, z toward the eye.
2. **The defaults**: a part with no response shades by `core.light@1` and `core.ambient@1` (Fields: Defaults), so
   naming them on every material changes no pixel. They are scene3d's entries of `gpu.function@1`.
3. **`view3d`** as at the base: `{call: "view3d", doc, look, size, frames, capture: [n…], targets: ["final", "linear",
   "ids"], fps?, packs?, light_cut?}`, frame n at t = n ÷ fps. Each reply's `frames[]` entry is read for `frame`,
   `pixel_hash` (SHA-256 of the final frame's pixels), `final`, `linear` (f32 RGBA, before exposure and the tone map),
   `ids` with `picks`, `notices[]`, and with `light_cut: true` `light_cut: {shaded: [{light, weight}], left_out: [id]}`.
4. **`light_response.range`** is a frame notice in `view3d`'s `notices`: `{code: "light_response.range", op: <the
   operator's item ID>, t: <the frame's time in seconds, a number>}`, exactly one per operator per frame time in which a
   response returned a negative or non-finite value.
5. **The registries' entries**, read from `deep-show`'s `registries` call (#200's listing: `{registries: [{kind:
   "registry", name, owner, entries: [{name, module, origin, …}]}]}`): `gpu.output@1` (owner `core`) holds scene3d's
   `vertex_offset`, `light` and `ambient`, each named `material.<name>` as the base names material outputs (a bare
   `<name>` or `<name>@1` is accepted too), `module: "scene3d"`; `gpu.function@1` (owner `core`) holds `core.light@1` and
   `core.ambient@1`, `module: "scene3d"`.
6. **`deep-show` builds**, `cargo build --locked --bin deep-show --no-default-features --features <set>`:
   `full`; `full,test-leave-out-effects` (#200's feature, at the base: the set's list without effects); and two new
   features of `crates/deep-show/Cargo.toml`, never in a shipped build:

| Feature | The build |
|---|---|
| `test-leave-out-scene3d` | The set's list without scene3d; the seal takes it with effects in it (at the base effects, building, loop and media require scene3d: the implementer decides how the build holds effects without it). Its `registry` lists effects and not scene3d |
| `test-gpu-output-in-effects` | The planted layout `gpu_output_in_effects`: the effects module declares `gpu.output@1` itself instead of the core (as `test-ease-in-motion` and `test-export-target-in-media` plant theirs). With `test-leave-out-effects`, nothing declares it, so scene3d's entries have no registry and the seal refuses the startup |

7. **`deep-show run`** as at the base and #200: a startup answers `registry` (`{modules: [...]}`) or exits 2 with one
   line `{ok: false, code: "seal_refused", reason, registry?, entries?, modules?, what}`, which for the planted layout
   names `gpu.output@1` (in `registry` or anywhere in the line); `schedule` answers `{interfaces: {"effects@1": {digest,
   module}}}`; `deep show` (`{call: "deep show", peer, doc, document, include: ["issues", "pixels"], size}`) answers
   `{outcome: "presented", snapshots: [{sha256}]}`, or `unsupported_platform` where no GPU draws.
8. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
   `crates/deep-gpu-layer/src/main.rs`:

| Name | The wrong program | Criterion |
|---|---|---|
| `light_drops_fresnel` | `core.light@1` without its Fresnel term (F taken as 1), wherever a part shades by it: a material that names it and every part with no response, whose light it is by default; everything else as shipped | AC1 |
| `loop_shadow_one` | The light loop hands `light` a shadow of 1 for every light, whatever its shadow maps say | AC2 |
| `loop_calls_cut_lights` | The light loop also calls `light` for each light the policy cut, at weight 1, after the shaded ones | AC3 |
| `loop_world_normal` | The light loop hands `ambient` the world-space normal as `n` | AC5 |
| `loop_view_away` | The light loop hands `ambient` (and `light`) `v` pointing away from the eye, the right `v` negated | AC6 |
| `ambient_adds_nz` | `core.ambient@1` adds 0.01 × n.z (n the view-space normal) to every channel of what it returns, wherever a part shades by it, named or by default | AC7 |

9. **The merge base** is `git merge-base HEAD origin/main`; its own `deep-gpu`, castle, look and recipes draw today's
   shading (AC1, AC7).
10. **`tests/acceptance/485/TASTE.json`** records the taste call, the one file anyone adds to this folder after this
    commit, and only to record the owner's answer: `{"issue": 485, "criterion": "#485.977f4f15", "verdict":
    "looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {name → sha256 for the two PNGs}, "note"?}`.

The fixtures use only what the base has besides these: `mark.box@1`, `ball@1`, `light.sun@1`, `light.point@1`,
`light.spot@1`, `camera@1`, `sky@1`, `look@1`, `material@1`'s fields, collections, `light_policy`, the castle and its
recipes, and the op table's `const`, `dot`, `max`, `min`, `mul`, `add`, `floor` and `compose`.

## The CPU references

`reference.ts`, in f64, from geometry alone; nothing is taken from the renderer. #378's pinhole and the transform order
R = Rz·Ry·Rx (as #446's helpers have them), a ray against a sphere and against a box.

- **AC2.** The sun at `at.rot` [−45, 60, 0] points toward (0.6124, 0.7071, 0.3536), 45° up. For each pixel centre the
  ray meets the unit sphere or not; where it does, n · l, and whether the ray from that point toward the sun meets the
  post shrunk by 8 cm on every side (deep in its shadow, past any penumbra, filter or bias). Of the 82,240 pixels whose
  centres meet the sphere, 79,664 have their 5 × 5 block on it; 6,593 of those lie deep in the post's shadow with
  n · l ≥ 1/3 + 0.05, which a shadow of 1 would put in an upper band. Without MSAA the interior holds 46,961, 19,350 and
  13,353 pixels in the bands 0, 1 and 2.
- **AC5.** At each of the eight positions the centre pixel's ray meets the sphere where its view-space normal is
  (0, 0, 1) within 3e-16.
- **AC6.** With the object-ID target's rule (a pixel takes the item any of its four samples covers, at the standard 4×
  positions), 1,672 pixels are interior within 2 px of the outline, and n · v at their centres is at most 0.1453.

## Readings where the issue and design leave a choice

- **"Set on every material"** is every `material@1` item of the fixture naming one operator, `responses`, that writes
  nothing and answers with `core.light@1` and `core.ambient@1`; parts with no material item (the castle's recipe parts,
  painted by role, and its clouds) shade by the defaults anyway. **"With no response"** is the fixture as it is, drawn
  by this checkout and by the merge base, whose shading is today's: the defaults must equal both.
- **"The house fixture"** is #446's house at night (two rooms lit by two shadowed point lamps, two shadowed downlights
  and a lamp kept to its room by receivers, seen through glazed windows), the house of #446, which this issue is
  blocked by, and the one whose lights exercise the loop's local lights, shadows and receivers; its materials here are
  plain dielectrics with their specular lobe, where #446's were mattes without one, so a wrong Fresnel term shows. One document serves AC1 (`view3d`) and AC4 (`deep show`, as your shell sends it).
- **"The pixel hash it has under the default responses"** (AC7), before n and v were added, is the castle's hash at the
  merge base, where it shades by today's shading, which AC1 holds the defaults to.
- **"Exactly three linear values per channel on its interior pixels (those whose samples all hit the sphere)"** (AC2):
  the renderer draws 4× MSAA and resolves color in the pass, and a pixel's samples on two triangles of the sphere take
  each triangle's own shading; where a band edge crosses such a pixel, it resolves to j/4 of the way between two adjacent
  bands. A simulation of the 128-segment sphere put about 7 such pixels among 82,000. So per channel the three values
  held by the most interior pixels must be 0, m and 2m (the ambient is 0 and nothing is emitted; the band ÷ 2), within
  0.2% of the brightest value, and every other interior value must be such a resolve, on at most 0.1% of the interior.
  Interior pixels are those whose 5 × 5 block shows only the sphere in the ID target, which gives a pixel the item any
  of its samples covers. "Before tone mapping" is the linear target.
- **"The post's shadow"** is the interior pixels deep in it by the CPU reference (8 cm inside the post's outline, as a
  ray toward the sun sees it) where n · l ≥ 1/3 + 0.05; each must read the lowest value in every channel. **"The first
  such pixel"** is the first in row order that reads above it.
- **"A pixel inside all 40 lights' ranges"** is the frame's centre, on the back wall; every light's range is 40 m and
  none is farther than 7.91 m. **"None sits within the cut's margin"** is `light_cut`'s weights all 1 (the dimmest of the
  32 scores 9.33, the brightest cut light 0.146, so the margin's ramp is past 1 by far). **"Gives 0.32"** is 0.32 within
  0.001 in every channel of the linear target; 0.40 the same. **"Counts as 0"** is the pixel reading 0 within 1e-6.
  **"Once per operator and time"** is exactly one notice naming the operator in each of two frames, at each one's t.
- **"A test build with scene3d and without the effects module"** is `full,test-leave-out-effects`; **"the full build"**
  `full`; **"shades by core.light@1"** is the house with no operator, whose light is core.light@1 by default; **"builds
  with and without scene3d"** are `full` and `full,test-leave-out-scene3d`; **"in that build"** is the build without
  effects with the planted layout, and **"refused at its seal, naming gpu.output@1"** the startup's refusal line.
- **"8 camera positions on an orbit"** are azimuths 0° to 315° every 45° at 3.5 m in the horizontal plane, 0° on +Z;
  the quarter orbit is 90°, on +X, where the world-space normal at the centre is (1, 0, 0). **"Its centre pixel"** is
  (256, 256) of a 513 px frame, on the axis. "Within 1/255" is per channel.
- **"Interior pixels within 2 px of its outline"** (AC6) are those whose 3 × 3 block is all the sphere's in the ID
  target and whose 5 × 5 block isn't; at least 1,000 must be found, and each reads under 0.2 in every channel.
- **"Naming the fixture and its first differing pixel"**: the frames' final targets, which the pixel hash covers, are
  compared in row order and the failure names `the castle` or `the house` and `pixel (x, y)`.
- **The pictures** (AC8) are AC2's sphere under a filmic look at EV 0 and AC3's room with its plaster under the cel
  response (a light grey base color) under a filmic look at EV 5, so the 32 shaded lamps band their own pools; AC3's
  response of 0.01 a call would draw a flat grey with nothing to judge.

## The taste call

`taste.test.ts` writes these to `target/acceptance/485/`, printing each SHA-256:

| File | What it shows |
|---|---|
| `cel-sphere.png` | AC2's sphere under its cel response, with the post's shadow across its lit side; the renderer's final PNG byte for byte |
| `room-32-lights.png` | AC3's room, its 40 point lights of which the policy shades 32, its plaster under the cel response; the renderer's final PNG byte for byte |

They are attached to the PR and shown to the owner in the session; the answer is recorded in `TASTE.json` (Assumed
surfaces, 10). No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on
exactly this run's pictures passes. No other test reads these pictures or the call.

## Oracle

The oracle page lists upstream tests for criterion 2 alone: Blender's EEVEE lighting-node tests at `0a18557098`
(`tests/files/render/lighting_nodes/light_eval.blend`, `light_info.blend`, `shadow_cast.blend`, their `eevee_renders`
references, and `tests/python/eevee_render_tests.py:450-452`'s 6/255 threshold), which render materials built on a
per-light accumulation zone against stored references. They need Blender to run, and nothing here runs Blender: that
lane has no runner and stays BLOCKED, with one unblock ask (#136's runner). This suite's AC2 is ours (the three bands and
the planted shadow of 1); it doesn't run or port the Blender files. The other seven criteria have no upstream test.

## Not tested, because no criterion asks

`deep_kinds` listing core.light@1 and core.ambient@1 with their ports, light functions, and core.ambient@1's two new
ports (scope only); a response's steps counted in the operator's cost times the lights in each pixel's cluster; its
pixels under the status guard; `light_hash`, `irradiance` and `env` as a response reads them, and `radiance` after an
IES distribution, a light function or receivers; a non-finite return (the criterion names −1); a response named as a
pack's step function; `vertex_offset`'s behavior (AC4 reads only its entry); what a response can never do beyond the
cut lights (a shadow map, the light list, a status color, carrying light between frames); rays and path-traced finals,
new light shapes, a light function on the sun and instancer cycles (out of scope). The implementer owes these a mapping
or a note (AGENTS.md: review requirement → change → proof).
