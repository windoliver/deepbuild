# Blind redraft of #503's AC4 test: the lossy formats against FFmpeg's decode

AC4, `#503.89909452`: "Each listed audio format decodes in the worker on macOS to PCM hashes equal to the reference
decode for lossless formats and within −90 dBFS of FFmpeg's decode for lossy ones, and a file in an unlisted format is
refused, naming its codec"

This folder holds one test, for the lossy clause only: "Each listed audio format decodes in the worker on macOS to PCM
hashes … within −90 dBFS of FFmpeg's decode for lossy ones". The lossy formats of the issue's list ("our own decoders
read WAV, AIFF, CAF, MP3, AAC-LC and HE-AAC, ALAC, FLAC, Opus (Ogg, WebM) and Vorbis (Ogg)") are MP3, AAC-LC, HE-AAC,
Opus in Ogg and in WebM, and Vorbis in Ogg. The lossless clause and the refusal of an unlisted codec are not here.

Written at base commit `014344430` (main plus the design commit for #503, which adds the Decode worker's sentence on
integer samples and `unsupported_codec`; no #503 code exists there), as a blind redraft of one test by a job that never
saw an implementation, the first draft or the dispute. It had the first draft's inputs: the issue, the design, the base
commit and the criterion. The implementing agent doesn't edit these files (AGENTS.md, Proof; design: Dogfooding).

## What was read

- Issue #503, live (`gh issue view 503`): its Scope line on audio formats, criterion 4, its Proof line ("each listed
  format's decode against the reference") and its Oracle line.
- The Oracle page, `doneright/oracles/issues/503.md` on branch `doneright` of DeepBuildAI/deepbuild: FFmpeg's FATE
  recipes at commit `24e860f6d3c4f2ebae65ed7649e2a8860d512879` for criterion 4, "the FFmpeg decode our lossy formats
  are held to within -90 dBFS". The lossy recipes were read upstream at that commit: `tests/fate/aac.mak` (FFmpeg's
  `aac` decoder, `CMP = oneoff`, `FUZZ = 2`), `mp3.mak` (`-c:a mp3float … -f f32le`, `oneoff`), `opus.mak` (FFmpeg's
  own Opus decoder against RFC 8251's reference decodes, `CMP = stddev`, `CMP_TARGET` up to 191 for the SILK vectors),
  `vorbis.mak` (`oneoff`), `ogg-opus.mak`, `ogg-vorbis.mak` and `matroska.mak`'s Opus lines.
- `docs/canvas-primitives.md`: Decode worker (the `codecs` field; "FLAC and Opus always decode through our own
  decoders, Opus in its fixed-point form, never the platform's, and their integer samples … become f32 as sample ÷
  2^(depth − 1)"; `unsupported_codec`; `out: … PCM f32`), Asset ("decoded … in the worker"), Export: web player:
  compressed sound, Determinism ("the peak per-sample difference … in dBFS").
- `docs/technical-design.md`: The media module, Dogfooding.
- At the base: AGENTS.md; `crates/deep-show/src/media.rs` (`media_decode`, `workers`, the planted `decodes_in_app`),
  `crates/deep-show/src/main.rs` (the scenario's `planted`), `crates/deep-codecs/src/lib.rs` (a decode's audio stream
  and samples file, the refusal shape, the formats the base reads); `tests/acceptance/498/decode/` (README, helpers) and
  `tests/acceptance/501/helpers.ts`, reused by import; `scripts/proof-change.mjs` (criterion IDs),
  `scripts/public-text.mjs`. FFmpeg's own option help (`ffmpeg -h encoder=…`, `-h decoder=…`) for the local 9.0.2.

## Run it

```sh
npm ci                                                                 # once, if node_modules is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/503-redraft-ac4
node node_modules/typescript/bin/tsc -p tests/acceptance/503-redraft-ac4/tsconfig.json   # type-check
```

The file builds `deep-show` once in `beforeAll` (#501's `useShow`: `cargo build --locked --bin deep-show
--no-default-features --features full`), so `scripts/lanes.mjs` needs `tests/acceptance/503-redraft-ac4/` in its
`alone` list; this README is the instruction, and the implementer makes that edit.

Needs: macOS; ffmpeg and ffprobe (found as `DEEP_FFMPEG`/`DEEP_FFPROBE`, on PATH, or in `/opt/homebrew/bin` or
`/usr/local/bin`) with the encoders `libmp3lame`, `aac`, `aac_at`, `libopus`, `vorbis` and `pcm_f32le`, the decoders
`mp3float`, `aac`, `libopus` and `vorbis`, and the muxers `mp3`, `mp4`, `ogg`, `webm` and `wav` (Homebrew's ffmpeg
9.0.2 has them all). No network, no wall time, no person. Every fixture and folder is temporary and deleted after the
test.

## Criterion to test

| ID | Clause | Test (`lossy.test.ts`, one `it`) |
|---|---|---|
| `AC4 #503.89909452` | the lossy formats decode in the worker on macOS within −90 dBFS of FFmpeg's decode | Twelve fixtures, two per format (Fixtures), each decoded by `media_decode` in one `deep-show run`. Each must: not be refused; be decoded by a process that isn't deep-show's and that `workers` lists as a `decode_worker` with a `decode` job on the fixture's SHA-256; give one audio stream at FFmpeg's rate and channel count, with FFmpeg's number of samples, a samples file of `samples × channels × 4` bytes, every value finite; and differ from FFmpeg's decode, sample k against sample k, by at most −90 dBFS at its peak. A second run must decode each fixture to the same PCM hash. Then four wrong programs run through the same check, which must fail on each, naming the fixtures (The wrong programs). |

## The surface under test

`deep-show run` reads one JSON scenario on stdin and answers one line `{"ok": true, "replies": [...]}`, one reply per
call (#393). Everything here is #498's surface (its decode README) except the three planted names marked *(chosen)*.

| Surface | Sent | Read | New or existing |
|---|---|---|---|
| scenario | `evidence`, `planted`?, `calls` | `ok`, `replies` | existing |
| `media_decode` | `path` (the fixture), `out` (a folder) | `decoded.worker.pid`; `decoded.streams[]`: `type`, `index`, `sample_rate`, `channels`, `first` (must be an exact rational; not judged), `samples` (frames a channel), `file` (under `out`: every kept sample as f32 little-endian, interleaved) | existing (#498) |
| a refusal | — | `refused.code`, and `refused.codec` when there, for the failure's sentence | existing shape; `unsupported_codec` naming `codec` is the design's (Decode worker) |
| `workers` | — | `workers[]`: `pid`, `role`, `jobs[]`: `op`, `file` (the SHA-256 of the file the job read) | existing (#498) |
| planted `decodes_in_app` | — | — | existing (#498): `media_decode` decodes in deep-show's own process, whose pid its reply names |
| planted `lossy_one_sample_late` *(chosen)* | — | — | new: each lossy stream's decode starts one sample late: the worker drops the first sample it would keep, so the samples file holds FFmpeg's samples from the second on, and `samples` is one less |
| planted `lossy_level_off` *(chosen)* | — | — | new: each lossy stream's decoded samples are multiplied by 1 − 2⁻¹⁰ (−0.0085 dB) |
| planted `vorbis_missing` *(chosen)* | — | — | new: the worker has no Vorbis decoder: a Vorbis stream in Ogg is refused `unsupported_codec`, naming `vorbis`, as an unlisted codec is |

"Lossy stream" in the plants means an MP3, AAC (LC or HE), Opus or Vorbis stream. Each plant is reachable only through
`planted`, and any other value stays `bad_input`, as today.

## The reference and the bound

**The reference** is FFmpeg's decode of the fixture by a named decoder, written as 32-bit float with no resampling,
remixing or dither:

```sh
ffmpeg -hide_banner -v error -nostdin -y -c:a <decoder> -i <fixture> -map 0:a:0 -c:a pcm_f32le -f wav <reference.wav>
```

- MP3: `mp3float`. AAC-LC and HE-AAC: `aac`. Vorbis: `vorbis`. These are FFmpeg's default decoders for those codecs,
  floating point, and the ones FATE's recipes run (`mp3.mak` names `mp3float`; `aac.mak` and `vorbis.mak` take the
  default). Their float output is written as it comes.
- Opus: `libopus`, FFmpeg's decode through the reference Opus codec, at its default 16-bit output, which the WAV holds
  as sample ÷ 32,768 (FFmpeg's exact conversion, the design's own sample ÷ 2^(depth − 1)).

The reference starts at the first sample FFmpeg keeps, after the priming the container declares (MP3's encoder delay
in its header, the MP4 edit list, Opus pre-skip), and ends where FFmpeg's demuxer ends the stream; that is FFmpeg's
decode as it is, whatever its length.

**The bound** is on the peak per-sample difference: over every sample k and channel c that both decodes hold, d =
max |ours[k][c] − FFmpeg's[k][c]|, in dBFS of a full scale of 1.0; the decode passes when 20·log₁₀ d ≤ −90, that is d ≤
10^(−4.5) ≈ 3.162 × 10⁻⁵ (one 16-bit step, 2⁻¹⁵, is −90.31 dBFS and passes; two are −84.29 and fail). No alignment is
searched: sample k of ours is held to sample k of FFmpeg's, from each one's first sample, and the sample count, rate and
channel count must equal FFmpeg's. The RMS of the difference is printed in a failure and never judged.

## Fixtures

Made at test time in a temporary folder; nothing binary is committed. Each starts as a 16-bit WAV of the source signal
at the fixture's rate and channel count, written by `helpers.ts` (`source`): 3 s; left, 440 Hz at 0.25 and 3,150 Hz at
0.12, a linear chirp from 100 Hz to min(12 kHz, 0.45 × rate) at 0.1, noise at ±0.06 from 1 s to 1.5 s (#501's seeded
generator, seed 503), and from 2 s a 2 kHz hit at 0.3 decaying as e^(−40 t); right, 660 Hz at 0.22 (phase 0.3), 5,200 Hz
at 0.1, the chirp inverted, half the noise and 0.7 of the hit; 5 ms fades at both ends; mono is the mean of the two.
Peaks are about 0.68 stereo and 0.44 mono. Then:

```sh
ffmpeg -hide_banner -v error -nostdin -y -i <name>.source.wav -map 0:a:0 -c:a <encoder> <options> -f <muxer> <name><ext>
```

| Fixture | Format | Encoder and options | Muxer, file | Rate, channels, length | FFmpeg decoder | ffprobe must read |
|---|---|---|---|---|---|---|
| `mp3-cbr-44k-stereo` | MP3 | `libmp3lame -b:a 192k` | `mp3`, .mp3 | 44,100 Hz, 2, 3 s | `mp3float` | codec `mp3`, format `mp3` |
| `mp3-vbr-24k-mono` | MP3 (MPEG-2, 576-sample frames) | `libmp3lame -q:a 4` | `mp3`, .mp3 | 24,000 Hz, 1, 3 s | `mp3float` | codec `mp3`, format `mp3` |
| `aac-lc-48k-stereo` | AAC-LC | `aac -b:a 160k` (FFmpeg's encoder) | `mp4`, .m4a | 48,000 Hz, 2, 3 s | `aac` | codec `aac`, profile `LC`, format `mp4` |
| `aac-lc-44k-mono` | AAC-LC | `aac_at -profile:a 1 -b:a 96k` (the platform's encoder) | `mp4`, .m4a | 44,100 Hz, 1, 3 s | `aac` | profile `LC` |
| `he-aac-48k-stereo` | HE-AAC (SBR) | `aac_at -profile:a 4 -b:a 64k` | `mp4`, .m4a | 48,000 Hz, 2, 3 s | `aac` | profile `HE-AAC` |
| `he-aac-v2-48k-stereo` | HE-AAC v2 (SBR and PS) | `aac_at -profile:a 28 -b:a 32k` | `mp4`, .m4a | 48,000 Hz, 2, 3 s | `aac` | profile `HE-AACv2` |
| `opus-ogg-48k-stereo` | Opus in Ogg | `libopus -b:a 128k` | `ogg`, .opus | 48,000 Hz, 2, 3 s | `libopus` | codec `opus`, format `ogg`, a CELT packet |
| `opus-ogg-16k-mono` | Opus in Ogg | `libopus -application voip -b:a 16k` | `ogg`, .opus | 16,000 Hz in (48,000 out), 1, 3 s | `libopus` | a SILK packet |
| `opus-webm-48k-stereo` | Opus in WebM | `libopus -b:a 96k` | `webm`, .webm | 48,000 Hz, 2, 3 s | `libopus` | format `webm`, EBML DocType `webm`, a CELT packet |
| `opus-webm-48k-mono` | Opus in WebM | `libopus -application voip -b:a 20k` | `webm`, .webm | 48,000 Hz, 1, 3 s | `libopus` | DocType `webm`, a hybrid packet |
| `vorbis-ogg-44k-stereo` | Vorbis in Ogg | `vorbis -strict experimental` (FFmpeg's encoder) | `ogg`, .ogg | 44,100 Hz, 2, 3 s | `vorbis` | codec `vorbis`, format `ogg` |
| `vorbis-ogg-22k-stereo` | Vorbis in Ogg | `vorbis -strict experimental` | `ogg`, .ogg | 22,050 Hz, 2, 3 s | `vorbis` | codec `vorbis`, format `ogg` |

An Opus packet's mode is read from its TOC byte (RFC 6716 §3.1: configurations 0–11 SILK, 12–15 hybrid, 16–31 CELT)
through `ffprobe -show_packets -show_data`. With the local FFmpeg 9.0.2 every packet of each Opus fixture was of the mode
the table names, and FFmpeg's decodes held 132,300, 72,000, 144,000, 133,120, 149,440, 149,440, 144,000 (each Opus
fixture, at 48 kHz), 132,352 and 66,176 samples a channel, in table order: the platform encoder's AAC files and the
Vorbis files decode longer than their 3 s source in FFmpeg, and that longer decode is the reference.

## The wrong programs

Each runs the same fixtures through the same check, which must fail, with a failure sentence about each fixture named
below that says what failed:

| Wrong program | What it is | The test requires a failure |
|---|---|---|
| `decodes_in_app` (existing) | the decode runs in deep-show's own process | on every fixture: "decoded in deep-show's own process" |
| `lossy_one_sample_late` *(chosen)* | a decoder off by a sample | on every fixture: its sample count or its peak difference (about −8 to −19 dBFS here) |
| `lossy_level_off` *(chosen)* | a decoder off in level by 0.0085 dB | on every fixture: its peak difference (about −63 to −68 dBFS here) |
| `vorbis_missing` *(chosen)* | a missing format | on both Vorbis fixtures: "refused" |

The base is a wrong program too: it reads no MP3, Ogg or WebM file (BASE-FAILURE.txt). A reply without a field the
check reads fails the test naming the field (#498's parsers), so a program whose calls return nothing fails.

## Legs that read BLOCKED or INCONCLUSIVE

- **BLOCKED**: off macOS; without ffmpeg or ffprobe; without an encoder, decoder or muxer the table names; when the
  local encoder makes a fixture other than its row says (codec, AAC profile, container, WebM DocType, Opus mode); when
  FFmpeg's reference decode fails or gives no samples. Each names what is missing and how to unblock it.
- **INCONCLUSIVE**: none of this test's legs. A `deep-show run` that doesn't finish within 900 s fails (#498's
  `runRaw`), and a build that fails fails, naming cargo's error.

## Readings where the issue and design leave a choice

- **Which decode of FFmpeg's.** FFmpeg has more than one decoder for most of these codecs. For MP3, AAC and Vorbis the
  reference is FFmpeg's default, floating-point decoder, the one FATE's recipes for those formats run. For Opus it is
  FFmpeg's decode through `libopus`, not FFmpeg's own Opus decoder, for two reasons from the design and the oracle: the
  design fixes our Opus decode as the reference codec "in its fixed-point form" with integer samples, and FATE's own
  `opus.mak` holds FFmpeg's own Opus decoder to the reference codec's RFC 8251 decodes only within a standard deviation
  of up to 191 sixteen-bit steps on the SILK vectors (about −45 dBFS), so it is a different decode from the codec the
  design names, and no decoder in the design's form could come within −90 dBFS of it (on these fixtures FFmpeg's own
  Opus decoder is −6.12 dBFS from the `libopus` decode on SILK and −13.67 dBFS on hybrid, while both agree on CELT). At
  its default 16-bit output, FFmpeg's `libopus` decode is in the same form as the design's.
- **Peak, not RMS.** "Within −90 dBFS of" reads as a bound on each sample's distance, and the design measures one decode
  of audio against another in dBFS as "the peak per-sample difference" (Determinism; the web player's samples are
  "measured against the app's, as audio across architectures is"). A peak bound also catches a fault confined to a few
  samples (a block switch, one frame's stereo mode), which an RMS over 3 s would average away. −90 dBFS is a little over
  one 16-bit step, so a decode that rounds to 16 bits spends up to half its margin on that rounding.
- **No shift.** FFmpeg's decode removes the priming and padding the container declares, and #498's surface gives every
  kept sample "after any edit list and the encoder's priming are removed"; FATE's recipes for these formats compare
  with no shift. So sample k is held to sample k, and a decode that keeps or drops one sample more is a different PCM
  that the clause must catch.
- **`first` is not judged.** The clause names samples, not times, and FFmpeg's own times differ by container (it puts
  an MP3's first kept sample at 1105/44100 s, an M4A's at 0). `first` must be present, as #498's surface has it.
- **"PCM hashes" for a lossy format** are the SHA-256 of the decoded samples file; the clause holds the PCM within the
  bound, and a second run (another deep-show and another decode worker) must give the same hash, so the decode has one
  PCM hash.
- **"In the worker"** is read from process ids, as #498's suite reads it: the reply's `decoded.worker.pid` isn't the
  pid of the `deep-show run` the test started, and `workers` lists it as a `decode_worker` with a `decode` job on the
  fixture's hash; deep-show is never listed.
- **HE-AAC** includes v2 (SBR with parametric stereo): the Oracle page reads the list as "AAC-LC and HE-AAC (SBR, PS)".
- **Containers.** MP3 is a plain MP3 file with its encoder header; AAC-LC and HE-AAC are in MP4 (.m4a), the container
  the worker already reads; Opus in Ogg and WebM and Vorbis in Ogg as the list says. ADTS AAC isn't a fixture.
- **Encoders.** Each format's fixtures come from the encoders this FFmpeg build has: for Vorbis only FFmpeg's own
  experimental encoder, which writes stereo only, so there is no mono Vorbis fixture.
- **"On macOS"** is where the test runs; elsewhere it is BLOCKED.

## Authoring check

Not a run of the suite (no deep-show was built for this draft). With the local FFmpeg 9.0.2, the fixtures above were
made by `helpers.ts`, and the check's `judge` was fed stand-in decodes shaped as `media_decode` replies: FFmpeg's
reference itself passed every fixture; the reference one sample late, scaled by 1 − 2⁻¹⁰, or named as decoded in
deep-show's process failed every fixture, naming it. FFmpeg's other decoders as stand-ins: its fixed-point `mp3` read
−89.52 and −89.55 dBFS (RMS −98.05, −98.06) and failed; `aac_fixed` passed both AAC-LC fixtures and read −70.63 and
−78.56 dBFS on HE-AAC and HE-AAC v2 (RMS −94.04, −95.18) and failed; FFmpeg's own Opus decoder passed both CELT fixtures
and failed SILK and hybrid as above. So the bound, read as a peak, asks for a decode close to FFmpeg's chosen decoder,
not only a conforming one.

## Not tested here

- The lossless clause and the refusal of an unlisted codec: AC4's other tests.
- FATE's own samples: the Oracle lane's, not this test's.
- `first`, the probe, the worker's sandbox and caps, and which decoder the worker runs (the Scope's "our own
  decoders"): no part of this clause.
- MP3 in other containers, ADTS or LATM AAC, multichannel streams, chained Ogg, and Vorbis files from other encoders.
