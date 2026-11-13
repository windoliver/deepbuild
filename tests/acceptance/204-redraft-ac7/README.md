# Blind redraft of #204's AC7 test: the engine fixture's export against the live render

AC7, `#204.4e815a43`: "An export of the engine fixture holds its loudness profile and its PCM hash equals the live
render's over the same span; a planted export that renders the synth with another block size changes the hash and
fails, naming the first block"

The engine fixture is criterion 1's (`#204.47d50ee6`): "A fixture whose engine preset maps a car's speed channel, rising
from 0 to 30 m/s over 4 s, to a sine oscillator at 60 Hz plus 4 Hz per m/s".

Written by a fresh blind job for this one criterion, before any implementation, from the issue, the design and the base
commit `4a0910cf4` ("design(#204): the osc's waves, the shaper's curves and the crush's step, written out as laws"). No
implementation, first draft, dispute, other worktree, branch or pull request was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 204 --repo windoliver/deepbuild`, Nov 13, 2026): its Scope, Fields, the 15 criteria
  and its Proof line.
- The Oracle page (`doneright/oracles/issues/204.md` in DeepBuildAI/deepbuild, branch `doneright`): criterion 7 has no
  upstream test ("Seek equals play from checkpoints, params held per block with a one-block ramp, and export equal to
  live are our synth's own rules").
- `docs/canvas-primitives.md` at the base: Synth `synth@1` and its "As built (#204)" paragraph (where a synth sits, the
  strip's `src: {synth: {preset, params, voices, seed, byte_budget}}`, presets in a pack's manifest as
  `presets: {<name>@<major> → preset}` named `<pack>.<name>@<major>`, a node's numeric field as a number or a param's
  name, edges, the osc's u64 phase, the gain node, the block rule of 128 samples ramped from each block's reading to the
  next, expressions reading `t` and a channel by its ID, the pack check and its cost table, the derived tail);
  Strip and track; Bus (the master's true-peak limiter); Processor (latency, `W + 8` samples for the limiter); Device
  gate; Channel and key; Pack; Export (its receipt, `pcm_hashes`, SHA-256 over PCM as interleaved f32le); Loudness and
  caption profiles (`loudness_profile`, `none` applies no gain, one static gain ahead of the master's limiter, r128 and
  its short-form rule); Time and the flick.
- `docs/technical-design.md`: Bus, processor and emitter; Narration, captions and profiles; Device gate, capture and
  export; Dogfooding.
- At the base, for surfaces and harness conventions only: `AGENTS.md`, `scripts/proof-change.mjs` (criterion IDs);
  `crates/deep-show/src/main.rs` (the `run` scenario, how `planted` is routed, `install_pack` and the scenario's
  `packs`), `export.rs` (the `export` call, its receipt, `pcm_hashes`, the loudness profile's gain), `gate.rs` (a film
  in its own panel plays its mix live after your gesture, `play` with a serial), `audio.rs`, `mixdown.rs` (`handed`,
  `planted_of`'s live and export plants), `packs.rs` and `deep-canvas`'s pack check (a pack field no module reads is
  refused as `unknown_field`); `crates/deep-canvas-media/src/delivery.rs` (the profiles), `lib.rs` (`PLANTED`); the
  suites `tests/acceptance/501/`, `502/`, `157/`, `1163/`, `499/mix/`, `498/gate/`, `1818/` and `1958/` (how they build,
  present and export a film, play it live, decode and meter a delivery, offer a pack, and tag their tests).

## Run it

```sh
npm ci                                    # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 30 -- \
  scripts/lease cargo build --locked --bin deep-show
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run \
  --root tests/acceptance/204-redraft-ac7 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/204-redraft-ac7/tsconfig.json   # type-check
```

`export.test.ts` builds `deep-show` once in `beforeAll` with `cargo build --locked --bin deep-show` (the default
features, `full`; a no-op after the leased build above when the environment matches), copies it out of the target
folder (`CARGO_TARGET_DIR` honoured), and fails each test whose build failed. Every run writes under one temporary
folder per file, deleted after it. Node built-ins and vitest only; no network; no process is stopped but by
`spawnSync`'s own timeout on the child it started. The exports draw and hash frames on the GPU and encode H.264 with the
platform's encoder, so the suite runs on a Mac. **This folder must run alone**: `scripts/lanes.mjs` needs
`'tests/acceptance/204-redraft-ac7/'` in its `alone` list (the file builds a cargo binary); the implementer makes that
edit.

What runs: one `deep-show run` that presents the engine film and exports it twice (no profile named, then r128), each
delivery read back by the decode worker; one loudness bake of the r128 delivery; two app-world runs for the live render
(your click, then Play and `handed`); and, for the planted program, the same export run with the no-profile export
only and the same live runs, each with the plant named.

## The surface under test

`deep-show run` (#393's scenario binary: one JSON scenario on stdin, one `{"ok": true, "replies": […]}` line, exit 0;
a line naming an unknown `planted` value answers `bad_input`), with the calls the merged suites define, unchanged.
**Every name the issue or the design doesn't give is marked *(chosen)***; the implementer builds exactly these, or a
dispute goes to a blind redraft. Times are flicks (integers) or the time grammar's text.

The world (as #1163's): the agent session `sess-engine` (process 4300), its tool shell 4301 and the test process 4302
that runs `deep show` (`peer: {pid: 4302, start: 1200}`); one panel `main` showing the document
`01JC204D000000000000000007`; the scenario's `packs: [{id: "acme/cars", dir}]` offers the fixture pack's folder to
the store before the first call (#306, #1958). The app world adds #1163's clock, two displays and the window.

| Call | Request fields | Reply fields read | New or existing |
|---|---|---|---|
| `deep show` | `peer`, `doc`, `document`, `include: ["issues"]` | `outcome: "presented"` | existing; the document carries a synth strip (below) |
| `packs` | — | printed when `deep show` doesn't present, nothing judged | existing (#306) |
| `export` | `doc`, `out`, `video: {codec: "h264"}`, `audio: {codec: "pcm"}`, `loudness_profile?: "r128"` (left out: `none`) | `outcome: "exported"`; `receipt.pcm_hashes` (one SHA-256 per frame's span of interleaved f32le), `receipt.loudness_profile`, `receipt.gain` (dB), `receipt.limiter_cut`, `receipt.integrated`, `receipt.true_peak`, `receipt.max_s`, `receipt.delivery.{integrated, true_peak, max_s}` | existing (#501, #502, #157); the synth renders in the export's mix |
| `media_decode` | `path` (the delivered MP4), `out`, `video_frames: 0` | `decoded.streams[]` with `type: "audio"`: `channels`, `sample_rate`, `file` (raw interleaved f32le in `out`) | existing (#498, as #502 reads it) |
| `media_bake` | `bake: {asset, kind: "loudness", tp_oversample: 8}` | `bake.integrated`, `bake.true_peak`, `bake.short_term_max` | existing (#500) |
| `input` | app world: `at`, `panel`, `event: {type: "down" \| "up", pos}` | the press's `serial` | existing (#383, #498) |
| `play` | app world: `at`, `panel: "main"`, `serial` | `playing: true` | existing (#498; a film in its own panel, #1163) |
| `handed` | app world: `at`, `panel: "main"`, `from: 0`, `to: 6 s` | `handed: {sample_rate, channels, first, frames, sha256, wav}` (the WAV in the evidence store) | existing (#499) |

### The synth in the document and in the pack

From the Synth row's As built paragraph, as its words give it, except where marked:

- **The pack** `acme/cars@1.0.0`, a folder holding one `pack.json`: `{name: "cars", version: "1.0.0", license:
  "CC0-1.0", description, requires: {core: ">=0.0.0", modules: {media: ">=0.0.0"}}, presets: {"engine@1": Preset}}`.
  The base refuses `presets` as a field no module reads (`unknown_field`); the implementation reads it.
- **The preset** `engine@1`, named by the document as `cars.engine@1`:

  ```json
  {"nodes": {"tone": {"osc": {"wave": "sine", "hz": "hz"}}, "level": {"gain": {"gain": 0.25}}},
   "edges": [["tone", "level", "in"]],
   "out": "level",
   "params": {"hz": {"unit": "Hz", "range": [20, 400], "default": 60}},
   "cost": 8}
  ```

  - A node is written as its kind holding its fields, `{"osc": {"wave": "sine", "hz": "hz"}}` *(chosen: the row's
    `osc {wave, hz}`, written as a strip's `src: {synth: {…}}` and a score instrument's `source: {synth: {preset}}`
    already are)*.
  - A param's range is `[low, high]` *(chosen: a two-number array)*.
  - `cost` is multiply-adds per sample per voice; the row's table gives osc 4 plus gain 1, so 5 sits within 8.
- **The strip** `engine`: `{track: 0, src: {synth: {preset: "cars.engine@1", params: {hz: "60 + 4 * speed"}, voices: 1,
  seed: 204}}, start: "0s", span: "5.5s"}`, with no `bus`, so it plays into the master (#499). The param's expression is
  text over the closed function list that reads the channel `speed` by its ID *(chosen: the expression's text form)*.

### Planted program

A value of the scenario's `planted` field, as #499's mixer plant and #1163's are, so it applies to both the export's
run and the live runs:

| Name | The wrong program | Must fail, naming |
|---|---|---|
| **`export_synth_block_64`** | the export renders every synth with 64-sample param blocks (each param read once per 64 samples and ramped across 64), while the live transport's synth keeps the 128-sample blocks of the block rule; nothing else changes | the first block: the 128-sample block of the document's sample grid that holds the first sample where the export's PCM differs from the live render's |

At the base the name is unknown, so the run answers `bad_input`.

## Fixtures

Made at test time by `helpers.ts`, truth by construction; nothing personal, the pack CC0.

- **The engine film** (`engineFilm`), sent as the agent sends it (no `layers`, no item `layer`): `profile: "film"`,
  320 × 180, `camera: "cam"`, `transport: {span: "6s", frame_rate: [30, 1], sample_rate: 48000}` (180 frames, 288,000
  samples, 1,600 a frame), `packs: ["acme/cars@1.0.0"]`. Items: `cam` (camera@1, orthographic), `back`, `car`,
  `dial` and `needle` (rect@1). The channel `speed` (`target: items/needle/params/box/0`, f32): 0 at `1.001s`, linear to
  30 at `5.001s`, held before and after, so the car's speed rises from 0 to 30 m/s over 4 s on a straight line and the
  speedometer's needle moves 1 u per m/s. The strip `engine` above.
- **The pack folder**, written into a fresh folder for each run.

## Criteria to tests

| ID | Test (`export.test.ts`) | The wrong program it fails on |
|---|---|---|
| `#204.4e815a43` | **No profile named, against live**: the engine film exported with no `loudness_profile` names `none` on its receipt with `gain` 0; its delivery, decoded, holds each frame's PCM as the receipt hashed it; its PCM over [0, 288,000) hashes equal to `handed`'s over the film's [0, 6 s), whole and frame span by frame span; and the live render is the engine (below) | the base (no synth); any export whose synth render differs from the live one, named by its first block |
| `#204.4e815a43` | **r128 holds**: the engine film exported at `r128` is delivered; its receipt names r128; its receipt's readings, its delivery's readings and the loudness bake of its decoded MP4 each read −23.0 ± 0.2 LUFS, a true peak at most −1 dBTP and a short-term maximum at most −18.0 LUFS; the limiter never cut; and its PCM is the live render's times the receipt's one static gain, 10^(gain ÷ 20), within 1e-6 at every sample | the base; an export that FAILs or leaves its profile; a delivery that isn't the fixture's render at one static gain |
| `#204.4e815a43` | **Planted**: under `export_synth_block_64`, the no-profile export's PCM hash over [0, 288,000) differs from the live render's, and this suite's check fails with a line starting `block <k>: `, k the block holding the first sample that differs | `export_synth_block_64` must fail; a plant that leaves the hash unchanged fails this test |

## Readings where the issue and design leave a choice

- **"Holds its loudness profile and its PCM hash equals the live render's."** A profile with a target puts one static
  gain on the master ahead of its limiter (Loudness and caption profiles), which the live transport never applies, so
  an export held to r128 can hash equal to the live render only if that gain is exactly 0 dB, which no fixture
  arranges. Read as one fixture exported twice in one process: at `r128`, where it holds the profile and its PCM is the
  live render at the receipt's one gain (the limiter idle, so the gain is the only difference), and with no profile
  named, `none`, which "holds no target and applies no gain, and the receipt still carries the readings", where its PCM
  hash equals the live render's. A reading of "its loudness profile" as `none` alone would hold nothing; a reading that
  compares the r128 export's hash with live would fail every right program.
- **"The live render"**: the PCM the film's panel's live transport hands the device gate after your click and Play
  (#499's `handed`; #1163 plays a film in its own panel), the master's output before the gate and the platform's
  conversion. `media_mix` renders offline, as the export does, so it isn't the live render.
- **"Over the same span"**: the film's whole span, [0, 6 s), samples [0, 288,000) at 48 kHz, which the export covers
  frame by frame and `handed` covers from 0.
- **"Its PCM hash"**: SHA-256 over the PCM as interleaved f32le (Export). Read two ways and both required: the receipt's
  per-frame `pcm_hashes` against the live render's frame spans, and the SHA-256 of the decoded delivery over
  [0, 288,000) against `handed.sha256`. The decoded delivery is used only after each of its frame spans hashes to the
  receipt's, so it is the PCM the export hashed.
- **"Naming the first block"**: the synth's param blocks are 128 samples on the document's sample grid (the block rule:
  "the same grid live, after a seek and in export"). A failure names `block <k>` *(chosen)*, k = ⌊n ÷ 128⌋ for the first
  sample n where the export's PCM differs from the live render's, with its samples [128k, 128k + 128) and its time. The
  rule's grid may sit a bus's latency off sample 0; this suite numbers blocks from sample 0 so the name doesn't depend
  on that.
- **"Another block size"**: 64 samples, the plant this job was given.
- **Why the rise starts at 1.001 s.** Inside a block a param moves on a straight line from that block's reading to the
  next block's, so a straight-line rise is reproduced exactly by blocks of any size, and two block sizes differ only
  where a block holds a corner of the speed curve: where the rise starts or ends. With the rise on whole seconds at
  48 kHz (48,000 is 375 blocks), both corners would sit on block boundaries and the plant would change nothing but
  rounding. So the car stands for its first 1.001 s: the corners fall at samples 48,048 and 240,048, 48 samples into a
  128-sample block on the grid from 0, and off that grid also when it is shifted by the master limiter's latency of
  240 samples (5 ms lookahead: `W + 8`) either way. The rise itself is criterion 1's: 0 to 30 m/s over 4 s on a straight
  line, mapped to 60 Hz plus 4 Hz per m/s.
- **The engine, so equality proves something**: on both channels of the live render, RMS above 0.05 and a pitch, by
  rising zero crossings on the left channel, of 60 ± 2 Hz from 0.2 s to 0.95 s (standing) and 180 ± 3 Hz from 5.05 s to
  5.45 s (30 m/s). This is the suite's guard against an export and a live render that are equal because both are
  silent, not a criterion of its own.
- **The r128 export's PCM as the live render at one gain**: at −23 LUFS a sine's true peak sits about 20 dB under the
  limiter's ceiling, so the limiter never cuts and the delivered PCM is the master's times 10^(gain ÷ 20); 1e-6 allows
  the multiply's rounding in f32 and nothing more.
- **The short-term maximum**: the film is 6 s, a programme under 2 minutes, so r128 also holds `max_s` at −18.0 LUFS.

## Not tested

- The other 14 criteria of #204, the sweep's accuracy against its f64 reference (criterion 1), seeks (2, 9), budgets
  (8, 14) and the pack check (4, 10): their own tests.
- AAC deliveries: the MP4s carry PCM, which the decode worker returns as the export hashed it.
- Profiles other than r128 and none.

## At the base

`BASE-FAILURE.txt` holds one run at the base: every test fails because the base has no synth and no
`export_synth_block_64`. The base presents the film with a `pack_missing` notice (it refuses the pack, since no module
reads `presets`: `unknown_field`), its live transport and its export both refuse the strip whose source is a synth
(`bad_media`, `strip engine: src.asset`), and the planted name answers `bad_input`. To check this suite's own machinery
there, one debug run (not committed) swapped the synth strip for an asset strip playing a float WAV of the same sweep,
computed in f64, with no pack: both main tests passed on the base's own mix. A second debug run fed the hash check a
live PCM with one sample changed, and the failure named the block holding it. Both are recorded at the end of
`BASE-FAILURE.txt`.
