# Acceptance tests for #428: 3D materials — extra lobes from sheen and anisotropy to dispersion, iridescence and flakes

Written first, from issue #428 (its scope, its nine acceptance criteria and its proof line), the design sections it
links and those they lean on, its oracle page, and the base commit `1d3ae632` ("Merge pull request #1310 …"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, at most two tests each,
plus exactly the planted twins the criteria name.

## What was read

- Issue #428, and #422 and #423 for vocabulary (the castle, the white furnace, the compensation, `imports`,
  `dropped`). The oracle page (`doneright/oracles/issues/428.md` in `DeepBuildAI/deepbuild`, branch `doneright`; no
  `cases/428.json`): upstream tests for criteria 1 and 2, the seven Khronos models those criteria name, at
  glTF-Sample-Assets `edc7c9e67c`; none for 3 to 9. **Ported, run on our output:** all seven models, each held to what its
  own JSON declares (helpers: `lobeFieldProblems`) and rendered against a CPU reference of its lobes; AnisotropyStrengthTest's
  README rule ("anisotropy should not offer any effect when material roughness is 1.0") as AC1's column check;
  AttenuationTest's README answer key (its "Sample Color" row) is judged with the blocks by the same reference.
- `docs/canvas-primitives.md`: Builders, recipes, looks and cameras; The cost model (the showpiece row: 10 ms full screen
  at render scale 0.5 while moving; "Every class draws nothing while still"); Material (every field and sentence of the
  lobes: sheen, anisotropy, translucency, transmission and `ior`, absorption, dispersion with s = (ior − 1) × 0.025 ×
  dispersion, iridescence, specular color, the compensation, diffuse roughness, retroreflection, flakes; the Cost line);
  Material: texture maps (the extensions an import maps; "a lobe's own thickness, iridescence or specular texture …
  is listed per material in the probe's `dropped`"); Asset: meshes (`dropped`, `extension_required`); Builder: uv
  (`uv0: sphere`); Light and the light policy (`shaded ≤ 32`); Look `look@1`: tone mapping; Camera `camera@1`; the
  castle and showpiece lines.
- `docs/technical-design.md`: Dogfooding; taste calls and "Shown to you"; Every task carries its own budgets; The
  reference Macs.
- The published texts the CPU references follow (README: The CPU references): glTF 2.0 Appendix B; KHR_materials_sheen,
  _anisotropy, _diffuse_transmission, _transmission, _volume, _dispersion, _ior, _iridescence, _specular,
  _diffuse_roughness; OpenPBR 1.1's EON; Belcour and Barla 2017 as KHR_materials_iridescence gives it; the glTF Sample
  Viewer's raster transmission, which the transmission and volume texts point implementers to.
- At the base: `crates/deep-gpu-layer` (`main.rs`'s calls and `Planted` table; `view3d.rs`: `imports`, `assets`, `uris`,
  `licenses`, `targets`, `picks`, `timings`, `surface`, `packs`, `light_cut`, `cold`, `from`; `lod.rs`'s `cut_json`),
  `crates/deep-canvas-scene3d` (`light.rs`: `material@1`'s fields, `specular_color` read, the light policy over every
  light, `seed`; `gltf.rs`: the material import, `READ`, `dropped`; `builders.rs`: `ball@1`; `uv.rs`: `sphere`; `scene.rs`:
  `mark.box@1` a centred unit box), `crates/deep-scene3d-render` (`scene3d.wgsl`: `direct`, `spec_lobe`, the
  compensation, geometric specular antialiasing and the lobe never narrower than the pixel, `hash3`, `local`), and the
  suites `tests/acceptance/421/` (`live` and the still scene), `422/` (the castle, the furnace, the timing rule, the
  taste call), `423/` and `423/redraft` (Khronos fetch by hash, `imports`), `424/` (the budget pair), `425/redraft` (the
  evidence folder), `429/` (INCONCLUSIVE under load) and `1015/`, `1017/` (the perf lane against the merge base).

## What the base already does, which these tests don't credit

`view3d` draws scene3d documents with #421's shading core and #422's compensation, sky, environment and castle; #423's
import maps glTF's core material, KHR_materials_emissive_strength and KHR_materials_unlit, and lists every other
extension, and every texture inside one, in `dropped`; `material@1` reads `specular_color` into the lobe; the light policy
shades 32 lights and `light_cut` reports them (#425); `cold` reports a cold start (#854); `live` settles a still scene
(#421). There is no sheen, anisotropy, translucency, transmission, absorption, dispersion, iridescence, diffuse
roughness, retroreflection or flakes; no import of any lobe extension, `KHR_materials_ior` or `KHR_lights_punctual`
(DiffuseTransmissionTest requires it, so the base refuses it `extension_required`); no `cold.build_ms`; no perf-lane
task for #428; and none of the planted names below.

## Run them

They build `deep-gpu` (`cargo build --locked --bin deep-gpu`), as #421's to #425's suites do, so they run one file at a
time. `scripts/lanes.mjs` needs `'tests/acceptance/428/'` added to its `alone` list, beside `tests/acceptance/422/`; this
README is the instruction, the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/428 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/428/tsconfig.json
```

Every test draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes.
AC8's first test also requires a reference Mac (`hw.model` Mac15,7 or Mac15,12) and reads INCONCLUSIVE off one, or when
a timing misses with the one-minute load over 1 a core. AC1, AC2 and AC9 need the network once, to fetch the Khronos
samples into the cache; without it and without the cache they fail with a message starting `BLOCKED:`. `taste.test.ts`
writes into `docs/evidence/428/` and keeps what it writes; every other test writes into its own temporary folder and
deletes it. `reference.ts` imports no vitest, so its references can be run on their own (BASE-FAILURE.txt).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped. Each test's name starts with `AC<n> #428.<id>`.

| ID | Criterion (short) | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#428.df10ac08` | SheenChair, AnisotropyStrengthTest, DiffuseTransmissionTest import their lobes and render within 1% of a CPU reference; roughness 1 column = strength 0 within 1 code; highlight ≥ 3× longer along the tangent at roughness 0.2; wrap 0.5 dark at 120° ±1°, wrap 0 at 90°; each lobe ≤ 1 in the furnace | `sheen-anisotropy-translucency.test.ts` (2). 1: each sample fetched by hash, never committed, drawn with `imports`; its sheen, anisotropy and translucency fields are the file's; every judged pixel within 1% per channel of `reference.ts` (README: Readings, the samples); nodes 43–48 match node 42 within 1 code value. 2: a white metal ball at roughness 0.2, strength 1 under a sun behind the camera, the run above half the peak along x ≥ 3 × along y; wrap balls lit from +x go dark (under 0.2% of peak) at 120° and 90° within 1°; four lobes at full strength at five roughnesses ≤ 1.01 in the furnace. Catches: the base; a lobe off its field or its published form; anisotropy at roughness 1; a wrong wrap; energy gain |
| AC2 `#428.7a966fa8` | AttenuationTest, DispersionTest, IridescenceDielectricSpheres, SpecularTest import their lobes, render within 1%, drop only their lobes' textures; four lobes ≤ 1 in the furnace; planted import that drops dispersion fails naming the material | `volume-dispersion-iridescence-specular.test.ts` (2). 1: fields; `dropped` exactly AttenuationTest's thickness texture and SpecularTest's specular and specular color textures; render against the raster transmission model over the suite's backdrops, the iridescent spheres per pixel, SpecularTest's roughness-0 spheres by mirror flux F0·E·R²÷4 within 1%; `--planted drops_dispersion` fails naming `Mat_IOR_1.50_D5`. 2: volume, dispersion 5, iridescence, specular color 25 at five roughnesses ≤ 1.01. Catches: the base (each extension listed whole in `dropped`); a lobe dropped, silent or off its form; energy gain |
| AC3 `#428.1870c341` | 4 cm slab = [0.5, 0.8, 1] × 2 cm within 1%; panes 0/0.3/0.6 widen an edge in order, roughness 0 within 1 px of bare, each within 2 codes of a CPU mip blur; a line through a 30° slab splits at 1.4875/1.5/1.5125 within 0.5 px (≥ 3 px red to blue), one line at dispersion 0; three planted models fail naming the material | `transmission.test.ts` (2). 1: the slabs over a white unlit backdrop; the panes over a black-to-white edge, their 10–90% widths increasing, the 50% crossing of `frost_000` within 1 px of the bare row's, every pane pixel within 2 codes of the CPU mip blur of the drawn opaque copy; `--planted absorption_ignores_thickness` names `glass_4cm`, `--planted transmission_ignores_roughness` names `frost_030` and `frost_060`. 2: centroids of each channel's line against `lineColumn`; `--planted dispersion_samples_once` names `prism`. Catches: a fixed path length; a blur that ignores roughness or picks another level; one sample for three channels |
| AC4 `#428.f0dfcbc8` | Black sphere with specular_color [1, 0, 0]: centre red within 1%, green and blue 0 within 1 code; films at 100–500 nm match the thin-film Fresnel within 1% at 8 view angles; planted twins fail naming the material | `specular-iridescence.test.ts` (2). 1: `red_specular` under a sun along the view, 2 × 2 centre; `--planted specular_color_ignored` names it. 2: five films, 8 suns at 2θ, each ball's mirror-point pixel within 1% per channel of the lobe with KHR's thin-film Fresnel; the five references differ by > 2%; `--planted iridescence_ignores_thickness` names a film. Catches: the base; a color on f90; a film at the wrong angle, thickness or IOR |
| AC5 `#428.657b57c7` | In the furnace, diffuse_roughness 0.5 and 1 = 0 within 1% at every pixel; under a sun behind the camera, 1 matches EON within 1% at 10 points; planted Lambert and uncompensated Oren-Nayar fail naming the material | `rough-diffuse.test.ts` (2). 1: `clay_000/050/100` in the furnace, pixel for pixel; `--planted oren_nayar_uncompensated` names `clay_100`. 2: `clay_100` at 10 points centre to limb against `reference.ts`'s EON; `--planted diffuse_lambert` names `clay_100: point 9`. Catches: the base (Lambert); FON alone; another Oren-Nayar |
| AC6 `#428.1da426e1` | White metal panel, retroreflection 1, point light at the camera, 0/20/40/60°: centre within 1% of the mirrored-view lobe; ≤ 1 in the furnace; = retroreflection 0 at 0° within 1%; planted reads under 1% at 40° and fails naming the material | `retroreflection.test.ts` (2). 1: `retro_100` centre (2 × 2) against the compensated lobe at v mirrored about n, `retro_000` at 0°; `--planted retroreflection_ignored` reads under 1% of the reference at 40° and fails naming `retro_100: turned 40°`. 2: the furnace at four angles. Catches: the base; a mirrored lobe that isn't the lobe's, or that adds energy |
| AC7 `#428.b8f33c38` | Flakes {1, 1 cm, 15°}: bright cells exactly where the f64 CPU flake normals put h inside the lobe's half maximum (±0.1° unjudged), the same seeked, played and after a dolly; weight 0 byte for byte as no flakes; planted pixel hash fails naming a cell | `flakes.test.ts` (2). 1: 10,000 cells' centre pixels at frames 0 and 30 played and 30 seeked, bright above half the brightest, against `flakeNormal` and the GGX half-maximum angle at coat_roughness 0.3; seeked = played; `--planted flakes_by_pixel` names a cell. 2: weight 0 and no flakes, final and linear byte-equal at two frames. Catches: the base; flakes hashed by pixel, world or frame; another hash or width; flakes drawn at 0 |
| AC8 `#428.d719d951` | Castle under 10 ms GPU a frame full screen at render scale 0.5 while moving with 64 lamps cut to 32; build under 500 ms; a still scene draws nothing; lobes on every part of the product fixture add under 1 ms at 1080p; compared with the merge base | `budgets.test.ts` (2). 1 (reference Mac): the castle's frame-0 `light_cut` 32 shaded of ≥ 64; each run's p95 `gpu_ms` over 300 frames at the display size, internal scale 0.5, under 10; `cold.build_ms` under 500; the still product fixture in `live` draws and submits nothing after 8 frames; the product fixture with and without the three lobes, median difference under 1 ms; all by the five-run rule. 2: the perf lane's #428 task valid against the merge base's budgets, and it runs. Catches: lobes paid for by every part; an over-budget castle; a redrawing still scene |
| AC9 `#428.8c47edc1` | Shown to you: four sample screenshots, the flake panel and its dolly recording; one taste call recorded, else INCONCLUSIVE | `taste.test.ts` (1): writes the pictures and the recording to `docs/evidence/428/` from this run's output, then reads `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's |

## Assumed surfaces

The issue and design name the behaviors but not these calls and fields; each is this job's choice, the most natural
one beside the base's own calls. The implementer provides exactly these.

1. **`material@1`'s lobe fields as Material names them**, in `params`: `sheen: {weight, color, roughness}`,
   `anisotropy: {strength, rotation: deg}`, `translucency: {kind: "thin" | "wrap", amount, color, wrap}`,
   `absorption: {thickness: m, attenuation: {color: linear RGB, distance: m}}`, `dispersion`, `iridescence: {weight,
   ior, thickness: nm}`, `specular_color: linear RGB`, `diffuse_roughness`, `retroreflection`, `flakes: {weight,
   size: m, tilt: deg, color}`, beside the base's `transmission`, `ior`, `specular_level`, `coat`, `coat_roughness`,
   `pattern_seed` and `unlit`. Colors other than the two linear RGB fields are `[r, g, b, a]`, as `base_color`.
2. **The import maps each lobe extension to those fields** in #423's `imports` report: KHR_materials_sheen →
   `sheen {weight: 1, color: sheenColorFactor, roughness: sheenRoughnessFactor}`; KHR_materials_anisotropy →
   `anisotropy {strength: anisotropyStrength, rotation: anisotropyRotation in degrees}`;
   KHR_materials_diffuse_transmission → `translucency {kind: "thin", amount: diffuseTransmissionFactor, color:
   diffuseTransmissionColorFactor}`; KHR_materials_transmission → `transmission`; KHR_materials_ior → `ior`;
   KHR_materials_volume → `absorption {thickness: thicknessFactor, attenuation: {color: attenuationColor, distance:
   attenuationDistance, absent when infinite}}`; KHR_materials_dispersion → `dispersion`; KHR_materials_iridescence →
   `iridescence {weight: iridescenceFactor, ior: iridescenceIor, thickness: iridescenceThicknessMaximum}`;
   KHR_materials_specular → `specular_level: specularFactor ÷ 2`, `specular_color: specularColorFactor`. An extension
   the import reads is not in `dropped`; a texture inside it is, as `{material: <index>, input: "<extension>/<property>"}`
   (the base's form).
3. **The import reads KHR_lights_punctual** (DiffuseTransmissionTest requires it): a directional light lights the view
   as a `light.sun@1` at its node's world transform, `intensity` its illuminance in lx, with its `color`.
4. **The white furnace** is #422's (`sky@1` white at both ends, no ambient, `environment: {from: "sky", intensity: 1}`),
   and a black `sky@1` with no ambient and no environment leaves the document's lights the only light (#422).
5. **The orthographic `camera@1`** is #423's (`projection: "orthographic"`, `position`, `target`, `view_width`), looking
   along −Z, a pixel's centre at `reference.ts`'s `orthoPoint`; a scene item's node is picked `<item>#<node name>`, or
   `<item>#<node index>` for an unnamed node (#423).
6. **The raster transmission model** the references hold transmission to (Material: "samples a copy of the opaque
   scene … at a level its roughness sets"; glTF Sample Viewer's): light through a transmissive pixel is transmission ×
   (1 − weight × max F(n·v)) × base color × attenuation color^(thickness × scale ÷ distance) × the opaque copy at the
   frame position of p + normalize(refract(view ray, n, 1 ÷ ior_c)) × thickness × scale (p itself at thickness 0), once
   per channel at its own IOR with dispersion, the copy taken at the frame's size with mips of 2 × 2 box averages and
   read trilinearly at level log2(max(width, height)) × roughness × clamp(2·ior − 2, 0, 1).
7. **The flake cells**: a cell is floor(p ÷ size) of the part's own-space position p (metres from the item's origin
   along its axes, the base shader's `local`); its flake normal tilts from the part-space shading normal by θ with
   cos θ = 1 − u1 × (1 − cos tilt) toward φ = 2π × u2 in Duff et al.'s orthonormal basis, where u1 = hash3(cell, s) and
   u2 = hash3(cell, s + 1) with the base shader's `hash3` (scene3d.wgsl) and s the base's `seed` of `pattern_seed`
   (FNV-1a over its JSON text, 0 without one); its lobe is GGX at α = coat_roughness².
8. **`view3d`'s `cold: true` reply carries `cold.build_ms`**: milliseconds from the call's start to the document's scene
   built (checked, recipes expanded, evaluated at its first frame, meshes built), before any pipeline compile or draw.
9. **The castle holds 64 lamps** (`packs/examples/castle.json` with its recipes), so its frame-0 `light_cut` (#425)
   shades 32 and names at least 64 lights between shaded and left out.
10. **The perf lane has a task for #428** in `benchmarks/budgets.json`, its `initialReason` naming `#428`, valid against
    the merge base's budgets by `scripts/benchmark.mjs`'s `validateBudgets`, whose command exits 0.
11. **The compensation on a lobe this issue adds** reads E at the material's own roughness from the DFG table (as on the
    base lobe), with the lobe's own F0: the metal's base color, the dielectric's weight × F0, the film's F.
12. **`ball@1` with `uv0: "sphere"`** (Builder: uv) runs u round the ball's y axis, the tangent anisotropy stretches along.
13. **`tests/acceptance/428/TASTE.json`** records the taste call (README: The taste call), the one file anyone adds to
    this folder after this commit: `{"issue": 428, "criterion": "#428.8c47edc1", "verdict": "looks_right" |
    "looks_wrong", "who", "when": ISO 8601, "screenshots": {name → sha256 for the five PNGs and the recording}, "note"?}`.
14. **The Khronos cache** is `~/.cache/deepbuild-acceptance/khronos/<sha256>`, outside the checkout.
15. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
    `crates/deep-gpu-layer/src/main.rs`:

| Name | The wrong program | Criterion |
|---|---|---|
| `drops_dispersion` | The import leaves KHR_materials_dispersion in `dropped` and draws dispersion 0 | AC2 |
| `absorption_ignores_thickness` | Absorption takes one fixed path length, whatever the thickness | AC3 |
| `transmission_ignores_roughness` | The copy is read at level 0 whatever the roughness | AC3 |
| `dispersion_samples_once` | Dispersion samples the copy once, at the material's IOR, for all three channels | AC3 |
| `specular_color_ignored` | The dielectric's F0 ignores `specular_color` | AC4 |
| `iridescence_ignores_thickness` | The film's Fresnel at 400 nm whatever its thickness | AC4 |
| `diffuse_lambert` | Diffuse roughness is ignored: the Lambertian lobe | AC5 |
| `oren_nayar_uncompensated` | FON's single-scattering lobe without EON's multiple-scattering term | AC5 |
| `retroreflection_ignored` | Retroreflection is ignored: the lobe at the unmirrored view | AC6 |
| `flakes_by_pixel` | The flake hash keys on the pixel's frame position instead of the cell | AC7 |

## The CPU references

All in `reference.ts`, written from the published texts, none taken from the renderer, run on the same machine as the
draw: glTF 2.0's GGX with height-correlated Smith and E by quadrature, compensated as Material says; Charlie sheen with
the extension's fitted Λ and its E by quadrature, scaled by min(1 − max(c)·E(n·v), 1 − max(c)·E(n·l));
KHR_materials_anisotropy's αt = mix(α, 1, s²), αb = α; KHR_materials_diffuse_transmission's BTDF read through the mirrored
light; KHR_materials_specular's fresnel_mix with min(F0(ior) × color, 1) × weight; KHR_materials_iridescence's thin film
(Belcour and Barla, the extension's sensitivity fit and XYZ → Rec. 709) by rgb_mix at v·h; EON (FON plus its
multiple-scattering lobe, exact albedo); retroreflection as the lobe at v mirrored about n; the raster transmission of
Assumed surface 6; the flake cells of Assumed surface 7 in f64; the half-maximum angle of GGX, sin²θ = (√2 − 1)α² ÷
(1 − α²). Checked on their own before this commit (BASE-FAILURE.txt): EON in a white furnace returns 1 to 1e-5 at
every angle and its single scattering equals FON's exact albedo; E(1, 1) = 1 − ln 2.

## The Khronos samples

Pinned to KhronosGroup/glTF-Sample-Assets commit `edc7c9e67c639d230715049ee31f9a96a6babbbe` (the oracle's pin). The suite
fetches each from `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/<commit>/<path>` on first use,
checks its SHA-256 and size, keeps it in the cache by hash (Assumed surfaces 14), checks no blob in HEAD or the index
has its bytes ("never committed"), and hands it to the product by hash only (`assets`, `uris`, `licenses`), as #423's
suite does.

| File (under `Models/`) | Bytes | SHA-256 | License |
|---|---|---|---|
| `SheenChair/glTF-Binary/SheenChair.glb` | 4,125,648 | `f0af2a2b102d28d540236306ae19f8fb36842df76bd38cf76f063f9bd2853399` | CC0-1.0 |
| `AnisotropyStrengthTest/glTF-Binary/AnisotropyStrengthTest.glb` | 94,444 | `306321ff8214727b145188ceb56d96d2882b393d0b596fa089fd20b07e959834` | CC0-1.0 |
| `DiffuseTransmissionTest/glTF-Binary/DiffuseTransmissionTest.glb` | 238,336 | `cac9152a1215177c479f33cc0f5d1b64f92010311d2316dc42dde87fa505e282` | CC-BY-4.0 |
| `AttenuationTest/glTF-Binary/AttenuationTest.glb` | 57,532 | `7ca161b7f8a9e4b2ac1f7f75816b5848bb31f3b4c226c4cb731b487c8809b756` | CC-BY-4.0 |
| `DispersionTest/glTF-Binary/DispersionTest.glb` | 2,310,944 | `bbac38386632b5a7a27289737963314c2f92095074dfdf0e8c0c1c25270b3e37` | CC-BY-4.0 |
| `IridescenceDielectricSpheres/glTF/IridescenceDielectricSpheres.gltf` | 295,192 | `fe156ca114515aa2606d35e3eea4940fcf9895559d474e14ec48dedf4e5a8575` | CC0-1.0 |
| `IridescenceDielectricSpheres/glTF/IridescenceDielectricSpheres.bin` | 34,068 | `eeacab254dfd44b8e026a8ad9e865aa1b63711eb86fa7c36180a437845e97253` | CC0-1.0 |
| `IridescenceDielectricSpheres/glTF/textures/guides.png` | 42,439 | `01cef8cce29485f2e12c422aca6330b2ec869068f8035c3f006210678afc3573` | CC0-1.0 |
| `SpecularTest/glTF-Binary/SpecularTest.glb` | 223,376 | `cf789c68c3ab4b74877da3c5992c612c213f9c901ed4fafbf9be362f434e48d9` | CC-BY-4.0 |

The GLB of each model is used where the pin has one. Licenses are each model's `LICENSE.md` at the pin; the credit
lines in `helpers.ts` come from each `metadata.json`.

## The taste call

`taste.test.ts` writes these to `docs/evidence/428/`, printing each SHA-256:

| File | What it shows |
|---|---|
| `khronos-sheen-chair.png`, `khronos-anisotropy-strength.png`, `khronos-dispersion.png`, `khronos-iridescence-spheres.png` | each sample, three-quarter view framed from its bounds, daylight sky lighting by its environment and a sun, filmic; the renderer's PNG byte for byte |
| `flake-panel.png` | AC7's flake panel at frame 0, the renderer's PNG |
| `flake-dolly.apng` | the panel at 550 × 550 through the dolly's first second at 30 fps, an animated PNG of its final targets |

They are attached to the PR and shown to the owner in the session; the answer is recorded in `TASTE.json` (Assumed
surfaces 13). No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on
exactly this run's pictures passes. No other test reads these pictures or the call.

## Readings where the issue and design leave a choice

- **"Render within 1% of a CPU reference of the same lobes"** (AC1, AC2) is per pixel, in the linear target with tone map
  none, per channel where the reference's channel is at least 0.02 (a white Lambertian square to the sun reads 1), at
  pixels where the reference is exact for any correct renderer: 2 px inside a node in the ID target, the CPU's own
  nearest hit on that node; the material's inputs all read by the reference (factors; SheenChair's base color and normal
  map, bilinear at their base level where every texture is magnified, at most one texel a pixel, and where Gram-Schmidt
  and cotangent tangent frames agree within 0.5%); the lobe wider than the pixel (|Δn|² across it under α² ÷ 2, below
  which the base widens a lobe to the pixel); and, through transmission, the copy flat over each channel's bilinear
  footprint. Each sample's view (`SAMPLE_VIEWS`) is orthographic; opaque samples are lit by one π lx sun behind the
  camera, so v·h = 1 and the Fresnel and sheen-scaling choices the texts leave open coincide; DiffuseTransmissionTest by
  its own light; the transmission samples by no light over the suite's unlit backdrops (AttenuationTest white; DispersionTest
  white lines on black), so the copy is known. Each lobe material needs at least 50 judged pixels. Run on the fetched files
  alone, the CPU judged 48,321 pixels of SheenChair's velvet at every pixel of its view, and, sampling every second
  pixel each way, 3,094 to 3,218 of each anisotropy sphere at roughness 1/3 or more (none at 0 or 1/6, whose lobes are
  narrower than a pixel), 6,080 to 6,400 of each diffuse transmission panel, every pixel of AttenuationTest's blocks, and
  4,500 to 4,612 of each prism; a CPU stand-in for `drops_dispersion` moved 57 to 105 of them on the D5 prisms by more
  than 1%.
- **SpecularTest's spheres are all at roughness 0**, a mirror no pixel resolves, so they're judged by their flux: Σ
  radiance × pixel area over each factor sphere = F0 × E × R² ÷ 4 (a mirror sphere scatters what it intercepts evenly in
  every direction), within 1% or 1% of the F0 0.04 value for the black sphere. Its texture rows are dropped and not judged.
- **"At roughness 0.2 and strength 1"**: AnisotropyStrengthTest has no 0.2 column (0, 1/6, 1/3, …), so it is the suite's
  own ball with the criterion's numbers; "the highlight" is the region above half its peak luminance, its length the run
  through the peak along the frame's x (the tangent at the ball's front) and across it y.
- **"Goes dark"** is luminance under 0.2% of the ball's peak along its centre row; the angle is the normal's from the
  light, interpolated between the last lit and first dark pixel, and nothing lit beyond.
- **"Full strength"**: sheen weight 1 in white; anisotropy strength 1; translucency amount 1 (wrap 1); absorption
  AttenuationTest's attenuation at thickness 2; dispersion 5 (DispersionTest's largest); iridescence weight 1; specular
  color 25, which raises F0 to 1 (KHR_materials_specular's min(…, 1)). "Every roughness and angle" is roughness 0, 0.25,
  0.5, 0.75 and 1, every pixel of the ball; "at or under 1" is at most 1.01, pbrt-v4's pass rule as #422 ported it.
- **"8 view angles"** for the films are θ = 0°, 10°, … 70° between n and v at each ball's mirror point (n = h), lit by a
  sun at 2θ; the thin film's Fresnel is evaluated at v·h, which equals n·v there.
- **"Widen it in that order"**: the 10–90% width of the edge along each pane's centre rows strictly increases; "the
  roughness 0 edge within 1 px" is its 50% crossing against the bare row's.
- **"Bright cells (above half the flake lobe's peak)"**: a cell's centre pixel above half the brightest cell's
  luminance, the brightest cell standing for the lobe's peak; coat_roughness 0.3 keeps the lobe's half width (3.33°) so
  that its slope there moves the edge by well under 0.1° for the variation of visibility and cosine across it; "the same
  cells … after the camera dollies" is each frame's cells against the CPU at that frame's camera.
- **"Per frame"** for the castle is each run's p95 over 300 frames (technical design: p95 over at least 300 frames); "the
  showpiece's render scale while moving" is internal scale 0.5; "a still scene" is the product fixture with nothing
  moving, read as #421 reads `live`; "the product fixture" is this suite's own (12 parts, each its own material),
  since none is in the checkout; "add under 1 ms" is the median with the three lobes less the median without, in one
  process. "Compared with the merge base" is the perf lane's, as #1015's and #1017's suites read it.

Not tested, because no criterion asks: lobe textures, `KHR_materials_variants`, sheen and translucency colors from the
base color, `anisotropy.rotation` other than 0, exports listing wrap, retroreflection and flakes, the flake lobe's
widening where a cell is under a pixel, rays (#174) and finals (#178).
