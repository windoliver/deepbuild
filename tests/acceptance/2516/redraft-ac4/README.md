# #2516 AC4: blind redraft of the cube criterion and its CPU reference's qualification

Written blind from `../issue.json` (issue #2516 in full), AGENTS.md, `docs/technical-design.md` (How we know version 0
works: Dogfooding, Wrong programs, the parity suite's CPU-reference rule) and `docs/canvas-primitives.md` (Look
`look@1`: ao; Material) at base commit **`1c4d1f0e2aaad8c6a6573848823566d04ff73d17`**. I saw no other draft, report,
dispute or implementation. The implementing agent doesn't edit these files.

**Criterion (AC4, verbatim):** "On the cube fixture at radius 0.5 m the reading on the floor 5 and 10 cm in front of
the middle of a face is within 0.1 of a CPU reference in f64 of 4,096 cosine-weighted rays out to the radius (0.68 and
0.81), from a camera facing that face and from one 90° around it. The 0.1 is drafted until the first run. A planted
loop that puts every one of main's points at the full radius passes the wall fixture, reads above 0.99 here and
fails, naming the camera"

The tests name `AC4` and no criterion ID, so the closed-issue sweep reads them by number (design: Closed issues stay
proven).

## Commands

```sh
# CPU qualification: no GPU, no build
npx vitest run tests/acceptance/2516/redraft-ac4/reference.test.ts
# GPU: on the reference Mac, under the GPU lease (the local preflight holds it)
npx vitest run tests/acceptance/2516/redraft-ac4/cube.test.ts
# typecheck
npx tsc -p tests/acceptance/2516/redraft-ac4/tsconfig.json
```

## Files

- `reference.ts`: the CPU reference, the closed forms, the issue's stated values and the planted reference twins.
- `reference.test.ts`: the reference's qualification. It needs no GPU.
- `fixtures.ts`: the literal documents, the `deep-gpu run` wrapper (BLOCKED/INCONCLUSIVE handling) and the reading.
- `cube.test.ts`: the GPU tests.

## The surface under test

`deep-gpu run [--planted <name>]` with #378's `view3d` call (`targets: ["linear", "ids"]`). It takes `look@1`'s `ao`
(`radius`, `strength`, `samples`, `resolution`, `multi_bounce`, `specular`) and the `sky@1`, `material@1` and
`camera@1` kinds. The following are reused unchanged from the base: `tests/acceptance/418/helpers.ts` (`useGpuBin`,
`useOut`, `look`, `solid`, `frameAt`, `readIds`, `readTarget`, `texel`, `luma`, `answered`) and
`tests/acceptance/379/helpers.ts` (`requireReferenceMac`). I added no product code.

## Fixtures (the issue's Scope)

All fixtures are under uniform ambient: a `sky@1` with `ambient_top` = `ambient_low` = 0.6, and no lights. The look
is #418's physical look (tone map none, exposure scale 1, finish at identity), with `ao` set to radius 0.5, strength 1,
`multi_bounce: false` and `specular: false`. The floor material has `metallic: 0` and `specular_level: 0`, so it has
no specular share. y is up and the floor's top is at y = 0.

- **Cube:** 0.2 m on a side on an 8 m floor, centred at x = z = 0. The face read is the one at z = +0.1. Size 960 × 720.
  The perspective cameras have fov 40, target (0, 0.05, 0.15), elevation 40° and distance 2.4 m: **"facing the face"**
  at azimuth 0° and **"90° around it"** at azimuth 90°.
- **Wall** (used only to show the planted loop passes it): 20 m long, 4 m high, face at z = 0, on a 24 m floor. Size
  1280 × 960. Target (0, 0.2, 0.3), elevation 50°, distance 8 m: **"facing the wall"** at azimuth 0° and **"30°
  around it"** at azimuth 30° (AC1's second camera).
- **The radius neighbourhood:** each fixture's locator frame draws corner markers just outside every surface within
  0.5 m of a read point. For the cube that is the floor over x ∈ [−0.55, 0.55], z ∈ [−0.355, 0.705]. For the wall it
  is the floor over x ∈ [−2.5, 2.5], z ∈ [0, 0.915] and the wall up to 0.5 m. Each corner must be in the ID target,
  or the test fails, naming the marker.

## The reading

Each camera gets three kinds of frame in one run:

1. A **locator** frame: the fixture plus flat markers 1 mm thick, with ao none.
2. The plain fixture with **`ao: none`**.
3. The plain fixture with **ao on**, at each of 8 and 16 samples × half and full resolution.

The pixels of a band are the ones the locator's ID target gives to that band's marker. Each must read `floor` in the
plain frame, and each band must cover at least 20 px. The reading is Σ linear luma with ao on ÷ Σ linear luma with ao
none over those pixels, which is the floor's radiance over the same frame with `ao: none`, as the issue defines it.

- **Cube bands:** the middle 10 cm of the face (x ∈ [−0.05, 0.05]), 1 cm deep, centred 5 cm and 10 cm in front of it.
- **Wall bands:** 4 m along the wall, 3 cm deep, at 5, 10, 15, 20, 30 and 40 cm.

## The CPU reference (`reference.ts`)

The reference is written in f64. From a floor point it casts 4,096 cosine-weighted directions and counts a ray as
blocked when it meets an occluder box within the radius (slab test, t ∈ [0, 0.5]). The floor is never an occluder.

The directions come from a golden-ratio lattice, ((i + ½)/N, frac(i·0.618…)), mapped by Malley's method: a uniform
disk point at radius √s, lifted so that cos θ = √(1 − s). I used this deterministic lattice rather than a random draw
or a square grid. A square grid on the concentric map lines up with the slab's circular boundary and is off by 0.016.

The value compared to the GPU is the mean over 5 × 3 cell centres of the same band the GPU reads.

## Qualification (`reference.test.ts`, no GPU)

The reference has to reproduce each row below within **0.01**. Each expected value is stated by the issue or derived
independently of the ray cast.

| Fixture | Expected |
|---|---|
| Wall at 5, 10, 15, 20, 30, 40 cm (AC1) | 0.564, 0.626, 0.688, 0.748, 0.858, 0.948 |
| Wall at 60 cm and 1 m (AC2) | exactly 1 |
| Slab at 0.25 m and 0.375 m (AC3) | 0.25, 0.5625 |
| Cube at 5 and 10 cm, point (AC4) | 0.68, 0.81 |
| Cube, the face's closed form | 0.6824, 0.8099 |
| Cube band, the closed form averaged | ≈ 0.691, ≈ 0.816 (my hand estimate; the test prints the exact value) |

The face's closed form is my own derivation by Lambert's contour integral. It is the form factor of a 0.2 × 0.2 face
seen from a floor point d in front of it, offset x₀ along it:

1 − [atan((a−x₀)/d) + atan((a+x₀)/d) − d/ρ · (atan((a−x₀)/ρ) + atan((a+x₀)/ρ))] ÷ 2π, with a = 0.1 and ρ = √(d² + 0.04).

It holds because every corner of the face lies within the radius, at most 0.27 m away. The test also checks this
formula against the issue's 0.68 and 0.81 (within 0.005), and checks the wall and slab forms against the issue's
values.

**Planted twins of the reference.** Each must fail the qualification, naming its fixture:

- `uniform_twin` weights its directions evenly. It reads 0.5 on the slab at 0.25 m and fails there.
- `uncut_twin` lets rays run past the radius. It fails the wall at 40 cm.

`cube.test.ts` runs the qualification first. If the reference has not qualified, the comparison is only a reading and
the test fails.

## Expected values and proof mapping

| AC4 clause | Test | Expected |
|---|---|---|
| "a CPU reference in f64 of 4,096 cosine-weighted rays out to the radius (0.68 and 0.81)" | `reference.test.ts`, all five tests | the qualification rows above; both twins fail |
| "the reading … 5 and 10 cm … within 0.1 of a CPU reference … from a camera facing that face and from one 90° around it" | `cube.test.ts` test 1 | all 16 readings (2 cameras × 4 settings × 2 distances) within 0.1 of the band reference |
| "A planted loop that puts every one of main's points at the full radius … reads above 0.99 here and fails, naming the camera" | `cube.test.ts` test 2 | at least one reading > 0.99; the same check fails; the failures name the camera |
| "… passes the wall fixture" | `cube.test.ts` test 3 | all 48 wall readings within 0.05 of AC1's closed forms |
| Fails before | base `deep-gpu` | Test 1 should fail: the issue's model of main's loop reads 0.82–0.84 at a wall's foot where the closed form is 0.63, and the cube's occluder is smaller. Tests 2 and 3 read BLOCKED, because the base has no planted program by that name. |

## Verdict words

- **No GPU** (`deep-gpu` answers `no_device`): BLOCKED.
- **Another machine** (not Mac15,7 or Mac15,12, or not macOS): INCONCLUSIVE, via #379's `requireReferenceMac`.
- **A `unsupported_platform` reply:** INCONCLUSIVE.
- **The planted name missing from `deep-gpu`:** BLOCKED.

None of these ever passes.

## Drafting choices

These are stated here rather than applied silently. None of them changes an expected value from the issue.

- **Settings.** The criterion names only the cameras. The Proof line says "the cube's reference at every setting", so
  every reading is taken at 8/16 samples × half/full resolution.
- **Band reference.** The GPU is compared to the reference averaged over the same band. That average is about 0.691 and
  0.816, against point values of 0.68 and 0.81, a difference of under 0.01. The point values are what qualify against
  the issue.
- **Qualification bound.** 0.01, a tenth of the criterion's 0.1. The issue states no bound for the reference itself.
- **"Reads above 0.99".** Asserted as at least one twin reading above 0.99. The issue's figure comes from a CPU model,
  not a GPU run, so I did not require every reading to exceed it.
- **"Passes the wall fixture".** Held at AC1's bound of 0.05, from AC1's two cameras, at all four settings.
- **Marker depth and slab thickness.** Marker depths are 1 cm (cube) and 3 cm (wall). The slab's thickness is 0.1 m in
  the reference only; the issue doesn't state it, and it doesn't matter for rays cut at 0.5 m.

## Proposed missing public surface

- **`deep-gpu run --planted ao_points_at_radius`**: main's occlusion loop (`ao.wgsl` at this base) with `len = radius`
  for every point in place of `radius × mix(0.15, 1, k²)`. It should be reachable only through `--planted`. The
  implementer adds it; until then tests 2 and 3 read BLOCKED.

## Unrun

Nothing here has been run, typechecked or linted. The job had no shell. In particular:

- the qualification's numbers (hand estimates only: wall forms verified by hand to ≤ 0.0005 of the issue's values;
  cube closed form 0.6824 / 0.8099);
- the cameras' framing and band pixel counts;
- the base `deep-gpu`'s acceptance of these documents;
- the base run's expected failure.
