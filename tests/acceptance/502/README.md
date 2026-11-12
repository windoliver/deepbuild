# Acceptance tests for #502: narration and captions, ducking, open and closed captions, and delivery profiles

Written first, blind, from issue #502 (as of Nov 10, 2026: its Scope, its Fields, its 11 acceptance criteria, its Proof
and Oracle lines), its Oracle page, the design rows and sections it links and those they lean on, and the base commit
`c072ff92d` (`c072ff92da6160aad0c5c3ab5205c6e61d943679`, "design(#502): how a document writes ducking, narration lines
with recordings, the caption layout rule, sidecars and the delivery gain, in the Ducking, Narration and captions,
Loudness and caption profiles and Export rows"), by a job that never saw an implementation; none exists at the base,
and no other worktree, branch or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). The Oracle lane for criteria 7, 8 and 10 is in
`tests/acceptance/502-oracle/`.

## What was read

- The issue, live (`gh issue view 502 --repo windoliver/deepbuild`). Each test's name starts `AC<n> #502.<id>`, the
  first 8 hex digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space collapsed
  (`scripts/proof-change.mjs`, `criterionId`).
- The Oracle page (`doneright/oracles/issues/502.md`, DeepBuildAI/deepbuild, branch `doneright`) and the files it pins:
  libebur128 `67b33abe15` `test/tests.c`, FFmpeg `24e860f6d3` `tests/fate/subtitles.mak`, `tests/fate-run.sh` and the
  three reference outputs. Criteria 7, 8 and 10 have an upstream test; the other eight are ours.
- `docs/canvas-primitives.md` at the base: Ducking, Narration and captions, Loudness and caption profiles and Export
  (each with the paragraph the base commit added: the document shape, the gain law, the caption layout rule, the
  sidecars' form, the delivery gain and the receipt); Analysis bake; Bus; Strip and track; Marker; Occurrence list; Time
  and the flick; Text `text@1`; Look `look@1`: captions; Document envelope; Asset; Check input: export kinds and mix
  kinds.
- `docs/technical-design.md`: Films and figures on the canvas; Narration, captions and profiles; Device gate, capture
  and export; Dogfooding. `AGENTS.md`.
- At the base, for existing surfaces and conventions only: `crates/deep-show/src/` (`main.rs`: the call list and the
  scenario's `planted`; `export.rs`: the delivery `export`, its receipt, its refusals, its temporary name; `time.rs`:
  `time`, `play`, the plan form; `frames.rs`: `eval` and its snapshot; `mixdown.rs`: `media_mix`, the decoded PCM;
  `bake.rs`: `media_bake`'s loudness and model kinds; `media.rs`: `media_import`, `media_decode`; `film_viewer.rs`),
  `crates/deep-canvas-media/src/lib.rs` (`PLANTED`) and `analysis/loudness.rs` (how the bake reads loudness range),
  `crates/deep-canvas/src/document/mod.rs` (the envelope's keys) and `grammar/time.rs` (`@line.word:text#k`),
  `crates/deep-codecs/src/` (the probe, the decode, the PCM and AAC writers), `packages/jobs/bakes` (the record a job
  writes), `scripts/proof-change.mjs`, `scripts/lanes.mjs`; and the suites `tests/acceptance/501/`, `1818/`, `1819/`,
  `500/bake/`, `500-oracle/`, `499/mix/`, `498/decode/` as patterns and for their helpers.

What the base already does and these tests don't credit: #501's `export` (frames, PCM, MP4, PNG frames, the receipt's
size, rate, duration and hashes), #499's `media_mix`, #500's loudness bake, #1818's master limiter, #1819's words and
activity bakes, #498's decode worker. There is no `ducking`, no reading of `script`, no caption, no sidecar, no
`loudness_profile` and no loudness reading on a receipt.

## Run them

Put Node 24.22 and the pinned Rust toolchain first on PATH, then run one file at a time (each file builds `deep-show`
once, in `beforeAll`):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/502 film.test.ts      # AC1, AC4, AC5, AC6
node node_modules/vitest/vitest.mjs run --root tests/acceptance/502 ducking.test.ts   # AC2
node node_modules/vitest/vitest.mjs run --root tests/acceptance/502 loudness.test.ts  # AC3, AC7, AC8
node node_modules/vitest/vitest.mjs run --root tests/acceptance/502 sidecars.test.ts  # AC10 (FFmpeg)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/502 taste.test.ts     # AC11
npm run build --workspaces && cargo build --locked -p deep-hook                       # onsets.test.ts runs a hub
node node_modules/vitest/vitest.mjs run --root tests/acceptance/502 onsets.test.ts    # AC9 (hub, model host on 8719)
node node_modules/typescript/bin/tsc -p tests/acceptance/502/tsconfig.json            # type-check (exits 0)
```

- **Alone:** `scripts/lanes.mjs` needs `'tests/acceptance/502/'` and `'tests/acceptance/502-oracle/'` in its `alone`
  list (each file builds a cargo binary, exports films through the GPU and the encode tool, and `onsets.test.ts` owns
  port 8719). This job writes only its two folders; the implementer makes that edit.
- **Needs:** macOS `say` with the Samantha voice (every file but `taste.test.ts` speaks the film's words); for AC8 the
  EBU loudness test set in #500's cache (`~/Library/Caches/deepbuild/ebu-loudness/`, fetched there on first use); for
  AC10 `ffprobe`; for AC9 `uv`, the model host's weights and network for its first start only.
- **Safety:** every folder is under `/tmp` and removed after its file; no process is stopped by name or port
  (`onsets.test.ts` stops what #1819's harness started, by PID); no network but what #1819's and #500's helpers already
  do; no paid or remote model. Delete `tests/acceptance/502/node_modules/.vite` after a `--root` run.
- Every `it` passes a 3,600,000 ms timeout: a first cargo build takes many minutes.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it; BLOCKED and INCONCLUSIVE
legs fail with a line starting `BLOCKED:` or `INCONCLUSIVE:`.

## Criteria to tests

| AC | ID | File | Test, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#502.a6f3c068` | film.test.ts | the open export is an MP4 of 288 frames with one video and one audio track; each spoken line's recording is in its decoded sound where the line puts it; its frames differ from the closed export's exactly on the frames a caption shows on; every raw frame hash equals this suite's BLAKE3 of the live frame `eval` draws at that frame's time. Fails on an export that draws captions another way than the live view, at other times, or not at all |
| 2 | `#502.029aec8f` | ducking.test.ts | the music bus's gain, sample by sample: −12 dB on every sample of each line's speech span, 1 on the last sample at or before each ducked span's start less 0.2 s, and on the straight line to the depth from the next. Twin: the entry with `attack: 0.1`, judged as 0.2, fails, naming ducked span 1 |
| 3 | `#502.ea7fce3c` | loudness.test.ts | the film at `r128`: −23 ± 0.2 LUFS and at most −1 dBTP on the receipt, on its `delivery` and by the loudness bake of the decoded MP4; each caption within 20 characters a second; a second process gives the same `pcm_hashes`. Twin: a line of 22 characters in 0.54 s FAILs, naming `listen.1` and `max_cps`, and writes nothing |
| 4 | `#502.67480f9c` | film.test.ts | the closed export's frame hashes equal the film without its script, frame for frame; its `.srt` equals the open export's, which holds the fixture's four cues; `mode: closed` with `files: []` is refused with `captions_not_carried` and writes nothing |
| 5 | `#502.e18dfcba` | film.test.ts | the line `note` (`kind: caption`, no recording) is delivered as cue 4 of the `.srt` at 10,750 to 11,708 ms with its text, and `media_mix` gives the same PCM hash with the line and without it |
| 6 | `#502.65fdf864` | film.test.ts | `fixtures/film.json` is tracked, holds the document with its script, the cue list and the in- and out-times at 24 and 24000/1001 fps, follows the layout rule on its own word times, and the receipt's captions are exactly its cues, texts and times |
| 7 | `#502.ecdfe344` | loudness.test.ts | the range mix reads 12 ± 0.1 LU by the bake before any gain; exported at `r128`: −23 ± 0.2 LUFS, `limiter_cut: false`, LRA 12 ± 0.1 LU on the receipt, on its `delivery` and by the bake of the decoded MP4. Planted `normalizer_rides_gain`: FAILs with one issue naming `lra`, its `reading` under 11, its `target` 12 ± 0.1, nothing written |
| 8 | `#502.6db99478` | loudness.test.ts | `seq-3341-1-16bit.wav` as the master, `audio.codec: pcm`, no profile: −23.0 ± 0.1 LUFS on the receipt, on its `delivery` (within 0.01 LU of the receipt) and by the bake of the decoded file. Twin: the same master 6 dB down fails this suite's judge, naming `integrated` |
| 9 | `#502.ec7abd09` | onsets.test.ts | with words records by the real aligner job: each spoken caption starts on its first word marker's frame, within 2 frames of the fixture's in-time, and within 2 frames of a speech onset the real activity job finds in the decoded MP4. Planted `words_bake_200ms_late`: captions and markers still agree, each 200 ms late, and the judge's first failure names `intro.1` |
| 10 | `#502.60b58438` | sidecars.test.ts | at 24000/1001 over 287 frames: `film.srt` and `film.vtt` hold the four cues at the fixture's frame times rounded down to the millisecond, by this suite's readers and by FFmpeg's demuxer (ffprobe). Planted `sidecar_times_at_24fps`: fails at cue 4, the last (10,750 for 10,760 ms; 11,666 for 11,678 ms) |
| 11 | `#502.550b7034` | taste.test.ts | the recorded taste call on exactly the check run's pictures |

## The surface under test

`deep-show run` only (#393's convention: one scenario line on stdin, one answer line `{"ok": true, "replies": [...]}`),
with its existing calls. No new binary, subcommand or call. Names the issue and the design give are used as they give
them; **every name marked *(chosen)* is this job's**, taken from the design's words and shaped like the neighbouring
calls. The implementer builds exactly these, or a dispute goes to a blind redraft. Times are flicks (integers) or the
design's time literals; rates are `[p, q]`; hashes are lower-case hex.

### The scenario

`{"evidence", "sessions", "processes", "panels", "docs", "planted"?, "calls"}` as #501's suite writes it. The three
planted names below are accepted in `planted`, in the media module's `PLANTED` list, as #1818's and #1819's are.

### The film document

What a film document may now hold, beside what #501's film holds. The fixture file is the example of every field.

| Where | Fields | From |
|---|---|---|
| `ducking` (a top-level map by ID, beside `buses`) | `<id>: {target: <bus ID>, key: "narration", depth: dB, attack: s, hold: s, release: s, merge_gap: s}` | design; `key: {spans}` is the design's too and no test writes it |
| `script.narrator` | `{name, license: {id, terms, shareable, credit}, synthetic: false}`; no `plugin` and no `cost` | design; the fixture leaves out the two fields that describe a speech job, which is #509's |
| `script.lines.<id>` | `t` (a seconds literal), `text`, `kind` (`"caption"` on one line; left out, it is `speech`), `recording: {asset: <ID in assets>, in?: flicks, out?: flicks}` | design |
| `script.captions` | `{profile: "netflix-en-adult", font: "body", size: 14}`; no `box`, no `plate`, no limit of its own | design |
| `assets.<id>.attached` | `[<SHA-256 of the asset's words record>]`: the store file is the record's JSON | design ("lists in `attached`"); that an entry is the record's hash is *(chosen)* |
| `buses.narration` | implied; the ducking twin writes `{mute: true}` | design |
| `strips.music` | `{track, src: <the asset's SHA-256>, start, in, out, rate, bus: "music"}` | existing (#499, #501) |

A words record is the Analysis bake row's, as `packages/jobs/bakes` writes one: `{kind: "bake.words", analyzer, weights,
pcm_sha256, frame, words: [{text, start, end, phonemes: [{p, start, end}]}]}`, times in flicks from the asset's start.
The film reads a line's words from it by place: the line's k-th word is the record's k-th.

### Calls

| Call | Request fields | Reply fields read | New or existing |
|---|---|---|---|
| `deep show` | `peer`, `doc`, `document`, `include: ["issues"]` | `outcome: "presented"` | existing; the document's new fields above |
| `export`, delivery form | existing: `doc`, `out`, `video: {codec: "h264" \| "png_seq"}`, `audio: {codec: "aac" \| "pcm"}`, `frame_rate: [24000, 1001]`, `range: [0, <flicks>]`. New: **`loudness_profile: "r128"`** (left out: `none`), **`captions: {profile?: "netflix-en-adult", files?: ["srt", "vtt"], mode?: "open" \| "closed"}`** | `outcome: "exported"` with `receipt` (below); `outcome: "refused"`; `outcome: "failed"` *(chosen)* | extends #501's `export`; the request names are the issue's |
| `eval` | `doc`, `t` (flicks), `pixels: true` | `outcome: "evaluated"`, `snapshots[0].sha256` (a PNG in the evidence store): the live frame, **with the caption layer** | existing (#387); the caption layer is new |
| `time` | `doc`, `text: "@<line>.word:<Word>#1"` | `outcome: "resolved"`, `t`: the word marker's time | existing (#488); word markers resolve now. `<Word>` is the line's own word, its case kept |
| `media_mix` | `doc: <a film document>`, `segments: [{from, to, write?}]` | `mix.sample_rate`, `mix.segments[0].sha256`, `.wav` | existing (#499); it now plays the script's recordings on the bus `narration` and applies `ducking`, with no delivery gain |
| `media_import` | `path` | `asset.probe.streams[]`: `type`, a video's `pts` | existing (#498) |
| `media_decode` | `path`, `out`, `video_frames: 0` | `decoded.streams[]` of `type: "audio"`: `sample_rate`, `channels`, `file` (f32 under `out`) | existing (#498) |
| `media_bake` | `bake: {asset, kind: "loudness", tp_oversample: 8}`; AC9: `{asset, kind: "words" \| "activity", analyzer, record?}` | `bake.integrated`, `bake.range`, `bake.true_peak`; AC9: `bake.spans[].start`, or BLOCKED with no record | existing (#500, #1819) |
| deep_job (AC9, through #1819's harness) | `bake.words` and `bake.activity` on their pinned tools | the record by hash | existing (#1819) |

### `export`: the receipt, refusals and FAILs

A delivered export's `receipt` keeps #501's fields (`size`, `frame_rate`, `duration`, `frame_hashes`, `pcm_hashes`
read here) and adds:

| Field | Value | From |
|---|---|---|
| `loudness_profile` | the profile's name; `"none"` when the request names none | *(chosen)*: the request's field, echoed |
| `integrated`, `lra`, `true_peak` | LUFS, LU, dBTP (at 8×): readings of the PCM it delivers, by the loudness bake's code | design |
| `gain` | the delivery gain applied, dB (a number; 0 with no profile) | design |
| `limiter_cut` | boolean: whether the master's limiter ever cut | *(chosen)*: "whether the limiter ever cut" |
| `delivery` | `{integrated, lra, true_peak}`: the same readings of the decoded delivery | design |
| `captions` (a document with a script) | `{profile, mode, files: ["srt", "vtt"], violations: [], cues: [{name, line, text, in, out}]}` | design; `cues`, `name` and the cue's shape are *(chosen)* |

`max_m`, `max_s`, `sample_peak` and `plr` are the design's too; no test reads them. In `captions`, `files` lists the
kinds written, in the order asked; a cue's `name` is `<line>.<n>`, `line` its line's ID, `text` its lines joined by
`"\n"`, `in` and `out` flicks; cues are in time order.

- **Refused** (criterion 4): `mode: "closed"` with `files: []` answers `{"outcome": "refused", "code":
  "captions_not_carried", …}` *(chosen code)* and writes nothing.
- **FAIL** *(chosen shape)*: `{"outcome": "failed", "issues": [{…}]}`, nothing written at `out` or beside it. This suite
  reads, of an issue: `measure`, and for a loudness reading `reading` and `target` (numbers), for a caption `caption`
  (its name). The two it meets: `{measure: "lra", reading: <the delivered PCM's LRA>, target: <the master's LRA before
  the gain>}` (criterion 7's plant) and `{caption: "listen.1", measure: "max_cps", …}` (criterion 3's twin). An issue's
  other fields, a code or a sentence, are the implementer's. A caption violation is the export's FAIL, not a document
  error: the twin is presented by `deep show`, and exactly one issue names `listen.1`.
- **BLOCKED:** the design BLOCKs a spoken line with no recording, a recording with no words record attached, and a
  narrator or recording whose license isn't shareable. No criterion names one, the fixture meets none, and no test
  reads a BLOCKED reply's shape. A license stops an export only as narration: AC8's master, an asset with `shareable:
  false` in a film with no script, is delivered.
- **An export takes no activity record and runs no model:** every export here must deliver with what the document and
  the store hold. Criterion 9's check of the sound is this suite's (Readings).

### Files the export writes

`out` is the delivery (`film.mp4`). Each sidecar is beside it, under its name with the kind as its extension: `out`
`…/film.mp4` gives `…/film.srt` and `…/film.vtt`. With no `files`, `film.srt` alone. A `.srt`: cues numbered from 1,
`HH:MM:SS,mmm --> HH:MM:SS,mmm`, the caption's lines, a blank line between cues. A `.vtt`: the first line `WEBVTT`, a
blank line, then each cue's `HH:MM:SS.mmm --> HH:MM:SS.mmm` and lines (an identifier line before the times is read
past). Both: UTF-8, `\n` or `\r\n`, every caption in time order, each time the caption's in- or out-time rounded down
to the millisecond. Every test gives each export a fresh folder: a refused or FAILed export must leave it empty, so a
temporary name sits in `out`'s folder, as #501's does.

### Planted programs (the scenario's `planted`)

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `normalizer_rides_gain` | the delivery gain isn't one static gain: for each 10 ms of the master it is −23 LUFS less the short-term loudness of the 3 s ending there (the first 3 s take the first whole window's), so quiet passages are raised and loud ones lowered. The export's own comparison of the delivered LRA with the master's is unchanged | 7 | `lra`, with a reading under 11 LU |
| `words_bake_200ms_late` | every word of a line's words record is read 200 ms (141,120,000 flicks) late, start and end: word markers, captions and speech spans all follow; the recording plays where it did | 9 | the first caption, `intro.1` |
| `sidecar_times_at_24fps` | the sidecar writer times a caption's frame count at 1/24 s a frame whatever the export's rate: frame k is written as ⌊k × 1000 ÷ 24⌋ ms. The receipt's captions are unchanged | 10 | the last cue, cue 4 (`note.1`) |

## Fixtures

Only `fixtures/film.json` is committed. Every sound, record, picture and file is made by the tests at run time; no
audio, video, model output or personal data is in the repository.

- **The fixture film** (`fixtures/film.json`, criterion 6): its `document` (480 × 270, 12 s at 24 fps, 48 kHz; a
  ground, a block sliding 420 u and a bar growing, so every frame differs; the music strip on the bus `music`; the
  `ducking` entry `duck`; the `script`), its `recordings`, its `cues` and its `expected` times. In `document` each
  value made at test time is `null` (an asset's `sha256`, a voice asset's `attached`, the music strip's `src`), and
  `helpers.ts` `filmDocument` fills them. The script:

  | Line | `t` | Text | Sound |
  |---|---|---|---|
  | `intro` | 0.28 s | Bold music plays until a calm voice starts to speak | recording `voice_intro`; first word at 0.53 s, last ends 5.47 s |
  | `listen` | 5.905 s | Listen | `voice_listen`; 6.155 to 6.695 s |
  | `dips` | 7.905 s | The tune dips under each word | `voice_dips`, played from `in` 0.125 s to `out` 3.055 s; 8.03 to 10.71 s |
  | `note` | 10.77 s | Captions always on | none: `kind: caption` |

  Expected captions (frames; flicks and sidecar milliseconds are in the file):

  | Caption | Lines | 24 fps | 24000/1001 | The rule it shows |
  |---|---|---|---|---|
  | `intro.1` | "Bold music plays until a calm voice starts" (42 characters) / "to speak" | 12 to 132 | 12 to 132 | a line filled to exactly `max_chars`; in floored, out raised to the frame |
  | `listen.1` | "Listen" | 147 to 167 | 147 to 167 | 14 frames of speech held to ⌈5/6 s ÷ Δ⌉ = 20 frames, exactly `min_dur` at 24 fps |
  | `dips.1` | "The tune dips under each word" | 192 to 256 | 192 to 256 | `recording.in`; its last word ends in frame 258 (257), and it ends 2 frames before `note.1` |
  | `note.1` | "Captions always on" | 258 to 281 | 258 to 280 | a caption-only line: from its `t`, 18 characters ÷ 20 a second long |

  The times were worked out by hand from the layout rule (Narration and captions), never from a program; AC6 checks
  the file against `helpers.ts` `layout`, the rule in integers, and no other test uses `layout`. Speech spans: 0.53 to
  5.47 s, 6.155 to 6.695 s (0.685 s after the first, so `merge_gap` joins them) and 8.03 to 10.71 s (1.335 s later, so
  the first's release has ended when its ramp starts).
- **The recordings** (`helpers.ts` `voices`): each word of a spoken line is spoken alone by `say -v Samantha` at
  48 kHz (#1819's `say`), cut to the samples between its first and last above −50 dBFS, halved, and put at the sample
  `recordings.<asset>.words[k].start` fixes; a word longer than its slot on this macOS is cut at the slot's end with a
  5 ms fade. So each word starts where the file says, whatever the voice sounds like; a word may end before its
  slot's `end`. One channel, 32-bit float, so the decoded PCM is the samples.
- **The words records** the fixture film attaches (`helpers.ts` `fixtureRecord`) are written by the test from the same
  file: `{kind: "bake.words", analyzer: "charsiu-aligner@1.0.0", weights: [], pcm_sha256, frame: 7056000, words: [{text
  (lower case), start, end, phonemes: []}]}`, each word's `start` and `end` its slot's. They are fixtures, not the
  aligner's output: they name the pinned aligner because the film reads a record as `media_bake` does, and they make
  the caption times exact, as criterion 6's checked-in times need. No test that reads them makes a claim about the
  aligner. **Criterion 9 alone** attaches records the real `bake.words` job made of the same recordings.
- **The music** (`musicBed`): #1819's chord pad, 12 s, one channel, −30 dBFS RMS. CC0.
- **Twins:** the film without its script (`withoutScript`: no `script`, no `ducking`, no voice asset; AC4, AC7); the
  fast line (`fastSpecs`: `listen` says "Listen closely to this" in its one word's 0.54 s; AC3); the ducking twin (a
  constant 0.25 for music, `buses.narration: {mute: true}`, and for the late ramp `attack: 0.1`; AC2); the film without
  `note` (AC5).
- **The range mix** (`range_mix` in the file; `rangeFilm`): the film without its script, its music strip playing a
  1 kHz tone on both channels, 6 s at −26 dBFS then 6 s at −14 dBFS. Its short-term loudness sits at two levels 12 dB
  apart, each for a third of the 9 s the meter ranks, so its range is 12.0 LU; the test reads that from the bake first.
- **The master films** (`masterFilm`; AC8, the Oracle lane): 64 × 64 at 24 fps, one strip on the master at unity
  playing one sound file from the EBU loudness test set, the span the file's length rounded up to the second. The
  asset's license says `shareable: false` (the set is for technical testing only); the film carries no narration.
- **Licenses:** the voice assets and the narrator carry `LicenseRef-deepbuild-test-fixture`, `shareable: true`: spoken
  at test time for these tests and deleted after them. Nothing is shared.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- Every file but `taste.test.ts`: BLOCKED when `say -v Samantha` can't speak (#1819's `say`).
- AC8: BLOCKED when the EBU set isn't cached and can't be fetched, or doesn't hash to its pin (#500's `ebuSet`).
- AC9: BLOCKED when something this suite didn't start already answers on 127.0.0.1:8719 (it stops nothing), when the
  model host exits or doesn't answer within 30 minutes, or when the hub gives no answer (#1819's harness, used as it
  is).
- AC10: BLOCKED without `ffprobe` and `ffmpeg` with the srt and webvtt demuxers (PATH, `/opt/homebrew/bin`,
  `/usr/local/bin`, or `DEEP_FFPROBE` and `DEEP_FFMPEG`), after this suite's own readers have judged the sidecars.
- AC11: INCONCLUSIVE without the four pictures in `docs/evidence/502/` or without a recorded call on exactly them.

## The taste call

The check run puts `open-frame-60.png` (frame 60 of the open export, inside `intro.1`), `open-frame-270.png` (frame
270, inside `note.1`), `closed-frame-60.png` (frame 60 of the closed export) and `captions.apng` (a recording of the
open export's captions appearing in time) in `docs/evidence/502/`, each taken from the exported file, attaches them
to the PR and shows them in the session. The call is recorded in `tests/acceptance/502/TASTE.json`: `{issue: 502,
criterion: "#502.550b7034", verdict: "looks_right" | "looks_wrong", who, when (ISO 8601), screenshots: {<name>:
sha256}, note?}`. This job writes no TASTE.json and creates no picture.

## Readings where the issue and design leave a choice

- **The settled live frame** (AC1) is `eval`'s canonical snapshot at the frame's time, as #501's AC1 reads the live
  frame; this suite hashes its BGRA8 rows with its own BLAKE3 (#501's port, checked against the published vectors).
- **"With its narration"** (AC1): over each line's speech span the decoded MP4's sound (its channels' mean) and the
  narration this suite laid match with a normalized correlation of at least 0.9; music at −42 dBFS under the voice and
  AAC leave it near 1, and a film with no voice near 0. The 0.9 is this suite's.
- **"With its captions"** (AC1): the open export's frames differ from the closed export's on exactly the frames from
  each caption's in-frame up to, not including, its out-frame.
- **The music bus's gain** (AC2) is read on the master of a twin whose music is a constant and whose narration bus is
  muted: each sample over the loudest. A gain within 2 × 10⁻⁵ counts; one sample of the ramp is 7.8 × 10⁻⁵. "Each
  speech span" is each line's; "its ramp" is the ramp of the ducked span it belongs to after `merge_gap` joins. Hold
  and release are the design's and the issue's Scope, not this criterion's, and aren't judged.
- **"Measures"** (AC3, AC7, AC8): the receipt's reading, its `delivery`'s, and the loudness bake's of the file this
  suite decodes, each held to the criterion. **"Renders identical samples"** (AC3): two `deep-show run` processes of
  one build give equal `pcm_hashes`.
- **"A render with the caption layer removed"** (AC4) is the film without its script exported as PNG frames (Export:
  "a closed export's frames are the frames of the same document without its script").
- **"Runs no speech job"** (AC5): the line has no recording, no speech job exists in this suite, the film is delivered,
  and the line adds no sample to the film's sound.
- **"The fixture's mix with a 12 LU LRA"** (AC7) is the range mix above, in the fixture file; "the limiter idle" is
  `limiter_cut: false`. The plant's FAIL is the export's own (Loudness and caption profiles: "the export compares
  them"), so nothing is delivered to measure.
- **Criterion 8** exports with no loudness profile: the receipt still carries the readings, and the master is the
  case's signal untouched. "Reads the same": within 0.1 LU of the case, and within 0.01 LU of the receipt.
- **Criterion 9's judge is this suite.** The design holds caption timing to the sound "on the decoded delivery", but
  gives no surface that hands an export an activity record, and a bake never runs a model; so the test decodes the
  delivery, runs the real activity job and judges. A speech onset is a span's start; a caption is held to the nearest
  one. A caption-only line has no speech and isn't read. The fixture has one caption a spoken line, so "each caption"
  and the design's "first speech onset … inside its line's span" are the same captions.
- **Model times** (AC9): the aligner's word starts are a model's, so the captions are held to the fixture's in-times
  within 2 frames (the profile's "in: within 2 frames of the first word"), and exactly only to their own word markers.
  Each first word sits 30 ms after a 24 fps frame starts, so an aligner up to 30 ms early keeps its frame. If the
  pinned models miss 2 frames on this film, that is the criterion failing, not a tolerance to widen.
- **"Exported at 24000/1001"** (AC10): 12 s is 287.7 frames at that rate. The base refuses a whole-film export there
  (`not_whole_frames`), and the design's "the check names the hold it adds" is #501's export, not this issue's; so the
  test exports `range: [0, 8446237800]`, the 287 whole frames (11.97 s), which hold every caption. The captions are laid
  out on the export's frames, so `note.1` ends at frame 280 there and 281 at 24 fps.
- **"Fails at the last cue"** (AC10): frame k at 24 fps is k ÷ 24 ms early, so the first cue's start (frame 12) is
  written right and the last cue is the furthest off; the test asserts cue 4's start and end fail in both files.
- **Exactly `min_dur`:** `listen.1`, held to 20 frames, is 588,000,000 flicks, exactly 5/6 s at 24 fps, and is not
  "shorter than `min_dur`".

## Not tested, and why

Other issues' rules: the streaming and podcast profiles, r128's short-term maximum for short programmes, caption
rules at cuts and gaps under 0.5 s (#157; the fixture film stays under −18 LUFS short-term at r128 so an export that
holds it still delivers); the speech job, the transcript check, `after` and `gap`, `narration.overlap` and
`narration.fit`, `@line` anchors (#509); look plates, entrances and `shown_by` (#466); profile registries (#510); CJK
profiles (#407). In this issue's design but in no criterion: the BLOCKED cases, `ducking`'s refusals and `key:
{spans}`, the caption checks other than `max_cps`, a line of several captions, the receipt's `max_m`, `max_s`,
`sample_peak` and `plr`, NVENC on Linux.

## Not settled

- **A line of several captions against the sound check.** The design holds each caption to "the first speech onset …
  inside its line's span"; the second caption of a line spoken without a pause has no onset of its own. The fixture
  avoids the case; the rule needs a decision before a film has one.
- **The fixture's words records name the pinned aligner** though the test wrote them. The Narration row refuses a
  record "of another kind or of another PCM" and names no analyzer for a film's line; naming the pinned one works
  under either reading.
- **The narrator** has no `plugin` or `cost` here: no speech job runs in this issue.
- **The EBU asset's `shareable: false`** must not stop a film with no narration from exporting to a local file; the
  design BLOCKs only narration and the `document` target on a license.
