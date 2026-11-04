# Acceptance tests for #433: Familiar names — familiar@1 and tool-word packs, recipes with stated conversions

Written first, from issue #433 (its scope, its five acceptance criteria and its proof line), the design sections it
links and those they lean on, its oracle page, and base commit `5f63620c` ("Merge pull request #1221 …"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #433 and its oracle page (`doneright/oracles/issues/433.md` and `cases/433.json` in `DeepBuildAI/deepbuild`,
  branch `doneright`): upstream tests for 3 of 5 criteria, none runnable on our output as they are. three.js
  `65c4864bb3` (AC3, AC4): `PointLight.tests.js` (power = 4π × intensity), `PerspectiveCamera.tests.js` (a vertical
  fov's projection), `Euler.tests.js` (Euler angles through matrices and reorders); `SpotLight.tests.js` fixes a
  spot's power at π × intensity, which our whole-sphere rule replaces. Blender `0a18557098` (AC5): the glTF lamp
  export test, which needs Blender, and `conversion.py:10`, `PBR_WATTS_TO_LUMENS = 683`. Unreal `396c9f0599` (AC5):
  `SpotLightComponent.cpp:79-100`, lumens to candela by `100 * 100 / 2 / PI / (1 - cos half cone)`, which gives our
  × 2 ÷ (1 − cos θ_outer). Their method is ported, not their data: the three.js tests' rules (power, vertical fov,
  Euler order through the matrix) become reference.ts's, held against our expansion; Blender's and Unreal's
  formulas set tool-words.json's expected values. The page says AC1 and AC2 have no upstream test (three.js's
  geometry tests check no bounds; the godot@1 recipes are ours).
- `docs/canvas-primitives.md`: Units and axes (28: metres, right-handed, +Y up, front +Z; degrees in documents;
  R = Rz·Ry·Rx about fixed axes; "subtract the pivot, scale, shear, rotate, add the position"; lumens for point
  and spot lights; linear BT.709); Builders, recipes, looks and cameras (2766), Object (2772: the instance record's
  "3×4 world matrix"), Builder (2862) and Builder `ball`: tessellation ("the familiar-names pack's polyhedra");
  Recipe and Pack (3230, 3262); Pack: math@1 (3460: "`aliases: {word → {target, renamed_from}}` (on any
  familiar-names pack …)", "Each name takes its usual parameter names and defaults, with the stated conversions …
  a parameter the primitives can't honor is refused with a fix, never dropped"); Light and the light policy
  (4020); Camera `camera@1` (4395: `fov` "across the wider side", `target` with `position`) and its lens.
- `docs/technical-design.md`: The canvas core and the paragraph on familiar-names packs (1055: "an agent fluent in a
  popular web 3D library, Unreal, Blender or Godot … with stated conversions"); the agent-tools row (477: deep_kinds
  "answers another tool's words from a familiar-names pack"); Decided; the parity suite (2544: expected values set
  outside the implementation, CPU references as reviewed test code); Dogfooding (2524); Tests written first (2555).
- At the base, to learn the call shapes only: `tests/acceptance/441/` (this suite's house style), `420/` (`geometry`,
  packs in the scenario, derived IDs), `421/` (`light.point@1`, `light.spot@1`, `power` in lm), `412/` (deep_kinds,
  `word`, a tool-word pack's `aliases`); `crates/deep-show` (`run`, `geometry.rs`, `packs.rs`: a scenario's `packs`
  installed from folders, the `deep_show` reply's `expansions`, `kinds.rs`'s word lookup); `crates/deep-canvas`
  (`document/packs.rs`: recipes as data, derived items and their `at`, a pack's `aliases`; `kinds.rs`'s `camera@1`;
  the unit grammar, which refuses degrees for radians); `crates/deep-canvas-scene3d` (`scene.rs`'s `at`, which
  reads `pos`, `rot` and `scale` and no pivot; `light.rs`); `packs/composites-1.0.0` (a first-party pack's folder).
- The reference library's sources at the pin, read through GitHub: `src/geometries/*.js`, `examples/jsm/geometries/
  RoundedBoxGeometry.js`, `src/math/Matrix4.js` and `Euler.js` (`DEFAULT_ORDER = 'XYZ'`), `src/core/Object3D.js`
  (`pivot`: "the matrix maps the pivot to position + pivot"), `src/cameras/PerspectiveCamera.js` (vertical `fov` in
  degrees), `src/lights/PointLight.js` and `SpotLight.js`, `src/extras/core/Curve.js` (computeFrenetFrames). Godot
  `4.5.1-stable`: `core/math/basis.cpp` (set_euler), `doc/classes/Node3D.xml` and `Light3D.xml`.

## What the base already does, which these tests don't credit

`deep-show run` installs packs from folders named in the scenario, expands recipes at check into derived items
listed in the `deep_show` reply's `expansions`, answers `geometry` for builder items, and draws `light.point@1` and
`light.spot@1` from `power` in lumens. A pack may carry `aliases`, and deep_kinds' `word` answers them. There is no
familiar@1, godot@1, unreal@1 or blender@1 pack (no `packs/familiar-1.0.0` and the rest), so no `familiar.*`,
`godot.*`, `unreal.*` or `blender.*` kind; an item's `at` has no pivot (`scene.rs` reads `pos`, `rot`, `scale`);
`geometry` rows carry no `world`; and none of the planted names below exists. So the tests define the surface
below.

## Run them

Each file builds `deep-show` in the `full` set (`cargo build --locked --bin deep-show --no-default-features
--features full`, honouring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless
set), once, copies it out under its own name in a temporary folder, and fails each test if the build failed. So
they run one file at a time. `scripts/lanes.mjs` may need `'tests/acceptance/433/'` added to its `alone` list, as
#420's and #441's are; this README is the instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/433 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/433/tsconfig.json
```

Each test writes its scenario's evidence store into its own temporary folder and deletes it. Node built-ins and
vitest only: no npm dependency; the reference library is ported into `reference.ts`, not installed. A run with
`--root tests/acceptance/433` leaves Vitest's cache in `tests/acceptance/433/node_modules/.vite`; delete it. Every
test is CPU only and runs anywhere; no criterion has a time budget. `BASE-FAILURE.txt` says why the suite wasn't run
at the base.

## The surface under test

The issue names the recipes' families, the conversions, the numbers and the planted programs, but no code API, and
leaves which tools ship to deep_kinds. These tests define the smallest surface they need on the binary and calls
that exist: **four first-party packs** (folders under `packs/`, as `composites-1.0.0` is), **one new field on
`geometry` rows** (`world`), **an item's `at` gaining a pivot** (the design's transform order), and planted names.
Everything #306's, #420's and #441's READMEs define for `deep-show run` holds unchanged: the scenario's `packs`
(`[{id, dir}]`), a document's `packs` (`["deepbuild/familiar@1.0.0"]`), the `deep_show` reply's `expansions`
(`[{instance, kind, pack, key, derived: {id → item}}]`), `geometry` over every item with geometry (derived items by
their derived IDs). No new binary, no new call. Every name below the issue doesn't give is this job's invention.

### Packs

| Pack | Folder | Recipes this suite writes |
|---|---|---|
| `deepbuild/familiar@1.0.0` | `packs/familiar-1.0.0` | `familiar.box@1`, `.sphere@1`, `.cylinder@1`, `.cone@1`, `.torus@1`, `.capsule@1`, `.plane@1`, `.circle@1`, `.ring@1`, `.tetrahedron@1`, `.octahedron@1`, `.icosahedron@1`, `.dodecahedron@1`, `.tube@1`, `.lathe@1`, `.extrude@1`, `.shape@1`, `.rounded_box@1`, `.perspective_camera@1`, `.point_light@1`, `.spot_light@1` |
| `deepbuild/godot@1.0.0` | `packs/godot-1.0.0` | `godot.mesh_instance_3d@1`, `godot.omni_light_3d@1`, `godot.spot_light_3d@1` |
| `deepbuild/unreal@1.0.0` | `packs/unreal-1.0.0` | `unreal.point_light@1`, `unreal.spot_light@1` |
| `deepbuild/blender@1.0.0` | `packs/blender-1.0.0` | `blender.light@1` |

The three tools are the ones the design (technical design 1055: "Unreal, Blender or Godot") and the oracle page
(godot@1, unreal@1, blender@1) name. A pack may ship more recipes and more tools; the issue leaves that to
deep_kinds, and this suite covers only the recipes it names (README: readings).

### Documents: familiar@1's words

Each recipe takes the reference library's parameter names and defaults (three.js at the pin), with angles in
degrees (README: readings), and expands to our builders, cameras and lights:

- Geometry, the constructor's parameters by name: `box {width, height, depth, widthSegments, heightSegments,
  depthSegments}`; `sphere {radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength}`;
  `cylinder {radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength}`;
  `cone {radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength}`; `torus {radius, tube,
  radialSegments, tubularSegments, arc}`; `capsule {radius, height, capSegments, radialSegments, heightSegments}`;
  `plane {width, height, widthSegments, heightSegments}`; `circle {radius, segments, thetaStart, thetaLength}`; `ring
  {innerRadius, outerRadius, thetaSegments, phiSegments, thetaStart, thetaLength}`; the polyhedra `{radius,
  detail}`; `tube {path: [[x, y, z]] (three.js's CatmullRomCurve3 through the points), tubularSegments, radius,
  radialSegments, closed}`; `lathe {points: [[x, y]], segments, phiStart, phiLength}`; `extrude {shape: [[x, y]] (a
  Shape through the points), depth, bevelEnabled, bevelThickness, bevelSize, bevelOffset, bevelSegments, steps,
  curveSegments}`; `shape {shape}`; `rounded_box {width, height, depth, segments, radius}` (the library's
  RoundedBoxGeometry addon).
- An object's transform, Object3D's names, on any geometry recipe: `position: [m]`, `rotation: [deg]` (the
  library's default order, 'XYZ'), `scale`, `pivot: [m]`. Expanded through the rotation matrix to our `at.rot`
  (R = Rz·Ry·Rx) and to our position plus that pivot, so the item's world matrix is the library's matrixWorld.
- `perspective_camera {fov (vertical, deg) = 50, aspect = 1, near, far, position, rotation}` expands to a
  `camera@1` with `fov` across the wider side and a `position` and `target` (the library's local −Z forward).
- `point_light {color, intensity (cd) = 1 | power (lm), distance = 0, decay = 2, position}` and `spot_light {color,
  intensity (cd) = 1 | power (lm), distance, angle, penumbra, decay = 2, position}` expand to `light.point@1` and
  `light.spot@1` with `power` in our whole-sphere lumens. A value the pack can't map (a decay other than 2) is
  refused.

### Documents: the tool-word recipes' words

Each takes its tool's own property names, as tool-words.json writes them, with the conversion that file states:

- `godot.mesh_instance_3d@1 {mesh: {type: "BoxMesh", size: [m]}, position: [m], rotation: [rad] (Node3D's default
  YXZ order), scale}`; `godot.omni_light_3d@1 {position, light_intensity_lumens, light_negative}`;
  `godot.spot_light_3d@1 {position, light_intensity_lumens, spot_angle (deg, the half angle)}`. Godot is metres,
  +Y up; its lumens count the whole sphere for a spot too (Light3D.xml).
- `unreal.point_light@1` and `unreal.spot_light@1 {Location: [cm] (+Z up), Intensity, IntensityUnits: "Lumens" |
  "Candelas", OuterConeAngle, InnerConeAngle (deg, half angles; spot only), SpecularScale}`.
- `blender.light@1 {type: "POINT" | "SPOT", energy (W), spot_size (rad, the full angle), location: [m] (+Z up)}`.

### `geometry` rows gain `world`

Every row that carries `positions` adds `"world": [[r00, r01, r02, t0], [r10, r11, r12, t1], [r20, r21, r22, t2]]`:
the item's world matrix at t, as its instance record holds it (Object: "a 3×4 world matrix"), mapping the row's
item-space `positions` to world metres. It honours the pivot (our transform order: subtract the pivot, scale,
rotate, add the position, then the parent).

### Refusals

A word or value a pack doesn't map is refused when presented: the `deep_show` reply's `issues` (an error) or
`notices` hold an entry whose `path` is `items/<instance>/params/<word>`, and, if the revision is presented, the
instance has no derived item. The code isn't pinned.

### `deep-show run`: scenario `planted` values added (each reachable only there)

| Value | The wrong program | Criterion |
|---|---|---|
| `familiar_copies_angles` | familiar@1 copies an object's `rotation` angles as written into our `at.rot`, in our order | AC3 (issue-named) |
| `familiar_copies_position` | familiar@1 copies an object's `position` into our position, leaving out its pivot, so the pivot lands at the position | AC3 (issue-named) |
| `familiar_widens_portrait` | familiar@1 widens every camera's vertical fov by its aspect, 2·atan(aspect·tan(fov/2)), so a 9:16 camera's narrows to 29.395° | AC3 (issue-named) |
| `familiar_looks_plus_z` | familiar@1 aims a camera with no target along its local +Z | AC3 (issue-named) |
| `familiar_copies_spot_power` | familiar@1 copies a spot light's `power` into ours | AC4 (issue-named) |

## Fixtures

| Fixture | What it is | Read by |
|---|---|---|
| `fixtures/familiar-bounds.json` | One case per familiar@1 geometry recipe (18), each with its params, the three.js call it stands for, the pin and the 1e-6 m tolerance; non-default segments and partial sweeps | AC1 |
| `fixtures/tool-words.json` | AC2's seven cases (every tool-word recipe named above) and AC5's four, each with its tool's words, its stated conversion, the values the expansion must hold, and each section's word with no mapping; the sources of each conversion | AC2, AC5 |

AC3's and AC4's documents are written in their test files. The CPU references are `reference.ts`: the positions of
each three.js generator at the pin (the bounds are of their f32 values, as the library's buffers hold them),
three.js's matrixWorld with its pivot step, Godot's YXZ basis, our Rz·Ry·Rx angles, the vertical-to-wider fov, the
library's −Z forward and the on-axis lux. This job checked the geometry port once against three.js r186's own
code (npm `three@0.186.0`, whose geometry, camera, light and Euler files equal the pin's; Matrix4.js differs by one
no-op line, Object3D.js by a comment and applyMatrix4's pivot step, neither on the way to matrixWorld): all 18
boxes exact, the world matrix within 4.4e-16. That check isn't part of the
suite, which has no npm dependency.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#607's command, as #305's README gives it, with the issue's five criterion lines on
stdin). Each test's name starts with `AC<n> #433.<id>`. Where a criterion names a wrong program, the test runs it
through `planted` and asserts it fails the way the criterion says, naming what it says.

| Criterion | Text (abridged) | Tests |
|---|---|---|
| AC1 `#433.f24f739a` | Each familiar recipe builds the same bounds as the reference library's geometry with the same parameters, checked on fixtures | `familiar-bounds.test.ts` (1): 18 instances in one document; each instance's derived meshes, placed by `world`, have the box of three.js's vertices for the same parameters within 1e-6 m. Wrong programs: a segment count dropped (sphere 6 × 5, cylinder 5, cone 3, torus 5 × 6, capsule 3 × 5, circle 3, ring 4, tube 6), a sweep started or measured elsewhere (sphere's φ, cylinder's θ, lathe's φ, circle's θ, ring's θ, torus's arc), a flat shape or a torus in another plane than XY, polyhedra in another orientation or not subdivided, an extrude without the library's default bevel |
| AC2 `#433.91c3ce63` | Each tool-word recipe expands with its stated conversion, and a word with no mapping is refused with a notice | `tool-words.test.ts` (1): Godot's YXZ radians through the matrix (the item's `world` against basis.cpp's within 1e-9), Godot's lumens kept for omni and spot, Unreal's candela × 4π, Blender's watts × 683 and spot_size halved into degrees, Blender's Z-up; `light_negative` refused at `items/gd_negative/params/light_negative`, nothing drawn. Wrong programs: Godot's angles copied or read in XYZ or as degrees, a spot's lumens spread over its cone, candela copied, spot_size read as a half angle, Z kept up, an unmapped word dropped or drawn |
| AC3 `#433.d62fb708` | Against a pinned release … world matrix within 1e-9 …, our angles (51.8766°, −7.2862°, 69.1188°); copied angles miss by 1.668 …, copied position puts the pivot at x = 10 m …, each failing, naming the item and the field. Vertical fov 50° → 79.3169° at 16:9 and 50° at 9:16; rotation (0°, 30°, 0°) looks along (−0.5, 0, −0.866); widening the portrait to 29.395° or looking along +Z fails | `transforms.test.ts` (5): the crate's matrix (its item's `world` times the map onto the library's box) within 1e-9 of three.js's matrixWorld, its `at.rot` the criterion's angles within 5e-5°, the pivot at 11 m; the 16:9 camera's `fov` 79.3169° and the 9:16's 50° within 1e-6°, both looking along the library's turned −Z within 1e-9. `familiar_copies_angles` fails naming `crate` and `rotation`, its largest miss 1.668; `familiar_copies_position` fails naming `crate` and `position`, the pivot at x = 10; `familiar_widens_portrait` fails naming `tall` and `fov` at 29.395°; `familiar_looks_plus_z` fails naming `wide`, looking along (0.5, 0, 0.866) |
| AC4 `#433.ee555415` | Point 1 cd or 4π lm and spot 1 cd or π lm → 4π lm (12.566); spot power 800 → 3,200 lm, 63.7 lx at 2 m; copying 800 (15.9 lx) fails, naming the light; point decay 1 refused with a notice naming it, never drawn with another falloff | `lights.test.ts` (2): the five lights' `power` within 1e-9 relative, spot800's 63.7 lx on its axis at 2 m; `decay1` refused at `items/decay1/params/decay` with nothing drawn. `familiar_copies_spot_power` fails naming `spot800`, at 15.9 lx. Wrong programs: a spot counted π × cd, a point counted 4π × lm, power taken for intensity, a decay drawn with another falloff or dropped |
| AC5 `#433.f44f926c` | Tool-word conversions on fixtures: cone lumens × 2 ÷ (1 − cos θ_outer), watts × 683, cm and Z-up to m and Y-up, an unmapped word refused with a notice, never guessed | `conversions.test.ts` (1): the fixture's values recomputed from the criterion's formulas; Unreal spots of 1,000 lm at 60° and 30° are 4,000 and 14,928.2 lm; Blender's 10 W point is 6,830 lm; Unreal's point at (300, −400, 250) cm stands 2.5 m up and 5 m from the vertical axis; `SpecularScale` refused at `items/ue_specular/params/SpecularScale`, nothing drawn. Wrong programs: cone lumens copied or divided by the full cone, watts copied or divided by 4π, cm kept, Z kept up, an unmapped word dropped |

## Readings where the issue and design leave a choice

- **The reference library** is three.js, the web 3D library whose words these are. **"A pinned release"** is the
  oracle page's commit `65c4864bb3bd4309257d41c6e54f4403dc57f255` (package.json 0.186.0), whose files the
  references port; on everything they port it computes what the r186 release does (Fixtures, above).
- **Angles in familiar@1 are degrees**, as everywhere in our documents (Units and axes), since the criterion writes
  the rotation in degrees and our unit grammar refuses radians for a degree field; defaults in radians become
  degrees (`phiLength = 360`). The library's camera `fov` is degrees already. Tool-word recipes keep their tool's
  units (Godot's and Blender's radians), and the pack states the conversion.
- **"The same bounds"** (AC1) is the box of the program's built meshes for the instance, placed in the world by each
  derived item's `world`, against the box of the library's vertices (f32, as its buffers hold them), within 1e-6 m
  per bound (times the largest extent where it passes 1 m). The library's tessellation decides some bounds; the
  fixture chooses parameters where it does, since the criterion says "with the same parameters".
- **"Has the library's world matrix"** (AC3) is read as the matrix the program's item applies to the library's own
  geometry: the item's `world` times the scale-and-move that takes the library's 1 m box onto the item's own mesh
  box, so a builder whose mesh sits elsewhere in its own space is judged by where it puts the box. The object is a
  familiar box that builds one item. **"Reading our angles"** is that item's `at.rot`, within 5e-5° (the criterion
  gives four decimals). **"Naming the item and the field"**: the instance's ID and `rotation` (a rotation-and-scale
  coefficient off; `scale` if a column's length is off), or `position` (where the pivot lands).
- **"Expands to fov 79.3169° at 16:9 and 50° at 9:16"** (AC3): the camera's own `aspect` and its document's frame
  are both 16:9 or 9:16, so either may decide the wider side. **"Looks along"** is the unit direction from the
  expanded camera@1's `position` to its `target`, within 1e-9 of three.js's −Z turned (0°, 30°, 0°).
- **"63.7 lx on its axis at 2 m"** (AC4) is the expanded power over 4π (our candela, the design's whole-sphere rule)
  over 2²; the renderer's photometry is #421's criterion, not this one's.
- **"Refused with a notice naming it"** (AC2, AC4, AC5): an issue or notice at the word's path, and nothing of the
  instance drawn ("never drawn with another falloff", "never guessed"). The word or value is the suite's choice where
  the criterion doesn't name one: Godot's `light_negative` and Unreal's `SpecularScale`, which no light of ours can
  draw.
- **"Each tool-word recipe"** (AC2) is each recipe this suite names, in the three packs the design and the oracle
  name; which tools ship is deep_kinds' to list, and a recipe this suite doesn't name isn't covered here.
- **"Centimetres and Z-up become metres and Y-up"** (AC5) fixes the unit and the up axis: 250 cm up is 2.5 m along
  +Y, and 500 cm from the vertical axis is 5 m from it. Which horizontal axis maps where, and the mirror Unreal's
  left-handed frame needs, is the pack's stated conversion and isn't pinned.

## Not tested, because no criterion asks

sRGB to linear color and materials; `aliases` and deep_kinds answering a familiar word or noting `renamed_from`
(the scope's last item, which no criterion names); filmback and focal length to fov; animation curves, easings and
stacked strips to clips; a scene node's transform beyond Godot's box; Unreal's and Blender's rotations; spot cones'
inner angles and the library's `angle`, `penumbra` and `distance`; holes in extrude and shape; closed tubes and
curved tube paths; the library's other parameter spellings; and deep_kinds listing which tools ship.
