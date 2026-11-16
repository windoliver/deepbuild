# Acceptance tests for #451: particles that flow along curves, paths, routed edges and a vector field's streams

Written first, blind, from issue #451 (its summary, Scope, Fields, four acceptance criteria and Proof line, read live
with `gh issue view 451 --repo windoliver/deepbuild --comments`; it has no comments), its oracle page, the design
sections it links and those they lean on, and base commit `d8c46f0d5` ("Merge pull request #2601 …"), by a job that
never saw an implementation; none existed, and no other worktree, branch, pull request or session was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one file per criterion; the one planted program the criteria name sits behind `deep-gpu run
--planted`, and every other wrong program is made in test code from the run's own readings.

## What was read

- Issue #451 and its oracle page (`doneright/oracles/issues/451.md` in DeepBuildAI/deepbuild, ref `doneright`): no
  upstream test checks any criterion, so nothing is ported and there is no oracle folder.
- `docs/canvas-primitives.md`: Particles `particles@1` and every sub-section, chiefly "space and paths"; Vector field
  `vector_field@1` (streams as sub-paths `<id>#s<i>`, all of them `<id>#streams`, RK4 at a fixed step); Graph and
  layout memory `graph@1` and Route `route@1` (a pinned layout, orthogonal routes, layout memory); Path `path@1`;
  Draw path: GPUI or the GPU layer; Transport (`frame_rate`, the frame interval, display times); Driver; Control
  (`drag_along`, `handle`); Instance `instance@1` and its logic columns; Shot: poses from logic.
- `docs/technical-design.md`: How we know version 0 works (Criteria to tests, Closed issues stay proven, Criteria in a
  checked shape, Wrong programs, Edit guard, Dogfooding, Goldens, Budgets). AGENTS.md.
- At the base, only to find surfaces: `crates/deep-gpu-layer` (`main.rs`: `enum Planted`, `fn call`; `particles.rs`:
  the `particles` call; `film.rs`: `film2d`, its `from`, `frames`, `capture` and reply rows; `parity.rs`: what film2d
  counts as 3D); `crates/deep-canvas-effects/src/particles/` (`spec.rs`: what `motion.along` and `emit` read today;
  `rule.rs`: the check); `crates/deep-canvas-graph` (`view.rs`, `route.rs`); `crates/deep-marks-render` (`graphs.rs`:
  a graph's origin and its routes drawn as polylines; `raster.rs`: `geometry`'s `graph.routes`);
  `crates/deep-canvas-scene3d/src/shore.rs` (`moving_member`: an item placed by a logic array is one whose params read
  `{array: "<logic>.<name>"}`); `crates/deep-show/src/main.rs` (the `vector_field` call); the looks in
  `crates/deep-canvas-marks/looks/`; `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (twins),
  `scripts/lanes.mjs` (`alone`); and the suites `449/` (whose helpers these tests import), `450/` and `225/` (taste
  calls), `399/` (graphs through `deep-canvas-render geometry`), `308/` (a `drag_along` control), `464/` (`film2d`).

## What the base already does, which these tests don't credit

`particles@1` is #449's: `deep-gpu run`'s `particles` call checks a document and gives each 3D particle's CPU f64 closed
form, and `view3d`'s `particles` field hashes each frame's evaluated data. `motion.along` takes one `curve` and one
number `speed`; a `speed` of `[min, max]` is refused at check (`out_of_range` at `items/<id>/params/motion/along/speed`).
There is no `dimensions`, `space`, `emit.anchor`, `curves`, `<graph>#<edge>` curve or `<field>#streams` curve, no 2D
particle, and `film2d` has no `particles` field. A pinned `graph@1` is laid out and routed, and `deep-canvas-render
geometry` answers its routes (#399); a vector field's streams are integrated by RK4 and drawn (#225).

## Run

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease npx vitest run --root tests/acceptance/451 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/451/tsconfig.json   # type-check
rm -rf tests/acceptance/451/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`, with `cargo build --locked --bin <name>` (honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0` and `NO_COLOR=1` unless set, Homebrew's
rustup first on `PATH` when present), and copies each binary into a temporary folder. No cargo feature is needed: the
planted program is `deep-gpu run --planted particles_follow_arrows`. Every `it` passes its own timeout (60 minutes or
twice that); each call writes into the test's own temporary folder, deleted after it, except the taste call's pictures.

| Binary | Build | Files |
|---|---|---|
| `deep-gpu` (`crates/deep-gpu-layer`) | `cargo build --locked --bin deep-gpu` | all |
| `deep-canvas-render` (`crates/deep-marks-render`) | `cargo build --locked --bin deep-canvas-render` | ac1 |

**`scripts/lanes.mjs` needs this suite in its `alone` list**, beside the other `deep-gpu` suites, because its files
build cargo binaries and draw on the GPU. This job writes only this folder; the implementer adds the line:

```js
alone.push('tests/acceptance/451/');
```

Gates: no cargo is `BLOCKED:`, a failed test, never a pass. Every `film2d` and `view3d` reading draws on macOS's GPU:
off macOS, or wherever a reply says `unsupported_platform`, those tests fail with a message starting `INCONCLUSIVE:`,
never passing. The `particles` call and `deep-canvas-render` need no device. `ac4-taste.test.ts` is INCONCLUSIVE until
the owner's call is recorded (below). No test reads a timing.

## The surface under test

The issue names fields and no call. These tests extend the base's `deep-gpu run` calls (#449's `particles`, #378's
`view3d`, #417's `film2d`) and read the base's `deep-canvas-render look` and `geometry` (#399) unchanged. **Every name
below that the issue or the design doesn't give is this job's choice, marked *(chosen)***; the implementer builds
exactly these, or a dispute goes to a blind redraft. #449's README defines the `particles` call, its reply, `view3d`'s
`particles` and `particle_cull` fields and `runGpu`'s scenario (`{"out", "calls"}` in, `{"ok": true, "replies"}` out);
they hold unchanged except where said below. Times in requests and replies are whole flicks (705,600,000 a second) or,
where #449 says so, seconds; 2D places are document u, y down.

### Document fields (the design's, spelled as the tests write them)

- `particles@1` params: `dimensions: 2` (2D, positions in u, y down) or absent (3D); `space: "world" | "local"`
  (default local); `emit.anchor: "<item ID>[#anchor]"` *(the design's `emit: {anchor: ID[#anchor], …}`)*;
  `motion: {"along": {"curves": ["<curve>", …], "speed": [min, max]}}` (`pick` and `lateral` left at their defaults,
  hash and 0); in 2D, speeds in u/s.
- A curve in `along.curves` is a `path@1` item's ID, a graph's routed edge `<graph item>#<edge ID>`, or a vector
  field's streams `<vector_field item>#streams`; `along.curves` is a list even with one entry *(chosen: the
  criterion's `along.curves: <field>#streams` written as `["field#streams"]`)*.
- A particle moving along a curve starts at the curve's start at its birth and moves by arc length s = its speed ×
  its age *(chosen reading of "moves by arc length at a seeded speed")*; the fixtures keep every particle short of its
  curve's end for its whole life, so what happens past the end is never read.
- A graph's routed edge is its route as laid out: the polyline `deep-canvas-render geometry` answers as
  `graph.routes.<edge>` for the graph item, document u, the graph's `at.pos` included (the base draws routes as those
  polylines; the fixture also sets `route.corner_radius: 0`).
- A stream `<field>#s<i>` is the polyline of stream i's points, in the field's coordinates, which with no `scales` are
  document u (#225's reading).
- **Moved by a logic array** *(chosen reading, the base's `moving_member` rule)*: the anchor's item is placed by a
  logic array when its params read `{"array": "<logic item>.<name>"}`; the fixture's anchor is `swarm#0.0`, an element
  of the instancer `swarm` whose `pos` reads `brain.pos`. **Moved by a live drag** *(chosen)*: a document control in
  the document's `controls` whose `handle.item` is the anchor's item (#308's `drag_along` spelling).

### `deep-gpu run`: the `particles` call on a 2D item

Request and outcome as #449's README gives them. For a `particles@1` item with `dimensions: 2`, the document may be a 2D
document (graph, path and vector field items, as `film2d` plays it), and the item's reply is:

```json
{"count": 20,
 "particles": [{"row": r, "born": s, "ends": s, "curve": "<curve name>", …}, …],
 "at": [{"t": flicks, "cpu": [[x, y] | null, …]}, …]}
```

- `particles`: every particle born in [0, the transport's span], as #449's, each with **`curve`** *(chosen)*: the one
  curve it moves along, named as `along.curves` names it, with a vector field's streams resolved to the stream it
  picked (`field#s2`, never `field#streams`). Other fields of #449's particle may be present; these tests read `row`,
  `born` (its own birth time, s), `ends` and `curve`.
- `at[k].cpu[row]`: the CPU f64 closed form's place of the particle live in that row at `t`, **`[x, y]` in document u**
  *(chosen)*, or null; `count` entries.

For a 3D item (AC2) the reply is #449's unchanged; `born` there is the particle's own birth time, not its bucket.

**The check's refusal** this issue adds (AC2): a `particles@1` item with `space: "world"` whose `emit.anchor` a logic
array or a live drag moves answers `{"outcome": "refused", "issues": […]}` with an error issue whose **`path` is
`items/<particles ID>/params/emit/anchor`** *(chosen)* and whose `ids` hold the anchor (its item ID, or the anchor as
written). The code is the implementer's. The same anchor moved by a channel is checked.

### `deep-gpu run`: `film2d`, the `particles` request field *(chosen)*

```json
{"call": "film2d", "doc": {…}, "look": "clean", "fps": 30, "from": n, "frames": n, "capture"?: [n, …], "particles": ["<item ID>", …]}
```

Everything #417's and #464's READMEs define for `film2d` holds unchanged. With `particles`, each frame row gains
`"particles": {"<item ID>": {"hash": "<sha256>", "live": n}}` for the 2D items named: `hash`, the 2D evaluated-data
hash, SHA-256 over the item's rows in order, a row with a live particle as the byte 1 then x and y of its CPU f64
closed-form place at the frame's time as f64 little-endian, a row with none as the byte 0 (the same places the
`particles` call's `cpu` gives at that time); `live`, how many rows are live. Asking for `particles` changes no pixel.
A 2D `particles@1` item draws in its writer layer on the GPU layer, so `film2d`'s frames show it.

### `deep-gpu run`: `view3d`

#449's `particles` field and `fps`, unchanged; AC2 draws one document at `fps` 60 and at 144, the two displays.

### `deep-canvas-render`

`look` with `{"look": "clean"}` and `geometry` with `{"doc", "look", "item"}`, exactly as at the base (#399).

### The planted program *(chosen name)*

| Name | Criterion | The wrong program |
|---|---|---|
| `particles_follow_arrows` (`deep-gpu run --planted`) | 3 | every particle whose curve is a vector field's stream moves instead in a straight line from its birth point along the field's arrow there, F(p₀) ÷ \|F(p₀)\|, by the same arc length (its speed × its age); its `curve` is reported as before. Everything else is as shipped. Like #449's plants it is reachable only through `--planted`, never an environment variable; a release build should refuse it (not tested here: no test builds a release) |

AC1's and AC2's wrong programs are made in test code from the run's own readings (below), so they need no plant.

## Fixtures

All generated in `helpers.ts` and the test files; no file on disk. 2D documents: one writer layer, `profile:
"figure"`, `transport: {span: "10s", frame_rate: "30/1"}`, seed 451, drawn in the shipped clean look.

| Fixture | What it is | Used by |
|---|---|---|
| the graph, before and after its relayout (`graphDoc`) | pinned `graph@1` `net` at (30, 20), nodes A, C, B of 60 × 30 u, edge `ab`; layout memory A (40, 40), C (240, 40), B (440, 40) before, B (40, 440) after (one document ID: a revision); `packets`: 20, life 2 s, rate 10/s, along `net#ab` at 120–160 u/s | ac1, ac4 (before) |
| world anchors (`ac2`) | 3D scene (`profile: "scene"`, `frame_rate: "30/1"`, 4 s); `sparks`: world space, 64 rows, life 1 s, rate 45/s, no motion of its own (#449's `STILL`); anchored to `swarm#0.0` (instancer reading `brain.pos`), `puck` (a `drag_along` handle), or `ship` (a channel, x 0 → 4 m over 4 s at y = 1) | ac2 |
| the streams of (−y, x) (`ac3`) | `field`: fn (−y, x), starts (1, 0), (1.5, 0), (2, 0), (2.5, 0), step 0.005, time 6.2, pad 4, max_points 2048; `flow`: 64 rows, life 3 s, rate 16/s, along `field#streams` at 0.5–1 u/s | ac3 |
| a path; a turning field (`ac4`) | `wave`, the cubic M 40 240 C 160 40 320 440 440 120, with 48 particles at 80–120 u/s; (240 − y, x − 240) with arrows every 50 u and streams of radius 60–180 u about (240, 240), with 64 particles at 40–80 u/s | ac4 |

## Criteria to tests

IDs are `#451.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`'s `criterionId`, on the live issue). Every test title starts `AC<n> #451.<id>`; each file's
header states its fixture, numbers and wrong programs in full.

| Criterion | File (tests) | What it asserts | Wrong programs it fails |
|---|---|---|---|
| AC1 `#451.5e48c360` | `ac1-graph-edge.test.ts` (2) | Guards on the canvas's own routes (before: bends around C, its chord 10 u or more off; the relayout moves it 20 u or more; both longer than a life's travel). At 100 random frames (2.5–10 s, 30 fps): before and after the relayout, in one process, exactly 20 live packets each moving along `net#ab` and within 0.5 u of its route; each further along at each later read; reaching 7 of 10 stretches. Seeking equal to playing: `film2d` played frames' hashes equal the evaluation's at all 100 frames, and frames 101, 187, 263 opened alone equal the played | packets on the straight chord a→b (test code, fails naming `packets` and `net#ab`); packets on the route before the relayout judged after it (test code, same); a route cached by document; a play that differs from a seek; the base (refused `speed`) |
| AC2 `#451.6846b36f` | `ac2-world-anchor.test.ts` (2) | The logic-moved (`swarm#0.0`) and drag-moved (`puck`) world anchors are refused at `items/sparks/params/emit/anchor` naming the anchor; the channel-moved one is checked. On 60 Hz and 144 Hz `view3d` displays, at the 36 times both draw (m ÷ 12 s), the same evaluated-data hash, the evaluation's; every live spark where `ship` was at a 1/30 s bucket less than an interval from its own birth, on y = 1, z = 0; guards: 40 or more live, 20 or more places at 3 s, births between buckets | a check without the rule (test code: the reply without the refusal, fails naming the anchor); births keyed to each display's frames (test code, fails naming `sparks`); births read at their exact time, not their bucket (test code, same); the base (no anchor: every spark at the origin) |
| AC3 `#451.9c598890` | `ac3-streams.test.ts` (2) | The test's own RK4 streams lie on their circles. At 100 sampled frames (3.5–10 s): 48 live particles each moving along one of `field#s0`–`field#s3` and within 1e-4 of that stream's polyline; every stream carried; each particle further along at each later read; 80% of places 0.1 u or more along. Seeking equal to playing by hash, as AC1's, at the 100 frames and frames 120, 211, 288 | `particles_follow_arrows` (fails naming `flow`); a particle on the wrong stream; the base (refused `speed`) |
| AC4 `#451.98808b85` | `ac4-taste.test.ts` (1) | Writes three screenshots and three recordings from `film2d`'s own captured frames to `docs/evidence/451/`, each frame holding live particles; reads `TASTE.json` | none: it is a person's call; the base (no `particles` on `film2d`'s frames) |

No test can pass on a program that does nothing: each reads places, hashes or pictures the program must produce, with
guards (live counts, curves named, travel along the route or stream, places spread along the anchor's path, frames whose
data differ) an empty or still answer fails. Where each test fails at the base: `BASE-FAILURE.txt`.

## The taste call

`ac4-taste.test.ts` plays three flows with `film2d` at 30 fps from 2 s to 4 s, capturing every frame's final PNG, and
writes to `docs/evidence/451/`: `graph-edge-packets.png`, `path-particles.png` and `stream-particles.png` (each flow's
frame at 3 s, byte for byte) and `graph-edge-packets.apng`, `path-particles.apng` and `stream-particles.apng` (each
flow's 60 frames put into one animated PNG unchanged), printing each SHA-256. Show them to the owner in the session and
attach them to the PR; record the one answer in `tests/acceptance/451/TASTE.json`:

```json
{"issue": 451, "criterion": "#451.98808b85", "verdict": "looks_right" | "looks_wrong", "who": "...", "when": "<ISO 8601>",
 "screenshots": {"graph-edge-packets.png": "<sha256>", "path-particles.png": "<sha256>", "stream-particles.png": "<sha256>"},
 "recordings": {"graph-edge-packets.apng": "<sha256>", "path-particles.apng": "<sha256>", "stream-particles.apng": "<sha256>"},
 "note": "..."}
```

With no file, or one made on other bytes, the test is INCONCLUSIVE; `looks_wrong` fails it. This job records no call.
No other test reads a picture to judge it. The graph shot is the canvas's own frame of the graph document: its nodes
and route are drawn as `film2d` draws a `graph@1`, which the person judges with the packets.

## Readings and choices where the issue and design leave one

1. **One binary for the particles.** Every reading of a particle comes from `deep-gpu` (the binary that already
   evaluates and draws particles): the `particles` call for places, `film2d` for 2D frames, `view3d` for 3D displays.
   The references they're judged by come from elsewhere: the route from `deep-canvas-render geometry`, the streams from
   this suite's own RK4 at the field's step (the design pins the method; at step 0.005 the polyline and its circle
   agree within 8e-6, so the sub-path's polyline and a smooth reading of it both hold 1e-4).
2. **"100 random times"** are 100 distinct frames of the 30 fps film drawn by mulberry32 from a fixed seed, so a seek,
   a play and the evaluation read the same whole flicks. AC1's start at 2.5 s, past the first 2 s life, so 20 packets
   are live at each; AC3's at 3.5 s for its 3 s life (48 live).
3. **"Seeking equal to playing"** is the closed form evaluated at t in a fresh process against `film2d` playing every
   frame from 0, by the 2D evaluated-data hash, at every one of the 100 frames; and three frames opened alone in fresh
   processes against the played ones. "By hash" (AC3) is that hash.
4. **"After a relayout moves the edge"** is a revision of the same document (same ID) in which B's place in the layout
   memory moves, evaluated in the same process after the first version, so a route kept from before shows; `film2d`
   plays both versions in one process too. The relayout moves every point of the route 20 u or more.
5. **"Within 0.5 u of that edge's route"** is the distance to the route's polyline as laid out. The chord twin keeps
   each packet as far along (as a fraction) as it is on the route, so it differs from the route only where the route
   bends around C.
6. **Birth buckets** are whole multiples of the document's frame interval (1/30 s here, neither display's). A spark
   with no motion of its own sits where its anchor was at its bucket, so its x (the anchor moves at 1 m/s) reads its
   bucket directly. "The same bucket times on a 60 Hz and a 144 Hz display" is read as: at every time both displays
   draw, the same particles in the same places (one evaluated-data hash), the evaluation's, every one at a bucket. The
   test takes the bucket within one interval of the birth either side, so it doesn't choose between the bucket the
   birth falls in and the nearest one.
7. **"Naming the anchor"**: an error issue at `items/sparks/params/emit/anchor` whose `ids` hold the anchor's item (or
   the anchor as written). The logic document's logic item has no stored program; only the refusal at that path is read.
8. **The field (−y, x)** is drawn at radii 1 to 2.5 u: no scales, so field coordinates are document u and the
   particles' places are compared with the streams directly. "Leaves the streams" is read where a particle has gone
   0.1 u or more, at which a straight line along the birth point's arrow is 2e-3 u or more off the stream.
9. **2D speeds** are u/s, 2D places document u, y down (the design's "positions in u, y down").

## Not tested, because no criterion asks

`per_edge: column` (an edge column setting each edge's rate); `pick: weights`, `lateral`; `along.curves` naming a
collection; crowds along many 3D curves; `space: local` with a moving anchor; anchors moved by drivers, constraints or
physics bakes; what a particle does past its curve's end; 2D particles in a writer layer's GPU-surface handoff cost;
the refusal's code; a release build refusing `--planted particles_follow_arrows`; budgets.

## Upstream tests (the Oracle lane)

The oracle page lists no upstream test for any criterion. None is ported.
