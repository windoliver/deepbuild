# Acceptance tests for #2760: rings where something touches the water

Written first, from issue #2760 (its scope, its Fields row and its "It can never" line, its nine acceptance criteria and
its proof line: "The three rings' radii and centers, the frames after the span, the seeked and played hashes, the
filtered list, the refusals, the voices' flicks, and each planted twin's failure"; it has no Oracle line), the design
sections it links and those they lean on, and base commit `9550dc0f0`, by a job that never saw an implementation; none
existed, and no other checkout, branch or pull request was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion,
one test per clause that needs its own run, plus exactly the two planted twins the criteria name.

## What was read

- Issue #2760 as copied for this job (no comments).
- `docs/canvas-primitives.md`: Time and the flick; Units and axes; Material: water; Material: mirror; Occurrence list;
  Logic `logic@1`; Logic: occurrences; Logic: occurrences: offsets in a step; Spawn, Spawn: variants, Spawn: variant and
  span; Particles `particles@1`: occurrence bursts (another reader of `on`).
- `docs/technical-design.md`: Dogfooding; Built to be hard to get wrong; Every task carries its own budgets; The
  reference Macs. AGENTS.md.
- At the base, for call shapes only: `tests/acceptance/166/` (the model: README, helpers, rain, seek, foam, physics,
  budgets and taste tests), `268/`, `968/` and `968-redraft-1830/` (later water suites; the budget judge with each run's
  load), `544/` (a logic item's `emits`, its list, a Spawn on it through `media_mix`, the assembler), `537/` (logic
  items run in `view3d`, programs in `assets`), `450/` and `449/` (`on` with `kinds` and `where`; a refusal's
  `actual`); `crates/deep-gpu-layer/src/{main,view3d,fed,physics,particles}.rs` and `view3d/{parse,history}.rs` (the
  call's fields, `seeks`, `rings`, refusals as `{code, reason}` or `{code: "refused", issues}`, `Planted`);
  `crates/deep-canvas-scene3d/src/water.rs` and `crates/deep-scene3d-render/src/water.wgsl` (how `water` is read, the
  rain's rows, how a ring reaches the picture); `crates/deep-logic/src/{piece,world}.rs` (the emit region's layout,
  list order); `crates/deep-show/src/{spawn,mixdown,logic}.rs` and `crates/deep-play/src/logic.rs` (a Spawn's `on`,
  `voices`, a baked row's fields); `crates/deep-canvas-effects/src/particles/bursts.rs` (`where`);
  `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit` with `loads`, `validateBudgets`); `benchmarks/budgets.json`;
  `scripts/proof-change.mjs` (`criterionId`); `scripts/lanes.mjs` (`alone`, `timed`).

## What the base already does, which these tests don't credit

`view3d` draws #166's water (waves, ripples, rain, foam, a wake), with `from`, `seeks`, `capture`, `timings` and each
frame's `pixel_hash`; with `rings: true` each captured frame lists the rain's rings as `{part, drop, at, born,
radius}`. It runs a scene's `logic@1` items in the call, each program read from `assets` by its SHA-256, an item with
`emits` included, and bakes their arrays (`fed.rs`), not their occurrence lists. `deep-show`'s
`media_mix` bakes a logic item's list and plans a Spawn's voices on it (#544). A water reads no `rings` (an unknown
key it ignores), so the base draws every fixture here as a still pond, lists no ring, refuses nothing, and knows
neither planted name nor the budget task.

Checked at the base before the fixtures were fixed (probes, not kept):

- Every program here was run in Node and its emit region read back against its table of touches; `media_mix` at the
  base, given a Spawn on each list, starts one voice per row with this suite's index and flick (the deer's laps are
  occurrences 0 and 2, its steps 1 and 3; the crowd's 65 rows fall two a step from step 60 to step 92).
- `view3d` at the base draws every document here, the 1080p pond with `timings` and the session that seeks back from
  frame 200 to frame 45 among them, and answers `rings: []` for each.
- **One ring changes the picture.** The rain's rings reach the final picture only through the mirror's lookup and its
  Fresnel share, so the pond is seen low and oblique and mirrors eight red and white posts (below). With rain at 0.4
  drops per m² per s on it, 240 frames at 60 fps: every frame that lists exactly one ring inside the camera's view
  differs from the dry frame, by 14 to 343 pixels (40 or more once the ring's radius passes 3 cm) and up to 86 code
  values, at 29% to 100% of the ring's strength (frame 64: 137 pixels at 29%; frame 152: 243 at 37%; frame 96: 80 at
  66%, 0.3 m from the pond's centre). The one ring that changed one pixel or none (frames 118 and 119) lay left of the
  frame. The rings these tests compare are larger (0.075 to 0.45 m in radius) and, if they fade as the rain's do, at
  25% to 87% of their strength.

`BASE-FAILURE.txt` holds `rings.test.ts` and `spawn.test.ts` run against the base: no ring is listed, the planted name
is unknown, and the Spawn's three voices are there while their rings aren't.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/2760 --no-file-parallelism --testTimeout=3600000
npx tsc -p tests/acceptance/2760/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds `deep-gpu` once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu` (`spawn.test.ts` also `deep-show`, the default set), putting the pinned toolchain
(`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`) first on PATH when it is there, copies the binary out of the
target folder (`CARGO_TARGET_DIR` honoured) and fails each test that uses a build that failed. The logic programs are
WebAssembly text assembled by #544's assembler (`tests/acceptance/544/wat`, read only), built into
`target/acceptance-2760-wat/`; when it doesn't build, a test fails `BLOCKED:`. Each test writes into its own temporary
folder and deletes it. Imports: Node built-ins and vitest only; the lane's judge and validator run as
`scripts/benchmark.mjs` in a child process. A run with `--root tests/acceptance/2760` leaves Vitest's cache in
`tests/acceptance/2760/node_modules/.vite`; delete it.

The files run one at a time and the timing must have the machine to itself. This README is the instruction; the
implementer adds to `scripts/lanes.mjs`:

```js
// #2760's files build deep-gpu (spawn.test.ts also deep-show) and #544's assembler, run logic programs and draw on
// the GPU; budgets.test.ts times 64 rings on a pond at 1080p.
alone.push('tests/acceptance/2760/');
timed.push('tests/acceptance/2760/budgets.test.ts');
```

- Everything draws on macOS's GPU device: off macOS, or where a reply says `unsupported_platform` or
  `gpu_unavailable`, a test fails with a message starting `INCONCLUSIVE:`, never passing.
- **The budget** (`budgets.test.ts`) counts only on a reference Mac on mains power, Low Power Mode off, thermal state
  nominal, with the load at each run's start and end at most the core count, as the lane's `judgeLimit` reads the
  fingerprint and the loads; anywhere else its timing test fails `INCONCLUSIVE:` before timing anything. The
  budgets.json entry is checked anywhere.
- `taste.test.ts` keeps its three files in `DEEPBUILD_EVIDENCE_DIR` (else `$TMPDIR/deep-2760-evidence`), prints their
  paths, and reads your taste call from the file `DEEPBUILD_TASTE_2760` names; without it the test fails
  `INCONCLUSIVE:`.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged
(`{"out", "calls"}` in, `{"ok", "replies"}` out) and #378's `view3d` for every frame and every refusal; for criterion
7's voices, #393's `deep-show run` with `media_mix`, unchanged. Field names the issue and design give are used as they
give them; the rest are this suite's choices, marked **bold**, each the least a criterion needs.

### Documents (scene3d, as #166's and #537's suites write them)

One writer layer `main` (writer `agent:sess-alpha`), camera `cam`, `seed: 2760`, `transport: {span: "12s", frame_rate:
[60, 1], sample_rate: 48000}`, `requires: {modules: {scene3d: "^1", logic: "^1"}}`, items keyed by ID.

- **`rings` sits in a `material@1` item's `params.water`**, beside `rain`, on the material of a `plate@1` part, as the
  Fields row says: `rings: {on, speed, span, strength}`. A field left out takes the row's default (speed 0.3 m/s, span
  2 s, strength 0.2); every fixture here leaves all three out. **`rings: "none"`** is the none form, as `wake: "none"`
  is, and draws what a water with no `rings` draws.
- **`on: {list, kinds?, tags?, where?}`**, the shape every reader of an occurrence list takes at the base (#449's
  bursts, #450's trails, #544's Spawn and `start_on`): `list` is the list's form, `<logic ID>.occurrences`; `kinds`
  keeps the rows of those kinds, and all rows when absent; **`where` is an expression over the row's declared fields by
  name in the closed grammar (`"n > 1"`, as #449 writes `"speed > 1"`), and keeps a row when it is finite and not 0**.
  `tags` is never written here.
- A logic item, as #537 and #544 write one: `{kind: "logic@1", params: {program: <sha256>, step_rate: 60, reads: [],
  emits: {<kind>: {fields: {<name>: "i32" | "f64" | "vec3"}, max_per_step?}}}}`, its program in the `view3d` call's
  `assets: {<sha256>: <path>}`. **An occurrence's point is its kind's declared field named `point`, a vec3 in world
  metres** (Spawn: "whose field named `point`, if any, is its point"); a kind that declares no `point` carries none.
- **The ring's centre is the point's world x and z**, the point dropped onto the plate at rest; a point whose x and z
  lie outside the plate's rectangle is off the plate.

### `view3d`: the `rings` rows

`{"call": "view3d", "doc", "look", "size", "frames", "fps", "from"?, "seeks"?, "capture"?, "targets"?, "timings"?,
"rings"?, "assets"?}` as the base has it; read: each frame's `frame`, `pixel_hash`, `final` (PNG by SHA-256) and
`gpu_ms`. `view3d` bakes each logic item's occurrence list in the call, as it bakes their arrays, for the rings to read.

- With the call's `rings: true` (#166's field), each captured frame's `rings` lists, beside the rain's rings as #166
  has them, **every ring an occurrence started that is alive at the frame's t, as `{part, occurrence, at: [x, z],
  born, radius}`**: `part` the plate's item ID; **`occurrence` the row's index in the list `on.list` names, in list
  order, from 0, counted before any filter** (the index `media_mix` gives a Spawn's voice as `voices[].occurrence`);
  `at` the ring's centre in metres in world x and z on the water at rest; `born` its birth in s, its occurrence's flick
  ÷ 705,600,000; `radius` in m as drawn. A ring is alive from its flick until `span` s after it, and not at `span`. An
  occurrence's row carries no `drop`. It is the record the renderer draws the rings from. The rows' order isn't read.

### Refusals at check

**`view3d` answers a document its check refuses with `{"code": "refused", "issues": [Issue]}`**, the form its other
check refusals take, each Issue the canvas core's `{code, severity, ids, path, actual, what, fix}`. Each issue's `code`
is the implementer's.

- **Over the cap** (criterion 5): an issue with `severity: "error"` whose JSON names the part's ID as a whole word
  (`pond`; `ids` is the natural place) and whose **`actual` holds `count`, the rings alive at once (65), and `t`, a
  time in whole flicks at which that many are alive on the part**.
- **No point** (criterion 6): an issue with `severity: "error"` whose JSON holds the list's form
  (`drips.occurrences`).

### `deep-show`: nothing new

`media_mix` with `{doc, track: [], segments: [{from, to, write: true}]}` on the same document `view3d` draws, whose
`spawns: {splash: {on: {list, kinds}, play: {src: {asset}, in, out}}}` and `assets` are #544's; read: `mix.voices[]`'s
`spawn`, `occurrence` and `start` (flicks) and the segment's float WAV. The base already answers it.

### `benchmarks/budgets.json`: one task added

**`{"id": "canvas-water-rings", "command": ["node", "benchmarks/canvas.mjs", "water-rings"], "targets":
{"rings_pond_gpu_ms": 0.3}, "margin": 0.5, "limits": {…}, "initialReason": "… #2760 …", "criteria":
["#2760.6dfadd78"]}`**, passing `validateBudgets` against the merge base's file (which freezes the earlier water
tasks, so a new task rather than a changed one). What the mode prints is the implementer's, as the lane needs it.

### Planted programs (`deep-gpu run --planted <name>`, reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| **`water_rings_at_rain_hash`** | Each occurrence's ring is centred where the rain's hash puts a drop (hashed from the document's seed, not read from the occurrence), not at its occurrence's point; its birth, its radius and everything else as shipped; the `rings` rows report what it draws | `#2760.a4531c1e` (issue-named: "a planted material that places rings by the rain's hash") |
| **`water_rings_start_on_drawn_frame`** | A ring starts when a drawn frame first passes its occurrence and is kept from frame to frame as session state, so a session that has drawn a frame past an occurrence and then seeks back before the ring's span ends draws no ring for it; a film played from before the occurrences still draws them | `#2760.dc56f46c` (issue-named: "a planted material that starts a ring when a drawn frame first passes its occurrence") |

### Files and environment

- `DEEPBUILD_EVIDENCE_DIR` (optional): where `three-rings-<sha>.png`, `fish-rise-<sha>.png` and
  `rings-spreading-<sha>.apng` go.
- **`DEEPBUILD_TASTE_2760`**: a JSON file `{"criterion": "#2760.3bd24233", "by": "you", "screenshots": [sha256 × 3],
  "call": "looks_right" | "looks_wrong"}`.

## The fixtures

- **The pond** (`helpers.ts`: `pondDoc`): the plate `pond`, 4 m × 4 m of 64 × 64 cells centred on (1, 0, −0.5) m (off
  the world's origin, so a centre in the plate's own coordinates shows), whose material `rings-water` carries the
  water over its own sharp mirror (roughness 0); a sand bed 0.6 m down; eight posts, red and white in turn, 0.25 m
  wide and 1.6 m tall, half a metre apart along the far bank; a day sky and a sun. The camera stands 1.5 m up, 4.2 m
  from the centre toward +z, so the water mirrors the posts and the sky at a grazing angle. **Still water** (`STILL`,
  #166's) has one wave of amplitude 0, no ripples and no rain, so only a ring bends its normal.
- **Programs** (`helpers.ts`: `emitter`): each is generated from a table of touches `{step, kind, a, fields}` as
  WebAssembly text: at each step that holds touches it writes their rows into its emit region (for each kind in
  declaration order a u32 count, then `max_per_step` rows of `{a, b, fields}`, each field at its type's size, nothing
  between), b always 0. The list it must leave is the table sorted by (step, kind in declaration order, a), each row
  at step × 11,760,000 flicks.
- **The three touches** (`threeTouches`, criteria 1, 2, 3, 7 and the taste call): the logic item `taps` declares
  `touch {point: vec3, n: i32}` and emits one at steps 60, 90 and 120 (1, 1.5 and 2 s), each at the plate's centre, n
  and a 1, 2, 3.
- **The deer** (criterion 4): `deer` declares `lap {point}` and `step {point}`; laps at steps 60 and 96, steps at 75
  and 111, each at its own place on the plate.
- **The crowd** (criterion 5): `crowd` emits n touches two a step from step 60, on a 0.4 m grid over the plate.
- **The drips and the stones** (criterion 6): `drips` declares `drip {size: f64}` (and, for the guard, `drip {size,
  point}`); `stones` emits two `stone {point}` rows at step 60, at the centre and at (4, 0, −0.5), 1 m past the +x
  edge.
- **The half-frame pond** (`budgets.test.ts`): a plate 12 m × 8 m of 128 × 128 cells with `water: {rings}` (a 3 m/s
  breeze's waves and the default ripples), seen straight down from 16 m (fov 60°), where it fills half a 1920 × 1080
  frame; `shower` emits 64 touches in one step (`max_per_step: 64`) at steps 0, 122, 244, 366 and 488.
- **The fish** (the taste call): `fish` emits three `rise {point}` rows at one place, at steps 60, 69 and 78.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), computed from the issue's text. Each test's name starts with its ID. 13
tests.

| ID | Criterion | File: what it asserts |
|---|---|---|
| `#2760.a4531c1e` | 1: three rings' radii and centres; planted hash | `rings.test.ts` (2): the film played to 2.25 s (frame 45 at 20 fps): the rows list three rings on `pond`, one per occurrence of `taps.occurrences`, radii 0.375, 0.225 and 0.075 m within 1 mm and within 1 mm of 0.3 × age, centred within 1 mm of (1, −0.5), born at their flicks; the frame differs from the pond with `rings: "none"`. Twin `water_rings_at_rain_hash`: the same check fails, a failure naming each of `occurrence 0`, `1` and `2 of taps.occurrences`. |
| `#2760.c3014951` | 2: nothing remains from 3 s | `span.test.ts`: each of the 31 frames from 3 s to 4.5 s has the same final PNG, byte for byte, as the same pond with `where: "n > 1"`; their rows list no ring of the first touch and the other two until 3.5 s and 4 s. At 2.25 s the unfiltered rows list three rings, the filtered two, and the hashes differ; at 3 s the frame differs from the pond with `rings: "none"`. |
| `#2760.dc56f46c` | 3: seek back equals play; planted start on a drawn frame | `seek.test.ts` (2): frame 45 played from 0 and frame 45 reached by `from: 200` then `seeks: [{after: 200, to: 45}]` have one pixel hash, which differs from the ringless pond's. Twin `water_rings_start_on_drawn_frame`: the check fails naming `material rings-water` and `2.25 s`; the frame after the seek is the ringless pond's, the played one isn't. |
| `#2760.f7241c9f` | 4: filtered to `lap` | `filter.test.ts`: at 2.25 s, `kinds: ["lap"]` lists the two laps' rings (occurrences 0 and 2) at the laps' points and no step's; `kinds: ["step"]` lists the two steps' (1 and 3) at theirs; the two frames differ. |
| `#2760.ee433725` | 5: 65 refused, 64 draw | `cap.test.ts`: 64 touches: frame 40 (2 s) lists 64 rings, each at its point with radius speed × age, and differs from the ringless pond. 65 touches within 0.533 s: `{code: "refused", issues}` with an error issue naming `pond`, `actual.count` 65 and `actual.t` in [1,081,920,000, 2,116,800,000) flicks. |
| `#2760.1524f8e9` | 6: no point refused; off the plate, no ring | `point.test.ts` (2): `rings` on `drips.occurrences`, whose one kind declares no `point`: refused with an error issue holding `drips.occurrences`; with the kind declaring `point`, drawn. Two stones at 1 s, one at the centre and one 1 m past the +x edge: at 2.25 s the rows list one ring, occurrence 0, at the centre; the frame differs from the ringless pond. |
| `#2760.9c74b517` | 7: a Spawn's voices on the rings' flicks | `spawn.test.ts`: one document with `rings` and the spawn `splash` on `taps.occurrences`. `media_mix`: three voices, occurrence 0, 1, 2, `start` 705,600,000, 1,058,400,000 and 1,411,200,000; the mix silent before each and sounding at its sample (48,000, 72,000, 96,000). `view3d` at 2.2 s (frame 55 at 25 fps): each occurrence's ring is listed, its `born` × 705,600,000 within half a flick of its voice's `start`. |
| `#2760.6dfadd78` | 8: budget | `budgets.test.ts` (2): the `canvas-water-rings` task and the lane's validator against the merge base; the half-frame pond with 64 live rings against the same pond with `water: {}`, ≤ 0.3 ms in five runs judged by the lane with each run's load; the warm-up reads 64 rows at 0.5 s and two different frames. |
| `#2760.3bd24233` | 9: taste | `taste.test.ts`: the three rings, the pond after a fish rises and the rings spreading (an APNG of 96 frames) from the renderer's final frames; INCONCLUSIVE without your recorded call; `looks_wrong` fails. |

Proof line: "the three rings' radii and centers" are criterion 1's log line; "the frames after the span" criterion 2's
31 frames; "the seeked and played hashes" criterion 3's; "the filtered list" criterion 4's log line; "the refusals"
criteria 5's and 6's issues; "the voices' flicks" criterion 7's log lines; "each planted twin's failure" the two twin
tests.

## Readings where the issue and design leave a choice

- **Where the rings are read.** The issue names no surface. As #166 read the rain's rings, the criteria's radii,
  centres and births are read from the renderer's own record, `view3d`'s `rings` rows, extended by one field; that the
  record is drawn is held by each test's frame against the same pond with `rings: "none"`, on a fixture where one ring
  is shown to change the picture (above). No test measures a ring in pixels.
- **"Its occurrence" in a row** is the row's index in the whole list, the index a Spawn's voice already carries, so
  criterion 7 pairs a voice with its ring by it.
- **"The plate's center"** is the plate's centre in the world, (1, 0, −0.5) m: the touches' points are world metres, as
  an occurrence's point is, and the ring's `at` is world x and z.
- **"That occurrence filtered out"** (criterion 2) is `on.where: "n > 1"` on the same list, the scope's third filter;
  `kinds` is criterion 4's. **"Byte for byte"** is the final target's PNG file. **"Each frame from 3 s on"** is every
  frame at 20 fps from 3 s to 4.5 s, half a second past the last ring's end. **A ring at exactly its span isn't
  alive** ("from t = 3 s on, nothing … remains"): the rows at 3 s, 3.5 s and 4 s don't list the ring whose span ends
  there. Those times, births and spans are exact in flicks and in binary.
- **"Seeking back to 2.25 s from 10 s"** is one session that opens at 10 s, draws that frame and seeks to 2.25 s
  (`seeks`), against a film played from 0. **"Draws none after the seek"**: under the plant that frame equals the
  ringless pond's. **"Naming the material"**: the suite's failure sentence names `material rings-water`.
- **"Starts rings at the laps only"** is read with the names swapped too, so the steps are shown to start rings when
  asked. The two kinds never share a step, so the list's order doesn't hang on how kinds sort.
- **"65 touches inside one second"** are two a step over 0.533 s, each at its own place, so the cap counts rings alive
  at one time, not rows in a step or at a flick. **"Naming the time"**: any flick at which 65 rings are alive, from the
  65th touch's flick to before the first ring's span ends; the first of them is the natural one. The call asks for the
  frame at 2 s, so the refusal doesn't hang on how far a call's bake reaches. **"64 draw"**: 64 rows and a frame that
  differs from the ringless pond's.
- **"A list none of whose kinds carries a point"** is a logic item whose one kind declares no field named `point`.
  **"Naming the list"**: its form, `drips.occurrences`, anywhere in an error issue.
- **"1 m off the plate's edge"** is 1 m past the +x edge on the plate's centre line. "Starts no ring" is read from the
  rows: at the default speed such a ring would never reach the plate, so no picture could show it.
- **"The voice's first sample"** (criterion 7) is the Spawn's `start` and the first sounding sample of the mix, which
  agree; **"the ring's age 0"** is its row's `born`. The three touches fall on steps, samples and (at 1 and 2 s)
  frames; the rings are read at 25 fps, where 1.5 s falls between two frames, so a ring started by a frame isn't on
  its voice's flick.
- **The budget** (criterion 8): "a pond that fills half a 1080p frame" is the pond's area half the frame's, seen
  straight down, as #968 read "filling a third"; "64 live rings" are batches of 64 whose spans don't overlap, at the
  default speed and span; "add" is the pond with `rings` against the same pond and logic item without, the difference
  of the sides' median `gpu_ms`, a negative difference reading 0.
- **"A pond after a fish rises"** is a pond in a light breeze with three rows at one place 0.15 s apart, which draw as
  three rings one inside the other. **The recording** is an animated PNG the suite encodes from the renderer's final
  frames, since the issue names no container.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- `speed`, `span` and `strength` other than their defaults; the crest's width and its fade between a ring's start and
  its span; that the normal bends and the mirror's lookup moves, beyond "the frame differs".
- A physics world's occurrences as `on`; `tags`; `where` beyond one comparison on an i32 field.
- A point above or below the plate dropped onto it; an occurrence with no point in a list where another kind carries
  one; a plate that is turned or moved by a channel; rings on water with waves, ripples, a flow or a shore (only the
  budget's and the taste call's ponds have waves, and nothing is read from them); several water parts in one view.
- The "It can never" lines beyond criteria 3 and 5: no vertex moved, nothing kept between frames other than by seek
  against play.
- The cap with another span or speed; a cap reached at exactly `span` (the fixtures keep clear of that edge).
- Occurrences with `offset` (Logic: occurrences: offsets in a step isn't built at the base).
- `deep_kinds` listing `rings`, the amended Material: water in `docs/canvas-primitives.md`, and `deep-show`'s own
  document check of `rings` (every refusal here is `view3d`'s).
