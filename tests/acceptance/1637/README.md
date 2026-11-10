# Acceptance tests for #1637: occlusion from this frame's depth

Written first, from issue #1637 (its scope, 5 acceptance criteria and proof line), its Oracle page
(`doneright/oracles/issues/1637.md`: no upstream test covers any criterion, so this suite ports none), the design
sections it links and those they lean on, and base commit `a3efe5c8`, by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding). Lean: one test per criterion, plus exactly the planted wrong programs each criterion names.

**Not run against a binary.** The machine's load was about 250 on 18 cores, so no Rust was built; only the type-check,
the perf-lane recording test and the fixture's own numbers were checked (`BASE-FAILURE.txt`). A surface below that
doesn't fit what the design needs is a dispute for the redraft, not an edit.

## What was read

- Issue #1637 and its Oracle page.
- `docs/canvas-primitives.md`: Instance `instance@1` (Semantics, Cost, It can never); Light and the light policy and
  its cascades; Light probe `light.probe@1` and its capture set; Inset; Look `look@1`: ao (the depth and normal prepass).
- `docs/technical-design.md`: Dogfooding, "Who drafts it" and "Proven on the base".
- At the base: AGENTS.md; `tests/acceptance/484/` (the model: its surface, fixtures and plants), `483/`, `424/`, `428/`
  and `1434/` budgets; `crates/deep-gpu-layer/src/{main,view3d,session3}.rs`; `crates/deep-scene3d-render/src/{lib,cull,ao}.rs`;
  `crates/deep-canvas-scene3d/src/{scene,probe,spec,module}.rs`; `crates/deep-effects-render/src/frame.rs` (`timings`);
  `scripts/{benchmark,perf,lanes}.mjs`; `benchmarks/budgets.json`.

## What the base already does, which these tests don't credit

#484's GPU cull keeps instancer elements per view and per cascade by frustum, reports them through `cull_report` and
draws from GPU counts; `seeks`, the object-ID target (`targets: ['ids']`, `picks`) and `timings` (`gpu_ms`,
`passes_ms`) exist. There is no depth pyramid, no occlusion test, no `occlusion` field, no `kept_items`, no
`declared_ms`, none of the four planted names below. The depth and normal prepass draws only while the look has ao on
(`ao.rs`). A reflection probe's capture is made on the CPU in `probe.rs` (8-texel faces) and draws nothing in the look.

## Run them

They build `deep-gpu` with cargo, so they run one file at a time. The implementer adds `'tests/acceptance/1637/'` to
`alone` and `'tests/acceptance/1637/budgets.test.ts'` to `timed` in `scripts/lanes.mjs`, and a task to
`benchmarks/budgets.json` whose `initialReason` names #1637 (below); this README is the instruction.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1637 --no-file-parallelism
npx tsc -p tests/acceptance/1637/tsconfig.json   # type-check
```

Each file builds its binary once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu`, copies it out of the target folder and fails each test that uses it if the build failed. Each test writes
into its own temporary folder and deletes it.

- Anything the GPU runs runs on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never passing.
- A missing report reads as `null` and fails that frame's check; nothing absent passes.
- `budgets.test.ts`'s timing test asks the perf lane's `judgeLimit` first whether this machine can judge a timing
  (a reference Mac on mains power, Low Power Mode off, thermal state nominal) and is `INCONCLUSIVE:` when it can't.

**Runtime.** The walk is sampled at 6 frames a second for criteria 1 to 4: frames 0 to 60, t = n ÷ 6 s, all of 0 to
10 s, at 960 × 540, twice (shipped and `occlusion: 'off'`), as #484 sampled its orbit. The seek draws 62 frames and one;
the cut 8 frames, twice per program; the bench and the statue one frame per call. Criterion 5 draws the walk at
1920 × 1080 and 30 frames a second, 301 frames, twice a run, for one warm-up run and five.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged,
#378's `view3d` with #424's object-ID target and #484's `cull_report` and `seeks`, with the fields below added and four
planted programs. The issue names `occlusion: off`; the rest is this job's choice, in #484's style.

### `view3d`: field added to the request

| Field | Meaning |
|---|---|
| `occlusion: "off"` | The issue's `occlusion: off` on a view: the camera's passes cull by the frustum only, with no pyramid test, and draw the same frame. Absent, the shipped occlusion cull. Every other pass is the same either way |

### `view3d`: fields added to each frame

With `cull_report: true`, on each captured frame, beside #484's `cull` rows:

| Field | Meaning |
|---|---|
| `kept_items: [{view, count, kept}]` | One row per pass that draws whole items, as the pass last drew them: the items it drew. `view` names the pass as #484's rows do (`"view"` the camera's passes, `"cascade<k>"` the key sun's cascade k), plus `"probe:<item>"` for a reflection probe's capture (all its faces) and `"inset:<item>"` for a view inset. `kept` is a SHA-256 naming `<sha>.json` under `out`: a JSON array of the `count` item IDs. Instancers stay in `cull`, whose `view` takes the same two new names where an instancer draws there |

So a pass's kept set is its `cull` rows' elements, named `<instancer>#<id>`, and its `kept_items` row's items, named
by ID: the names the object-ID target's `picks` give. In the `"view"` rows, the shipped path reports what survived the
occlusion test, and `occlusion: "off"` what survived the frustum.

With `timings: true`, on every frame, beside `gpu_ms` and `passes_ms`:

| Field | Meaning |
|---|---|
| `declared_ms: {<pass> → ms}` | What each timed pass's declared cost model prices this frame at, at least for `scene3d.depth_pyramid` |

The pyramid's pass is named `scene3d.depth_pyramid` in `passes_ms` (its measurement) and `declared_ms`.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

Added to `Planted` in `crates/deep-gpu-layer/src/main.rs`.

| Name | The wrong program | Criterion |
|---|---|---|
| `pyramid_from_previous_frame` | Each frame's occlusion test reads the pyramid built from the previous frame's prepass | 27a6396a |
| `occlusion_by_centre` | The occlusion test tests each element's or item's centre against the pyramid, in place of its conservative screen bounds | 4c39d672 |
| `occlusion_in_cascades` | The camera's occlusion test is also applied to the cascade passes' sets | 2d8df0a5 |
| `occlusion_in_probe_captures` | The camera's occlusion test is also applied to reflection probe captures' sets | 2d8df0a5 |

### The perf lane

A task in `benchmarks/budgets.json` whose `initialReason` names #1637, with a command that draws the walk at 1920 ×
1080 both ways (the implementer's, in the style of the canvas tasks there), so the perf lane runs it beside the merge
base; and `tests/acceptance/1637/budgets.test.ts` in `timed`, which holds the numbers.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped.
Each test's name starts with its ID. Each file's header states its fixture, numbers and wrong programs in full.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#1637.1a41b696` | `walk.test.ts` (1) | At each of the walk's 61 frames: the shipped frame's pixel hash equals `occlusion: 'off'`'s, in one process; every element and item with a pixel in the unculled object-ID target is in the shipped camera kept set (and in the frustum's); at least 80% of the frustum's kept set has no pixel, from at least 10,000 kept; the shipped kept set is smaller than the frustum's |
| `#1637.27a6396a` | `this-frame.test.ts` (2) | Frame 12 drawn while playing and again after the seek from frame 60 hashes as the unculled frame 12 and keeps its ID target's elements; across the cut, frames 0 to 7 do the same, and street#77777 has no pixel at frame 5 and pixels at frame 6. Plant `pyramid_from_previous_frame` fails naming `frame 6: element street#77777` |
| `#1637.4c39d672` | `bounds.test.ts` (2) | At frame 0 the bench street#31415 is kept, has at least 50 px, and the ID target at its centre's pixel holds the bin street#31416; the hash matches. Plant `occlusion_by_centre` fails naming `element street#31415` |
| `#1637.2d8df0a5` | `shadows.test.ts` (3) | With 4 cascades, at frame 0: the hash matches; every pass but the camera's keeps exactly what `occlusion: 'off'` keeps there; `statue` has no pixel yet the frustum, a cascade and `probe:probe` keep it; at least 200 ground pixels are darker with it than without it. Plants `occlusion_in_cascades` (names `pass cascade<k>: element statue` and the frame's hash) and `occlusion_in_probe_captures` (names `pass probe:probe: element statue`) |
| `#1637.5eb3096a` | `budgets.test.ts` (2) | Five runs after warm-up at 1920 × 1080, judged by the perf lane's `judgeLimit`: p95 `gpu_ms` shipped ÷ `occlusion: 'off'` at most 0.7; `scene3d.depth_pyramid`'s median declared cost within 25% of its median measurement. The perf lane records it: a `budgets.json` task names #1637, and this file is in `timed` |

## Fixtures

None on disk: every document is generated in `helpers.ts`. The numbers below were checked by a scratch CPU ray cast
over boxes (not kept; lathes taken as their bounding boxes, so it overstates what shows).

- **The city** (`helpers.ts: cityDoc`): 20,000 building items `b00000` to `b19999`, 20 × 20 m and 10 to 30 m tall
  (seed 1638), on a 200 × 100 grid of 32 m blocks with 12 m streets (a 6 m road, 3 m sidewalks); 100,000 street items
  in one instancer `street`, row r with ID r (seed 1637), lamps, trees, benches and bins (four batches) 3.5 to 5.5 m
  from a street's centre line; a 6,420 × 3,220 m ground item `ground`; a kiosk, a statue and a reflection probe. No
  generated street item stands within 60 m ahead of (or 10 m behind) the walk's or the cut's camera on its street.
- **The walk**: the camera 1.7 m above the street at z = 1,601, from x = 1,296, walking +X at 1.4 m/s and looking along
  the street, 60° across the frame, near 0.1 m, far 3 km. At 0 s and 7.5 s about 30,400 elements and items are in the
  frustum and about 90 have a ray at 960 px: over 99% hidden, against the 80% the criterion asks.
- **The bench and the bin**: street#31415, a 1.8 m bench across the view 10 m ahead and 2 m right; street#31416, a bin
  6 m ahead on the line from the eye to the bench's centre. The ray to the bench's centre meets the bin's 0.22 m core;
  about 780 px of the bench's front face show at its ends.
- **The kiosk and the statue**: `kiosk`, 2.5 m tall, 8 m ahead and 3 m left; `statue`, 2.4 m tall, 12 m ahead and
  4.5 m left. None of 363 rays to the statue's surface reaches it. Under criterion 4's sun, 20° up straight ahead, its
  6.6 m shadow runs back along the sidewalk past the kiosk, about 980 sample points of it in view and in sun without
  it. `probe`, a `light.probe@1` reflection probe 4 × 3 × 4 m, 12 m ahead and 1 m left, 4.5 m from the statue.
- **The cut**: the camera still at (1,296, 1.7, 1,921); its target holds on the facade 7 m away until 0.9 s (no view
  depth in that frame past 7.0 m), then down the street, where lamp street#77777 stands 25 m ahead and 3.5 m right with
  nothing between, its base at pixel (596, 327).

## Readings where the issue and design leave a choice

- **"Every frame" of a 10 s walk** is every frame of a 6 fps play, 61 frames, as #484 read its orbit: the walk moves
  0.23 m a frame, and a culler that fails at some pose fails in a neighbourhood of poses.
- **"At least 80% of elements hidden"** is judged on what the frustum keeps (`occlusion: 'off'`'s camera kept set):
  hidden means no pixel in the unculled object-ID target. Out-of-frustum elements are hidden by the frustum, which
  #484 already culls, so counting them would make the criterion trivial. At least 10,000 must be kept, and the shipped
  kept set must be smaller than the frustum's at every frame, so a culler that keeps everything fails.
- **"The kept set"** is the camera's: the `"view"` rows of `cull` and `kept_items`. "Every element" includes whole
  items, since the issue culls both, so `kept_items` is added: #484's rows cover only instancers.
- **"On one machine"** is one process for criterion 1; for the plants, the unculled frame is drawn by the shipped
  program in its own process on the same machine, since a planted binary is a different program.
- **The walk's sun casts no shadow.** Criteria 1 and 5 are about the camera's passes, which are what occlusion culls;
  cascades redraw their own full sets either way and would only dilute criterion 5's measure. Criterion 4 draws the
  same city with 4 cascades.
- **"A camera cut"** is a hold key on the camera's target, in a variant of the city, since the walk has none; "the
  frame" is the first after the cut. The seek is inside one session (#484's `seeks`).
- **"Drops an element whose edge shows"** is the bench, kept by its bounds while its centre lies behind the bin.
- **"Still casts its shadow into view"** is ground pixels darker with the statue than without it, while the statue has
  no pixel; "untouched" is every pass but the camera's keeping exactly its `occlusion: 'off'` set.
- **"Loses that shadow … naming the pass"** is the statue missing from that pass's kept set, the failure naming the
  pass. For the cascades the frame's hash must differ as well. For the probe it is the kept set alone: at the base a
  probe's capture is made on the CPU and draws nothing in the look, so the issue gives no pixel to read through it.
  The probe takes no `shadows` field, which the base doesn't parse and no check here reads.
- **"GPU time at p95 falls by at least 30%"** is, per run, p95 of the shipped walk's `gpu_ms` ÷ p95 of
  `occlusion: 'off'`'s at most 0.7, the two drawn in one process in alternating order.
- **"Declared cost within 25% of its measurement"** is, per run, |median `declared_ms` − median `passes_ms`| ÷ median
  `passes_ms` for `scene3d.depth_pyramid` over the shipped frames. `passes_ms` is the time the pass's timestamps add to
  the frame (`frame.rs: timings`). Medians, since a declaration prices a typical frame and a p95 would measure noise.
- **"On the reference Mac"** is the perf lane's own rule (`scripts/benchmark.mjs`: `fingerprint`, `judgeLimit`), whose
  list includes this Mac17,10; anything it doesn't PASS or FAIL is INCONCLUSIVE here.
- **"Recorded by the perf lane"** is a `budgets.json` task naming #1637 and this budgets file in `timed`.

Not tested, because no criterion asks: insets (the scope's third pass kind; the kept-set rule covers them when a frame
reports one), `occlusion: 'off'` on a document rather than a view, mesh LOD bands under occlusion, see-through items,
an instancer of 256 elements or fewer, logic-fed instancers, and the pyramid's memory.
