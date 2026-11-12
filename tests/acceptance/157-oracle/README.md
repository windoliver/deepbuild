# Acceptance tests for #157, Oracle lane: FFmpeg's FATE tests run against our export

Written first, blind, from issue #157 (`gh issue view 157 --repo windoliver/deepbuild`), its oracle map
(`doneright/oracles/issues/157.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the upstream files that map pins
(read from that branch's `doneright/oracles/vendor/ffmpeg-24e860f6d3/`), the #157 suite's surface
(`tests/acceptance/157/README.md`, written by the same job) and base commit `35df4523f`, by a job that never saw an
implementation of #157; none existed, and no other worktree, branch or PR was read. #136's rule applies: a linked test
counts only when run against our output, so every upstream case here reads what `deep-show run`'s `export` writes, or
the decode worker's reading of FATE's own samples. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criteria 8, 9, 10, 12, 23 and 24, the six the oracle map links an upstream test to. Their parts the map calls
ours (the export.sync fixture, its lag of 0 and the limiter's lookahead; comparing both readers per export kind) are
tested here too, beside the upstream reading, so each criterion has one home.

## Sources

| Criterion | Upstream, pinned | Files | Use | License |
|---|---|---|---|---|
| 8, 10 | FFmpeg `24e860f6d3c4f2ebae65ed7649e2a8860d512879` | `tests/fate/prores.mak` (`fate-prores-alpha`, `fate-prores-transparency`, `fate-prores-probe`); `tests/ref/fate/prores-alpha`, `prores-transparency`, `prores-probe` | run on our code; port | LGPL-2.1-or-later: the three references vendored unchanged in `fixtures/fate/` with `NOTICE` and `COPYING.LGPLv2.1` |
| 10 | FATE samples `prores/Sequence_1-Apple_ProRes_with_Alpha.mov`, `prores/prores4444_with_transparency.mov` | fetched on first use from `https://fate-suite.ffmpeg.org/` into `~/Library/Caches/deepbuild/fate-suite` (or `DEEP_FATE_SAMPLES`), pinned by SHA-256 in `fixtures/fate/samples.json` | test data | never committed |
| 9 | FFmpeg, the same commit | `tests/fate/gapless.mak` (the `audio_match` recipes), `tests/audiomatch.c`, `tests/ref/fate/audiomatch-afconvert-44100-stereo-lc-m4a` | port | `audiomatch.c` ported in `helpers.ts`, its notice kept; the reference vendored |
| 12, 24 | FFmpeg, the same commit | `tests/fate/gapless.mak` (`gaplessenc`), `tests/ref/fate/gaplessenc-pcm-to-mov-aac`; `tests/fate/mov.mak` (the edit-list framemd5 recipes) | run on our code | the reference vendored |
| 23 | FFmpeg, the same commit | `tests/fate/mov.mak` (`fate-mov-1elist-1ctts`), `tests/ref/fate/mov-1elist-1ctts` | run on our code | the reference vendored |

| Upstream | What it holds | Our output |
|---|---|---|
| `fate-prores-alpha`, `fate-prores-transparency` | framecrc of each sample decoded to yuva444p12le | AC10: FFmpeg's decode by the recipe is first shown to give the reference's framecrc, then the decode worker's BGRA decode of each sample is held to it, colour read as BT.709 limited range (±2 code values where alpha is whole) and alpha at full range (±1); AC8: the recipe's decode of our own ProRes 4444 delivery has alpha codes at full range and luma at limited range |
| `fate-prores-probe` | ffprobe -show_frames on ProRes: `color_range=tv` | AC8: every frame of our ProRes delivery reads the reference's `color_range` |
| `audio_match` (audiomatch.c) | the offset and length error of a decoded AAC file against its source: `presig: 0 … lenerr:0` for afconvert's | AC9: FFmpeg's decode of our AAC delivery against the PCM the film plays reads the reference's presig within one sample frame and its lenerr exactly |
| `gaplessenc` | `start_pts=0`, `duration_ts` the source's whole sample count, the priming skipped and the end padding discarded | AC12: our MP4's sound reads start_pts 0 and duration_ts 2,880,000; AC24: duration_ts equals FFmpeg's decoded count and start_pts the reference's |
| mov.mak edit-list recipes (framemd5) | every frame listed with its pts | AC12: FFmpeg presents 1,440 frames, frame k at k/24 s |
| `fate-mov-1elist-1ctts` | an edit list over a composition offset: the first frame at pts 0 | AC23: FFmpeg presents our deliveries' frame 0 at the reference's first pts, 0 |

Not ported: FATE's other ProRes, gapless and mov recipes (other codecs and samples); the framecrc of our own
deliveries (their pictures are ours, so no FATE reference holds them); audiomatch's HE-AAC and other encoders' cases.

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157-oracle prores.test.ts --testTimeout=600000    # AC8, AC10
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157-oracle sync.test.ts --testTimeout=600000      # AC9, AC23
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157-oracle frames.test.ts --testTimeout=600000    # AC12
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157-oracle readers.test.ts --testTimeout=600000   # AC24
node node_modules/typescript/bin/tsc -p tests/acceptance/157-oracle/tsconfig.json                                # type-check (exits 0)
```

Each file builds `deep-show` (`full`) once through `tests/acceptance/157/helpers.ts`. Every `it` passes a 3,600,000 ms
timeout. Temp folders are removed after each test or file; no process is stopped by name or port. Delete
`tests/acceptance/157-oracle/node_modules/.vite` after a `--root` run. `scripts/lanes.mjs` needs (the implementer adds
them; each file builds a cargo binary and exports films through the GPU and the encode tool):

```js
alone.push('tests/acceptance/157-oracle/prores.test.ts');
alone.push('tests/acceptance/157-oracle/sync.test.ts');
alone.push('tests/acceptance/157-oracle/frames.test.ts');
alone.push('tests/acceptance/157-oracle/readers.test.ts');
```

## Criteria to tests

| AC | ID | File | Tests |
|---|---|---|---|
| 8 | `#157.760918c9` | prores.test.ts | 2: the ProRes 4444 alpha film (160 × 90, 1 s, no ground: an opaque half, a half at 50%): the receipt's `color_probe` reads `{range: tv, alpha: full}` within ±2; the decode worker probes limited colour and full alpha and decodes frame 0 within ±2 (alpha ±1) of the raw frame; FATE's probe recipe reads `tv`; FATE's alpha recipe decodes alpha at full range and luma at limited range. Planted `prores_fed_full_range` fails export.color |
| 9 | `#157.72589e8f` | sync.test.ts | 4: the AAC sync delivery (24 fps, 48 kHz, half-scale bursts, the right channel's 0.25 s later): `av_offset.samples` within 1, the sound's edit list starting at the encoder's priming, audiomatch at the reference's presig and lenerr, each channel ≥ 0.99 against its raw channel at lag 0. Planted: `muxer_strips_audio_edit_list` names the offset as the priming; `muxer_edit_list_1024` names 1,088 samples; `muxer_swaps_channels` names channels 0 and 1 |
| 10 | `#157.b9317df5` | prores.test.ts | 1: no `.mov` committed, the cache outside the checkout; each FATE sample's framecrc by FFmpeg is the reference's; the decode worker probes limited colour and full alpha and decodes within ±2 (alpha ±1) of that decode |
| 12 | `#157.98831309` | frames.test.ts | 4: the 60 s film (160 × 90, 24 fps, 48 kHz stereo) as H.264 with AAC, `readback: true`: the receipt reads 1,440 frames and 2,880,000 samples; the decode worker and FFmpeg present 1,440 frames at k/24 s and 2,880,000 samples; gaplessenc's start_pts and duration_ts; each FFmpeg frame closer by luma to its own raw frame than to either neighbour. Planted `writer_drops_frame_700` (frame 700), `writer_repeats_frame_701` (frame 702), `muxer_keeps_end_padding` (the sample count) |
| 23 | `#157.dd0134eb` | sync.test.ts | 3: the export.sync fixture (full-scale bursts, a master limiter with 5 ms lookahead) at 24000/1001, 25, 30000/1001 and 60 fps by 44.1 and 48 kHz, H.264 with PCM: frame 0 at FATE's first pts, a white frame per second, each burst 0 samples late, `av_offset.samples` 0. Planted `limiter_lookahead_uncompensated` at 25 fps and 48 kHz names second 1, 240 samples late; `muxer_drops_video_edit_list` names frame 0 |
| 24 | `#157.1201423e` | readers.test.ts | 2: the fixture film delivered once as H.264 with AAC (MP4) and ProRes 4444 with PCM (MOV); each read by the decode worker and by FFmpeg: the same frame count, frame times (exact) and sample count, and gaplessenc's fields. Planted `reader_pads_last_packet` in the reading run fails naming `film.mp4: sample count` |

## The surface under test

Exactly the #157 suite's (`tests/acceptance/157/README.md`: The surface under test), with these parts read here:

- **The receipt's `av_offset`** `{samples, priming, edit_list}` *(chosen shape)*: the lag export.fidelity measured, the
  encoder's priming, and the sound track's edit-list media time, in samples; `color_probe`, `fidelity` as there.
- **A FAIL's issue** for an offset `{check, lag, priming}`, for channels `{check, channels: [0, 1]}`, for a burst
  `{check: "export.sync", second, lag}`, for a frame `frame` or `frames`, for a sample count `samples: {expected,
  got}` *(each chosen, as there)*.
- **The decode worker's probe** of a stream with alpha adds **`alpha: {range: "full" | "limited"}`** *(chosen)* beside
  `color` (the design's Asset probe lists `alpha`); `media_decode` with `format: "bgra"` gives a ProRes 4444 stream's
  alpha in the fourth byte.

### Planted programs (the scenario's `planted`)

| Name | Where it plugs in, and what it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `prores_fed_full_range` | the ProRes 4444 writer feeds full-range Y'CbCr under limited-range tags | 8 | `export.color` |
| `muxer_strips_audio_edit_list` | the MP4 muxer writes no edit list for the sound track | 9 | the offset, equal to the encoder's priming |
| `muxer_edit_list_1024` | the muxer writes the sound's edit list from media time 1,024 whatever the encoder primed (AudioToolbox's AAC: 2,112) | 9 | 1,088 samples |
| `muxer_swaps_channels` | the muxer writes the left channel's samples as the right's and the right's as the left's | 9 | channels 0 and 1 |
| `writer_drops_frame_700` | the video writer leaves out frame 700 | 12 | frame 700 |
| `writer_repeats_frame_701` | the video writer writes frame 701's picture again in place of frame 702's | 12 | frame 702 |
| `muxer_keeps_end_padding` | the sound's edit list runs over the encoder's end padding | 12 | the sample count |
| `limiter_lookahead_uncompensated` | the master limiter's 5 ms lookahead is not compensated against the picture | 23 | second 1, 240 samples late |
| `muxer_drops_video_edit_list` | the video track keeps its composition offsets, its first composition time above 0, and has no edit list | 23 | frame 0 |
| `reader_pads_last_packet` | the decode worker's AAC reader pads the last packet to a whole 1,024-sample frame | 24 | `sample count` |

## Fixtures

- **The FATE references** in `fixtures/fate/` (see `NOTICE`) and the sample pins in `samples.json`; the samples are in
  the cache only.
- **The films** are the #157 suite's (helpers.ts `filmDoc`, `syncFilm`): the 60 s fixture film (AC12), the 2 s one
  (AC24), the ProRes alpha film (AC8, its own here), and the export.sync fixture: black, with a full-frame white rect on
  the frame that shows each whole second from 1 and a 2 ms 4 kHz burst at that frame's first sample, ⌊k × Δ × sr ÷
  705,600,000⌋, the film's whole span declared to film.blank (it is dark by design).

## Legs that read BLOCKED or INCONCLUSIVE

- Every file: BLOCKED without `ffmpeg` and `ffprobe` (PATH, `/opt/homebrew/bin`, `/usr/local/bin`, or `DEEP_FFMPEG` and
  `DEEP_FFPROBE`); unblock: `brew install ffmpeg`, or name the binaries.
- AC10: INCONCLUSIVE when a sample isn't cached and can't be fetched, or doesn't hash to its pin; unblock: run once with
  network access to `https://fate-suite.ffmpeg.org/`, or put the samples in the cache.

## Readings where the issue and the map leave a choice

- **FATE's ProRes decode is the reference, not its CRC**: ProRes isn't bit-exact across decoders, so the decode
  worker's planes aren't held to FATE's CRCs; FFmpeg's decode is held to them, and the worker to FFmpeg's decode
  within ±2 code values. FFmpeg crops `prores4444_with_transparency.mov` to 1888 × 1062 by its `clap`; the worker's
  frame is compared with FFmpeg's at the worker's size (`-apply_cropping none` when the worker gives 1920 × 1080).
- **"Each export kind"** (AC24) is each video codec this build delivers with sound: H.264 with AAC in MP4 and ProRes
  4444 with PCM in MOV.
- **The sync fixture's level**: AC23's bursts are full scale, as the design's fixture is; AC9's are at half scale so no
  limiter on the master changes their samples, which audiomatch and the channel correlation compare.
- **"Its measured lag"** (AC23): measured here as export.sync does, from the white frame FFmpeg presents and the burst
  in FFmpeg's decode, and the receipt's `av_offset.samples` read beside it.

`BASE-FAILURE.txt` states where each test fails at the base.
