# Acceptance tests for #522: inputs other modules fire, the checkpoint ring, seek versus edit, and late inputs restored and stepped again

Written first, from issue #522 (its Scope, its Fields for the checkpoint ring, nine acceptance criteria and its Proof
line: "Seeks and scrubs equal to playing by step hash, the late poke restored with its planted twins, and the ring kept
within its forced budget"), its Oracle page (`doneright/oracles/issues/522.md` in DeepBuildAI/deepbuild, branch
`doneright`, and the two vendor files it pins), the design sections it names and base commit `53c0e72a3` ("Merge pull
request #2356 …", which holds #2009's, #2010's, #2012's, #1918's, #1919's, #1920's and #1921's merges), by a job that
never saw an implementation; none existed, and no other worktree, branch, pull request or plan was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one file per criterion, one test per clause that needs its own run, plus a test for each planted
twin the criteria name; `deep-physics` wherever a criterion allows, `deep-show` for the seal, a test canvas module's
inputs and the conformance kit (criteria 2, 3 and 7). The Oracle page's three ported criteria (1, 5 and 8) are also in
`tests/acceptance/522-oracle/`.

## What was read

- The issue, live with `gh issue view 522 --repo windoliver/deepbuild`; its Oracle page and its vendor copies of the
  upstream engine's `snapshot_roundtrip.rs` and the second upstream engine's rewind suite (`…TestRewind.cpp`).
- `docs/technical-design.md`: The physics module (World; Soft body and checkpoint ring; Input, occurrence, output; Bake
  and golden); The net module (Match, Rollback, Lockstep); Dogfooding; Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: A timeline as data over a pinned backend; World and backend `physics.world@1` (its
  step order: "apply the inputs stamped for it, ordered by kind then target ID"); Input track entries; Input track;
  Checkpoint ring; Bake; Golden; Physics output (a live frame past what's simulated shows the last state marked stale);
  Joint `joint@1` (`breaks_at`, `over_steps`, the steps past it kept in checkpoints); Occurrence list; Net: rollback;
  Net: lockstep; Check input: `physics.determinism`.
- At the base, read only for the surfaces these tests extend: `tests/acceptance/2009/`, `2010/`, `1918/`, `1919/`,
  `1920/`, `1921/`, `138/`, `238/`, `532/`, `535/` and `2010-oracle/` (READMEs and helpers; 532's live view and frames,
  238's and 535's builds without logic, 138's kit and its late-entry part); `crates/deep-physics-*` (`runner.rs`,
  `main.rs`, `lib.rs`, `occurrences.rs`, `Cargo.toml`); `crates/deep-canvas-physics` (`backend.rs`, `bake.rs`,
  `module.rs`, `golden.rs`, `doc.rs`'s world, checkpoint and joint fields); `crates/deep-show` (`main.rs`'s build set and
  its `test-*` features, `physics.rs`, `kit/carried.rs`, `kit/modules.rs`'s test.kit.tally, `kit/manifest.rs`,
  `Cargo.toml`); `crates/deep-logic/src/live.rs` (the frame, stale and `eval_ns` surface #532 built);
  `crates/deep-canvas-input/src/track.rs`; `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs`
  (`twins.json`), `scripts/lanes.mjs` (`alone`, `timed`), `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`).

What the base already does, which these tests don't credit: `deep-physics` bakes a world from step 0 with step hashes,
a checkpoint every `checkpoint.every` steps (the backend's whole world as bytes, with a 16-hex `deep_hash`), its
occurrence list and outputs, keeps bakes in a store by key, restores a checkpoint, and records and verifies goldens
(#2009, #2010, #1918). Its world reader takes `checkpoint.budget` and ignores it (every checkpoint is kept); it refuses
`inputs` ("#522 brings it"), its bake key holds an empty track, and its backend's step refuses any input. It has no
seek, no live or baked view, no late entry and no physics.determinism. `deep-show`'s full set holds the physics module
(#1920) and `test-leave-out-logic` leaves logic out; no physics stepper or fixture is in the kit, and no canvas module
contributes physics inputs. Checked at the base before the run, with probes on the base's `deep-physics` (not
committed): criterion 5's ball, dropped from rest with its centre 21.16 m above the floor's top, writes its first
`contact_begin` and `hit` with the floor at step 250 (from 21.08 m to 21.26 m up it is step 250; 21.07 m gives 249 and
21.27 m 251), falling at 19.62 m/s after step 240, 1.52 m up.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/522 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/522/tsconfig.json
rm -rf tests/acceptance/522/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set, Homebrew's rustup put on PATH when present, and copies each binary into a
temporary folder:

| File | Builds |
|---|---|
| `ac1-seek-stack.test.ts` | `cargo build --locked --bin deep-physics` (#2009's helper) |
| `ac2-without-logic.test.ts` | the same; `cargo build --locked -p deep-show --bin deep-show --features test-leave-out-logic`, and `--features test-leave-out-logic,test-physics-needs-logic` |
| `ac3-module-inputs.test.ts` | `deep-physics`; `deep-show` with `--features test-launch-module`, and with `--features test-launch-module-first` |
| `ac4-scrub-and-fork.test.ts` | `deep-physics` |
| `ac5-late-poke.test.ts` | `deep-physics` |
| `ac6-ring-budget.test.ts` | `deep-physics` |
| `ac7-late-joint.test.ts` | `deep-show` with no features (the full set), and with `--features test-physics-checkpoint-drops-break-steps` |
| `ac8-determinism.test.ts` | `deep-physics` |
| `ac9-seek-across-frames.test.ts` | `deep-physics` |

Every test passes a 60-minute timeout (#2009's `TIMEOUT`); a file's builds have 60 minutes each. Stores, evidence
roots and binaries are temporary and deleted. Node built-ins and vitest only; `../1918/helpers.ts` (and through it
`../2010/helpers.ts` and `../2009/helpers.ts`) and `../138/helpers.ts` are imported read only: the world builders
(`world`, `box`, `sphere`, `floor`, `dynamic`, #2010's `ballAndGoal`), the build of `deep-physics`, #1918's runner,
rows, scene and `deep-show run` scenario helpers, `seededFrames`, `scratch`, `useTemp`, and #138's `kit` call and report
readers. `scripts/benchmark.mjs`'s `judgeLimit` and `fingerprint` are imported for criterion 9's gate. No process is
started but `cargo`, `deep-physics` and `deep-show`, each waited for or, for a live view, stopped by its own PID; none
by name or port.

Gates. No cargo on this machine is `BLOCKED:` (#2009's helper), a failed test, never a pass. Criterion 9's timing (each
frame's `eval_ns` within 4 ms, `ui_ns` under 2 ms) is judged last in its test, after every reading that doesn't depend
on load, and only where the perf lane's rule holds: `judgeLimit` from `scripts/benchmark.mjs`, given five zero readings
against a limit of 1 so that only the machine and load decide it, must read PASS (a reference Mac on mains power, Low
Power Mode off, thermal state nominal, the load at the session's start and end under the core count); otherwise the
test fails with `INCONCLUSIVE:` and the rule's reason, never a pass, and is never retried. Nothing else here depends
on load: the planted simulate phase that runs 5,760 steps in one frame passes 4 ms on any machine, and load only
lengthens it.

## The surface under test

The issue names an input track with derived entries, a checkpoint ring with fields, seeks, scrubs, forks, late inputs,
a check kind, a live view's frames and planted wrong programs, but no command line. **Every call, field, reply field,
flag, cargo feature and planted name below that the issue or the design doesn't give is this job's invention**, the
smallest the criteria need, extending #2009's, #2010's and #1918's `deep-physics` (their READMEs' surfaces stand as
written), #532's live view and frames (the same fields, for a world), #138's kit and #393's `deep-show run`. The
implementer builds exactly these, or a dispute goes to a blind redraft.

### Worlds (`tests/acceptance/522/helpers.ts`)

- **The stack**: `n_x × n_y × n_z` boxes 0.5 m on a side (density 500, friction 0.6, restitution 0), each layer resting
  on the one below and the lowest on a static floor whose top is y = 0, 2 mm apart sideways. Criterion 1: 2 × 5 × 2 with
  `solver.sleep.on: false`; criterion 6: 5 × 8 × 5 with sleep on.
- **The ball-and-goal lab**: #2010's `ballAndGoal()` (a 0.11 m ball kicked at (6, 3, 0.4) m/s toward a goal 8 m down
  +x), with `checkpoint: {every: 60}` and `inputs: {grab: {kind: "grab", targets: ["ball"], point: [0, 0, 0], plane:
  "ground"}, release: {kind: "release", targets: ["ball"], keeps_velocity: true}}`. **Its eight recorded grabs**: a
  grab at steps 60, 180, 300, 420, 540, 660, 780 and 900, each released 24 steps later (16 entries). Criteria 4 and 8 run
  it 10 s (1,200 steps); criterion 9 views it over 60 s with an empty track.
- **The drop**: a 0.1 m ball of 1 kg at rest 21.16 m up over the floor (restitution 0), `inputs: {poke: {kind: "poke",
  targets: ["ball"]}}`, a checkpoint every 60 steps.

### The world document and the input track

- **`inputs: {ID → Input}`** (Input track entries: "Declared by the world"): `Input = {"kind", "targets": [body ID],
  "on"?: On, "data"?: {field → value}, …the kind's defaults as fields}`. `On = {"control": control ID, "each"?: "entry"
  | "change"}` or **`{"<canvas module>": item ID}`**: the entries that item of that canvas module fires, `{"logic": ID}`
  being the logic module's (Input track entries), `{"test.launch": ID}` this suite's test module's. The physics module
  reads `on`'s module by name only and never depends on it; whether the module is in the build is the host's question
  (`deep-show`: `module_missing`).
- **`checkpoint: {every: steps = 60, budget: bytes = 16 MiB}`** (Checkpoint ring): the budget is now kept.
- **`track`**: `check`, `bake`, `restore`, `golden`, `seek`, `view` and `determinism` take `"track"?: [Entry]` (absent:
  `[]`), the world's input track, with **`Entry = {"step": k, "kind", "target": body ID, "data"?: {…}}`** (Input track
  entries' fields). An entry is admitted when an input the world declares has its kind and lists its target, whatever
  its `on` (so the entries a bake keeps replay through `deep-physics` as they were kept); the check refuses any other,
  naming it. The bake key covers the track (Bake: `key`), so another track is another bake.
- **Step convention.** An entry stamped `step: k` applies at the start of the step from the state after k steps
  (`step_hashes[k]`) to the state after k + 1: it first shows in `step_hashes[k + 1]`, and the checkpoint at step k
  (#2009's: the state after k steps) holds the state before it applies. Entries of one step apply in (kind, target ID)
  order, never in the order they were written (World and backend; Input track entries). An occurrence row's `step` is
  #1918's: the step that wrote it, the one ending in the state after that many steps.
- **The kinds these tests use**, with this suite's reading of their data: `grab {point: local m, plane}` (a spring the
  wrapper adds each step toward the grab's target, where `point` was when it applied, at the declared `hz`,
  `damping_ratio` and `max_accel`, until a release); `release {keeps_velocity}`; **`poke {push: vec3 m/s}`**, the whole
  body's linear velocity changed by `push` (no point or radius); `launch {linear: vec3 m/s}`, its linear velocity set.

### `deep-physics`: what this suite adds

| Call | Reply |
|---|---|
| `bake`, as #2010's, plus `track` | #2010's reply, plus **`"ring": Ring`**; with `checkpoints: true`, `checkpoints` is the ring as the bake leaves it |
| **`{"call": "seek", "world", "track"?, "steps": n, "frame_rate"?, "store": folder, "to": s, "play"?: m = 0, "read"?: [body ID]}`** | `{"ok": true, "key": 64 hex, "from": c, "step_hashes": [16 hex], "bodies": {ID: [State]}}`, or `{"ok": false, "code": "no_bake", "key"}` |
| **`{"call": "view", "world", "track"?, "span": seconds, "store"?: folder}`** | `{"ok": true, "session": string, "key": 64 hex, "baked": bool, "track_hash": string, "track": [Entry]}` |
| **`{"call": "frame", "session", "seek"?: k, "scrub"?: k, "input"?: {"kind", "target", "data"?}, "late"?: Entry}`** | `Frame` |
| **`{"call": "record", "session"}`** | `{"ok": true, "at": k, "step_hashes": [16 hex], "occurrences": [Row], "track": [Entry]}` |
| **`{"call": "determinism", "world", "track"?, "steps": n, "at_times": [seconds], "compare"?: "same_machine"}`** | `{"ok": true, "kind": "physics.determinism", "verdict": "PASS" \| "FAIL" \| "BLOCKED", "failures": [DetFailure]}` |

```text
Ring       = {"every": steps, "budget": bytes, "bytes": bytes, "peak": bytes}
Frame      = {"ok": true, "frame": n, "t": flicks, "want": k, "at": k, "stale": bool, "steps": n, "eval_ns": ns, "ui_ns": ns,
              "step_hash": 16 hex, "key": 64 hex, "track_hash": string, "track": [Entry], "stamped": Entry | null,
              "fork_at": step | null, "dropped": [Entry], "restored": step | null}
DetFailure = {"run": "twice" | "checkpoint" | "probe", "from": step | null, "at": step | null, "input": input ID | null,
              "step": step | null, "field": "step_hash" | "canonical_hash" | "deep_hash" | "occurrences" | null}
```

- **The ring** (Checkpoint ring). A bake takes a checkpoint each `every` steps; when keeping the next one would pass the
  budget, the spacing doubles and the ring keeps only the checkpoints on the new spacing, so it never holds more than
  its budget. `ring.every` is the spacing at the end, `budget` the world's, `bytes` the sum of the kept checkpoints'
  `state` byte lengths, `peak` the most bytes the ring held at any moment of the bake. Each checkpoint is `{step,
  deep_hash: 16 hex, state: base64, backend, …}` as #2009's and #2010's. The stored bake keeps its ring.
- **`seek`** reads the bake kept in `store` under the key `bake` gives the same world, track, steps and frame rate,
  restores the nearest checkpoint of its ring at or before `to` (`from`; the world as built, step 0, when the ring keeps
  none), steps to `to`, then `play` more steps on the track. `step_hashes[i]` and `bodies[id][i]` are the state after
  `from + i` steps, through `to + play`; `read` names the bodies answered (absent: every body; `[]`: none). It never
  re-bakes and stores nothing; with no bake under the key, `no_bake`.
- **Views and frames** (Physics output; Carried state; Input track; #532's frames for a world). `view` opens a session
  on the world and its track at time 0 over `span` seconds. With `store` holding the bake of this world and track over
  the span (`span × step_rate` steps, frame rate 60/1, as `bake` keys it) the session is **baked**: it plays and seeks
  that bake and steps only to fork. Otherwise it is **live**, with no bake: only the build has run, and each frame's
  simulate phase runs the steps that frame needs within the render worker's 4 ms of CPU, taking the world's checkpoints
  on its ring as it steps. Each `frame` is one frame:
  - `seek: k` or `scrub: k` moves the playhead to step k's time (k × the step's flicks); a seek or a scrub only moves
    the playhead (Input track: "change on a seek or a scrub alone" it can never). In a live session a seek restores the
    nearest checkpoint at or before it when that's nearer than stepping on, and a newer seek cancels the steps an
    older one still needed and keeps every checkpoint taken.
  - `input` is a new entry at the playhead: stamped at the first step at or after the playhead's step plus the input
    lead (one step while silent), or the first step not yet run, whichever is later (`stamped`, with the input's
    defaults in its `data`). Where later entries exist it forks the track at that step: `fork_at` the stamp's step,
    `dropped` the entries after it, a new `track_hash` and `key`. A baked session re-simulates the fork in that frame:
    it restores its bake's checkpoint at or before the stamp (`restored`), steps to the end of the span (`steps`), and
    keeps the new bake in its store under the new key.
  - `late` is an entry stamped at a step the world has already run (a peer's in a match, or this suite's test
    writer): no fork, nothing dropped, `fork_at` null. It joins the track at its step; the world restores its
    checkpoint at the nearest checkpoint step at or before the entry's step (`restored`) and steps forward again to
    the playhead, across frames, dropping the occurrences, step hashes and checkpoints of the steps it replaced.
  - Fields: `frame` the frame's number from 1 in its session; `t` the playhead in flicks; `want` the state the frame
    at the playhead draws (step k for a seek to k); `at` the state it shows: the last stepped state in a live session,
    the bake's in a baked one; `stale` true while `at` ≠ `want`; `steps` the steps this frame ran (0 for a frame that
    only reads a bake); `eval_ns` the simulate phase's CPU time on the render worker's thread this frame; `ui_ns` the
    UI thread's CPU time this frame; `step_hash` the shown state's step hash; `key` the bake key of the world and the
    session's track now; `track_hash` and `track` the track now; `restored` the checkpoint step a restore loaded this
    frame, else null.
  - `record` answers what the session's world holds now: its step hashes for the states 0 … `at`, its occurrence list
    (#1918's rows, sorted) and its track.
- **`determinism`** is physics.determinism (Check input: `physics.determinism`). A sampled time t s is step ⌊t ×
  step_rate⌋. Runs: `twice`, the bake from step 0 a second time; `checkpoint`, for each sampled step s and each
  checkpoint c of the bake's ring before s, a run restored from c to s; `probe`, at each sampled step s, from the
  straight state and from each checkpoint run's state at s, for each input the world declares, an entry of it stamped s
  with its defaults on its first target, then 120 steps (s + 1 … s + 120), the two probes compared. The check passes
  only when every step hash, every checkpoint's canonical and deep hash and the occurrence list match the straight
  run's and every probe pair agrees. Each run that disagrees gives one failure: `from` the checkpoint it restored
  (null for `twice` and the straight probe), `at` the sampled step, `input` the probe's input, `step` the first step
  that differs (for a probe, in s + 1 … s + 120), `field` the first kind of difference. `compare` other than
  `same_machine` reads BLOCKED and isn't used here.

### Planted twins of `deep-physics`

Each is one criterion's wrong program, reachable only through `--planted <name>` (one per process, as #2009's), and
changes nothing else; its process must exit 0 and answer, and the judge that passes the real program must fail on it.

| Switch | Criterion | The wrong program |
|---|---|---|
| `--planted checkpoint_poses_only` | 1 | each checkpoint holds only each body's pose and velocity; restoring one builds the world and sets them, so its contact graph and warm-start impulses are lost |
| `--planted fork_on_scrub` | 4 | a frame's `scrub` forks the track at the playhead's step, as a new input does: the later entries dropped, the track's hash and the bake's key changed |
| `--planted restore_keeps_replaced_occurrences` | 5 | a late entry's restore keeps the occurrences the replaced steps wrote, beside the ones its steps write again |
| `--planted late_entry_forks` | 5 | a late entry forks the track at its step, dropping the entries after it, as a new input does |
| `--planted ring_drops_oldest` | 6 | a ring that would pass its budget drops its oldest checkpoint instead of doubling its spacing |
| `--planted restore_without_warm_start` | 8 | every restore loads the whole world but clears the contacts' and joints' warm-start impulses |
| `--planted simulate_runs_all_steps` | 9 | a live frame's simulate phase runs every step its frame needs in that frame, whatever its CPU time |

### `deep-show`: what this suite adds

| Cargo feature | The build |
|---|---|
| `test-physics-needs-logic` | criterion 2's planted module: the physics module whose manifest declares `logic` among its required dependencies, as #238's `test-sandbox-needs-logic` does for sandbox; built with `test-leave-out-logic` |
| `test-launch-module` | the full set with the test canvas module **`test.launch`**: kind `test.launch@1`, params `{step: u32, linear: vec3 m/s}`. Each item fires one `launch` entry `{linear}` for step `step`, a derived entry on the core's input track, which reaches each target of each world input whose `on` is `{"test.launch": <the item's ID>}`. It writes its entries after the input module's entries of the same step |
| `test-launch-module-first` | the same module, writing its entries before the input module's entries of the same step |
| `test-physics-checkpoint-drops-break-steps` | criterion 7's planted module: the physics module whose checkpoints (its world's and its kit stepper's) leave out each joint's count of steps past `breaks_at`, restored as 0 |

- **`{"call": "physics_bake", "doc", "world": world ID, "track"?: [core Entry]}`** → `{"ok": true, "key": 64 hex,
  "steps": n, "step_hashes": [16 hex], "inputs": [Kept]}`: the bake of a world the presented document `doc` lists, over
  its transport's span, in its scene, on the core's input track: `track`'s entries (as `eval` takes them: `{t, seq,
  control, value, writer, player}`) and every entry a canvas module contributes. `inputs` are the entries the bake keeps
  (Scope: "kept in the bake"), every derived one included, in the order they apply: `Kept = {"step", "kind", "target",
  "data", "input": the world input's ID, "from": "control:<control ID>" | "<canvas module>:<item ID>", "written": n}`,
  `written` the place the entry, or the control entry it derives from, took on the core's input track as the modules
  wrote it (0 the first).
- **Worlds in a document** stay #1918's (a scene's `worlds: {ID → World}`). A world input whose `on` names a canvas
  module the build doesn't hold refuses the document with an error issue `module_missing` naming the module (`module`,
  `ids` or `what`), as a missing module's kind does; nothing else about such an input is refused for it.
- **The physics module in the kit** (#138's `kit` call, its `late_entry` part): the module registers a stepper over a
  world and a kit fixture **`parity/physics/late-joint.<profile>`** whose world holds a joint with `breaks_at:
  {over_steps: 3}` that crosses its threshold one step before the step a late entry's rollback runs first, and whose
  sidecar declares that entry. The part plays it as it plays every module's (each declared entry arriving 1 to 8 steps
  late). A physics `late_entry` case also records **`restored`**, the first step the rollback runs again (one past the
  checkpoint it restored), and **`breaks: [{"joint", "over_steps", "on_time": step | null, "late": step | null}]`**, each
  joint's break step in the on-time run and in the late one. A physics `late_entry` failure whose first difference is in a
  joint (its state, such as its steps past `breaks_at`, or its `break`) also carries **`joint`**, the joint's ID,
  beside its `step`.
- Driven unchanged: #393's scenario, `registry`, `deep_show`, `eval` with `paths`, the startup refusal (`seal_refused`,
  exit 2, `modules`), and #138's `kit` with `modules` and `parts`.

`twins.json` maps each criterion's ID to the planted twins it names.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the live issue. Each `describe` and `it` title starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#522.e8dd3a56` | `ac1-seek-stack.test.ts` (2) | The 20-box stack baked 960 steps into a store; `seek` to 330 with `play` 570 restores `from` 300 and its step hashes 300 … 900 equal the bake's; its key is the bake's. Under `checkpoint_poses_only` the same judge fails, naming the first step, body and field whose state differs. Fails: a seek from a farther checkpoint, a checkpoint that isn't the whole world, a judge that names nothing |
| 2 `#522.07ad2783` | `ac2-without-logic.test.ts` (3) | The build without logic holds physics and not logic, presents the lab scene (its world taking grab and release) and plays it: the scene's ball at frames 0 … 120 is `deep-physics`'s ball after steps 0 … 240 within 1e-6 m. In it the lab whose world input takes `on: {logic: "coach"}` is refused with an error `module_missing` naming logic; the lab and the lab with a press-derived launch are presented with no error. `test-physics-needs-logic` is refused at the seal, its `modules` naming logic and physics. Fails: physics needing logic, a world input on logic admitted or refused another way, other documents refused |
| 3 `#522.80128e91` | `ac3-module-inputs.test.ts` (2) | In the `test-launch-module` build the lab's bake keeps exactly the test module's launch for step 240 (`from: "test.launch:launcher"`) and the poke the press of `nudge` derives at step 240; a replay of the kept entries through `deep-physics` gives the same step hashes, the ball at rest after step 240 and launched at 6 m/s after 241. The two builds write the two entries in opposite orders and keep the same applied order and step hashes; `deep-physics` gives those hashes with the kept entries in either order on its track; the ball's z velocity after step 241 is the applied order's (0.4 + 2 or 0.4 m/s). Fails: a launch at another step, derived entries not kept or replayed differently, entries applied in write order |
| 4 `#522.ef486477` | `ac4-scrub-and-fork.test.ts` (2) | A baked view of the lab with its eight grabs: 50 scrubs back and forth each show the bake's state at its step with no step and no restore, and leave the track's hash, its entries (eight grabs) and the key unchanged. A seek to 240, then a grab: stamped at 241, `fork_at` 241, the 12 later entries dropped, `restored` 240, 960 steps re-simulated, a new key; the bake kept under it holds steps 0 … 240 of the first bake and equals a straight bake of the forked track. `fork_on_scrub` changes the key on the first scrub and the judge fails there. Fails: a scrub that steps, re-bakes or forks; a fork from step 0 or another checkpoint; a fork that keeps the later grabs |
| 5 `#522.cc560b9c` | `ac5-late-poke.test.ts` (3) | The drop with the sideways poke first touches the floor at step 250; with both pokes from the start it doesn't touch it at 250. A live view runs it to step 256 (touching at 250); the late upward poke at 240 restores step 240, is no fork, drops nothing, and 16 steps bring it back to 256; run on to 480, its record equals the run with both pokes from the start: track, step hashes from 240 on, occurrence list, no contact at 250. `restore_keeps_replaced_occurrences` fails naming the contact of ball and floor at step 250; `late_entry_forks` fails naming step 252. Fails: a restore from another step, kept stale occurrences, a fork that drops the poke at 252 |
| 6 `#522.ab65f8d2` | `ac6-ring-budget.test.ts` (2) | The 200-box stack, 7,200 steps, a checkpoint every 60, its budget 20 times its step-60 checkpoint's bytes: the ring's `peak` and `bytes` within the budget, `bytes` its checkpoints' sum, `every` 480, its checkpoints 480, 960, … 7,200; 20 seeks to steps drawn by a generator seeded 522 from 480 … 7,200 each restore a kept checkpoint at most 480 steps back, with the bake's step hashes. `ring_drops_oldest` keeps no checkpoint before 6,060 and the judge's first failure is the first seek before 6,060, naming its step. Fails: a ring past its budget or never thinned, a seek from step 0 or a farther checkpoint |
| 7 `#522.5a2c866e` | `ac7-late-joint.test.ts` (2) | The kit's `late_entry` part over the physics module in the full set: its late-joint fixture's cases include a joint with `over_steps` 3 that breaks on time at the step after the restored one (so it crossed one step before it), late at the same step, every such case PASS, its entry arriving 1 to 8 steps late, the part PASS. With `test-physics-checkpoint-drops-break-steps` it breaks a step late and the part fails with a physics `late_entry` failure naming that joint and a step from the restored one to the late break. Fails: a checkpoint without the joint's count, a kit that never runs physics, a failure that names no joint |
| 8 `#522.dfeb8487` | `ac8-determinism.test.ts` (2) | physics.determinism of the lab with its eight grabs over 10 s, at_times [2, 5, 9] s: PASS, no failure. Under `restore_without_warm_start`: FAIL, with a `probe` failure naming one of the lab's inputs (grab or release), its sampled step and the first step after it that differs. Fails: a check that passes on hashes at the sampled times alone, a restore without warm-start impulses, a failure that names no input or step |
| 9 `#522.c32bed6d` | `ac9-seek-across-frames.test.ts` (3) | A live view of the lab over 60 s with no bake: a seek to 240 lands; a grab is stamped at 241; a seek to 6,000 runs 5,760 steps across frames, each frame showing its last stepped state (its `at` the steps so far, its step hash a straight bake's of the lab with that grab), stale until the last, which shows step 6,000 on the straight bake's hash; then, gated, each frame's `eval_ns` ≤ 4 ms and `ui_ns` < 2 ms. A second session, once a stale frame shows more than 1,200 steps, seeks to 1,200 and lands there within 60 steps, on the straight bake's hash. `simulate_runs_all_steps` runs 5,760 steps in one frame past 4 ms and the timing judge fails naming that frame. Fails: a catch-up in one frame, a view that shows nothing stale or a state it didn't step, a seek that ignores checkpoints taken while catching up |

Test count: 2 + 3 + 2 + 2 + 3 + 2 + 2 + 2 + 3 = 21.

## Readings where the issue leaves a choice

- **The surfaces.** The physics module's runner, `deep-physics`, carries every criterion it can (1, 4, 5, 6, 8, 9), as
  #2009's to #1921's suites do; `deep-show run`, which holds the build set, the core's input track, test canvas modules
  and the kit, carries 2, 3 and 7. A live or baked view is a `deep-physics` session of `view` and `frame` calls, as
  #532's is `deep-logic`'s; a test drives it line by line.
- **Steps.** "Step 240" for an entry is its stamp (Step convention, above): it applies to the state after 240 steps, so
  "restores its checkpoint at step 240" (criterion 5) is the checkpoint holding the state after 240 steps, before the
  entry, and "the checkpoint at or before 2 s" (criterion 4) is the one at step 240, 2 s × 120 Hz. A contact "at step
  250" is #1918's row step. A grab "at 2 s" in a view is the frame at 2 s's input: stamped at step 241 (the playhead's
  step plus one step's lead, the first step not yet run being the one stamped 240), so "a grab at 2 s and then a seek
  to 50 s need 5,760 steps" is 6,000 − 240.
- **"Restored step"** (criterion 7) is the first step a rollback runs again, one past the checkpoint it loads, as the
  kit's own steppers count ("the state before that step runs"). With `over_steps: 3` a joint past its threshold from
  one step before it breaks on the step after it; dropping its count delays that by one step, as the criterion says.
  "Naming the step" is the kit's `late_entry` failure `step`, the first step that differs from the on-time run: the
  restored step when the step hash holds the joint's count (Joint `joint@1`: the steps past `breaks_at` are in the state
  hash), else the on-time break; the test takes any step from the restored one to the late break.
- **"(kind, target ID) order"** (criterion 3) isn't pinned to one ordering of kinds by these tests: which kind sorts
  first isn't stated in the design for inputs. They require one fixed order, the same whichever module wrote first and
  whatever the order on `deep-physics`'s track, and that the ball's motion shows the two applied one after the other in
  the order the bake keeps (a launch then a poke gives 0.4 + 2 m/s along z; a poke then a launch 0.4).
- **"A replay gives the same step hashes"** (criterion 3) is `deep-physics`'s bake of the same world with the entries
  the bake kept as its track ("kept in the bake, so a replay applies the same ones").
- **"Plays the ball-and-goal lab"** (criterion 2) is the scene presented and its ball, bound to the world's output,
  where `deep-physics`'s bake puts it at five frames. The lab declares its grab and release, so it is this issue's lab.
  **"No other document is"**: the lab, and the lab with a launch derived from a press control, both presented without
  an error. The refused document holds no logic item and requires no logic module, so only its world input names logic.
- **"Reads the bake and never steps the world"** (criterion 4) is each scrub frame's `steps` 0 and `restored` null,
  showing the bake's state at its step. **"Re-simulates only from the checkpoint at or before 2 s"** is `restored` 240
  and `steps` 960, the steps from there to the span's end. **"Every step before the fork keeping its step hash"** is
  the states 0 … 240.
- **"Its budget forced to 20 checkpoints' bytes"** (criterion 6) is 20 times the byte length of the stack's
  checkpoint at step 60; **"keeps its ring within that budget"** is `peak` and `bytes` at most that. The 20 seeded steps
  are drawn from 480 … 7,200 (4,471, 1,562, 1,649, 4,315, 1,176, …, 5,360), so on the real ring each has a kept
  checkpoint at or before it; **"restore one"** is a
  checkpoint the ring keeps. **"Fails the first seek before it, naming the step"**: the first failure of the seek judge,
  in seek order, names the first seek to a step before 6,060.
- **"Fails on a continuation probe, naming the input and the first step that differs"** (criterion 8): among the
  check's failures, a `probe` failure with `input` and `step`; other runs may fail too.
- **Criterion 9's frames.** "The lab shows its last stepped state marked stale" is each frame's `at` the steps run so
  far, its step hash the straight bake's there, and `stale` true until the 50 s frame. "That frame equals a straight
  run's by step hash" is the straight bake of the lab with the stamped grab on its track at step 6,000. The second seek
  is made in a second session, at the first frame that shows more than 1,200 steps while stale; "within one checkpoint
  spacing of steps" is at most 60 steps over the frames until it lands.
- **A poke's data** is read as `push: vec3 m/s`, a velocity change of the whole body (the design gives `push: m/s` and
  `impulse: N·s` with a point and radius, no direction). Upward is +25 m/s along y (the ball falls at 19.62 m/s after
  step 240), sideways +2 m/s along x.

## Not tested, because no criterion reaches it here

Soft bodies, character and vehicle state in checkpoints and hashes; the hash's character, joint and particle parts;
checkpoints mixed across backend versions (#2009's); a ring passing a budget in another world; derived inputs' `data`
expressions and `each: change`; the net module's match rollback ring of every match step and its window; the logic
module firing physics inputs (no criterion builds a logic program); `cross_machine` and `web` determinism; goldens of
bakes with a track; a seek's `no_bake`. They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- `scripts/lanes.mjs`: `'tests/acceptance/522/'` and `'tests/acceptance/522-oracle/'` in the `alone` list (the files
  build `deep-show` six times and run long live views), and `'tests/acceptance/522/ac9-seek-across-frames.test.ts'` in
  `timed`, since its frames are timed.

`BASE-FAILURE.txt` is the run at the base.
