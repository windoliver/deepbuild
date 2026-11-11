# Acceptance tests for #1163: the first film exported, three shots on a tempo map with a sound bed, as an MP4 and a PNG range whose frames match playing

Written first, blind, from issue #1163 (its Scope, its eight acceptance criteria and its Proof line, read live on
November 11, 2026), the design rows and the base commit `937da9d44` ("Merge pull request #2275") by a job that never saw
an implementation; none existed, and no other worktree, branch or pull request was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The issue has
no oracle page.

## What was read

- The issue, live (`gh issue view 1163 --repo windoliver/deepbuild`, body only).
- `docs/technical-design.md`: Films and figures on the canvas (Timeline and camera shots, Audio and media, Export);
  Device gate, capture and export; Device gate and capture; Dogfooding and Tests written first (wrong programs: the
  merge base, a planted twin or a mutant).
- `docs/canvas-primitives.md`: Time and the flick (the units, `"2:1b"`, frame k's audio start, files write a timescale
  per track); Tempo map and cue alignment (the segment fields, the `literal_time_with_tempo_map` notice "offering the
  bar:beat or @marker form"); Marker; Clip; Placement and its sub-sections (repeat, wrap right-continuous, extend);
  Camera `camera@1` and its sub-sections; Shot ("It can never: Overlap another shot, on any camera, outside a
  transition that joins them"); Transport; Transport: film viewer (`,` and `.` one frame while paused, 0 to 9 a tenth
  of the span, Home, ⌥→ the next section marker; "a frame step from frame 100 shows the frame export frame 101
  shows"); Strip and track (a looping strip repeats its loop region, "the asset's loop points, or its whole length";
  the 5 ms equal-power fade where a strip stops inside its source); Bus; Processor (reverb, `checkpoint_every`, seek
  equals play bit for bit); Device gate; Export (the readiness gate, tails pre-rolled, shards, BLAKE3 over BGRA8 rows,
  SHA-256 over PCM as interleaved f32le, all or nothing under a temporary name). None of those rows carries an "As
  built" paragraph at the base.
- At the base, for surfaces and harness conventions only: `AGENTS.md`, `CONTRIBUTING.md`, `scripts/proof-change.mjs`
  (criterion IDs); the suites `tests/acceptance/501/` (export, receipts, the film viewer, `session`, `revisions`,
  `--planted`), `499/mix/` (`media_mix`, `handed`, the reverb and its plants, the fade reading), `493/` (shots and
  transitions in documents), `492/` (clips and placements), `491/` (the tempo map, the literal-time notice), `411/`
  (deep_query), `1162/` (the agent's world, `deep show` from a test process, TASTE.json); `crates/deep-show/src/`
  (`main.rs`'s call list and `planted` names, `export.rs`, `film_viewer.rs`, `mixdown.rs`, `query.rs`, `hub.rs`'s
  `seeds_noise_from_clock`), `crates/deep-codecs/src/mov.rs` (how an MP4 carries float PCM: `fpcm` with `pcmC`).

## What the base has

See `BASE-FAILURE.txt` for the run. Every dependency is merged at the base: `deep show` with whole revisions and
issues (#393); deep_query reading item paths, buses, bounds and modifiers, but no shot, placement or marker path
(#411); the motion module with the tempo map, markers, shots, transitions, clips and placements (#488–#493); the media
module's strips, buses, the recursive reverb with its checkpoint ring, `media_mix` and `handed` (#499); `export` with
its receipt, the video and png targets, ranges, stills at a marker, shards, the readiness gate and its stop, the film
viewer's keys, `viewer` and `session` (#501); the scenario `planted` values `reverb_restores_without_tail` (#499) and
`seeds_noise_from_clock` (#670, on render-back snapshots only). It has no `video_drops_frame_300` or
`range_starts_one_frame_late`, no `state` on a stopped export, and no `docs/evidence/1163/`.

What the run found: the base refuses the film itself. `deep show` answers `refused` with `bad_time` at
`shots/shot-pan/start` ("motion.compile can't evaluate this … Write the time as a span such as 2s or 120f"): a shot's
start and end written on the tempo map (`4:1b`) don't compile, though placements and markers written the same way do.
So every test that presents the film fails there. To learn what lies behind that refusal (and to check this suite's
own readers against a real export), the fixture's shot times were changed by hand to `0s`, `6s`, `14s` and `20s` for
one debug run and restored before this commit; nothing in an expectation changed. With them the base presents the film
with no issue, reads the dot's y as 556 at the wraps and the title's opacity, exports the whole film in about 9.5
minutes (600 distinct frame hashes; an MP4 whose 600 video samples sit at k/30 s and whose `fpcm` sound holds 960,000
samples a channel from time 0, each frame's span hashing to the receipt's), and passes AC2's, AC3's and AC4's main
tests and AC6; the bed's end fade matches the curve through the reverb within 9e-9 (a fade on (i + 1)/240 misses by
5e-4). Behind it still: the deep_query paths for shots and placements (`ref_unresolved`), the notice in `deep show`'s
issues, `play` in a film's own panel (`no_document`), the stop's `state`, the two new plants, the clock-seeded noise in
an export, and the tailless reverb in a cold jump (a fresh process has no checkpoint to restore, so the base renders
the reverb from 0 and the plant changes nothing). `BASE-FAILURE.txt` has both runs.

## Run them

```sh
npm ci && npm run build --workspaces
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 30 -- \
  scripts/lease cargo build --locked --bin deep-show --no-default-features --features full
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1163 --testTimeout=600000 <file>
node node_modules/typescript/bin/tsc -p tests/acceptance/1163/tsconfig.json
```

Each file builds `deep-show` with `cargo build --locked --bin deep-show --no-default-features --features full` once,
in `beforeAll` (a no-op after the leased build above when the environment matches), copies it out of the target folder
(`CARGO_TARGET_DIR` honoured) and fails each test whose build failed. The files export a 600-frame 1080p film several
times and build a cargo binary, so they run one at a time: `scripts/lanes.mjs` needs `tests/acceptance/1163/` in its
`alone` list; this README is the instruction, and the implementer makes that edit. Every test writes under one
temporary folder per file, deleted after it. Node built-ins and vitest only; no network, and no process is stopped
but by `spawnSync`'s own timeout on the child it started. The film's exports draw and hash on the GPU and encode H.264
with the platform's encoder, so the suite runs on a Mac, as the issue's checkpoint does.

| File | Criteria | What runs |
|---|---|---|
| `query.test.ts` | AC1 | two short runs: the film read back, the literal cue, the offered form, the overlap |
| `exports.test.ts` | AC2–AC6 | run A (below), then fresh runs: the planted writer and range, the seek range twice, the whole film again, with 3 shards and twice planted, the live transport |
| `readiness.test.ts` | AC7 | one run: the film without its bed |
| `shown.test.ts` | AC8 | reads `docs/evidence/1163/` and `TASTE.json` |

**Run A**, made once per file by the first test of `exports.test.ts` that needs it and shared by AC2, AC3, AC4, AC5
and AC6 (a whole 1080p export is minutes in a debug build): one `deep-show run` that presents the film, sets the
session state `{selection: ["dot"], view: {}}`, reads `revisions` and `session`, exports the whole film as MP4 with its
sound, reads them again, exports frames [300, 330) as png_seq, reads them again, exports the still at marker `title`,
reads them again, evaluates the live frame at the marker, and steps the film viewer. Before it, a short run reads
whether the viewer opens paused (as #501's viewer test does) so run A presses `k` only if it plays.

## Criteria to tests

IDs are the first 8 hex digits of the SHA-256 of each criterion's text after `- [ ] `, trimmed and with white space
collapsed (`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #1163.<id>`.

| AC | ID | File | Test, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#1163.d0a72903` | query.test.ts | shot 2's start, the title placement's, the dot's y at the eight wraps; the literal cue's notice and its offered form; the overlap refused, the revision kept. Wrong programs: the base (no such paths, no notice in `deep show`'s issues) |
| 2 | `#1163.5c7e06ab` | exports.test.ts (2) | the receipt; the MP4 read back: 600 frames at k/30 s, 960,000 samples a channel from time 0, each frame's span hashing to the receipt's PCM span; the bed's last 240 samples on the equal-power curve within 1e-6. Planted `video_drops_frame_300` |
| 3 | `#1163.86d53f4f` | exports.test.ts (2) | the 30 PNGs decoded against their raw frames and the whole export's 300–329; the still against the live frame and frame 120. Planted `range_starts_one_frame_late` |
| 4 | `#1163.dd932548` | exports.test.ts (2) | [450, 480) from a fresh process against frames 450–479, their PCM spans and the decoded samples from 720,000. Planted `reverb_restores_without_tail` |
| 5 | `#1163.57ed0658` | exports.test.ts (2) | the whole film again and with 3 shards, each in a fresh process; the live transport's PCM over 20 s. Planted `seeds_noise_from_clock` |
| 6 | `#1163.715560ce` | exports.test.ts | `.` at frame 100 shows export frame 101; Home, then ⌥→ lands on frame 120; the revision and the session state after each of the three exports. Wrong program: the base, if any of it misses |
| 7 | `#1163.cf2adc67` | readiness.test.ts | the stop at the readiness gate naming the bed's SHA-256, no file left, `state: "BLOCKED"`. Wrong program: the base, whose stop reads no state |
| 8 | `#1163.28f11e13` | shown.test.ts | the check run's pictures and the recorded taste call; INCONCLUSIVE without them |

## The surface under test

The issue names `deep show`, deep_query, the replica, the film viewer and export.target@1, but no call API. These
tests use `deep-show run` (#393's scenario binary: one JSON scenario on stdin, one `{"ok": true, "replies": […]}`
line, exit 0) and the calls the merged suites define, unchanged, adding only what a criterion needs and the base
lacks. **Every name the issue or the design doesn't give is marked *(chosen)***; the implementer builds exactly these,
or a dispute goes to a blind redraft. Times are flicks (integers) or the time grammar's text; hashes lower-case hex.

The world (as #1162's): the agent session `sess-film` (process 4100), its tool shell 4101 and the test process 4102
that runs `deep show` (`peer: {pid: 4102, start: 1200}`), one panel `main` showing the document
`01JB1163D00000000000000001`.

| Call | Request fields | Reply fields read | New or existing |
|---|---|---|---|
| `deep show` | `peer`, `doc`, `document`, `include: ["issues"]` | `outcome` (`presented`, or any other on a refusal), `issues` | existing |
| the notice | — | an entry of `issues` with `code: "literal_time_with_tempo_map"` naming the marker `hit` and holding the offered form as a string `<bar>:<beat>b` (the field is the implementer's; `fix` suggested, as #491's suite does) | *(chosen: it arrives in `deep show`'s `issues`)* |
| `deep_query` | `session`, `doc`, `paths`, `at: [time text]` | `values[path][i]` | existing (#411); paths **`shots/<shot ID>/start`**, **`placements/<placement ID>/start`**, **`markers/<marker ID>/t`** *(chosen)*, each the resolved time in integer flicks at every `at`; `items/dot/at/pos/1` existing |
| `revisions` | `doc` | `revisions[]: {rev, hash, state}`, one `current` | existing |
| `session` | `doc`, `set?: {selection, view}` | `session` | existing (#501) |
| `export` | `doc`, `out`, `range?` (`["300f", "330f"]`, `["450f", "480f"]`, `{still: {marker: "title"}}`), `video: {codec: "h264" \| "png_seq"}`, **`audio: {codec: "pcm"}`** *(chosen, so this suite's reader decodes the sound)*, `shards?: 3` | `outcome: "exported"`, `receipt: {size, frame_rate, duration, frame_hashes, pcm_hashes}` (`pcm_hashes[k]`: the SHA-256 of frame k's span as interleaved f32le); stopped: `outcome: "stopped"`, `gate: "readiness"`, `frames_drawn`, `issues` naming the asset's SHA-256, and **`state: "BLOCKED"`** *(chosen; #502's export refusal already writes `state`)* | existing (#501) but `state` |
| `eval` | `doc`, `t` (flicks), `pixels: true` | `outcome: "evaluated"`, `snapshots[0].sha256` (a PNG in the evidence store) | existing |
| `input`, `viewer` | `panel`, `event: {type: "key", key, mods}` (`k`, `2`, `,`, `.`, `Home`, `ArrowRight` with `["alt"]`) | `viewer: {paused, frame, t, hash}` | existing (#501) |
| `media_mix` | `doc` (a media document), `segments: [{from, to, write: true}]` | `mix.segments[0].{frames, wav}` (a float WAV in the evidence store) | existing (#499) |
| `play`, `handed` | in the app world below: `at`, `panel: "main"`, `serial` / `from`, `to` | `playing`; `handed: {first, frames, sha256, wav}` | existing (#498, #499); here **the film's own panel**, the film presented by `deep show`, plays live *(chosen: the film's live transport, not a media document opened with `open`)* |

The app world for the live leg (#400's and #499's): `clock: {lead: 2 ms, check: 0.5 ms}`, two displays (120 Hz and
60 Hz), `window: [1200, 700]`, the panel `main` at `[0, 0, 960, 540]`; every call at a flick; the film shown at flick
2, your click at 1 s (its press's `serial`), Play at 1.1 s, `handed` over [0, 20 s) asked at 23 s.

**The MP4 this suite reads** (`helpers.ts` `readMp4`, "the test's own reader"): ISO BMFF boxes; each track's `mdhd`
timescale, `hdlr`, `stsd`'s first entry, `stts`, `ctts`, `stsc`, `stsz`, `stco`/`co64` and `edts/elst`. A frame is a
video sample placed by its presentation time (decode time plus composition offset, less the edit list's media start,
plus a leading empty edit); no video codec is decoded. The sound must be uncompressed PCM (`fpcm` or `ipcm` with
`pcmC`, QuickTime's version 2 `lpcm`, `sowt`, `twos`) on a timescale equal to its sample rate, read through the chunk
tables. The base's MP4 writer already writes float PCM as `fpcm`.

## Planted programs

Each is a value of the scenario's `planted` field (as #1162's suite reaches #670's), so the export's own planted list
(`deep-show run --planted`) may hold the new ones too.

| Name | Criterion | The wrong program | At the base |
|---|---|---|---|
| **`video_drops_frame_300`** *(chosen)* | AC2 | the video target's writer leaves frame 300 out of the MP4: 599 video samples, every other frame at its own presentation time (frame 299's sample lasts two frames); the frames drawn, the receipt and the sound unchanged | absent (`bad_input`) |
| **`range_starts_one_frame_late`** *(chosen)* | AC3 | a range export [in, out) draws frames [in + 1, out + 1): 30 frames, each one late | absent |
| `reverb_restores_without_tail` | AC4 | #499's: on a seek the reverb restores its checkpoint with its delay lines (its tail) emptied; in a cold jump, the state the jump starts the reverb from at 15 s (a restored checkpoint or the pre-rolled tail) without its tail | exists, but in a fresh process the base has no checkpoint to restore and renders the reverb from 0, so the plant changes nothing there |
| `seeds_noise_from_clock` | AC5 | #670's renderer that adds noise seeded from the system clock to each frame, extended to the frames an export draws | exists for render-back snapshots only |

What each must fail, naming: frame 300 (a failure line starting `frame 300:` from this suite's reader, or the export's
own refusal naming frame 300); frame 300 (`frame 300:` from the range check); the processor `verb` at sample 720,000;
the first frame that differs between the two planted runs (the index this suite computes).

## Fixtures

Made at test time by `helpers.ts`, truth by construction; nothing personal, the sound CC0.

- **The film** (`film(bed)`), as the agent sends it (no `layers`, no item `layer`): `profile: "film"`, 1920 × 1080,
  `camera: "cam"`, `transport: {span: "20s", frame_rate: [30, 1], sample_rate: 48000}`, `tempo_map: {segments: [{at:
  "0s", bpm: 120, meter: [4, 4], span: 40, ramp: "none"}]}` (ten 4/4 bars). Items: `cam` (camera@1, orthographic,
  target [960, 540, 0], view width 1920), `backdrop`, `floor`, `post-left`, `post-right` (rect@1), `dot` (circle@1, r
  28, at [760, 856]) and `title` (text@1 "The first film", 96 px, `adjust.opacity` 0). Marker `title` (section, `3:1b`).
  Shots: `shot-push` (`1:1b`–`4:1b`, push onto target [960, 540], view width 1600), `shot-pan` (`4:1b`–`8:1b`, pan
  onto [1160, 540], 1600), `shot-pull` (`8:1b`–`11:1b`, pull back from [960, 540], 1920), each on `cam`; transitions
  `push-to-pan` (cross_fade, 0.5 s) and `pan-to-pull` (cut). Clips: `bounce` (span 1 s; `y` on `slot:ball/at/pos/1`:
  556 at 0, 856 at 0.5 s, 556 at 1 s, Bézier in and out) and `title-card` (opacity 0 → 1 and y 240 → 200 over 0.5 s on
  slot `text`). Placements: `bounce-dot` (`bounce` on `dot`, start `2:1b`, `repeat: {count: 8}`) and `title-in`
  (`title-card` on `title`, start `3:1b`, `extend: {before: none, after: hold}`). Sound: asset `bed` by SHA-256 with a
  CC0 license; strip `bed` (track 1, `src: {asset}`, start 0, in 0, out 6 s, `loop: true`, bus `bed`); bus `bed`
  (processors `[verb]`, out master); processor `verb` (`reverb`, `ir: {decay: 2.5, size: 0.7, damping: 0.4}`, mix 0.3).
- **The bed**: a mono 16-bit 48 kHz WAV of 6 s (288,000 samples, the loop region its whole length): 220 Hz and 330 Hz
  under a slow swell, each a whole number of cycles, peak 0.17.
- **The impulse**: a mono 16-bit WAV, 0.25 at sample 0 then 0.25 s of silence; and the two media documents AC2 renders
  with `media_mix`: the film's sound to `21s` (`filmSound`) and the impulse through the bed's bus (`impulseSound`).
- AC1's variants: the cue `hit` (kind cue) at `12.5s`, then at the offered form; the pull back starting at `7:1b`.

## Legs that read BLOCKED or INCONCLUSIVE

- AC8 is INCONCLUSIVE without the check run's five files in `docs/evidence/1163/`, without `TASTE.json`, or with a
  call made on other files. No other leg depends on a reference Mac, a timing or a person; nothing is ever a pass by
  being skipped.

## The taste call

The check run is **`node scripts/checkpoint-1163-shots.mjs`** *(chosen; the implementer writes it, as
`scripts/checkpoint-1162-shots.mjs` was written for #1162)*: it exports the film, takes the pictures from the exported
file and the viewer, and writes them into **`docs/evidence/1163/`** *(chosen)*:

| File *(chosen)* | What it shows |
|---|---|
| `push.png` | the push shot with the bouncing dot and the title (frame 150, 5 s), 1920 × 1080, decoded from the MP4 |
| `pan-cross-fade.png` | the cross-fade into the pan (frame 180, 6 s), 1920 × 1080, from the MP4 |
| `pull-back.png` | the pull back with the title and the resting dot (frame 510, 17 s), 1920 × 1080, from the MP4 |
| `viewer-step.png` | the film viewer after `.` from frame 100, at frame 101 |
| `film-recording.mp4` | a recording of the exported MP4 (it or a smaller copy of it) |

The files are attached to the PR and shown in the session; the one call is recorded later, by someone else, in
`tests/acceptance/1163/TASTE.json`: `{"issue": 1163, "criterion": "#1163.28f11e13", "verdict": "looks_right" |
"looks_wrong", "who", "when" (ISO 8601), "screenshots": {<each of the five names>: sha256}, "note"?}` (#501's form).
This job writes no TASTE.json.

## Readings where the issue leaves a choice

- **"The bed ends on a 5 ms equal-power fade whose 240 samples follow the curve within 1e-6"**, in an MP4 whose bed
  plays through a reverb. The master's last 240 samples mix the faded bed with the reverb's wet sound, so they can't be
  held to the curve alone. The test holds the fade's own change to it, exactly: y is the MP4's PCM, z the same sound
  rendered by `media_mix` with the transport running to 21 s (the bed doesn't end at 20 s, so it has no fade there),
  and h the bed's bus's response to the impulse; then for each channel and i = 0 … 239, y − z at sample 959,760 + i
  must equal Σⱼ h(j) · (cos(π/2 · (i − j)/240) − 1) · bed(959,760 + i − j) within 1e-6, where bed(n) is the asset's
  sample n mod 288,000 as a decoder gives it (÷ 32,768). The curve and the 240 samples are #499's AC4 reading (1 at the
  fade's first sample, toward 0 at the span's end). The 0.1 s before the fade must be equal in y and z, so the twin is
  the film's sound. It holds for any linear bus chain while the master's limiter doesn't engage (the bed peaks at
  0.17; the master's ceiling is −1 dBTP); the fade must change the PCM by more than 0.001, or it proves nothing.
- **"Frame k's audio starting at sample k × 1,600"**: video sample k presented at exactly k/30 s, the sound presented
  from its sample 0 at time 0 at 48 kHz, and the MP4's samples [k × 1,600, (k + 1) × 1,600) hashing (interleaved f32le,
  SHA-256) to the receipt's `pcm_hashes[k]` for every k.
- **"Delivers 599 frames and fails, naming frame 300"**: a delivered MP4 fails this suite's reader with `frame 300: no
  video sample presents it`; the design also lets the export's own fidelity check refuse it ("a writer that drops one
  frame, which its fidelity check must fail"), which passes the plant's test when its reply names frame 300.
- **"Equal to their raw frames"**: each decoded PNG's BGRA8 rows hash (BLAKE3, this suite's port) to the range's
  receipt hash at its index, and to the whole export's at 300 + its index.
- **"The settled live frame at that marker"**: `eval` with `pixels: true` at the marker's flick (2,822,400,000), as
  #501 read "the live frame"; its PNG, decoded, hashes equal to the still's and to the whole export's frame 120.
- **"A cold jump to 15 s with the reverb's tail pre-rolled"**: a fresh `deep-show run` whose only export is [450, 480);
  "equals … by hash" is the receipt's frame and PCM hashes against the whole export's 450–479, and the range MP4's
  decoded samples against the whole MP4's from 720,000, sample for sample. **"Differs at the first sample after 15 s"**
  is the first differing sample being 720,000 (15 s exactly). **"Naming the processor"**: the film has one processor
  on the bed's way to the master, `verb`, so a sound difference after the jump names it, with the sample.
- **"Again in a fresh process, and with 3 shards"**: two more fresh runs, one whole export each (1 shard, then
  `shards: 3`), compared with run A's receipt: every frame hash, and the PCM hashes all equal. **The plant**: the same
  two runs, both planted, compared with each other; the failure names the first frame that differs, the index where
  the two receipts' frame hashes first part.
- **"The PCM the live transport hands the device gate over the 20 s"**: `handed` over [0, 20 s) of the film in its own
  panel after Play, its SHA-256 equal to the SHA-256 of the MP4's samples [0, 960,000) as interleaved f32le.
- **"`.` while paused at frame 100"**: `2` (two tenths of the 20 s span: 4 s, frame 120), then `,` twenty times, the
  viewer read as paused at frame 100; then `.`. **"⌥→ from frame 0"**: `Home`, read at frame 0, then ⌥→, read at frame
  120 at 2,822,400,000 flicks showing export frame 120. The test also requires the export's frames 100 and 101, and 0
  and 120, to differ, so a step is visible.
- **"After every export"**: after each of run A's three exports, the current revision (its `rev` and `hash`) and the
  `session` reply equal what they were before the first, and the session equals the state set.
- **"The bounce clip's at 0"**: the clip's value at its local time 0 is its first key's value, 556; each of the eight
  reads must be that number (`Object.is`). The dot rests at 856, so a placement that doesn't apply there reads otherwise.
- **The shots' times** are written in bar:beat, as the Scope gives them ("a push shot for bars 1 to 3"; Shot: `start,
  end: time | marker`; Time and the flick: `"2:1b"` through the tempo map), never as literal seconds, which would raise
  the very notice AC1 asks about. The base refuses them (`bad_time`); this suite holds the film to the design. The pull
  back ends at `11:1b`, the downbeat where an eleventh bar would start, the map's end.
- **The overlap** moves the pull back's start to `7:1b`, two bars into the pan, with only the cut joining them, in a
  revision that otherwise holds every ID the good one does (the cue `hit` included), since a whole revision that
  leaves an ID out without naming it in `removes` is refused for that (`unintended_removal`) before its shots are
  compared. "Refused naming both" is a reply other than `presented` whose JSON names `shot-pan` and `shot-pull`.
- **"The bed's asset removed from the store"**: the WAV is written into the evidence store and removed before the run
  that presents and exports the film (each run is a fresh hub reading the store as it is). "The run reads BLOCKED" is
  the stop reply's `state`.
- **`deep_query`'s times** are text (`"2s"` … `"9s"`), since its `at` takes the time grammar's text; they are
  (4 + 2k) × 352,800,000 flicks.

## Not tested

- Loudness profiles, captions, export guards and scores: the issue leaves them to their own issues.
- The camera's poses and the cross-fade's pixels (#493's suite), the bounce between its wraps, the title's fade, the
  timecode track, the receipt's `start: cold` and its timings: no criterion here reads them.
- AAC sound: the MP4s are exported with PCM, which this suite's reader decodes; an AAC delivery isn't compared.

## Not settled

- The fade reading above needs the bed's bus to act linearly on the fade's change; a nonlinear processor on that bus
  would need another reading.
- `11:1b` sits exactly on the tempo map's end; a resolver that refuses the map's end beat would refuse the film.
- Whether a stopped export carries `state: "BLOCKED"` or another field saying the same; this suite reads `state`.
- `video_drops_frame_300` may be refused by the export's own fidelity check rather than delivered; both are accepted
  when they name frame 300.
- `reverb_restores_without_tail` in a cold jump: a fresh process may render the reverb from 0 rather than restore a
  checkpoint, as the base does, and then a plant that only empties restored checkpoints changes nothing. The plant
  must empty whatever state the jump starts the reverb from at 15 s, or the criterion's wrong program isn't run.
- The viewer's `hash` and `eval`'s snapshot are read as #501 defined them; a viewer that shows the film scaled into its
  panel still hashes the film's frame at its own size.
