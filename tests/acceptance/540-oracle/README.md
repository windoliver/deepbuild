# Acceptance tests for #540, Oracle lane: the upstream camera-ray and ray-triangle tests, run against our entries

Written first, blind, from four sources:

- issue #540;
- its Oracle page, `doneright/oracles/issues/540.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the three upstream files that page pins, read from the vendor copies on that branch;
- the #540 suite's surface (`tests/acceptance/540/README.md`, written by the same job) and the base commit `9b77cd2cd`.

The job never saw an implementation of #540; none existed, and no other worktree, branch or pull request was read.
#136's rule applies: a linked test counts only when run against our output, so each case here builds our documents and
asserts on the entries our point control writes. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

The page links upstream tests to criteria 2 and 3 of 11. The other nine have none (the page's "No upstream test" table)
and stay with `tests/acceptance/540/`.

## Sources

| Criteria | Upstream, pinned | File and lines | What it checks | Here |
|---|---|---|---|---|
| 2 `#540.88ffa39f`, 3 `#540.c9bfe882` | an upstream engine, `ed1daf0bf001b61586d9930840f2f1394092c079` | `tests/scene/test_camera_3d.cpp`, lines 291 to 373 | the screen ray's origin and normal for orthographic and perspective cameras at the view's centre, top left and bottom right | `camera-rays.test.ts` |
| 2 `#540.88ffa39f`, 3 `#540.c9bfe882` | the same, same commit | `tests/scene/test_camera_3d.cpp`, lines 131 to 216 | whether a position is behind the camera | `camera-rays.test.ts` (the perspective case) |
| 2 `#540.88ffa39f`, 3 `#540.c9bfe882` | the same, same commit | `tests/core/math/test_geometry_3d.cpp`, lines 152 to 157 | a ray that hits a triangle, one beside it that misses, one pointing away that must not hit | `ray-triangle.test.ts` |
| 2 `#540.88ffa39f` | another upstream engine, `12a94e0cd6b18df7a0dc2e5a202a55156d80e9a6` | its picking crate's `src/mesh_picking/ray_cast/intersections.rs`, lines 328 to 533 | a ray against one triangle at distance 1, and against a mesh with and without indices and vertex normals | `ray-triangle.test.ts` |

No upstream code is copied or run; each case is re-expressed as our documents and presses, and its expected numbers
are the upstream file's. The vendor copies hold no license file; nothing is copied, so no notice is carried.

## Re-expressed

- **The screen ray** (`camera-rays.test.ts`). Upstream's camera sits at the origin looking along −Z on a 400 × 200 view:
  orthographic with size 5 across the height (10 × 5 m), near 0.5; or perspective with 120° across the height, near
  0.5. Ours: `camera@1` at the origin aimed at (0, 0, −1) on a 400 × 200 frame, orthographic with `view_width` 10 and
  `near` 0.5, or perspective with `fov` 2 atan(2√3) ≈ 147.80° (our field of view spans the wider side; this is upstream's
  frustum: half-width 2√3 where the half-height is √3, at distance 1). A point control on a level plane and a press at
  (200, 100), (0, 0) and (400, 200) (the base's panel is a closed rectangle, so its corners are over the view). Each
  entry's stored `ray` must equal upstream's origin and normal within 1e-9: orthographic origins (0, 0, −0.5),
  (−5, 2.5, −0.5), (5, −2.5, −0.5), normal (0, 0, −1); perspective origin the eye, normals (0, 0, −1),
  normalize(−√3, √3 ÷ 2, −0.5), normalize(√3, −√3 ÷ 2, −0.5).
- **Behind the camera** (same file). Upstream: a position in front of the perspective camera isn't behind it. Ours,
  through criterion 3's rule: the perspective presses' planes are y = 1 and y = −1. The top-left ray climbs: it meets
  y = 1 at (−2, 1, −1 ÷ √3), a point in front of the camera, written as the ground point (within 1/1024 m); y = −1 only
  behind the eye, so ground none. The bottom-right ray the other way round; the level centre ray and every orthographic
  ray meet neither plane.
- **Ray and triangle** (`ray-triangle.test.ts`). Each upstream ray is a perspective camera whose eye is the ray's origin,
  aimed along its direction (fov 60° on 400 × 400), and a press at the view's centre (200, 200) casts it; the triangle
  is a one-triangle JSON glTF, the point control's `targets` and `on: surface`. The geometry test: (0, 3, 0), (−3, 0,
  0), (3, 0, 0) from (0, 1, 1) along −Z hits at (0, 1, 0); from (5, 10, 1) misses; from (0, 1, 1) along +Z must not hit.
  The picking tests: (1, −1, 2), (1, 2, −1), (1, −1, −1) from the origin along +X hits at distance 1, (1, 0, 0), as a mesh
  without indices, with u16 indices [0, 1, 2], and with vertex normals (−1, 0, 0) with and without indices. A hit writes
  hit {set 0, key [0, 0]}, the point within 1/1024 m, face 0 and the winding's unit normal; a miss writes hit and
  surface none.

## Left out, and why

- **Back-face culling** (the picking tests' culled case, the triangle wound away): our design takes a surface hit's
  normal from the winding and says nothing of culling; whether a back face draws in the object-ID target is the item's
  material, not the point control's rule.
- **Malformed index lists and an empty normal list** (the picking tests' last three cases): a glTF can't hold an empty
  normal accessor, and a mesh asset with bad indices is refused at check by the asset's own rules, not answered as a
  miss by the point control.
- **The camera tests' frustum, projection and local-ray cases**, h and v offsets, and the orthographic behind case:
  frustum culling and projected positions aren't point-control rules; our entries store world rays only; our camera's
  `shift` is not upstream's offsets; and an orthographic ray starts on the near plane, so nothing behind it is met, which
  the orthographic rays here already show.
- **Upstream's near-plane sense of "behind" for a perspective camera** (a point 0.2 m ahead of the eye with near 1):
  our perspective ray starts at the eye (Control: point), so such a point is ahead of it.

## Run

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/540-oracle --testTimeout=1800000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/540-oracle
```

`helpers.ts` re-exports the #540 suite's helpers, geometry and scene builders (`../540/`), so both lanes build and ask
the same binary the same way: `cargo build --locked --bin deep-show` once a file. **`scripts/lanes.mjs` needs
`'tests/acceptance/540-oracle/'` in its `alone` list**; the #540 README gives the line, and the implementer makes that
edit.

## The surface under test

The #540 suite's (its README: The surface under test), with nothing added: `deep_show`, `input` presses and each
entry's `hit`, `ground`, `surface` and `ray`.

## Criteria to tests

| ID | Test | Upstream | Ours |
|---|---|---|---|
| `#540.88ffa39f`, `#540.c9bfe882` | `camera-rays.test.ts` (1) | the screen ray at the centre and corners; a position not behind the camera | three views, nine presses: rays within 1e-9, ground only ahead of the eye |
| `#540.88ffa39f`, `#540.c9bfe882` | `ray-triangle.test.ts` (1) | hit, miss beside, pointing away; a ray against one triangle and a mesh with and without indices and normals | seven views, seven centre presses |
