# Acceptance tests for #423: 3D materials — texture maps, UV transforms, anisotropic filtering, KTX2 and licensed glTF assets

Written first, from issue #423 (its scope, its seven acceptance criteria and its proof line), the design sections it
links and those they lean on, its oracle page, and the base commit `5f63620c` ("Merge pull request #1221 …", which
holds #421's renderer), by a job that never saw an implementation; none existed. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean, as #421's:
one file per criterion, at most two tests each, plus the planted twins the criteria name.

## What was read

- Issue #423 and its dependency #421 (its Material and Light fields, for vocabulary). The oracle page
  (`doneright/oracles/issues/423.md` and `cases/423.json` in `DeepBuildAI/deepbuild`, branch `doneright`): upstream
  tests for criteria 2 (the five Khronos models the criterion names; glTF Asset Generator's `Node_NegativeScale`,
  `Texture_Sampler`, `Material_AlphaBlend`, `Material_AlphaMask`), 3 (Khronos `TextureTransformMultiTest`) and 4
  (Khronos `TextureEncodingTest`); none for 1, 5, 6 and 7. Ported, each run against our output: the Khronos models
  for 2, 3 and 4, at the oracle's pin `edc7c9e67c`, held to what each file's own JSON declares (helpers:
  `importProblems`) and, for NegativeScaleTest and TextureEncodingTest, to what their READMEs say a correct render
  shows. Not ported: the Asset Generator models, whose checks are sample images to compare by eye, which the
  criterion's own five models already cover (sampler wraps, alpha modes, negative scale).
- `docs/canvas-primitives.md`: Builders, recipes, looks and cameras; Object; Builder (`mesh.asset {sha256 (glTF),
  node}`), Builder `ball`: tessellation, Builder: uv (`uv0: planar {axis}`, `uv_scale`); Material ("Defaults differ
  from glTF's, and a glTF import maps glTF's metallic 1 and roughness 1"; `normal_map: sha256`); Material: texture
  maps (every field and sentence: `maps`, `uv`, `transform`, `wrap`, `filter_taps`, `alpha_cutoff`; "Base color and
  emission decode from sRGB and every other map as stored, whatever gamma or ICC profile its image file carries";
  "listed per material in the probe's `dropped` … never dropped silently"; the KTX2 transcode by role, "kept by hash
  of the source, the format and the transcoder's version"; "The receipt names each map's format"; the cost line's
  "64 MB decoded-image cap, which counts the bytes the device holds"); Look `look@1`: samples; Camera `camera@1`
  (`view_width`, orthographic); Units and axes; The cost model; Pack: assets fetched on first use; Asset; Asset:
  meshes (`textures`, `dropped`, `extension_required`, "probed once in the decode worker"); Asset: licences through
  jobs; Decode worker; Image `image@1` ("at most 64 MB decoded per document").
- `docs/technical-design.md`: Dogfooding; taste calls and "Shown to you" (asks of kind `taste`); the evidence store
  by hash.
- At the base: `crates/deep-gpu-layer` (`main.rs`'s calls and `--planted` table, `view3d.rs`: `assets` by sha256,
  `targets`, `picks`), `crates/deep-canvas-scene3d` (`gltf.rs`: one node's positions and normals from a GLB or a JSON
  glTF with data-URI buffers, nothing else; `uv.rs`: planar about y gives u = z, v = x, about z gives u = x, v = y;
  `builders.rs`: a slab centred across its plan, its thickness up from it; `light.rs`: `material@1`'s fields, no
  maps), `crates/deep-scene3d-render` (geometric specular antialiasing in `scene3d.wgsl`, no texture sampling),
  `crates/deep-gpu/src/seam.rs` (BC is required on the macOS tier "and the decoded-image cap counts the reference
  Mac's BC bytes"), `crates/deep-codecs` (the decode worker: a helper process, `Helper`, its `jobs`; no KTX2),
  `crates/deep-marks-render/src/macos.rs` (2D's 64 MiB decoded cap, refused `over_budget`), `crates/deep-show`
  (`media.rs`'s `workers` call; `evidence.rs`'s `<2 hex>/<62 hex>` store), and the suites `tests/acceptance/421/`
  (conventions copied), `1174/` (the taste-call record) and `498/decode/` (`BLOCKED:` for a missing input).

## What the base already does, which these tests don't credit

`view3d` draws scene3d documents into final, linear and object-ID targets and reads a `mesh.asset@1`'s GLB by sha256
from its `assets`; a `material@1` shades with #421's BRDF and geometric specular antialiasing; a sun lights a white
diffuse surface at E ÷ π; builders emit uv0 by `uv0` and `uv_scale`. There is no texture of any kind on a 3D surface:
no `maps`, no `normal_map` read, no glTF material, UV, image, sampler, transform or scene import, no KTX2, no
transcode, no receipt, no `workers` call on deep-gpu, no decoded-image count in 3D, no `samples` in the look, and
none of the planted names below.

## Run them

They build `deep-gpu` with cargo, as #421's suite does, so they run one file at a time. `scripts/lanes.mjs` needs
`'tests/acceptance/423/'` added to its `alone` list, beside `tests/acceptance/421/`; this README is the instruction,
the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/423 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/423/tsconfig.json
```

Every test draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes.
AC6 also requires a reference Mac (`Mac15,7` or `Mac15,12`), since its criterion opens "On the reference Mac". AC2,
AC3, AC4 and AC7 need the network once, to fetch the Khronos models into the cache; without it and without the cache
they fail with a message starting `BLOCKED:`. Nothing is gated on power or load. A run with `--root` may leave
Vitest's cache in `tests/acceptance/423/node_modules/.vite`; delete it.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped. Each test's name starts with `AC<n> #423.<id>`.

| ID | Criterion | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#423.1611056a` | With specular antialiasing, a glossy normal-mapped plane's mean luminance at one sample per pixel stays within 2% of a 16-sample reference on the same machine | `specular.test.ts` (1): a glossy plane (base color 0.5, roughness 0.2) with a normal map made here (256² texels, bumps 8 texels across, slopes to 0.6, 512 texels a metre, about 2.5 texels a pixel), a sun's highlight on it; in one run, linear target, the look's `samples: {live: 1}` and `{live: 16}`: over the plane's pixels 2 px in from its edge (object-ID target), the one-sample mean luminance is within 2% of the 16-sample mean; the map must change at least a tenth of those pixels by over 5% against the bare plane. Catches: the base (no normal maps); a map that sparkles at one sample (unfiltered, or without specular antialiasing); a renderer that drops the map |
| AC2 `#423.5a4d9d3b` | The Khronos sample models TextureTransformTest, TextureSettingsTest, TextureCoordinateTest, AlphaBlendModeTest and NegativeScaleTest, fetched by hash on first use and never committed, import with every texture, sampler, texCoord set, UV transform and alpha mode their files declare, and NegativeScaleTest's mirrored parts keep their front faces outward | `khronos.test.ts` (2): each model fetched by hash (README: The Khronos samples) and absent from HEAD and the index; drawn as one scene item with `imports: true`: for every material in the file, every one of glTF's five texture slots it uses is kept on its field with the image's own SHA-256, its texCoord set, its KHR_texture_transform (offset, scale, rotation in degrees), its sampler's wrap on S and T, and the material's alpha mode, cutoff and double-sidedness are the file's. NegativeScaleTest, orthographic from +Z at 80 px/m, sun along −Z: each row's mirrored sphere shows at its world place and shades as its unmirrored twin 160 px away (mean within 5%, at most a tenth of pixels off by over 10%), the diffuse row lit; NegativeScaleFront (scale −1, −1, −1, single-sided) and PositiveScaleTest each cover 90% of their triangles' projected area. Catches: the base (no scene import, no textures); a dropped map, texCoord, transform, wrap axis or alpha mode; node scale ignored, or winding not flipped, so a mirrored part draws inside out, is culled, or sits elsewhere |
| AC3 `#423.57db7d87` | A licensed glTF asset keeps its texture maps and UV transforms, each texture stored by hash with its license | `licensed.test.ts` (1): Khronos TextureTransformMultiTest (CC BY 4.0: 29 materials, transforms on every core slot, on TEXCOORD_0 and TEXCOORD_1, clearcoat textures), its license given beside its hash, with an evidence store: the same import check as AC2's (the clearcoat textures listed in `dropped`), and every texture a kept map names is in the store at `<2 hex>/<62 hex>`, hashing to its name, and in the import's `textures` with the asset's license, field for field. Catches: a dropped map, TEXCOORD_1 or transform; textures stored without the license, under another hash, or not at all |
| AC4 `#423.4c6dcf97` | In the Khronos sample TextureEncodingTest, fetched by hash on first use and never committed, the four models of each row (factors only, a 1 × 1 texture, the same texture with a gamma value, and with an ICC profile) render within one 8-bit code value of each other with tone map none; a planted importer that decodes the metallic-roughness map from sRGB, or one that applies the image's gamma, fails, naming the row and the column | `encoding.test.ts` (1): the GLB orthographic at 80 px/m, so its spheres sit 240 px apart exactly, tone map none, sun at an angle; final target: for each row and each pair of its columns, every pixel of a disc 8 px inside one sphere equals the pixel at the same place on the other within one code on every channel, and each disc shows its own sphere in the ID target. `--planted mr_from_srgb` fails naming the `metallic-roughness row` and the `1 × 1 texture column`; `--planted applies_image_gamma` fails naming the `metallic-roughness row`, the `base color row` and the `gamma column`. Catches: either planted importer; ICC profiles read; base color or emission decoded as linear |
| AC5 `#423.4457ae69` | A floor viewed 80° from its normal carries stripes 2 texels wide that run toward the horizon. On the row where one pixel spans one texel across them, its footprint is 1 ÷ cos 80° ≈ 5.76 texels long, and a CPU reference that filters that footprint along its long axis keeps their Michelson contrast at 1. With the default `filter_taps` the frame keeps at least 0.8 of it at 32 sampled pixels on that row, while a planted map sampled at anisotropy 1 takes mip log2 5.76 ≈ 2.5, where the 4-texel period averages to grey, reads under 0.1 and fails, naming the map | `anisotropic.test.ts` (1): a slab floor (uv0 planar about y), unlit, its base color map made here (64² texels, rows white and black every 2 texels, so the stripes run along z); the camera 1 m up, pitched 10° down, fov 40° on 512²; one texel is one pixel's width where the centre ray meets the floor. The row nearest one texel across at the centre column, its 32 centre pixels: footprints unprojected onto the floor (about 1 × 5.76 texels, checked within 0.1); the CPU reference averages the base level along each long axis, contrast 1 within 0.01; the frame's linear target keeps at least 0.8 of it with the default `filter_taps`. `--planted anisotropy_one` reads under 0.1 and fails naming `items/stripes/params/maps/base_color`. Catches: the base (no maps); a sampler without anisotropy or with too few taps; a mip picked by the long axis |
| AC6 `#423.0f7c0f26` | On the reference Mac, a fixture asset's four 2,048 px KTX2 maps in UASTC (base color, normal, ORM and emission) transcode once in the decode worker to BC7 in sRGB, BC5, linear BC7 and BC7 in sRGB, as the receipt names them, and the decoded-image cap counts them at about 22.4 MB (2,048² × 1 B × 1.33 each), where the same maps as PNG count about 89.5 MB and are over the cap; a second load of the same hashes transcodes nothing. A flat KTX2 normal map (every texel 128, 128, 255) on a plane whose tangent runs along +x, lit by a sun 45° from its normal toward +x, shades as the plane does with no normal map within 1%, while a planted twin transcoded as sRGB color reads x and y as −0.57, drops n·l from 0.71 to under 0.25 and fails, naming the map | `ktx2.test.ts` (2): the four maps written here (README: Fixtures) on a `material@1` (the ORM map as both `metallic_roughness` and `occlusion`); one run: the receipt names each map's source `ktx2` and format `bc7-rgba-unorm-srgb`, `bc5-rg-unorm`, `bc7-rgba-unorm`, `bc7-rgba-unorm-srgb`, `decoded_bytes` within 1% of 22,369,621 and under 64 MiB, every map `transcoded: true`; a second document naming the same hashes: every map `transcoded: false`; `workers` lists one decode worker, not deep-gpu's own process, with exactly one `transcode` job per map hash; the same maps as 2,048 px PNGs are refused `over_budget`, counting within 1% of 89,478,485 B, over 64 MiB. Normal map: a white diffuse wall facing +z (uv0 planar about z: tangent +x), 100 lx sun 45° toward +x, n·l = π × (lit − unlit) ÷ 100 on a 5 × 5 patch: 0.707 within 1% bare, the flat KTX2 map within 1% of bare; `--planted normal_map_as_srgb` reads under 0.25 and fails naming `items/bumped/params/normal_map`. Catches: the base; a format by the file's tag, or RGBA8 (counted at 4 B); a transcode per load or outside the worker; a normal map decoded as color |
| AC7 `#423.35374578` | Shown to you: screenshots of the Khronos texture samples, the anisotropic stripes floor and the KTX2 asset, taken by the check run from the renderer's own output, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it | `taste.test.ts` (1): one run draws the six Khronos samples, AC5's floor and AC6's KTX2 asset, and copies each frame's final target (the renderer's own PNG, named by its SHA-256) to `target/acceptance/423/` (README: The taste call); then reads `TASTE.json`: absent, or recorded on other SHA-256s, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

## Assumed surfaces

The issue and design name the behaviors but not these calls and fields; each is this job's choice, the most natural
one beside the base's own calls (`view3d`, its `assets`, deep-show's `workers` and evidence store). The implementer
provides exactly these.

1. **`view3d`'s `assets: {sha256 → path}`** also holds the image files (PNG, JPEG, KTX2) a material's maps or a glTF
   name, read by hash like the base's GLBs.
2. **`view3d`'s `uris: {<glTF sha256> → {<relative URI as the file writes it> → sha256}}`**: a JSON glTF's external
   buffers and images resolved by hash (as a pack's `assets` paths would), never by path. TextureTransformTest has no
   GLB, so the import needs it.
3. **`mesh.asset@1`'s `node: {"scene": 0}`**: the file's scene 0, every node at its world transform in the file
   (parent × T·R·S, or its `matrix`) under the item's `at`, each mesh drawn with the materials the file declares
   (imported, as Material: texture maps says); each node drawn is picked as `<item>#<node name>`, or
   `<item>#<node index>` for a node with no name, in the frame's `picks` (as Asset: meshes addresses instances
   `<item>#<node>.<row>`).
4. **`view3d`'s `imports: true`** answers `imports: [{item, sha256, materials: [{index, name, params}], textures:
   [{sha256, license}], dropped: [{material, input}]}]`, one entry per `mesh.asset@1` item: `index` is the glTF
   material's, `params` the `material@1` fields the import made (`alpha_mode`, `alpha_cutoff`, `double_sided`,
   `maps.{base_color, metallic_roughness, emission, occlusion}`, `normal_map`, beside the numbers), `dropped` names the
   material (index or name) and an `input` that contains the glTF property's name (e.g.
   `KHR_materials_clearcoat/clearcoatTexture`). A map is a SHA-256, or `{sha256, uv: "uv0" | "uv1", transform:
   {offset, scale, rotation: deg}, wrap}`, each field defaulting as the design does (uv0, identity, repeat).
   **`wrap`** is one mode, or `[s, t]` where they differ: TextureSettingsTest's samplers wrap S and T differently, and
   the design's single `wrap` can't hold that (README: Readings).
5. **`view3d`'s `licenses: {sha256 → {id, terms, shareable, credit}}`** gives an asset's license (Asset: `license`),
   and **`store: dir`** is the evidence store the import keeps each texture in by its own hash, at
   `<dir>/<first 2 hex>/<other 62 hex>` (deep-show's `evidence::put` layout); each texture's record in `imports[].textures`
   carries the license of the asset it came from.
6. **Look `samples: {live: n}`** (Look `look@1`: samples): `view3d` draws each frame as the mean, in linear light, of
   `n` sub-samples whose offsets come from the sample index alone.
7. **`material@1`'s `maps`** (Material: texture maps), its `unlit`, and the look's default `filter_taps` of 8, as
   designed; maps given by SHA-256.
8. **`view3d`'s `receipt: true`** answers `receipt: {decoded_bytes, maps: [{sha256, source: "png" | "jpeg" |
   "ktx2", format, roles, transcoded: bool}]}`: one entry per distinct map hash; `format` in WebGPU's texture format
   names (`bc7-rgba-unorm-srgb`, `bc5-rg-unorm`, `bc7-rgba-unorm`, `bc4-r-unorm`, `rgba8unorm-srgb`, …);
   `transcoded` whether this load ran a transcode for it; `decoded_bytes` what the decoded-image cap counts for the
   document, in the reference Mac's formats. A document over the 64 MiB cap is refused `{code: "over_budget",
   decoded_bytes, …}` (2D's refusal code for its decoded cap).
9. **`deep-gpu run`'s `workers` call**, as deep-show's: `{"call": "workers"}` answers `{workers: [{pid, role:
   "decode_worker", jobs: [{op, file}]}]}`, every job each helper process ran in this run; a transcode is `op:
   "transcode"` with `file` the KTX2 source's SHA-256.
10. **`tests/acceptance/423/TASTE.json`** records the taste call (README: The taste call); the base names no file
    for it, so this suite names one, as #1174's does.
11. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
    `crates/deep-gpu-layer/src/main.rs` beside #421's:

| Name | The wrong program | Criterion |
|---|---|---|
| `mr_from_srgb` | The glTF importer decodes the metallic-roughness map from sRGB | AC4 (the criterion's twin) |
| `applies_image_gamma` | The importer applies a PNG's own gamma (`gAMA`) when it decodes a map | AC4 (the criterion's twin) |
| `anisotropy_one` | Every mipmapped map is sampled at anisotropy 1 (one tap; the mip from the footprint's long axis) | AC5 (the criterion's twin) |
| `normal_map_as_srgb` | A KTX2 normal map is transcoded as sRGB color (BC7 sRGB) instead of BC5 | AC6 (the criterion's twin) |

## Fixtures

| Fixture | What it is | Read by |
|---|---|---|
| The Khronos samples | Fetched at test time by hash (README: The Khronos samples); never in the repo | AC2, AC3, AC4, AC7 |
| `bumps.png` | 256² RGBA normal map, bumps 8 texels across, slopes to 0.6 (`specular.test.ts`) | AC1 |
| `stripes.png` | 64² RGBA, rows white and black every 2 texels (helpers: `stripesFloor`) | AC5, AC7 |
| `base`, `normal`, `orm`, `emission` `.ktx2` | Four 2,048² UASTC KTX2 files of one color each, full mip chain (12 levels), base color and emission tagged sRGB, normal and ORM linear (helpers: `assetMaps`, `ktx2Uastc`), about 5.6 MB each | AC6, AC7 |
| The same four as `.png` | 2,048² RGBA PNGs of the same colors | AC6 |
| `flat-normal.ktx2` | 64² UASTC KTX2, every texel (128, 128, 255, 255), linear | AC6 |

Every generated file is written into the test's temporary folder at test time and deleted after it; none is
committed. **The KTX2 encoder** is this suite's own (helpers: `ktx2Uastc`), since no KTX2 or Basis encoder is
available offline and the base has none: each 4 × 4 block is UASTC's solid-color mode (mode 8, its 5-bit code `0x17`,
then R, G, B and A in 8 bits each, LSB first, the ETC1 hints 0), the bit layout Basis Universal's transcoder reads
(`basisu_transcoder.cpp`, `unpack_uastc`); the container is KTX 2.0 with `vkFormat` 0, no supercompression, and a
Khronos Data Format descriptor of colour model UASTC (166), one 128-bit sample, transfer sRGB (2) or linear (1). The
criteria need only the format and count of these maps and a flat normal map, so one color per map loses nothing.

## The Khronos samples

Pinned to KhronosGroup/glTF-Sample-Assets commit `edc7c9e67c639d230715049ee31f9a96a6babbbe` (the oracle's pin).
**The suite fetches them, not the product.** On first use `helpers.ts` (`khronos`) fetches each file from
`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/<commit>/<path>`, checks its SHA-256 and size,
and keeps it in the checkout's ignored `target/acceptance/423/khronos/<sha256>`; later runs read it from there by
hash. Each file is then checked absent from HEAD's tree and the index by git blob ID ("never committed"), and handed
to the product by hash only (`assets`, `uris`, `licenses`). Why the suite fetches: the design puts a first-use fetch
in the hub behind an authority ask (Pack: assets fetched on first use), the issue's scope adds no fetch, and the
base's hub fetch is plain HTTP with no TLS; the criteria's "fetched by hash on first use and never committed" is read
as how the samples reach the run (README: Readings).

| File (under `Models/`) | Bytes | SHA-256 | License |
|---|---|---|---|
| `TextureTransformTest/glTF/TextureTransformTest.gltf` | 9,179 | `c22c8c6c96c0ea4bcbb9b47ea245a093c5ef59acc5fd425effa4c00da4cdf164` | CC0-1.0 |
| `TextureTransformTest/glTF/TextureTransformTest.bin` | 136 | `d0cdd23f2fa0996a0db99d4932fb9912a51a34e27c8bf832d072dc856ee9a7af` | CC0-1.0 |
| `TextureTransformTest/glTF/UV.png` | 12,345 | `ac37ff52fe06a4c8c35ad4e1e7e8da039dfa8afc9b629d40a44ca8b8cfe9d03d` | CC0-1.0 |
| `TextureTransformTest/glTF/Arrow.png` | 867 | `5df5b251fed0ac306cf859a30b59a4953d152483a4bed2b84e5bba1c667a1e64` | CC0-1.0 |
| `TextureTransformTest/glTF/Correct.png` | 2,457 | `3a14b12635ebbcee3ea427fbdb4d20da73e4740ec7a51683d700a2d6b4b7861a` | CC0-1.0 |
| `TextureTransformTest/glTF/NotSupported.png` | 3,291 | `1fbdeca7e5c105d677a39578e4bab82b89c8aa9f406ee681ede05635ea0f8c74` | CC0-1.0 |
| `TextureTransformTest/glTF/Error.png` | 2,273 | `8d1032ef535a5c379bf78f9f565d3180ee3fc2d1cfef6892dee6e567728b619c` | CC0-1.0 |
| `TextureSettingsTest/glTF-Binary/TextureSettingsTest.glb` | 42,840 | `44013a0602cbbdcaf703905ed47cc6b6fb49f067d7de0e1a0a568a5bbfa9d769` | CC-BY-4.0 |
| `TextureCoordinateTest/glTF-Binary/TextureCoordinateTest.glb` | 14,232 | `fe75a63a0423c9a682bf46c3045b6328ae9c55abefc9a50adf3ec1d6dc6ea3b9` | CC0-1.0 |
| `AlphaBlendModeTest/glTF-Binary/AlphaBlendModeTest.glb` | 2,978,812 | `37c3577d143071b42dd46e9d942b157837eb25c6340112171d7faecaa987b14e` | CC-BY-4.0 |
| `NegativeScaleTest/glTF-Binary/NegativeScaleTest.glb` | 62,568 | `ea8c41fd0630f03adcf7a5c06bf86d7b850fa510b6f07cc51eb1fccc205a50f2` | CC-BY-4.0 |
| `TextureEncodingTest/glTF-Binary/TextureEncodingTest.glb` | 21,612 | `c2f654bdf918e3cce93db3f8d8c1b008b90d3089e756c9b38149e9306b1338f4` | CC0-1.0 |
| `TextureTransformMultiTest/glTF-Binary/TextureTransformMultiTest.glb` | 388,264 | `569aedb53822d5721e7e06af5983348683d4b2ffb1d469338ad4f02bf6a74911` | CC-BY-4.0 |

The GLB of each model is used where the pin has one; TextureTransformTest has only its JSON form. Licenses are each
model's `LICENSE.md` at the pin; the credit lines in `helpers.ts` come from each `metadata.json`.

## The taste call

`taste.test.ts` writes these files to `target/acceptance/423/`, each a byte copy of a final target the renderer wrote
(so its SHA-256 is the renderer's own name for it), printing each SHA-256:

| File | What it shows |
|---|---|
| `khronos-texture-transform.png` | TextureTransformTest, orthographic from +Z |
| `khronos-texture-settings.png` | TextureSettingsTest |
| `khronos-texture-coordinate.png` | TextureCoordinateTest |
| `khronos-alpha-blend-mode.png` | AlphaBlendModeTest |
| `khronos-negative-scale.png` | NegativeScaleTest |
| `khronos-texture-encoding.png` | TextureEncodingTest |
| `stripes-floor.png` | AC5's stripes floor, 80° from its normal at the centre |
| `ktx2-asset.png` | AC6's KTX2 asset on its panel |

Those files are attached to the PR and shown to the owner in the session. The owner's answer is recorded in
`tests/acceptance/423/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record that
answer:

```json
{"issue": 423, "criterion": "#423.35374578", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"<file name>": sha256, … all eight}, "note"?: string}
```

No file is INCONCLUSIVE; a call whose `screenshots` don't equal this run's SHA-256s (it was made on other pictures)
is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this run's pictures passes. No other test reads these
pictures or the call.

## Readings where the issue and design leave a choice

- **"Fetched by hash on first use and never committed"** describes how the samples reach the run: by pinned hash, on
  first use, into an ignored cache, never in the repo, which the suite checks by git blob ID. The product's own
  first-use fetch is Pack: assets fetched on first use, a hub job behind an authority ask, which this issue doesn't
  scope; the product here receives the files by hash only.
- **"Import with every … their files declare"** is read on the import's own `material@1` fields, against each file's
  JSON: the five core texture slots, each map's image hash, texCoord set, KHR_texture_transform and sampler wraps,
  and each material's alpha mode, cutoff and double-sidedness. A sampler's filters aren't compared: the design fixes
  them ("each such sampler has linear min, mag and mip filters"), and TextureTransformTest's "disables mipmapping" is
  then the design's to override. Textures inside an extension the maps can't hold must appear in `dropped`.
- **`wrap` per axis**: TextureSettingsTest declares samplers that repeat on S and clamp or mirror on T. The design's
  `wrap: repeat | clamp | mirror` is one value; holding "every sampler" needs `[s, t]`, which the suite accepts
  beside a single mode. This is a deviation from the design's field to raise with the owner (see the job's report).
- **"Mirrored parts keep their front faces outward"** is read in the picture's numbers, not by eye: a mirrored sphere
  shades as its unmirrored twin (both double-sided, so an inward front face shades dark), and a mirrored single-sided
  plane isn't culled. The icospheres' tessellations differ slightly under a mirror, so the tolerance is 5% on the
  mean and 10% per pixel, far under the gap between a lit and an inside-out sphere.
- **"Within one 8-bit code value of each other"** is per channel, every pixel of a disc 8 px inside each sphere,
  compared pixel for pixel between spheres an exact 240 px apart, in the final target with tone map none.
- **"Naming the row and the column"**: rows are `base color`, `emission`, `metallic-roughness`; columns `factors
  only`, `1 × 1 texture`, `gamma`, `ICC profile`, in the file's own layout (its README: first column factors only).
- **"The row where one pixel spans one texel across them"** is the frame row whose centre pixel's footprint across
  the stripes is nearest one texel (it is one within 0.5%); "32 sampled pixels" are the 32 about the centre column;
  Michelson contrast is (max − min) ÷ (max + min) of their linear luminance. The unlit material makes the linear
  value the texel's own.
- **"A 16-sample reference on the same machine"** is the same plane drawn in the same run with the look's
  `samples.live` at 16 rather than 1 (Look: samples).
- **"A fixture asset"** for AC6 is a `material@1` whose five map fields name the four KTX2 files by hash (ORM as both
  `metallic_roughness` and `occlusion`, one map); a glTF with `KHR_texture_basisu` would reach the same transcode.
  "About 22.4 MB" and "about 89.5 MB" are held within 1% of 4 × 2,048² × 1 B × 4/3 and × 4 B × 4/3; "over the cap" is
  over 64 MiB (67,108,864 B), refused `over_budget`. "A second load" is a second document naming the same hashes in
  the same run.
- **"Transcoded as sRGB color reads x and y as −0.57"**: sRGB-decoding 128 gives 0.216, so x = y = 2 × 0.216 − 1 =
  −0.57; whatever z the renderer rebuilds or keeps, n·l falls under 0.25 at 45°. Only the n·l bound is asserted.
- **The "Shown to you" screenshots** are the renderer's own final targets, copied byte for byte; this suite names the
  record file, as #1174's does.

Not tested, because no criterion asks: the geodesic ball builder and the four Platonic solids at detail 0 (in the
scope, with no criterion), flipbook atlases, insets on surfaces and compute textures with mips (their `filter_taps`),
a look that lowers `filter_taps`, ASTC on the web and RGBA8 where the adapter has neither BC nor ASTC, BC4 for a
one-channel map, KTX2 maps that aren't whole 4 × 4 blocks or lack mips, `extension_required`, COLOR_0, the other
material extensions' fields, the probe's `textures` list, and a transcode cache across processes.
