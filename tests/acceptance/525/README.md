# Acceptance tests for #525: each occurrence's sound on its own sample while a live world plays, and the runtime digest on export receipts

Written first, from issue #525 (as of November 12, 2026: its Scope, its four acceptance criteria, its Proof line "A live
lab with sound over 10 minutes, the planted late step's underrun, and the runtime digest on receipts and on a golden run
under another version" and its Depends on list, #1918, #1920, #500 and #501), its Oracle page, the design sections it
links and those they lean on, and base commit `53c0e72a3` ("Merge pull request #2356"), by a job that never saw an
implementation; none existed, and no other worktree, branch or pull request was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The Oracle page says no upstream test checks any criterion ("Sound landing on a step's sample and the device gate's
underruns are our audio path"; "The runtime digest and what it keys … are our record and golden rules"; "Our clock, cue,
ducking, onset, checkpoint and spawn rules"), so nothing is ported and there is no `tests/acceptance/525-oracle/`
folder: these tests are the local proof.

## What was read

- The issue, live (`gh issue view 525 --repo windoliver/deepbuild`), and its Oracle page
  (`doneright/oracles/issues/525.md` in DeepBuildAI/deepbuild, branch `doneright`).
- `docs/technical-design.md`: Scenes, physics and the canvas core; Control and input track; Transport ("every canvas
  module with steps runs one audio block ahead of the first sample not yet written … so what a gesture starts, and each
  hit it causes, sounds on its own sample live and on replay"); The physics module (World; Shape, body, contact
  material; Input, occurrence, output; Bake and golden); The media module (Strip and track; Spawn; Device gate, capture
  and export); Dogfooding; Tests written first; Wrong programs.
- `docs/canvas-primitives.md`: Time and the flick; Registry and seal: runtime digest ("A golden records it and is never
  compared under another, its report naming both digests … An export's receipt names it"); Phase (its Semantics: "While
  sound plays, every canvas module with steps runs until its time is at least one audio block past the timeline position
  of the first sample not yet written, before that block renders; a step not ready in time counts an underrun in the
  device gate's stats and never moves a voice or a param"); One clock, pure evaluation; Transport; Marker: present mode;
  Placement (`start_on`); Input track (the stamp rule: "the first step or sample at or after that position plus the input
  lead, or the first step not yet run or sample not yet written, whichever is later … the write-ahead plus one block while
  sound plays"); `start_on` and `switch`; World and backend `physics.world@1`; Input track entries; Occurrence list;
  Logic: occurrences: offsets in a step (row flicks); Bake; Golden; Recipe; Pack: piece@1 (`piece.physics_lab`'s press);
  Logic: saves (what else carries the digest); Sound and video on the picture's clock (Blocks); Strip and track; Spawn;
  Device gate (`stats: {underruns, underrun_time, latency}`); Export (its receipt).
- AGENTS.md.
- At the base, read only: `tests/acceptance/498/gate/` (README), `499/clock/` (README, helpers), `499/mix/` (README,
  helpers, `live.test.ts`), `500/spawn/` (README), `501/` (README, helpers), `544/` (README), `306/` (README and a fixture
  pack), `1918/` (README, `twins.json`, a test), `1920/` (README, helpers, `tsconfig.json`, `BASE-FAILURE.txt`),
  `2009/helpers.ts`, `2010/helpers.ts`; `crates/deep-show` (`Cargo.toml`, `main.rs`, `gate.rs`, `audio.rs`, `mixdown.rs`,
  `spawn.rs`, `physics.rs`, `logic.rs`, `input.rs`, `played.rs`, `export.rs`, `device.rs`, `test_sim.rs`),
  `crates/deep-canvas-test-modules/src/sim.rs`, `crates/deep-canvas-physics` (`doc.rs`, `occurrence.rs`),
  `crates/deep-physics-rapier/src/runner.rs` (its golden), `crates/deep-canvas-media` (`emitter.rs`'s pan law, `mix.rs`),
  `crates/deep-canvas-input/src/track.rs`; `scripts/proof-change.mjs`, `scripts/lanes.mjs`.

What the base already does and these tests don't credit: #499's live transport under the test audio backend, its frames
and its logic steps run at the display's frames (`audio.rs`: a logic item steps up to each frame's t); #499's `media_mix`
and, through #1918's `inline_worlds`, a media document's `worlds` baked offline over the transport's span into
`<world ID>.occurrences`, which #500's spawns read; #501's `export` and its receipt; #1920's `schedule.runtime_digest`
and the builds `core,test-sim-b` and `core,test-sim-b-1-0-1`; `deep-physics`'s own golden, which answers `FAIL` with a
`refused` text under another runtime digest. The base has no live world: `open` with a media document whose spawns read
a world's list answers `unbaked_list`. It has no block log, no gate `stats` under the test backend, no `handed` under it,
no `occurrences`, `input_track`, `golden_record` or `golden_verify` call, no `delays`, no runtime digest on the export receipt,
no recipe or control in a media document, a world's `inputs` refused (`physics.unsupported`, "inputs isn't run by this
backend interface yet; #522 brings it"), and none of this suite's planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:/opt/homebrew/opt/rustup/bin:$PATH \
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/525 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/525/tsconfig.json          # type-check
rm -rf tests/acceptance/525/node_modules               # vitest's cache
```

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set, and the two cargo folders above put first on `PATH`: the default full set
(`cargo build --locked --bin deep-show`, the build every file shares) and, for criterion 3, `cargo build --locked --bin
deep-show --no-default-features --features core,test-sim-b` and `… core,test-sim-b-1-0-1`. Each binary is copied to a
temporary folder. A test whose build failed fails at "the binary builds" with cargo's error; without cargo it throws
`BLOCKED:`. Nothing unrun passes. Every test passes its own one-hour timeout. Evidence stores, the pack folder and the
export folders are temporary and deleted after each test. Node built-ins and vitest only; no process is started but
`cargo` and `deep-show` (and what `deep-show` itself starts), each waited for, none stopped by name or port, and no
network call is made.

Every live play runs on #499's virtual clock and its test audio backend, so the ten-minute play runs faster than real
time and nothing reads wall time or depends on load: no test is `INCONCLUSIVE` or gated on a machine.

`BASE-FAILURE.txt` says why each test fails at the base.

Nothing missing passes (invariant 2): a reply without a field a test reads fails, naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it; a WAV that isn't in the
evidence store, doesn't hash to its name, isn't float or whose samples don't hash to its reply's `sha256` fails.

## The surface under test

The issue names a live world, sound, audio blocks, the first sample not yet written, the device gate's stats, a replay,
a golden, B's versions, the runtime digest, an export receipt, a planted receipt writer, a scripted press, a recipe's
strip and the recorded input track, but no call. These tests extend `deep-show run` as #393, #498, #499, #500, #501,
#544, #306, #1918 and #1920 left it (one JSON scenario on stdin, one JSON answer `{"ok": true, "replies": [...]}`, exit
0; a line that isn't JSON, lacks a required field, or names an unknown call, field value or `planted` value answers
`{"ok": false, "code": "bad_input"}`; the startup `--planted <name>`, an unknown name answering `bad_input` with exit 2).
No new binary and no new cargo feature. Times are flicks (705,600,000 a second; a 48 kHz sample is 14,700, a 128-sample
block 1,881,600, a 120 Hz step 5,880,000 = 400 samples). **Every call, field, reply field, scenario field and planted
name below marked *(ours)* is this job's invention**, the smallest the criteria need; the implementer builds exactly
these, or a dispute goes to a blind redraft.

### The scenario (live)

#499's clock scenario: `evidence`, `sessions`, `processes`, `clock`, `displays` (A at 120 Hz, B), `window`, `panels`
(one plain panel `player`), `audio: {backend: "test", devices: [TestDevice], default}` (#499's test backend; here one
device `speakers`: 48 kHz, 0 ppm, `buffer` 256, `latency` 240, `jitter` 0), optional `planted`, and `calls` in `at`
order. Added:

- `packs` (#306's scenario field, unchanged): `[{"id": "<owner>/<name>", "dir"}]`. Criterion 4 offers the test pack
  below; `media_mix`'s scenario takes it too.
- **`delays`** *(ours)*: `[{"world": world ID, "step": k, "by": flicks}]`. A deliberate test condition, not a wrong
  program: on the virtual clock every step runs in no host time, except that step k of that world is ready `by` flicks
  of host time after it starts. The world steps only when a block needs it (Phase: it "runs until" one block past), so
  the blocks that need step k can't render until it is ready.

### The media document

#499's (`transport: {sample_rate, span}`, `strips`, `buses`, …) with #500's `spawns` (`{"on": {"list", "kinds"},
"play": {"src": {"asset"}, "in", "out"}, "pan"}`), opened in the panel by `open`'s `media` and rendered by `media_mix`,
with these fields:

- `worlds: {world ID: physics.world@1 document}` (#1918's inline form, as `media_mix` already bakes it). **Opened in a
  panel and played, each world is live** *(ours: the reading of "a live world")*: the transport steps it on the timeline
  while sound plays, by Phase's rule, and its list `<world ID>.occurrences` is what the spawns read as it grows; it is
  never baked ahead over the span. In `media_mix` it is baked offline, as at the base, now reading the input track it is
  given.
- The world document's `span` (World: at most 10 min) and **`inputs`** (Input track entries: `{ID → {kind, targets, on:
  {control, each}, and the kind's defaults}}`; here a `launch` with `linear` and `angular`), each derived from a
  control's entries on the document's input track, at the first step at or after the entry's flick. Both are the
  design's; the base refuses `inputs`.
- **`controls`** *(ours in a media document; Control's shape)*: `{control ID: {kind: "press", label}}`.
- **`packs`** and **`items`** *(ours in a media document; Document's and Recipe's fields)*: `packs: ["test/lab@1.0.0"]`
  and a recipe instance `{kind: "<pack>.<name>@<major>", params: inputs}`, expanded at open and at `media_mix` into what
  its steps write, its derived IDs `<instance>.<step>` (Recipe: "a film recipe … writes … strips").
- **A strip's `start_on`** *(ours)*: `{control, each: "entry"}`, Placement's and `start_on`'s input rule on a strip: each
  matching entry starts one run of the strip at the entry's flick, its `start` an offset from it. Here only a recipe's
  `strip` step writes one.

### The test pack (criterion 4)

Written by the test into a temporary folder in #306's form: `pack.json` (`name: lab`, `version: 1.0.0`, `license:
CC0-1.0`, `requires.modules: {media}`, `recipes: {"lab.ping@1": "lab.ping@1.json"}`) and `lab.ping@1.json`: inputs
`sound` (asset) and `press` (ID); one step `ping`, `{op: "strip", params: {track: 2, src: {asset: "sound"}, start: 0,
in: 0, out: 100 ms, start_on: {control: "press", each: "entry"}}}`.

### Calls and replies (live)

#498's and #499's `open`, `input`, `play`, `gate`, `transport` and `handed`, with these changes and additions:

- **`transport`** gains **`blocks`** *(ours)*: `[{"at": host flick, "first": sample, "stepped": {world ID: flicks}}]`,
  every block render of the panel's live transport over host `[from, to)`, in order: the host time it rendered (the
  device callback that pulled it), the document sample it began at, which is the first sample not yet written then, and
  each live world's time (steps run × its step length) when that render began. A block split across two callbacks is two
  renders.
- **`gate`** under the test backend answers **`stats`** (Device gate's field): `{"underruns": n, "underrun_time":
  flicks, "latency": flicks}`. *(Ours: the counting.)* An underrun is one stretch of consecutive device callbacks filled
  with silence because a block wasn't ready; `underrun_time` is their total silence.
- **`handed`** (#499's) answers for a play under the test backend too: the document's samples `[⌈from⌉, ⌈to⌉)` as the
  live transport rendered them for the gate, each once, in document time; an underrun's silence is the device's and
  isn't among them.
- **`input`** to a panel playing a media document takes **`event: {"type": "control", "control": ID, "value", "t":
  host flicks}`** *(ours: the panel and `t`)*: a scripted press of that control (#504's control event), `t` the
  platform's timestamp of the event (Input track: "an entry's stamp comes from its input's `t`"), the call's `at` the
  time it reaches the app. It appends one entry to the play's input track, stamped by the Input track's rule.
- **`{"call": "occurrences", "at", "panel"}`** *(ours)* → `{"occurrences": {"<world ID>.occurrences": [Row]}}`: each
  live world's occurrence list as the play has stepped it by `at`, #1918's Row (`{step, kind, a, b, …payload}`).
- **`{"call": "input_track", "at", "panel"}`** *(ours)* → `{"input_track": [Entry]}`: the play's recorded input track,
  each entry in Input track's form (`{t, seq, control, value, writer, …}`), which `media_mix`'s `track` takes as it is.
- **`media_mix`** (#499's, with #544's `track`) is the replay: the same document rendered offline as the export renders
  it, its worlds baked with the given track.

### Calls and replies (criterion 3)

A scenario of plain calls (#1920's form: `evidence`, `sessions`, `processes`, `panels: {main}`, `docs`, `calls`), the
document presented by an agent's session with `deep_show`.

- **`{"call": "golden_record", "doc", "steps": n}`** *(ours; `golden` is taken by #138's kit store)* → `{"golden":
  Golden}`. Golden is the design's record (Golden:
  `{bake_key, runtime_digest, machine, step_hashes, …}`) of a document's evaluation over n steps: step k, for k = 0 to
  n − 1, the document evaluated at k × 5,880,000 flicks, its hash over what the build's measured or backend_bytes
  implementations wrote (*ours*; the content of a hash is the implementer's, as long as equal answers give equal
  hashes). The tests read `runtime_digest` (the build's, as `schedule` publishes it) and `step_hashes` (n strings); the
  golden also holds what the verifier needs to name the implementations it was recorded under, in any field.
- **`{"call": "golden_verify", "doc", "golden": Golden}`** *(ours)* → `{"verdict": "PASS" | "FAIL" | "BLOCKED",
  "steps_run": n, "report": null | {"first_step": k, …}, "blocked": null | {"interface", "versions": [recorded, here],
  "runtime_digests": [recorded, here]}, "reason": string}`. Under another runtime digest it is `BLOCKED` before any
  step: `steps_run` 0, `report` null, `blocked` naming the implementation's interface that differs, its two versions and
  the two digests, and `reason` saying so in words that name each. Under the same digest it replays every step and
  compares: `PASS`, or `FAIL` with `report.first_step` the first step whose hash differs.
- **`export`** (#501's delivery form) gains **`receipt.runtime_digest`** (the design's field, Registry and seal: runtime
  digest): 64 lowercase hex, the build's `schedule.runtime_digest`.

### Planted programs

| Name | How it is reached | The wrong program | Criterion |
|---|---|---|---|
| `voice_at_frame` *(ours)* | scenario `planted` | a spawn starts each voice at the t of the first display frame at or after its occurrence's flick, the frame that shows the hit, not at the occurrence's own sample | 1 |
| `world_steps_on_frames` *(ours)* | scenario `planted` | a live world steps at each display frame up to that frame's t, as the base steps a logic item, not ahead of each audio block | 2 |
| `late_step_moves_voice` *(ours)* | scenario `planted` | a block whose step isn't ready renders anyway without it, counting no underrun, and that step's voices start at the first block rendered after it is ready | 2 |
| `golden_compares_across_digests` *(ours)* | `--planted` | `golden_verify` compares step hashes under another runtime digest, so B 1.0.1's equal answers PASS | 3 |
| `receipt_omits_runtime_digest` *(ours; the criterion's planted receipt writer)* | `--planted` | the export's receipt writer leaves `runtime_digest` out | 3 |
| `entry_stamped_at_frame` *(ours)* | scenario `planted` | a control's entry is stamped with the t of the first display frame at or after its arrival, the frame that handles it | 4 |

Each is reachable only through its switch and changes nothing else. Criterion 2's 20 ms step is no planted program but
the scenario's `delays`. `twins.json` maps each criterion's ID to its planted names. Each test runs its planted programs
and asserts that the same checks fail on them, naming what the criterion names.

## The lab

Made by the tests (`helpers.ts`), from fixed values; no outside file, no personal data.

- **Sounds**, 16-bit mono WAVs at 48 kHz in the evidence store: the bed, 1 s of a 220 Hz cosine at 0.25; the clack, 50
  ms of a 1 kHz cosine at 0.5; the ping, 100 ms of a 2 kHz cosine at 0.4. A cosine's first sample is its amplitude, so
  an onset is exact.
- **The media document**: the bed looping from 0 on track 0, panned −1 (the pan law's right gain is sin 0 = 0 exactly,
  so the right channel carries nothing of it), and the spawn `clack` on `lab.occurrences` kind `hit`, panned +1.
- **The world `lab`** (#2009's world form): 120 Hz, 4 substeps, seed 525, the pinned backend `rapier3d =0.36.1`; a
  static floor box (half extents 2 × 0.1 × 2 m, top at y = 0) and a dynamic 0.1 m ball (never sleeping) with its lowest
  point 1 m above it; contact materials with friction 0.5. Criteria 1 and 2: gravity −9.81 m/s², restitution 0.5, the ball falling from t =
  0 (landing at √(2 × 1 ÷ 9.81) = 0.4515 s, step 54.18, then a few bounces). Criterion 4: no gravity, restitution 0, the
  ball at rest; the input `kick` launches it at (0, −2, 0) m/s on each entry of the press `go`, so it meets the floor 60
  steps later; the recipe instance `chime` (`lab.ping@1`, `sound` the ping, `press` `go`).
- **Play**: the lab opens at 10 ms, your click at 1 s gives a serial, and Play with it at 1.06 s plays the document from
  its time 0. 1.06 s is a whole number of samples and 0.8 of a step past a step boundary, so under the audio master
  every display frame's t lies 80 samples past a step's time.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed with that code from the live issue. Each test's name starts with its ID.

| ID | File | What it asserts, and the wrong programs it fails on |
|---|---|---|
| 1 `#525.06f030c7` | `ac1-collision-sound.test.ts` (1) | The dropped ball played live to 2 s past Play. The live list's first `hit` row, at step k (a guard: within three steps of step 54.18), and the PCM `handed` over the document's [0.25 s, 0.75 s): the right channel's first sample above silence is exactly ⌊k × 5,880,000 × 48,000 ÷ 705,600,000⌋ = 400 k. Fails on `voice_at_frame` (80 samples late), naming the hit's step |
| 2 `#525.bc91e6a4` | `ac2-blocks-ahead.test.ts` (2) | **Ten minutes**: transport 601 s, world span 600 s, played to 601 s past Play. Every block whose 128 samples lie below 600 s is in the log, in order, each beginning at most 128 samples after the last, up to within a block of 600 s, and each has `stepped.lab ≥ (first + 128) × 14,700`, a whole number of steps; `stats.underruns` is 0. Fails on `world_steps_on_frames` (2 s), naming a block. **The delayed step**: the step k of a clean play's first hit, then `delays: [{world: lab, step: k, by: 20 ms}]` over a 12 s document to 11 s past Play: `stats.underruns` is 1 and `underrun_time` above 0, and `handed` over [0.25 s, 10.25 s) hashes as `media_mix`'s same span (whose right channel starts on 400 k, so the delayed step's voice is in it). Fails on `late_step_moves_voice`, naming the underruns and the PCM |
| 3 `#525.105c2755` | `ac3-runtime-digest.test.ts` (2) | **The golden**: on `core,test-sim-b` a board of one test.sim@1 item, golden of 8 steps, `golden.runtime_digest` that build's; on `core,test-sim-b-1-0-1` the golden and a copy with step 2's hash changed each `BLOCKED`, `steps_run` 0, `report` null, `blocked.interface` test.sim@1, `blocked.versions` [1.0.0, 1.0.1] and `blocked.runtime_digests` [B 1.0.0's, B 1.0.1's], exactly, the reason naming all five; on a second `core,test-sim-b` process the golden `PASS` after 8 steps and the changed copy `FAIL` at `first_step` 2. Fails on `golden_compares_across_digests`, naming the verdict. **The receipt**: on `full` a 12-frame png_seq export's `receipt.runtime_digest` is the build's `schedule.runtime_digest`. Fails on `receipt_omits_runtime_digest`, naming `runtime_digest` |
| 4 `#525.316e3bea` | `ac4-press-and-hit.test.ts` (1) | The press lab with the test pack, a scripted press of `go` arriving at host 3.0003 s (its `t` 1 ms earlier), played to 11 s past Play. The input track holds one entry of `go`, at a flick no earlier than the first sample of the first block rendered after the arrival; `handed` over [0.25 s, 10.25 s) hashes as `media_mix` with the recorded track; that replay first differs from a replay with no track on the entry's sample (the recipe's ping), and after the ping again within five steps of 60 steps past the launch step (the hit's clack). Fails on `entry_stamped_at_frame`, naming the entry |

Test count: 1 + 2 + 2 + 1 = 6.

## Readings where the issue and design leave a choice

- **"A live lab", "a live world"**: a media document holding a world, opened in a panel and played through the test
  audio backend, the world stepped by the transport while it plays, never baked ahead. The virtual clock stands for the
  real one, as #499's clock suite reads its criteria; no criterion names a device.
- **"Plays its sound at the step it happened"**: the voice's first sample is the row's step's own sample, ⌊row flick ×
  48,000 ÷ 705,600,000⌋, the row flick being its step's time (Occurrence list; Spawn: "a voice starts at its flick,
  sample-accurately"). The step comes from the world's own list as it played; the three-step window around the free
  fall's landing is this job's guard that the row is the landing, not the criterion's measure.
- **"Each time a block renders" and "the first sample not yet written"**: each block render in the block log, whose
  first sample is the first not yet written at that render. **"At least one audio block past"**: the world's time at
  least (first + 128) samples, in flicks. **"Over 10 minutes"**: every block of the document's first 600 s, from the
  first sample the play writes; the world's span is 600 s, its longest. A block log that skips a block fails.
- **"A step delayed 20 ms on purpose"**: the scenario's `delays`, a condition of the test, not a wrong program; the
  delayed step is the one of the lab's first hit, so a late step that moved a voice would move one the comparison sees.
  **"Counts one underrun"**: `stats.underruns` is exactly 1, one stretch of silence however many callbacks it spans,
  and the clean ten-minute play counts 0. `underrun_time` is only required above 0: the design gives no figure.
- **"The document's PCM still equals a replay's"** and **"a replay of the recorded input track"**: the PCM the live
  transport handed the gate (`handed`) against `media_mix` of the same document (with the track `input_track` answered),
  rendered offline as the export renders it, by SHA-256 of interleaved f32le samples. **"Over 10 s"**: the document's
  [0.25 s, 10.25 s). The window starts after 0 because the play's first sample takes the t the display clock gave its
  host time (Time and the flick: Which clock leads), about 10 ms in, so the document's first samples are never played.
- **"A scripted press"**: an `input` control event the test schedules, with its platform timestamp `t`. **"Its entry
  takes a flick no earlier than the first sample not yet written when it arrived"**: the entry's `t` against the first
  sample of the first block rendered after the call's `at`. The press arrives between two device callbacks, so the
  reading has no tie.
- **"A recipe's strip"**: a strip a recipe's `strip` step writes into the document, started by the press through
  `start_on: {control, each: entry}`, the input rule the design gives `start_on` (Placement; `start_on` and `switch`),
  here on the strip itself. This is the reading most open to dispute: the design gives Strip no `start_on`, and the
  alternative, a placement of the recipe instance with `start_on`, would need placements in a media document. Both start
  the strip at the entry's flick, which is all the tests read.
- **"The first hit that press causes"**: the world input `kick` (a `launch` derived from `go`'s entries) sends the
  ball to the floor; the replay's second difference from a replay with no input is its clack. The five-step window
  around 60 steps after the launch's step is this job's guard.
- **"BLOCKED before any step"**: `steps_run` 0 and verdict `BLOCKED`. **"Never compared"**: `report` null, and a golden
  whose step hash was changed is `BLOCKED` the same way. **"Compares and passes"**: `PASS` after every step, and the
  changed golden `FAIL` at its changed step. **"Naming test.sim@1, both versions and both runtime digests"**: the
  `blocked` object's `interface`, `versions` and `runtime_digests`, exactly (other fields allowed), and the `reason`
  text naming each. **"Both runtime digests"** are the two builds'
  `schedule.runtime_digest`, which #1920 publishes.
- **What a golden of test.sim@1 records**: test.sim@1 has no stepping module, so a golden's step k is the document
  evaluated at k × 1/120 s, hashed over what its measured or backend_bytes implementations wrote. Only the verdict, the
  steps run and the names are read.
- **"An export's receipt names the build's runtime digest"**: `receipt.runtime_digest` equals the `schedule` digest of
  the build that exported. **"A planted receipt writer that leaves it out fails, naming the field"**: the same reader
  fails on that receipt, its failure naming `runtime_digest`; an export that refuses, naming the field, counts as well.

## Not tested, because no criterion reaches it here

- A real output device on the real clock (#501's `soak`) and a run under load: every criterion is read on the virtual
  clock, and none names a machine, so nothing here is `INCONCLUSIVE`.
- Logic items stepping ahead of the audio blocks (Phase: "every canvas module with steps"), a world holding while the
  timeline holds in present mode, `run_rate`, seeking a live world, two worlds, a param moved by a late step,
  and the stamp's exact value beyond its lower bound.
- `deep-physics`'s own `golden_verify`, which at the base reads `FAIL` with a `refused` text under another runtime
  digest: the criterion's golden is test.sim@1's, on `deep-show` builds. A follow-up for the implementer to weigh.
- Saves and matches carrying the runtime digest; a golden's report naming a field; the receipt's other fields.

## What the implementer adds outside this folder

This job edits nothing outside `tests/acceptance/525/`. Beside the surface above, a world's `inputs` (Input track
entries) must run, which the base refuses as "#522 brings it"; #525 doesn't list #522 among its dependencies, but
criterion 4 can't pass without it. **`scripts/lanes.mjs`** needs `'tests/acceptance/525/'` in its `alone` list, since
each file builds `deep-show` and the ten-minute play logs 225,000 blocks; this README is the instruction, and the
implementer makes that edit.
