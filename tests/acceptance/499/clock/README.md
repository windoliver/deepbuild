# Acceptance tests for #499, part "clock": the audio clock as the transport's master, and a change of output

Written first, from issue #499 (as of November 8, 2026: its Scope, its Transport and Strip and track fields, acceptance
criteria 1 and 11 and its Proof line), its oracle map, the design sections it links and those they lean on, and the
base commit, by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The issue's other criteria (the
mix, video frames, the module and its seal) belong to the other parts of #499's suite.

The base: this worktree's head `42319109` ("Merge pull request #1745"), which holds `f1e8736e` ("Merge pull request
#1742") and #531's logic module after it. `deep-logic`, which criterion 11's headless run uses, is #531's and is not in
`f1e8736e` itself.

What was read:

- The issue: Scope ("Live input under the audio clock: an entry's stamp comes from the event's own time, mapped through
  the audio clock's host-time pairing …"; "A change of sound output during live play: when the output device changes or
  goes away, the clock hands off to the display at the last sample played, sound reopens on the system's current default
  output under the gate's existing grant, with no new gesture, and the clock hands back to the audio device at its next
  block, so the interrupted state ends without a restart, t stays monotonic and no logic step runs twice or is
  skipped"); the Transport fields (`t: flick`, `master: auto | display | audio | virtual = auto` (derived), `latency:
  flick` (read from the device), `sample_rate: Hz = 48,000`; "It can never: … let the rate, the display rate or the seek
  path change a frame"); the Strip and track fields (`start`, `in, out`, `loop`, `span`); criteria 1 and 11; the Proof
  line ("the audio-clock drift run").
- The oracle map (`doneright/oracles/issues/499.md` in DeepBuildAI/deepbuild, branch `doneright`): no upstream test for
  1 ("our transport's behavior on real hardware") or 11 ("our clock and backend rules").
- `docs/canvas-primitives.md`: Time and the flick (9; "Which clock leads", 26: "The clock pairs each device callback's
  sample position with its host time, smoothed, never a raw count, and the time shown is the position of the sample the
  device plays at the frame's predicted presentation time … its first sample takes the flick the display clock gave that
  host time, so t never jumps. While silent, the display leads, advanced by elapsed host time and never capped"; "every
  step owed runs in order at its fixed length, never dropped, merged or lengthened"); One clock, pure evaluation (5126)
  and Transport (5142); Input track (5757); Logic beside physics and Logic `logic@1` (6493, 6498: "Step k runs at k
  times the step length, on the one clock"; "A frame at t reads the arrays as the last step at or before t left them");
  Logic: checkpoints and bake (6754: `deep_hash: the full state's hash, over its memory, globals, arrays and the step it
  has reached on the input track`); Sound and video on the picture's clock (7101; Blocks, 7104: "Audio renders in
  128-sample blocks"); Strip and track (7312: a looping strip "repeats the region until its span ends"); Device gate
  (7564: `state: suspended | running | interrupted | muted`; "`interrupted`, when another app or the OS takes the device,
  is distinct from muted").
- `docs/technical-design.md`: The media module (1909), its Device gate, capture and export (1969: "media's sound reaches
  the speakers only through the gate"), Panels and devices (1985), Dogfooding (2623), Tests written first (2654).
- At the base: AGENTS.md; `tests/acceptance/498/gate/` (the surface reused here: `deep-show run`'s panels, `input`
  serials, `open`, `play`, `gate`, `output` and its WAV in the evidence store), `498/decode/` (this README's form),
  `531/README.md` (`deep-logic`, its Piece, `bake`, checkpoints `step: c` as the state before step c), `1487/` (frames
  on a virtual display); `crates/deep-show/src/gate.rs` and `main.rs` (call parsing; unknown calls are `bad_input`),
  `crates/deep-logic/src/main.rs`.

What the base already does and these tests don't credit: `deep-show run` plays #498's device gate: a document of strips
opens in a panel, your press of Play grants the gate, and `output` hands back what reached one ideal device whose 48 kHz
clock starts at host flick 0; the gate's states include `interrupted`, which nothing enters. `deep-logic bake` steps a
piece's logic items and reports checkpoints with deep hashes. There is no audio backend, no device but the ideal one, no
device change, no audio master (nothing reports `t` or `master`), no notice, and no logic item in `deep-show`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/499/clock --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/499/clock/tsconfig.json   # type-check
rm -rf tests/acceptance/499/clock/node_modules/.vite
```

`follow.test.ts` builds `deep-show` once (`cargo build --locked --bin deep-show`); `switch.test.ts` builds `deep-show`
and `deep-logic`. Each copies its binaries out of the target folder (`CARGO_TARGET_DIR`, or `target/`) into a temporary
folder and fails each of its tests when a build fails. Every world gets its own evidence folder; all are deleted after
the test. Node built-ins and vitest only; the tests start no process but `cargo`, `deep-show` and `deep-logic`, each
waited for, and make no network call. `scripts/lanes.mjs` needs `'tests/acceptance/499/clock/'` in its `alone` list
(beside `498/gate/`), since each file builds cargo binaries; this README is the instruction, and the implementer makes
that edit.

Every test is deterministic and runs on every platform: the scenarios run on #400's virtual clock, the test devices on
their own sample clocks from the scenario, the jitter of their timestamps from a seed, and nothing reads wall time. The
10-minute play runs faster than real time. No reading here depends on load or a platform, so none is `BLOCKED` or
`INCONCLUSIVE`. Criterion 1's run plays 606 s of audio and logs about 72,000 frames twice; each test has an hour.

`BASE-FAILURE.txt` says why every test fails at the base.

Nothing missing passes (invariant 2): a reply without a field a test reads fails the test, naming the field (`null` is a
value, absence isn't); a run that answers `bad_input`, exits non-zero or writes other than one line fails every test
that drove it; an output WAV that isn't in the evidence store, doesn't hash to its name, or disagrees with its reply or
the device's clock fails.

## The surface under test

The issue names a transport, its `t` and `master`, a test audio backend, devices, a device change, an interrupted state
with a notice, a fixture game, logic steps and a full-state hash, but no API. These tests extend the binary that already
plays #498's gate, `deep-show run`, in its own style, and read the headless run from #531's `deep-logic`. No new binary.
#498's conventions hold unchanged: one JSON scenario on stdin, one JSON object out, exit 0; a line that isn't JSON, lacks
a required field, or names an unknown call, field value or `planted` value answers `{"ok": false, "code":
"bad_input"}`; a scenario that runs answers `{"ok": true, "replies": [Reply]}`, one per call, in order. Every call
carries `at`, host time on the virtual clock in flicks (705,600,000 a second); calls arrive in `at` order, ties in the
order given. **Every name below that the issue or the design doesn't give is this job's invention**, the smallest
surface the criteria need.

### The scenario

#498's gate scenario (`evidence`, `sessions`, `processes`, `clock`, `displays` A at 120 Hz and B, `window`, `panels`:
one plain panel `player`, optional `planted`, `calls`) with one field added:

```text
"audio": {"backend": "test", "devices": [TestDevice], "default": device ID}
TestDevice = {"id": string, "rate": Hz, "ppm": integer, "buffer": frames, "latency": samples, "jitter": flicks, "seed": integer}
```

### The test audio backend

The platform's audio output, replaced at its boundary by devices whose clocks the scenario gives. It is the hardware;
everything above it (which device the app opens, when, what it writes, how the clock reads it) is the app's and is under
test. With `audio`, every sound the gate passes goes to the backend's current default output, and #498's ideal device is
gone.

- **A device's clock.** Its k-th sample since it was connected (from host flick 0 for a device in `audio.devices`, from
  the `audio_device` call's `at` for one added later) plays at host flick
  `connected + ⌊k × 705,600,000 × 10⁶ ÷ (rate × (10⁶ + ppm))⌋`. A device with `ppm` 100 plays 100 ppm more samples a host
  second than its rate. This clock is the truth the tests judge the transport against.
- **Callbacks.** The device pulls `buffer` frames at a time, each buffer `latency + buffer` samples before its first
  sample plays, and reports with it a timestamp: the buffer's first sample counted on the stream (0 at the first buffer
  the app's stream on that device fills, as an output stream's sample time starts at 0) and the host time that sample
  plays, off the true one by a seeded error within ±`jitter` flicks. What the app hasn't written when a buffer is pulled
  plays as silence. `latency` is what the transport's `latency` field reads from the device.
- **A device that is removed** plays nothing from its removal on; the app gets no more callbacks from it.

### Calls and replies

#498's calls, as #498's gate README gives them, with these changes and additions:

- **`open`** gains `"piece"?: Piece`: #531's piece (`seed`, `items` of `kind: "logic@1"`, `assets` inline as base64 by
  their SHA-256), whose logic items step on the transport's clock while the panel plays (Logic `logic@1`: step k at k ×
  the step length on the one clock; a frame at t follows every step at or before t).
- **`gate`** gains `notice: null | {"code": string, "device": device ID}`: the notice the gate shows, `null` when none;
  `device` names the output device whose change or loss it reports. `code` is the implementer's and isn't compared.
- **`output`** gains `"device": device ID` (required with `audio`): what that device played over host `[from, to)`:
  `{"output": {"device", "sample_rate", "channels", "first", "frames", "sha256"}}`, where `first` is the device's first
  sample (counted since it connected, as above) that plays at or after `from`, `first + frames` its first at or after
  `to`, and the WAV (in the evidence store by its SHA-256, #498's formats) holds every sample it played there, 0 where
  it played nothing.
- **`{"call": "audio_device", "at", "add"?: TestDevice, "default"?: device ID | null, "remove"?: device ID}`** → any
  object (unread): the system's outputs change at `at`, in this order: a device is connected, the default output becomes
  the one named (or none), a device is removed. Removing the default without naming another leaves no default output.
- **`{"call": "transport", "at", "panel", "from", "to"}`** (`to ≤ at`) → `{"transport": {"frames": [Frame], "steps":
  [StepRun]}}`, the panel's transport over host `[from, to)`:
  - `Frame = {"at": flick, "t": flick, "master": "display" | "audio" | "virtual", "device": device ID | null}`: one per
    vsync of the display the panel is on, every one while the transport plays (from the first vsync at or after Play)
    whether or not anything was drawn, in order: the host time the vsync presents at, the `t` the transport gives that
    frame, the clock that led it (Transport's derived `master`), and, under `audio`, the device whose clock that is
    (`null` otherwise).
  - `StepRun = {"item": logic ID, "step": k, "at": flick}`: every logic step run, in the order run, with the vsync of the
    frame whose evaluation ran it.
- **`{"call": "full_state", "at", "panel", "item", "step": k}`** → `{"full_state": {"item", "step", "deep_hash": 16
  lowercase hex, "arrays": {"<logic ID>.<name>": [value]}}}`: the logic item's full state as this live play reached step
  k, before step k ran (#531's checkpoint `step: k`), with its deep hash (Logic: checkpoints and bake) and every array of
  the item; k is one of the item's checkpoint steps (a multiple of `checkpoint.every`, 60 by default). A step the play
  hasn't reached by `at` answers `{"code": "not_reached"}`.

### Planted programs

Each reachable only through `planted`, only to prove a test fails on a wrong program; each test runs its own and asserts
that it fails, naming what the criterion names.

| Name | The wrong program | Test |
|---|---|---|
| `clock_follows_display` | while audio plays, the transport keeps the display clock (t advanced by elapsed host time) instead of the device's | criterion 1 |
| `backend_keeps_removed_device` | the app's audio output stays bound to the device it opened after that device is removed and another becomes the default | criterion 11 |
| `clock_restarts_from_sample_0` | after a device change, the clock pairs the new device's stream sample 0 with t = 0 and counts t from there | criterion 11 |

Criterion 1 names no wrong program; `clock_follows_display` is there so its test fails on one (AGENTS.md, Proof).

## The fixture game

`program.ts` holds the game's logic program as WebAssembly bytes written by hand (the module's text is in its comment):
one page of memory whose maximum is its minimum, `reads_at` 0, `writes_at` 4096, `init(seed)` doing nothing, and
`step(k)` adding 1 to `runs` (the write region's one i32, the array `game.runs`) and setting an i32 at 8192 to
`mix × 31 + k`, so a step run twice, skipped or out of order changes memory the full-state hash covers. The piece is one
logic item `game`, `step_rate: 60`, `writes: {runs: {type: i32}}`, document seed 499. Before this run the bytes were
checked with Node's own WebAssembly: they validate, and 600 steps leave `runs` at 600. They were not run through
sandbox@1's check or `deep-logic` (no build was made for this job).

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text. Each test's name
starts with its ID, builds its criterion's failures as sentences naming what failed, and runs its wrong programs to show
the same checks fail on them.

| ID | Criterion | Test, and the wrong programs it fails on |
|---|---|---|
| 1 `#499.85ea1101` | While audio plays, the transport follows the audio clock (the position the device plays at each frame's presentation, from the device's timestamps) within one audio block over a 10-minute play, t stays monotonic and continuous when a strip starts at 3 s and the master passes from the display to the audio device, and a device change sets an interrupted state with a notice instead of drifting | `follow.test.ts`. **Ten minutes**: `speakers` (+100 ppm, buffer 512, latency 480, jitter 0.5 ms); a 1 s 440 Hz cosine looping from t = 3 s; your press of Play at 1.06 s; the log to host 606 s. Every vsync has a frame; every frame's t is later than the one before by the host time between them within one block (128 samples); before the strip's first sample every frame is led by the display at t = host + a constant, and that constant puts the first sample at t = 3 s within a block; from one vsync after it, every frame is led by `audio` on `speakers` and its t is 3 s plus the speakers' samples played since that first sample at the vsync's host time, within one block, for at least 600 s. **Device change**: the strip from t = 1 s; the speakers are removed at 20 s with no output until `headphones` (−100 ppm, buffer 256, latency 960) connect as the default at 60 s; to 120 s. The gate is `running` with no notice at 19 s, `interrupted` at 40 s with a notice naming `speakers` and still granted by your press, and `running` on that grant at 70 s; t follows the speakers within a block to their last sample, then the display from the last sample's t (t keeps on with host time, within a block) until the headphones' first sample, then the headphones' clock from the display's t there, within a block, monotonic and continuous throughout. Fails on: `clock_follows_display` (a block off the speakers within 27 s), naming the frame |
| 11 `#499.29cef631` | A 60 Hz fixture game plays a looping strip through a test audio backend, and at t = 5.000 s the default output switches and the old device is removed: sound resumes on the new device within 500 ms, t never moves back and never jumps by more than one step (16.7 ms), exactly 600 logic steps run in the 10 s, and the full-state hash at step 600 equals a headless run's; a planted backend that keeps the removed device stays silent and fails, naming the device, and a planted clock that restarts t from the new device's sample 0 moves t back and fails, naming the frame | `switch.test.ts`: `speakers` (default) and `headphones`, both 0 ppm and connected from the start; the game and a 1 s 440 Hz cosine looping from t = 0; your press of Play at 1.06 s. One `audio_device` call at the host time where t = 5 s makes `headphones` the default and removes `speakers`. The speakers sound in the second before; the headphones are silent before the switch and sound within 500 ms of it by their own clock; the gate is `running` on your press's serial 1 s later (no new gesture). Over the play to 6 s after the switch: no frame's t is below the one before, none is more than 11,760,000 flicks (one 60 Hz step) above it, and t reaches 10 s; the steps the frames with t < 10 s ran are steps 0 to 599, once each, in order; at step 600 the live `full_state` has `game.runs` `[600]` and the deep hash of `deep-logic bake` of the same piece for 600 steps at its checkpoint `step: 600` (whose step 599 also leaves `game.runs` `[600]`). Fails on: `backend_keeps_removed_device`, naming `headphones` (silent) and the removed `speakers`; `clock_restarts_from_sample_0`, naming the frame where t moves back |

## Readings where the issue and design leave a choice

- **"The position the device plays at each frame's presentation, from the device's timestamps"**: the test device's
  true clock at the vsync's host time (the virtual display presents when predicted), in samples, counted from the
  strip's first sample, which takes the flick the display clock gave its host time (Which clock leads). The timestamps
  the app gets carry seeded jitter; the truth doesn't, so a clock that uses one raw pairing per frame is up to 24 samples
  off, inside a block, and one that ignores the device's rate is not.
- **"Within one audio block"**: 128 samples at the transport's 48 kHz, 1,881,600 flicks (Blocks).
- **"Over a 10-minute play"**: 600 s of audio from the strip's first sample, on the virtual clock. The speakers run
  100 ppm off host time, so following the display drifts 60 ms over the play, 2,880 samples.
- **"Monotonic and continuous"**: every frame's t is above the one before (strictly: the transport plays) and moves by
  the host time between the two vsyncs within one block. Under the display that's exact; under the audio master it's
  the device's rate.
- **"The master passes from the display to the audio device"**: read from each frame's `master` and `device`, and held
  by its t: led by the display before the strip's first sample, by `audio` on the speakers from one vsync after it (the
  vsync between may be either).
- **"A device change sets an interrupted state with a notice instead of drifting"**: the device goes away with no
  other output for 40 s, so the state lasts long enough to read with `gate`; the gate is `interrupted`, its notice names
  the device, and the grant is kept. "Instead of drifting" is read on t: while interrupted the display leads from the
  last sample played (the Scope's hand-off), neither stopped nor following the lost device's extrapolated clock (40 s at
  100 ppm is 4 ms, more than a block), and once a device leads again t follows that device's clock (60 s at −100 ppm is
  6 ms off the display). A notice may stay after the state ends; only its presence while interrupted is read.
- **"At t = 5.000 s"**: the host time where the play's t is 5 s, read from the frames of its first second (both devices
  at 0 ppm, so t runs with host time); one call changes the default and removes the old device.
- **"Sound resumes on the new device within 500 ms"**: the headphones' first sample above silence (2^−20, −120 dBFS)
  after the switch plays at most 500 ms after it, by their own clock; they were silent before, so it is the resumed
  sound. **"Under the gate's existing grant, with no new gesture"** (Scope): no click follows the first, and the gate is
  `running` on that press's serial.
- **"Never jumps by more than one step (16.7 ms)"**: consecutive frames' t differ by at most 705,600,000 ÷ 60 =
  11,760,000 flicks. Frames are 8.3 ms apart on display A, so a normal frame moves half a step.
- **"Exactly 600 logic steps run in the 10 s"**: the steps run by frames whose t is under 10 s are steps 0 to 599, each
  once, in order (a frame at t follows every step at or before t, so these are the steps the first 10 s of t own). A
  step whose `at` is no vsync of the log fails.
- **"The full-state hash at step 600"**: the deep hash of the state step 600 starts from, after steps 0 to 599: #531's
  checkpoint `step: 600`. The game's own count of its calls, `game.runs`, must read 600 there too, so a step run twice is
  seen in the program's memory, not only in the log.
- **"A headless run"**: `deep-logic bake` of the same piece, the logic module's own run with no display and no device.
- **"Naming the device"** for the kept device: the failure names `headphones`, the new default that stays silent, and
  the removed `speakers`. **"Naming the frame"**: its index in the transport log and its vsync's host time.

## Not tested, and why

- A live run on CoreAudio with a real output switch on the reference Mac (the oracle map's "real hardware"): the
  criteria allow the test backend, and a real switch needs a person at the Mac. The `audio` seam's conformance is
  #140's.
- Live input stamped through the audio clock's host-time pairing (Scope): no criterion of this part reads input
  entries; the fixture game reads none.
- A device whose rate isn't the transport's (the platform's conversion after the master), the transport's `latency`
  field, `rate`, `run_rate`, `loop` and reduced motion: no criterion here reads them.
- The mix, the export's PCM, processors, video frames and the module's seal: the other parts of #499's suite.

## The Oracle lane

The oracle map gives no upstream test for criteria 1 or 11; the audio master, the device change and the logic steps
under it are this design's own rules, so nothing upstream is ported and these tests are the local proof.
