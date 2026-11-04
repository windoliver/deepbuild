# Acceptance tests for #421: 3D renderer — the shading core, the light policy, renderer fixes and the showpiece class

Written first, from issue #421 (its scope, its Fields blocks — Material, Light and the light policy — its five
acceptance criteria and its proof line), the design sections it links and those they lean on, its oracle page, and
the base commit `881e2ed4` ("Merge pull request #1136 …"), by a job that never saw an implementation; none existed.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). The owner asked for a lean suite: one file per criterion, at most two tests each.

## What was read

- Issue #421 and its oracle page (`doneright/oracles/issues/421.md` in `DeepBuildAI/deepbuild`, branch `doneright`):
  upstream tests for criteria 2 (Khronos `NegativeScaleTest`, glTF Asset Generator `Node_NegativeScale` and others)
  and 4 (Blender's `BLI_kdtree_test.cc`, `BLI_kdopbvh_test.cc`); none for 1, 3 and 5. Ported: Blender's kd-tree
  pattern (nearest, nearest-n and radius queries on a random set against a brute-force sorted scan) into AC4, over
  boxes. Not ported: the glTF negative-scale models, which need the glTF import path and its sample images; the issue
  names our own parity fixture for that criterion, which this suite writes instead.
- `docs/technical-design.md`: Scenes, physics and the canvas core ("a still scene costs nothing: an unchanged frame is
  shown again and the GPU stays idle"; "A frame also says until when it stays valid, so a still or stepped canvas
  stops redrawing"; objects, the look, physical light units); Dogfooding.
- `docs/canvas-primitives.md`: Units and axes (meters, +Y up, R = Rz·Ry·Rx, "subtract the pivot, scale, shear,
  rotate, add the position, then apply the parent"; lumens, lux); The cost model (every class "draws nothing while
  still"; the showpiece row); Order keys ("Ties break by ID"); The status-color rule; Spatial index; Status binding
  ("a status binding on one takes its stroke slot, drawn as an outline around the object … a fill slot there is
  refused"); Object; Object: see-through order; Material; Light and the light policy (`power: lm`, `illuminance:
  lx`, "a spot's `power` counts the whole sphere, as a point light's does: lm = 4π × cd").
- At the base: `crates/deep-gpu-layer` (`main.rs`'s calls and `--planted` table, `view3d.rs`, `live.rs`,
  `status.rs`), `crates/deep-scene3d-render` (the linear target is scene-referred, before exposure; a sun shades a
  white surface at E ÷ π), `crates/deep-canvas-scene3d` (`scene.rs`'s transform and camera, `module.rs`'s kinds),
  `crates/deep-show`, and the suites `tests/acceptance/378`, `386`, `420` (helpers, looks, documents, the pinhole,
  the scenario harness), `138` and `185` (kit and interface conventions).

## What the base already does, which these tests don't credit

`view3d` draws scene3d documents into final, linear (f32, before exposure) and object-ID targets; a sun lights a
white surface at E ÷ π; transforms compose as Units and axes says; a stroke status binding on a box draws an outline
in the exact status color after the upscale and depth-tested (#386), and a fill binding is refused with
`status_slot_kind` at the path `status_bindings/<id>/target`, which doesn't name the item. There is no `material@1`,
`light.point@1` or `light.spot@1` (each skipped as `unknown_kind`), no `spatial` call on `deep-show run`, none of
the planted names below, and `live` draws every frame of a session whether anything moved or not.

## Run them

They build cargo binaries (`deep-gpu`; `deep-show` with `--no-default-features --features full`), as #378's,
#386's and #420's suites do, so they run one file at a time. `scripts/lanes.mjs` needs `'tests/acceptance/421/'`
added to its `alone` list, beside `tests/acceptance/420/`; this README is the instruction, the implementer makes that
edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/421 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/421/tsconfig.json
```

The GPU tests (AC1, AC2, AC3, AC5) draw on macOS's Metal device; off macOS they fail with a message starting
`INCONCLUSIVE:`, never pass. AC3 also requires a reference Mac (`Mac15,7` or `Mac15,12`), since its criterion says
"read back on the reference Mac". AC4 runs anywhere. Nothing is gated on power or load.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped. Each test's name starts with `AC<n> #421.<id>`.

| ID | Criterion | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#421.e43f3de1` | The scene settles and draws no frames when nothing moves | `still.test.ts` (2): a still block in `live`, 60 frames at 60 fps, `report: ["fences"]`: it draws within 8 frames of opening, then no view row says `drawn: true` and no `submit` fence names the session until a revision at frame 30 moves the block; that revision draws within 8 frames and the scene is quiet again from frame 38. Control: the block moved by a channel draws every frame after its first two. Catches: the base (draws every frame); a renderer that keeps redrawing or submitting while still; one that never draws or ignores a revision |
| AC2 `#421.fcae3a3c` | An instance whose world transform has a negative determinant renders with its front faces out (parity/scene/mirrored-instance-winding.scene), and coplanar opaque ties draw the same way every frame | `winding.test.ts` (2): the parity fixture's `document` (a box mirrored by its own scale [-1, 1, 1], one mirrored by its parent's [1, 1, -1]) against its `reference` (the same picture, every determinant positive): per mirrored box, at least 99.5% of its reference pixels show it in the ID target, at most 1% of them differ by over 2% in linear luminance, mean within 1%; `--planted winding_ignores_determinant` fails naming `mirrored` and `inherited`. Ties: two slabs with coplanar tops over a 1 × 2 m overlap, from two cameras, listed in either order, 4 frames each with a far block moving: every pixel 3 px inside the overlap's projection shows one slab, the same in every frame, view and order; `--planted ties_by_submission` fails. Catches: winding chosen without the determinant (or from the local scale only); ties left to submission order or rounding |
| AC3 `#421.c70cf9fb` | Lights match photometry on linear targets read back on the reference Mac: a point light's illuminance falls with the inverse square, a spot keeps its lumens counted over the whole sphere, and a sun gives its lux, each within 1% | `photometry.test.ts` (1): a white diffuse floor (base color 1, metallic 0, specular level 0, roughness 1) in the linear target, a no-light render subtracted, E = π × the linear value at each of 25 pixels around the point under the light, each within 1% of: point 800 lm at 1 m and 2 m, (800 ÷ 4π) cos θ ÷ d²; spot 800 lm at 2 m, inner 20°, outer 30°, the same; sun 100 lx straight down, 100. Ratios, each 1 within 1%: E(1 m) ÷ E(2 m) ÷ 4, spot ÷ point at 2 m. `--planted spot_counts_cone` fails naming the spot. Catches: no point or spot light (the base); 1/r falloff; a spot divided by its cone's solid angle or by π; a sun without ÷ π |
| AC4 `#421.dc19b4bc` | Spatial-index and culling queries return exactly what a brute-force scan returns, and a hierarchy's bounds are the union of its children's | `spatial.test.ts` (2): 240 seeded boxes (120 children up to three deep, random turns and scales, a tenth mirrored) and three cameras: every item's bounds equal the test's own world AABB of the box's eight corners to 1e-6; every `subtree` equals the union of the item's bounds and its children's subtrees (1e-12); children lists match; 3 view, 15 box, 10 nearest-n and 10 radius queries each equal the brute-force scan over every item's bounds (views and boxes as sets, nearest and radius in the scan's order). `planted: cull_by_center` fails naming a view and a dropped item; `planted: bounds_children_only` fails naming a subtree. Catches: the base (no `spatial`); a cull that drops an object a brute scan keeps or keeps one it drops; stale, local or wrong-corner bounds; a hierarchy missing a grandchild |
| AC5 `#421.d9173e82` | A status binding on a 3D object draws its stroke as an outline around the object in the exact status color after tone mapping, and one that names the object's fill slot is refused naming the item | `outline.test.ts` (2): a crate with a `material@1`, its stroke bound to a fail verdict, in a filmic look one stop up: one stroke mark on `crate`, fail, #bf232b; in the final target, outside the legend and mark label boxes, pixels of exactly #bf232b number at least half the crate silhouette's boundary pixels and all lie within 8 px of it. `--planted status_before_tone_map` fails naming `crate`. A binding `b1` naming `items/crate/params/paint/fill` is refused `status_slot_kind`, and the refusal names `crate` (the same crate unbound draws). Catches: an outline tinted by the tone map; a status color as a fill; a fill binding accepted or refused without naming the item (the base) |

## Assumed surfaces

The issue and design name the behaviors but not these calls and fields; each is this job's choice, the most natural
one beside the base's own calls. The implementer provides exactly these.

1. **Kinds.** `material@1` (Material's fields as `params`; an object names it with a top-level `material: <ID>`),
   `light.point@1` (`params: {power: lm, color}`, placed by `at.pos`) and `light.spot@1` (`params: {power: lm, color,
   inner: deg, outer: deg}`, shining along its own −Z, placed and aimed by `at.pos` and `at.rot`), in scene3d's kinds,
   beside the base's `light.sun@1` (which shines along its own −Z, aimed by `at.rot`).
2. **The linear target stays as #378 defines it:** scene-referred linear BT.709, before exposure and the tone map,
   so a white Lambertian surface (base color 1, metallic 0, specular level 0, diffuse roughness 0) reads E ÷ π.
3. **`live` (#379) reports a still frame as not drawn:** a view row's `drawn` is `false` for a frame the view
   didn't draw because nothing changed, and #420's `fences` report has no `submit` for that session and frame.
4. **`deep-show run` gains the `spatial` call:**
   `{"call": "spatial", "doc": doc ID, "t"?: "0s", "queries": [Query]}`, with
   `Query = {"view": camera ID} | {"box": {"min": [x, y, z], "max": [x, y, z]}} | {"nearest": {"point": [x, y, z], "n": k}} | {"radius": {"point": [x, y, z], "r": m}}`,
   answering `{"items": {ID → {"bounds": {"min", "max"} | null, "subtree": {"min", "max"} | null, "children": [ID]}}, "results": [[ID]]}`:
   `bounds` is the item's world AABB (null for an item with no geometry), `subtree` the union of its bounds and its
   children's subtrees, `children` its direct children; one result list per query. A `view` keeps the items whose
   bounds pass the cull: kept unless all eight corners lie outside one of the camera's six planes (its `fov` across
   the wider side of the document's `size`, its `near` and `far`); a `box` keeps the items whose bounds touch it
   (closed intervals). Both are sets. `nearest` gives the k items nearest the point and `radius` every item within r,
   by distance from the point to the item's bounds (0 inside), ordered by distance, then ID.
5. **The fill refusal names the item:** `view3d`'s refusal for a binding on a 3D object's fill slot keeps its code
   `status_slot_kind` and carries the item's ID in its `path` or message (e.g. `items/crate/params/paint/fill`).
6. **Planted programs**, each reachable only through `deep-gpu run --planted <name>` or a `deep-show` scenario's
   `planted`:

| Name | Binary | The wrong program | Criterion |
|---|---|---|---|
| `winding_ignores_determinant` | deep-gpu | The front-face winding is chosen without the world transform's determinant, so a mirrored instance draws back faces out | AC2 (the fixture's twin) |
| `ties_by_submission` | deep-gpu | Opaque draws are submitted in an order that alternates every frame, and coplanar ties are left to the depth test | AC2 (a mutant) |
| `spot_counts_cone` | deep-gpu | A spot's lumens spread over its cone: cd = lm ÷ 2π(1 − cos outer) | AC3 (the criterion's wrong program) |
| `status_before_tone_map` | deep-gpu | The status outline is drawn into the linear target, so the tone map tints it | AC5 (a mutant) |
| `cull_by_center` | deep-show | A `view` query keeps an item only when its bounds' centre is inside the view | AC4 (a mutant) |
| `bounds_children_only` | deep-show | A node's subtree bounds union only its direct children's own bounds | AC4 (a mutant) |

## Fixtures

| Fixture | What it is | Read by |
|---|---|---|
| `fixtures/parity/scene/mirrored-instance-winding.scene` | The issue's parity fixture (JSON): `document`, two boxes with a negative world determinant (one by its own scale, one by its parent's); `reference`, the same picture with every determinant positive, and why they match; `twin`, the planted program that must fail and the items it names | AC2 |

The other documents are generated in the test files and `helpers.ts`.

## Readings where the issue and design leave a choice

- **"Draws no frames"** is read in `live`, where a session's frames are presented: no view drawn and no GPU work
  submitted for the session. "Settles" allows 8 frames after opening or after a change.
- **"Front faces out"** is read against a reference with the same geometry and every determinant positive: the boxes
  are symmetric under each mirror, so the pictures must match.
- **"Coplanar opaque ties draw the same way every frame"** doesn't say which surface wins; the test requires one
  winner over the whole overlap, the same in every frame, from both views and in both list orders.
- **Photometry**: illuminance is read on a white Lambertian floor as π × the linear value, a no-light render
  subtracted; the inverse square and the spot's whole-sphere lumens are also checked as ratios, which hold whatever
  the diffuse convention. The light's `color` is given as `[1, 1, 1]` so no temperature conversion enters.
- **The spatial index** is queried in 3D, since #421 is the 3D renderer's; "culling queries" are the `view` query,
  whose predicate (the plane test on the bounds) is the brute scan's too.
- **"After tone mapping"** is a filmic tone map one stop up; the outline's exact color is read in the final target.

Not tested, because no criterion asks: the BRDF and DFG table, multiple scattering, specular antialiasing, Toksvig
roughness, alpha to coverage, UV sets, the shadow catcher, sort bias, light ranking and the `lights_over_budget`
notice, the showpiece class's budgets, materials as items keyed by channels, and the `scene3d@1` kit.
