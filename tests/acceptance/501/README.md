# Acceptance tests for #501: export.target@1, the video and png targets, range exports and the film viewer

Written first, from issue #501 (as of November 9, 2026: its Scope, its Export and Transport: film viewer fields, its
17 acceptance criteria and its Proof line), its oracle map, the design sections it links and those they lean on, and
the base commit `2721ca7b` ("Merge pull request #2088"), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

What was read:

- The issue, live (`gh issue view 501 --repo windoliver/deepbuild`), and its oracle map
  (`doneright/oracles/issues/501.md` in DeepBuildAI/deepbuild, branch `doneright`): upstream tests inform criteria 2
  and 8 (flicks: the whole-flick frame and sample lengths) and 11 (BLAKE3's `test_vectors.json` and reference
  implementation at `f3149ec5bb`); the other criteria are ours.
- `docs/canvas-primitives.md`: Time and the flick (the valid-rates rule; "Frame k's audio starts at ⌊(start + k·Δ) × sr
  ÷ 705,600,000⌋ exactly"; "rounding each frame on its own drifts 12,000 samples over 30,000 frames"; files write a
  timescale per track, never flicks); Scope and input classes (session state: selection, hover, cutaways as view
  inputs); Item fields (`visible`, `adjust.opacity`); Marker (`kind: section`); Transport: film viewer; Device gate
  (`stats: {underruns, underrun_time, latency}`); Export (every field, its receipt, its Semantics: readiness gate,
  shards, BLAKE3 on the GPU over BGRA8 rows, all-or-nothing with a temporary name, `export.target@1 {name, writer,
  fidelity, reader}` declared by the core, filled only by canvas modules, png's fidelity exact); Export: encode job;
  Check input: export kinds.
- `docs/technical-design.md`: Films and figures on the canvas; Platform seams (the linux/amd64 container counts as the
  other architecture for CPU checks, recorded as emulated; the software adapter, `adapter.software: true`); budgets and
  The reference Macs (Mac15,7, Mac15,12 and Mac17,10, on mains power, Low Power Mode off, thermal state nominal).
- At the base: `AGENTS.md`; `crates/deep-show` (`time.rs`: `export` is a rates-only plan, `play`, `determinism`;
  `media.rs`: `media_import`, `media_export`, `workers`; `gate.rs`; `input.rs`; `main.rs`: the call list and the
  startup `--planted` argument; `Cargo.toml`'s features); `scripts/benchmark.mjs` (`fingerprint`, `validateBudgets`);
  `scripts/proof-change.mjs` (criterion IDs); the suites `tests/acceptance/499/` (video, mix, module), `490/`, `493/`,
  `532/`, `66/`, `200/`, `488/`, `424/` as patterns.

## Run them

Put Node 24.22 and the pinned Rust toolchain first on PATH, then run one file at a time (each file builds the
`deep-show` feature sets it lists once, in `beforeAll`):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
node node_modules/vitest/vitest.mjs run --root tests/acceptance/501 clock.test.ts      # AC2, AC8
node node_modules/vitest/vitest.mjs run --root tests/acceptance/501 timecode.test.ts   # AC12, AC13, AC14
node node_modules/vitest/vitest.mjs run --root tests/acceptance/501 exports.test.ts    # AC1, AC9, AC11, AC16, AC17
node node_modules/vitest/vitest.mjs run --root tests/acceptance/501 scope.test.ts      # AC3
node node_modules/vitest/vitest.mjs run --root tests/acceptance/501 seal.test.ts       # AC6 (three builds)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/501 viewer.test.ts     # AC5, AC7
node node_modules/vitest/vitest.mjs run --root tests/acceptance/501 across.test.ts     # AC10 (Docker)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/501 budgets.test.ts    # AC4 (600 s on a reference Mac)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/501 taste.test.ts      # AC15
```

Every file but `seal.test.ts` builds only `full`, so after the first file the others reuse cargo's build.

## Criteria to tests

IDs are the first 8 hex digits of the SHA-256 of each criterion's text, trimmed and with white space collapsed
(`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #501.<id>`.

| AC | ID | File | Tests |
|---|---|---|---|
| 1 | `#501.b64babc3` | exports.test.ts | range [48, 168) and a still at marker `s2`: size, rate, duration; still = live frame |
| 2 | `#501.c0a30641` | clock.test.ts | 40 × 13 pairs; planted `span_rounds_each_frame` |
| 3 | `#501.db25650c` | scope.test.ts | every sealed target; planted `target_exports_selection`, `target_writes_baked_channel` |
| 4 | `#501.20b3a55a` | budgets.test.ts | perf-lane task vs merge base; 600 s, 32 voices, worker memory |
| 5 | `#501.51510fec` | viewer.test.ts | `.` at frame 100 shows export frame 101; ⌥→ to frame 168 |
| 6 | `#501.bf5a3338` | seal.test.ts | core owns it; video and png; planted `target_reader_is_writer`; build without media; planted layout |
| 7 | `#501.bc463962` | viewer.test.ts | 24 fps film and a figure on a 120 Hz display |
| 8 | `#501.c24595f7` | clock.test.ts | 44.1 kHz spans; planted `span_rounds_start` |
| 9 | `#501.d9bb8d6a` | exports.test.ts | png_seq decoded = raw; planted `png_premultiplies_straight` |
| 10 | `#501.187057b7` | across.test.ts | macOS arm64 vs linux/amd64 reading; planted `mixer_linux_one_step` |
| 11 | `#501.ce90a876` | exports.test.ts | GPU hash = CPU BLAKE3, hardware and software, vectors; planted `chunk_tree_wrong_order` |
| 12 | `#501.b80fff7d` | timecode.test.ts | drop-frame labels; planted `drop_frame_every_tenth_minute` |
| 13 | `#501.65512eef` | timecode.test.ts | MP4 and ProRes timecode tracks, last label, refusal; planted `timecode_track_zero` |
| 14 | `#501.dfbf3d0b` | timecode.test.ts | range starts at 01:00:02:00; planted `range_restarts_timecode` |
| 15 | `#501.4abc923a` | taste.test.ts | the recorded taste call |
| 16 | `#501.8065fd70` | exports.test.ts | 1 and 3 shards |
| 17 | `#501.73117ad9` | exports.test.ts | readiness gate, no file left; planted `export_starts_then_stops` |

## The surface under test

The issue names the export, its targets, its receipt, the film viewer's keys and the seal, but no call API. These
tests drive `deep-show run` (one JSON scenario per stdin line, one answer line `{"ok": true, "replies": [...]}`, as
#393, #488 and #499 left it), its startup `--planted <name>` argument (#200's; an unknown name answers `bad_input`,
exit 2), its Cargo features for build sets and test modules, and the seal's startup refusal (#305: one line `{"ok":
false, "code": "seal_refused", "reason", "modules", "registry"?, "entries"?, …}`, exit 2). No new binary or
subcommand. **Every name below that the issue or the design doesn't give is this job's choice**, chosen from the
design's words and shaped like the neighbouring calls; the implementer builds exactly these, or a dispute goes to a
blind redraft. Times are flicks (integers) or the design's time literals; rates are `[p, q]`; hashes are lower-case
hex.

| Surface | Request fields | Reply fields read | New or existing |
|---|---|---|---|
| scenario | `evidence`, `sessions`, `processes`, `panels`, `docs` (doc → panel), `calls` | `ok`, `replies` | existing (#393, #499) |
| `deep show` | `peer`, `doc`, `document`, `include: ["issues"]` | `outcome: "presented"` | existing |
| `export`, plan form (no `out`) | `doc`, `frame_rate`, `audio.sample_rate`, **`frames: [k]`**, **`timecode: {start?, drop_frame?}`** | `outcome: "planned"`, **`frames: [{frame, samples: [first, end), timecode?}]`** | extends #488's plan |
| `export`, delivery form | `doc`, **`out`**, **`range`** (absent = whole, `["48f", "168f"]` = [in, out), `{still: {marker}}`), `video: {codec, alpha?}`, `audio: {codec}`, `timecode: {start, drop_frame?}`, `shards`, **`adapter: "software"`**, **`readback: true`** | `outcome: "exported" \| "refused" \| "stopped"`; `receipt: {size, frame_rate, duration (flicks), frame_hashes (BLAKE3), pcm_hashes, timecode: {start, last}, adapter: {name, software}, hidden: [ID]}`; with `readback`, **`readback.frames: [sha256]`** (each frame's raw BGRA8 bytes in the evidence store); stopped: **`gate: "readiness"`, `frames_drawn`, `issues`** (naming the asset's SHA-256); refused: `code` and text naming `drop_frame` and the rate | new; the issue's fields and receipt |
| `eval` | `doc`, `t`, `pixels: true` | `outcome: "evaluated"`, `snapshots[0].sha256` (a PNG in the evidence store) | existing (#387) |
| `media_import` | `path` (an exported file) | `asset.probe.streams[]`, one with **`type: "timecode"`, `start_frame`** | extends #498's probe |
| `media_mix` | `doc` (a media document), `segments: [{from, to, write: true}]` | `mix.segments[0].wav` (a float WAV in the evidence store) | existing (#499) |
| **`frame_hash`** | `frames: [{size: [w, h], bytes: sha256 in the evidence store}]`, `adapter?: "software"` | `outcome: "hashed"`, `hashes: [BLAKE3]`, `adapter.software` | new: the export's GPU hash pass on given frames |
| **`cross_machine`** | `audio: [wav sha256, wav sha256]` | `outcome: "read"`, `peak_dbfs` (number, or null when identical), `verdict` | new: the cross-machine audio check |
| `registries` | — | `registries[]` with `name: "export.target@1"`: `kind: "registry"`, `owner`, `entries[]: {name, module, writer, reader, fidelity: [check kind], hidden: "left_out" \| "listed"}` | extends #200's listing |
| `registry` | — | `modules` | existing |
| `kit` | **`registries: ["export.target@1"]`** | **`registries[]: {registry, verdict, entries: [{name, verdict, failures}]}`** | extends #138's kit call |
| **`session`** | `doc`, `set?: {selection: [ID], view: {<item ID>: params}}` | `session` (the viewer's session state for the document) | new |
| `revisions` | `doc` | `revisions[]: {hash, state}` | existing |
| `input` | `panel`, `event: {type: "key", key, mods}` (`"."`, `"4"`, `"k"`, `"ArrowRight"` with `["alt"]`) | — | existing (#383) |
| **`viewer`** | `panel` | `viewer: {paused, frame, t, hash}` (`hash`: BLAKE3 of the shown frame's canonical raw BGRA8 buffer) | new: the film viewer's state |
| `play` | `doc`, `display_hz: 120`, `to`, **`presented: true`** | `outcome: "played"`, **`presented: [{at, t, hash}]`** (every presented frame: display time, time evaluated, shown frame's BLAKE3) | extends #488's `play` |
| **`soak`** | `media` (a media document), `seconds` | `outcome: "played" \| "refused"` (`code: "no_output"`), `seconds`, `stats.underruns` | new: a live play through the device gate on the default output, on the real clock |
| startup refusal | `deep-show run [--planted <name>]` | exit 2, `code: "seal_refused"`, `modules`, `registry`, `entries` | existing (#305, #200) |

### Files the export writes

`out` is the export's output path. A video export writes one file there (`.mp4` for h264, `.mov` for ProRes 4444).
A png_seq export writes a folder at `out` holding one PNG per frame, 8-bit RGBA (or RGB) and not interlaced, whose
names sort in frame order. A still (`range: {still: …}`) with png_seq writes one PNG there. Every test gives each
export a fresh folder, so a temporary name the export uses must sit in `out`'s folder (or inside `out`) for
criterion 17's "no file at its temporary name" to be checked; the test fails on any file left anywhere in that folder.

### Cargo features of `deep-show`

| Feature set | What the build holds |
|---|---|
| `full` | the shipped full set (existing): export.target@1 declared by the core, filled by media with `video` and `png` |
| `full,test-leave-out-media,test-export-target` | the full set without the media module (`test-leave-out-media`, existing since #499) and with **`test-export-target`**: a test canvas module `test.export` that fills export.target@1 with one target, **`test.raw`**, whose reader is not its writer |
| `full,test-leave-out-media,test-export-target,test-export-target-in-media` | the same with **`test-export-target-in-media`**: the planted layout that declares export.target@1 in the media module's crate instead of the core's; its seal refuses, naming media |

### Planted programs (`deep-show run --planted <name>`)

| Name | What it does wrong | Criterion |
|---|---|---|
| `span_rounds_each_frame` | each frame's sample count is rounded on its own (1,602 at 30000/1001 fps and 48 kHz) and each span starts where the last ended | 2 |
| `span_rounds_start` | each frame's audio start is rounded to the nearest sample instead of floored | 8 |
| `target_exports_selection` | the png target's writer exports only the session's selected items | 3 |
| `target_writes_baked_channel` | the png target's writer writes a baked channel back into the document (a new revision) | 3 |
| `target_reader_is_writer` | media fills export.target@1's `png` with a fidelity reader that is its own writer | 6 |
| `png_premultiplies_straight` | the png writer stores premultiplied color under `alpha: straight` | 9 |
| `mixer_linux_one_step` | the mixer's Linux build adds one 16-bit step (1/32,768) to every sample; other builds are unchanged | 10 |
| `chunk_tree_wrong_order` | the GPU BLAKE3 pass joins each parent's two children in the wrong order | 11 |
| `drop_frame_every_tenth_minute` | the drop-frame labeller drops two frame numbers in every minute, the tenth minutes too | 12 |
| `timecode_track_zero` | the video writer writes the timecode track starting at frame 0 whatever the start | 13 |
| `range_restarts_timecode` | a range export labels its first frame with the start label | 14 |
| `export_starts_then_stops` | the readiness gate is skipped: the export starts and stops at the missing strip's first frame, leaving its partial file | 17 |

Each planted test asserts this suite's own check fails and that a failure names what the criterion says it names:
the frame and the 12,000-sample drift (2), frame 2 (8), the target `png`, by this suite and by the kit (3), `png` in
the seal's refusal (6), frame 0 (9; this suite's decode or the export's own issue), the first frame (11), frame 17,982
(12), the timecode track (13), the first label (14), the asset (17). For 10 the planted mixer must read INCONCLUSIVE;
a check that gives it PASS or FAIL fails the test.

## Fixtures

All made at test time, with no outside tool; no personal data, licenses CC0.

- **The film** (`helpers.ts` `film`): a `film` document, 320 × 180, `transport: {span: "10s", frame_rate: [24, 1],
  sample_rate: 48000}`, 240 frames; a ground rect, an accent block sliding 0 → 280 u and an ink bar growing over 10 s
  (channels on `params/box`), so every frame differs; section markers `s1` 0 s, `s2` 4 s, `s3` 7 s (frames 0, 96,
  168); one strip `tone` (`{track: 1, src: sha256, start: "0s", in: 0, out: 10 s, rate: 1}`) on a 10 s stereo 16-bit
  WAV of 440 and 660 Hz in the evidence store, listed in `assets`. It stands for "the export kinds' fixture film" and
  "that film" of criteria 13 and 14. With `missing`, a second strip `gap` (track 2, from 1 s, frame 24) names an asset
  the store never held.
- **The alpha film** (`alphaFilm`): 64 × 64, 24 fps, 1 s, no ground; an accent block at `adjust: {opacity: 0.5}` and a
  sliding ink block. The test checks frame 0 holds 50% alpha in color.
- **The scope fixture** (`scopeFilm`): a 3D `film`, 160 × 90, 24 fps, 1 s, `requires: {modules: {scene3d: "^1"}}`; a
  perspective camera; boxes (`mark.box@1`) `sel`, `core` (turning by a channel on `at/rot/1`) and `ghost`
  (`visible: false`, the hidden item); a `cutaway@1` `cut` with `class: "view"` cutting nothing by default. The session
  state set: `{selection: ["sel"], view: {cut: {planes: [{normal: [1, 0, 0], offset: 0}]}}}`.
- **A figure** (`figure`): `profile: "figure"`, 160 × 90, a dot sliding over 2 s, no frame rate of its own.
- **The film's sound** (`filmSound`): #499's media document, two mono tone WAVs (440 Hz 4 s, 550 Hz 3 s from 0.5 s),
  panned −0.4 and 0.6, for `media_mix` on both machines.
- **The soak** (budgets): 32 strips, each a 2 s stereo tone at its own pitch, looped over 600 s.
- **BLAKE3's vectors**: the 1,024-, 4,096- and 102,400-byte inputs (bytes 0 … 250 repeating) with their published
  32-byte digests from `test_vectors.json` at `f3149ec5bb`, loaded as 16 × 16, 32 × 32 and 160 × 160 BGRA8 frames.
  The suite's CPU BLAKE3 (`helpers.ts`, ported from the reference implementation, CC0-1.0 OR Apache-2.0) checks itself
  against them, and the empty input, before it judges anything.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- AC4 is INCONCLUSIVE, without the 600 s run, off a reference Mac (Mac15,7, Mac15,12 or Mac17,10 by `sysctl`, read
  through `scripts/benchmark.mjs` `fingerprint`) or when not on mains power, with Low Power Mode on or the thermal state
  not nominal; BLOCKED when `soak` answers `no_output`. The perf-lane part runs first on every machine.
- AC10 is BLOCKED without Docker or without the linux/amd64 image `rust:<rust-toolchain.toml's channel>-slim-bookworm`
  (nothing is pulled); a cargo failure in the container is a FAIL.
- AC11 is BLOCKED when no software adapter can be opened (`export` or `frame_hash` with `adapter: "software"` refused
  with a code naming the adapter), and INCONCLUSIVE off a reference Mac (the criterion's hardware leg), each only after
  every hash that did run was compared.
- AC13's ProRes leg is BLOCKED off macOS, after the MP4 leg and the refusal ran.
- AC15 is INCONCLUSIVE without the four pictures in `docs/evidence/501/` or without a recorded call on exactly them.

## The taste call

The check run puts `range-export.png` (a frame of the range export, from the exported file), `still-at-marker.png`
(the still at marker `s2`), `viewer-frame-101.png` (the film viewer at frame 101) and `range.apng` (a recording of the
exported range) in `docs/evidence/501/`, attaches them to the PR and shows them in the session. The call is recorded in
`tests/acceptance/501/TASTE.json`: `{issue: 501, criterion: "#501.4abc923a", verdict: "looks_right" | "looks_wrong",
who, when (ISO 8601), screenshots: {<name>: sha256}, note?}`. This job writes no TASTE.json.

## Readings where the issue and design leave a choice

- A still's `duration` is accepted as 0 or one frame (29,400,000 flicks); the range's must be exactly 120 frames.
- "The still equals the live frame": the still's decoded PNG equals `eval`'s canonical snapshot at the marker's time,
  RGBA byte for byte, and its BGRA8 hashes to the still's receipt frame hash.
- "Byte-identical" output (AC3) compares every file the export wrote, by path and SHA-256: the criterion's own demand.
  Every other comparison is of decoded or raw frames and PCM, never encoded bytes.
- AC5 opens the viewer, presses `k` first only if it isn't paused, then `4` (a tenth of the span: 4 s, frame 96) and
  `.` four times to reach frame 100.
- AC7 reads the film's and the figure's presented frames over [0, 2 s] on one virtual 120 Hz display (one `play` each).
- AC10's "export kinds' fixture film's PCM" is the film's sound rendered by `media_mix` (the export's sound), since a
  frame-drawing export in the container would need a GPU; the check under test is `cross_machine`.
- The media worker (AC4) is any process the run starts whose command line names a decode or media worker; its peak
  resident memory is read with `ps`, and 200 MB is 200,000,000 bytes.
