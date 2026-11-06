# Blind redraft of #428's AC1 test

Written by a fresh run of the acceptance-test job (technical design: Dogfooding, "Tests written first, by a job that
never sees the code"), for one criterion of issue #428, from the issue, the design and the base commit `1d3ae632`
("Merge pull request #1310 …") only. No implementation, later commit, branch, PR or other `tests/acceptance/428/`
suite was opened; none existed at the base. The folder stands alone: it imports nothing outside itself but node
built-ins and vitest. Lean, as #422's and #423's suites: one file, one test per clause of the criterion, no planted
programs (the criterion names none).

## The criterion

AC1 `#428.df10ac08` (the first 8 hex digits of SHA-256 of the text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped; recomputed here and equal):

> The Khronos samples SheenChair, AnisotropyStrengthTest and DiffuseTransmissionTest, fetched by hash on first use and
> never committed, import with their sheen, anisotropy and diffuse transmission and render within 1% of a CPU
> reference of the same lobes on the same machine; in AnisotropyStrengthTest the roughness 1 column equals its
> strength 0 sphere within 1 code value, while at roughness 0.2 and strength 1 the highlight is at least 3 times longer
> along the tangent than across it; a sphere with wrap 0.5 goes dark 120° from its light, within 1°, where wrap 0 goes
> dark at 90°; and the white-furnace fixture with each lobe at full strength stays at or under 1 at every roughness
> and angle

## What was read

- Issue #428 (scope, nine criteria, proof line); #422 and #423 for vocabulary only.
- The oracle page. `gh api repos/DeepBuildAI/deepbuild/...` answered 404 from this machine (no access), so the page
  was read from the local copy of the oracle tests (`deepbuild-oracle-tests-4bfb6fe.zip`, extracted into a scratch
  folder outside the repo, treated as data): `oracle-tests/issues/428.md` and `cases/428.json`. For criterion 1 it
  names the three Khronos models at glTF-Sample-Assets `edc7c9e67c`, "run on our code"; AnisotropyStrengthTest's
  README "states that anisotropy must have no effect at roughness 1"; "the 1% CPU-reference match, the wrap angle and
  the per-lobe furnace are ours". The three models' folders in the copy (READMEs, `metadata.json` licences, glTF
  JSON) were read as data to learn their layout; the bytes the suite uses are fetched from upstream by hash, and the
  three pinned SHA-256s were checked against upstream from this machine. No code was ported; nothing is GPL.
- `AGENTS.md` (Proof); `docs/technical-design.md` (Dogfooding); `docs/canvas-primitives.md`: Material (every field and
  sentence: `sheen`, `anisotropy`, `translucency {kind: thin | wrap, amount, color, wrap}`, "each a feature … off
  until its weight, strength or amount leaves 0", "Sheen … lowers the base lobes by what it reflects, so the sum never
  reflects more than it receives", "Anisotropy stretches the specular lobe along the part's tangent, turned by
  rotation", "wrap lets diffuse light reach past the shadow line by `wrap`", "They map to KHR_materials_sheen,
  KHR_materials_anisotropy and KHR_materials_diffuse_transmission", the compensation "× (1 + F0 × (1 ÷ E − 1)) on
  direct light, with E the table's directional albedo", "anisotropy takes its tangent from the asset's tangents or
  builds it per pixel from uv0's derivatives"); Material: texture maps (the import maps sheen, anisotropy and diffuse
  transmission to their fields; "a lobe's own … texture" is listed in `dropped`); Asset: meshes (`dropped`,
  `extension_required`); Builder: uv (`uv0: sphere`); Camera `camera@1`; Look `look@1`.
- At the base, for conventions and surfaces: `crates/deep-gpu-layer` (`main.rs`'s `run` and `--planted`;
  `view3d.rs`'s call fields: `assets`, `licenses`, `imports`, `targets`; `textures.rs`'s `imports` report),
  `crates/deep-canvas-scene3d` (`gltf.rs`: the import reads only `KHR_materials_emissive_strength` and
  `KHR_materials_unlit`, lists every other material extension in `dropped`, keeps TANGENT; `scene.rs`: a whole scene
  picks `<item>#<node name or index>`, one node picks `<item>`; `uv.rs`: the sphere projection's u runs round +Y;
  `builders.rs`: `ball@1`), `crates/deep-scene3d-render/src/scene3d.wgsl` (the roughness floor 0.045 and the
  footprint floor on α²), and the suites `tests/acceptance/422` (the white furnace, the sphere fixture, the BRDF and
  its compensation, the 1.01 rule), `423` and `423/redraft` (fetch by hash, never committed, the import report, the
  orthographic view, one-node items).

## What the base does, which this test doesn't credit

The base imports the three samples' scenes, but lists `KHR_materials_sheen`, `KHR_materials_anisotropy` and
`KHR_materials_diffuse_transmission` in `dropped` and has no `sheen`, `anisotropy` or `translucency` field, so every
test here fails on it for the reason its clause names (test 1 on the import, the others on their pixels). This was
read from the code, not run: off macOS nothing draws.

## Run them

They build `deep-gpu` with cargo (on macOS only), so they run alone; `scripts/lanes.mjs` needs
`'tests/acceptance/428/'` in its `alone` list, the adopter's edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/428/redraft-ac1 --no-file-parallelism
node_modules/.bin/tsc -p tests/acceptance/428/redraft-ac1/tsconfig.json
```

Every test draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:` before it
builds or fetches anything, never passes. Tests 1–5 need the network once, to fetch the samples into the ignored
`target/acceptance/428/khronos/<sha256>`; without the network and without the cache they fail with `BLOCKED:`. A run
with `--root` leaves Vitest's cache in `tests/acceptance/428/redraft-ac1/node_modules/.vite`; delete it.

## Clauses to tests

All in `ac1.test.ts`; each name starts with `AC1 #428.df10ac08`.

| Test | Clause | What it asserts |
|---|---|---|
| (1) | fetched by hash, never committed, import with their sheen, anisotropy and diffuse transmission | Each GLB fetched by hash (The samples), absent from HEAD and the index by git blob ID, drawn as one scene item with `imports: true`, answered (not refused, so DiffuseTransmissionTest's required `KHR_lights_punctual` and `KHR_materials_unlit` don't refuse it). For every material that uses one of the three extensions: `base_color`, `metallic`, `roughness` are the file's (glTF defaults 1, 1, 1); sheen `weight × color` is `sheenColorFactor` and `roughness` is `sheenRoughnessFactor` (default 0); anisotropy `strength` is `anisotropyStrength` and `rotation` is `anisotropyRotation` in degrees; translucency is `kind: thin` with `amount` = `diffuseTransmissionFactor` and `color` = `diffuseTransmissionColorFactor` (default white, not the base color); `dropped` names none of the three extensions and lists each texture inside them (`…/diffuseTransmissionTexture`, `…/diffuseTransmissionColorTexture`). A field left out reads as the design's default. |
| (2) | SheenChair renders within 1% of a CPU reference | Its two velvets (materials 0 and 4), each as the import made it with its texture maps taken out, on #422's sphere fixture under one sun; every judged pixel within 1% per channel of the CPU reference of glTF's BRDF plus the sheen layer. |
| (3) | AnisotropyStrengthTest renders within 1% | Each of its 49 spheres, the file's own triangles, normals and tangents, drawn whole-scene and framed alone orthographically, under one sun; every judged pixel within 1% per channel of the CPU reference of the anisotropic lobe. |
| (4) | DiffuseTransmissionTest renders within 1% | Its ten factor-only planes ("Factor 0.0" … "ColorFactor 1.0"), each as a one-node item at its place in the file, lit from straight behind and then from the front 30° off the axis; every pixel 2 px inside each plane within 1% per channel of the CPU reference (or within 1% of 5% of the view's peak where the reference is darker). |
| (5) | the roughness 1 column equals its strength 0 sphere within 1 code value | The whole grid orthographically at 80 px/m (sphere centres a whole 80 px apart), final target, tone map none: every pixel 2 px inside the strength 0 sphere's disc equals, in each channel within 1 code, the pixel at the same offset in each of the column's other six spheres, which the ID target must show there. |
| (6) | at roughness 0.2 and strength 1 the highlight is ≥ 3 times longer along the tangent | A white metal ball, roughness 0.2, anisotropy strength 1, uv0 by the sphere projection, the sun behind the camera: through the highlight's mirror point (the ball centre), the half-maximum length along the row (the tangent's direction there) is at least 3 times that along the column, and the latter is at least 2 px. |
| (7) | wrap 0.5 dark at 120° within 1°, wrap 0 at 90° | A white matte ball (specular_level 0) with `translucency {kind: wrap, amount: 1, wrap}`, the sun along −X, seen from +Z: along the two rows through the centre, walking from the lit limb, the first pixel under 1e-5 of the row's peak; the edge, halfway between it and the last lit pixel, is acos(x ÷ R) from the light: 120° ± 1° for wrap 0.5, 90° ± 1° for wrap 0. |
| (8) | the white furnace with each lobe at full strength stays at or under 1 | #422's furnace (radiance 1 everywhere, no light), #422's sphere fixture: sheen (weight 1, white, on white dielectric), anisotropy (strength 1, on white metal), thin translucency (amount 1, white) and wrap translucency (amount 1, wrap 1), each at roughness 0, 0.25, 0.5, 0.75 and 1 (sheen's own roughness the same): the background reads 1 within 1%, the ball covers at least 20,000 px, and no ball pixel reads above 1.01 in any channel. |

## Assumed surfaces

The base's own calls (`deep-gpu run`, `view3d` with `assets`, `licenses`, `imports`, `targets`; #423's whole-scene and
one-node `mesh.asset@1`; #422's furnace sky) stand. This test adds only what the design names:

1. **`material@1`'s `sheen: {weight, color, roughness}`, `anisotropy: {strength, rotation}`, `translucency: {kind,
   amount, color, wrap}`**, as Material lists them; `color` an `[r, g, b]` linear array or `base`.
2. **The import writes them** on the `params` of each `imports[].materials[]` entry (#423's report), for every
   material that uses `KHR_materials_sheen`, `KHR_materials_anisotropy` or `KHR_materials_diffuse_transmission`, with
   the effective sheen color `weight × color` equal to `sheenColorFactor` (any split of the two).
3. **The probe admits DiffuseTransmissionTest**, which requires `KHR_lights_punctual` and `KHR_materials_unlit`
   (Asset: meshes refuses a required extension the probe can't read; the criterion needs this file imported). Its
   directional light is never judged: the render tests place its planes as one-node items, so no light of the file
   is in their scenes.
4. **`ball@1`'s `uv0: sphere`** gives a tangent along u, round the vertical axis (Builder: uv; the base's `uv.rs`),
   which anisotropy reads (Material: "builds it per pixel from uv0's derivatives").

## The fixtures

- **The samples**, pinned to KhronosGroup/glTF-Sample-Assets `edc7c9e67c639d230715049ee31f9a96a6babbbe` (the
  oracle's pin), the GLB of each; licences from each `metadata.json`. **The suite fetches them, not the product**, as
  #423's does: from `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/<commit>/<path>` on first use,
  checked by SHA-256 and size, kept in `target/acceptance/428/khronos/<sha256>`, checked absent from HEAD and the index,
  handed to the product by hash (`assets`, `licenses`).

  | File (under `Models/`) | Bytes | SHA-256 | Licence |
  |---|---|---|---|
  | `SheenChair/glTF-Binary/SheenChair.glb` | 4,125,648 | `f0af2a2b102d28d540236306ae19f8fb36842df76bd38cf76f063f9bd2853399` | CC0-1.0 |
  | `AnisotropyStrengthTest/glTF-Binary/AnisotropyStrengthTest.glb` | 94,444 | `306321ff8214727b145188ceb56d96d2882b393d0b596fa089fd20b07e959834` | CC0-1.0 |
  | `DiffuseTransmissionTest/glTF-Binary/DiffuseTransmissionTest.glb` | 238,336 | `cac9152a1215177c479f33cc0f5d1b64f92010311d2316dc42dde87fa505e282` | CC-BY-4.0 |

- **Every scene** is generated in the test file: #421's plain look (physical basis, tone map none, exposure scale 1,
  no bloom, no deband); #422's black sky (no ambient, no environment) under one sun with `shadow: false`, or #422's
  white furnace with no light; #422's sphere fixture (ball radius 1, 256 segments, seen from 6 m, fov 30°, 320 px);
  an orthographic ball (2.4 m across 512 px, 213 px to its radius); per AnisotropyStrengthTest sphere an orthographic
  view 0.9 m across 384 px centred on it (171 px to its radius); DiffuseTransmissionTest's planes orthographically,
  6.4 m across 640 × 256 px (100 px/m). Suns: AnisotropyStrengthTest toward (−0.433, 0.5, 0.75), 1 lx; SheenChair's
  velvets toward (0.814, 0.342, 0.470), 2 lx; the planes 3 lx along +Z (from behind) and toward (0.5, 0, 0.866).
  Nothing is written to the repo.

## The measure: which pixels are judged, and why

- **Values** are read from the linear f32 target (before exposure, so a pixel is radiance per lux of the sun), "code
  values" from the final 8-bit target, and which part a pixel shows from the object-ID target. Every judged pixel is
  **2 px inside** its part (every pixel of the 5 × 5 square about it shows the same pick), so no silhouette pixel,
  half one part and half another, is judged.
- **The CPU reference is taken at each pixel's own centre.** On #422's ball it is the analytic sphere hit by the
  pixel's pinhole ray (as #422's suite holds the base). On AnisotropyStrengthTest it is the sample's own triangles,
  cast orthographically from +Z: the nearest triangle under the pixel centre, its vertex normals and TANGENTs
  interpolated by the centre's barycentric weights and normalized (the tangent made orthogonal to the normal), as a
  rasterizer interpolates them under an orthographic view. On the planes the file's own normal.
- **"Within 1%"** is per channel: |frame − reference| ≤ 1% of the reference, judged in each channel where the
  reference is at least 5% of that channel's peak over the part (the 1% rule and its 5% floor are #422's), and every
  judged pixel must pass. On the planes, where one view holds bright and black planes, a channel darker than 5% of
  the view's peak must be within 1% of that 5% instead.
- **Left out, with the reason:**
  - *Grazing pixels of the sheen balls* (n·v < 0.3): there the Charlie visibility of KHR_materials_sheen's fit exceeds
    1 and reference implementations clamp it, so the published text doesn't fix one value.
  - *Pixels whose footprint in slope space reaches a quarter of α_b²* on AnisotropyStrengthTest (dn, the squared
    change of the reference normal to the next pixel right plus the next one down, over roughness⁴ ÷ 4): there the
    renderer's documented specular antialiasing (the lobe "never narrower than the pixel's footprint in slope space",
    #421/#422) may widen the lobe, which no published lobe does. This leaves out every pixel of the roughness 0
    column (α = 0: a mirror's delta, or a line, that no pixel grid point-samples) and, at roughness 1/6, some pixels
    toward the limb. Every sphere of roughness 1/6 or more must keep at least 150 judged pixels (the fewest found on
    the CPU reference was 227, the isotropic roughness 1/6 sphere's small highlight; most keep thousands).
  - *SheenChair's texture maps.* Its fabrics tile a base color map 7 times and a normal map twice, with mips; no CPU
    reference reproduces a GPU's filtered fetch of them to 1%, and the lobe is what the criterion holds. So each velvet
    is drawn on the sphere fixture as the import made it (its sheen, base color factor, metallic and roughness) with
    `maps`, `normal_map`, `normal_scale` and `occlusion_strength` taken out; the reference reads the file's own factors.
  - *DiffuseTransmissionTest's ten textured planes* ("Texture …", "ColorTexture …"): the design holds no field for a
    diffuse transmission texture, so the import lists them in `dropped` (test 1) and draws their factors; the ten
    factor planes are judged.
- **"Equals within 1 code value"** (test 5): every channel, every pixel 2 px inside the strength 0 sphere's disc,
  against the pixel at the same offset in each other roughness 1 sphere; the spheres sit an exact 80 px apart and the
  view is orthographic under a directional sun with no shadows, so a correct renderer draws the same pixels. The
  strength 0 sphere must reach code 25 somewhere, so a black frame can't pass.
- **"Longer along the tangent than across it"** (test 6): half-maximum lengths through the highlight's mirror point,
  where n = h (the ball centre, with the sun behind the camera), along the row (the tangent there, uv0's u, runs
  horizontally) and the column, each crossing interpolated between pixel centres or ended 2 px inside the edge. Not
  from the brightest pixel: at strength 1, α_t = 1, so along the tangent the lobe is flat and brightens toward the
  limb. On the CPU reference: 423 px along, 11.1 px across (ratio 38); at strength 0, 11.1 and 11.1 (ratio 1).
- **"Goes dark … from its light"** (test 7): the first pixel, walking from the lit limb away from the light along the
  two rows through the centre, that reads under 1e-5 of the row's peak; the shadow line lies halfway between it and
  the last lit pixel (±0.5 px, ±0.16° at 120°), at acos(x ÷ R) from the light since the sun is along −X and the view
  orthographic. On CPU stand-ins: wrap 0.5 as (n·l + w) ÷ (1 + w)² and as (n·l + w) ÷ (1 + w) read 120.10°, as its
  square 119.79°, a Lambert lobe 90.00°.
- **"At or under 1"** (test 8): every channel of every ball pixel at most 1.01, pbrt-v4's threshold and #422's reading
  of "never above 1"; only on a furnace whose background reads 1 within 1%. "Every angle" is every pixel of the ball
  (every n·v); "every roughness" is 0, 0.25, 0.5, 0.75 and 1.

## The CPU reference (`lobes.ts`)

In f64, from the published texts, tables by quadrature:

- **Base:** glTF 2.0 Appendix B (GGX D, height-correlated Smith V, α = roughness², Schlick at v·h, the dielectric's
  fresnel_mix of Lambert under a specular lobe at F0 0.04 weighted by specular strength, the metal's F0 = base color),
  with the design's compensation × (1 + F0 × (1 ÷ E − 1)), E(n·v) the isotropic lobe's directional albedo at the
  material's roughness (#422's quadrature).
- **Sheen** (KHR_materials_sheen): f = sheenColor × D × V with the Charlie D, (2 + 1/α)·sin^(1/α)θ_h ÷ 2π, α =
  sheenRoughness², and V = 1 ÷ ((1 + Λ(n·v) + Λ(n·l)) · 4 n·v n·l) with the extension's fitted Λ (coefficients
  interpolated by (1 − α)²); the layers below scaled by min(1 − max(sheenColor)·E_s(n·v), 1 − max(sheenColor)·E_s(n·l)),
  E_s the sheen lobe's directional albedo by a 256 × 128 rule. sheenColor is the design's `weight × color`.
- **Anisotropy** (KHR_materials_anisotropy): α_t = mix(α, 1, strength²), α_b = α; D = 1 ÷ (π α_t α_b ((t·h ÷ α_t)² +
  (b·h ÷ α_b)² + (n·h)²)²); V = 0.5 ÷ (n·l·|(α_t t·v, α_b b·v, n·v)| + n·v·|(α_t t·l, α_b b·l, n·l)|); the direction is
  the tangent turned by `rotation` toward b = n × t. **Reading:** the compensation keeps E at the material's own
  roughness, the one DFG table the design says it reads ("from the DFG table it already reads … no fetch"); the
  design names no anisotropic table.
- **Diffuse transmission** (KHR_materials_diffuse_transmission): the diffuse base is mix(Lambert(base color),
  Lambert transmission(diffuseTransmissionColor), diffuseTransmissionFactor): light from the front reflects (1 −
  factor) of the Lambert lobe, light from the back comes through as factor × color ÷ π × |n·l|, weighted by 1 − F at the
  half vector of the light mirrored to the front (0.04 at the planes' head-on, straight-behind light).
- Wrap has no published text to hold a 1% match to and the criterion asks none: test 7 holds only where it goes
  dark, acos(−wrap), which the criterion states.

## Readings where the issue and design leave a choice

- **"Fetched by hash on first use and never committed"** is how the samples reach the run, as #423's suite reads it.
- **"Render within 1% of a CPU reference of the same lobes"** is per pixel, under one known sun, for the parts of each
  sample whose look is its lobes and factors (above); SheenChair's lobes are drawn as imported, without their maps,
  on the sphere fixture. This narrows "the sample renders" to its lobes; a reviewer may read it wider.
- **"On the same machine"** is the reference computed by this test, in the run, on the machine that drew the frame.
- **"The roughness 1 column"** is the file's seven spheres at roughness 1 (x = 3 m, glTF's default roughness), the
  README's "anisotropy should not offer any effect when material roughness is 1.0".
- **"At roughness 0.2 and strength 1"** is a ball of this test's own, since the sample has no roughness 0.2.
- **"Each lobe at full strength"** is sheen weight 1, anisotropy strength 1, translucency amount 1 (thin, and wrap at
  wrap 1), all white.
- Not tested, because this criterion doesn't ask: anisotropy's negative strength, a rotation other than 0, export to
  glTF, the feature compile and its cost, wrap's listing on export.

## Wrong programs it catches

- The base: the three extensions in `dropped`, no fields (test 1); no lobe drawn, so the velvets miss their sheen,
  AnisotropyStrengthTest's spheres are isotropic, the planes show no transmission (tests 2–4); no stretch (test 6,
  ratio 1); no wrap, dark at 90° (test 7).
- An import that drops or misreads a lobe: sheen weight × color or roughness off, strength or rotation off, diffuse
  transmission color left at the base color (cyan instead of white or red), the lobe's own textures lost silently or
  the whole extension listed (test 1, and the pixels of tests 2–4).
- A sheen without the albedo scaling (the base not lowered, so the velvets read high where the sheen reflects, and
  the furnace reads above 1), a Lambert or Ashikhmin sheen in place of the published lobe, a sheen not tinted (tests 2, 8).
- Anisotropy that ignores strength, stretches across instead of along the tangent, reads α_t and α_b swapped, or
  still acts at roughness 1 (tests 3, 5, 6).
- A thin translucency that adds the back light without taking it from the front's reflection (over 1 in the furnace,
  test 8; the front-lit planes too bright, test 4), or that tints by the base color.
- A wrap that ignores `wrap` (90°), or that isn't normalized ((n·l + w) ÷ (1 + w): 1.5 to 2 in the furnace, test 8).
- Any lobe that reflects more than it receives at some roughness or angle (test 8).

## Proof here

Run on this Linux machine at `1d3ae632` with the folder added (no GPU: every test INCONCLUSIVE before it builds or
fetches, as required):

```text
$ node_modules/.bin/tsc -p tests/acceptance/428/redraft-ac1/tsconfig.json
(no output; exit 0)

$ node node_modules/vitest/vitest.mjs run --root tests/acceptance/428/redraft-ac1 --no-file-parallelism
 RUN  v5.0.5 <worktree>/tests/acceptance/428/redraft-ac1

 ❯ ac1.test.ts (8 tests | 8 failed) 134ms
   ❯ AC1 #428.df10ac08: Khronos lobe samples, their CPU reference, the anisotropic highlight, wrap and the furnace (8)
     × AC1 #428.df10ac08 (1): SheenChair, AnisotropyStrengthTest and DiffuseTransmissionTest, fetched by hash and never committed, import with their sheen, anisotropy and diffuse transmission 58ms
     × AC1 #428.df10ac08 (2): SheenChair's two velvets, as imported, render within 1% of a CPU reference of their base and sheen lobes 23ms
     × AC1 #428.df10ac08 (3): AnisotropyStrengthTest's 49 spheres render within 1% of a CPU reference of the anisotropic lobe 8ms
     × AC1 #428.df10ac08 (4): DiffuseTransmissionTest's factor planes, lit from behind and from the front, render within 1% of a CPU reference of diffuse transmission 2ms
     × AC1 #428.df10ac08 (5): in AnisotropyStrengthTest the roughness 1 column equals its strength 0 sphere within 1 code value 4ms
     × AC1 #428.df10ac08 (6): at roughness 0.2 and strength 1 the highlight is at least 3 times longer along the tangent than across it 7ms
     × AC1 #428.df10ac08 (7): a sphere with wrap 0.5 goes dark 120° from its light within 1°, where wrap 0 goes dark at 90° 6ms
     × AC1 #428.df10ac08 (8): the white-furnace fixture with each lobe at full strength stays at or under 1 at every roughness and angle 6ms

 FAIL  ac1.test.ts > … > AC1 #428.df10ac08 (1): …   (and the same for (2)–(8))
AssertionError: INCONCLUSIVE: the GPU layer draws these pixels on macOS's Metal device; this is linux; this is not a pass

 Test Files  1 failed (1)
      Tests  8 failed (8)
```

Also run here, in scratch files outside the repo (not committed): `khronos()` fetched all three samples from
upstream into the ignored cache and checked their hashes and "never committed"; the CPU reference on the samples'
own geometry (AnisotropyStrengthTest: judged pixels per sphere 0 at roughness 0, 227 to 78,956 at roughness 1/6 to 1,
about 5 s for nine spheres; SheenChair's velvets: the sheen raises the red velvet's green channel from 0.031 to 0.079
at the lit grazing edge; the planes: 0.917 for "Factor 1.0" from behind, 0 for "Factor 0.0", and 0.038, the
specular alone, for "Factor 1.0" from the front); and the measures of tests 6 and 7 on CPU stand-ins of right and
wrong programs (the numbers above). **Not run:** anything on macOS's Metal device, so no test has met a renderer, and
no wrong program has been run through the product; the base's failures above are read from its code.
