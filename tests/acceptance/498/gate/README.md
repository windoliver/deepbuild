# Acceptance tests for #498, the device gate: criteria 1, 5 and 9

Written first, from issue #498 as of November 1, 2026 (its scope, its Device gate fields and their "It can never"
lines, criteria 1, 5 and 9, and its proof line), its oracle map, the design sections it links and those they lean on,
and base commit `c9225aa3` ("Merge pull request #976"), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). The issue's other criteria (the decode worker, capture, probes, color) are other jobs' folders.

What was read:

- The issue: Scope ("Sound never starts until you start it"; "sound only after your gesture, with an owner indicator";
  "Sound stops with its owner: closing a panel, or opening another document in it, stops every voice it started within
  one audio block, and playing again needs a new gesture"); the Device gate fields (`owner: panel | plug-in ID`,
  `granted_by: input entry` "a gesture in that panel, by serial", `state: suspended | running | interrupted | muted`,
  `reserved: [sound ID]` "the question chime and notices", and the rest); "It can never: Start sound unasked; imitate
  the question chime; be granted by an agent"; the proof line ("The silent-panel sweep across shipped plug-ins").
- The oracle map: no upstream test for criteria 1, 5 or 9 ("our device gate and panel ownership").
- `docs/technical-design.md`: The media module (1871; Strip and track; Bus, processor and emitter; "Device gate,
  capture and export": "media's sound reaches the speakers only through the gate"); Panels and devices (trusted ring)
  (1947): Device gate and capture ("sound starts only after your gesture, with an indicator naming its owner"; "It can
  never: Start sound unasked, … or imitate the question chime"), Panel (1961: "Shipped panels may run in the app"; "…
  sound … need a gesture serial from your input in that panel"; "A canvas mounts in it"), Editor panel (2008: "a panel
  the app ships, which you can replace like any shipped panel"); the threat row "A plug-in that plays sound or records"
  (2379: "sound starts only after your gesture in that panel, … the question and notice sounds are reserved"); Building
  blocks (445: "the device and media gate" is trusted-ring code); Dogfooding (2518).
- `docs/canvas-primitives.md`: Sound and video on the picture's clock (7042: "Audio renders in 128-sample blocks …
  block k holds samples [128k, 128k + 128)"); Asset; Strip and track (7253: `track`, `src: asset`, `start`, `in, out`,
  `loop`; "It can never: … play sound outside the device gate"; the 5 ms fade at a strip's edit); Bus ("drop a voice
  without its fade"); Device gate (7504: "Sound for an owner starts only after a gesture in its panel, which covers that
  panel's sources until it closes"; "reserved sounds come only from the app, with an asset too similar to one refused at
  load. Too similar is measured: an asset whose log-mel spectrogram, loudness-matched, correlates with a reserved
  sound's at 0.9 or more at any offset within ±50 ms and any pitch shift within ±2 semitones is refused at load, naming
  the reserved sound"); Capture and Decode worker (beside it, for scope only).
- At the base: AGENTS.md; `tests/acceptance/105/` (`deep-show run`'s Driver, plants run by each test, `BASE-FAILURE.txt`,
  the INCONCLUSIVE rule), `401/` (panel slots, `input` and its serial, a serial of your input in that panel as the only
  grant, an agent's request), `383/`, `384/`, `393/` (`deep-show run`'s scenario, panels, the evidence store),
  `880/`; `crates/deep-show/src` (`main.rs`'s scenario and call parser, `ring.rs`, `input.rs`, `capture.rs`,
  `time.rs`'s sample rates), `crates/deep-app/src/views.rs` and `crates/deep-app/inventory.json` with
  `scripts/app-inventory.mjs` (#882: the app's shipped panels), `crates/deep-canvas-seams` (the `audio` seam is
  declared, with no backend), `packages/extension-host` and `packages/hub/src/core.ts` (the signed release list is
  empty: `release: []`).

What the base already does and these tests don't credit: `deep-show run` plays the hub's canvas side, its panels and
its input router on #400's virtual clock, gives each `input` a serial and refuses a pop-out without your serial in that
panel (#401); `deep-app` ships six panels, listed in its inventory. There is no sound anywhere: no strip playback, no
device gate, no reserved sound, no comparer, no output.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/498/gate --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/498/gate/tsconfig.json   # type-check
```

Each file first builds `deep-show` once with `cargo build --locked --bin deep-show`, copies it out of `target/debug`
into a temporary folder, and fails each of its tests when the build fails. Every world gets its own evidence folder,
deleted after the test. The tests use node built-ins and vitest only; they start no process but `cargo`, `deep-show`
and `node scripts/app-inventory.mjs --check` (each waited for, none stopped by name or port), and make no network call.
A run with `--root` may leave Vitest's cache in `tests/acceptance/498/gate/node_modules/.vite`; delete it.
`scripts/lanes.mjs` needs `tests/acceptance/498/gate/` in its one-at-a-time list (`alone`) beside `105/` and `401/`,
since each file builds a cargo binary; this README is the instruction, and the implementer makes that edit.

Every test is deterministic and runs on every platform: the scenarios run on the virtual clock, the audio on the
device's own sample clock, and nothing reads wall time. There is no live test: no criterion here needs a person, and
none is INCONCLUSIVE. What stays unproven is named under Not tested.

`BASE-FAILURE.txt` is the run at the base (home paths redacted): all 4 tests fail, each because `deep-show run` answers
its first scenario `{"ok": false, "code": "bad_input"}` (the base has no `open`, `play`, `gate`, `output` or `reserved`
call, nor the panels' `shipped` field). In `silent.test.ts` the inventory check passes first, so the failure is the
gate's, not the list's. That is the missing behaviour, not a test mistake.

Nothing missing passes (invariant 2): a reply without a field a test reads fails the test naming the field (a `gate`
reply without `granted_by` fails naming `granted_by`; `null` is a value, absence isn't); a run that answers `bad_input`,
exits non-zero or writes other than one line fails every test that drove it; an output WAV that isn't in the evidence
store, doesn't hash to its name, or disagrees with its reply on rate, channels or length fails.

## The surface under test

The issue names a gate, its fields, panels, plug-ins, strips, Play, documents and the question chime, but no code API.
So these tests extend the binary that already plays the hub's canvas side, its panels and its input router for tests,
`deep-show run` (#393, #383, #400, #401, #105), with the smallest set of fields and calls they need, in its own style.
No new binary. #393's conventions hold unchanged: one JSON scenario per stdin line, one JSON object out, exit 0; a line
that isn't JSON, lacks a required field, or names an unknown call, field value or `planted` value answers `{"ok":
false, "code": "bad_input"}`; a scenario that runs answers `{"ok": true, "replies": [Reply]}`, one per call, in order.
Every call carries `at` (flicks, 705,600,000 a second); calls arrive in `at` order, ties in the order given.

### The scenario

#401's, with no installs: `evidence`, `sessions` (alpha, `sess-alpha`), `processes`, `clock: {lead, check}`, #400's
`displays` (A and B), `window: [1200, 700]`, optional `planted`, `calls`, and `panels`, each panel ID mapped to a slot:

```json
"panels": {panel ID: {"rect": [x, y, w, h], "shipped"?: shipped panel ID}}
```

- **`shipped`** (added): the slot holds that shipped panel, an ID exactly as `crates/deep-app/inventory.json` lists it
  (`panels[].panel`, e.g. `deepbuild/home`). The gate's owner for its sound is that ID. An ID the app doesn't ship is
  `bad_input`, so the binary must know the app's real list.
- A slot without `shipped` is a plain panel; the gate's owner for its sound is the panel ID.

### Calls and replies

- **`input`** (#383's, #401's): a click is a `down` then an `up` 60 ms later at the slot's centre; the `down`'s reply
  holds `serial`, the input router's serial for your input in that panel.
- **`{"call": "open", "at", "panel", "doc": doc ID, "strips": [Strip]}`** → `{"opened": true}`, or a refusal
  `{"code": string, "reserved"?: sound ID}` with `opened` absent or false. Opens a document of strips in the panel,
  replacing the one it shows, and loads its assets; on a closed panel it opens the panel again. A document opens
  stopped. An asset too similar to a reserved sound (Device gate) is refused here, at load, and the refusal names that
  reserved sound in `reserved`; a refused document doesn't open, and nothing of it can sound.

  ```json
  Strip: {"track": n, "src": {"asset": sha256}, "start": flicks, "in": flicks, "out": flicks, "loop"?: true}
  ```

  Strip and track's fields: the asset by hash in the evidence store (a WAV the test wrote: PCM 16-bit, 48 kHz, mono),
  placed at `start` on the document's time and playing its source from `in` to `out`; a looping strip repeats
  `[in, out)` to the transport's end.
- **`{"call": "close", "at", "panel"}`** → any object (unread). Closes the panel and its document.
- **`{"call": "play", "at", "panel", "serial"?: n, "session"?: session ID}`** → `{"playing": true}` when the panel's
  transport starts and its strips go to the gate, or a refusal `{"code": string}` with `playing` absent or false.
  - with **`serial`**: you pressed Play in that panel; the serial is the one your click there was given. It grants the
    gate only if it is a serial of your input in that panel since it last opened a document (Readings).
  - with **`session`**: that session's agent asks. Never a grant.
  - with **neither**: the panel's own code asks (its script, a timer, an autoplay). Never a grant.
  Once granted, the transport plays the open document from its time 0.
- **`{"call": "gate", "at", "panel"}`** → `{"gate": {"owner": string, "granted_by": serial | null, "state":
  "suspended" | "running" | "interrupted" | "muted", "reserved": [sound ID], …}}`: the Device gate's fields for the
  panel's owner at `at`. `granted_by` is the serial of the gesture that granted it, `null` while nothing has;
  `reserved` lists every reserved sound's ID. Other fields of the issue (`quiet_hours`, `limiter`, `loudness_cap`,
  `stats`, …) may be present and aren't read.
- **`{"call": "output", "at", "from": flicks, "to": flicks}`** (`to ≤ at`) → `{"output": {"sample_rate": Hz,
  "channels": n, "first": sample, "frames": n, "sha256": hash}}`: what the gate passed to the device over `[from, to)`,
  written into the evidence store by its SHA-256 as a WAV (RIFF WAVE, interleaved, PCM 16-, 24- or 32-bit or IEEE float
  32-bit). **The device's sample clock**: sample n plays at flick n × 705,600,000 ÷ `sample_rate`, sample 0 at flick 0;
  `sample_rate` must divide 705,600,000 (48 kHz, 44.1 kHz, 96 kHz …), so every sample has an exact time. `first` is the
  first sample at or after `from`, and `first + frames` the first at or after `to`.
- **`{"call": "reserved", "at"}`** → `{"reserved": [{"sound": sound ID, "for": "question" | "notice", "sha256"}]}`:
  the app's reserved sounds, each written into the evidence store by its SHA-256 as a WAV (formats as above). Exactly
  one is `for: "question"`: **the question chime**. This is where the tests read the chime from: the app's own sound,
  through the gate, not a file the tests name.

Silence is a sample whose magnitude is at most 2^−20 (−120 dBFS; exactly 0 in 16-bit PCM) on every channel.

### Planted programs

Each reachable only through `planted`, only to prove a test fails on a wrong program; every test runs its own and
asserts that it fails, naming what the criterion says it names.

| Name | The wrong program | Test |
|---|---|---|
| `shipped_panels_ungated` | the gate trusts a shipped panel: its own request to play starts sound with no gesture | C1 |
| `comparer_matches_hash` | the reserved-sound comparer refuses an asset only when its SHA-256 equals a reserved sound's | C5 |
| `keeps_voices_on_switch` | opening another document in a panel leaves the previous document's voices playing | C9 switch |
| `fades_on_close` | closing a panel fades its voices out over 5 ms (240 samples at 48 kHz), longer than a block | C9 close |

## Criteria to tests

Each test's name starts with its ID. Each builds its criterion's failures as sentences naming what failed, and runs its
wrong program to show the same check fails on it.

| ID | Criterion | Tests, and the wrong program each fails on |
|---|---|---|
| C1 | No panel plays sound before you start it, checked across every shipped plug-in | `silent.test.ts`: the shipped plug-ins are every `panels[].panel` of `crates/deep-app/inventory.json`, after `node scripts/app-inventory.mjs --check` passes (the list matches the app's source); an empty list fails. For each, in its own world: its panel in slot `p` (`shipped`), a plain panel `other`; a document of two strips (440 Hz for 8 s, 660 Hz looping) opens at 1 ms; the panel's own request to play at 1 s, alpha's agent's at 1.5 s, Play with the serial of your click in `other` at 2.1 s are each refused; the gate at 0.5 s and 3 s is owned by the plug-in's ID, `granted_by: null`, `suspended`; the device carries only silence from sample 0 until your press in `p` at 4 s; Play with that press's serial is `playing`, the gate turns `running`, granted by that serial, and the 440 Hz strip sounds at 4.3 s. A slot naming a panel the app doesn't ship is `bad_input`. Fails on: `shipped_panels_ungated`, naming every shipped plug-in ("sounded … before you pressed Play") |
| C5 | The question chime shifted up one semitone and 3 dB quieter is refused at load, naming the chime; a planted comparer that matches by hash admits it and fails | `chime.test.ts`: `reserved` gives exactly one sound for the question, a WAV of 50 ms to 10 s that isn't silent, and the gate's `reserved` field names every reserved sound. The test speeds the chime up by 2^(1/12) (every frequency up a semitone, band-limited resampling) and lowers it 3 dB. A document whose strip plays it is refused at `open` with `reserved` naming the chime, and after your press of Play nothing reaches the device. The chime's own asset is refused the same way. The control: a 1 s white-noise burst opens and sounds after your press, and not before. Fails on: `comparer_matches_hash`, which admits the shifted chime |
| C9 | A panel playing strips stops every voice within one audio block when it closes or opens another document, and pressing Play again is needed before any sound; a planted gate that keeps the previous document's voices after the switch fails, naming the panel | `owner.test.ts`, plain panel `player`; doc-a holds three voices (440 Hz on track 0 from 0, 550 Hz on track 1 from 0.5 s, 330 Hz looping on track 2), doc-b one (660 Hz). Your press at 1 s plays doc-a (`running`, granted by that serial); all three voices sound before the cut and in the 1,024 samples before it. The cut is at flick 96,077 × 14,700 (sample 96,077 on a 48 kHz clock, 77 samples into block 750). **Switch**: doc-b opens at the cut; from the cut's sample + 128 to your next press at 4 s every sample is silence; the panel's own request, Play with your earlier serial and alpha's agent are refused and the gate is `suspended` with `granted_by: null`; your new press plays doc-b's 660 Hz and none of doc-a's voices, the gate `running`, granted by the new serial. Fails on: `keeps_voices_on_switch`, naming the panel (`player`'s voices "still sound … after it opened another document"). **Close**: the panel closes at the cut; silence from the cut + 128 to 4 s; Play with the earlier serial on the closed panel is refused and its gate is `suspended`, no grant; doc-a opens again at 3 s and the same three requests are refused; your new press plays it. Fails on: `fades_on_close`, naming the panel |

The proof line's "silent-panel sweep across shipped plug-ins" is C1.

## Readings where the issue and design leave a choice

- **The shipped plug-ins** are the app's shipped panels as `crates/deep-app/inventory.json` lists them, the repo's one
  list of what the app ships (#882 keeps it current against `crates/deep-app/src/views.rs`; the test runs that check
  first). The design calls a panel "a plug-in's view" and the editor panel "a first-party plug-in … a panel the app
  ships, which you can replace like any shipped panel". The signed release's package list (`packages/hub/src/core.ts`,
  `release: []`) is empty at the base, so it can't be the sweep's list. `deepbuild/extension`, the slot an installed
  extension draws in, is listed there and is swept like the rest.
- **What asks a panel to sound.** A shipped panel has no sound of its own at the base, so the sweep gives each one a
  document of strips (a canvas mounts in any panel) and asks it to sound in every way but yours: the panel's own
  request (its script, a timer, an autoplay, modelled as `play` with no serial, as #401 models a script's ops), an
  agent's ("can't be granted by an agent"), and Play with the serial of your click in another panel. Your press of
  Play there is the control: without it a gate that never sounds would pass.
- **Pressing Play** is your click in the panel (its serial) and the `play` call carrying that serial 60 ms later, at the
  click's release, as #401's `pop_out` carries the serial of your click. Silence is required strictly before the press,
  so a gate may start sound anywhere from the press on.
- **"Playing again needs a new gesture"**: a serial of your input before the panel opened another document, or before it
  closed, no longer grants, even while it is under #401's 30 s freshness (1.7 s old in the test). The grant covers the
  panel's sources until it closes (Device gate), and the issue's scope ends it on a new document as well.
- **"Within one audio block"** is 128 samples on the device's own sample clock (Blocks), counted from the first sample
  at or after the close or switch: every sample from that one + 128 on is silence. Samples inside that block may still
  carry a fade. The strip rule "fades over at least 5 ms … so no edit clicks" is about editing a strip on the timeline;
  the issue's stop is the owner's sound ending, and a 5 ms fade (240 samples at 48 kHz) is the planted `fades_on_close`.
  The cut is put 77 samples into a block so a gate that stops only at a block boundary still has to stop within 128.
- **"Every voice"**: three strips on three tracks, one looping, read by the device's output alone: if any voice went on,
  some sample past the block would carry it.
- **"Shifted up one semitone"** is tape-style: the chime played 2^(1/12) times as fast at its own sample rate, which
  shortens it by 5.6% (the design's rate ramp: "pitch follows the rate"). The comparer is the implementer's, held to
  the Device gate's measure (±2 semitones, ±50 ms, 0.9 on loudness-matched log-mel); the tests don't read how it
  compares, only that this asset is refused and a noise burst isn't. **"3 dB quieter"**: every sample × 10^(−3/20).
- **"At load"** is the document's `open`, which loads its assets; the refusal names the reserved sound by its ID in
  `reserved`. The question chime itself, by its own hash, is refused the same way ("reserved sounds come only from the
  app").
- **The question chime** is read through the gate (`reserved`), since the design says only that it is the app's own;
  where the app keeps it is the implementer's. The tests require it to be a real sound (50 ms to 10 s, not silent),
  and the control (white noise, nothing like a chime by any measure) to load, so a comparer can't pass by refusing
  everything.
- **A plain panel's owner** is its panel ID (`owner: panel | plug-in ID`); a shipped panel's is its inventory ID.
- **What reached the device** is the gate's output to the `audio` seam, written as a WAV by hash, so the tests judge
  samples, not the gate's word about its voices (invariant 1).

## Not tested, and why

- A live run through CoreAudio on the reference Mac: no criterion here is about the device backend; the output call is
  what the gate hands the device. The `audio` seam's conformance is #140's.
- `quiet_hours`, `limiter`, `loudness_cap`, `lowpass_sandboxed`, `stats`, the `interrupted` and `muted` states, the
  owner indicator and mute in the shell, and a port's gear: in the issue's fields but no criterion here reads them.
- A pitch shift down, or other distances inside ±2 semitones and ±50 ms: criterion 5 names one asset.
- Notices (the other reserved sounds) as near-copies: only the chime is named; the gate's `reserved` field must list
  every reserved sound.
- Capture, the decode worker and probes: other criteria of #498, in other folders.

## The Oracle lane

The oracle map gives no upstream test for criteria 1, 5 or 9; the gate, its owners and its reserved sounds are this
design's own, so nothing upstream is ported and these tests are the local proof.
