# Acceptance tests for #426: 3D backgrounds — the environment's background, an HDR backdrop on its own ground, and background fog

Written first, from issue #426 (its scope, its five acceptance criteria, its proof line and its "Also" line), `docs/technical-design.md`
and `docs/canvas-primitives.md` (Builders, recipes, looks and cameras; Sky `sky@1` and Sky `sky@1`: environment; Material: shadow catcher;
Volume `volume@1` for the froxel grid), and the repo at the current commit, by a blind job: the expected values come from the issue and the
design only. `crates/deep-scene3d-render` and `crates/deep-canvas-scene3d` were read for the call surface and the equirectangular and RGBE
conventions only (Assumed surfaces 1 and 2), never to decide an expected value. The sibling suites `tests/acceptance/422` and `424` are the
models for layout (their helpers are copied in part, as suites don't import each other). The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/426 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/426/tsconfig.json
```

Each file builds `deep-gpu` (`cargo build --locked --bin deep-gpu`), so they run one file at a time; `scripts/lanes.mjs` needs
`'tests/acceptance/426/'` added to its `alone` list, beside `tests/acceptance/422/` (the implementer makes that edit). Every test draws on
macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes. `taste.test.ts` writes into
`target/acceptance/426/` and keeps what it writes; every other test writes into its own temporary folder and deletes it. The issue states
no frame-time budget, so nothing here needs a reference Mac. A run with `--root` may leave Vitest's cache in
`tests/acceptance/426/node_modules/.vite`; delete it.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text as the issue states it (the number and the dot dropped), trimmed,
whitespace collapsed. Each test's name starts with `AC<n> #426.<id>`.

| ID | Criterion (short) | File (tests) and what it asserts |
|---|---|---|
| AC1 `#426.354a52a7` | Studio environment + dark gradient: background = the gradient within 1 code while reflections show the studio; HDR environment with no background set shows the HDR at its rotation | `environment-background.test.ts` (2). (1) The chrome-ball product fixture: a uniform gradient reads its color's code within 1 on every background pixel; a real gradient equals the same document with no environment within 1 code on every background pixel (and isn't flat); the ball's pixels differ by 8+ codes from the no-environment frame on 50%+ (the studio reflects); `background: environment` leaves the ball within 1 code but draws the studio behind it. Planted: `background: environment`, run through the same judge, fails naming a pixel. (2) The grid HDR as the environment, no `background` field, a camera pitched 45° down: every pixel 0.8° from a cell edge reads its cell's flat color within 1 code at rotation 0, 90° and 37°; rotation 90° changes 80%+ of the pixels |
| AC2 `#426.f893b6e0` | HDR backdrop on its own ground: the pixel where (2, 0, 1) projects shows the cell holding (2, −1.7, 1) within 1 code from (0, 1.5, 5) and from (3, 1, 4), same hash seeked or played, planted dome above the camera fails naming the pixel; 0.5 m box under a 45° sun over a catcher leaves the floor in shadow at value × (1 − alpha) within 1 code, a click on the floor picks nothing, planted draw order shows no shadow | `redraft/ground.test.ts` (3), the blind redraft swapped in at the owner's word (Nov 7, 2026); the original `backdrop-ground.test.ts` is removed. The dispute: the original judged its catcher core at a fixed alpha of 0.25, while the criterion reads "× (1 − the catcher's alpha)"; beside the box the key sun's cascaded shadow lets light through (alpha 0.18 at 3 cm), which fails 2 core pixels without any fault in the backdrop. The redraft passes on the base and on the work; see `redraft/README.md` for what it asserts |
| AC3 `#426.c90d2152` | `background_blur: 0.5`: background = the prefiltered cube's roughness 0.5 mip within 1 code; every opaque product pixel byte-equal to the frame at blur 0; planted blur that feeds the lighting fails | `background-blur.test.ts` (2). (1) A two-level horizon HDR: every background pixel within 1 code of a GGX split-sum prefilter by quadrature at roughness 0.5; the filter-independent mirror identity (rows y and 359 − y sum to upper + lower in linear within 1/255); blur 0 sharp at 3° above the horizon, blur 0.5 4+ codes off. (2) Ball pixels (every pixel within 2 px on the ball, 8,000+) byte-equal in the final and linear targets at blur 0.5 and 0, the background moved. Planted blur that relights: the same scene drawn by the renderer with the HDR pre-blurred on the CPU (lighting and background both softened) differs on 1,000+ ball pixels and fails the same judge naming a pixel |
| AC4 `#426.46bdf631` | Fog takes the background's color: near sphere (50 m, 10° above) reads mix(c, red, 1 − e^−1), far sphere (1,000 m) matches the background beside it, below the horizon both blue, planted mean-color fog fails naming the pixel | `background-fog.test.ts` (2, the second for the "Also" line). (1) Both scenes (+10° and −10°), each drawn with `fog_density` 0.02 and 0: near centre pixel = mix(c, B, 1 − e^−1) within 1 code of the linear target (1/255), far centre pixel = the background pixel beside it within 1 code, that pixel = B. Fixture checks: ray-sphere distances 50 m and 1,000 m, c 8+ codes from B. Planted mean-color fog (CPU-side): fails both the near and the far pixel naming them. (2) `fog: background` with `froxels` is refused (a `code`, the text names `sky`); a fog color with `froxels`, and background fog without them, are drawn |
| AC5 `#426.45886847` | Screenshots of the four fixtures attached; one recorded taste call, else INCONCLUSIVE | `taste.test.ts` (1): writes `product-gradient.png`, `backdrop-ground.png`, `blurred-background.png`, `background-fog.png` from this run's final targets to `target/acceptance/426/` and reads `TASTE.json`: absent or made on other SHA-256s is INCONCLUSIVE, `looks_wrong` fails, `looks_right` on exactly these passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

The "Proof" line ("the backdrop grid and background fog fixtures read back within one code value, seeked and played") is AC2's redraft (the grid
fixture, seeked and played, with the camera moving) and AC4's first test (the fog fixture, read back within one code). The fog fixture is static, so
"seeked" for it is the same frame by construction; AC2's redraft's seek check covers the property on a moving fixture. If the implementer wants the fog
fixture's seek check too it needs a criterion line saying what moves.

## Assumed surfaces

The issue and design name the behaviors, the sky's fields (`environment`, `background`, `background_blur`, `background_ground`, `fog`,
`fog_density`, `fog_curve`, `froxels`) and the refusal, but not these calls; each is this job's choice. The implementer provides exactly these, or
disputes them through a blind redraft.

1. **HDR assets** are Radiance RGBE files, `#?RADIANCE`, `-Y h +X w`, flat scanlines, a channel's value m × 2^(e − 136), handed to `view3d`
   in `assets: {sha256: path}` and named by `environment.from` (the base's reader). The suite writes its own HDRs (720 × 360) with e = 128, so
   every value is m ÷ 256 exactly, and the CPU references read those very numbers. No `licenses` entry is passed (the base's sky reader doesn't
   read one).
2. **The equirectangular lookup**: u = atan2(x, −z) ÷ 2π + 0.5, v = acos(y) ÷ π from the zenith (the base's own). **Rotation** turns the
   environment about +Y, right-handed, by `rotation` degrees, so the background at direction d shows the HDR at R_y(−rotation)·d with
   R_y(θ)(x, z) = (x cos θ + z sin θ, −x sin θ + z cos θ). The design doesn't give the sign; this suite does.
3. **Tone map none at exposure scale 1** is the base's acceptance look (#378, #421): the final target is the sRGB encoding of the linear target.
   "Within 1 code value on linear targets" (AC4) is read as 1/255 of the linear value.
4. **The prefiltered cube's roughness 0.5 mip** (AC3) has no CPU-readable form in the issue. The suite reads it as the design's GGX prefilter in
   its split-sum form (n = v = r, α = roughness², weight D(h)·(n·l); the design says "by GGX with bounded VNDF sampling"), computed by quadrature
   for a two-level horizon HDR, where the lobe's share above the horizon is a closed one-dimensional integral (`helpers.ts`: `upperShare`).
   Because that is this job's reading of the filter, the test also holds the blurred background to an identity that no GGX weighting can break: the
   horizon splits the lobe in two equal halves and mirrors it, so the pixels at elevation ±δ sum to upper + lower. If the implementation's filter
   is a legitimate different weighting, the quadrature reference is what a blind redraft decides; the tolerance is the issue's, 1 code.
5. **No planted renderer flags.** The brief for this job is not to invent `deep-gpu --planted` names, so each planted program is a reference the
   correct output satisfies and the planted one fails, run through the same pixel judge as the real check:
   - AC1: `background: environment` is a real mode of the sky; its frame is the wrong program's output for the gradient check.
   - AC2: the dome above the camera and the backdrop drawn after the catcher are CPU-side: the pixel value that program would draw (another cell, from
     `plantedBackdropDir`; the floor's unshadowed value) goes through `judgePixel`, which fails naming the pixel. The test also asserts the planted
     value differs from the right one (4+ codes on the headline pixel, on 90%+ of the judged pixels for the dome), so the judge can see it.
   - AC3: the planted blur that feeds the lighting is drawn by the renderer itself: the same document with the HDR replaced by its CPU-blurred version
     (lighting and background both). It needs no flag, only HDR environments, which the base reads.
   - AC4: a fog of the environment's mean color is CPU-side, as AC2's.
   An implementer who adds renderer-side planted names for these is free to; no test here needs them.
6. **A click** is `clicks: [{frame, at: [x, y]}]` answered `{at, pick}` per frame (base); a pick of `null` is "nothing". The ID target gets 0 where
   nothing draws. The projected floor "takes no pick" is tested in the document with no catcher (the catcher is itself an item and picks as
   one).
7. **Each `view3d` call is a clean session**: `from: n` opens a fresh session at frame n (a seek) and every patch up to n applies (base). The camera
   moves by channels on `items/cam/params/position/<i>`, linear between keys at 0 s and 1 s, the camera at frame n (10 fps) at n ÷ 10 s.
8. **A refusal** is a `view3d` reply with a string `code` and no `frames`, its other fields naming the sky as the word `sky` (the sky item's ID in
   the fixture). The code's name is not fixed here. The refusal fixture sets `budget: {class: "showpiece"}` so a class that refuses volumes
   isn't the cause; its two controls (a fog color with `froxels`, background fog without) must be drawn.
9. **`taste.test.ts`'s record**, `tests/acceptance/426/TASTE.json`, the one file anyone adds to this folder after this commit and only to record the
   owner's answer: `{"issue": 426, "criterion": "#426.45886847", "verdict": "looks_right" | "looks_wrong", "who", "when": ISO 8601,
   "screenshots": {name → sha256 for the four PNGs}, "note"?}`.

## Readings where the issue and design leave a choice

- **"The product fixture"** (AC1, AC5): a chrome ball (metallic 1, roughness 0.15, radius 0.5) at (0, 0.5, 0) on a stage with no light item, 320 × 240.
- **"The gradient's" pixels** (AC1): the design gives a gradient but not its shape between `top` and `low`, so the equality is judged against two
  references that need no shape: a gradient whose ends are equal, and the same document drawn with no environment (the sky's own fields drawing the
  background, which is what the criterion says is the gradient).
- **"A grid of flat 10° cells"** (AC2): 36 columns × 9 rows below the horizon, each one of 324 lattice colors (levels at codes 70 to 190 in steps of
  20 per channel, scrambled), checked here to be 4+ codes apart pairwise. The upper half is one dark flat color. Pixels within 0.8° of arc of a cell
  edge are left out, since the cube's filtering blends there.
- **The backdrop fixture's camera** (AC2) has fov 60 across the wider side of 480 × 360: at fov 40 the point (2, 0, 1) projects outside the frame from (0, 1.5, 5).
- **"The catcher's alpha"** (AC2): 0.25, set by the lights: a casting key sun at 45° giving the floor π·K lx, a non-casting fill straight down giving
  3π·K lx, K = 100. The environment's own light on the floor (a few lx at most, the upper half dark) moves the alpha by under 0.002 of it, under 0.2
  of a code. The shadow falls toward −Z, seen from (0, 6, −6) (the criterion fixes no camera for the catcher; #424's fixture's); its core is |x| ≤ 0.1 m, z in [−0.6, −0.4] m (0.15 m in from the shadow's edges at x = ±0.25, z = −0.25 and −0.75, as #424's core is).
- **"Every pixel an opaque product covers at every MSAA sample"** (AC3): the harness reads resolved pixels and no per-sample coverage, so this is
  read as every pixel the ID target gives the product with every pixel within 2 px also on it (a pixel whose samples all land on the product);
  rim pixels, where some samples see the background, are left out.
- **"Seeked or played"** (AC2): the frame's final PNG pixel hash and its linear target's file name (a hash of the f32 pixels) are equal between the
  played run's frame and a fresh process's seek to that frame.
- **"A small sphere … 50 m from the eye"** (AC4): the eye is the camera at the origin; the sphere's centre pixel is the centre pixel of a 321 × 241
  frame aimed at the sphere, and the ray-sphere distance there is checked.
- **c** (AC4) is the same sphere in the same scene drawn with `fog_density: 0`.
- **The far sphere "beside it"** is 6° to the right at the same elevation; "the background pixel next to it" is the pixel 10° to the right of the aim.

Not tested, because no criterion asks: `background: sky` and `video` modes, `environment.mix` and `sun_from` with a backdrop, the backdrop's refusal when the
background doesn't show the environment, `background_ground` at other heights or radii, the dome's rim (above `radius`), blur values other than 0 and 0.5
beyond the planted one, height fog with `fog: background`, fog on see-through parts, a backdrop's cost, and shadows of the product on the
backdrop's floor without a catcher.
