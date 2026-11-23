# Acceptance tests for #1500: a change lands while you play, and the run carries on from where it was

Written first, blind, from issue #1500 (`gh issue view 1500 --repo windoliver/deepbuild`, read live: its Scope, ten
acceptance criteria and Proof line), its Oracle page (`doneright/oracles/issues/1500.md` on branch `doneright` of
DeepBuildAI/deepbuild, and the vendor copy of the one upstream file it pins), the design sections it links and base
commit `5f5791e2d`, by a job that never saw an implementation; none existed, and no other branch, worktree, pull request,
plan or session was read. The implementing agent doesn’t edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding). Criterion 1’s Oracle lane is `tests/acceptance/1500-oracle/`.

## What was read

- The issue and its Oracle page; the vendor copy of the upstream physics engine’s `snapshot_roundtrip.rs`.
- `docs/technical-design.md`: Saves across changes. `docs/canvas-primitives.md`: Logic: saves across changes; One
  clock, pure evaluation (Transport); Logic: saves; Logic: checkpoints and bake; Carried state; Input track. AGENTS.md.
- At the base, for surfaces and patterns only: `crates/deep-show` (`main.rs`’s calls and `--planted`, `picks.rs`’s
  `logic` call, `physics/saves.rs` (#189’s saves of a document with worlds), `frames.rs` (`frames` with `revise`,
  `eval`), `played.rs` (the hub’s input track per document, `enter`), `track_call.rs`, `golden.rs`, `time.rs`,
  `points.rs`’s `world`), `crates/deep-logic` (`saves/layout.rs`: the layout hash; `live.rs`: latched frames and the
  stamp rule), `crates/deep-play` (`logic.rs`, `worlds.rs`), `crates/deep-canvas-physics/src/doc.rs` (body fields),
  `crates/deep-physics-rapier/src/inputs.rs` (`launch`); the suites `189/lab-redraft/` and `189/saves/` (copied and cut
  down: the scenario envelope, the WebAssembly assembler, the budget judge), `522/` and `522-oracle/` (the Oracle
  lane’s pattern), `172/` (a program reading a press), `2010-oracle/` (its `pile` and `upstreamScene`, imported);
  `scripts/proof-change.mjs` (criterion IDs), `scripts/benchmark.mjs` (`judgeLimit`), `scripts/lanes.mjs`.

What the base already does, which these tests don’t credit: `deep_show` writes a document’s revisions; `frames` takes a
whole revision at a frame’s latch (#856) and checks it as a `deep_show` call, so the document’s logic and worlds are
played again from step 0; `logic` steps the logic items from step 0 on the hub’s track; `track` reads and loads that
track; `eval` answers a frame’s `arrays`, `values` at `paths` and carried-state rows; `golden_record`. A save opens
straight only when its world is the document’s by hash (#189). At the base there is no `play_frames`: a scenario holding
one is refused whole, `{"ok": false, "code": "bad_input"}`, and none of the planted names below exists.

Checked at the base with probes (not committed; README: Checked at the base): every fixture document presents with no
issue (the jumper, its patched revisions, the 64 MiB game in 0.4 s, the Oracle lane’s piles); the region map gives the
program’s offsets; a `jump` entry at t = k steps is read by the logic’s step k (step rows: score 3 and `pressed_at`
291 after presses at 101, 201 and 291); the ball launched at step 291 is in flight through step 304, and its height’s
second difference is −0.002725 under −9.81 m/s² and −0.00545 under −19.62, each within 1e-7 of g × (1/60 s)²;
`eval` reads `items/paint/params/base_color`; and this document’s `golden_record` hashes no node at the base (each
step’s hash is the SHA-256 of nothing).

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 240 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/1500 --testTimeout=600000 --hookTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/1500/tsconfig.json
rm -rf tests/acceptance/1500/node_modules/.vite
```

Each file builds `cargo build --locked -p deep-show --bin deep-show` (the default set) once, in `beforeAll` (four hours
allowed), honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set and
Homebrew’s rustup put on PATH when present, and copies the binary out. Planted twins are startup arguments of that
binary, so no other build. A failed build fails at "the binary builds" with cargo’s error; no cargo reads `BLOCKED:`.
Every test passes a 60-minute timeout. Evidence stores and binaries are temporary and deleted. Node built-ins and
vitest only, plus `scripts/benchmark.mjs`’s judge. No process is started but `cargo` and `deep-show`, each waited for;
none is stopped by name or port.

**`scripts/lanes.mjs` needs these lines** (this job writes only its folders; the implementer adds them): every file
builds `deep-show` and plays hundreds of frames, and criterion 8 reads a timing.

```js
alone.push("tests/acceptance/1500/", "tests/acceptance/1500-oracle/");
timed.push("tests/acceptance/1500/ac08-join-time.test.ts");
```

Hosts. Criterion 8 is pinned to the reference Mac: on any other host it fails `BLOCKED: … is pinned to the reference
Mac` before it builds or measures, never passes and never skips. On a Mac its readings are judged by
`scripts/benchmark.mjs`’s `judgeLimit` (five readings after a warm-up; a reference Mac on mains power, Low Power Mode
off, thermal state nominal, load under the core count), as #189’s criterion 11 judges its budgets; anything but PASS
fails, naming the judge’s reason (INCONCLUSIVE under load). Everything else runs on every host.

## The fixture game (helpers.ts)

The jumper: a scene at 60 frames a second (span 11 s; criterion 8’s 6 s; the Oracle lane’s 4 s) with the press control
`jump` (class document), a camera, the material `paint` (`material@1`, `base_color` red [0.8, 0.1, 0.1, 1]) painting
the box `shown`, the world `lab` and the logic item `game`, its program kept in the scenario’s evidence store by
SHA-256.

- **The world** `lab` (`physics.world@1`, 60 Hz, 4 substeps, gravity (0, −9.81, 0)): the static `floor` (top at y 0),
  the dynamic `ball` (a sphere of radius 0.25 m resting on the floor at x 0, `sleep: false`, no damping) and the dynamic
  `crate` (0.5 m, resting at x 2). Its input `jump` (`launch`, `on: {control: jump, each: entry}`) sets the ball’s
  velocity to (0, 5, 0) m/s: launched at step 291, it is in the air past step 302.
- **The logic item** `game` (`logic@1`, 60 Hz, `reads: ["jump"]`, `writes` the i32 arrays `score`, `presses`,
  `pressed_at`, `rule`, `since`): a program written here as WebAssembly bytes, one memory whose maximum is its minimum,
  the immutable globals `reads_at` 0, `writes_at` 4096 and **`layout_at` 2048**, no mutable global, `init` and `step`.
  Its one active data segment at 2048 is its state layout: a little-endian u32 length, then a field table
  `{"name": "jumper", "version", "fields": [{name, offset, type: "i32", count: 1}]}` (Logic: saves across changes).

### Programs

| Program | Layout | A step that reads n presses |
|---|---|---|
| rule 1 (`V1`) | A: `score` 8192, `presses` 8196, `pressed_at` 8200, `since` 8204 (version 1) | score += n; presses += n; pressed_at = k |
| rule 2 (`V2`) | A, the same bytes | score += 10 n; presses += n; pressed_at = k; on its first call (since 0) since = k + 1 |
| rule 1 under layout B (`V3`) | B: `lives` 8192 inserted, so `score` 8196, `presses` 8200, `pressed_at` 8204, `since` 8208 (version 2) | as rule 1, at B’s offsets |
| `BIG1`, `BIG2` | rules 1 and 2 under A, with 1,024 pages (64 MiB, `budget: {memory: 64}`); `init` writes a nonzero byte at the end of every page | as rules 1 and 2 |

Every step writes `score`, `presses`, `pressed_at`, `rule` (1 or 2) and `since` − 1 (−1 until a rule 2 program has
run; then the step of its first call). V1 and V2 differ in code only, so their layout (the SHA-256 of the layout bytes,
as `deep-logic`’s `saves/layout.rs` computes it) and segments are the same; V3’s layout differs in every field.

## The surface under test

The issue names joins, carrying on, restarts with a line, seeks, checks, goldens, evidence, the input track, pending
input, a timing and planted twins, but no command line. The surface is `deep-show run` (#393’s convention: one
scenario line in, one answer line out, one reply per call), the app’s engine, which already holds documents and their
revisions and plays a document’s logic and worlds. **Every call, field, reply field, code and planted name below that
the issue or the design doesn’t give is this job’s invention**, the smallest surface the criteria need, extending the
base’s `frames` (#856’s revision at a frame’s latch), `logic`, `track`, `eval` and `golden_record`; the implementer
builds exactly these, or a dispute goes to a blind redraft. Calls not named here stay as their own suites define them.

### `play_frames`

```text
{"call": "play_frames", "doc", "frames": n (1 to 100,000), "events"?: [Event], "rows"?: [frame], "paths"?: [path]}
Event  = {"frame": k, "press": control ID} | {"frame": k, "revise": document} | {"frame": k, "seek": step}
→ {"ok": true, "frames": [Row], "joins": [Join]}
Row    = {"frame": k, "step": s, "rev": n, "from": f, "deep_hash": {<carried state ID>: 16 hex},
          "arrays": {"<item ID>.<name>": [number]}, "worlds": {<world ID>: {<body ID>: {"pos": [x, y, z], "rot": [x, y, z, w]}}},
          "values"?: {path: value}}
Join   = {"frame": k + 1, "step": k, "rev": n, "outcome": "carried" | "restarted",
          "worlds": {<world ID>: {<body ID>: {"pos", "rot"}}}, "differs"?: [Differ], "line"?: string, "ns": ns}
Differ = {"what": "layout", "item", "held": layout hash, "piece": layout hash, …} | {"what": "body", "world", "body"} | …
```

- The document `doc` live, from step 0 of its current revision on the hub’s input track for it (`track`’s), frames
  0 to n − 1 in order, on the virtual clock: each frame waits for every step its playhead needs, so no row is stale.
- **Frames and steps.** Frame k’s playhead is at step k’s time (k × 1/60 s) unless a seek moved it, and the frame
  shows the state after the step at its playhead ran: step k reads the entries stamped at k (t in ((k − 1), k] steps,
  as the `logic` call reads them). A row’s `step` is that step; `rev` the revision it ran under (the hub’s number,
  as `revisions` lists it; the first presented is 1); `from` the first step of the run it belongs to (0 for a run from
  the start, j + 1 for a run carried on from a join at step j); `deep_hash` each carried state’s full-state hash after
  the step, by ID: each logic item’s (Logic: checkpoints and bake) and each world’s (#2009’s, over the backend’s
  whole world); `arrays` every array each logic item writes (as the `logic` call’s step rows); `worlds` every body of
  every world, static ones included; `values`, with `paths`, each path’s value as the frame draws it (as `eval`’s).
  `rows` names the frames the reply lists (absent: every frame); rows not listed need not be read out.
- **In a frame.** First the latch: each `press` of frame k appends one entry to the document’s input track, as an
  input to the control does (`{control, value: 1, writer: "you"}`), stamped by the Input track rule: the first step at
  or after the playhead’s step plus the input lead (one step while silent), or the first step not yet run, whichever
  is later; for a press in frame k, step k + 1. A `seek` moves the playhead. A revision the latch takes joins (below).
  Then the steps the playhead needs; then the row. A `revise` of frame k is the document’s next revision, written as
  `frames`’s `revise` writes one (#856: by the writer of its last revision, admitted as a `deep_show` call), arriving
  while frame k is drawn, after its steps: frame k shows step k under the revision it began with, and frame k + 1’s
  latch takes the new one.
- **The join.** When frame k + 1’s latch takes a new revision, the run holds its state after step k, every carried
  state of it, and opens it under the new revision by the rules a save opens under (Logic: saves; Logic: saves across
  changes), except that a world is matched by its bodies, shapes and joints rather than by its hash:
  - **carried** when every logic item’s program keeps its state layout, or a declared migration applies, and every
    world keeps every body, shape and joint by ID (any other field may change, such as gravity or a material). The
    run carries on: frame k + 1 runs step k + 1 under the new revision from the held state (`from` k + 1);
  - **restarted** otherwise: the old bytes are never read under the new revision; the run restarts at step 0 under it
    while the playhead goes on, so frame k + 1 shows step k + 1 of a run from step 0 (`from` 0), as a fresh run of
    the new revision does. `differs` names what differs (a layout as #189’s Differ does, the held and the new hashes;
    a body that went, by world and ID) and `line` is the one line the viewer reads, a notice: it names each, a layout
    by at least the first 8 hex characters of each hash, a body by its ID.
  - Input latched before the join and not yet read stays pending and is read by the steps it is stamped for, under
    the new revision. A join writes nothing to the input track.
  - Join: `frame` k + 1, `step` k (the step whose state was held), `rev` the new revision, `worlds` every body as the
    opened state holds it at step k (the held state for a restart), `ns` the wall time from the revision’s arrival to
    the state after step k + 1 being ready, the readouts (`deep_hash`, `worlds`, `values`) left out.
- **Seeks.** A seek to step s within the current run (s ≥ its `from`) restores and steps as a live view does; a seek
  before it, before the join, drops the carried-on run and restarts at step 0 under the current revision: the row
  shows step s of a run from step 0. Frames after go on from s + 1.
- **Never evidence.** A carried-on run is session state. After a play, `logic` (its run and its `check`),
  `golden_record` and `eval` of the document give what they give for its current revision played from step 0 on the
  hub’s track, as in a process that never ran the earlier revision, and a carried-on run is never the record a
  `logic` replay is compared with.

### Planted twins (`deep-show run --planted <name>`)

Each is one criterion’s wrong program, reachable only through the startup argument, and changes nothing else.

| Name | Criterion | The wrong program |
|---|---|---|
| `join_restarts` | 1 | every join restarts the run at step 0, whatever the revision changed |
| `join_reads_old_bytes` | 4 | a revision whose program’s layout differs, with no migration, carries on: the held memory and globals opened under the new program as they are |
| `checks_read_carried_run` | 7 | after a join that carried on, `logic` (its run and its check), `golden_record` and `eval` take each step the carried-on run ran from that run instead of playing the revision from step 0 |
| `join_writes_entry` | 9 | each join appends one entry of its own to the document’s input track (any control and value, writer `you`), stamped at the step the run goes on from |
| `join_clears_pending` | 10 | a join drops the input latched before it and not yet read |
| `join_poses_only` | 1, Oracle lane | a join that carries on opens each world built afresh from the new revision with each body’s pose and velocities set as held, the rest of the world’s state (contacts, broad phase, solver warm start) as the fresh build has it |

## Criteria to tests

IDs are `scripts/proof-change.mjs`’s: the first 8 hex characters of the SHA-256 of each criterion’s text as the issue
holds it, trimmed, white space collapsed. Each test’s name starts with its criterion as `AC<n> #1500.<id>`.

| # | ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|---|
| 1 | `#1500.969af07a` | `ac01-material.test.ts` (2) | Presses in frames 100, 200, 290; the material patched red to blue at step 300. Step 299 shows red, step 301 blue; one join at 300, carried; step 301 from 301 under the new revision; `game`’s and `lab`’s full-state hashes at 301 equal an unpatched run’s. `join_restarts`: the judge fails, naming step 301. Fails on: the base; a restart; a frame that shows the patch late |
| 2 | `#1500.d2cd8796` | `ac02-program.test.ts` (1) | Rule 1 patched to rule 2 (same layout) at step 300, presses read at 101, 201, 291, 321: carried; score 3 under rule 1 at 300 and 3 at 301 under rule 2, whose `since` is 301 (its step first called for 301); 13 at 321; the join holds every body where step 300 had it; `lab`’s hash and bodies at 301 equal an unpatched run’s. Fails on: a restart, a reset score, the old step run on, the new one run from step 0 |
| 3 | `#1500.5b51b79e` | `ac03-gravity.test.ts` (1) | Gravity −9.81 to −19.62 at step 300, the ball in flight from 291: carried; the join’s bodies are step 300’s; the ball’s height’s second difference over 298 to 300 is −9.81/3600 and over 300 to 302 is −19.62/3600, each within 2e-5. Fails on: a refusal by world hash, bodies moved at the join, the old gravity kept a step |
| 4 | `#1500.e3f1b11d` | `ac04-layout.test.ts` (2) | Layout A to B at step 300, no migration: restarted; step 301 from 0 equals a fresh run of the new revision in every hash and array; a `layout` Differ naming `game`, sha256(A) held and sha256(B); the line holds the first 8 hex of both. `join_reads_old_bytes`: the judge fails, naming step 301 |
| 5 | `#1500.5b02eccf` | `ac05-removed-body.test.ts` (1) | The crate removed at step 300: restarted; step 301 equals a fresh run of the new revision; a `body` Differ naming `lab` and `crate`, the line naming `crate`; no crate at 301. Fails on: carrying on, a line that names nothing |
| 6 | `#1500.ff44ea26` | `ac06-seek.test.ts` (1) | Gravity patched at 300 (carried), presses read at 61, 291, 351; frame 400 seeks to step 120: step 120 from 0 under the new revision, its hashes, arrays and bodies a fresh run’s of the new revision (and not the old run’s step 120); play goes on at 121. Fails on: the old run’s checkpoint, the carried-on run kept |
| 7 | `#1500.e19d11cf` | `ac07-never-evidence.test.ts` (2) | Rule 1 to 2 at 300 (carried; its step 350 scores 23, a fresh run of rule 2 50); then `logic` with `check: "logic.determinism"`, `golden_record` (720 steps) and `eval` at step 350 equal, every step, those of a process that presented rule 2 first on the same track; the check reads PASS. `checks_read_carried_run`: the judge fails, naming frame 301 |
| 8 | `#1500.d43f7964` | `ac08-join-time.test.ts` (1) | Reference Mac only (BLOCKED elsewhere): the 64 MiB game patched at 300 to the other rule, carried; the join’s `ns`, judged by `judgeLimit` against 200 ms |
| 9 | `#1500.fa7fb729` | `ac09-track.test.ts` (2) | 620 frames; patches in frames 30, 60 … 600 alternating rules 2 and 1; presses in each of those frames and 15 frames before each: `track` holds exactly 40 entries, each press once at its stamp. `join_writes_entry`: 60 entries, the judge naming the first left over, at step 31 |
| 10 | `#1500.de71542b` | `ac10-pending.test.ts` (2) | The same run: for each patch frame F, frame F + 1 is from F + 1 under a new revision with its rule, and shows `pressed_at` F + 1 and 2(i + 1) presses read, 20 of 20. `join_clears_pending`: the judge fails, naming frame 30’s press and step 31 |

Test count: 2 + 1 + 1 + 2 + 1 + 1 + 2 + 1 + 2 + 2 = 15; the Oracle lane 3.

## Readings where the issue leaves a choice

- **The surface.** `deep-show`, not `deep-logic`: only the app plays a document’s logic and worlds together and holds
  its revisions. A play is one call with a script, as `frames` takes a revision at a frame, so a revision, a press and
  a seek land at a named frame and nothing depends on wall time; the revision is written as #856 writes one.
- **"At step 300 … at step 301"; "the new `step` runs from 301".** The patch lands while the frame at step 300 is
  drawn: that frame shows step 300 under the old revision, the run’s state after step 300 is held, and step 301 is
  the first run under the new revision (its `step(k)` first called with k = 301). This is also what makes "the presses
  sent in the frame a patch lands" reach "the first step run under the new revision": the stamp rule puts them at
  step 301.
- **"The logic and physics state hash".** Each carried state’s full-state hash, the logic item’s and the world’s, as
  checkpoints have them; "equals an unpatched run’s" is equality for each, read from a play of the same presses with
  no patch in another process.
- **"A planted restart fails, naming the step".** A restart replays every step from 0, so for a material its states
  equal the unpatched run’s; what tells it apart is that its frame at step 301 comes from a run from step 0 and its
  join restarted, which the judge reads and names at step 301.
- **"Restarts at 0".** The run starts over at step 0 under the new revision while the playhead goes on, so the frame
  after the join, and a frame after a seek before the join, is what a fresh run of the new revision shows at that
  step (`frame(t) = eval(doc, t, inputs ≤ t, view)`); seeking before the join and a refused join read alike.
- **"Keeps every body where it was at the join"; "the next step uses the new gravity".** The join’s bodies against
  step 300’s; the ball’s height in free flight, whose second difference over three steps is g × (1/60 s)² when the
  two steps share one gravity, whatever the integrator’s substeps.
- **"Naming both layouts".** The layout hashes (#189’s: SHA-256 of the layout bytes), whole in the Differ and by at
  least their first 8 hex characters in the line.
- **"No carried-on frame enters a golden or an evidence bundle".** The check, the golden and the frame a snapshot or
  an evidence bundle takes (`eval`’s arrays and carried-state rows) after the play equal, every step, those of a
  process that presented the new revision first: a carried-on frame in any of them makes a step differ, and the judge
  names its frame. At the base this document’s golden hashes no node, so the golden is compared but only the check
  and the evaluation can see a capture here.
- **"40 scripted presses while 20 patches … land".** Each patch alternates the game’s two programs, which keep one
  layout, so each is a new revision that carries on; "each once, and no other entry" is a one-to-one match of the
  track’s entries to the presses’ stamps, anything left over named earliest first.
- **"Read by the first step run under the new revision".** The game records what its steps read: the step that
  last read a press, the count of presses read and its rule, so the frame of step F + 1 shows that step F + 1 ran
  under the new program and read the press.
- **"Under 200 ms … with a 64 MiB state".** A logic memory of 1,024 pages, each holding data; the reading is the
  join’s `ns`, from the revision’s arrival to the first carried-on frame’s state, readouts excluded; judged against
  its absolute limit on the reference Mac with the repository’s judge, as #189’s budgets are.

## Checked at the base, and not

Checked: `BASE-FAILURE.txt` records one file’s run at the base (`ac01-material.test.ts`): both tests fail at "deep-show
run takes the scenario", the scenario refused `bad_input` for its `play_frames` call, after the region-map probe
presented the jumper. Before writing the tests, scratch probes (not committed) ran the base’s `deep_show`, `deep_query`,
`track`, `logic`, `eval`, `golden_record` and `world` on the fixture, with the results under What was read. Not
checked: anything of `play_frames` (the base has none), so whether a frame’s readouts match the `logic` call’s and
`world`’s is held by the tests themselves, each against another play of the same surface.

## What the implementer adds outside this folder

- `play_frames` in `deep-show` (README: The surface under test), with the join, carrying on, restarts, seeks, pending
  input and never-evidence rules, through `deep-play` where the web player shares them.
- The planted names above in `deep-show`’s `--planted`.
- The `scripts/lanes.mjs` lines under Run them.
