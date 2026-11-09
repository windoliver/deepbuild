# Acceptance tests for #481: Skin and wax — a subsurface lobe spread by a diffusion profile

Written first, from issue #481 (its scope, its Fields block for Material: subsurface with its "It can never" line, its
four acceptance criteria and its proof line), the design sections it links and those they lean on, its oracle page,
and the base commit `dd83ac2f` ("Merge pull request #1692 …"), by a job that never saw an implementation; none existed.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). Lean: one file per criterion, at most two tests each, plus exactly the planted wrong program a
criterion names and one mutant where a check could otherwise pass on the base.

## What was read

- Issue #481 and its oracle page (`doneright/oracles/issues/481.md` in `DeepBuildAI/deepbuild`): an upstream test for
  criterion 1 only, Blender's `tests/files/render/sss/subsurface_burley.blend` with its Cycles and EEVEE renders and the
  render-test runners, at blender `0a18557098`; none for 2–4. **Ported as a pattern, not run:** the `.blend` scene and
  its stored renders need Blender, and they judge Cycles' and EEVEE's output, not ours. What is ported is what the
  page says the test holds: Christensen–Burley's profile spreading each channel by its own mean free path, judged
  against a reference of the same profile. Our reference is a CPU one (`reference.ts`), run on our own output; the 1 cm
  slab, the 5% band at 20 points and weight 0's byte equality are the issue's own, as the page says.
- `docs/technical-design.md`: Subsurface and hair; Path-traced finals (the random walk is not this suite's: no criterion
  names it); Dogfooding; the taste call and "Shown to you". No criterion has a timing, so the budgets and the reference
  Macs aren't used.
- `docs/canvas-primitives.md`: Material (the lobes, the compensation, translucency's thin and wrap, `shadow`), Material:
  subsurface (the field, its semantics: the lit diffuse spread by Christensen and Burley's profile for `radius`, 16 fixed
  taps rotated by a pixel hash and scaled by depth, only over pixels of the same material; thin light from the
  thickness the light's shadow map measures as exp(−d ÷ radius); the share taken from the diffuse; wrap as the
  fallback), Light and the light policy (the key sun, `light.area@1`'s `shape` and `size`), Light policy: cascades,
  Light: light function (not in the base, so not used for the line of light), Look `look@1`: tone mapping.
- At the base: `crates/deep-gpu-layer` (`main.rs`'s calls and `Planted` table, which `--planted` parses or refuses
  `bad_input`; `view3d.rs`: its fields and targets `final | linear | ids | …`), `crates/deep-canvas-scene3d/src/light.rs`
  (`material@1`'s fields and #428's `lobes`, which read sheen, translucency and the rest and ignore a field they don't
  know; `light.area@1`'s `size`, `shape`, `power`, `range`), `crates/deep-canvas-scene3d/src/scene.rs` (a light shines
  along its local −Z), `crates/deep-scene3d-render/src/scene3d.wgsl` (`extra_lobes`' diffuse with thin and wrap
  translucency, `area_irradiance`'s exact polygon irradiance, `direct`'s key-sun shadow share), `src/shadow.rs` (the
  key light's 2048-texel depth map), and the suites `tests/acceptance/428/`, `422/` and `166/` (the closest first: the
  harness, the furnace, the taste call), `tests/scene3d-shading.test.ts` (an area light in use).

## What the base already does, which these tests don't credit

`view3d` draws scene3d documents into final, linear and ID targets; `material@1` has #428's lobes, wrap and thin
translucency among them; `light.area@1` lights by Lambert's exact polygon formula; the key sun casts shadows from its
depth map; #422's white furnace reads 1 in its background and keeps a white dielectric at or under 1. There is no
`subsurface`: `material@1` ignores the field, so a part with it draws exactly as one without it, at any weight. No
thickness is read from a shadow map, and no planted name of this suite's is in `Planted`.

## Run them

They build `deep-gpu` (`cargo build --locked --bin deep-gpu`, adding the pinned toolchain's `bin` to PATH when it is
installed, as #166's suite does), as #421's to #428's suites do, so they run one file at a time.
`scripts/lanes.mjs` needs `'tests/acceptance/481/'` added to its `alone` list, beside `'tests/acceptance/428/'`; this
README is the instruction, the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/481 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/481/tsconfig.json
```

Every test draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes.
Nothing needs a reference Mac or the network. `taste.test.ts` writes into `target/acceptance/481/` and keeps what it
writes; every other test writes into its own temporary folder and deletes it. `reference.ts` imports no vitest, so it
runs on its own (BASE-FAILURE.txt).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped (`scripts/proof-change.mjs: criterionId`). Each test's name starts with `AC<n> #481.<id>`.

| ID | Criterion (short) | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#481.79c5d9ee` | A 1 cm slab, red mean free path 5 mm and green 1 mm, under a thin line of light: red spreads to the profile's width within 5% of a CPU reference at 20 points, green less; weight 0 byte for byte as no lobe | `spread.test.ts` (2). 1: the slab (40 cm square, white, no specular) seen straight on at 0.2 mm a pixel, under a `light.area@1` 0.2 mm × 0.4 m strip 1 mm in front of it, drawn without the lobe (the line's lit diffuse D, whose half-share width must be under 1 mm) and with `subsurface: {weight: 1, color: white, radius: [0.005, 0.001, 0.001], thin: false}`; each frame's columns averaged over the central 200 rows; at the 20 shares 0.10, 0.14 … 0.86, red's width within 5% of the width of D convolved with the profile's line-spread function (`reference.ts`), green's width under red's. 2: at 400 × 400, weight 0's final PNG and linear target have the field-less frame's SHA-256s; weight 1's linear target doesn't. Catches: the base (no spread: red's width is D's, 82–91% short; green equals red); a profile other than the published one or another scaling; a sampler that misses the profile's peak or tail; channels swapped or one radius for all; a lobe that changes the frame at weight 0 |
| AC2 `#481.350e172c` | A white furnace with subsurface at full weight stays at or under 1 at every angle; a skin sphere before a white wall puts no red on the wall, where a pass that blurs across parts does | `furnace-wall.test.ts` (2). 1: #422's furnace; white parts at weight 1, a 5 cm ball at skin's and at wax's mean free paths and a 1 cm slab turned 0°, 45° and 75°; the background 1 within 1%, no part pixel above 1.01 in any channel, each part's mean at least 0.5; `--planted subsurface_adds_to_diffuse` fails it naming `ball_skin`. 2: a skin ball (defaults) 1 cm before a white wall under one sun, drawn with the lobe and without; on every wall pixel 2 px from any other part in both ID targets, Δ(R − G) at most 0.2% of the wall's mean luminance; at least 2,000 such pixels within 40 px of the ball; `--planted subsurface_across_parts` puts red on at least 100 of them. Catches: a kernel whose weights sum over 1; a lobe added to the diffuse instead of taking its share; taps taken from another part or material; a pass run over other parts |
| AC3 `#481.9afd6b06` | A fin backlit by the key light lets light through by exp(−d ÷ radius) within 5% at 2 mm and 6 mm | `backlit-fin.test.ts` (1): a 20 cm white fin, `subsurface: {weight: 1, radius: [0.012, 0.008, 0.005], thin: true}`, the key sun (π lx, shadowed) shining through it toward the camera, the camera's face lit by nothing else; the central quarter's mean per channel at 2 mm and 6 mm ÷ the same at 0.1 mm, against exp(−(d − 0.1 mm) ÷ radius) in each channel within 5%; the 0.1 mm fin lets through at least 0.01. Catches: the base (nothing through: the front face is black); thickness ignored or taken from anything but the map; one radius for all channels; another curve (exp(−d ÷ 3r), a linear falloff) |
| AC4 `#481.7124c07a` | Shown to you: the slab under its line of light, the skin sphere before the white wall and the backlit fin; one taste call recorded, else INCONCLUSIVE | `taste.test.ts` (1): writes the three pictures from this run's output (The taste call), then reads `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's |

Proof line: "a slab's spread against a CPU reference" is AC1's printed width table; "a white furnace at or under 1" is
AC2's first test; "a backlit fin" is AC3's printed means.

## Assumed surfaces

The issue and design name the behaviors but not these; each is this job's choice, the most natural one beside the
base's own calls. The implementer provides exactly these. No `view3d` field, target or report is added.

1. **`subsurface` on `material@1`, exactly as the issue's Fields block gives it**, in `params`: `subsurface: {weight:
   0..1 = 0, color: color | base = base, radius: [m, m, m] = [0.0036, 0.0014, 0.0007], thin: bool = true}`; a color is
   `[r, g, b, a]` linear, as `base_color` and #428's lobe colors are, or `"base"`.
2. **The profile and its scaling.** "Christensen and Burley's diffusion profile for radius" is the paper's
   mean-free-path form: for a channel with mean free path ℓ (its `radius`) and albedo A (the lobe's color in that
   channel), R(r) = A·s·(e^(−s·r/ℓ) + e^(−s·r/(3ℓ))) ÷ (8π·ℓ·r) with s = 1.85 − A + 7·|A − 0.8|³, the paper's fit for
   ℓ in the searchlight configuration (the paper's other fits, 1.9 − A + 3.5(A −
   0.8)² for diffuse transmission and 3.5 + 100(A − 0.33)⁴ for the diffuse mean free path, give other widths: at A = 1,
   s = 1.04 against 0.906, 13% narrower, outside AC1's 5%). Since the lobe takes its share from the diffuse, the
   profile spreads the part's lit diffuse as a distribution, R ÷ A, and at weight 1 the part's diffuse is all spread.
   The spread is over the part's surface in metres: the taps' screen radii are the profile's radii scaled by the
   pixel's depth.
3. **Thin light through a part.** With `thin` on, a light that casts a shadow lights a pixel facing away from it with
   the light the lobe receives on the part's lit side times exp(−d ÷ radius) per channel, where d is the distance along
   the light's direction from the first surface the light's shadow map holds at that pixel to the pixel itself (the
   part's thickness for a fin facing the light). "The key light" is the document's first sun with `shadow: true`
   (#422's key sun). What "the light the lobe receives" is (its cosine, its color) is the implementer's: AC3 reads only
   the ratio between thicknesses.
4. **The white furnace** is #422's: `sky@1 {top: [1, 1, 1, 1], low: [1, 1, 1, 1], ambient_top: [0, 0, 0], ambient_low:
   [0, 0, 0], environment: {from: "sky", intensity: 1}}` and no light; a black `sky@1` with no ambient and no
   environment leaves the document's lights the only light.
5. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
   `crates/deep-gpu-layer/src/main.rs`:

| Name | The wrong program | Criterion |
|---|---|---|
| `subsurface_across_parts` | The subsurface pass blurs across parts: it runs over every pixel within its taps' reach of a subsurface part, at that part's profile, and takes every tap whatever part or material it lands on; everything else as shipped | AC2 (issue-named) |
| `subsurface_adds_to_diffuse` | The lobe's spread light is added to the part's full diffuse instead of taking its share from it; everything else as shipped | AC2 (a mutant: the furnace bound alone holds on the base) |

6. **`tests/acceptance/481/TASTE.json`** records the taste call, the one file anyone adds to this folder after this
   commit, and only to record the owner's answer: `{"issue": 481, "criterion": "#481.7124c07a", "verdict":
   "looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {name → sha256 for the three PNGs},
   "note"?}`.

The fixtures use only what the base has besides these: `mark.box@1`, `ball@1`, `light.sun@1` with `shadow`,
`light.area@1` with `shape: rect`, `size`, `power` and `range`, `camera@1` perspective, `sky@1`, `look@1`.

## The CPU reference

`reference.ts`, from the paper's published form, in f64: the radial distribution 2πr·R ÷ A = (s ÷ 4ℓ)(e^(−sr/ℓ) +
e^(−sr/(3ℓ))) and its integral 1 − e^(−sr/ℓ)/4 − 3e^(−sr/(3ℓ))/4; the share of the profile's light inside a strip |x| <
X about a line through its centre (a ring of radius r ≤ X entirely, a wider one (2/π)·asin(X/r) of it), integrated
numerically; from it the line-spread function integrated over each 0.2 mm pixel column; and its convolution with the
line the renderer draws without the lobe. "The width" is read the same way from the reference and from the frame with
the lobe: the half-width about the line's centre (D's centroid) holding the share f of the row's light, each column's
light spread evenly across it, at f = 0.10, 0.14, … 0.86 (the criterion's 20 points). Checked on its own before this
commit (BASE-FAILURE.txt): the column kernel sums to 1 within 1e-6; for a line a pixel wide at ℓ = 5 mm and A = 1, half
the light lies within 4.50 mm, and at ℓ = 1 mm within 0.91 mm.

## Readings where the issue and design leave a choice

- **"Spreads red to the width the profile gives … at 20 points"** is read as 20 widths, the half-widths holding 10% to
  86% of the line's light in steps of 4%, rather than the response's height at 20 distances. With 16 fixed taps rotated
  per pixel, the expected response at one distance is a sum of 16 rings, each sharp where a tap's radius crosses that
  distance, so its height there can't match a smooth reference within 5% however well the taps sample the profile;
  the share within a distance sums whole rings and can. A CPU stand-in of the design's sampler run on this fixture's
  line (16 taps at the midpoints of the profile's radial distribution, golden-angle spaced, the turn random per pixel,
  averaged over 200 rows) met all 20 widths within 1.6%; a stand-in with 16 evenly spaced radii to the profile's 99th
  percentile, weighted by the profile, missed by up to 28% (at 0.10) and 7% (at 0.38). The shares stop at 0.86 because
  the outermost of 16 such taps sits at the 97th percentile (53 mm for red), past which a 16-tap sampler knows nothing
  of the tail.
- **"Lit by a thin line of light"**: a `light.area@1` rect 0.2 mm × 0.4 m, 1 mm before the slab and facing it, whose
  lit diffuse holds half its light within 0.59 mm of its centre at the base (the fixture requires under 1 mm), an
  eighth of red's 4.8 mm and two thirds of green's 0.91 mm. The base has no light function and no slit with a sharp shadow, and the
  reference convolves the line the renderer actually draws, so the line's own width cancels: the test judges only the
  spread.
- **The slab's lobe** is `thin: false`, so only the spread acts under a light in front; its color is white (A = 1), so
  red and green share s = 0.906 and differ only by their mean free paths; the slab is white with `specular_level: 0`,
  so the frame without the lobe is its lit diffuse alone.
- **"Green less"** is green's width under red's at each of the 20 shares; green isn't held to its own reference, as the
  criterion holds only red to one.
- **"At weight 0 the frame equals the frame without the lobe byte for byte"** is the final PNG and the linear target,
  by SHA-256, with weight 0 and every other field of the lobe set (thin on); paired with weight 1 changing the linear
  target, so the field being ignored can't pass it.
- **"At every angle"** in the furnace is every angle between the view and the surface: a ball's pixels hold 0° to 90°,
  and the slab is turned 0°, 45° and 75°. "At or under 1" is at most 1.01, pbrt-v4's pass rule as #422 ported it.
- **"Puts no red on the wall's pixels"**: the wall is white under a white sun, so R − G on it is red put there; judged
  against the same scene without the lobe, by object ID, 2 px from any other part (MSAA blends a ball pixel into the
  wall's edge, and the lobe changing the ball changes that blend legitimately). "Where a pass that blurs across parts
  does" is the planted pass putting red on at least 100 of the judged pixels.
- **"Lets light through by exp(−d ÷ radius) within 5%"** is read as a ratio to the same fin at 0.1 mm, the unoccluded
  reference: exp(−(d − 0.1 mm) ÷ radius), each channel at its own radius. The absolute light through depends on the
  lobe's own scale, which the design doesn't fix, and a constant bias the shadow map adds to every thickness cancels;
  the radii, 12, 8 and 5 mm, keep a 5% band at least a quarter-millimetre wide in the measured thickness. 2 mm and
  6 mm are the fin's thickness, as the box's depth.
- **The pictures** for the taste call are drawn under a filmic look (tone map filmic, exposure 0) from the same
  fixtures: the slab at 800 × 800, the skin sphere and wall at 480 × 480, and the two fins side by side.

## The taste call

`taste.test.ts` writes these to `target/acceptance/481/`, printing each SHA-256:

| File | What it shows |
|---|---|
| `slab-line.png` | AC1's slab at subsurface weight 1 under its line of light: red spreading wider than green; the renderer's final PNG byte for byte |
| `skin-wall.png` | AC2's skin sphere before the white wall, with its lobe; the renderer's final PNG byte for byte |
| `backlit-fin.png` | AC3's fin backlit by the key sun at 2 mm and 6 mm of thickness, their final targets side by side |

They are attached to the PR and shown to the owner in the session; the answer is recorded in `TASTE.json` (Assumed
surfaces, 6). No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on
exactly this run's pictures passes. No other test reads these pictures or the call.

## Not tested, because no criterion asks

The path-traced random walk; the wrap fallback where the pass is off and its report; the glTF export listing the lobe;
seeking equals playing (the lobe keeps no history); the cost; the lobe's color other than white and skin's base; the
weight between 0 and 1; `thin` light from local lights' maps; the pass's behaviour at the frame's edge. The implementer
owes these a mapping or a note (AGENTS.md: review requirement → change → proof).
