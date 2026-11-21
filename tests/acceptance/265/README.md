# Acceptance tests for #265: trails and wakes behind items a piece's logic moves, read from the logic bake

Written first, from issue #265 (its summary, Scope, seven acceptance criteria, Proof line and Oracle line), its oracle
page, the design sections it links and those they lean on, and base commit `e575a47af` ("Merge pull request #2953 …"),
by a job that never saw an implementation; none existed, and no other branch, worktree, pull request, stash or plan was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

Lean: one file per criterion, one test per clause that needs its own run, and exactly the four planted twins the
criteria name.

## What was read

- Issue #265, live with `gh issue view 265 --repo windoliver/deepbuild`; for scope only its epic #219, its dependencies
  #450 (trails), #166 (water), #545 (logic interpolated writes), #551 (net rollback), and #131 and #253 beside it (what is
  theirs isn't tested here: sources driven by recorded input entries are #253's).
- Its oracle page (`doneright/oracles/issues/265.md` in DeepBuildAI/deepbuild, branch `doneright`): no upstream test
  checks any of the seven criteria, so nothing is ported and there is no Oracle lane.
- `docs/canvas-primitives.md`: Particles `particles@1`: space and paths; Marks in 3D: trail; Material: water; Logic
  `logic@1`; Logic: checkpoints and bake; Logic: interpolated writes; Net: rollback (prediction, `confirmed`, live frames
  that rest on a prediction); Transport (frame interval, `start`, `span`); Control (`handle`, the live drag); Physics
  output (`keep`, the analogue the particles section names). `docs/technical-design.md`: Particles, closed form; Logic
  bake and checks; Dogfooding; Tests written first. AGENTS.md, CONTRIBUTING.md, `docs/parallel-proof.md` section 6.
- At the base, only to find the surfaces that exist: `crates/deep-gpu-layer` (`main.rs`'s call table and `--planted`
  names; `view3d.rs`: `particles::refuse` before any frame, `fed::bake` running a document's logic items and
  `Baked::settle` folding hold arrays to the frame's step, each frame's `cpu_ms`, `values`, `trails`, `particles`;
  `view3d/parse.rs`: `assets`, `evaluate`, `timings`; `particles.rs`: `anchors`, a world-space emitter's anchor at every
  bucket of the transport's frame interval; `trails.rs`; `fed.rs`); `crates/deep-canvas-effects/src/particles/rule.rs`
  (`live_anchor`: an anchor that is a logic item, reads `{array}` in its params, or is a control's `handle.item`);
  `crates/deep-canvas-scene3d/src/water.rs` (`logic_moved`) and `scene/scattered.rs` (evaluation refuses a wake or a trail
  behind an item a driver moves from a logic array, `out_of_range` at `items/<item>`); `crates/deep-canvas-motion`
  (`trail.rs`'s rule, `array.rs`: a driver var reads a logic item's scalar f64 array, blended for `linear`; `doc.rs`: a
  var `"<logic>.<name>"`, channel keys `interp: hold`); `crates/deep-show/src/net.rs` (`match`, `render_back`, `renders`,
  `relay.deliver`); `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (`twins.json`),
  `scripts/lanes.mjs` (`alone`, `timed`); the suites `450/` (the `trail` call, `view3d`'s `trails`, a planted name, a
  taste call), `449/` (`particles`, its hash), `451/` (`ac2-world-anchor`: the 60 and 144 Hz displays, a live drag's
  refusal), `166/` (the water material, its wake, seek against play at 20 s, a planted name naming the material),
  `545/` (linear writes), `537/` (logic in `view3d`, programs in `assets`), `549/` and `551/` (`match`, `render_back`,
  `relay.deliver`, `rolled_back`), `1634/` and `465/` (budgets on the reference Mac, the perf lane).

Code was read only to learn surfaces. Every expected value comes from the issue, the design and this suite's fixtures.

## What the base already does, which these tests don't credit

`view3d` runs a document's logic items from the call's `assets` (#537) and a driver reads a logic item's scalar f64 array
(#1183), blended one step late for `interpolate: linear` (#545); it draws world-space emitters whose anchor channels move,
reading the anchor at every bucket of the transport's frame interval (#451), `mark.line@1` trails (#450) and water wakes
(#166) through channels, drivers and parents, and reports `particles`, `trails`, `values` and `cpu_ms`. But a wake or a
trail behind an item a logic array moves is refused at evaluation (`out_of_range` at `items/<item>`, whatever its span),
and a world-space emitter on such an item has no bake to read its earlier buckets from (its anchors are evaluated without
the logic arrays). The particles check refuses a world-space anchor a live drag moves, naming it (#451): that half of
criterion 5 holds at the base and is tested only beside the half that doesn't. `deep-show`'s `match` draws
`render_back` from the document, never from a copy's own state, and `deep-show`'s document check doesn't know a
`mark.line@1`'s `trail` at all (`unknown_field`: "mark.line@1.0 does not define `trail`"), so criterion 4's piece is
refused there twice over: the implementer also registers `trail` on the kind as `deep-show`'s check reads it (the piece
requires no minor, so whichever minor of `mark.line@1` defines it serves). None of this suite's planted names exists.
`BASE-FAILURE.txt` is the run at the base: every test fails, each at a missing surface, none on a guard.

## Run them

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
for f in ac1-emitter-buckets ac2-trail-drawn ac3-wake-seek ac4-rollback-trail ac5-refusals ac6-budgets ac7-taste; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/265 $f.test.ts --testTimeout=600000 --hookTimeout=3600000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/265/tsconfig.json   # type check
rm -rf tests/acceptance/265/node_modules                                      # vitest's cache after a --root run
```

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, and copies the binary into a
temporary folder: `cargo build --locked --bin deep-gpu` (#449's `useBins`; every file but `ac4`), and
`cargo build --locked --bin deep-show --no-default-features --features full` (#549's `useBuilds`; `ac4`). `ac6` also
builds `cargo build --locked --release --bin deep-gpu` (#1634's `buildGpu`), only after its functional half holds and the
machine is a reference Mac at rest. Every test passes its own timeout (an hour; `ac4` 90 minutes, `ac6` three hours),
which `--testTimeout` doesn't shorten. Each writes into its own temporary folders, deleted after it, except `ac7`, whose
pictures go to `target/acceptance/265/`. Processes are started by `spawnSync` (deep-gpu) or #549's `runShow`
(deep-show, stopped by PID after each test); nothing listens on a port. Imports: Node built-ins, vitest, and read-only
helpers of `../449/`, `../450/`, `../166/`, `../549/`, `../551/` and `../1634/`.

Gates, none ever a pass: no cargo is `BLOCKED:`; every reading draws on Metal, so off macOS, or where a reply says
`unsupported_platform`, a test fails `INCONCLUSIVE:`; `ac6`'s timing is INCONCLUSIVE off a reference Mac or under load
(the perf lane's `judgeLimit`), asked before anything is timed; `ac7` is INCONCLUSIVE until the taste call is recorded.

## The lanes lines

`scripts/lanes.mjs` needs this suite in its `alone` list, beside the other `deep-gpu` and `deep-show` suites, because its
files build cargo binaries, draw on the Metal device and play matches; and `ac6` in `timed`, the local preflight's perf
step (the test itself checks that line). This README is the instruction; the implementer adds:

```js
// #265's files build deep-gpu (ac4 deep-show), draw on the GPU and play a match; ac6 times eight movers' frame CPU.
alone.push('tests/acceptance/265/');
timed.push('tests/acceptance/265/ac6-budgets.test.ts');
```

and, for criterion 6, a task in `benchmarks/budgets.json` whose `criteria` name `#265.e3eb2a00`, with a `command` the
perf lane runs, that passes the lane's validator against the merge base's file (`ac6` reads all three).

## The surface under test

The issue names behaviours, a check refusal, a budget and planted programs, but no call. **Every call, request field,
reply field, document field shape and planted name below that the issue or the design doesn't give is this job's
choice, the smallest the criteria need, on the binaries that already draw these** (`deep-gpu run`'s `view3d`, which
already runs logic, draws particles, trails and water; `deep-show run`'s `match`, the one place a match's copies live).
The implementer builds exactly these, or a dispute goes to a blind redraft. Times in requests and replies are whole
flicks (705,600,000 a second) unless a field says seconds.

### `deep-gpu run`: `view3d`, as it stands

Unchanged from the suites that made them: `doc`, `look`, `size`, `fps`, `from`, `frames`, `capture`, `targets` and each
frame's `frame`, `pixel_hash` and `final` (#378, #380); `assets: {"<sha256>": "<path>"}`, the logic programs a document's
logic items run (#537); `particles: [id]` and `particle_cull: "none"`, each frame's `particles.<id>.{hash, live, culled}`
(#449); `trails: [line ID]`, each frame's `trails.<id>.{hash, source, traces}` (#450); `evaluate: ["items/<id>/…"]`,
each frame's `values` (#429); `timings: true`, each frame's `cpu_ms`, the frame's evaluation up to handing the scene to
the render side (#378). A document the check refuses answers `{"code": "refused", "issues": [Issue, …]}` before any
frame (#449), Issue the canvas core's `{code, severity, ids, path, actual, what, fix}`.

### What this issue adds there

- **A logic-moved source is read from the logic bake.** A world-space emitter whose anchor, a trail's source, or a
  wake's item is moved by a driver reading a logic item's array (a var `"<logic>.<name>"`, Logic `logic@1`) is drawn,
  not refused: each earlier-time read (an anchor at each birth bucket, a trail's earlier points, a wake's samples) reads
  the array as drawing read it at that time (`hold`: the last step at or before it; `linear`: step k − 1's value blended
  toward step k's), never a frame drawn before. Birth buckets and wake samples stay on whole multiples of the document's
  frame interval, whatever the display rate.
- **The check refuses a trail whose span reaches before the bake's oldest kept step**, with an error issue whose `ids`
  hold the trail and that names the span: its `path` `items/<trail>/params/trail/span`, or its `actual` holding the span
  (in s, or in flicks). The code is the implementer's. (Readings, below, say when a span reaches there.)
- **A world-space source a live drag moves stays refused**, an error issue whose `ids` hold the dragged item.

### `deep-show run`: `match`'s `render_back`, drawing a copy's own state

#549's `render_back: [{player, t}]` and its `renders: [{player, t, step, sha256, notice}]` are unchanged in shape, with
one change: **`sha256` is the piece's layer drawn from that copy's own state at the step it shows**, its logic arrays as
the copy holds them then (steps past `confirmed` included: Net: rollback, "Live frames may rest on a prediction"), so a
frame drawn while the copy predicts shows the prediction, and one drawn after a rollback shows the replaced steps run
again. #551's `relay.deliver`, the copy's `rolled_back` and #549's scenario `planted` are as their suites define them.

### Planted programs (`twins.json` maps each criterion to its name)

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `anchor_kept_from_frame` | `deep-gpu run --planted` | 1 | a world-space emitter's particle reads its anchor where the last frame this process drew at or before its birth bucket placed it, and, with no such frame, where the current frame places it: the anchor's drawn position kept from frames, never the logic bake's value at the bucket. Played from frame 0 at 60 fps it draws as the right program does; opened by a seek it doesn't |
| `trail_reads_stored_steps` | `deep-gpu run --planted` | 2 | a trail's points read a `linear` array's stored step values (the last step at or before each point's time, as `hold` reads it) instead of the blend drawing reads, so the newest point starts up to one step's travel ahead of the item as drawn |
| `wake_keeps_last_frame` | `deep-gpu run --planted` | 3 | a wake's samples at a frame are those the last frame this process drew of the document kept (those older than the span dropped) and the item's position at t; the first frame a process draws holds that position alone. It never reads the item's chain at earlier times |
| `trail_keeps_predicted_points` | `deep-show run`, the scenario's `planted` | 4 | in a match, a trail keeps the source's place it read at each step past `confirmed` in a frame drawn before a rollback, and draws those kept places after a rollback that replaces those steps, instead of reading the steps run again |

At the base each name is unknown: `deep-gpu run` refuses the scenario, and `deep-show run` refuses its `planted`.

## Fixtures

Built by `helpers.ts` and the test files, as session documents (one writer layer, `seed: 265`, frame rate 60/1),
drawn with #449's acceptance look; every logic program is written as WebAssembly bytes (`helpers.ts`: `pathProgram`,
whose step k writes each f64 array as a + k (b + k c), in the order the test computes it, so a test knows every value to
the bit):

- **The walker** (`walkerDoc`; AC1, AC7): the logic item `walk` (60 Hz) writes `x` = −3 + 0.025 k and `z` = −1 +
  0.00005 k² (`hold`); two drivers place the sphere `walker`; `dust`, a world-space emitter anchored on it, 45 particles a
  second, each rising 0.35 m/s for 2 s, 96 rows; 4 s. Its twin moves the walker by `hold` channels keyed `<k>f`, one key a
  step, through the same values; both have one title and ID.
- **The runner** (`runnerDoc`; AC2, AC5, AC7): the logic item `run` (60 Hz) writes `x` = −10 + k ÷ 6, declaring
  `interpolate: linear` (10 m/s); a driver places the box `runner` (y = 0.5, z = 0); the line `streak` trails it, span
  0.5 s (AC5 also 3 s) in 16 segments; 3 s (AC5: 2 s).
- **The swimmer** (`swimmerDoc`; AC3, AC7): a 30 × 20 m lake whose material `lake-water` carries #166's steep waves, foam
  at 0.6 and `wake: {item: "swimmer", span: 8}`; the logic item `swim` writes `x` = −8 + 0.01 k and `z` = 2 − 0.006 k +
  0.000005 k² (`hold`), a U through (−2, 0.2) at 10 s; 24 s. Its twin moves the swimmer by `hold` channels through the
  same values; its calm form has `wake: "none"`; all have one title and ID.
- **Eight movers** (`crowdDoc`; AC6, AC7): one logic item `crowd` writes `x0` … `x7`, `z0` … `z7` (`hold`), mover i
  crossing its own 10 m cell of a 4 × 2 grid at 0.75 m/s on a curve; each mover on its own lake plate whose material
  `water-<i>` wakes behind it (8 s), with a world-space emitter `dust-<i>` (30 a second, 2 s) and a trail `trail-<i>` (16
  segments, 0.5 s); a showpiece; 10 s.
- **The knob** (`ac5`): a world-space emitter `glow` anchored on `knob`, which the `drag_along` control `slide` drags live
  (#451's spelling), or a channel moves.
- **The steering piece** (`ac4`): a two-seat match (net@1: 60 Hz, delay 2, window 8, relay `https://relay.test/265`,
  which `match` never joins); the logic item `pilot` reads the slider `steer` and moves the box `runner` 0.1 m a step
  along +x and 0.1 m × its last steer value along z; drivers read `pilot.x` and `pilot.z`; the line `streak` trails the
  runner (0.5 s, 16 segments, role `ink`). Player 2 steers to 1 at step 120.

## Criteria to tests

IDs are `#265.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue. Each test's name starts `AC<n> #265.<h8>`;
each file quotes its criterion in full.

| AC | ID | File (tests) | Surface | What it asserts | Wrong programs it fails |
|---|---|---|---|---|---|
| 1 | `#265.535c93ba` | `ac1-emitter-buckets.test.ts` (3) | `view3d` with `assets`, `particles`, `particle_cull`, `from`; `--planted` | At the 48 times a 60 fps and a 144 fps play both draw (m ÷ 12 s), the same `particles.dust.hash`, and the twin's (the anchor the bake's value at each bucket, as a hold channel through the same steps gives); guards: 85 or more live from 2 s, 40 or more distinct hashes. 20 seeded frames in [30, 240], each opened in a fresh process, have the played pixel hashes. `anchor_kept_from_frame` fails that seek judge, naming the source `dust` | the base; anchors from frames; display-keyed buckets; births read at their exact time |
| 2 | `#265.18266a41` | `ac2-trail-drawn.test.ts` (2) | `view3d` with `assets`, `trails`, `evaluate: ["items/runner/at/pos"]`; `--planted` | At 20 seeded frames of a 144 fps play from 0.6 s: one trace of 17 points; its newest within 1e-6 m (each axis) of the runner's evaluated position, which is drawing's blend within 1e-6 m; each earlier point within 1e-6 m of where the runner was drawn at its time. `trail_reads_stored_steps` fails, naming the trail `streak`, its newest point ahead by more than 1e-6 and at most 0.17 m | the base; a trail through stored steps; one a step behind |
| 3 | `#265.4bf8a6ac` | `ac3-wake-seek.test.ts` (2) | `view3d` with `assets`, `from` | Frame 600 at 30 fps (20 s) played from 0 and opened in a fresh process: one pixel hash; guards: the channel twin draws it too, the calm lake doesn't. `wake_keeps_last_frame` fails, naming material `lake-water` and 20 s | the base; a wake from earlier frames; one not drawn |
| 4 | `#265.69afee79` | `ac4-rollback-trail.test.ts` (2) | `deep-show run`: `deep show`, `match` with `plays`, `relay.deliver`, `render_back`; the scenario's `planted` | Copy 1 rolls back from 123 to 120 (4 steps); its frames at steps 126, 130, 136, 144 equal the straight run's by `sha256`; guards: its frames at 120 to 122 differ from the straight run's, the straight run never rolls back, the piece without the trail draws step 136 otherwise. `trail_keeps_predicted_points` fails, naming the replaced step 120 | the base; a trail that keeps predicted points; frames drawn without the prediction |
| 5 | `#265.8c765c23` | `ac5-refusals.test.ts` (1) | `view3d` (its check's refusal) | The 3 s trail over a 2 s bake refused, an error naming `streak` and its span; its 0.5 s twin drawn. The world-space emitter on the dragged `knob` refused, an error naming `knob`; on the keyed knob drawn | the base (every trail behind a logic-moved item refused, naming the item); a check that reads no span; a drag let through |
| 6 | `#265.e3eb2a00` | `ac6-budgets.test.ts` (1, timed) | `benchmarks/budgets.json`, `scripts/lanes.mjs`, the lane's validator and `judgeLimit`; `view3d` with `timings`, `particles`, `trails` | The task naming the criterion with a command, valid against the merge base's file, the file in `timed`; the movers draw, every frame with `cpu_ms`, every emitter live, every trail 17 points; then, on a reference Mac at rest, five release runs' p95 of `cpu_ms` over 600 frames at 1280 × 720 within 4 ms by the lane's rule | the base (no task, the movers refused); past steps read slower than the class allows |
| 7 | `#265.34736230` | `ac7-taste.test.ts` (1) | `view3d` with `capture`, `targets: ["final"]`; `TASTE.json` | Writes three screenshots and a recording to `target/acceptance/265/`; INCONCLUSIVE without the recorded call or on other bytes; FAIL on `looks_wrong` | none: a person's call |

Test count: 3 + 2 + 2 + 2 + 1 + 1 + 1 = 12.

## Readings where the issue and the design leave a choice

- **"An item a logic array moves"** is an item whose position drivers write from a logic item's scalar f64 arrays, read
  as `"<logic>.<name>"` (Logic `logic@1`: "a driver var reads a scalar f64 one from the bake"), the form the base's
  `logic_moved` and #166's suite already name. A driver can't read a vec3 array at the base, so **"an item whose position
  array declares `interpolate: linear`"** (criterion 2) is the runner, whose position along +x is the f64 array `x`
  declaring `linear`.
- **One host for criteria 1, 2, 3, 5, 6 and 7**: `deep-gpu`'s `view3d`, which already runs a document's logic, draws
  particles, trails and water and answers the document check's refusals, so every reading is one binary's. Criterion 4
  needs a match, which lives only in `deep-show`'s `match`; its copies' frames are `render_back`'s, the only frames of a
  copy there are, and the one field whose meaning changes (above).
- **"Emits at the same birth buckets on a 60 Hz and a 144 Hz display"**: the same evaluated-data hash at every time both
  displays draw, as #451's suite reads it for a channel; the emitter births 45 a second, so most births fall between
  buckets. That the bucket's anchor is the logic bake's is read against the twin: a hold channel keyed at every step with
  the very values the program writes, a source the base already reads at earlier times.
- **"20 sampled times give one pixel hash seeked and played"**: 20 seeded frames, each opened by a seek in a fresh process
  (#380's `from`), against one play from frame 0. A planted source that keeps drawn positions has none from before a cold
  seek, so it "differs after a seek"; it is judged by the same comparison. **"Naming the source"**: the failure names the
  emitter, `dust`.
- **"Starts at the item as drawn"**: the newest point against the runner's position as the same frame evaluates it
  (`values`), and that position against drawing's blend computed from the program's values, each within 1e-6 m; the
  earlier points against the drawn path (the Scope's "each sample reads the array as drawing read it at that sample's
  time"), so a trail of copies of the item fails. **"Up to 0.17 m ahead"**: one step at 10 m/s is 1/6 m; the plant's lead
  is checked to be above 1e-6 and at most 0.17 m.
- **"One pixel hash at 20 s, seeked and played"** (criterion 3): frame 600 at 30 fps; the seek in a fresh process, so a
  wake that keeps the last frame's samples has none (a seek in the same process as the play could inherit the played
  frame's). **"Naming the material"**: `material lake-water`, as #166's suite names it.
- **"After a rollback that replaces 4 steps"**: the late entry stamped at 120 reaches copy 1 once it has run 123
  (`relay.deliver`), so it restores step 120 and runs 120 to 123 again (`rolled_back` {from: 123, to: 120}, depth 4).
  **"Equals a straight run's by pixel hash"**: copy 1's `render_back` frames after the rollback against copy 1's in the
  same match with every message on time, step for step; steps 123 to 125 are left out, as the rollback lands after
  step 123. **"Naming the step"**: the replaced step 120.
- **"The bake's oldest kept step"**: the design keeps no logic bake shorter than the run (its checkpoint ring thins and
  never drops step 0; its ranges are kept for every step), so the bake of a document with a finite span holds steps 0
  through the transport's end, and its oldest kept step is step 0, at t = 0. **A trail "whose span reaches before" it**
  is read as one whose span is longer than the transport's, so that even its last frame's oldest point falls before
  step 0 (a 3 s span over a 2 s transport), and a span the bake holds (0.5 s) is drawn. A trail's points before t = span
  at the start of any document read before step 0 for any span, as a keyed source's do before its first key; refusing
  those would refuse every trail, so this suite reads them as allowed and doesn't read their points. A dispute about this
  reading goes to a blind redraft.
- **"A source a live drag moves is still refused"**: a world-space emitter anchored on the handle of a `drag_along`
  control (#451's spelling): the base's refusal, which this issue keeps. It is one test with the span refusal, which
  fails at the base, so no test credits the base's refusal alone.
- **Criterion 6's "compared with the merge base"** is the perf lane's, as #1634's and #465's suites read it: the budget
  as a budgets.json task beside the merge base's, and the file in `timed`. **"Within the showpiece's 4 ms of frame CPU at
  p95"**: each run's p95 of `view3d`'s `cpu_ms` over its frames, five runs judged by `judgeLimit`. 1280 × 720 is this
  job's choice: frame CPU hardly depends on the size.
- **Criterion 7's pictures**: the walker's dust at 3 s, the runner's trail at 1.5 s, the swimmer's wake at 20 s, and the
  eight movers from 0 to 4 s as the recording of moving items and their trails.

## The taste call

`ac7-taste.test.ts` writes, from this run's own frames: `particle-trail.png` (the walker's dust at 3 s, 640 × 360),
`line-trail.png` (the runner's trail at 1.5 s), `wake.png` (the swimmer's wake at 20 s), and `movers.apng` (the eight
movers, 0 to 4 s at 30 fps, 320 × 180), all in `target/acceptance/265/`, printing each SHA-256. Show them to the owner
in the session and attach them to the PR; record the one answer in `tests/acceptance/265/TASTE.json`:

```json
{"issue": 265, "criterion": "#265.34736230", "verdict": "looks_right" | "looks_wrong", "who": "...", "when": "<ISO 8601>",
 "screenshots": {"particle-trail.png": "<sha256>", "line-trail.png": "<sha256>", "wake.png": "<sha256>"},
 "recordings": {"movers.apng": "<sha256>"}, "note": "..."}
```

With no file, or one made on other bytes, the test is INCONCLUSIVE; `looks_wrong` fails it. No other test reads a
picture to judge it.

## Not tested

Ribbon trails behind logic-moved items (criterion 1 names a world-space emitter, criterion 2 a `mark.line` trail);
`since` and `whole` windows over a logic bake; `space: local` trails; a wake or an emitter behind a `linear` array (the
trail covers the blend); hover (the Scope keeps it refused, no criterion names it); sources driven by recorded input
entries (#253); a trail's points before t = span; the check's estimate of these reads' cost. They are follow-ups for the
implementer's own tests.

## Upstream tests (the Oracle lane)

The oracle page lists no upstream test for any criterion. None is ported.
