# Acceptance tests for #1297: the key sun's shadow draws hatched stripes on smooth-shaded faces that graze the sun

Written first, from issue #1297 (its cause, its repro and its three acceptance criteria), the design sections it
links, and the base commit `b7628337` ("Merge pull request #1286 …", which holds #424's cascade bias), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). `helpers.ts` stands alone: nothing is imported from
another suite.

## What was read

- Issue #1297: Cause, Repro on main (b7628337), Acceptance criteria.
- `docs/technical-design.md`: Dogfooding (the acceptance-test job).
- Base code and suites, for conventions only: `crates/deep-gpu-layer/src/view3d.rs` (the call's `targets`, `assets`,
  `cascades`; each frame's `final` PNG named by SHA-256 and `cascades.maps`; the reply's `passes`, where
  `scene3d.shadow` is listed when a sun casts), `crates/deep-canvas-scene3d/src/spec.rs` (`light.sun@1`'s `shadow`,
  `cascades: 3` and `shadow_far: auto` defaults; `material@1`'s defaults; `mesh.asset@1`'s `shade: smooth`),
  `crates/deep-canvas-scene3d/src/gltf.rs` (no NORMAL attribute: per-vertex normals averaged from the faces that
  share the vertex), `crates/deep-canvas-scene3d/src/scene.rs` (a sun's `toward` is its +Z turned by `at.rot`; with no
  `sky@1` the solids keep the fixed ambient term), and `tests/acceptance/422/helpers.ts`, `424/helpers.ts`, `424/redraft/` (the look's shape,
  the glTF writer, the pinhole, PNG reading, the cargo build).
- Not seen: #425's `tests/acceptance/425/` and its `rockGltf` (PR #1272, not on main), any branch, worktree or fix.

## Surfaces used

`deep-gpu run`, one JSON line `{out, calls}` in and one out; `view3d` with `targets: ['final', 'ids']`,
`cascades: true` and `assets` (SHA-256 → path); each frame's `final` and `ids` PNGs named by their SHA-256, `picks`,
and `cascades.maps`; the reply's `passes`. Scene kinds: `camera@1`, `material@1`, `light.sun@1`, `mesh.asset@1` (a
JSON glTF with its buffer inline as a data URI) and, for the guard only, `mark.box@1`. All present at the base.

## How the criterion is read

| Clause | Read as |
|---|---|
| A convex smooth-shaded mesh | The repro's icosphere: radius 1, midpoint subdivision with each new point renormalized to the unit sphere, vertices shared between faces, faces counter-clockwise from outside; written as a glTF with POSITION and u32 indices only, so the reader makes smooth normals. No `shade` given (default `smooth`). |
| under a casting key sun | `light.sun@1 {illuminance: 3, shadow: true}` at rot (−60, 25, 0) (toward-sun ≈ (0.211, 0.866, 0.453)), its other params default (3 cascades, `shadow_far: auto`). The only light item; the repro names no sky, so none is added and the solids keep the renderer's fixed ambient term (the same in both frames). |
| In the repro above | `material@1 {base_color: [0.7, 0.5, 0.35, 1], roughness: 0.6}` (others default); `camera@1 {projection: perspective, position: [0, 0, 2.04], target: [0, 0, 0], fov: 40}`; 640 × 480; a physical-basis look, `tone_map: 'filmic'`, `exposure: 0`, `bloom: 'none'`, `deband: 'none'`, `finish: []`, `ground_3d: none`. |
| subdivided twice, and four times | Two depths: 2 (162 vertices, 320 faces) and 4 (2,562 vertices, 5,120 faces). |
| every pixel of the final frame is within 4 codes of the same frame with `shadow: false` | For each depth, the same document with `shadow: false` drawn in the same process. Every one of the 307,200 pixels of the `final` PNG: the largest of its R, G and B code differences is at most 4. Alpha isn't compared. The failure gives the count over 4, the count over 2 (the issue's measure), the largest difference and where. |

So that a pass can't come from frames that show nothing, each pair must also:

- show the sphere: at least 95% of the frame names `sphere` in the object-ID target (the camera is 1.04 m from the
  surface; by the pinhole the sphere fills the whole frame);
- be lit: at least a quarter of the `shadow: false` frame reads code 32 or more in some channel;
- have run the shadow pass when the sun casts: the reply's `passes` hold `scene3d.shadow` and frame 0 reports at least
  one map in `cascades.maps`.

**Guard: the comparison can see a shadow.** The same depth-2 repro with a 0.15 m `mark.box@1` (the same material)
whose centre sits 1 m toward the sun from the sphere point unit(0.15, 0.25, 1): between the sun and the sphere's
visible sunlit face, outside the camera's view. A CPU ray cast (the pinhole through the icosphere's own triangles,
then a shadow ray toward the sun against the box) marks the pixels whose hit has n·l over 0.3 and lies in the box's
shadow; those 3 px clear of the shadow's edge (24,742 px, at least 5,000 required) are judged. At least 95% of them
must differ from the `shadow: false` frame by more than 4 codes. A renderer that ignores shadows, or puts them
elsewhere, fails here, so it can't pass the main test by drawing no shadow at all.

## Not tested here

- AC2 (a flat face keeps its shadow edge where #424 put it) is regression protection held by existing suites:
  `tests/acceptance/424/redraft/section.test.ts`, `424/cutaway.test.ts`, `424/shadow-catcher.test.ts` and #422's
  cascade suites, run unchanged.
- AC3 (any moved golden, taste or pixel hash in #422, #424 or #425 is reported; #425's `TASTE.json` left for its
  owner) is a reporting duty on the implementer's PR, read from those suites' runs; no test can hold it.

## Wrong programs the test rejects

- The base: hatched stripes on the triangles near the terminator whose bias toward the sun is too small; many sunlit
  pixels differ by more than 4 codes (`BASE-FAILURE.txt`).
- A fix that turns shadows off for smooth meshes, ignores `shadow: true`, skips the shadow pass, or puts the shadow
  in the wrong place: the guard (and the `scene3d.shadow` / `cascades.maps` check).
- A renderer that draws nothing, or leaves the sphere unlit: the coverage and light checks.
- A fix for one tessellation only: both depths are judged.

## Fixture

All generated in `helpers.ts`; nothing is on disk. The icosphere's base is the standard icosahedron
(±1, ±φ, 0) and its cyclic permutations; #425's generator wasn't available, so its orientation may differ from the
issue's measurement. On the base the counts still land near the issue's:

| Depth | Over 2 codes (issue) | Over 2 codes (here) | Over 4 codes (here) | Largest (issue / here) |
|---|---|---|---|---|
| 2 | 21,081 | 21,949 | 15,825 | 33 / 31 |
| 4 | 9,615 | 9,443 | 6,059 | 22 / 20 |

The guard passes on the base: its shadows draw where the box puts them.

## Run it

It builds `deep-gpu` with cargo, so it runs alone (`scripts/lanes.mjs` lists `tests/acceptance/1297/` in `alone`).

```sh
npm ci --ignore-scripts --no-audit --no-fund    # once, if node_modules is missing
npx vitest run tests/acceptance/1297/ --testTimeout=600000
```

## What was run

- On the base `b7628337`, once: the suite as above. AC1 fails for the issue's reason, the guard passes
  (`BASE-FAILURE.txt`). tsc passes on these files with #424's `tsconfig.json` settings.
- Not run: a fixed renderer (none exists yet), or a planted program for the guard. That the guard rejects a renderer
  with no shadows is argued, not run: such a renderer draws the boxed frame like its `shadow: false` twin.
