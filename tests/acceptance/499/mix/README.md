# Acceptance tests for #499, part "mix": seek-equals-play on a reverb, checkpoint rings, loop and edit fades, the live mix, and emitters

Written first, from issue #499 (as of Nov 8, 2026: its Scope, its Transport, Strip and track, Bus, Processor and Emitter
fields, acceptance criteria 2, 4, 6, 9, 15 and 16, and its Proof line), its oracle map, the design sections it links
and those they lean on, and the base commit of this worktree (`42319109`, a descendant of `f1e8736e`), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). The issue's other criteria (the clock, video frames,
the module and its seal) belong to other parts of #499's suite.

What was read:

- The issue: Scope ("Processors declare their tail and latency and checkpoint their state on a grid whose spacing
  doubles when the ring passes its byte budget, so seeking matches playing on recursive effects"; "a looping strip
  repeats its source's loop region until its span ends, and a strip that starts or stops inside its source fades over
  at least 5 ms on an equal-power curve, declared or not"; "The live mix is the export's: the PCM the live transport
  hands the device gate equals the export's PCM on the same build, ramps, disabled spans and channel layouts included";
  "Every Emitter distance model and the cone are held to their formulas, not only the inverse model"), its Fields
  (Transport, Strip and track, Bus, Processor, Emitter), criteria 2, 4, 6, 9, 15, 16, and its Proof line ("Seek-equals-play
  on a recursive reverb").
- The oracle map (`doneright/oracles/issues/499.md` in DeepBuildAI/deepbuild, branch `doneright`): criterion 4's
  upstream test is WPT `webaudio/.../audiobuffersource-duration-loop.html` at `2f57f45d21` ("not copied": a looped
  source given a duration loops until the duration ends, then silence; the 5 ms fade is ours); criteria 2, 6, 9, 15
  and 16 have none.
- `docs/technical-design.md`: The media module (1909), Media asset (1913), Strip and track (1921: "a strip that starts
  or stops inside its source fades over at least 5 ms, so no edit clicks"), Bus, processor and emitter (1929: "Each
  processor declares its tail and latency; the tail is pre-rolled on a seek"; Emitter "heard from the camera"; Synth's
  checkpoint grid, "until the ring passes its budget and the spacing doubles"), Device gate, capture and export (1969:
  "media's sound reaches the speakers only through the gate"; "frames and audio are rendered offline"), Dogfooding
  (2623), Tests written first (2654).
- `docs/canvas-primitives.md`: Time and the flick (9: flicks, valid rates, "Which clock leads"), Carried state (1184:
  `byte_budget`, `restore: nearest_checkpoint | preroll_tail`, "Seeking restores the nearest checkpoint or pre-rolls the
  tail and steps forward, so seeking equals playing"), Transport (5142: `span`, `sample_rate`), Channel and key (5312:
  keys with `t`, `value`, `interp`), Checkpoint ring (6390: "when the ring passes its budget, the spacing doubles. A
  seek restores the nearest checkpoint at or before t"; "It can never: Exceed its byte budget"), Sound and video on the
  picture's clock (7101: "Output is identical for the same build and CPU architecture"; Blocks: 128-sample blocks on one
  grid from sample 0, "gain is a-rate", "checkpoints fall on the first block boundary at or after each whole second"),
  Strip and track (7312: Semantics, "audio starts mid-block at the exact sample, with gain evaluated per sample", "A
  looping strip plays its source to the end of its loop region (the asset's loop points, or its whole length), then
  repeats the region until its span ends, where its fade_out ends"), Bus (7355), Processor (7373: `reverb {ir: asset |
  {decay: s, size, damping}, mix}`, `checkpoint_every: s = 1`, "seek equals play bit for bit on the same build and
  architecture"), Synth (7414, for the checkpoint grid's wording), Emitter (7433: "gain = distance gain × cone gain,
  using the W3C Web Audio formulas with the cone's sign fixed as listener minus source"), Device gate (7564), Export
  (7624: "PCM as interleaved f32le", `sha256` over PCM, the receipt's `pcm_hashes`, "tails pre-rolled").
- At the base: AGENTS.md; `tests/acceptance/498/gate/` and `498/decode/` (their READMEs, helpers, `deep-show run`'s
  `open`, `play`, `gate`, `output` calls, planted programs, `BASE-FAILURE.txt`), `531/` (seek-equals-play by restored
  checkpoints), `138/`, `185/`, `493/`, `1487/` (READMEs, for conventions); `crates/deep-show/src/main.rs` (the call
  parser), `gate.rs` (#498's gate: strips as `(track, asset, start, in, out, loop)`, a 48 kHz device clock from flick 0,
  a stop fade inside one block), `media.rs` (#498's `media_*` calls).

What the base already does and these tests don't credit: #498's device gate in `deep-show run` (`open` with `strips`,
`play` granted by your click's serial, `gate`, `output` as a WAV of the device's samples, `reserved`) plays a
document's strips as plain looped or unlooped sample copies on a 48 kHz device clock; #498's `media_*` calls probe and
decode in the decode worker. There is no media document (strip IDs, rate, gain keys, `enabled`, `span`, buses,
processors, emitters, a scene), no mixer, no processor, no checkpoint ring, no emitter, no `media_mix` and no `handed`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/499/mix --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/499/mix/tsconfig.json   # type-check
```

Each file first builds `deep-show` once with `cargo build --locked --bin deep-show`, copies it out of `target/debug`
into a temporary folder, and fails each of its tests when the build fails. Every world gets its own evidence folder,
deleted after the test. The tests use node built-ins and vitest only; they start no process but `cargo` and
`deep-show` (each waited for, none stopped by name or port) and make no network call. A run with `--root` may leave
Vitest's cache in `tests/acceptance/499/mix/node_modules/.vite`; delete it. **This folder must run alone**:
`scripts/lanes.mjs` needs `tests/acceptance/499/mix/` in its one-at-a-time list (`alone`) beside `498/`'s folders,
since each file builds a cargo binary and AC6 renders 30 minutes of audio; this README is the instruction, and the
implementer makes that edit.

Runtimes: AC6 renders 10 minutes of reverb three times (a clean run, a planted run whose seek renders 9 minutes again,
and a short probe), offline on the virtual clock, so it takes as long as the debug build's reverb takes; its timeout
is 2 hours and each `deep-show run` 30 minutes. The rest render at most 21 s of audio a run.

Platform needs: none beyond a Rust toolchain. Everything runs offline on the virtual clock, in one process per run,
so "the same build and architecture" holds by construction: a seek is compared with the play it repeats inside the
same `deep-show run`. No device, no wall time, no network, no person.

What is deterministic: every test. Assets are written by the tests from fixed seeds (16-bit PCM WAVs at 48 kHz), the
seek times are seeded (mulberry32, seed 499,016), and all judgements are by hash or sample against fixed formulas.
None is `BLOCKED` or `INCONCLUSIVE`: no criterion here depends on a platform part or on load.

`BASE-FAILURE.txt`: the surfaces don't exist at the base, so the suite was not built or run there; it lists what's
missing, which makes every test fail.

Nothing missing passes (invariant 2): a reply without a field a test reads fails the test naming the field (`null` is
a value, absence isn't); a run that answers `bad_input`, exits non-zero or writes other than one line fails every test
that drove it; a WAV that isn't in the evidence store, doesn't hash to its name, isn't float, or whose samples don't
hash to the reply's `sha256` fails.

## The surface under test

The issue names strips, tracks, buses, processors, emitters, the transport, the device gate and the export, but no code
API. So these tests extend the binary that already plays #498's gate and decode worker for tests, `deep-show run`
(#393, #498), with the smallest set of fields and calls they need, in its own style. No new binary. #393's
conventions hold: one JSON scenario per stdin line, one JSON object out, exit 0; a line that isn't JSON, lacks a
required field, or names an unknown call, field value or `planted` value answers `{"ok": false, "code": "bad_input"}`;
a scenario that runs answers `{"ok": true, "replies": [Reply]}`, one per call, in order. Times are flicks (705,600,000 a
second; a 48 kHz sample is 14,700). Rationals are `[num, den]`.

### The media document

The document `media_mix` renders and `open` opens, in the design's field names. Assets are WAVs the tests wrote into
the run's evidence store, named by SHA-256 (as #498's `open`).

```json
{"transport"?: {"sample_rate"?: 48000, "span"?: flicks},
 "strips": {strip ID: Strip},
 "buses"?: {bus ID: {"processors"?: [processor ID], "out"?: bus ID | "master", "layout"?: "stereo" | "mono", "gain"?: dB, "pan"?: −1..1}},
 "processors"?: {processor ID: Processor},
 "emitters"?: {emitter ID: {"item": item ID, "src": {"strip": strip ID}, "distance"?: {"model", "ref"?, "max"?, "rolloff"?}, "cone"?: {"inner", "outer", "outer_gain"}}},
 "scene"?: {"camera": {"position": [x, y, z], "forward": [x, y, z]}, "items": {item ID: {"position": [x, y, z], "yaw"?: deg | Channel}}}}
```

- **Strip**: `{"track", "src": {"asset": sha256}, "start", "in", "out", "rate"?: [p, q], "gain"?: dB | Channel, "pan"?,
  "loop"?: bool, "span"?: flicks, "bus"?: bus ID, "enabled"?: bool | Channel}`, with Strip and track's semantics:
  active over [start, start + span), span auto = (out − in) ÷ rate, or to the transport's end for a looping strip;
  source time in + (t − start) × rate; a strip with no `bus` plays into `master`; the 5 ms equal-power fade where a
  strip starts or stops inside its source, declared or not. A strip that is an emitter's `src` is heard only through
  that emitter.
- **Channel**: `{"keys": [{"t": flicks, "value", "interp"?: "linear" | "hold"}]}` (Channel and key: the left key owns
  its segment; held before the first key and after the last). A gain key's `value` is dB, or the string `"-inf"` for
  −∞ dB. `enabled` takes bool keys (hold only). `yaw` takes degrees.
- **Processor**: `{"kind": "eq", "bands": [{"type", "freq", "q", "gain"}]}` or `{"kind": "reverb", "ir": {"decay": s,
  "size", "damping"}, "mix"}` (Processor's kinds as JSON), plus `"checkpoint_every"?: s` (default 1) and
  `"byte_budget"?: bytes` (Carried state's `byte_budget`; the tests force it for AC6). The reverb with `ir: {decay,
  size, damping}` is the recursive (feedback) one.
- **Emitter**: Emitter's fields and the W3C Web Audio formulas (README: Readings). The listener is the camera.
- **Scene items**: a position in metres and a yaw in degrees about +y; at yaw 0 an item faces +z, so its orientation is
  (sin yaw, 0, cos yaw). The tests put the camera at the origin facing −z and every source straight ahead of it on −z,
  so at yaw 0 a source faces the listener.

### Calls and replies

- **`{"call": "media_mix", "doc": Doc, "segments": [{"from": flicks, "to": flicks, "write"?: true}]}`** (new; no `at`,
  as #498's decode calls) → `{"mix": Mix}`. The export's sound (Export: rendered offline on the virtual clock, tails
  pre-rolled, each span its exact samples) as one transport that renders its segments in order: the first from
  `from` (0 is the transport's start), each next one continuing where the one before ended when its `from` is that
  `to`, and otherwise **seeking** to `from` as the transport does (restore the nearest checkpoint at or before it,
  render forward), in the same process.

  ```json
  Mix: {"sample_rate": 48000, "channels": n,
        "segments": [{"from", "to", "first": sample, "frames": n, "channels": n, "sha256": hex, "wav"?: hex,
                      "taps": {processor ID: hex},
                      "seek": null | {processor ID: {"restored": flicks | null, "rendered_from": flicks}}}],
        "processors": {processor ID: {"kind", "tail": flicks, "latency": samples,
                       "ring": {"budget": bytes, "bytes": bytes, "peak_bytes": bytes, "spacing": flicks,
                                "checkpoints": [{"t": flicks, "bytes": n}]}}}}
  ```

  - A segment's samples are [⌈from × 48,000 ÷ 705,600,000⌉, ⌈to × …⌉) of the document's time (`first`, `frames`), the
    master's output, latency compensated so sample n is the document's sample n. `sha256` is over them as
    interleaved f32le (Export's PCM hash). With `write: true`, `wav` is the SHA-256 of an IEEE float 32-bit WAV of the
    same samples written into the evidence store.
  - `taps`: each processor's own output over the segment, hashed the same way.
  - `seek`: `null` for a segment that continues (or the first); for a seek, per processor, the time of the checkpoint
    it restored (`null` when none: it rendered from the transport's start) and the time it rendered forward from.
  - `processors`: each processor's derived `tail` and `latency`, and its checkpoint ring at the end of the run: its
    byte budget, the bytes it holds, the most it ever held, its current spacing and its checkpoints with their bytes.
- **`open` with `media`** (extends #498's): `{"call": "open", "at", "panel", "doc": doc ID, "media": Doc}` opens a
  media document in place of `strips`; the reply is #498's (`{"opened": true}` or a refusal).
- **`play`**, **`input`** (#498's, unchanged): your click in the panel gives a serial; Play with it grants the gate and
  the transport plays the document from its time 0.
- **`{"call": "handed", "at", "panel", "from": flicks, "to": flicks}`** (new) → `{"handed": {"sample_rate", "channels",
  "first", "frames", "sha256", "wav"}}`: the PCM the panel's live transport handed the device gate (the master's
  output, before the gate and the platform's conversion) for the document's time [from, to), played by `at`; samples,
  hash and WAV as a `media_mix` segment's (the WAV always written).

### Planted programs

Each reachable only through `planted`, only to prove a test fails on a wrong program; every test runs its own and
asserts that it fails, naming what the criterion says it names.

| Name | The wrong program | Test |
|---|---|---|
| `reverb_restores_without_tail` | on a seek the reverb restores its checkpoint with its delay lines (its tail) emptied | AC2 |
| `ring_drops_oldest` | a checkpoint ring past its byte budget drops its oldest checkpoint instead of doubling its spacing | AC6 |
| `mixer_holds_gain_per_block` | **the live transport's** mixer holds each strip's gain for a 128-sample block at the block's first sample's value; the export's render is unchanged (so live and export differ) | AC9 |
| `emitter_always_inverse` | every emitter uses the inverse distance model, whatever its `model` | AC15 |
| `cone_sign_reversed` | the cone's angle is taken against source minus listener | AC16 |

## Criteria to tests

| ID | Criterion | Test, and the wrong program it fails on |
|---|---|---|
| AC2 | Seeking into a recursive reverb matches playing bit for bit by PCM hash; planted reverb restoring its checkpoint without its tail fails naming the processor | `seek.test.ts`: an 8 s noise bed into bus `room` (lowpass EQ `tone`, then reverb `verb` {decay 3, size 0.8, damping 0.3, mix 0.5}); `media_mix` plays [0, 7.3 s), [7.3 s, 12 s), then seeks to 7.3 s (mid-block) and plays to 12 s. The tail still rings at 8.5–9 s; the seek restores a checkpoint each processor's ring holds, at or before 7.3 s and within 1 s, renders from it, and gives the play's taps, PCM hash and samples. Fails on: `reverb_restores_without_tail`, first differing at the first sample after the seek (sample 350,400), naming `verb` (the first processor whose tap differs; `tone`'s stays equal) |
| AC4 | Looping strip, 20 s span over 6 s loop region, 5 ms equal-power fade of 240 samples within 1e-6; mid-sine end; end at source's own end adds no fade | `loop.test.ts`: three documents, one strip each on the master, no fade declared: `bed`, a 6 s 440 Hz asset looping with span 20 s (21 s rendered); `cut`, a 4 s asset whose span ends at sample 120,027 (near a crest); `whole`, an asset 120,027 samples long ending at its own end. Each sample is the asset's (repeating every 288,000 for `bed`) times a per-channel constant fitted on 0.5–0.6 s, within 1e-6; the last 240 samples of `bed` and `cut` also times cos(π/2 · i/240), i = 0…239, and `whole`'s not; after the span, within 1e-6 of 0. No plant: the criterion names none; the three cases are each other's controls (always fading fails `whole`, never fading fails `bed` and `cut`) |
| AC6 | Reverb 10 minutes, budget forced to 20 checkpoints' bytes, checkpoints 32 s apart, seek to 9 min renders at most 32 s forward; planted ring dropping its oldest fails naming the processor | `seek.test.ts`: a short play reads one `verb` checkpoint's bytes; with `byte_budget` 20 times that, a looping noise bed plays [0, 540 s), [540, 545 s), [545, 600 s), then seeks to 540 s and plays to 545 s. `verb`'s ring: budget as forced, `bytes`, `peak_bytes` and its checkpoints' sum within it, `spacing` 32 s, checkpoints every 32 s up to 576 s; the seek restores one of them and renders at most 32 s forward (from 512 s), and its taps, hash and samples are the play's. Fails on: `ring_drops_oldest`, whose seek renders from 0 s, failing "processor `verb`: the seek to 540 s rendered 540 s forward" |
| AC9 | Live transport PCM to the device gate equals export PCM over 10 s (gain key −∞→0 dB, retimed strip with `enabled` false over part, mono asset on stereo bus); planted mixer holding gain per block fails naming the strip | `live.test.ts`: `rise` (stereo, from 1 s + 50 samples, gain keyed −∞ → 0 dB over 1 s), `retimed` (stereo noise at rate 3/2 from 4.5 s, `enabled` false over [5.5 s, 6 s)), `mono` (a mono asset from 7.5 s on bus `wide`, layout stereo), disjoint in time. Opened in a panel, Play pressed with your click's serial; `handed` over [0, 10 s) equals `media_mix`'s [0, 10 s) by hash and sample, each strip audible. Fails on: `mixer_holds_gain_per_block`, first differing inside block 375 ([48,000, 48,128), the ramp's first), naming `rise` (the strip whose stretch holds that sample) |
| AC15 | Emitter distance models linear and exponential held to their formulas within 0.05 dB; planted always-inverse emitter fails both naming the emitter | `emitter.test.ts`: a 1 kHz tone per emitter, each alone for 1 s: the reference at 1 m, `lin_5m5` (linear {1, 10, 1}) at 5.5 m → 0.5, `lin_12m` at 12 m → 0 (silence), `exp_4m` (exponential {1, 1}) at 4 m → 0.25, each by RMS against the reference within 0.05 dB. Fails on: `emitter_always_inverse`, naming `lin_5m5` (1/5.5) and `lin_12m` (1/12) |
| AC16 | Cone {inner 60, outer 120, outer_gain 0.25} by the W3C cone formula; seek-equals-play in a cone sweep; planted reversed-sign cone fails | `emitter.test.ts`: sources at 1 m turned 0°, 45°, 90°, 180° from the listener play at 1, 0.625, 0.25, 0.25 within 0.05 dB against the reference; a 10 s sweep of yaw 0° → 360° is played straight through and then seeked to 10 seeded 50 ms windows (mid-block, seeded order), each hashing equal to the play's. Fails on: `cone_sign_reversed`, which plays 0.25 facing the listener, naming `yaw_0` |

## Readings where the issue and design leave a choice

- **"From its checkpoints"** is read from the reply: the seek's `restored` must be a checkpoint the processor's ring
  reports, at or before the seek, no further back than one spacing, and the render must start there. "Renders at most
  32 s forward" is the seek target minus `rendered_from`. The PCM must still equal playing by hash, so a report that
  lies about the checkpoint can't make a wrong render pass.
- **"Naming the processor"**: each processor's output is hashed per segment (`taps`), and the failure names the first
  processor in its bus's order whose output after the seek differs from playing. A lowpass sits before the reverb so
  the name is a choice, not the only processor.
- **"Differs from the first sample after the seek"**: the first differing master sample is the first sample at or
  after the seek. The seek is at 7.3 s, half a block in; the reverb's 3 s decay keeps its tail well above silence there.
- **"20 checkpoints' bytes"**: 20 times the largest checkpoint the same reverb's ring holds on a 5 s play with the
  default budget. With a 1 s grid doubling past the budget, 10 minutes ends at 32 s spacing (16 s would need 38
  checkpoints), and the ring's checkpoints are every 32 s on that grid up to 576 s (one at 0 s is the ring's choice).
  "Within that budget" holds for the most it ever held (`peak_bytes`), not only at the end.
- **The equal-power fade's 240 samples** are the span's last 240 samples, [end − 240, end), each at its own time on
  g = cos(π/2 · (n − (end − 240)) / 240): 1 at the fade's first sample, reaching 0 at the span's end ("where its
  fade_out ends"; gain is a-rate, evaluated per sample). The curve is compared on the rendered samples against the
  asset's own samples times a per-channel constant fitted earlier in the same render, so the mono-to-stereo pan law is
  not read. The tolerance, 1e-6, is the criterion's, applied to each sample.
- **"A 6 s loop region"** is the asset's whole length (Strip and track: "the asset's loop points, or its whole
  length"); the tests don't write loop points into a WAV.
- **"Ends at its source's own end"**: `out` is the asset's length and the span is auto, and the source ends mid-sine,
  so a fade there would show.
- **The live mix and the export**: what the live transport hands the gate is the master's output before the gate's own
  limiter and the platform's rate conversion ("outside what is hashed"), so it's read by `handed`, not `output`
  (#498's `output` is the device's samples and may be 16-bit). The planted mixer is the live transport's only:
  "differs" is live against export. "The first ramp block" is the 128-sample block holding the ramp's first sample;
  the ramp starts 50 samples into it, so a held gain is wrong from its first sample. A key from −∞ dB is read as a ramp
  that leaves silence after its first sample; the test doesn't read its curve, only that live equals export and that
  the plant differs in that block.
- **"Naming the strip"**: the three strips sound over disjoint stretches, so the first differing sample names the strip
  whose stretch holds it.
- **"Against the unattenuated source"**: the same strip through an emitter at the reference distance (1 m) with the
  default cone, same direction and pan, so the measured gain is √(P ÷ P_ref) over the middle 0.6 s of each second,
  power summed over both channels. **Gain 0** is read as silence: every sample of that strip's second within 2^−20 of 0
  (0.05 dB of zero gain has no meaning).
- **The W3C formulas** (Web Audio API, PannerNode): linear 1 − rolloff × (clamp(d, ref, max) − ref) ÷ (max − ref);
  exponential (max(d, ref) ÷ ref)^−rolloff; inverse ref ÷ (ref + rolloff × (max(d, ref) − ref)); the cone with the
  angle between the source's orientation and listener − source, half-angles inner ÷ 2 and outer ÷ 2, linear between 1
  and `outer_gain`.
- **"Fails both"** reads as both linear readings. With ref 1 and rolloff 1, the inverse model's 1/d *is* the
  exponential model's d^−1 at every distance, so the always-inverse plant passes the 4 m exponential reading and can't
  fail it; the test requires it to fail at 5.5 m and at 12 m, each naming its emitter. This is a defect in the
  criterion's values, reported, not changed.
- **"10 sampled times in a cone sweep"**: one seeded sample in each 0.9 s bin from 0.5 s, never a block's first, each
  a 50 ms window, seeked to in a seeded order after the straight play; the 10 played windows must hash apart, so the
  sweep is heard changing.

## Not tested, and why

- The other criteria of #499 (1, 3, 5, 7, 8, 10–14, 17): other parts of this suite.
- Sends, `loudness_target`, the compressor, limiter, delay and pitch processors, `tail`'s value against −120 dBFS,
  latency compensation across parallel paths, spawns and analysis bakes: in the issue's fields, but no criterion of
  this part reads them (`tail` and `latency` must be present in the reply).
- A gain key's curve and the `enabled` edges' fades: the criterion holds them only as live equal to export.
- A cross-architecture comparison: the design promises identity only on one build and architecture.

## The Oracle lane

Criterion 4's oracle is WPT's looped-source duration test, used as its rule (the loop plays until the duration ends,
then silence), which `loop.test.ts` holds on our own render; it is not copied, and Web Audio has no end fade. Criteria
2, 6, 9, 15 and 16 have no upstream test; these tests are their local proof, the distance models and the cone held to
the W3C formulas written out in `helpers.ts`.
