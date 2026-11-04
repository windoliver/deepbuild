# Acceptance tests for #422: 3D light and sky — the environment, cascaded sun shadows, sky, fog, clouds and bloom, with the castle

Written first, from issue #422 (its scope, its Fields blocks — Light policy: cascades, Sky `sky@1`, Sky `sky@1`:
environment — its ten acceptance criteria and its proof line), the design sections it links and those they lean on,
its oracle page, and the base commit `34fe4930` ("Merge pull request #1203 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). The owner asked for a lean suite: one file per criterion, at most two
tests each, plus the planted wrong programs the criteria name (and one mutant each where a criterion names none and
its check could otherwise pass on the base).

## What was read

- Issue #422 and its oracle page (`doneright/oracles/issues/422.md` in `DeepBuildAI/deepbuild`, branch `doneright`):
  upstream tests for criteria 5, 8 and 9 (Khronos `Models/DirectionalLight`, pbrt-v4's `BSDFEnergyConservation`,
  Blender's glossy, metallic and glass furnace scenes); none for 1–4, 6, 7, 10. **Ported:** pbrt-v4's pass rule (a
  lobe under unit incident light fails above 1.01) as the furnace's "never above 1" in AC5 and AC9; Blender's furnace
  pattern (a uniform white environment, no lights, a lobe returns no more than it receives) as the furnace fixture of
  AC5, AC8 and AC9. **Not ported:** the `.blend` scenes and Cycles reference renders (they need Blender, and they
  judge Cycles' output, not ours), and Khronos's DirectionalLight model (it needs the glTF import path and the
  model's images; AC5's sun-lit CPU-reference check states the same property on our own fixture). Our 1% match to a
  CPU BRDF reference and the part-metal mix have no upstream test, as the oracle page says.
- `docs/technical-design.md`: Scenes, physics and the canvas core (the pass chain: shadow map, sky, mesh, soft cloud
  puffs, bloom, tone map; "Lamps are real lights, up to 32 per scene"; the castle "in about 10 ms a frame");
  Every task carries its own budgets (five runs after warm-up; PASS, FAIL or INCONCLUSIVE; p95 over at least 300
  frames); The reference Macs (Mac15,7 with its 3456 × 2234 display, Mac15,12 with its 2560 × 1664); the budget row
  "a core view or a window-sized figure under 2 ms of GPU … a showpiece under 10 ms at 30 fps, full screen on the
  reference Mac's display at half resolution while moving"; the parity suite (goldens blessed only by your decision;
  "A blank guard runs first: a frame that is blank or black … makes the comparison BLOCKED and voids its other
  numbers"; "A GPU golden's first blessing waits for the fixture's analytic and CPU-reference criteria to pass on the
  same commit"); Dogfooding.
- `docs/canvas-primitives.md`: Builders, recipes, looks and cameras; Object; Builder (`ball {radius, segments}`);
  The cost model (the budget class table: showpiece 10 ms GPU full screen at render scale 0.5 while moving, 256 MB;
  figure 2 ms, 256 MB); Material (the defaults, "× (1 + F0 × (1 ÷ E − 1)) on direct light … and the matching
  multiple-scattering term on environment and probe light, so a white metal reflects all it receives at every
  roughness"; `specular_level` at half glTF's specular strength); Light and the light policy (`shaded ≤ 32`, scored by
  power ÷ max(d², r²) times the range's overlap with the frustum, ordered by (score bucket, ID), lights left out
  reported by ID); Light policy: cascades; Sky `sky@1`; Sky `sky@1`: environment; Sky `sky@1`: height fog; Puff
  `puff@1`; Look `look@1`: bloom; Writer layer; Band; Document envelope (`transport`, `budget`); Golden (the physics
  golden, read for its BLOCKED and INCONCLUSIVE words only).
- At the base: `crates/deep-gpu-layer` (`main.rs`'s calls and `--planted` table; `view3d.rs`: `from`, `patches`,
  `timings` → `gpu_ms`, `passes_ms`, `gpu_bytes`, `surface`, `notices`; `golden.rs`: `golden`, `decide`, the blank
  guard, the fingerprint), `crates/deep-scene3d-render` (`scene3d.wgsl`: the sky's ambient gradient and the
  compensation already on direct light), `crates/deep-canvas-scene3d` (`light.rs`: the policy; `scene.rs`: `sky@1`
  read for its ambient only; `builders.rs`: `ball@1`), `crates/deep-canvas` (`budget.rs`: the classes;
  `show.rs`: Band and the writer kinds), `packs/examples/castle.json` and `packs/composites-1.0.0` (#420), and the
  suites `tests/acceptance/421` and `420` (helpers, looks, documents, the pinhole), `380` (`golden`, the timing rule,
  "window-sized" as 1936 × 1584) and `1174` (the taste call's record).

## What the base already does, which these tests don't credit

`view3d` draws scene3d documents into final, linear and object-ID targets; `light.point@1`, `light.spot@1`,
`light.sun@1`, `material@1` and `ball@1` are kinds; the shading core compensates the specular lobe on direct light;
`sky@1` gives an ambient gradient from above to below (its `top`, `low`, fog and environment fields are not read);
the look's bloom draws (#380); the light policy keeps 32 lights by (score bucket, ID) and reports the rest in a
`lights_over_budget` notice (#421), so AC6's first test may pass at the base; `golden` judges a frame through the
perceptual oracle with the blank guard first, and `decide` records your blessing. There is no prefiltered
environment, no height fog, no `puff@1`, no cascades (one shadow map), no recipe expansion in `view3d`, no `hidden`
layers, no `layers` report, no `cascades` report, no hash oracle, and none of the planted names below.

## Run them

They build `deep-gpu` (`cargo build --locked --bin deep-gpu`), as #378's, #420's and #421's suites do, so they run
one file at a time. `scripts/lanes.mjs` needs `'tests/acceptance/422/'` added to its `alone` list, beside
`tests/acceptance/421/`; this README is the instruction, the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/422 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/422/tsconfig.json
```

Every test draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes.
The goldens, the GPU budgets, the frame time and the taste call (AC1, AC2's and AC4's budget tests, AC10) also require
a reference Mac (`hw.model` Mac15,7 or Mac15,12), and fail `INCONCLUSIVE:` off one; so does a golden recorded under
another environment fingerprint, and a timing whose five runs neither all pass nor all fail by more than the margin.
Nothing is gated on power or load (the owner's rule). `taste.test.ts` writes into `target/acceptance/422/` and keeps
what it writes; every other test writes into its own temporary folder and deletes it.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped. Each test's name starts with `AC<n> #422.<id>`.

| ID | Criterion (short) | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#422.4c4893c7` | The castle on floating islands matches its golden pixel hash at four orbit times under the blank guard; p50 within the showpiece class; planted black BLOCKED, planted cloudless FAIL naming the time | `castle.test.ts` (2): the castle (below) has two or more `composites.island@1`, one `sky@1`, clouds and the showpiece class; `view3d` draws it at its size, 30 fps, and its final targets at 0, span/4, span/2 and 3·span/4 each read PASS from `golden` with `oracle: "hash"` against `tests/goldens/422/castle-t<k>`, and the suite's own pixel hash of each equals the stored golden PNG's. `--planted draws_black`: BLOCKED `blank` at all four, no numbers. `--planted drops_clouds`: no BLOCKED, FAIL at one time or more, each failure naming its time (`t = …`). p50: 300 frames full screen on this reference Mac's display at internal scale 0.5, the p50 of `gpu_ms` against 10 ms in five runs after a warm-up. Catches: the base; a castle off its golden; a guard after the comparison or none; clouds that don't draw; a castle too slow |
| AC2 `#422.7daccf6e` | A window-sized frame with sky, fog, clouds and bloom stays within the GPU budget | `window-budget.test.ts` (2): a figure-class fixture at 1936 × 1584 with a sky (gradient, ambient, distance and height fog), 32 `puff@1`, an emissive lamp and bloom, orbiting: frame 0 changes on ≥ 0.5% of pixels (by > 2 codes) without the sky, the fog, the clouds or the bloom; then 300 frames at 60 fps, each run's worst `gpu_ms` against 2 ms in five runs, every `gpu_bytes` ≤ 256 MB. Catches: the base (no fog, no puffs); a feature that draws nothing; a frame over 2 ms or 256 MB |
| AC3 `#422.daf158a9` | A cached cascade equals a clean render after the camera moves within or beyond a texel, the sun turns, or a caster moves inside or outside the cascade | `cascade-cache.test.ts` (1): five cases, each a patch at frame 1 of a three-frame run (camera 0.1 mm; camera 2.9 m; sun 10°; near caster 2 m; a caster 250 m out, past `shadow_far` 120 m): frames 1 and 2 equal, byte for byte in the linear and final targets, a fresh process's frame 1 opened by a seek. `--planted cascade_cache_keeps_stale` fails, naming the sun's turn and the inside caster. Catches: a cache keyed by less than it reads; a map re-rendered a frame late |
| AC4 `#422.05bcdd2b` | The prefiltered environment, height fog and cascaded sun shadows render the fixture within the showpiece budget, and seeking equals playing | `showpiece-fixture.test.ts` (2): a showpiece fixture (blocks, a metal ball at roughness 0.35, an environment from the sky, height fog, a sun with four cascades, orbiting): every frame reports five split distances; frame 0 changes on ≥ 0.5% of pixels without the environment and without the height fog; full screen on this reference Mac's display at internal scale 0.5, each run's worst `gpu_ms` against 10 ms in five runs, every `gpu_bytes` ≤ 256 MB. Seek: frames 20 and 60 of a run from 0 equal, byte for byte, each drawn by a fresh process opening at it; `--planted prefilter_over_frames` fails naming frame 20. Catches: the base; a prefilter spread over frames; state carried between frames; a fixture over budget |
| AC5 `#422.8976921a` | A white-furnace fixture's materials never reflect more than they receive, and match a CPU BRDF reference within 1% | `furnace-materials.test.ts` (2): white plastic (r 0.5), orange plastic (r 1), gold (r 0.4) and rough gold (r 0.8): in the furnace no ball pixel above 1.01 in any channel, the background 1 within 1%; under one 1 lx sun from the upper left, every judged pixel (2 px inside, reference ≥ 5% of the channel's peak) within 1% per channel of the glTF BRDF with the compensation (`helpers.ts`, `brdfCos`). Catches: the base (a dark furnace); a diffuse not weighted by 1 − F; a wrong or missing compensation, D, V, Fresnel or α |
| AC6 `#422.9d4b631c` | The light policy keeps the 32 that contribute most, ties by ID, and cascade splits match their closed form, by exact fixtures | `policy.test.ts` (2): 44 point lights at one point (24 × 8,000 lm, 16 tied × 1,000 lm listed in reverse ID order, 4 × 100 lm listed first): frame 0's `lights_over_budget` lists exactly t08–t15 and w0–w3. Splits: `cascades: true` gives each frame's split distances, each the closed form within 1e-6 at split 0 (1, 2500.75, 5000.5, 7500.25, 10000), 0.5, 1 (1, 10, 100, 1000, 10000), and the defaults (3 cascades, split 0.5, near 0.5, shadow_far 64). Catches: a cut by document order or by ties in order; the base (no splits); a wrong formula, count, near or far |
| AC7 `#422.4f7bd0ec` | Another writer's box behind your wall: hidden where covered, lit by your light, shadowing your floor; each layer in its own band; hiding the layer removes box and shadow | `layers.test.ts` (1): your layer (`you:owner`: camera, sky, floor, wall, sun) and another's (`agent:sess-beta`: a red box behind the wall's right end). Of the box's pixels with the wall absent, those inside the wall (with their layer hidden) show the wall and the rest show the box, 99.5% each, ≥ 500 each; the box's mean luminance with your sun ≥ 2 × without; ≥ 300 floor pixels 25% darker than with their layer hidden; the reply's `layers` are `mine` in `work`, then `theirs` in `agent`; hidden, no box pixel and every pixel within 1% of the document without their layer. Catches: per-layer depth (their box over your wall); per-layer lights or shadows; a hidden layer that still casts; the base (no `hidden`, no `layers`) |
| AC8 `#422.45d51ce0` | White metal at roughness 0, 0.5, 1 reads 1 within 1% in the furnace and matches the compensated lobe under one sun; planted uncompensated reads 1 − ln 2; planted environment-only compensation reads 0.31 of the reference | `metal-furnace.test.ts` (2): `metal_r000`, `metal_r050`, `metal_r100`. Furnace: every ball pixel 1 within 1% per channel, background 1. Sun (1 lx along −Z, behind the camera): r 0.5 and 1 within 1% of E·D·V·(n·l) ÷ E(n·v, α) at every judged pixel; r 0, the sun's image Σ linear × pixel solid angle = E·R² ÷ (2d − R)² = 1/121 within 1%. `--planted uncompensated_lobe` fails the furnace naming `metal_r100`, its center in [0.305, 0.315); `--planted compensates_environment_only` fails under the sun naming `metal_r100`, its center ÷ reference in [0.305, 0.315). Catches: the base; either half of the compensation missing; a wrong E |
| AC9 `#422.4f89df46` | Base color 1 at metallic 0 to 1, roughness 0.5: never above 1; each part-metal ball the mix of the pure ones within 1% at every pixel; planted premixed core fails at metallic 0.5 | `metallic-mix.test.ts` (1): `metallic_000` … `metallic_100` in the furnace: no pixel above 1.01; at every pixel all three share, ball m = (1 − m)·ball 0 + m·ball 1 per channel within 1%; `--planted premixed_metallic` fails naming `metallic_050`. Catches: the base; a premixed F0 |
| AC10 `#422.99034ca1` | Shown to you: the castle at the four times, the furnace metal spheres, a recording of the orbit; one taste call recorded, else INCONCLUSIVE | `taste.test.ts` (1): writes the pictures and the recording from this run's output (The taste call), then reads `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

## Assumed surfaces

The issue and design name the behaviors but not these calls and fields; each is this job's choice, the most natural
one beside the base's own calls. The implementer provides exactly these.

1. **`sky@1`'s fields as the design names them**, in `params`: `top`, `low` (colors given as `[r, g, b, a]` linear,
   as `material@1`'s `base_color`), `ambient_top`, `ambient_low` (linear RGB, as at the base), `fog` (`[r, g, b, a]`
   or `"background"`), `fog_density`, `fog_height: {top, density}`, `fog_curve`, and `environment: {from: "sky" |
   "studio" | sha256, intensity, rotation, size}`. With `environment` set, every physically based material is lit and
   reflects the prefiltered environment (its irradiance and its cube by roughness); with `from: "sky"` the environment
   is the sky's own gradient times `intensity`. Without `environment` a sky lights nothing but its ambient gradient.
2. **The white furnace** is a document whose only light is `sky@1 {top: [1, 1, 1, 1], low: [1, 1, 1, 1],
   ambient_top: [0, 0, 0], ambient_low: [0, 0, 0], environment: {from: "sky", intensity: 1}}` with no light item: its
   environment's radiance is 1 in every direction, its background (the sky's own fields, `background: auto`) reads 1
   in the linear target under the plain look (#378's, exposure scale 1), and no view key light is added (as at the
   base under a sky). A black sky with zero ambient and no `environment` leaves a sun as the only light.
3. **`puff@1`** as the design names it: `at.pos`, `params: {radius, aspect, density, bright, seed}`.
4. **The cascades' fields on the key sun**: `light.sun@1`'s `params` take `cascades` (1–4, default 3), `split`
   (default 0.5), `shadow_far` (m, default from the view's bounds) and `fade` (default true), beside `shadow: true`.
   The splits are distances along the camera's view axis from its `near` to `shadow_far`.
5. **`view3d` gains four fields** (the base's others unchanged: `from` opens a session there as a seek and applies
   every patch up to it; `patches: [{frame, writer, ops}]`; `timings: true` gives each frame's `gpu_ms` and
   `gpu_bytes`; `surface: {internal_scale}`; `capture`; `targets`; each frame's `notices`):
   - `packs: [folder]`: pack folders (such as `packs/composites-1.0.0`) the document's recipes expand from before
     it's drawn, as deep-show installs them;
   - `hidden: [layer ID]`: writer layers not visible in this session (Writer layer: `visible`), which neither draw
     nor light, shade, cast or count for anything else, as if absent;
   - `cascades: true`: each frame carries `cascades: {splits: [d0, …, dN]}`, the key sun's N + 1 split distances in
     m (d0 the camera's near plane, dN `shadow_far`);
   - and the reply carries `layers: [{layer, writer, band}]`, the document's visible writer layers back to front in
     band order, each with the band its writer's kind gives (`you:*` → `work`, `agent:*` → `agent`, `plugin:*` →
     `plugin_overlay`, `record:*` → `record`; deep-canvas's `Writer::band`).
6. **Each view3d call is a clean session**: a fresh process's call caches nothing from before it; a call's cached
   cascade maps and prefiltered cubes never outlive its session in a way a later process could see.
7. **`golden` gains `oracle: "hash"`**: `{"call": "golden", "store", "fixture", "png", "oracle": "hash"}` judges the
   PNG against the fixture's golden as the base orders it (no golden: BLOCKED `no_golden`; another fingerprint:
   INCONCLUSIVE `environment_changed`), then the blank guard (either image blank or black by the base's measure:
   BLOCKED `blank`, no `numbers`), then compares the SHA-256 of the two images' RGBA8 pixels, rows top-down: PASS when
   equal, FAIL when not, with `numbers: {pixels, golden_pixels}`. The reply says `oracle: "hash"`. `decide` is
   unchanged: it stores `<fixture>.png` and `<fixture>.golden.json` in the store.
8. **The castle and its goldens.** `packs/examples/castle.json` (the base's #420 castle, amended) is the castle's
   description: two or more `composites.island@1` (floating islands), one `sky@1` (with its environment and height
   fog), clouds as `puff@1` or `composites.cloud_bank@1` items that drift, lit windows (emissive materials) with bloom,
   `budget.class: "showpiece"`, and `transport.span` one turn of a camera orbit, in seconds, such that span × 30 is a
   multiple of 4. `packs/examples/castle.look.json` is the `look@1` it's drawn in. Its recipes come from
   `packs/composites-1.0.0` through `packs`. Its goldens are `tests/goldens/422/castle-t0` … `castle-t3`, the final
   targets at 0, span/4, span/2 and 3·span/4 drawn at the castle's own `size`, internal scale 1, 30 fps; recorded on a
   reference Mac by your decision (`decide` with `via: "you"` on those PNGs, run by the owner or at the owner's word
   in the session) once AC5, AC8 and AC9 pass on the same commit, and committed.
9. **The taste call** is recorded in `tests/acceptance/422/TASTE.json`, the one file anyone adds to this folder after
   this commit, and only to record the owner's answer:
   `{"issue": 422, "criterion": "#422.99034ca1", "verdict": "looks_right" | "looks_wrong", "who", "when": ISO 8601,
   "screenshots": {name → sha256 for the six PNGs and the recording}, "note"?}`.
10. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`:

| Name | The wrong program | Criterion |
|---|---|---|
| `draws_black` | Every final target is drawn black (all channels 0) | AC1 (issue-named) |
| `drops_clouds` | Cloud puffs (`puff@1`, and those a recipe emits) are not drawn; everything else as shipped | AC1 (issue-named) |
| `cascade_cache_keeps_stale` | A cascade's cached map is reused while the scene's item count is unchanged, whatever else it read changed | AC3 (a mutant) |
| `prefilter_over_frames` | The environment is prefiltered one roughness mip per frame, starting at the frame a session opens | AC4 (a mutant) |
| `uncompensated_lobe` | The specular lobe without the multiple-scattering compensation, on direct and environment light | AC8 (issue-named) |
| `compensates_environment_only` | The compensation applied to environment light only, not to direct light | AC8 (issue-named) |
| `premixed_metallic` | One base reflectance F0 = mix(0.04, base color, metallic) and diffuse (1 − metallic) × base color, shaded once | AC9 (issue-named) |

## The taste call

`taste.test.ts` writes, from one run's output on a reference Mac, to `target/acceptance/422/`:

| File | What it shows |
|---|---|
| `castle-t0.png` … `castle-t3.png` | the castle's final targets at the four sampled times, the renderer's PNGs byte for byte |
| `furnace-metal.png` | the white metal balls at roughness 0, 0.5 and 1 in the white furnace, side by side (they should vanish into it) |
| `sunlit-metal.png` | the same balls under one sun behind the camera, side by side |
| `castle-orbit.apng` | the castle's whole orbit at 640 × 400 and 10 fps, as an animated PNG of its final targets |

They are attached to the PR and shown to the owner in the session; the owner's answer is recorded in `TASTE.json`
(Assumed surfaces, 9). No file is INCONCLUSIVE; a call made on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails;
`looks_right` on exactly this run's pictures passes. No other test reads these pictures or the call.

## Fixtures

None on disk: every document is generated in the test files and `helpers.ts`. The castle, its look and its goldens
are the implementer's, at the paths above.

## Readings where the issue and design leave a choice

- **The goldens.** "Matching its golden pixel hash" is an exact match of RGBA8 pixels, judged by the GPU layer's own
  `golden` call so the guard runs in the product, not only in the test; the suite cross-checks each PASS with its own
  hash of both PNGs. The first golden is recorded, as the design asks, by your decision after the analytic and
  CPU-reference criteria (AC5, AC8, AC9) pass on the same commit; the owner's taste call (AC10) is on the same four
  frames. The planted twins must still fail against those goldens: black BLOCKED, cloudless FAIL.
- **"Naming the time"** is the check's failure line: each FAIL names its sampled time (`t = 3s`).
- **"Frame time at p50 within the showpiece class"** is the GPU frame time (`gpu_ms`) at p50 over 300 frames against
  the class's 10 ms, full screen on the reference Mac's own display at its render scale while moving (0.5), by the
  five-run rule. The class's CPU cap isn't judged: `view3d` reports no CPU frame time.
- **"Window-sized" and "the GPU budget"** follow #380's suite and the design's budget row: 1936 × 1584, the figure
  class's 2 ms of GPU and 256 MB; "stays within" is each run's worst frame, as #380's suite reads "per frame". AC4's
  "within the showpiece budget" is read the same way, against 10 ms and 256 MB.
- **"A cached cascade equals a clean render"** is read on the frame: byte-equal linear and final targets against a
  fresh process seeking to the same frame. "Within a cascade texel" is 0.1 mm, inside any texel a map of up to 8192 px
  over the near split could have; "outside the cascade" is a caster past every cascade's reach.
- **The white furnace's "radiance 1"** is checked on the fixture itself: its background must read 1 within 1%, or
  nothing it reads counts. "Read 1 within 1% at every pixel" is each channel of the linear target at every pixel the
  ID target gives the ball; "never read above 1" is at the criterion's own 1%: 1.01, pbrt-v4's threshold.
- **"Matches a CPU reference within 1%"** is judged per pixel where the lobe can be judged: at least 2 px inside the
  silhouette and at least 5% of the ball's (or channel's) peak, against the reference at the pixel's own ray. At
  roughness 0 the lobe is a mirror's, so the ball is judged whole: the sun's image Σ L·Ω equals the mirror sphere's
  E·R² ÷ (2d − R)², the compensated lobe's limit as roughness goes to 0, whatever specular antialiasing widens it to.
- **The CPU BRDF** is glTF 2.0's (Appendix B: GGX, height-correlated Smith, α = roughness², Schlick's Fresnel at v·h,
  the dielectric's `fresnel_mix` of a Lambertian diffuse and a specular lobe at F0 0.04, the metal's specular at
  F0 = base color, mixed by metallic) with the design's direct-light compensation on each specular lobe, E computed
  here by quadrature. Base color arrays are linear, as `light.rs` reads them.
- **"≈ 0.31"** is read to two places: [0.305, 0.315).
- **"Exact fixtures"** for the splits are closed-form values within 1e-6 relative (an f32 report holds them to about
  6e-8); for the light cut, scores made equal by placing every light at one point with one range.
- **"Each layer still composites in its own band"** is read on the reply: the visible layers listed back to front in
  band order, each with its writer's band, while their 3D items share one depth, one light set and one shadow pass.
- **The recording** is an animated PNG the suite encodes from the renderer's final targets, since the issue names no
  container and the export path is another issue's.

Not tested, because no criterion asks: `studio` and HDR environments, `rotation`, `background` modes,
`background_blur`, `background_ground`, `environment.mix`, video backgrounds, `stars`, `moon`, the sky's `sun` and
`exposure`, `fog: background`, `fog_curve: exp`, puff lighting and `near_fade`, bloom thresholds and dirt, cascade
`fade` on its own, more than four cascades refused, and lights over the shadow budget.
