# Acceptance tests for #498, criterion 4: camera and microphone capture held by the trusted control

Written first, from issue #498 (as of Nov 1, 2026: its scope, its Capture fields and "It can never" line, criterion 4
and its proof line) and its oracle map, the design sections below, and base commit `c9225aa3` ("Merge pull request
#976"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Criterion 4, verbatim: "With DeepBuild holding the camera and microphone permissions, a panel's capture keeps no frame
or sample until the trusted control is held, keeps none within one frame after release, and keeps nothing on a later
request until the next hold; a planted capture that keeps its session open between holds keeps samples after release
and fails, naming the first; a capture an agent's tool call requests is refused, naming the caller".

What was read:

- The issue: Scope ("camera and microphone only through the OS permission while a shortcut is held, through the same
  gate screen capture uses"; "Capture: … camera and microphone through the OS permission plus a shortcut you hold");
  the Capture fields (`source`, `via: os_permission + trusted control` for camera and microphone on macOS, `hold:
  shortcut`, `indicator: system + app`, `max: s = 120`, `first_frame: ms ≤ 100`, `out: asset` with redaction
  `unknown`; "It can never: Record without the hold; give anything a standing grant; record for an agent"); the
  oracle map (criterion 4 has no upstream test: "the trusted-control capture gate … our device-gate and process
  rules").
- `docs/technical-design.md`: Device gate, capture and export (1931: the trusted ring's, never the media module's);
  Panels and devices, Device gate and capture (1949: "a camera or microphone only through the OS permission, each
  while a shortcut is held and with an indicator"; "It can never: … record without the picker or the OS permission";
  R6 the rest); the threat row "A plug-in that plays sound or records" (2379: "the camera and microphone through the
  OS permission while a shortcut is held, each with an indicator nothing can cover"); the Decided row "Clicks on the
  question card" (2667: synthetic key events carry a source state and posting pid "which the capture shortcut's gate
  logs as provenance and never trusts; the HID key-state table alone holds that gate"); the platform seams (2467:
  capture); Dogfooding (2518).
- `docs/canvas-primitives.md`: Capture (7526: "Frames and samples are kept only while the shortcut is held, every
  frame during a hold is kept … there's no system picker for the camera and no picker control for the microphone, so
  those use the OS permission plus DeepBuild's own held-shortcut control, never a standing grant"); Device gate
  (7504: "be granted by an agent" among what it can never do).
- At the base: AGENTS.md; `tests/acceptance/105/` (README, helpers, `hold.test.ts`, `live.test.ts`: the `deep-show
  run` capture surface, the `shortcut` call with `source: hid | synthetic`, #339's four synthetic forms, `indicator`,
  `captures`, the evidence store, the plants and `deep-app --capture-bug`); `tests/acceptance/339/` (the held-shortcut
  spike); `crates/deep-show/src/capture.rs` (#105's model: `capture` parses only `source: "screen"`; the HID table;
  `captures`; saved assets by hash with redaction `unknown`, origin `deepbuild`), `crates/deep-show/src/main.rs`
  (scenario parsing: an unknown call or `planted` value answers `bad_input`), `crates/deep-app/src/capture.rs`,
  `crates/deep-app/src/trusted_input.rs` and `deep-app`'s `--capture-bug` and `--capture-seam` modes.

What the base already does and these tests don't credit: #105's screen capture in `deep-show run` (a system picker
call, the HID key-state table as the only hold, a recording kept in memory and saved as one asset by hash at the
release or at 120 s, both indicators while recording) and `deep-app --capture-bug` (ScreenCaptureKit). There is no
camera or microphone anywhere: `deep-show`'s `capture` call refuses to parse any source but `screen`
(`"Camera and microphone land in R6"`), the scenario has no devices or permissions, nothing tells a panel's request
from an agent's tool call, and `deep-app` has no AVFoundation capture.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/498/capture --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/498/capture/tsconfig.json   # type-check
DEEP_498_LIVE=1 npx vitest run --root tests/acceptance/498/capture live.test.ts      # a person at the Mac (The live run)
```

Every file but `live.test.ts` first builds `deep-show` once with `cargo build --locked --bin deep-show`, copies it out
of the target folder (`$CARGO_TARGET_DIR/debug` when that is set, else `target/debug`) into a temporary folder, and
fails each of its tests when the build fails. Every world gets its own evidence and state folders, deleted after the
test. The tests use node built-ins and vitest only, start no process but `cargo`, `deep-show` (and, live, `deep-app`),
each a child stopped by its own timeout, and make no network connection. A run with `--root` may leave Vitest's cache
in `tests/acceptance/498/capture/node_modules/.vite`; delete it. `scripts/lanes.mjs` needs `tests/acceptance/498/` in
its one-at-a-time list (`alone`), since the files build a cargo binary; the implementer makes that edit.

**Deterministic part** (`hold.test.ts`, `agent.test.ts`, `fields.test.ts`): runs on every platform. The scenarios run
on the virtual clock and read no wall time; the camera and microphone are scenario inputs with their own frame
clocks, so "within one frame after release" is measured on the device's own clock, exactly.

**Live part** (`live.test.ts`): counts only on macOS, with `DEEP_498_LIVE=1` (a person at the Mac) and DeepBuild's
Camera and Microphone permissions already granted. Anywhere else, and whenever either permission isn't `granted`, it
fails with a message starting `INCONCLUSIVE:`. It never passes or skips on a reading it can't trust, and nothing in it
asks the OS for a permission, so an unattended run never shows a prompt: without `DEEP_498_LIVE=1` it starts nothing.

`BASE-FAILURE.txt` is the run at the base (home paths redacted): every test fails. The deterministic ones fail because
`deep-show run` answers `{"ok": false, "code": "bad_input"}` (no `devices`/`permissions` reading, no `capture` with
`source: camera | microphone`, and the planted names here are unknown); the live one fails `INCONCLUSIVE:` (no
person). That is the missing behaviour, not a test mistake.

Nothing missing passes (invariant 2): a reply without a field a test reads fails that test naming the field (for
example `captures[0].via`); a run that answers `bad_input`, exits non-zero or writes other than one line fails every
test that drove it.

## The surface under test

The issue names a panel's capture, the OS permission, a trusted control held by a shortcut, an indicator, an asset and
an agent's tool call, but no code API. So these tests extend #105's surface, `deep-show run`'s capture calls (the
binary that already plays the hub's trusted ring for tests), with the smallest set of fields and calls they need, in
its style; nothing of #105's surface changes meaning. The live part adds one flag to `deep-app`, the binary that holds
#339's gate and #105's live capture.

### What the model stands for

- **The camera and microphone** are the scenario's `devices`: each delivers items (camera frames, microphone sample
  buffers) on its own clock, whether or not anything keeps them (README: Items). On the Mac they are
  `AVCaptureDevice`s feeding an `AVCaptureSession`, which `live.test.ts` holds.
- **The OS permission** is the scenario's `permissions`: the OS's answer for DeepBuild per device (on macOS, TCC's
  authorization status for video and for audio). The model never changes it; nothing in a capture asks for it.
- **The trusted control** is #105's held shortcut: the HID key-state table, written only by `shortcut` calls with
  `source: "hid"`; a `source: "synthetic"` call carries the state and pid its poster set and never writes the table.
- **A panel's request** is a `capture` call with `panel`; **an agent's tool call** is the same call with `tool`
  naming the session it came from (an agent reaches the hub only through its session's tools).
- **Kept** means held by a capture: counted in its `frames`, between its `first` and `last`, and in its saved asset.
  The model's encoder keeps items unchanged and in order.
- **The indicator** is #105's `indicator` call: whether the system's and the app's indicators show.

What stays unproven by the model: the real AVFoundation sessions starting and stopping on the hold (`live.test.ts`),
the real HID table against a poster with Accessibility permission or a virtual HID device (#339's open question), the
system's camera and microphone indicators themselves, and encoding.

### Scenario fields added

```json
{"devices": [{"kind": "camera" | "microphone", "uuid": string, "rate_hz": n, "first": flicks, "feed": string}],
 "permissions": {"camera": "granted" | "denied" | "undetermined", "microphone": "granted" | "denied" | "undetermined"},
 "planted"?: one of the planted programs below,
 …#105's other fields: evidence, state, sessions, processes, clock, displays (with feeds), window, panels ({}), calls}
```

- `devices[]`: a capture device DeepBuild can open. It delivers item `k` (k ≥ 0) at `first + k · 705,600,000 /
  rate_hz` flicks; the tests use a camera at 30 Hz from 5 ms and a microphone at 100 Hz (48 kHz in 480-sample
  buffers) from 1 ms. `feed` is the token every item of that device carries.
- `permissions`: the OS's answer for DeepBuild per kind. The tests give `granted` for both, except the `via` test,
  which gives `denied` for both.

### Items

The item device `d` delivers at time `t` is the bytes of the line `frame <d's uuid> <t> <d's feed>\n` (#105's frame
line, so a camera frame and a microphone buffer read alike). A saved asset of a camera or microphone capture is the
items it kept, concatenated in time order. A device's **period** is `705,600,000 / rate_hz` flicks: one frame for the
camera, one buffer for the microphone. A hold's items are right when, for that device, all are of it, none is before
the HID down, **none is at or after the release plus one period** ("keeps none within one frame after release"), none
is missing between the first kept and the last delivered before the release, and the first is no later than 100 ms
after the down (`first_frame`). The one item delivered in [release, release + period) may be kept or not.

### Calls and replies

Every call carries `at` (flicks); calls arrive in `at` order; one reply per call, in order.

- **`{"call": "capture", "at", "source": "camera" | "microphone", "panel": string}`**: a panel's piece asks for that
  device. With the OS's answer `granted`, it opens a capture waiting for the hold: reply **`{"capture": id, "state":
  "armed"}`** (`capture` is read). Otherwise it is refused: reply `{"code": string}` with no `capture`, and nothing is
  ever kept for it. `panel` is the requesting panel's id, opaque; it needs no entry in `panels`.
- **`{"call": "capture", "at", "source", "panel", "tool": {"session": id}}`**: the same request made by an agent's
  tool call in session `id`. Always refused, whatever the permissions: reply **`{"code": string, "caller": id}`**,
  `caller` naming the session the call came from, with no `capture`; it opens no capture, so nothing is listed or
  kept for it.
- **`shortcut`** (#105's, unchanged): `{"call": "shortcut", "at", "phase": "down" | "up", "source": "hid"}`, or
  `"source": "synthetic", "state": n, "pid": n`. A hold (HID down to HID up, or to `max`) keeps every armed camera
  and microphone capture's items, as it does #105's armed screen capture; when it ends, each is saved as one asset.
  A capture is good for one hold: after its asset is saved it keeps nothing more, and a later request opens a new
  capture, which waits `armed` and keeps nothing until the next HID down.
- **`{"call": "indicator", "at"}`** → `{"indicator": {"system": bool, "app": bool}}` (#105's): both true exactly
  while some capture keeps items.
- **`{"call": "captures", "at"}`** → `{"captures": [entry]}` (#105's call). Every entry carries `source`; a camera or
  microphone entry is:

  ```json
  {"capture": id, "source": "camera" | "microphone", "panel": string | null,
   "via": "os_permission + trusted control", "hold": "shortcut",
   "state": "armed" | "recording" | "saved", "frames": n, "first": flicks | null, "last": flicks | null,
   "asset": {"sha256", "redaction", "origin"} | null}
  ```

  `frames` counts the items it kept (camera frames or microphone buffers), `first` and `last` are the times of the
  first and last of them (null while none), `asset` the saved recording in the evidence store (#15's layout,
  `<2 hex>/<62 hex>`), redaction `unknown`, origin `deepbuild`, null until saved. Every field is read; a missing one
  fails naming it. Refused requests have no entry.

### Planted programs

Each reachable only through `planted`, only to prove a test fails on a wrong program; each test runs its own and
asserts that it fails, naming what the criterion says it names.

| Name | The wrong program | Test |
|---|---|---|
| `keeps_session_open` | the device sessions stay open after a release: every item the camera and microphone deliver from the release on is kept, by the next capture the panel's later request opens, before its hold | criterion 4: fails `after the release:`, naming the first item kept after the release |
| `records_for_agent` | an agent's tool call is taken as a panel's request: it opens an armed capture (reply with `capture`, no `caller`) that the next hold records | criterion 4: fails naming the caller `sess-alpha` |
| `records_without_hold` (#105's) | the gate takes any press of the chord, synthetic ones too, as the hold | criterion 4: fails `before the hold:` |
| `labels_redaction_complete` (#105's) | the saved asset is labelled redaction `complete` | `out: asset` (redaction `unknown`): fails naming the label |
| `records_past_max` (#105's) | the recorder ignores `max` and keeps items for as long as the chord is held | `max: s = 120`: fails naming items past 120 s |
| `records_without_permission` | a request is armed and recorded whatever the OS's answer | `via: os_permission`: fails `without the OS permission` |

### The live run

`live.test.ts` builds `deep-app` (`cargo build --locked -p deep-app`), copies it out of the target folder and runs
`deep-app --capture-devices <store>`, the app itself so its timeout (10 minutes) stops the process it means; its
prompts to the person go to stderr, which the test leaves on the terminal. The run:

1. Reads DeepBuild's authorization status for video and for audio (`AVCaptureDevice authorizationStatusForMediaType:`)
   and **never** calls `requestAccessForMediaType:`; unless both are authorized it prints its report line with the
   two statuses and exits 0, having opened no device.
2. Request 1: a capture of the default camera and one of the default microphone, armed. The person holds ⌥Space
   (#339's chord, read from the HID key-state table) for a few seconds and lets go. The sessions run only from the
   HID down to the HID up (at most 120 s), with the app's indicator beside the system's.
3. Request 2, made a few seconds after the release: the same two, armed. The app waits at least 3 s, counting
   anything delivered to them, then tells the person to hold ⌥Space again; the second hold ends request 2.
4. Each capture's recording is saved into `<store>` by its SHA-256 (#15's layout) as an MP4, MOV or M4A file.

It prints, as a JSON line on stdout:

```json
{"capture": 498,
 "permission": {"camera": "granted" | "denied" | "restricted" | "undetermined", "microphone": …},
 "via": "os_permission + trusted control", "hold": "shortcut",
 "holds": [{"down_ms": n, "up_ms": n}, {"down_ms": n, "up_ms": n}],
 "captures": [{"request": 1 | 2, "source": "camera" | "microphone", "requested_ms": n, "period_ms": n,
               "kept_before_hold": n, "kept": n, "first_ms": n, "last_ms": n,
               "asset": {"sha256", "redaction"}}]}
```

Times are milliseconds on the host clock since the run started: the HID down and up as the gate read them, and each
kept item's presentation timestamp (its `CMSampleBuffer`'s, on the host time clock). `period_ms` is the device's frame
duration (the camera's active frame duration; the microphone's buffer duration), `kept_before_hold` what the capture
kept between its request and its hold's down. It passes when the run exits 0, both permissions are `granted`, `via`
and `hold` are as above, there are 2 holds and 4 captures, and for each capture: requested before its hold's down
(request 2 after hold 1's up), `kept_before_hold` 0, `kept` ≥ 1, `first_ms` ≥ its hold's `down_ms`, `last_ms` <
`up_ms + period_ms`, redaction `unknown`; and the store holds exactly the four assets, each hashing to its name and a
whole ISO-BMFF file (top-level boxes adding up to the file, `ftyp` first, `moov` among them). It fails
`INCONCLUSIVE:` without `DEEP_498_LIVE=1`, off macOS, and when either permission isn't `granted`.

## Criteria to tests

Each test's name starts with what it holds. Each builds its failures as sentences naming what failed, and runs its
wrong program to show the same check fails on it.

| Holds | Tests, and the wrong program each fails on |
|---|---|
| Criterion 4: nothing kept until the trusted control is held | `hold.test.ts` (1): the panel asks for the camera and the microphone at 2 s; 8 synthetic presses in #339's four forms, 3–5 s; at 6 s both captures are `armed` with 0 kept and no asset, `via` and `hold` as the fields say, the store empty, the indicator off in looks during presses. Fails on: `records_without_hold`, `before the hold:` (`hold.test.ts` (3)) |
| Criterion 4: none within one frame after release | `hold.test.ts` (1): the chord held 7 s to 9.0105 s (mid-period for both devices), a synthetic up inside it: the indicator on during it and off 500 ms after; each asset holds every item of the hold, the first within 100 ms, none before the down and none at or past the release plus one period of its own device; `frames`, `first`, `last` match the asset; redaction `unknown`, origin `deepbuild` |
| Criterion 4: nothing on a later request until the next hold | `hold.test.ts` (1): the panel asks again 2 s after the release: new captures, `armed`, 0 kept, `first` null, at 5 s after the release; the indicator off; the store holds only the first hold's two assets. A second hold (1.5 s) keeps only its own items: nothing from between the holds |
| Criterion 4: the planted open session fails, naming the first | `hold.test.ts` (2): `keeps_session_open` fails with a message starting `after the release:` naming the first item kept after the release by time |
| Criterion 4: an agent's tool call is refused, naming the caller | `agent.test.ts` (1): alpha's agent asks by tool call for the camera and microphone: each reply has a `code`, no `capture`, `caller: "sess-alpha"`; a hold after it lights no indicator, lists no device capture and leaves the store empty. The control: the panel's own requests and a hold then keep that hold (so a gate that never records fails). (2) Fails on: `records_for_agent`, naming `sess-alpha` |
| `out: asset` (redaction `unknown`) | `hold.test.ts` (1) and (3): fails on `labels_redaction_complete`, naming the label |
| `max: s = 120`, `indicator: system + app` | `fields.test.ts`: a 125 s hold: the indicator on at 119.5 s and off at 120.5 s while held; both assets saved by 121 s; each holds its device's items of the first 120 s, the last within one period of 120 s, none at or past 120 s plus one period; two files in the store. Fails on: `records_past_max`, naming items past 120 s |
| `via: os_permission + trusted control` | `fields.test.ts`: with both permissions `denied`, the panel's requests are refused (a `code`, no `capture`) and a hold keeps nothing, lights nothing, stores nothing. Fails on: `records_without_permission` |
| Never a standing grant; never record without the hold; never record for an agent | the later request (`hold.test.ts`), the synthetic presses (`hold.test.ts`), the agent's tool call (`agent.test.ts`) |
| Live: the real devices | `live.test.ts` with a person (The live run) |

## Readings where the issue and design leave a choice

- **"Through the same gate screen capture uses"**: the hold is #105's HID key-state table, and the calls are #105's
  `deep-show run` capture calls with a new `source`; a hold keeps every armed capture, screen or device.
- **"A panel's capture"**: a request that names a panel; the panel's id is opaque here (the device gate's `owner:
  panel | plug-in ID`). A request opens one capture per device; the tests make one per device.
- **"Keeps no frame or sample until the trusted control is held"**: before the HID down, the capture's `frames` is 0
  and `first` null, its asset holds nothing earlier than the down, nothing is in the evidence store and the indicator
  is off; synthetic presses change none of that.
- **"Keeps none within one frame after release"**: read on the device's own clock: nothing kept at or after the
  release plus one period (one camera frame, one microphone buffer), so a stop that lets the one item already in
  flight through is allowed and anything later fails. The release is placed mid-period on both clocks.
- **"Keeps nothing on a later request until the next hold"** and "never a standing grant": a capture is good for one
  hold; neither the granted permission nor an earlier hold makes a later request keep anything before its own hold,
  and the next hold's assets hold nothing from between the holds.
- **"A planted capture that keeps its session open between holds keeps samples after release and fails, naming the
  first"**: the failure names the first item kept after the release by its time and its distance from the release.
- **"A capture an agent's tool call requests is refused, naming the caller"**: the request carries `tool: {session}`
  (an agent's tool calls arrive bound to its session, as `deep_show` calls do); the refusal's `caller` is that session.
  Refused means: no capture opened, nothing kept or listed, no indicator, no file.
- **The OS permission** is read, never asked for, during a capture: the model's `permissions` never change, and the
  live run reads the status only. How DeepBuild first gets the permission (a setup step) is outside criterion 4.
- **`first_frame: ms ≤ 100`** is checked on the model (every hold's first item within 100 ms of the down) but not on
  the live run, where a camera's warm-up is the hardware's.

## Not tested, and why

- The asset's redaction flow after capture, Sends and asks (#105 tests them for screen captures); the record and log
  privacy of camera and microphone items (#105's AC4 for screens; criterion 4 doesn't name it).
- The system indicators themselves and that nothing covers them: the model's `indicator` call stands for both.
- `undetermined` and `restricted` permissions on the model: the `via` test uses `denied`; what a capture does before
  the OS has answered is a setup question criterion 4 doesn't ask.
- Window capture, and the other criteria of #498 (other parts' suites).

## The Oracle lane

The oracle map gives criterion 4 no upstream test ("our device-gate and process rules"), so nothing upstream is ported
and these tests are the local proof.
