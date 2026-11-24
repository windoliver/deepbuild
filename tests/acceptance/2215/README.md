# Acceptance tests for #2215: anisotropy on a see-through part

Written first, from issue #2215 (its scope, its five acceptance criteria and its proof line), its epic #136 and its
dependency #178 (Path-traced finals) for scope only, the design sections it links and those they lean on, and the base
commit `5f5791e2d` ("Merge pull request #3068 …"), by a job that never saw an implementation; none existed. The
implementing agent doesn’t edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one file per criterion, one test each except AC5’s two, and exactly the planted programs the criteria
name.

## What was read

- Issue #2215; #136 and #178 for scope and vocabulary (the final’s Export fields, its receipt, BLOCKED without ray
  queries, final.match).
- `docs/canvas-primitives.md`: Material (anisotropy "stretched along uv0’s u direction", turned by rotation;
  transmission "samples a copy of the opaque scene … at a level its roughness sets"; "path-traced finals take every lobe
  as published here"; its Paths row: `material@1` in a final `refused` `path_undefined` (#2773)); Export (its fields
  and receipt; `warnings: [{item, what}]` in Export: glTF’s receipt and the `otio` target’s); Export: path-traced finals
  (`frames: realtime | path_traced`, `path: {samples, …}`, the receipt’s `final {frame_hashes, samples, denoise, match}`,
  BLOCKED without ray queries); Paths: rays, finals and the web player; Builder and Builder: uv (`uv0: planar {axis}`);
  Camera `camera@1`.
- `docs/technical-design.md`: Path-traced finals; Dogfooding; The reference Macs.
- At the base: `crates/deep-gpu-layer` (`main.rs`’s calls, the `Planted` table `--planted` parses and `bad_input`;
  `view3d.rs` and `view3d/parse.rs`: `class: live | export | render_back`, `frames` as the frame count, `targets`, and
  `receipt: true`’s reply `{decoded_bytes, maps}`), `crates/deep-canvas-scene3d` (`light.rs`: `material@1`’s fields,
  `Lobes` with `anisotropy`, `anisotropy_rotation`, `transmission` and `ior`, `emission`; `scene.rs`: the marks;
  `uv.rs`: the planar projection; `paths.json`), `crates/deep-scene3d-render` (`mesh.rs`: `mark.box@1`’s faces and
  their uv0; `scene3d.wgsl`: `with_lobes`, the tangent along uv0’s u turned by the rotation, and `transmitted`, the copy
  read trilinearly at level log2(its larger side) × roughness × clamp(2·ior − 2, 0, 1)), `crates/deep-show/src/export`
  (the export job’s fields; nothing reads `frames` or `path`), and the suites `tests/acceptance/428/` (helpers, the
  transmission and anisotropy tests, whose helpers this suite imports), `481/`, `422/` (the castle and its machine
  rule) and `440/` (`slab@1`’s placement).

## What the base already does, which these tests don’t credit

`view3d` draws the fixture in raster with #428’s transmission: the pane samples the mipped copy of the opaque scene at
level 2.7 (log2 512 × 0.3 × 1), a round blur by construction, so AC4’s spreads already agree at the base (BASE-FAILURE.txt
gives the numbers) and only its listing fails; #428’s anisotropy stretches the specular lobe along uv0’s u, turned by
the rotation; `slab@1` takes `uv0: {planar: {axis: z}}`; `class: export` draws an export-class view; `receipt: true`
answers the maps’ receipt. There is no path tracer, no ray layer (#475) and no path-traced final (#178): `view3d` ignores
`export`, so the final half of every criterion reads BLOCKED naming #178. None of the planted names below exists
(`deep-gpu run --planted <name>` exits 2, `bad_input`).

## Run them

They build `deep-gpu` (`cargo build --locked --bin deep-gpu`, #428’s `useGpu`) and draw on the GPU, so they run one file
at a time: `scripts/lanes.mjs` lists `tests/acceptance/2215/` in its `alone` list.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2215 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2215/tsconfig.json
```

Every test draws on macOS’s Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes.
The finals’ tests (AC1, AC2, AC3 and AC5’s second) fail with a message starting `BLOCKED:` that names #178 wherever a
path-traced final is refused (no hardware ray queries, a software adapter, `path_undefined`) or not drawn at all. AC5’s
first test reads INCONCLUSIVE on a machine or macOS version other than the one its hashes were recorded on. Every test
writes into its own temporary folder and deletes it.

## Criteria to tests

IDs are `#2215.` and the first 8 hex characters of SHA-256 of each criterion’s text, trimmed, white space collapsed, the
leading `- [ ] ` dropped (`criterionId` in `scripts/proof-change.mjs`). Each test’s name starts with `AC<n> #2215.<id>`.

| ID | Criterion (short) | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#2215.021cca23` | Strength 0.5: the final’s glow ≥ 2× as wide along u as along v at 512² and 4,096 samples; strength 0: within 5%; a planted round refraction reads within 5% of 1 and fails, naming the part and both spreads | `ac1-stretch.test.ts` (1): the fixture at strength 0.5 and 0 as finals; spread along u ≥ 2 × along v, and within 5% at 0; `--planted final_refracts_round` reads its ratio within 5% of 1 and fails with a line naming `pane` and both its spreads. Catches: the base (no final); a refraction through the round lobe; a stretch at strength 0 |
| AC2 `#2215.2c2aa19d` | Rotation 90: the long axis along v, the two spreads swap within 10%; a planted tracer that ignores rotation fails | `ac2-rotation.test.ts` (1): rotation 0 and 90 at strength 0.5 as finals; at 90 along v > along u, along v = rotation 0’s along u and along u = rotation 0’s along v, each within 10%; `--planted final_ignores_rotation` fails naming `pane`. Catches: the base; a lobe that ignores rotation |
| AC3 `#2215.74b10a80` | A second disk mirrored in the pane: its highlight’s long axis within 5° of the refracted glow’s; reflection-only stretch fails AC1, refraction-only fails this | `ac3-reflection.test.ts` (1): the fixture and the fixture with the mirrored disk as finals; the highlight is their difference; each has a long axis (spreads along its own axes more than 5% apart) and the two axes lie within 5°; `--planted final_stretches_refraction_only` fails this naming `pane`, `--planted final_stretches_reflection_only` fails AC1’s reading naming `pane`. Catches: the base; either lobe stretched alone |
| AC4 `#2215.87722da6` | Raster’s glow on the fixture within 5%; its receipt names the pane and `anisotropic_transmission`; a planted frame that lists nothing fails, naming the part | `ac4-raster.test.ts` (1): the fixture at strength 0.5 in raster; spreads within 5%; `receipt.warnings` holds `{item: "pane", what: "anisotropic_transmission"}`; `--planted raster_lists_nothing` fails naming `pane`. Catches: the base (no listing); a frame that lists nothing; a raster blur stretched along u |
| AC5 `#2215.64bff3ff` | Every corpus document without both features on one material keeps its frame hashes, in raster and in finals | `ac5-nothing-moves.test.ts` (2). 1: the corpus in raster, each frame’s final and linear hashes equal `hashes.json`’s. 2: the corpus as finals at 64 samples against recorded final hashes; BLOCKED naming #178 at the base. Catches: a change that moves any corpus frame, such as listing, stretching or retracing a part with one of the two features |

## Assumed surfaces

The issue and design name the behaviors but not these calls and fields; each is this job’s choice, the most natural
one beside the base’s own calls. The implementer provides exactly these.

1. **A path-traced final through `view3d`.** The GPU layer’s `view3d` is where 3D frames, their linear targets and
   their planted programs are drawn and read (as #428’s suite does), and its `class: "export"` already draws an
   export-class view. A final is that view with the Export’s own fields for one (Export: path-traced finals):
   `{call: "view3d", class: "export", export: {frames: "path_traced", path: {samples}}, receipt: true, targets:
   ["linear"], …}`. They ride in an `export` object because `view3d`’s `frames` already counts the frames it draws.
   With `receipt: true` the reply’s `receipt` carries the design’s `final {frame_hashes, samples, denoise, match}`; the
   tests read `receipt.final.samples`, the samples asked, as the proof that the frame was traced. The `linear` target
   holds the traced light (tone map none, the look’s exposure at scale 1, as #428’s `PLAIN_LOOK`). A reply refused with
   any `code` (no hardware ray queries, a software adapter, `path_undefined` from the Paths table, whose final answer
   for `material@1` is `refused` today, #2773) or one whose receipt has no `final` is BLOCKED naming #178.
   `deep-show`’s `export` call delivering a final as a film is #178’s to wire, and no test here reads it.
2. **The raster listing** is an entry of the frame’s receipt, `view3d`’s `receipt: true` reply: `receipt.warnings:
   [{item, what}]`, the shape Export: glTF’s receipt and the `otio` target’s give to what a delivery can’t hold, with
   `{item: "pane", what: "anisotropic_transmission"}` for an item whose material has `transmission` above 0 and
   `anisotropy.strength` other than 0. Other fields on the entry, and the receipt’s other fields, are allowed.
3. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
   `crates/deep-gpu-layer/src/main.rs`:

| Name | The wrong program | Criterion |
|---|---|---|
| `final_refracts_round` | The final’s refraction samples the material’s lobe with the anisotropy dropped (round), its reflection unchanged | AC1 |
| `final_ignores_rotation` | The final’s lobes take the tangent along uv0’s u whatever `anisotropy.rotation` says | AC2 |
| `final_stretches_reflection_only` | The final stretches the reflected lobe and refracts through the round one | AC3 (fails AC1’s reading) |
| `final_stretches_refraction_only` | The final stretches the refracted lobe and reflects through the round one | AC3 |
| `raster_lists_nothing` | Raster draws the same frame and its receipt lists no `anisotropic_transmission` entry | AC4 |

## The fixture

The issue’s, in `helpers.ts` (`fixture`), drawn at 512 × 512:

- **The pane**: a `slab@1` of `size: [1, 1, 0.002]` at `pos: [0, -0.5, 0]` (a slab stands from y = 0 up, centred on x
  and z), so 1 m across, 2 mm thick, centred on the origin and facing +z; material `pane_glass`: `base_color` white,
  `metallic` 0, `roughness` 0.3, `transmission` 1, `ior` 1.5, `anisotropy: {strength, rotation}` (no `absorption`: a
  thin wall in raster). **uv0’s u on the pane is world +x, the frame’s x from left to right; v is world +y, the
  frame’s y upward.** The slab takes `uv0: {planar: {axis: "z"}}` so both its faces carry that layout: `mark.box@1`’s
  faces each lay out their own (its front face’s u runs along +x, its back face’s along +y), and a final refracts
  through both faces.
- **The glowing disk**: a `mark.cylinder@1` of `size: [0.1, 0.002, 0.1]` turned `rot: [90, 0, 0]` (axis along z),
  radius 0.05 m, its face toward the pane 2 m behind the pane’s centre (centre at z = −2.001); material `glow`: black
  base, `specular_level` 0, `emission: [1, 1, 1]` at strength 1.
- **AC3’s second disk** (`mirrored: true`): the same disk at the first one’s mirror image in the pane, its face 2 m in
  front of the pane at z = +2.
- **The camera**: `camera@1` orthographic at `position: [0, 0, 2]` looking at the origin, `view_width: 1` (the pane
  fills the frame, 512 px a metre), `near: 0.5`, `far: 10`. The near plane keeps the mirrored disk, at the camera’s own
  plane, out of every camera ray, so it shows only in the pane; a final starts its camera rays where the real-time frame
  clips, as final.match’s silhouettes against the real-time frame require.
- A black `sky@1` with no ambient and no environment (#428’s `DARK_SKY`) and no light; #428’s `PLAIN_LOOK` (tone map
  none, exposure scale 1).

## The reading

The glow is each pixel’s luminance (Rec. 709: 0.2126 R + 0.7152 G + 0.0722 B) in the linear target, over every pixel
of the frame, at the pixel’s centre. Its spread along u is √(Σ w (x − x̄)² ÷ Σ w) and along v √(Σ w (y − ȳ)² ÷ Σ w), in
pixels, about the luminance-weighted centroid (x̄, ȳ). The long axis is the major eigenvector of the 2 × 2 second-moment
matrix, its angle from u in [0°, 180°); a glow whose spreads along its own two axes are within 5% of each other (AC1’s
bound for agreeing spreads) has no long axis. AC3’s highlight is the frame with the mirrored disk less the frame
without it, pixel by pixel. A frame whose summed luminance isn’t above 0 fails, naming the pane.

## The corpus

AC5 holds still four documents already in the repository that draw scene3d materials, none with both features on one
material (`helpers.ts`: `CORPUS`), each drawn at frame 0:

| Name | Document | Why it is here | Size |
|---|---|---|---|
| `castle` | `packs/examples/castle.json`, its look `castle.look.json`, its recipes from `packs/composites-1.0.0` (#422) | many materials, lamps, sky and clouds in one scene | 640 × 400 |
| `surfaces` | `packs/examples/surfaces.json` under the castle’s look (its colour ramp names `muted`, `accent` and `ink`, which #428’s plain look lacks) | builder surfaces under one material and a sun | 640 × 360 |
| `brushed` | #428 AC1’s brushed white metal ball (`sphereDoc`, roughness 0.2, `anisotropy.strength` 1, a sun behind the camera) | anisotropy without transmission | 320 × 320 |
| `frost` | #428 AC3’s three frosted panes (roughness 0, 0.3, 0.6) over a black-to-white edge, built as its `transmission.test.ts` builds them | transmission without anisotropy | 512 × 512 |

A frame’s hashes are the SHA-256s `view3d` names its final target (PNG) and its linear target (f32) by.
`hashes.json`’s `raster` entries were recorded at the base `5f5791e2d` on a `Mac17,10` under macOS 27.2, by a probe
that drew the corpus through `helpers.ts`’s `corpusCalls` (the call the test makes) with the base’s `deep-gpu`, twice
in two runs whose hashes agreed; the test’s own base run read the same hashes. Off that model or that macOS version the
raster test reads INCONCLUSIVE, never FAIL or PASS, as #422’s goldens do under another fingerprint. On a machine that
needs its own record, the raster hashes are recorded the same way at the merge base: the test prints the hashes it read.

`hashes.json`’s `final` is `null`: there is no final at the base to record. Once #178 lands, the corpus’s final hashes
(64 samples a pixel, enough to hash and few enough for the castle) are recorded at the merge base before this change,
from the finals test’s printed line, as `final: {base, model, os, samples: 64, hashes: {<name>: {final, linear}}}`;
until then that test reads BLOCKED. A corpus document a final refuses (a Paths answer) reads BLOCKED too, naming it.

AC5’s raster test passes at the base by construction (nothing has moved yet); it is the regression guard, and it bites:
at the base, #428’s planted `transmission_ignores_roughness` moves `frost`’s two hashes and no other (BASE-FAILURE.txt).

## Readings where the issue and design leave a choice

- **"The thresholds below are starting values, to be set on the reference Mac"**: the tests hold the issue’s values
  (2×, 5%, 10%, 5°) as written. None of the criteria is a timing, so, as in #428’s suite, nothing here needs a reference
  Mac: the raster test runs on any Mac with Metal and the finals on any Mac whose GPU has hardware ray queries. A value
  set on the reference Mac changes here only by an approved proposal.
- **"The glow’s spread along u and along v"** is read over the whole frame, which is the pane, in pixels; u is the
  frame’s x and v its y (The fixture). No background is subtracted: in raster and in a final nothing but the disks
  emits and the environment is black.
- **"At 512² and 4,096 samples"** holds for every final in AC1 to AC3; AC5’s finals take 64 samples, since a hash needs no
  convergence.
- **"A planted tracer … reads a ratio within 5% of 1 … and fails, naming the part and both spreads"**: the test asserts
  the planted ratio and that a failure line names `pane` and both spreads as printed (two decimals).
- **"Fails the first criterion"** (AC3’s reflection-only twin) is AC1’s reading on that twin (`stretchOnFinal`),
  failing and naming `pane`; it runs in AC3’s file, beside the criterion that names it.
- **"Its highlight’s long axis"**: a highlight whose spreads along its own axes are within 5% has none, so a round
  highlight fails rather than passing on a chance angle.

Not tested, because no criterion asks: a stretched blur in raster; anisotropy read from a texture on a see-through part;
negative strengths; goldens of documents with both features on one material (the issue leaves them to an approved
proposal); the raster listing’s absence on a part with only one of the two features beyond AC5’s hashes; `deep-show`’s
film export of a final.
