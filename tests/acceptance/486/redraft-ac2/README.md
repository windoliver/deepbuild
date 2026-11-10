# Blind redraft of #486's AC2 test

Written by a fresh run of the acceptance-test job (technical design: Dogfooding, "Tests written first, by a job that
never sees the code"), for one criterion of issue #486, from the issue, the design and the base commit `d51be2c3`
("Merge pull request #2108 …") only. No implementation, later commit, branch, PR or other worktree was opened, and no
`tests/acceptance/486/` suite existed at the base. The folder stands alone: it imports nothing outside itself but node
built-ins and vitest. One file, two tests: the shipped behavior, and the planted program failing the same check.

## The criterion

AC2 `#486.f7c1ed7f` (the first 8 hex digits of SHA-256 of the text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped; recomputed here and equal):

> occlusion darkens only what ambient occlusion darkens: on a plate under a sun and a studio environment, with the
> look's ao off and an emissive square on the plate, an operator that writes occlusion 0 everywhere matches within one
> 10-bit code value the same plate with the environment's lighting and the probes removed, the square keeping its
> emission, and one that writes 1 matches the plate with no operator; a planted occlusion that also scales direct
> light or emission darkens the sunlit plate or the square and fails, naming the pixel

## What was read

- Issue #486 in full (scope, seven criteria, proof line, dependencies #429, #200, #428).
- `AGENTS.md` (Proof); `docs/technical-design.md`: GPU operator ("A material operator also writes, per pixel, any
  lobe its material has, … and occlusion") and Dogfooding.
- `docs/canvas-primitives.md`: Operator output (the material operator's `occlusion: f32 (0..1)`; "`specular_level`
  and `occlusion` need no lobe"; "`occlusion` scales only what ambient occlusion scales (ambient, probe and
  environment light), multiplying the look's ao and any occlusion map, and never direct light or emission"; It can
  never: "darken direct light or emission through `occlusion`"); Operator output: light response (`ambient`'s
  `irradiance` is "probes and the environment, after ambient occlusion"); Material and Material: texture maps (the
  occlusion map); Look `look@1`: ao (`ao: … | none = none`; it "scales only the ambient, irradiance-probe and
  environment terms … direct light and emission are never darkened"); Sky `sky@1`: environment (`from: studio`, "a
  shipped neutral room"; `sky` and `studio` "light and reflect while the sky's own fields draw the background"); Light
  probe `light.probe@1` (fields, "falls back to the sky's environment", "figures and data views refuse probes").
- At the base, for surfaces and conventions only: `crates/deep-gpu-layer/src/main.rs` (`run`, `--planted`,
  `Planted::parse`, `bad_input`) and `view3d.rs` (a refused operator refuses the frame with `operator_compile`);
  `crates/deep-canvas/src/registry/core_lists.rs` (`OUTPUTS`); `crates/deep-canvas-effects/src/check.rs` (outputs typed
  against `OUTPUTS`), `emit.rs` (`MAT_OUTPUTS`, `MatOut`) and `module.rs` (the three operator kinds as items);
  `crates/deep-scene3d-render/src/op.rs`, `op.wgsl` and `scene3d.wgsl` (`shade`, `env_light`, `sky_light`);
  `crates/deep-scene3d-render/src/env.rs` (`studio`); `crates/deep-canvas-scene3d/src/sky.rs` (`environment`),
  `probe.rs` and `scene.rs` (probe items), `light.rs` (`material`, `material_op`), `look.rs` (`ao`); and the suites
  `tests/acceptance/481` (build, run, targets, PNG reading, copied into `helpers.ts`), `446` (the operator item's
  shape, class showpiece), `429`, `431` and `432` (the 10-bit code reading).

## What the base already does, which this test doesn't credit

Material operators draw (#429) with the outputs `base_color`, `alpha`, `emission`, `metallic`, `roughness` and
`shadow_filter`; the operator check refuses any other output with `operator_type`. An occlusion map already scales
only the ambient term in `shade` (`d.color + ambient * m.occlusion + m.emission + through`), so the rule the
criterion states holds for maps. The studio environment, `ao: "none"` and reflection probe items are read; at the
base a probe's capture feeds its diagnostic mode, not shading. So both tests fail at the base (BASE-FAILURE.txt),
read from the code, not run.

## Run them

They build `deep-gpu` with cargo (on macOS only), so they run alone; `scripts/lanes.mjs` needs
`'tests/acceptance/486/'` (or this folder) in its `alone` list, the adopter's edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/486/redraft-ac2 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/486/redraft-ac2/tsconfig.json
```

Both tests draw on macOS's Metal device; off macOS each fails with a message starting `INCONCLUSIVE:` before it
builds anything, never passes. A run with `--root` leaves Vitest's cache in
`tests/acceptance/486/redraft-ac2/node_modules/.vite`; delete it.

## Criterion to tests

Both in `occlusion.test.ts`; each name starts with `AC2 #486.f7c1ed7f`.

| Clause | Test |
| --- | --- |
| a plate under a sun and a studio environment, the look's ao off, an emissive square on the plate | the fixture (below), shared by both tests; `fixtureFailures` proves it holds first |
| an operator that writes occlusion 0 everywhere matches within one 10-bit code value the same plate with the environment's lighting and the probes removed, the square keeping its emission | test 1: `occlusion_0` against `no_environment`, on every interior pixel of the plate and of the square |
| one that writes 1 matches the plate with no operator | test 1: `occlusion_1` against `no_operator`, the same way |
| a planted occlusion that also scales direct light or emission darkens the sunlit plate or the square and fails, naming the pixel | test 2: `--planted occlusion_scales_direct` fails the same check, with a plate or square pixel more than one code darker, named by its coordinates in the check's failures |

## The fixture

`helpers.ts`: `plateDoc`. One frame of 480 × 480 px through a pinhole camera at (0, 0, 1.2) m looking at the origin,
32° across. The plate is a `mark.box@1` 0.6 × 0.6 × 0.02 m whose front face is at z = 0 facing the camera (base color
[0.55, 0.5, 0.45], roughness 0.6, metallic 0, the default specular); the square is a `mark.box@1` 0.2 × 0.2 × 0.004 m
centred on it 1 mm proud of it (base color [0.05, 0.05, 0.05], roughness 0.6, emission [0.8, 0.4, 0.1]). One
`light.sun@1` of π lx, unshadowed, at `rot` [−20, 15, 0] (about 25° off the plate's normal). The look: tone map none at
the exposure whose scale is 1, no bloom, no deband, `ao: "none"`. Four documents, drawn in one `deep-gpu run`:

| Document | Sky | Probe | Operator on the plate's and the square's materials |
| --- | --- | --- | --- |
| `occlusion_0` | black, no ambient, `environment: {from: "studio", intensity: 1}` | reflection, 1 m box at (0, 0, 0.3) | `occlusion` 0 |
| `occlusion_1` | the same | the same | `occlusion` 1 |
| `no_operator` | the same | the same | none |
| `no_environment` | black, no ambient, no environment | none | none |

The fixture holds only if, read from the frames without an operator (which no planted occlusion can move): at least
20,000 interior plate pixels and 2,000 interior square pixels are drawn; the sun lights the plate (its mean
luminance in `no_environment` at least 0.1); the environment and the probe add at least 0.05 to the plate's mean
luminance (`no_operator` minus `no_environment`, about 51 codes); and the square's emission shows (its mean luminance
in `no_environment` at least 0.3). So neither match can pass on a part that is missing, unlit or not emitting.

## Assumed surfaces

Fixed by the suite's first draft and kept here:

1. A material operator is an item `{kind: "gpu.material@1", params: {origin, about, inputs, steps, outputs, cost}}`
   named by `material@1.params.op`; `occlusion` is an `f32` output (0..1) in `params.outputs`, naming the step that
   gives it. Here: one `const@1` step of type f32, `outputs: {occlusion: "occ"}`, origin `composed`, cost 50 ns/px.
2. `view3d` as at the base: `targets: ["final", "linear", "ids"]` with `picks`; a part's pixels by object ID; driven
   through `deep-gpu run [--planted <name>]` JSON lines, the binary built with `cargo build --locked --bin deep-gpu`
   once per file.
3. The studio environment is `sky@1.environment: {from: "studio", intensity: 1}` over a black sky with no ambient, so
   the environment is the only ambient light; a probe is `light.probe@1 {type: "reflection"}` whose box holds the
   plate; "the environment's lighting and the probes removed" is the same document with the environment and the
   probe item removed; "the look's ao off" is `ao: "none"`.
4. The planted wrong program is `--planted occlusion_scales_direct`: the `occlusion` output scales the whole shaded
   color, the direct light and the emission with the ambient term; everything else as shipped.

Added here: documents name the effects module beside scene3d and take budget class showpiece, since figures and data
views refuse probes (Light probe `light.probe@1`: Cost), as #446's documents with operators do.

## Readings

- **One 10-bit code value** is 1/1023 of max(1, |reference|) on the linear target's value, per channel (#429's,
  #431's and #432's reading); a pixel matches when each of R, G and B is within one code. The criterion gives no
  share, so every interior pixel must match, unlike AC1's 99.9%.
- **Interior pixels** are those whose every neighbour within 1 px shows the same part in both frames' ID targets,
  so the edges MSAA mixes with the background or the other part aren't judged.
- **"The same plate with the environment's lighting and the probes removed"** is drawn with no operator. With the
  environment gone there is nothing for occlusion to scale, so the shipped program draws it the same with or without
  the operator; drawing it without one keeps the reference out of the occlusion output's reach, so a planted program
  can't move the reference along with the frame it judges.
- **"The environment's lighting"** is all of it, its diffuse and specular light alike, so the plate keeps the default
  specular: occlusion 0 must remove the environment's reflection too, as the base's occlusion map already does by
  scaling the whole ambient term.
- **The square under the operator**: "writes occlusion 0 everywhere" puts the operator on the square's material as
  well as the plate's, so "the square keeping its emission" is judged under the operator, not on a part it never
  reaches.
- **The sun is unshadowed**: the criterion names no shadow, and none is needed to tell direct light from ambient.
- **"Darkens … and fails, naming the pixel"**: test 2 passes only when the check fails, some plate or square pixel
  reads more than one code darker than its reference, and the check's failure lines name such a pixel by its (x, y).
  Either pair may carry it; under the planted program occlusion 1 scales nothing, so it is the occlusion-0 pair.
- **A program wrong on every pixel**: the check keeps a count per part and pair, the most darkened and most
  brightened pixel and the first three off, never one line per pixel, and asserts on the count, so a frame wrong on
  all of its ~175,000 judged pixels fails at the assertion with a bounded message. A non-finite value counts as off.
