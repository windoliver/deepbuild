# Acceptance tests for #105: capture a screen or window for a bug report

Written first, from issue #105 (its scope, its Capture fields, its four acceptance criteria and its proof line), the
design sections it links and those they lean on, and base commit `904e37b6` ("Merge pull request #870"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Evidence (147: stored once by SHA-256 "with its type and size in the log"; "A bug report
  becomes a check the fix must pass"); Privacy (153: sends go only by hash; origin `deepbuild` for "a capture", whose
  redaction rule still applies); Send (502: an authority ask before anything leaves); Evidence in the kernel (986:
  redaction `unknown` "on a capture of the screen, a window, the camera or the microphone"; "It can never … leave in an
  export while its redaction is anything but `complete`, unless you approve"); Device gate, capture and export (1931);
  Panels and devices, Device gate and capture (1949: "a screen or window is reached only through the system picker …
  while a shortcut is held and with an indicator"; capture for bug reports lands R2) and Keymap, placement, window
  (1977); the threat row "A plug-in that plays sound or records" (2379: "the app's capture service with the system
  picker first … each with an indicator nothing can cover"); the Decided row "Clicks on the question card" (2667:
  synthetic key events carry a source state and posting pid "which the capture shortcut's gate logs as provenance and
  never trusts; the HID key-state table alone holds that gate"); the platform seams (2467: "capture: ScreenCaptureKit
  with the system picker"); Every task carries its own budgets and The reference Macs (2418–2420); Dogfooding (2518)
  and Built to be hard to get wrong (2544).
- `docs/canvas-primitives.md`: Capture (7526: the issue's fields; "Frames and samples are kept only while the
  shortcut is held, every frame during a hold is kept, and the result is evidence that stays on the machine until its
  redaction is complete or you approve"; "It can never: Record without the hold; give anything a standing grant;
  record for an agent"); Device gate (beside it).
- At the base: AGENTS.md; `tests/acceptance/401/` and `400/` (the Driver, `deep-show run`'s displays A and B on the
  virtual display clock, the budget judge, the perf-lane check), `96/` (the hub's `state` folder, `record.jsonl`, and
  a fault that kills the hub as SIGKILL would), `15/` (the evidence store: `<2 hex>/<62 hex>`, redaction labels,
  origin from the connection, sends that ask), `384/` (`ask` and ask-tasks in `deep-show`), `340/` and `303/` (asks in
  the hub), `339/` and `docs/spikes/339/record.json` (the held-shortcut spike: 200 synthetic presses in four forms,
  the HID key-state table as the hold's only source); `crates/deep-show/src` (`main.rs`'s scenario, `fault` and
  `state`; `evidence.rs`; `ask.rs`; `ring.rs`; `shared.rs`'s record append), `crates/deep-app/src/trusted_input.rs`
  (#339's gate), `scripts/lanes.mjs`, `scripts/benchmark.mjs`, `benchmarks/budgets.json`.

What the base already does and these tests don't credit: `deep-show run` plays the hub's canvas side and trusted ring
on #400's two displays on the virtual clock, keeps files by hash in its evidence folder (`evidence.rs`), appends a
record to `<state>/record.jsonl` (#96) and can be killed mid-commit by a `fault`; `deep-app` has #339's ⌥Space gate,
held by the HID key-state table alone, which takes one frame with `CGDisplayCreateImageForRect` in a spike mode.
There is no capture call, no system picker, no recording, no indicator, no bug-report ask, no drafted check and no
send in `deep-show`, and no ScreenCaptureKit recording in `deep-app`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/105 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/105/tsconfig.json   # type-check
```

Every file but `live.test.ts` first builds `deep-show` once with `cargo build --locked --bin deep-show`, copies it
out of `target/debug` into a temporary folder, and fails each of its tests when the build fails. Every run of a world
gets its own evidence folder and state folder, deleted after the test. The tests use node built-ins and vitest only.
A run with `--root tests/acceptance/105` may leave Vitest's cache in `tests/acceptance/105/node_modules/.vite`;
delete it. `scripts/lanes.mjs` needs `tests/acceptance/105/` in its one-at-a-time list (`alone`) beside `401/`, since
the files build a cargo binary and `budgets.test.ts` times a budget; this README is the instruction, and the
implementer makes that edit.

The send test starts one child process of its own, a local HTTP listener on an ephemeral port standing for the
send's destination, and stops it by its PID.

Every test but AC3's wall-time test and the live test is deterministic and runs on every platform: the scenarios run
on the virtual display clock and read no wall time. AC3's wall-time test counts only on a reference Mac (Mac15,7 or
Mac15,12) on mains power, Low Power Mode off, thermal state nominal and a 1-minute load no higher than its core
count; anywhere else it fails with a message starting `INCONCLUSIVE:`. The live test fails `INCONCLUSIVE:` unless a
person runs it (The live run, below). Neither passes, or skips, on a reading it can't trust.

`BASE-FAILURE.txt` is the run at the base (home paths redacted): all 10 tests fail. Eight fail because `deep-show run`
answers `{"ok": false, "code": "bad_input"}` (the base has no `capture` call, nor any call below); the perf-lane test
fails because `benchmarks/budgets.json` has no `capture-save` task; the live test fails `INCONCLUSIVE:` (no person).
That is the missing behaviour, not a test mistake.

Nothing missing passes (invariant 2): a reply without a field a test reads fails the test naming the field; a run
that answers `bad_input`, exits non-zero or writes other than one line fails every test that drove it.

## The surface under test

The issue names a capture, a picker, a shortcut, an indicator, evidence, an ask, a drafted check and a Send, but no
code API. So these tests extend the binary that already plays the hub's trusted ring and its windows for tests,
`deep-show run` (#393, #96, #383, #384, #400, #401), with the smallest set of fields and calls they need, in its own
style. No new binary. The live part (below) adds one flag to `deep-app`, the binary that already holds #339's gate.

### What the model stands for

The real macOS picker, the keyboard and a display's pixels can't be driven headless on a controlled clock, so the
scenario models them, as #400 and #401 model displays and input:

- **The system picker** is the `pick` call: your answer in the picker the `capture` call opened. Nothing else names
  what to record.
- **The held shortcut** is the HID key-state table, written only by `shortcut` calls with `source: "hid"` (a key
  going down and up under a finger). A `source: "synthetic"` call is an event software posted, carrying the source
  state (`state`) and posting pid (`pid`) its poster set, which never writes the table, whatever it claims (#339).
- **Frames** come from the virtual displays (README: Frames).
- **The recording** is the kept frames, unchanged and in order: the model's encoder. On the Mac it is ScreenCaptureKit
  feeding the hardware encoder, which `live.test.ts` holds.
- **The indicator** is the `indicator` call: whether the system's and the app's indicators show.
- **The record** is #96's `<state>/record.jsonl`; **log lines** are the run's stderr.

What stays unproven by the model: a live capture through ScreenCaptureKit's picker on the reference Mac, the real HID
table under a trusted poster or a virtual HID device (#339's open question), the system indicator, and real encoding
speed. `live.test.ts` holds the first; the others need a person or hardware the tests can't drive.

### Scenario fields added

```json
{"displays": [#400's display + {"feed": string}],
 "state": dir,
 "fault"?: {"kill_at": flicks},
 "planted"?: one of the planted programs below,
 …#401's other fields: evidence, sessions, processes, clock, window, panels (here {}), calls}
```

- `displays[].feed` (Frames): the token every frame of that display carries.
- `state`: #96's state folder. The record `<state>/record.jsonl` (#96's line shape, `{"log_pos", "session", "event"}`)
  gets the capture's events. Once an asset is saved, some line of the record names it by its SHA-256 (Evidence: "with
  its type and size in the log"). A run whose `state` already holds a record restarts from it, as #96's does.
- `fault.kill_at`: when the virtual clock reaches that flick, the hub ends at once, as SIGKILL would: no answer line,
  nothing after (#96's `kill_after_layer_file`, by time).
- The evidence store is `evidence`, laid out as #15's: `<first 2 hex>/<other 62 hex>`, each file named by its bytes'
  SHA-256 (`deep-show`'s `evidence.rs` already writes it so).

### Frames

A display presents one frame per vsync (#400's clock: `next_vsync`, then every `705,600,000 / refresh_hz` flicks; B,
the second display, at 3 ms and then every 16.67 ms). The frame display `d` presents at vsync `v` is the bytes of the
line `frame <d's uuid> <v> <d's feed>\n`. A capture of `d` keeps the frames `d` presents while the hold lasts; the
saved asset is those frames' bytes, concatenated in vsync order. A capture's frames are right when they are all of
the picked display, all inside the hold (from the HID down to the HID up, or to `max`), with no vsync missing between
the first kept and the last vsync before the hold ends, and the first kept no later than 100 ms after the HID down.

### Calls and replies

Every call carries `at` (flicks); calls arrive in `at` order; one reply per call, in order.

- **`{"call": "capture", "at", "session", "source": "screen", "words"}`**: you start a bug capture for that session's
  ask with your words (the bug report); the system picker opens. Reply: any object (unread).
- **`{"call": "pick", "at", "display": uuid}`** or **`{"call": "pick", "at", "cancel": true}`**: your answer in the
  open picker. A pick is good for one hold: the capture waits `armed` for it. A cancel ends the capture with nothing
  recorded. Reply: any object (unread).
- **`{"call": "shortcut", "at", "phase": "down" | "up", "source": "hid"}`**: the capture chord down or up on the
  keyboard, in the HID table. **`{"call": "shortcut", "at", "phase", "source": "synthetic", "state": n, "pid": n}`**: a
  posted event of the chord. Reply: any object (unread).
- **`{"call": "indicator", "at"}`** → `{"indicator": {"system": bool, "app": bool}}`: both are true exactly while a
  capture keeps frames.
- **`{"call": "captures", "at"}`** → `{"captures": [{"capture": id, "session", "state", "frames": n, "asset":
  {"sha256", "redaction", "origin"} | null, "ask": ask-task handle | null}]}`: every capture started, with `state`
  `picking`, `armed` (picked, waiting for the hold), `recording`, `saved` or `cancelled` (after a restart, a capture
  a crash cut short may read anything but `saved`), `frames` the frames kept, `asset` the saved recording (null until
  saved) and `ask` the ask-task it is attached to (null until then). A hold ends at the HID up or at `max` (120 s after
  the HID down), whichever comes first, and the asset is saved then.
- **`{"call": "task", "at", "task": handle}`** → `{"task": {"handle", "session", "open": bool, "words", "evidence":
  [{"sha256", "redaction"}], "checks": [{"id", "state", "reproduces": sha256 | null, "required": bool}]}}`: an
  ask-task as it stands. A saved bug capture opens one in its session with your words, holds the asset in `evidence`,
  and drafts one check into the ask's definition of done: `state: "drafted"` (awaiting the definition's lock),
  `reproduces` the asset's hash (the bug it reproduces), `required: true` (the fix must pass it).
- **`{"call": "send", "at", "session", "to": url, "files": [sha256]}`** → `{"send": {"id", "state"}}`: a Send by that
  session's agent of the files, by hash, to `to`. It waits (`state: "waiting"`) for your approval while any file's
  redaction isn't `complete`, delivering nothing.
- **`{"call": "approve", "at", "send": id}`** → `{"send": {"id", "state": "sent"}}`: your yes. Each file then goes
  once: one HTTP `POST` to `to` with the file's bytes as the body.

### Planted programs

Each reachable only through `planted`, only to prove a test fails on a wrong program; every test runs its own and
asserts that it fails, naming what the criterion says it names.

| Name | The wrong program | Test |
|---|---|---|
| `records_without_hold` | the gate takes any press of the chord, synthetic ones too, as the hold | AC1 |
| `records_past_max` | the recorder ignores `max` and keeps frames for as long as the chord is held | AC1 scope |
| `drafts_no_check` | a saved bug capture is attached to its ask with no check drafted | AC2 |
| `frames_to_record` | each frame, as it arrives, is appended to the record as an event holding its bytes in base64 | AC4 |
| `keeps_asset_after_crash` | the frames so far are stored as an asset by hash each time a frame arrives | AC4 |
| `labels_redaction_complete` | the saved asset is labelled redaction `complete` | AC4 |
| `sends_without_approval` | a send delivers its files at once, unasked | AC4 |

### The live run

`live.test.ts` builds `deep-app` (`cargo build --locked -p deep-app`) and runs `target/debug/deep-app --capture-bug
<store>`, the app itself so its timeout (10 minutes) stops the process it means. The run opens ScreenCaptureKit's
system picker; a person picks the **second** display, then holds ⌥Space (#339's chord, held by the HID table) for a
few seconds. It records while held (at most 120 s) with its indicator, saves the MP4 into `<store>` laid out as #15's
store, and prints, as a JSON line on stdout:

```json
{"capture": 105, "permission": "granted" | "denied" | "undetermined", "picker": true, "source": "screen",
 "display": {"id": n, "main": bool}, "frames": n, "first_frame_ms": n, "held_ms": n,
 "asset": {"sha256", "redaction"}}
```

It passes when the run exits 0, `picker` is true, `source` is `screen`, `display.main` is false, `frames` ≥ 1,
`first_frame_ms` ≤ 100, `held_ms` > 0, `asset.redaction` is `unknown`, and the store holds exactly one file, named
`asset.sha256`, hashing to its name, a whole MP4 (top-level boxes adding up to the file, `ftyp` first, `moov` among
them). It fails `INCONCLUSIVE:` without `DEEP_105_LIVE=1`, off a fit reference Mac, and when Screen Recording isn't
`granted`.

## Criteria to tests

Each test's name starts with its ID. Each builds its criterion's failures as sentences naming what failed, and runs
its wrong program to show the same check fails on it. Times: B is the second display; the chord's HID down is "down".

| ID | Criterion | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | No frame is captured without the shortcut held, over 200 synthetic presses | `hold.test.ts`: you start a capture for alpha and pick B; 200 synthetic presses of the chord, 100 ms each and 250 ms apart from 3 s, rotating #339's four forms (state 0 / pid 4242, state 1 / pid 0, state 0 / pid 0, state 1 / pid 4242). At 54 s the capture is `armed` with 0 frames and no asset, the evidence store is empty, and the indicator was off in 20 looks during presses. The control: the chord held on the keyboard 60–64 s, with synthetic ups and downs inside the hold: the indicator shows (system and app) during it and not after; the asset holds every vsync of B in the hold, the first within 100 ms, none of A. Fails on: `records_without_hold`, naming the synthetic presses; a gate that never records (the control) |
| AC1 scope | `max: s = 120`, every frame kept, the indicator | `hold.test.ts`: a 125 s hold of B: the indicator on at 119.5 s and off at 120.5 s while still held; at 121 s the asset is saved; it holds every vsync of the first 120 s, the last within one frame of 120 s, none after; one file in the store. Fails on: `records_past_max`, naming frames past 120 s |
| AC2 | A captured bug becomes a drafted check on its ask | `report.test.ts`: a 2 s capture of B started for alpha with your words: its asset holds B's frames of the hold; `captures` names its ask; `task` reads that ask: alpha's, open, your words, the asset in its evidence with redaction `unknown`, and exactly one check reproducing the asset, `drafted` and `required`. Fails on: `drafts_no_check`, naming the missing check |
| AC3 | Budgets, on the reference Mac in the local preflight, compared with the merge base: a capture is saved within 1 s | `budgets.test.ts`: (1) `benchmarks/budgets.json` has a task `capture-save` naming #105 in its `initialReason`, valid against the merge base's file (`scripts/benchmark.mjs`'s `validateBudgets`), as #401's AC8. (2) wall time on the reference Mac, five runs after a warm-up: a 119.5 s hold of B recorded, released and saved (`captures` 1 s after the release shows its asset), less the same run with the picker cancelled, under 1,000 ms. On the virtual clock, the asset is there 1 s after the release (`privacy.test.ts`) |
| AC4 | While a hold runs, no record row, event or log line holds a frame or sample, and a crash mid-hold leaves no asset; after release one asset arrives by hash with redaction `unknown`, and a Send that attaches it waits for your approval; a planted capture that writes frames to the record fails, naming the row | `privacy.test.ts`: (1) a 3 s capture of B, released: no line of `record.jsonl`, no other file in the state folder and no stderr line holds a frame of A or B (by feed: raw, hex, base64 at each offset, standard and URL-safe). Fails on: `frames_to_record`, naming the row (line, `log_pos`, kind). (2) 1 s after the release: one file in the store, hashing to its name, which `captures` gives as the asset, redaction `unknown`, origin `deepbuild`, named by a record line, holding B's frames of the hold. Fails on: `labels_redaction_complete`, naming the label. (3) the same hold killed 1.5 s in (`kill_at`): the run answers nothing; no file in the store; the record holds no frame; restarted on the same folders, no capture has an asset or reads `saved`, and no file in the evidence folder holds a frame. Fails on: `keeps_asset_after_crash`, naming the file; `frames_to_record`, naming the row mid-hold. (4) alpha sends the asset by hash to a local listener: `waiting`, nothing delivered; after your approval `sent`, and the listener got exactly one `POST /bugs` whose body hashes to the asset. Fails on: `sends_without_approval`, naming the hash |
| Proof | A recorded capture from a second display, its evidence and the drafted check | `report.test.ts` (B's recording, its evidence on the ask, the drafted check) on the model, with `privacy.test.ts` (2); `live.test.ts` on the reference Mac with a person: the second display through the system picker, one MP4 by hash, redaction `unknown`, first frame within 100 ms |

## Readings where the issue and design leave a choice

- **One binary for the trusted ring's capture, the ask and the send.** The capture service, the ask-task and the Send
  run in the app and the hub, which a test can't drive headless on a controlled clock; `deep-show run` already plays
  the hub's trusted ring, its evidence folder, its record and its asks for tests, so the capture is its scenario's
  calls. The live part is `deep-app`'s, which holds #339's gate.
- **A synthetic press** is #339's: an event software made, whatever source state and pid it claims. The hold is the
  HID table alone; an event never moves it, so synthetic ups inside a real hold don't end it either.
- **"Only through the system picker"**: nothing records before a pick, and a pick is good for one hold, so no pick
  stands as a grant ("never a standing grant"). The tests read only that a capture waits `armed` after a pick.
- **"Attached to the session's ask"**: a bug capture is started for a session and opens one ask-task there with your
  words, holding the asset as evidence. **"Drafts a check that reproduces it, which the fix must pass"**: one check in
  that ask's definition, `drafted` until the definition locks, citing the asset by hash (`reproduces`), `required`.
  What the check runs is the implementer's; the tests read that it exists, cites the capture and binds the fix.
- **"Saved within 1 s"** is wall time on the reference Mac (AC3 says so), timed as the difference between a 119.5 s
  capture that is saved and the same run with the picker cancelled; that difference also counts the recording's
  per-frame work, so it is an upper bound on the save. The perf-lane task's command is the implementer's; only its id
  and its #105 reason are read.
- **"No record row, event or log line holds a captured frame"**: the record's lines, every other file in the state
  folder (projections, if any) and the run's stderr, searched for a frame by its feed in raw, hex and base64 forms. A
  frame's hash isn't the frame; a compressed frame wouldn't be found (the planted program writes base64).
- **"A crash mid-hold leaves no asset"**: after a kill 1.5 s into a hold, nothing in the store's layout and, after a
  restart, no capture with an asset and no file in the evidence folder holding a frame. Where frames wait during the
  hold (memory or a spool) is the implementer's, as long as a restart leaves none of them in the evidence folder.
- **"A Send that attaches it waits for your approval"**: a send by alpha's agent to a tracker URL, delivering nothing
  while waiting, then exactly once after your yes; the destination is a local listener, the one boundary the tests
  stand up. Your approval is a call, not the question card (#400's card arming isn't this issue's).
- **"Every frame during the hold is kept, and the first lands within 100 ms"**: no vsync missing between the first
  kept frame and the hold's end, and the first within 100 ms of the HID down, so a start-up of up to 100 ms is allowed.
- **Origin `deepbuild`** for the asset, from Privacy's list ("made by DeepBuild (a render, a capture, …)").

## Not tested, and why

- Window capture, camera and microphone (`source: window | camera | microphone`, `os_permission + trusted control`):
  no criterion names them, and camera and microphone land in R6. "Sample" in AC4 is read on frames only.
- "Record for an agent" and a capture started without a pick: in the fields' "It can never", but no criterion gives
  them an observable beyond AC1's; nothing in these tests lets an agent call `capture`.
- The system indicator itself, and that nothing covers it: the model's `indicator` call stands for both indicators.
- A no to the send, and a send of a file with redaction `complete`: no criterion names them (#15 tests the store's).
- Retention of the capture, and its use as a baseline.

## The Oracle lane

The issue names no upstream test; the held-shortcut gate, the picker-only rule and the record's privacy are this
design's own, so nothing upstream is ported and these tests are the local proof for every criterion.
