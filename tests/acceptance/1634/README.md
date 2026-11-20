# Acceptance tests for #1634: many lamps in raster light: hundreds of unshadowed point and spot lights a view, put into clusters in a fixed order, with every drop reported

Written first, from issue #1634 (its scope, ten acceptance criteria and proof line), its oracle page, the design
sections it links and those they lean on, and the base commit `16dc5eab0` ("Merge pull request #2771 …"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). One file per criterion, at most two tests each, plus
exactly the four planted wrong programs the criteria name.

## What was read

- Issue #1634, live, and its oracle page (`doneright/oracles/issues/1634.md` in `DeepBuildAI/deepbuild`, branch
  `doneright`).
- `docs/canvas-primitives.md`: Light and the light policy; Operator output: light response; Light: receivers; The cost
  model and its budget class table; Frame budget; The status-color rule; Status guard; Look `look@1` (`exposure`) and
  Look `look@1`: light; Camera `camera@1`. The base's design names no fill light: `fill`, `fill_shaded`, `per_cluster`,
  `cluster_over_budget` and the exposure's cut are the issue's.
- `docs/technical-design.md`: Tests written first; Who drafts it; Dogfooding; Every task carries its own budgets; The
  reference Macs.
- At the base, for surfaces and conventions: `crates/deep-gpu-layer/src/{main.rs,view3d.rs,view3d/parse.rs,lod.rs,
  envelope.rs}` (the calls, `--backend noop`, `Planted` and `bad_input`; `view3d`'s fields, targets, `pixel_hash`,
  `notices`, `light_cut`, `counts`, `timings`, `from`, `seeks`; `envelope_counts`); `crates/deep-gpu/src/counted.rs`;
  `crates/deep-canvas-scene3d/src/{light.rs,clusters.rs,spec.rs,scene.rs}` (the light fields, `scores`, `policy_by`,
  32 shaded, the margin, the 0.05 lx threshold, the grid); `crates/deep-canvas/src/{budget.rs,camera.rs}`;
  `crates/deep-canvas-marks/src/finish.rs` (`exposure_scale`); `benchmarks/budgets.json`; `scripts/benchmark.mjs`
  (`fingerprint`, `judgeLimit`, `validateBudgets`); `scripts/proof-change.mjs` (`criterionId`); `scripts/lanes.mjs`
  (`alone`, `timed`); and the suites `tests/acceptance/485/` (layout, the room, `light_cut`, responses), `446/` (mattes,
  receivers), `422/` (`lights_over_budget`), `173/` and `378/` (a pose by an orbit and by a seek), `1637/`, `380/` and
  `468/` (budgets by the lane's rule), `1903/` and `486/` (noop-lane counts, `live`), `968/` and `524/` (the taste
  call).

## What the base already does, which these tests don't credit

`view3d` reads no `fill`, no `per_cluster` and no `clusters`: it draws a fill lamp as a key light, so the policy shades
32 and leaves the rest out, and its replies hold no cluster list, no `light_cut.fill`, no `cluster_over_budget` and
none of the timed readings of surface 7. An automatic range ends at a fixed 0.05 lx. The checked calls (`live`,
`envelope_counts`) refuse `fill` as `unknown_field` (`light.point@1.0 does not define fill`), and the base's cost
estimate reads a document of 2,052 items at 23.4 ms of CPU and one of 517 at 6.4 ms, past the classes' 4 ms. The orbit,
the seek and the shuffled street already give one pixel hash at the base, and the 40 key lights alone already give
today's 32 and 8; the tests fail there on what the criteria add. None of the planted names is in `Planted`, there is
no task for #1634 in `benchmarks/budgets.json`, and this folder isn't in `scripts/lanes.mjs`.

## Run them

Every file builds `deep-gpu` (`cargo build --locked --bin deep-gpu`, adding the pinned toolchain's `bin` to PATH when
it is installed); `budgets.test.ts`'s timing test also builds it with `--release`, only on a machine that can judge a
timing. So they run one file at a time: **`scripts/lanes.mjs` needs `'tests/acceptance/1634/'` in its `alone` list and
`'tests/acceptance/1634/budgets.test.ts'` in its `timed` list; this README is the instruction, the implementer makes
that edit.**

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1634 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1634/tsconfig.json
```

Pixel tests draw on macOS's Metal device; off macOS they fail with a message starting `INCONCLUSIVE:`, never pass.
`key-lights.test.ts` and `no-pipeline.test.ts`'s first test run on the noop lane, anywhere the binary builds.
`no-pipeline.test.ts`'s second test and `budgets.test.ts`'s second test need a reference Mac (below) and are
INCONCLUSIVE elsewhere. Every test passes an explicit timeout of an hour or more. Imports are Node built-ins and
vitest; the lane's judge, validator and `timed` list run from `scripts/` in a child process. `taste.test.ts` keeps its
four files in `DEEPBUILD_EVIDENCE_DIR`; every other test writes into its own temporary folder and deletes it. A run
with `--root tests/acceptance/1634` leaves Vitest's cache in `tests/acceptance/1634/node_modules`; delete it.
`reference.ts` imports no vitest, so it runs on its own.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped (`scripts/proof-change.mjs: criterionId`), recomputed from the live issue. Each test's name starts
with `AC<n> #1634.<id>`; each file's header gives its fixture and numbers.

| ID | Criterion (short) | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#1634.d5f3a907` | The street of 512 fill lamps: every lit road pixel within 1% of the CPU sum on 99.9%; a planted top-32 policy fails naming the first dimmed lamp | `street-sum.test.ts` (2). `… every lit road pixel's linear radiance is within 1% of the CPU f64 sum …`: the street through `STREET_VIEW`, linear and ID targets; over the road pixels lit at 0.05 lx or more (at least 15,000), at most 0.1% read more than 1% off 0.8 E ÷ π in any channel. `… a planted policy that shades only the top 32 (--planted fill_top_32) …`: the same check fails with `the first dimmed lamp is lamp_208,` (the first lamp with pixels that the CPU reference of the 32-light policy leaves under weight 0.99). Catches: the base; fill lamps under the key cut; a window, falloff or cosine that isn't the design's; a light lost at a tile's or slice's edge |
| AC2 `#1634.1412aa03` | One pixel hash by an orbit, a seek and a shuffled creation order; each cluster's list by score bucket, then ID; a planted arrival-order pass differs between two runs, naming the cluster | `view-function.test.ts` (2). `… the pose at 1.633 s reached by the orbit, by a seek and with the 512 lamps created in a shuffled order …`: two runs of three legs; the lists name at least 80 of the 88 lamps in view and none out of it, 20 clusters hold two lights or more, every list is in the reference's order, and the legs and runs agree in hash and in lists. `… (--planted cluster_arrival_order) …`: fails with `two runs differ at cluster [x, y, s]`. Catches: the base; lists in document, buffer or pure score order; lists carried between frames |
| AC3 `#1634.b847690e` | 100 lamps in one cluster: weights equal the rule within 1e-6, at most 64 above 0, only the margin's between 0 and 1, `cluster_over_budget` once naming the cluster and the dropped IDs; a planted list-order cap fails naming the cluster | `cluster-cap.test.ts` (2). `… each weighs what the CPU reference of the rule gives within 1e-6 …`: cluster [8, 4, 23]'s list against `cutAt(ordered(…), 64)`; one notice over three still frames, in frame 0, its `clusters` holding the cluster and its `dropped` the reference's 36. `… (--planted cluster_cap_by_list_order) …`: fails naming `cluster [8, 4, 23]`. Catches: the base; a cap by score alone, by ID or by order; no margin; a notice per frame, or with no IDs |
| AC4 `#1634.919ee285` | 0 to 2,048 fill lamps over 10 s and back create no pipeline after the first frame, on the noop lane and on the reference Mac | `no-pipeline.test.ts` (2). `… on the noop lane …` and `… on the reference Mac's Metal device …`: `envelope_counts` over 1,201 frames with the switches as patches: `pipelines` is 0 in every frame after frame 0; `view3d` of the document with every lamp on lists 2,048 in `light_cut.fill`. Catches: the base; anything compiled per light count or at a count's threshold; lamps that are never shaded |
| AC5 `#1634.59464d5c` | Among 2,048 fill lamps, a lamp kept to its room's collection lights nothing outside, at 20 pixels beyond the walls | `receivers.test.ts` (1). `… leaves 20 sampled pixels beyond the wall dark …`: the 20 ground pixels under 1e-5; the hall's floor by the keeper and at 20 lanterns' feet within 2% of the CPU reference; in the twin with no `receivers` the same 20 pixels read the keeper's light. Catches: the base; a cluster loop that skips a fill light's receiver bit |
| AC6 `#1634.41f7525a` | 40 key lights: 32 shaded and `lights_over_budget`, unchanged by 1,024 fill lamps; a document past `fill_shaded` refused naming the count and the class | `key-lights.test.ts` (2). `… 1,024 fill lamps beside them change neither count`: `shaded`, `left_out` and the notice equal the CPU reference's alone and equal again with the fill lamps, which all appear in `light_cut.fill`. `… one fill lamp past its class's fill_shaded …`: `live` refuses 33 in figure, 513 in work_product, 2,049 in showpiece and in export with an `over_budget` issue naming `fill_lights` and `class`, and admits 32 in figure. Catches: the base; fill lamps in the key cut; a silent drop past the cap |
| AC7 `#1634.e8a4deec` | A three-band response under 200 fill lamps sums 200 calls: 0.01 a call reads 2.00 within 0.5% | `response-sum.test.ts` (1). `… reads 2.00 within 0.5%`: the frame's centre on the linear target, every channel. Catches: the base (0.04); a cluster that calls 64 (0.64); one call a pixel |
| AC8 `#1634.5a35384c` | Budget: the night city within 10 ms of GPU, same hash by seek and play at 10 times, cluster pass ≤ 0.5 ms, scoring ≤ 1 ms, lists ≤ 4 MB, estimate within 25% | `budgets.test.ts` (2). `… gives the same pixel hash by seeking and by playing at 10 sampled times, its light lists take at most 4 MB …`: hashes, list bytes and their estimate, the readings present, the budgets.json task under the lane's validator, this file in `timed`. `… five runs each by the lane's rule`: six limits judged by `judgeLimit`. Catches: the base; state carried between frames; a budget no lane compares with the merge base |
| AC9 `#1634.d613f0e8` | Automatic ranges: 800 lm at the fixture's exposure and 8 lm at log2 100 EV more give the same 8-bit frame within 1 code on 99.9% of road pixels and 2 everywhere; a planted fixed 0.05 lx fails naming the first lamp whose range changed | `auto-range.test.ts` (2). `… gives the same 8-bit frame …`: the two finals over road pixels and the whole frame; every lamp's range the reference's in both. `… (--planted auto_range_fixed_cut) …`: fails with `the first lamp whose range changed is lamp_208: 35.68 m at 800 lm, 3.57 m at 8 lm` and pixels over 2 codes apart. Catches: the base; a range that follows power alone |
| AC10 `#1634.186fabe5` | Shown to you: a still and a 10 s orbit of the street, and of the same street under the 32-light policy; one taste call, else INCONCLUSIVE | `taste.test.ts` (1). `… the recorded taste call says they look right`: writes the four files from this run's frames, then reads the record: none, or one on other files, is INCONCLUSIVE; `looks_wrong` fails |

Proof line: "the planted top-32 policy and arrival-order pass shown failing first" are AC1's and AC2's second tests;
"the street's per-pixel match" AC1's first; "hashes" AC2's and AC8's first; "budgets on the reference Mac" AC8's
second.

## Assumed surfaces

The issue names the behaviors; these shapes are this job's choice, each the plainest one beside the base's own calls.
The implementer provides exactly these.

1. **`fill` on a light**: `params.fill: true` on a `light.point@1` or `light.spot@1` item, beside `shadow: false` and
   a `range` in metres, or no `range` (an automatic one). Left out, a light is a key light.
2. **`light_policy.per_cluster`** on the document, beside the base's `soft`, `contact` and `shadowed`: a whole number
   up to 255, 64 when left out. AC7 sets 200.
3. **The check's refusal past `fill_shaded`**, as the base's check reports a document over its class, read through
   `live` on the noop lane (`{call: "live", look, fps, frames, sessions: [{session, doc, size, writer}], events}`, the
   document as its writer sends it: no `id`, no `layers`, no item `layer`): the session's row is `state: "refused"`
   with an issue `{check: "document.validate", code: "over_budget", severity: "error", path: "budget/fill_shaded",
   ids, actual: {fill_lights: <how many the document holds>, fill_shaded: <the class's cap>, class: "<class>"}, what,
   fix}`. The test reads `code`, `actual.fill_lights` and `actual.class`. A document names its class in
   `budget.class`: `figure` (32), `work_product` (512), `showpiece` (2,048), `export` (2,048). At the cap it is
   admitted: `state: "live"`.
4. **`view3d`'s `light_cut`** (`light_cut: true`) keeps `shaded: [{light, weight}]` and `left_out: [id]` for key
   lights alone, and gains **`fill: [{light: <item ID>, range: <metres>}]`**: the fill lights this view shades (those
   whose range meets the frustum), in the policy's order, each with the range the frame uses, an automatic one
   resolved. It is the CPU's, so it answers on the noop lane too.
5. **`view3d`'s `clusters: true`**: each captured frame reports **`clusters: [{cluster: [x, y, s], lights: [{light:
   <item ID>, weight: <0 to 1>}]}]`**, one entry for every cluster that holds a light: `x` the tile column from the
   frame's left (0 to 15), `y` the tile row from its top (0 to 8), `s` the depth slice from the near plane (0 to 23),
   the grid the policy already uses; `lights` the cluster's list as the frame's pixels walk it, read back from what
   the cluster pass wrote on the device, in order, each with its weight in that cluster. A light the cap dropped is
   left out or listed at weight 0.
6. **`cluster_over_budget`** is a frame notice in `view3d`'s `notices`: `{code: "cluster_over_budget", clusters:
   [[x, y, s], …], dropped: [<item ID>, …]}`: every cluster past `per_cluster`, and the lights dropped from any of
   them, each once; raised in the frame where either list changes, and not again while they hold.
7. **A timed frame's readings** (`timings: true`, on the device), beside the base's `gpu_ms`, `cpu_ms`, `passes_ms`
   and `declared_ms`: the cluster pass is named **`scene3d.light_clusters`** in `passes_ms` (its GPU time, ms) and in
   `declared_ms` (the cost model's estimate of it); **`lights: {scoring_ms, lists_bytes}`**, the CPU time the policy's
   scoring took for this frame's change (ms) and the bytes of the buffers that hold the cluster grid's light lists;
   and **`estimate: {gpu_ms, scoring_ms, lists_bytes}`**, the cost model's estimate of the frame's GPU time, of the
   scoring and of the lists.
8. **`envelope_counts`** (#1903) as at the base, on the noop lane and on Metal: `{call: "envelope_counts", look,
   writer, doc, render: {seconds, pixels}, fps, patches: [{frame, ops: [{op: "set", id, path: "items/<id>/visible",
   value}]}]}` answers `{warmup, frames: [{frame, pipelines, …}]}`. A lamp is off while its item's `visible` is
   false. The check must admit the showpiece of 2,048 fill lamps, so the cost model prices a fill lamp inside the
   class (the base's estimate refuses it).
9. **A light response answers fill lights** as it answers key lights (#485's surface, at the base): the material
   operator's `light` graph is called once for each light the pixel's cluster shades, with `shadow` 1 for a fill
   light, and what it returns is summed times the light's weight there.
10. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
    `crates/deep-gpu-layer/src/main.rs`:

| Name | The wrong program | Criterion |
|---|---|---|
| `fill_top_32` | Fill lights go through the key policy with the key lights: the view shades its top 32 by (score bucket, ID), dims those within the margin of the cut and leaves the rest out; everything else as shipped | AC1 |
| `cluster_arrival_order` | The cluster pass leaves each list in the order its lights' appends arrived, with no ordering after the fill, so the lists are not a function of the view: two runs of the binary give different lists (and may give different pixels) | AC2 |
| `cluster_cap_by_list_order` | A cluster past `per_cluster` keeps the first `per_cluster` lights of its list in the order the lights were created, at weight 1, and drops the rest, with no score, bucket or margin | AC3 |
| `auto_range_fixed_cut` | An automatic range ends at a fixed 0.05 lx whatever the exposure: √(power ÷ (4π × 0.05)), 3.57 m at 8 lm | AC9 |

11. **The perf lane**: a task in `benchmarks/budgets.json` whose `criteria` hold `#1634.5a35384c`, passing
    `validateBudgets` against the merge base's file (the test reads only `criteria` and `command`; what the mode
    prints is the implementer's):

```json
{"id": "canvas-many-lamps", "command": ["node", "benchmarks/canvas.mjs", "many-lamps"], "margin": 0.5, "limits": {},
 "targets": {"frame_gpu_p95_ms": 10, "cluster_pass_gpu_p95_ms": 0.5, "scoring_cpu_p95_ms": 1, "light_lists_bytes": 4000000, "estimate_off": 0.25},
 "initialReason": "Issue #1634 first measurement (#1634.5a35384c): the merge base has no fill lights and no such task. A release deep-gpu plays the night city of tests/acceptance/1634 (1,024 fill point and 1,024 fill spot lamps, ranges 6 to 12 m) at 1920 x 1080 for 300 frames with timings, five runs after a warm-up one, each a fresh process; canvas.mjs judge holds the frame's GPU p95, the cluster pass's, the CPU scoring's and each estimate's distance from its measurement on a reference Mac, and the light lists' bytes anywhere. p50 and peak memory of the whole command get a 50% margin against the merge base once main has this task.",
 "criteria": ["#1634.5a35384c"]}
```

12. **The taste call's record**: a JSON file named by `DEEPBUILD_TASTE_1634`, `{"criterion": "#1634.186fabe5", "by":
    "you", "screenshots": [sha256 × 2], "recordings": [sha256 × 2], "call": "looks_right" | "looks_wrong"}`. Nothing
    is added to this folder to record it.

The fixtures use only what the base has besides these: `mark.box@1`, `light.point@1`, `light.spot@1`, `camera@1`
(`position` and `target`, or `orbit` with a linear channel on its azimuth), `sky@1`, `look@1`, `material@1`,
`gpu.material@1` with #485's responses, `collections`, `receivers`, `visible`, `budget.class`, and `view3d`'s `from`,
`seeks`, `capture`, `targets`, `pixel_hash`, `notices`, `light_cut` and `timings`.

## The fixtures

All are generated in `helpers.ts`; none is on disk. Every lamp is white and unshadowed. The numbers below are
`reference.ts`'s.

- **The street** (`streetDoc`, AC1, AC2, AC9, AC10): 512 point lamps `lamp_000` … `lamp_511`, 800 lm, 3 m above the
  middle of a straight road, 10 m apart from x = −2,555 m to 2,555 m, each a fill light with a 6 m range; a matte road
  of albedo 0.8, 5,200 m × 20 m, its top at y = 0; a black sky; work-product class; 1920 × 1080; a look with no tone
  map at EV100 5.7635 (`EV_TODAY`). `STREET_VIEW` (AC1, AC9): eye (0.37, 720.0, 415.7), target (0.37, 0, 0), fov 60°,
  near 500 m: across the street from 831 m, 60° up, 2 px to the metre; 98 lamps' 6 m ranges meet the frustum (lamp_207
  … lamp_304) and the fullest cluster holds 8. The orbit (AC2, AC10): target (0, 1, 0), elevation 12°, distance 40 m,
  fov 60°, near 0.5 m, azimuth 0° to 360° over 10 s on a linear channel.
- **The crowd** (`crowdDoc`, AC3): 100 fill lamps `c00` … `c99` on a 5 × 5 × 4 lattice 0.05 m apart about (0.5675,
  1.5, 0.1), range 0.25 m, power 400 × 2^(((37 n + 11) mod 100) ÷ 50) lm, created in a seeded shuffled order; eye
  (0, 1.5, 10) looking down −Z, fov 90°, 640 × 360, near 0.5 m. The grid's far plane is 10.225 m; the lamps' ranges
  span view x 0.22 to 0.92, y −0.35 to 0.35 and depth 9.575 to 10.225, inside cluster [8, 4, 23] (x 0 to 1.127, y
  ±0.564, depth from 9.017).
- **The switches** (`switchDoc`, AC4): 2,048 fill lamps `sw_0000` … `sw_2047`, 64 × 32 at 1.2 m, 0.5 m up, 100 lm,
  range 0.8 m, hidden at first; a showpiece at 320 × 180; eye (0, 75, 55), near 50 m. Fullest cluster 48.
- **The hall** (`hallDoc`, AC5): floor 78 m × 39.2 m with four walls 3 m high on a 200 m × 140 m ground; 2,047 fill
  lanterns `h_0000` … `h_2046`, 64 × 32 at 1.2 m, 0.4 m up, 60 lm, range 0.7 m; `keeper` at (0, 1.5, 19.2), 3,000 lm,
  range 4 m, `receivers: "hall"` (`hall_floor` and the walls); a showpiece at 960 × 540; eye (0, 72, 60), target
  (0, 0, 6), near 55 m. The 20 points: x −1.6 to 1.6 by 0.8, z 20.5 to 22 by 0.5. Fullest cluster 47.
- **The room** (`roomDoc`, AC6): #485's room and its 40 key lights (`key_00` … `key_39`); 1,024 fill lamps
  `fill_0000` … `fill_1023` on a 16 × 8 × 8 lattice, 5 lm, range 0.2 m. `capDoc`: n fill lamps over a slab in a class.
- **The glow** (`glowDoc`, AC7): 200 fill lamps `g_000` … `g_199`, 20 × 10 at 0.12 m × 0.2 m, 2 m up, 100 lm, range
  5 m; the floor under the operator `bands`; `light_policy: {per_cluster: 200}`; 480 × 320; eye (0, 3, 6), fov 40°.
- **The night city** (`cityDoc`, AC8): 2,048 posts `post_<i>_<j>` on a 64 × 32 lattice at 12 m, 4 m up, 1,200 lm: a
  fill point lamp where i + j is even, a fill spot lamp (aimed down, `inner: 30`, `outer: 50`) where odd; range
  6 + 6 × ((7 i + 13 j) mod 8) ÷ 7 m; a ground slab and 128 blocks; a showpiece at 1920 × 1080; the camera orbits the
  origin once in 10 s, elevation 55°, distance 620 m, fov 60°, near 350 m; 30 frames a second. Over the orbit at least
  1,436 lamps are in view and the fullest cluster holds at most 47.

## The CPU references

`reference.ts`, in f64, from geometry and these rules alone; nothing is taken from the renderer.

- **A lamp's light** (the design: Light and the light policy): intensity lm ÷ 4π cd; illuminance I cos θ ÷ d² times
  the window (1 − (d ÷ range)⁴)², 0 from `range` on; a matte's radiance ρ E ÷ π (as #446's suite reads one). Checked
  against the base's key lights, which shade by the same formula: 32 key lamps on this road, seen as `STREET_VIEW`
  sees it, read within 0.26% of it on every lit pixel (about 7,900).
- **The score** (the design: "power ÷ max(d², r²) inside its range, times its range's overlap with the frustum, plus
  a priority bonus"; the base's `light.rs: scores` pins it): power ÷ max(d², radius²) from the eye, times
  2^priority, and 0 when the range's sphere misses the frustum's four side planes or its near plane (a perspective
  view has no far plane).
- **The bucket and the order** (the design: "ordered by (score bucket, ID)"; the width is the base's `policy_by`):
  bucket −floor(log2(score) × 8), eight a stop; lower buckets first, then IDs by their bytes.
- **The cut and the margin's ramp** (the design: "margin = 10% (lights near the cut dim by score)"; the ramp is the
  base's `policy_by`, the rule key lights use today): over the ordered lights, the first `cap` are kept and the cut
  is the next one's score; a kept light weighs clamp((score − cut) ÷ (0.1 × cut), 0, 1); with `cap` or fewer every
  weight is 1. A view's key lights take it at 32; a cluster takes it at `per_cluster` over the lights that reach it
  (the issue: "keeps the top 64 by (score bucket, ID), dims those within the policy's 10% margin by score").
- **An automatic range** (the issue's scope; the design's √(power ÷ (4π × threshold)); `exposure: EV100` scales
  linear light by 1 ÷ (1.2 × 2^EV100)): the cut is the illuminance at which a white diffuse surface, radiance E ÷ π,
  reaches 1/4,096 after exposure, π ÷ (4,096 × scale); the range √(power ÷ (4π × cut)). At EV100
  log2(0.05 × 4,096 ÷ (1.2 π)) = 5.7635 the cut is 0.05 lx and an 800 lm range 35.68 m, today's.
- **The grid** (the base's `clusters.rs`, "the cluster grid the policy already uses"): 16 × 9 tiles, 24 slices growing
  by a fixed ratio from the camera's near plane to the far plane, which is the farthest any shaded light's range
  reaches ahead of the eye. Used to name AC3's cluster and to keep each fixture's fullest cluster under its cap.
- **The view**: #378's pinhole and the orbit rig's eye, target + distance · (cos el · sin az, sin el, cos el · cos az).

## Readings where the issue and design leave a choice

- **"A street"** is one straight row of lamps over the road's middle. **"With rays off"** is the base's raster light;
  no fixture turns rays on.
- **The street's view** (AC1, AC9) is free in the criterion. The whole street in one frame is 0.37 px to the metre,
  where the base's own key lamps read up to 2.0% off the CPU sum at the street's ends (27 of 332 lit pixels over 1%);
  so the view takes 2 px to the metre, where they read within 0.26%, and holds 98 lamps, three times the old cap.
- **"Lit"** is a road point whose CPU sum is at least 0.05 lx: the issue's own cut at the fixture's exposure, where
  a white surface sits under one 8-bit code value. Read as any light at all, the criterion fails on the base's own
  key lamps: at a pool's rim, where the window falls to 0, 0.56% of such pixels read over 1% off.
- **"The fixture's exposure"** is EV100 5.7635, the one the issue names: "at the exposure where that equals 0.05 lx,
  ranges are today's", which is also where the planted fixed 0.05 lx gives "the 8 lm lamps a 3.6 m range" while the
  800 lm lamps keep theirs. **"Exposure raised by log2 100 EV"** is 100 times the light on the picture: EV100 lower
  by log2 100.
- **A road pixel** is one whose 3 × 3 block shows `road` in the ID target (AC1), so it lies wholly on the road and its
  one shading sample is its centre's; AC9 takes every pixel that shows `road` in either frame. "Within 1%" is every
  channel.
- **"The first dimmed lamp by ID"** is the first lamp, in ID order, with at least 20 lit pixels nearest to it whose
  median reading is under 0.99 of the sum. The planted test expects the first such lamp the CPU reference of the
  32-light policy leaves under weight 0.99.
- **"The same pose"** is the orbit's frame 49 at 30 frames a second. **"By a seek"** is a session opened at frame 150
  and sought to 49. **"Created in a shuffled order"** is the same items listed, and given their order keys, in a
  seeded shuffled order. **"Two runs"** are two processes. **"Naming the cluster"** is `cluster [x, y, s]`.
- **"Whose ranges all reach one cluster"** (AC3) is every range inside one cluster and outside every other, so one
  cluster is over budget. **"Raised once"** is one notice over three still frames, in the first.
- **"One at a time … over 10 s, and back"** (AC4) is lamp k on at (k + 1) × 10 ÷ 2,048 s and the reverse over the
  next 10 s, drawn at 60 frames a second, so a frame shows the three or four that switched since the last; a lamp is
  switched by its `visible`. **"On the reference Mac"** for a count is the Metal device of a Mac the lane lists
  (model, chip, memory); its power, heat and load don't change a count.
- **"A lamp whose receivers are its room's collection"** (AC5) is one lamp, the keeper, among 2,047 with no
  receivers whose ranges don't reach the sampled ground.
- **"Change neither count"** (AC6) is the shaded key lights and the lights `lights_over_budget` lists. **"Refused at
  check"** is the document check `live` runs, which `view3d` skips.
- **"A three-band light response … that returns 0.01 a call"** (AC7) is #485's three bands with the top band 0.01,
  every lamp in the top band at the pixel. 200 lights in one cluster need `per_cluster: 200`, which a u8 holds.
- **AC8**: "10 ms of GPU a frame", the cluster pass and the scoring are each run's p95 over its 300 frames (the
  design: a frame-time limit gates at p95 over at least 300 frames). "4 MB" is 4,000,000 bytes, the budget table's
  megabyte. "Each measurement" is the four the sentence lists: the frame's GPU time, the cluster pass, the scoring
  and the lists; an estimate's distance is |median estimate − median measurement| ÷ median measurement (the bytes:
  at each sampled frame). The timings use a release build, since a debug build's CPU time isn't the product's.
- **"On the reference Mac … against the merge base"** is the perf lane's rule, as #468's suite reads it: five runs
  after a warm-up judged by `scripts/benchmark.mjs`'s `judgeLimit` with each run's load, a budgets.json task the
  lane runs beside the merge base, and this file in `timed`. Mains power never gates here (the owner's rule, as
  #380's, #1958's and #1971's suites record it): the lane's fingerprint is handed to its judge with `power` set to
  mains, so its list of Macs, Low Power Mode, the thermal state, the macOS build and the load decide. The design's
  sentence and the lane's own judge name mains power; if that is wanted, it is one word in `helpers.ts: judgeLimit`.
  Nothing waits for the machine to quieten.
- **AC9's lamps** are the street's fill lamps with `range` left out: an automatic range is finite, so a fill light
  may take one. **"Naming the first lamp whose range changed"** is the first lamp, in ID order, that both frames
  list with ranges more than 0.1% apart.
- **"The same street under the 32-light policy"** (AC10) is the street with `fill` left off every lamp, so the key
  policy shades 32: what the base draws today. No planted program draws a picture shown to you.

## The taste call

`taste.test.ts` writes these to `DEEPBUILD_EVIDENCE_DIR` (else `deep-1634-evidence` under the temporary folder),
each with its SHA-256 in its name, and prints their paths:

| File | What it shows |
|---|---|
| `street-512-<sha256>.png` | The street of 512 fill lamps at 2.2 s of the orbit, looking down its length, 1280 × 720, filmic at EV100 1; the canvas's final PNG byte for byte |
| `street-512-orbit-<sha256>.apng` | Its 10 s orbit: 150 frames at 15 a second, 640 × 360, the canvas's final frames |
| `street-32-<sha256>.png` | The same street, time, camera and look with `fill` off every lamp: the policy's 32 |
| `street-32-orbit-<sha256>.apng` | Its 10 s orbit |

They are attached to the PR and shown to the owner in the session; the answer is recorded in the file
`DEEPBUILD_TASTE_1634` names (surface 12). No record, or one on other SHA-256s, is INCONCLUSIVE; `looks_wrong`
fails; `looks_right` on exactly this run's files passes. No other test reads these files or the call.

## Oracle

The oracle page was read: no criterion has an upstream test (0 of 10, and none with test data our code can read), so
every expected value here is the issue's own and nothing is ported. The page notes that upstream clustered-light
tests check caching only, with no value oracle.

## Not tested, because no criterion asks

The refusals of a fill light with `shadow: true` or with no finite range (scope only), and `fill` on a sun or an
area light; fill lights under the status-color rule and the status guard; a fill spot's cone held to a CPU reference
(AC8 draws spots but reads hashes and times); a fill light's IES distribution, light function or flicker; a
document that tightens `fill_shaded`; `per_cluster` out of range; `cluster_over_budget` across a moving view and its
"once per change" beyond three still frames; clusters in an orthographic view; the whole street in one frame held to
1% (Readings); the web player and figures; the camera's own `exposure` as the cut's source; the starting values'
calibration; `deep_kinds` listing the new fields; shadows from fill lights and light from emissive surfaces (out of
scope). The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof).
