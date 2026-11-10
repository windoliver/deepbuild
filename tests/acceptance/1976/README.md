# Acceptance tests for #1976: Hit path in 3D — the exact point a ray meets on a picked item's evaluated triangles, from the object-ID pick and a CPU ray in f64

Written first, from issue #1976 (its scope, its one acceptance criterion and its proof line), the design sections it
links and those they lean on, its oracle page, and the base commit `2df533990` ("Merge pull request #2185 …", which
holds #424's object-ID pick), by a job that never saw an implementation; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean, as
#424's suite: one file for the one criterion, two tests, the second the planted twin the criterion names.

## What was read

- Issue #1976; its dependency #424 and its siblings #1400, #1401 and #1217, for vocabulary only. The oracle page
  (`doneright/oracles/issues/1976.md` in `DeepBuildAI/deepbuild`, branch `doneright`): no upstream test checks the
  criterion ("proven by our own fixture and its planted wrong twin"). There is no `cases/1976.json`.
- `docs/canvas-primitives.md`: Selection (session state): point and ask's
  `hit: [{item, sub, point: f64[3], normal, distance}]`, "A `hit` comes from the object-ID pick, then a CPU ray on the
  evaluated triangles, never a depth reading", and the measure tool's points "never by reading depth or pixels";
  Render-back: `probes`, the reply's `hits` (up to 8 a probe, nearest first), "through the object-ID pass and a CPU ray
  on evaluated triangles, ties broken by ID"; ID and sub-address; Camera `camera@1` (`position`, `target`, `fov`
  "across the wider side", `near`, `far`).
- `docs/technical-design.md`: Render-back; Dogfooding.
- At the base: `crates/deep-gpu-layer/src/main.rs` (the `--planted` table; an unknown name is `bad_input`, exit 1),
  `crates/deep-gpu-layer/src/view3d.rs` (`clicks: [{frame, at}]` answered per frame as `{at, pick}`, the pick the
  nearest drawn ID in the (2 × margin + 1)² window of the object-ID target; the `depth` target),
  `crates/deep-scene3d-render` (`read_view_depth`: the view-axis distance at each pixel's centre from the reversed-Z f32
  depth target), `crates/deep-canvas-scene3d/src/scene.rs` (`Camera` in f64: eye, right, up, forward, focal
  (wider ÷ 2) ÷ tan(fov ÷ 2); `mesh.asset@1` read from a JSON glTF and placed by its `at`), `crates/deep-canvas`'s
  `screen_basis` (right = forward × +Y, up = right × forward), only to learn what a fixture can hold and how a pose maps
  a pixel to a ray; and `tests/acceptance/424/` (README, helpers.ts, picks.test.ts, pick-margin.test.ts,
  per-pixel.test.ts) for conventions.

## What the base already does, which this test doesn't credit

A `view3d` click names the item drawn under it (#424's pick); the evaluated camera and meshes are f64 on the CPU; a
`depth` target reads the view-axis depth at each pixel's centre. There is no hit list on a click's answer, no CPU ray
against an item's triangles reachable from `view3d`, and no `hit_from_depth`.

## Run it

It builds `deep-gpu` with cargo, as #424's suite does, so it runs alone. `scripts/lanes.mjs` needs
`'tests/acceptance/1976/'` added to its `alone` list, beside `tests/acceptance/424/`; this README is the instruction,
the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1976 --no-file-parallelism --testTimeout=600000 hit-path.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/1976/tsconfig.json
```

Cargo may need `/opt/homebrew/opt/rustup/bin` on `PATH`. The issue runs on any GPU machine; this suite reads the pick
through the base's GPU layer, which draws on macOS's Metal device, so off macOS each test fails with a message starting
`INCONCLUSIVE:`, never passes. Nothing is gated on power or load. A run with `--root` may leave Vitest's cache in
`tests/acceptance/1976/node_modules/.vite`; delete it.

## Criterion to test

The ID is the first 8 hex digits of SHA-256 of the criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped (`criterionId` in `scripts/proof-change.mjs`). Each test's name starts with `AC1 #1976.aa8721f3`.

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#1976.aa8721f3` | `hit-path.test.ts` (2) | 200 seeded clicks, 100 on a plane and 100 on a sphere, each meeting its item 10 to 400 m from the eye over seven poses: every click's first hit names the item and its `point` lies within 1e-5 m of the ray's analytic intersection. `--planted hit_from_depth` fails, the check naming the first ray (in seeded order) placed more than 1 mm off |

The file's header states the fixture, the numbers and the wrong programs in full.

## Assumed surfaces

The issue names the hit's shape and that the object-ID pick (#424) names the item, but not the call that returns it;
#1400 carries it on point and ask and #1401 on render-back, neither of which exists yet. This job's choice is the base's
own pick, `view3d`'s clicks, with the field Selection (session state) names for a 3D point's hits. The implementer
provides exactly these.

1. **`view3d`'s click answers gain `hit`**: each entry of a frame's `clicks` (base: `{at, pick}`) also carries
   `hit: [{item, sub, point: f64[3], normal, distance}]`, nearest first, ties by ID: the item the object-ID pick names,
   met by the ray from the presented pose's eye through the click's `at` (view px, x right, y down, pixel (x, y)'s
   centre at (x + 0.5, y + 0.5)), intersected on the CPU in f64 with that item's evaluated triangles. `point` is in the
   document's world frame, in m. Only the first hit's `item` and `point` are read.
2. **Planted program**, reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
   `crates/deep-gpu-layer/src/main.rs`:

| Name | The wrong program | Criterion |
|---|---|---|
| `hit_from_depth` | Each click's hit is placed where the click's ray reaches the view-axis depth the depth target holds at the clicked pixel (the base's `depth` target reading at `⌊at⌋`), never a CPU ray on the triangles; the item and the rest as the real path | AC1 (named) |

The fixture uses only what the base reads: `camera@1` with `position`, `target`, `fov`, `near` and `far`, `sky@1`,
`material@1` unlit, and `mesh.asset@1` (`params: {sha256, node: 0}`, a JSON glTF given through the call's `assets`).

## The analytic intersection

For the plane it is the ray's intersection with y = 0; the plane's two triangles have whole-number corners at y = 0, so
they are that plane exactly and the two readings of "analytic" (the closed form of the shape, or of its triangles)
agree.

For the sphere it is the ray's nearest intersection with the analytic sphere of radius 1/32 m about (0.5, 1.25,
−0.75), computed in f64 from the closest approach, so nothing cancels at 400 m. The drawn sphere is evaluated
triangles, which a correct hit path meets, and they differ from a sphere by the tessellation's sagitta; so the fixture
is made fine enough that the two coincide well inside the bound: a UV sphere of 512 segments by 256 rings, its vertices
on the sphere, and clicks within 55° of the normal. The test checks this on the f32 positions it wrote, placed in f64:
along every sphere ray the triangles lie within 2e-6 m of the analytic sphere (1.45e-6 m at most here). The 1e-5 m
bound then holds for a hit on the evaluated triangles in f64 with 8e-6 m to spare, whichever reading one takes, and
fails for a point read back from the clicked pixel's depth, a ray in f32 (f32 resolves about 2.4e-5 m at 400 m), a ray through the pixel's
centre, the far side first, or a point in the item's own frame. A 1/32 m sphere keeps the mesh at 261,120 triangles
(a 6.3 MB glTF); the poses' fields of view (0.71° at 10 m down to 0.018° at 400 m) frame it at 80 px radius.

## Why the planted reader must fail

The depth target holds one depth per pixel, sampled at its centre. Every click is at a seeded sub-pixel point, so its
ray meets the surface at a depth the target does not hold. On the plane seen from 6 m up, that depth changes by about
7 cm a pixel row at 12 m, the plane's nearest ray, and by about 90 m a row at 398 m, its farthest, so a reader of the clicked pixel's depth is off by
more than 1 mm on every one of the 100 plane rays, the least by 1.7 mm (the test computes this from the analytic depth
at each pixel's centre and requires it on at least 50 rays before it runs the plant). On the sphere, framed at 80 px
radius, a pixel spans 0.4 mm of surface, so the same reader is off by up to 0.3 mm there: past 1e-5 m on 87 of the 100
sphere rays but under 1 mm. A cleverer reader (interpolating depth between pixel centres) is not the planted program;
it would still be off past 1e-5 m on the plane at 400 m, where f32 depth alone resolves about 2.4e-5 m.

## Readings where the issue and design leave a choice

- **"Rays through the view"** are clicks inside the 320 × 240 frame, at least 2 px from its edge, each ray from the
  presented pose's eye through the click's `at` exactly, not the pixel's centre; every ray within 2 px of it meets the
  same item first, so the pick (with its 3 px margin) names the item the ray meets.
- **"At 10 m to 400 m"** is the distance from the eye to the ray's intersection: every ray is between 10 and 400 m,
  the sphere's from 10.03 to 399.98 m, the plane's from 12.0 to 397.6 m.
- **"Each placed point"** is the first (nearest) hit's `point`, which must also name the item the ray meets.
- **"Naming the first ray off by more than 1 mm"**: the check's failure line for the first ray, in seeded order (the
  plane poses' 100, then the sphere poses' 100), whose placed point is more than 1 mm from its analytic intersection,
  giving its index, pose, click, item and the distance.
- **Seeded**: seed 1976 for the sphere poses' azimuth and elevation and every click; clicks are multiples of 1/1024 px
  and pose values are f32 numbers, so a reader in f32 or f64 sees the same pose.

Not tested, because the criterion doesn't ask: the values of `sub`, `normal` and `distance`, hits after the first, ties
by ID, `geo`, a sky click, probes on render-back (#1401), point and ask's `hit` (#1400) and the measure tool (#1217).

## Fixtures

None on disk: the two glTFs, the seven documents and the 200 clicks are generated in `hit-path.test.ts`.
