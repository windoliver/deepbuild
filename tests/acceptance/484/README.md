# Acceptance tests for #484: GPU-driven draws — instancers culled on the GPU and drawn from counts the GPU wrote

Written first, from issue #484 (its scope, 5 acceptance criteria and proof line), its Oracle page
(`doneright/oracles/issues/484.md`), the design sections it links and those they lean on, and base commit `80ba48fe`
("Merge pull request #1403 …", which holds #424's picks and #483's structural steps), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean: one test per criterion, plus exactly the planted wrong programs
each criterion names.

**Not run.** No Rust was built and no test has run against any binary; only the type-check and the fixtures' own
numbers were checked (`BASE-FAILURE.txt`). A surface below that doesn't fit what the design needs is a dispute for the
redraft, not an edit.

## What was read

- Issue #484 and its Oracle page, which says no upstream test covers any criterion, so this suite ports none.
- `docs/canvas-primitives.md`: Instance `instance@1` (fields, Semantics, Cost, It can never), GPU operators, as data
  (GPU operator; Step and the closed step list and its structural steps; Operator input; Operator output; Place in the
  frame; Operator cost and limits; Every public step; Operator budgets by class).
- `docs/technical-design.md`: GPU operator; Numbers version 0 has to hold.
- At the base: AGENTS.md; `tests/acceptance/483/` and `424/` (the models for this suite), `429/seek.test.ts` and
  `classes.test.ts`; `crates/deep-gpu-layer/src/{main,view3d,opframe,session3}.rs`;
  `crates/deep-canvas-scene3d/src/{cut,scene,spatial,spec}.rs`; `crates/deep-canvas-effects/src/{graph,check,module}.rs`;
  `crates/deep-effects-render/src/docops.rs`; `scripts/lanes.mjs`.

## What the base already does, which these tests don't credit

`instance@1` reads `of`, `proto`, `ids`, `pos`, `rot`, `yaw`, `scale` and `hidden`, and every shown element becomes its
own solid on the worker, each frame, drawn by ordinary instanced draws with no view cull. A click names
`<instancer>#<id>` from the object-ID target, and depth ties go to the later draw, so the clicks in criterion 2 may
well pass at the base; `index-order.test.ts` fails there on its `indirect_draws` and `cull_report` checks.

`view3d` has `counts`, `cascades` (`maps`), `clicks`, `read`, `pixel_hash` on every frame, and `from`, which opens a
fresh session at a frame. Its session closes when the call ends, so nothing can seek inside a session. `check_operator`
runs frames of operators with `data` and `read`, and `compact@1` gives `.out` and `.count`. `elements` is a number;
every storage output starts the frame at 0; there is no `instances` output (particles reach their instance buffer
through a plain storage output), no indirect draw or dispatch anywhere, no GPU cull, and none of the six planted names
below. `spatial.rs`'s `cull_by_center` is #421's plant on the CPU's item queries, not this suite's plant.

## Run them

They build `deep-gpu` with cargo, so they run one file at a time. `scripts/lanes.mjs` needs `'tests/acceptance/484/'`
added to its `alone` list, beside `'tests/acceptance/483/'`; this README is the instruction, and the implementer makes
that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/484 --no-file-parallelism
npx tsc -p tests/acceptance/484/tsconfig.json   # type-check
```

Each file builds its binary once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu`, copies it out of the target folder and fails each test that uses it if the build failed. Each test writes
into its own temporary folder and deletes it. No test needs the `test-meter` build, a reference Mac, or a timing.

- Anything the GPU runs runs on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never passing.
- A missing counter or report reads as `null` and fails that frame's check; nothing absent passes.
- `taste.test.ts` stays `INCONCLUSIVE:` until `TASTE.json` records the call on this run's screenshots.
- `BASE-FAILURE.txt` says why the suite wasn't run at the base.

**Runtime.** The forest's orbit is sampled at 6 frames a second: frames 0 to 60, t = n ÷ 6 s, all of 0 to 10 s, in three
calls (61 or 62 full frames at 960 × 540 each). The twins' orbit takes the same 61 frames once, at 320 × 180. Each plant
draws one or two frames, but for `compact_in_reverse`, which repeats the twins' 61, and `dispatch_without_guard`,
which repeats the frame of 1,000,003 elements.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged,
#378's `view3d` and #483's `check_operator` frames, with the fields below added, three operator forms, and six planted
programs. The issue and design name the behaviors but not these fields; each is this job's choice, in the file's style.

### `view3d`: fields added to the request

| Field | Meaning |
|---|---|
| `cull: "cpu"` | The document drawn from the CPU's f64 cull of the same elements, each kept element drawn as the GPU path draws it. Absent, the shipped GPU cull. This is criterion 1's reference, not a mode a document can ask for |
| `cull_report: true` | Each captured frame adds `cull` (below) |
| `seeks: [{after, to}]` | Right after frame `after` draws, the same session jumps to frame `to`: the next frame drawn is `to`, with nothing drawn between. `frames` still counts every frame drawn, so `from: 60, frames: 2, seeks: [{after: 60, to: 12}]` draws 60, then 12 |

### `view3d`: fields added to each frame

With `counts: true`, beside the base's `encoded`, `replayed`, `instances_written`, `meshes_built` and `compiled`:

| Field | Meaning |
|---|---|
| `cpu_culled: n` | Elements the worker tested against a view on the CPU this frame: 0 on the shipped path; on `cull: "cpu"`, at least the instancer's count whenever a view changed |
| `counts_read_back: n` | How many times this frame mapped a cull's or a compact's count, or the draw arguments written from one, for the CPU to read. `cull_report` and `read` copy after the frame has drawn, and don't count |
| `indirect_draws: [{item, view, batch}]` | One row per indexed indirect draw of an instancer this frame: `item` the instancer, `view` as below, `batch` naming its (prototype mesh key, material) |

With `cull_report: true`, on each captured frame:

`cull: [{item, view, batch, count, kept}]`, one row per (instancer, view, batch), as the cull last wrote it, so a cascade
not redrawn reports its last cull and a batch with no survivors has a row with count 0. `view` is `"view"` for the
camera's view and `"cascade<k>"` for the key sun's cascade k. `kept` is a SHA-256 naming `<sha>.u32` under `out`: `count`
little-endian u32 words, the kept elements' stable IDs in compacted order. An instancer drawn from an `instances` output
reports the same row for the rows it drew. The report is read after the frame draws and nothing drawn reads it.

### `check_operator`: field added to the reply

`costed_elements: {<op> → n}`, the elements the check costs each compute operator at: `elements` when it's a number, its
`max` when it's `{from, max}`.

### Operator forms

| Form | Meaning |
|---|---|
| `elements: {from: "<op>.<output>", max}` | The design's indirect dispatch. `<output>` holds the `u32` count a compact wrote earlier in the frame |
| `{storage: {type, count, clear}}` | `clear`, a u32 word, is what every row holds when the frame starts; 0 when absent, as today |
| `{instances: {instancer, columns: [], count: "<compact step>"}}` | The design's `instances` output. With `count`, it draws only the rows that step kept, by one indexed indirect draw per batch, row r drawing the element at the step's `out[r]`, its columns the instancer's own |

An item `gpu.compute@1` in a document may hold this output, with the document's other operators before it (`after`), as
#429's items do. A document's `instance@1` takes `visible: false` on its prototypes, as the base already allows.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

Added to `Planted` in `crates/deep-gpu-layer/src/main.rs`.

| Name | The wrong program | Criterion |
|---|---|---|
| `gpu_cull_by_center` | The GPU cull keeps an element only when its center is inside the view, ignoring its bounds | 31f1249b |
| `count_read_back` | Each draw's count comes from the CPU's read-back of an earlier frame's count, a frame late, so the frame after a seek draws the frame before the seek's count | 31f1249b |
| `compact_in_reverse` | The cull's compaction writes survivors in reverse index order | 7e241cd4 |
| `ids_by_compacted_row` | The object-ID pass takes a row's place in the compacted list as the element's index and writes that element's ID: 5,742, at place 242, writes 5,242 | 7e241cd4 |
| `row_as_element` | An `instances` output with a count draws element r for row r, instead of the element at `out[r]` | a2d2a0c9 |
| `dispatch_without_guard` | An indirect dispatch runs `max` invocations, with no guard against the count | ca2dfa6e |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped.
Each test's name starts with its ID. Each file's header states its fixture, numbers and wrong programs in full.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#484.31f1249b` | `redraft-1637/forest.test.ts` (2, the blind redraft after #1637: the camera's kept set compared through `occlusion: "off"`), `forest.test.ts` (1) | Over the orbit's 61 frames: each frame's pixel hash equals the `cull: "cpu"` frame's; in each of the 5 views the GPU's kept set holds the CPU's and neither keeps every tree; `cpu_culled` and `counts_read_back` are 0, with `cull: "cpu"`'s `cpu_culled` over 100,000 as the control; one indirect draw per batch (2) for the view at every frame and for each cascade at frame 0; 4 shadow maps. The seek from frame 60 to 12 in one session hashes as playing's frame 12. Twins `gpu_cull_by_center` (names trees#73105 and frame 0) and `count_read_back` (names frame 12) |
| `#484.7e241cd4` | `index-order.test.ts` (3) | At each of 61 orbit frames the click at the twins' pixel names trees#5011, by one indirect draw; with IDs below 5,500 outside the view the view keeps exactly 5,500 to 5,999 in order, and the click at 5,742's pixel names trees#5742. Twins `compact_in_reverse` (shows trees#5010) and `ids_by_compacted_row` (another element), each naming the pixel |
| `#484.a2d2a0c9` | `crowd.test.ts` (2) | `crowd.count` is 2,000, `crowd.kept` holds 5r in row r, the view drew 2,000 by one indirect draw, and a click at each of the 10,000 cells names a kept agent there and nothing elsewhere, kept row 999's pixel naming agents#4995. Twin `row_as_element` names agents#999, naming the pixel |
| `#484.ca2dfa6e` | `counted-dispatch.test.ts` (2) | `cull` keeps 300,017 of 1,000,003 in order; `worker.out` equals the CPU's on rows 0 to 300,016 and holds 0xFFFFFFFF on rows 300,017 to 1,048,575; `costed_elements.worker` is 1,048,576. Twin `dispatch_without_guard` names row 300,017 |
| `#484.b58c79f0` | `taste.test.ts` (1) | Writes the two screenshots and reads `TASTE.json`: absent or on other SHA-256s INCONCLUSIVE, `looks_wrong` fails, `looks_right` on exactly these passes |

## The taste call

`taste.test.ts` writes, from one run's output, to `docs/evidence/484/`, each a byte copy of the renderer's final target
(so its SHA-256 is the renderer's own name for it), printing each SHA-256:

| File | What it shows |
|---|---|
| `forest.png` | The 100,000-tree forest at frame 0, drawn from GPU counts |
| `crowd.png` | The composed crowd of 2,000 kept agents |

They are attached to the PR and shown to the owner in the session. The owner's answer is recorded in
`tests/acceptance/484/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record it:

```json
{"issue": 484, "criterion": "#484.b58c79f0", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"<file name>": sha256, … both}, "note"?: string}
```

No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this
run's pictures passes. No other test reads these pictures or the call.

## Fixtures

None on disk: every document is generated in the test files, or in `helpers.ts` where the taste test shares it.

- **The forest** (`helpers.ts: forest`): 100,000 trees, row i with ID i, two lathe prototypes (oak, pine) so two batches,
  on a strip 1,600 m by 300 m along X, under a key sun casting 4 cascades out to 300 m. The camera orbits the origin at
  170 m and 20° up. From +Z it looks across the strip, and at t = 2 s, azimuth 72°, along it: about 29,700 trees in view
  at 2 s against 9,300 at 10 s, by a reference frustum in a scratch run. So a stale count from 10 s draws about 20,000
  fewer trees at 2 s, and `forest.test.ts` asserts that the 2 s count is the larger.
- **The crown tree**, row 73,105, an oak at twice size. At frame 0 its base lands at x = 965, its middle at x = 973 and
  the center of its crown at x = 976 in a frame 960 wide, while its crown reaches in to x = 942. No other tree's base
  lies within 140 px of (960, 300) there, so nothing covers pixel (952, 300), which only a test of bounds keeps.
- **Agent 999 stands exactly where agent 4,995 stands** (`helpers.ts: place`). It isn't alive, so it never draws in a
  right program. It's there so `row_as_element` names agents#999 at kept row 999's pixel whichever way a program takes
  row r as element r: drawing element r's own place, or writing element r's ID on the row that kept its place.
- **The flags of criterion 4**: row i is set when (i × 7,919 mod 1,000,003) < 300,017. 1,000,003 is prime, so exactly
  300,017 are set. Row 300,017 falls inside the last workgroup of 256 (1,172 × 256 = 300,032), so the guard is tested
  inside a workgroup as well as past it.

## Readings where the issue and design leave a choice

- **"Every frame" of a 10 s orbit** is every frame of a 6 fps play: 61 frames over the whole 10 s, 6° apart. The cost of
  each frame is what the owner asked to keep down, and a cull that fails at some pose fails in a neighborhood of poses.
- **"The GPU's kept set"** is the union over a view's batches, by stable ID, reported per view and cascade. "Always
  contains" is also held against a cull that keeps everything: neither side may keep all 100,000, or the hash and the
  containment would pass with nothing culled.
- **"No count read back"** has two proofs: `counts_read_back` is 0 on a run that reports nothing else, and the plant's
  stale frame fails by pixel hash. A separate run reports the kept sets, so its copies can't stand in for the draw path.
- **"A seek"** must be inside one session, since a stale count needs a frame before it; `from` opens a fresh session
  with none, so this suite adds `seeks`. The plant's twin is the same call without the plant, so only the plant differs.
- **"Draws the previous frame's count"** is judged by the frame's pixel hash, the one outcome the criterion names.
- **"The worker culls no element on the CPU"** is `cpu_culled`, with `cull: "cpu"` reporting over one pass as the
  control that the counter counts and that the reference is the CPU's path.
- **"Drops a tree whose crown enters the frame"** is the crown tree at frame 0: it leaves the kept set and its click
  stops naming it. A failure names both the element and the frame.
- **"Shows 5,011"** is the name a click at the twins' pixel gives. The twins share a batch, so they share a material
  and color; the object-ID pass writes in the same draw, so a tie it shows is the tie the color shows. Click pixel (160,
  90) is the frame's center, where the orbit holds them.
- **"With every element below 5,500 culled"** is those rows standing 2 km outside the view, so their exclusion is no
  judgment call for a conservative test.
- **"Names another element"** requires a name other than trees#5742 at that pixel; "nothing" isn't a pass for the plant.
- **"A composed crowd's instances output"** writes no column: `columns` is empty, and the agents' places are the
  instancer's own `pos` column. The criterion is about which rows draw, and no criterion here asks for a column written
  through the output. Alive flags are `u32` words, which `compact@1` already takes.
- **"Draw 2,000 instances"** is judged by what drew: a click at every cell, plus the reported count. The clicks need no
  picture: each names what the object-ID target holds, within #424's margin of 3 px, and neighbors are 8 px apart.
- **"The cull's count output"** in criterion 4 is the output of an operator this suite names `cull`, a `compact@1`. The
  core's own per-view cull is not an operator a document can read, and its count never leaves the GPU layer.
- **The sentinel** needs a storage output that starts at it, so this suite adds `clear`. An operator can't write another
  operator's output, so a first pass filling the rows wasn't an option.
- **"The check costs it at 1,048,576 elements"** is `costed_elements`, the number the design's per-frame sum multiplies
  (Operator cost and limits: "an indirect dispatch at its `max`"), with the fixed-count `cull` as its control.
- **The shared fixtures live in `helpers.ts`**, as #424's do, because the taste test draws the same scenes.

Not tested, because no criterion asks: the threshold of exactly 256 elements, `hidden` under the GPU cull, a cull over
rows whose IDs aren't in row order, a negative determinant's winding flag, `rot` and `yaw` in the cull, writing columns
through an `instances` output, `max` past the cap, the rule that the cull reruns only when a view or the arrays change,
the design's cost estimates, the class's compute-element cap, and a `live` session.
