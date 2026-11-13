# Acceptance tests for #1818: the compressor, limiter, delay and pitch, bus sends and loudness targets, and the master's true-peak limiter

Written first, from issue #1818 (as of Nov 10, 2026: its Scope, its seven acceptance criteria and its Proof line), its
Oracle page, the design rows and sections it links and those they lean on, and the base commit of this worktree
(`a098f9f9`, "design(1818): the compressor, limiter, delay and pitch laws, sends, latency and the master's limiter in
the Bus and Processor rows"), by a job that never saw an implementation; none existed, and no other worktree, branch
or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding).

What was read:

- The issue (`gh issue view 1818`).
- The Oracle page (`doneright/oracles/issues/1818.md` in DeepBuildAI/deepbuild, branch `doneright`): no upstream test
  checks any of the seven criteria; each is ours, proven by our own fixture and its planted wrong twin.
- `docs/canvas-primitives.md` at `a098f9f9`: Bus (sends tap after the processors and before gain, pan and mute, or
  after them; each bus delays its inputs to the latest of their latencies and the master's latency is taken back by
  rendering ahead; the master ends in a true-peak limiter at the limiter's defaults; `loudness_target` reads as
  written and missing on a bus without one, never 0), Processor (the fields and defaults, and the compressor,
  limiter, delay and pitch laws written into the row by that commit), Processor: shaper, crush and modulate, Strip and
  track, and Synth (a synth plays through the master's limiter).
- `docs/technical-design.md`: Bus, processor and emitter; Spawn and analysis bake; Narration, captions and profiles
  (true peak at −1 dBTP); Dogfooding.
- At the base: AGENTS.md; `crates/deep-canvas-media/src/mix.rs` (strips, buses, the `Player`, seek and checkpoints,
  processor reports, `Planted`), `lib.rs` (`PLANTED`), `analysis/loudness.rs` (the bake's true-peak interpolator);
  `crates/deep-show/src/mixdown.rs` (`media_mix` and its reply), `bake.rs` (`media_bake`), `query.rs` and `main.rs`
  (deep_query and the scenario's `planted`); `crates/deep-canvas/src/document/mod.rs` (`buses` and `processors` are
  top-level document keys); `tests/acceptance/499/mix/` and `tests/acceptance/500/bake/` (form, helpers, plants
  named in the scenario), `tests/acceptance/411/helpers.ts` (deep_query's world).

What the base already does and these tests don't credit: #499's `media_mix` mixes strips into buses with gain, pan and
mute, runs eq and reverb, checkpoints them and hashes each processor's output per segment; #500's `media_bake` reads a
true peak at 4× and 8×; deep_query reads `items/<id>/…` paths. There is no compressor, limiter, delay or pitch, no
send, no latency compensation, no master limiter, and no deep_query path into `buses`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npm run build --workspaces      # once in a fresh worktree: vitest.config.ts loads workspace packages
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run tests/acceptance/1818 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1818/tsconfig.json   # type-check
```

Each file builds `deep-show` once (`cargo build --locked --bin deep-show`, honoring `CARGO_TARGET_DIR`), copies it into
a temporary folder and fails its test when the build fails. Evidence folders are deleted after each test. Node
built-ins, vitest and #499's mix helpers (JSON readers, `pcmOf`, `putAsset`) only; no process but `cargo` and
`deep-show`, none stopped by name or port; no network. **This folder must run alone**: `scripts/lanes.mjs` needs
`'tests/acceptance/1818/'` in its `alone` list (each file builds a cargo binary); the implementer makes that edit.
Every test is deterministic: every signal is written by the test (float WAVs, seeded noise).

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it.

## The surface under test

`deep-show run` (#393's convention): one scenario line on stdin, `{"evidence", "planted"?, "calls": [...]}`, one answer
line `{"ok": true, "replies": [...]}`. Names the design gives are used as it gives them; names it doesn't are marked
*(chosen)*.

### `media_mix` (#499) on a media document

`{"call": "media_mix", "doc": Doc, "segments": [{"from": flicks, "to": flicks, "write"?: true}]}` →
`{"mix": {"sample_rate": 48000, "segments": [{"first", "frames", "channels", "sha256", "wav"?, "taps": {id: sha256}}],
"processors": {id: {"kind", …}}}}`, as #499 built it. One transport plays the segments in order; a segment whose
`from` isn't where the one before ended is a seek. `sha256` hashes the master's interleaved f32le PCM over the segment,
`taps.<id>` each processor's output over it, and `write: true` stores that PCM as a float WAV whose hash is `wav`. This
suite reads `sample_rate`, each segment's `first`, `frames`, `channels`, `sha256`, `wav` (when written) and `taps`, and
each processor's `kind`; nothing else.

`Doc` is #499's media document:

```json
{
  "transport": {"sample_rate": 48000},
  "strips": {"<id>": {"track": 0, "src": {"asset": "<sha256>"}, "start": 0, "in": 0, "bus": "<bus>", "gain"?: dB}},
  "buses": {"<id>": {"gain"?: dB, "pan"?: -1..1, "mute"?: bool, "processors"?: ["<processor id>"],
                     "sends"?: [{"to": "<bus>", "gain": dB, "tap": "pre" | "post"}],
                     "out"?: "<bus>", "loudness_target"?: LUFS}},
  "processors": {"<id>": {"kind": "compressor" | "limiter" | "delay" | "pitch", …the row's fields}}
}
```

The processors' fields are the Processor row's, with the row's names and units, siblings of `kind` as #499 writes
eq's and reverb's: `compressor {threshold, knee, ratio, attack, release, makeup: dB | "auto", key}`, `limiter
{ceiling, lookahead: s, release: s, oversample: 4 | 8}`, `delay {time: s, feedback, mix}`, `pitch {semitones, window:
s}`. A field left out takes the row's default. A strip's `out` is left out, so it plays its asset to the end and
neither end fades. A doc whose `buses` doesn't name `master` gets #499's implied master. Each processor's report
`kind` is its kind's name (`"compressor"`, `"limiter"`, `"delay"`, `"pitch"`).

### `media_bake` (#500)

`{"call": "media_bake", "bake": {"asset": "<the written WAV>", "kind": "loudness", "tp_oversample": 4}}` →
`{"bake": {"asset", "true_peak": dBTP, …}}`. AC1 reads `true_peak` of the master's written output; no plant applies to
the bake.

### deep_query (#411) on a path into `buses`

The scenario holds #411's world: one agent session (`sess-alpha`, inside the process table given), a panel `main`, and
a minted document `01JC41D0000000000000001818` stored as a release stores it (`docs[…].document`, #96). The call is
`{"call": "deep_query", "session": "sess-alpha", "doc": "<id>", "paths": ["buses/<bus>/loudness_target", …]}` →
`{"values": {"<path>": [value at t = 0]}, …}`.

### Surface this suite needs

No new call and no new reply field: the master's samples come from `media_mix`'s existing `write: true` WAV, true peak
from the existing `media_bake`. What the implementation adds:

- `media_mix` builds `compressor`, `limiter`, `delay` and `pitch` processors from the fields above, reports each with
  its `kind` and hashes its output in `taps` as it does eq's and reverb's.
- `media_mix` reads a bus's `sends` (`to`, `gain`, `tap`), compensates latency across parallel paths and ends the
  master in its true-peak limiter.
- deep_query reads a path `buses/<bus id>/<field>` *(chosen: the path's form, after `items/<id>/<field>`)* into the
  document's `buses` map: the field's value as written at each time asked, and `null` (a path the revision doesn't
  hold, as deep_query already reads one) for a bus without the field.
- The seven planted names below, accepted in the scenario's `planted`.

### Planted programs

Each is a wrong program named in the scenario's `planted`, as #499's and #500's are; the implementation builds them.

| Name | The wrong program | Test | Must fail naming |
|---|---|---|---|
| `limiter_holds_sample_peaks` | the master's limiter measures each sample's peak only, no interpolated points | AC1 | the bus `master` |
| `compressor_hard_knee` | the compressor's static curve has no knee (W = 0) | AC2 | the level −24 dBFS |
| `mix_without_latency_compensation` | no bus delays its inputs to their latest latency | AC3 | the bus `group` |
| `pitch_ignores_semitones` | the pitch processor's taps don't slide (as at 0 semitones) | AC4 | the processor `octave` |
| `send_always_post` | every send taps after its bus's gain, pan and mute | AC5 | the send `buses.voice.sends[0]` |
| `delay_empties_line_at_seek` | the delay's restored checkpoint has an empty line | AC6 | the processor `echo` |
| `loudness_target_defaults_to_zero` | deep_query reads a missing `loudness_target` as 0 | AC7 | the bus `effects` |

## Criteria to tests

| ID | Criterion | Test, and the wrong program it fails on |
|---|---|---|
| AC1 #1818.0808feff | "A sine at a quarter of the sample rate and 45° of phase, driven 6 dB over full scale into the master, reads a true peak of at most −1.0 dBTP at 4× oversampling on the master's output; a planted limiter that holds sample peaks only reads above −1 dBTP true peak and fails, naming the bus" | `master.test.ts`: a full-scale 12 kHz tone at 45° (true peak 0 dBTP, samples at ±√2/2), strip gain +6 dB, on the master from 0.1 to 1.1 s; the master's output over 0 to 1.5 s baked at 4× reads at most −1.0 dBTP, and above −2 dBTP so silence can't pass. Fails on: `limiter_holds_sample_peaks`, reading about +2 dBTP, naming `master` |
| AC2 #1818.942b9d68 | "The compressor's static curve at the Processor row's defaults matches the law this task writes into the row within 0.1 dB at 10 input levels from −60 to 0 dBFS; a planted compressor with a hard knee differs at the knee's middle and fails, naming the level" | `compressor.test.ts`: a full-scale 1 kHz sine with strip gain −60, −52, −44, −36, −30, −24, −18, −12, −6 and 0 dB, one mix each, into a compressor with no fields set; the output's level over 0.3 to 0.5 s is the law's within 0.1 dB. Fails on: `compressor_hard_knee`, off most at −24 dBFS (−24 against −27.4375), naming that level |
| AC3 #1818.c9ace535 | "Two parallel paths into one bus, one through a limiter with 5 ms lookahead, stay aligned within one sample at 48 kHz; a planted mix without latency compensation is 240 samples late and fails, naming the bus" | `latency.test.ts`: a click at 0.5 s on the left channel into bus `dry` and on the right into bus `limited` (limiter `look`, lookahead 0.005), both out to `group`; the two clicks land in the master within one sample. Fails on: `mix_without_latency_compensation`, the limited click 240 ±1 samples late, naming `group` |
| AC4 #1818.405eb9c0 | "A delay of 0.25 s with feedback 0.5 and mix 1 gives echoes 0.25 s apart, each 6.02 dB below the last within 0.05 dB, and a pitch processor at +12 semitones moves a 440 Hz sine's measured fundamental to 880 Hz within 1 Hz; a planted pitch that ignores its semitones fails, naming the processor" | `delay-pitch.test.ts`: a click through `echo` (delay 0.25, feedback 0.5, mix 1): six echoes, each 12,000 ±1 samples after the last and 6.02 ±0.05 dB under it; a 440 Hz sine through `octave` (pitch +12): fundamental 880 ±1 Hz. Fails on: `pitch_ignores_semitones`, measuring 440 Hz, naming `octave` |
| AC5 #1818.45b936e3 | "A send tapped pre and one tapped post a 6 dB gain cut on their bus carry the levels their tap gives, within 0.05 dB; a planted send that always taps post fails, naming the send" | `sends.test.ts`: bus `voice` at −6 dB with a pre send to `pre_fx` and a post send to `post_fx`, its own output muted downstream; heard one send at a time, the pre send carries 0 dB and the post send −6 dB of the bus's input, within 0.05 dB. Fails on: `send_always_post`, the pre send at −6 dB, naming `buses.voice.sends[0]` |
| AC6 #1818.3fad1c82 | "With compressor, limiter, delay and pitch in one chain, a seek to 9 s then play to 10 s equals playing straight bit for bit by PCM hash on one build and architecture; a planted delay that empties its line at the seek fails, naming the processor" | `seek.test.ts`: 10 s of stereo noise through `comp` (auto makeup), `lim`, `echo` (0.3 s, 0.6, 0.5) and `shift` (+7); segments 0–9 s, 9–10 s, then a seek to 9 s and 9–10 s; the two 9–10 s segments have equal master hashes and equal taps for every processor, each processor reported with its kind, the output not silent. Fails on: `delay_empties_line_at_seek`, `echo` the first processor whose tap differs |
| AC7 #1818.454109d9 | "deep_query reads each bus's `loudness_target` as written, and reads it missing, never 0, on a bus without one; a planted reader that defaults it to 0 fails, naming the bus" | `loudness-target.test.ts`: buses `dialog` (−16), `music` (−23.5), `effects` (none), `master` (−14); `buses/<id>/loudness_target` reads −16, −23.5, null and −14. Fails on: `loudness_target_defaults_to_zero`, `effects` reading 0, naming `effects` |

## Readings

- **A level** (AC2): a steady sine's amplitude from its mean power over the window, both channels, 10·log10(2 · mean
  x²) dBFS, so a full-scale sine reads 0 as the law's level does. **A send's level** (AC5): the master's mean power
  over 0.25 to 0.75 s against the source's over the same samples, in dB.
- **The true peak** (AC1): `media_bake`'s `true_peak` of the master's written WAV at `tp_oversample: 4` (#500's meter,
  held to EBU Tech 3341 by #500's suite).
- **Alignment** (AC3): the loudest sample's index on each channel of the master's output.
- **An echo** (AC4): the loudest sample within 0.125 s of where echo k should be (0.1 s + k × 0.25 s), and its energy
  over both channels within 48 samples either side; consecutive echoes' gap in samples and energy ratio in dB.
- **The measured fundamental** (AC4): the largest peak of the Hann-windowed spectrum of the left channel over 0.5 to
  1.5 s, between 50 Hz and 4 kHz, found every 5 Hz on its first 0.1 s, then every 0.5 Hz and every 0.01 Hz on the
  whole second.
- **Seek equals play** (AC6): equal `sha256` and equal `taps.<id>` for every processor between the played and the
  seeked 9–10 s segments.

## How the issue and design were read where they leave room

- **"Driven 6 dB over full scale"** (AC1): a full-scale tone (true peak 0 dBTP) with +6 dB of strip gain, so the tone's
  true peak is +6 dBTP and its samples +3 dBFS. "The master's output" is all of it, the tone's start and stop
  included, since a true-peak limiter with lookahead must hold those too. Simulating the row's limiter law with the
  bake's interpolator on this signal reads −1.05 dBTP at 4× (the plant about +2.1), so the criterion's −1.0 holds with
  the law's 0.05 dB margin. The "above −2 dBTP" bound is this suite's guard against a silent master, not a criterion.
- **The ten levels** (AC2): "from −60 to 0 dBFS" isn't spaced evenly, so that the knee's middle (T = −24) is one of
  them and every part of the curve has a level: three under the knee, five in it, two over it. The input level is the
  sine's peak level, set by strip gain on a full-scale float sine; the law's L is the detector's level, which for a
  steady sine is its peak level (simulating the row's detector on these sines puts every level within 0.003 dB of the
  law). "Naming the level" is read as: a failure names −24 dBFS, and −24 is where the hard knee is off most; it is
  also off at −30 and −18 (1.24 dB) and at −36 and −12 (0.14 dB).
- **"Aligned"** (AC3): the two paths carry the same click at the same time on different channels, so each path is read
  on its own channel with no dependence on a pan law; "240 samples late" is the limited path's click minus the dry
  one's, ±1. 240 is 5 ms at 48 kHz and the written law's latency W + 8 with W = 240 − 8.
- **The echoes** (AC4): "0.25 s apart" between consecutive echoes, within one sample (the delay's T is a whole 12,000
  samples); six echoes, five gaps. "6.02 dB below the last" by energy, so an echo spread over a few samples still reads
  its level. **The fundamental** (AC4): the spectrum's largest peak; at the row's default window of 0.1 s a 440 Hz
  sine is 44 whole cycles, so the written pitch law gives exactly 880 Hz (simulated: 880.000; at 0 semitones 440.000).
- **"The levels their tap gives"** (AC5): pre is the bus's input level (0 dB, ahead of the −6 dB gain), post is −6 dB.
  Each send is heard alone, the other send's destination muted and the bus's own output sent to a muted bus, so no
  reading is a sum. Sends have no IDs, so a send is named by its place, `buses.voice.sends[0]`, with its `to` and
  `tap`.
- **The seek** (AC6): "a seek to 9 s then play to 10 s" is a seek in the same transport after playing to 10 s, as #499's
  AC2 does, so the processors' checkpoints exist at the seek; a fresh transport would render 9 s from the start and a
  delay emptied at the seek would not show. The chain's order and its non-default fields are this suite's.
- **"Missing"** (AC7): deep_query's value at the time asked is null, as it reads any path the revision doesn't hold;
  whether the reply also lists the path under `unresolved` isn't judged. The master is one of the buses, with its own
  written target.
