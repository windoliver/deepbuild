# Acceptance tests for #157: export guards — no blank or broken frames, verified colour, a delivery true to its frames, and a complete streaming profile

Written first, blind, from issue #157 (as of November 11, 2026: its Scope, its Fields, its 29 acceptance criteria and
its Proof line), its oracle map, the design sections it links and those they lean on, and the base commit `35df4523f`
(`35df4523f7adcf2058fbd1270e9b840e961a8534`, "Merge pull request #2280"), by a job that never saw an implementation;
none existed, and no other worktree, branch or PR was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The Oracle lane, criteria 8,
9, 10, 12, 23 and 24, is in `tests/acceptance/157-oracle/`.

## What was read

- The issue, live (`gh issue view 157 --repo windoliver/deepbuild`). Each test's name starts `AC<n> #157.<id>`, the
  first 8 hex digits of the SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space collapsed
  (`scripts/proof-change.mjs`, `criterionId`).
- The oracle map (`doneright/oracles/issues/157.md` in DeepBuildAI/deepbuild, branch `doneright`): FFmpeg FATE tests at
  `24e860f6d3` for criteria 8, 9, 10, 12, 23 and 24; the other 23 are ours ("No upstream test").
- `docs/canvas-primitives.md` at the base: Export (its fields, its receipt, its Semantics paragraph in full), Export:
  encode job, Decode worker, Check input: export kinds, Check input (the input shape, `except`), Asset: licences
  through jobs, Loudness and caption profiles, Narration and captions, Transport (`loop: none | wrap | ping_pong`), Shot,
  Marker (sections become chapters), Transition, Look `look@1`: print finishes (grain), Processor (the limiter's
  lookahead), the registries row of `export.target@1`.
- `docs/technical-design.md`: Device gate, capture and export; Narration, captions and profiles; Lease; Criteria to
  tests, both ways; Wrong programs; The edit guard; Dogfooding. `AGENTS.md`.
- Two rules come from the issue alone, the design not holding them yet: film.blank's `flat` rule and `film.wrap`.
- At the base, for surfaces only: `crates/deep-show/src/export.rs` (the delivery `export`, its receipt, its refusals —
  `export_size_odd` exists for a call's `size`, with no nearest even size — its temporary name `.<name>.part` beside
  `out`, raw BGRA8 frames written to the temp folder), `main.rs` (the scenario's `planted`, `export_planted`, the
  startup `--planted`), `media.rs` (`media_import`, `media_decode`, the worker's planted names), `narration.rs`,
  `kit/export.rs` (the kit's report), `determinism.rs`; `crates/deep-codecs/src/{lib,mov,export}.rs` (the probe's
  `color`, the decode's `format: bgra`, `moov` written before `mdat`, `colr` nclx, `edts`/`elst`, `stss`, a track's
  timescale in its rate's own terms); `crates/deep-canvas-media/src/{delivery,captions}.rs` (only `r128` and `none` at
  the base); and the suites `tests/acceptance/501/`, `502/`, `502-oracle/`, `498/decode/`, `1818/`, `1897/`, `407/`,
  `154-redraft/` as patterns and, by import, for their helpers.

## Run them

Put Node 24.22 and the pinned Rust toolchain first on PATH, install once, then run one file at a time (each file builds
the `deep-show` feature sets it lists once, in `beforeAll`):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 blank.test.ts --testTimeout=600000      # AC1, AC27
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 finite.test.ts --testTimeout=600000     # AC2, AC26 (full,test-export-guards)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 color.test.ts --testTimeout=600000      # AC3, AC13 (FFmpeg)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 fidelity.test.ts --testTimeout=600000   # AC4, AC18, AC20, AC21
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 loudness.test.ts --testTimeout=600000   # AC5, AC11
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 licences.test.ts --testTimeout=600000   # AC6
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 lease.test.ts --testTimeout=600000      # AC7
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 delivery.test.ts --testTimeout=600000   # AC15, AC16, AC17, AC19 (FFmpeg)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 shards.test.ts --testTimeout=600000     # AC22
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 disk.test.ts --testTimeout=600000       # AC25 (macOS hdiutil)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 wrap.test.ts --testTimeout=600000       # AC28
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 budgets.test.ts --testTimeout=600000    # AC14 (reference Mac)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/157 taste.test.ts --testTimeout=600000      # AC29
node node_modules/typescript/bin/tsc -p tests/acceptance/157/tsconfig.json                                 # type-check (exits 0)
```

Every `it` passes a 3,600,000 ms timeout: a first cargo build takes many minutes. Every file but `finite.test.ts`
builds only `full`, so after the first file the others reuse cargo's build. Temp folders are removed after each test
or file; no process is stopped by name or port (a watched run is stopped only by its own PID on timeout); `disk.test.ts`
attaches its own disk images with `hdiutil` and detaches and deletes them after the file. Delete
`tests/acceptance/157/node_modules/.vite` after a `--root` run.

`scripts/lanes.mjs` needs these lines (this job writes only its two folders; the implementer adds them). Each file
builds a cargo binary and exports films through the GPU and the encode tool; `lease.test.ts` runs two exports at once
and `disk.test.ts` attaches disk images, so none may share the machine with another heavy file; `budgets.test.ts`
reads the machine's load:

```js
alone.push('tests/acceptance/157/blank.test.ts');
alone.push('tests/acceptance/157/finite.test.ts');
alone.push('tests/acceptance/157/color.test.ts');
alone.push('tests/acceptance/157/fidelity.test.ts');
alone.push('tests/acceptance/157/loudness.test.ts');
alone.push('tests/acceptance/157/licences.test.ts');
alone.push('tests/acceptance/157/lease.test.ts');
alone.push('tests/acceptance/157/delivery.test.ts');
alone.push('tests/acceptance/157/shards.test.ts');
alone.push('tests/acceptance/157/disk.test.ts');
alone.push('tests/acceptance/157/wrap.test.ts');
alone.push('tests/acceptance/157/budgets.test.ts');
alone.push('tests/acceptance/157/taste.test.ts');
timed.push('tests/acceptance/157/budgets.test.ts');
```

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it; BLOCKED and INCONCLUSIVE legs
fail with a line starting `BLOCKED:` or `INCONCLUSIVE:` (#501's `blocked()` and `inconclusive()`).

## Criteria to tests

| AC | ID | File | Tests (and the wrong program each fails on) |
|---|---|---|---|
| 1 | `#157.3b13ad66` | blank.test.ts | 1: 160 × 90, 24 fps, 2 s, frames 24–27 black: FAILs film.blank naming exactly 24–27, nothing written; with `except: [[24Δ, 28Δ]]` delivered |
| 2 | `#157.e50d5c52` | finite.test.ts | 1: the clean film's receipt has `nonfinite: []` and `adapter {name, driver, backend, software: false}`; `test.nonfinite@1` at frame 30 FAILs frames.finite naming frame 30 and item `nan`; `test.device_loss@1` at frame 100 stops with `device_lost` naming frame 100, no file |
| 3 | `#157.aad32dbe` | color.test.ts | 2: tags nclx 1-1-1 and tv on the receipt's `color_probe` (`max_error` ≤ 2), in the MP4's `colr` and by FFmpeg; planted `encode_full_range_bt601` fails `export.color` |
| 4 | `#157.6cdc16ff` | fidelity.test.ts | 2: the grain film delivered at the 40 dB floor, `encoder.quality_floor` above the grainless twin's; planted `encoder_starves_bitrate` fails export.fidelity naming its worst frames |
| 5 | `#157.77edcbb0` | loudness.test.ts | 2: streaming −14 ± 1 LU, true peak ≤ −1.0 (−2.0 above −14) on the receipt, its `delivery` and the bake of the decoded MP4; planted `limiter_without_codec_margin` FAILs with `true_peak`, the delivery's reading over −1 and the target −1 |
| 6 | `#157.155f2628` | licences.test.ts | 2: CC BY library credited through a job output → `licenses`/`credits` name it; uncredited → FAIL naming `piano_lib`; a narrator of unknown licence → BLOCKED with exactly one ask naming the narrator, nothing written |
| 7 | `#157.96eb79fd` | lease.test.ts | 2: two `deep-show run` exports started together from one session, and from two: one GPU, the leases don't overlap |
| 11 | `#157.966e730a` | loudness.test.ts | 2: r128 60 s film with its loudest 3 s 7 LU over FAILs naming `max_s` −16.0 and its time (30 or 33 s), 4.5 LU over is delivered at max_s −18.5; captions: `near.1` [72, 118), `first.1` [144, 177), `second.1` [179, 203) |
| 13 | `#157.89f63701` | color.test.ts | 3: ProRes 4444 ramp at 50% alpha meets the floor on luma and alpha by its receipt and by FFmpeg's decode against the raw frames; planted `prores_premultiplies_straight` and `h264_full_range_under_limited_tags` fail export.fidelity naming frame 0 |
| 14 | `#157.d2250c69` | budgets.test.ts | 2: a perf-lane task naming `#157.d2250c69`, valid against the merge base; on a reference Mac five runs after a warm-up: `fidelity.decode_seconds` ≤ 1.25 s for 10 s of 1080p60, `color_probe.seconds` < 1 s (`judgeLimit`) |
| 15 | `#157.0d980b87` | delivery.test.ts | 1: 1921 × 1080 asked by the call and as the document's size: refused `export_size_odd` with `size` and `nearest_even`, nothing written |
| 16 | `#157.e141bc60` | delivery.test.ts | 2: the MP4 and the MOV hold `moov` before the first `mdat` byte and the decode worker reads them; planted `muxer_writes_moov_last` fails naming `film.mp4` |
| 17 | `#157.ac47cfd5` | delivery.test.ts | 2: chapters s1, s2, s3 at frames 0, 29, 67 listed and each a sync sample (`stss`) and an FFmpeg key frame; planted `encoder_ignores_chapters` fails naming chapter `s2` |
| 18 | `#157.965b3a67` | fidelity.test.ts | 2: `video.quality` draft, standard, master → floors 35, 40, 45 dB, each met; planted `encoder_starves_bitrate` at master fails the 45 dB floor |
| 19 | `#157.e9670c64` | delivery.test.ts | 1: strip `tail` from 55 s for 8 s → warning `{end_cut, tail, 55 s, 3 s}`; `brief: {refuse: ["end_cut"]}` FAILs naming `tail`, nothing written |
| 20 | `#157.bc4ae1e7` | fidelity.test.ts | 2: the listing's video and png name export.fidelity and the kit's fidelity part PASSes each; planted `video_writer_drops_frame` fails the video entry's part naming frame 2 |
| 21 | `#157.e306d0a0` | fidelity.test.ts | 2: 1,440 frames at 24000/1001: the decode worker presents frame k at k × 1001/24000 s, 2,882,880 samples; planted `muxer_timescale_600` and `muxer_timescale_1000` fail naming frame 1 |
| 22 | `#157.71f39245` | shards.test.ts | 2: 700 frames at 30000/1001, 44.1 kHz: 1 and 3 shards give the same frame and PCM hashes and 1,030,029 samples; planted `shard_rounds_first_sample` fails at a seam, naming it |
| 25 | `#157.31dd861b` | disk.test.ts | 4: 20 MB volume → `export_disk_short` naming 23,040,000 and the free bytes; 10 GB volume → delivered, `disk.needed` 23,040,000, no raw frame seen at any poll, no PCM left; planted `export_without_disk_gate` fails naming the file; planted `export_stores_raw_frames` fails naming the folder |
| 26 | `#157.65f8ee56` | finite.test.ts | 2: `test.redraw@1` drawing another colour on its second draw of frame 1,000 stops the export in export.fidelity naming frame 1,000, no file; planted `fidelity_keeps_frames` delivers the 60 s film and fails this test naming frame 1,000 |
| 27 | `#157.96010227` | blank.test.ts | 2: frames 24–35 of only paper (luma 240/255) FAIL film.blank naming exactly them, title card and declared dip not named; the drawn twin is delivered; planted `blank_counts_dark_only` fails naming frame 24 |
| 28 | `#157.41e9b5bf` | wrap.test.ts | 4: the orbit delivered (and this suite's own MAD shows its wrap within its largest neighbour change); the line FAILs film.wrap with `wrap: [59, 0]`, `change` > `largest`; the line under `ping_pong` delivered; planted `wrap_compares_second_frame` fails the orbit |
| 29 | `#157.2b3d3587` | taste.test.ts | 1: the recorded taste call on exactly the check run's four pictures |

Criteria 8, 9, 10, 12, 23 and 24 are in `tests/acceptance/157-oracle/README.md`.

## The surface under test

`deep-show run` only (one scenario line on stdin, one answer line `{"ok": true, "replies": [...]}`), with the
scenario's `planted` key for the wrong programs (as #502's suite names them; an unknown name answers `bad_input`), one
Cargo feature for the test module, and the files an export writes. No new binary, subcommand or call. Names the issue
or the design give are used as given; **every name marked *(chosen)* is this job's**, taken from the design's words and
shaped like the neighbouring calls; the implementer builds exactly these, or a dispute goes to a blind redraft. Times
are flicks (integers) or the design's time literals; rates are `[p, q]`; hashes are lower-case hex.

### The scenario

`{"evidence", "sessions", "processes", "panels", "docs", "planted"?, "calls"}` as #501's suite writes it.
`sessions` (AC7) holds `{"sess-a": {thread, name, process: {pid, start}}, "sess-b": {…}}`, as #1818's suite writes one.

### The documents

What a film document holds here, beside what #501's and #502's films hold:

| Where | Fields | From |
|---|---|---|
| `look` | `{asset: "<id>@1", theme: "light"}` naming a look@1 in `assets` whose bytes are in the store; its `finish: [{grain: {amount: "25%", size: 1, tone: "flat", rate: 24}}]` (AC4) | design; the form is #407's suite's |
| `checks` | `[{kind: "film.blank", except: [[from, to]]}]`: a declared span, `[from, to)` in flicks | design's Check input (`except: [ID \| span]`); the span's form *(chosen)* |
| `transport.loop` | `"wrap"` or `"ping_pong"` | design (Transport) |
| `assets.<id>.license.from` | `["<asset ID>"]`: a job output's licence derived from its inputs | the issue's `license.from` on an asset entry *(chosen: where it sits)* |
| `script` | #502's: `narrator {name, license, synthetic}`, `lines.<id> {t, text, kind?, recording?}`, `captions {profile}` | #502 |
| `shots`, `transitions` | two shots `{start, end, camera, move, target, view_width}` and `{from, to, kind: "cut", span: 0}` | design; #407's suite's form |
| `markers.<id>` | `{kind: "section", t, name}` | design (sections become chapters) |
| `buses.master.processors`, `processors.tp` | `{kind: "limiter", ceiling: -1, lookahead: 0.005, release: 0.05, oversample: 4}` | #1818 |
| `requires.modules` | `{"test.guards": "^1"}` with the test items | as #501's scope film requires `scene3d` |

### `export`

The delivery form (#501), with #502's `loudness_profile` and `captions`. New request fields:

| Field | Value | From |
|---|---|---|
| `video.quality` | `"draft" \| "standard" \| "master"` | issue |
| `brief` | `{refuse: ["end_cut"]}`: standing in for the locked definition's brief, as #407's suite puts a brief beside a claim | *(chosen)* |
| `session` | the agent session that asks for the export, a key of the scenario's `sessions` | *(chosen)* |
| `size`, `shards`, `readback: true`, `doc`, `out`, `video {codec, alpha}`, `audio {codec}` | as #501 | existing |

Outcomes: `"exported"` with `receipt` (and `readback.frames: [sha256]` with `readback: true`, #501's); `"failed"`
with `issues` (#502's FAIL), nothing written; `"stopped"` with `issues` (#501's stop), nothing written; `"refused"`
with `code`; `"blocked"` with `asks`.

**A FAIL's or stop's issue** carries `check`, the export kind that raised it *(chosen field)*, and these fields, which
the tests read:

| Raised by | Fields read | Criterion |
|---|---|---|
| `film.blank` | `frames: [k]`, every blank frame | 1, 27 |
| `frames.finite` | `frame`, `item` | 2 |
| a lost device | `code: "device_lost"` *(chosen)*, `frame` | 2 |
| `export.color` | any; the test needs only `check: "export.color"` | 3, 8 |
| `export.fidelity` | `frame` or `frames`; `floor` (dB) and `worst_1pct: [{frame, psnr_y, ssim}]` for a floor; `samples: {expected, got}` for a sample count; `lag` and `priming` for an offset; `channels: [0, 1]` for channels *(each chosen)* | 4, 9, 12, 13, 18, 20, 21, 26 |
| `export.sync` | `second`, `lag` (samples) *(chosen)* | 23 |
| `film.wrap` | `wrap: [last, first]`, `change`, `largest` *(chosen)* | 28 |
| loudness (#502's `{measure, reading, target, on}`) | `measure: "true_peak"`, `on: "delivery"`; `measure: "max_s"` with `at`, the loudest window's time in flicks *(chosen)* | 5, 11 |
| credits | an issue naming the asset (`"piano_lib"`), e.g. `{code: "credit_missing", asset}` | 6 |
| a refused end cut | `strip` | 19 |
| a chapter | `chapter` (its marker ID) *(chosen)* | 17 |
| a full disk | `path`, the file or folder it was writing *(chosen)* | 25 |

**Refusals:** `{outcome: "refused", code: "export_size_odd", size: [w, h], nearest_even: [w, h]}` (`nearest_even`
*(chosen)*); `{outcome: "refused", code: "export_disk_short", needed, free, frames_drawn?}` in bytes (`needed`,
`free` *(chosen)*). **BLOCKED:** `{outcome: "blocked", asks: [ask]}`, each ask an object naming what it asks about
(`asks` *(chosen)*; the narrator's name appears in it).

**The receipt** keeps #501's and #502's fields and adds, as read here:

| Field | Shape | From |
|---|---|---|
| `nonfinite` | `[{item, frames}]`; `[]` on a clean film | issue |
| `adapter` | `{name, driver, backend, software: bool}` | issue |
| `color_probe` | `{tags, max_error, seconds}`: `tags` is `{nclx: [1, 1, 1], range: "tv"}` for H.264 and `{range: "tv", alpha: "full"}` for ProRes 4444; `max_error` in code values | issue's `color_probe {tags, max_error}`; the tags' shape and `seconds` *(chosen)* |
| `fidelity` | `{frames, samples, floor: {psnr_y}, psnr_y, ssim, alpha: {psnr, ssim} \| null, worst_1pct: [{frame, psnr_y, ssim}], decode_seconds}`: `psnr_y` and `ssim` are the lowest over the frames (`psnr_y` null when every frame decodes exactly), `samples` per channel | issue's `fidelity {frames, samples, psnr_y, ssim, worst_1pct}`; `floor`, `alpha`, the entry shape and `decode_seconds` *(chosen)* |
| `encoder.quality_floor` | the quality floor the export asked the encode tool for (a number; higher is better) | *(chosen)* |
| `av_offset` | `{samples, priming, edit_list}`: the measured lag, the encoder's priming and the audio edit list's media time, in samples | issue's "av_offset (with AAC priming and edit-list state)"; the shape *(chosen)* |
| `licenses`, `credits` | `[{asset, id, …}]`, `[{asset, credit}]` | issue; entry shapes *(chosen)* |
| `chapters` | `[{marker, name, frame}]` | design's `chapters`; the shape *(chosen)* |
| `warnings` | `[{code: "end_cut", strip, start, lost}]` (flicks) | *(chosen)* |
| `seams` | the first frame of each shard after the first | *(chosen)* |
| `lease` | `{resource: {host, kind: "gpu", key}, holder, acquired, released}`, the times of its two events in ms since the Unix epoch | design's Lease `{resource: {host, kind, key}, holder, …}`; `acquired`, `released` *(chosen)* |
| `disk` | `{needed, free}`: what the readiness gate counted, bytes | *(chosen)* |
| `max_s`, `integrated`, `true_peak`, `delivery`, `captions.cues`, `loudness_profile` | as #502 | existing |

### Other calls

| Call | Request | Reply read | New or existing |
|---|---|---|---|
| `deep show` | `peer`, `doc`, `document` | `outcome: "presented"` | existing |
| `registries` | — | `registries[]`, export.target@1's `entries[].fidelity` | existing (#200) |
| `kit` | `registries: ["export.target@1"]` | `registries[].entries[]` gain **`parts: [{part: "fidelity", check: "export.fidelity", verdict, failures}]`** *(chosen)* | extends #501's kit |
| `media_import` | `path` | `asset.probe.streams[]` (`pts`, `color`) | existing (#498) |
| `media_decode` | `path`, `out`, `video_frames`, `format` | `decoded.streams[]` | existing (#498) |
| `media_bake` | `bake: {asset, kind: "loudness", tp_oversample: 8}` | `bake.integrated`, `bake.true_peak` | existing (#500, via #502's `meter`) |

### Cargo features of `deep-show`

| Feature set | What the build holds |
|---|---|
| `full` | the shipped set (existing) |
| `full,test-export-guards` | **`test-export-guards`** *(chosen)*: a test canvas module **`test.guards`** *(chosen)* with three item kinds, each a fault a film can carry: **`test.nonfinite@1 {frame, pixel: [x, y]}`** writes one NaN into that pixel of the frame's float render target on that frame; **`test.device_loss@1 {frame}`** loses the GPU device when the export draws that frame; **`test.redraw@1 {box, fill: role, again: role, frame}`** draws a rect in `fill`, and in `again` the second time a process draws that frame. A release build refuses the feature (Wrong programs). |

### Files the export writes, and where it works

`out` is the delivery: `.mp4` for H.264, `.mov` for ProRes 4444. A refused, FAILed, stopped or BLOCKED export leaves
nothing in `out`'s folder (#501's rule: the temporary name sits there). AC25 puts the evidence store, `out`'s folder
and the run's `TMPDIR` on the test file system, so wherever the export keeps its PCM, its working files or a raw frame,
it is on that volume and counted there.

## Planted programs (the scenario's `planted`)

Each is a wrong program the implementation builds, accepted in the scenario's `planted` (beside #501's and #502's
names) and reachable no other way. Each planted test asserts this suite's own judge fails and that a failure names
what the criterion says.

| Name | Where it plugs in, and what it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `blank_counts_dark_only` | film.blank's reduction counts only pixels at or under the luma floor (no flat histogram) | 27 | `film.blank: frame 24` (the first paper frame; the export is delivered) |
| `encode_full_range_bt601` | the H.264 writer feeds full-range planes and tags them BT.601 (nclx 6-6-6, full range) | 3 | `export.color` |
| `encoder_starves_bitrate` | the encode tool is asked for 64 kb/s whatever the look, size or `video.quality`: the grain look's raised floor never applies | 4, 18 | worst frames (4); the 45 dB floor (18) |
| `limiter_without_codec_margin` | the master limiter's ceiling leaves out the AAC codec margin (0.5 dB at 256 kb/s) | 5 | `true_peak`, the delivery's reading (over −1) and −1 |
| `prores_premultiplies_straight` | the ProRes 4444 writer stores premultiplied colour under `alpha: straight` | 13 | export.fidelity, frame 0 |
| `h264_full_range_under_limited_tags` | the H.264 writer feeds full-range planes under BT.709 limited-range tags | 13 | export.fidelity, frame 0 |
| `muxer_writes_moov_last` | the muxer writes `ftyp`, `mdat`, then `moov` (this job's twin: the base already writes the header first) | 16 | `film.mp4: moov` |
| `encoder_ignores_chapters` | the encode tool forces no key frame at a chapter's first frame | 17 | chapter `s2` |
| `video_writer_drops_frame` | media's video writer leaves out frame 2 of whatever it writes, the kit's fixture included | 20 | the video entry, frame 2 |
| `muxer_timescale_600`, `muxer_timescale_1000` | the video track's timescale is 600 (or 1,000), each frame's time rounded to it | 21 | frame 1 |
| `shard_rounds_first_sample` | each shard's player seeks to its first frame's start sample rounded instead of floored; spans unchanged | 22 | `seam at frame <k>` |
| `export_without_disk_gate` | the readiness gate counts no free disk | 25 | the file it was writing |
| `export_stores_raw_frames` | the export writes each frame's raw BGRA8 bytes into a folder (as the base does) | 25 | the folder |
| `fidelity_keeps_frames` | export.fidelity compares with the frames kept from the export's own pass instead of drawing them again | 26 | frame 1,000 (the film is delivered) |
| `wrap_compares_second_frame` | film.wrap compares the last frame with frame 1, not frame 0 | 28 | `film.wrap` |

The Oracle lane's plants are in its README.

## Fixtures

All made at test time; nothing but the README, the helpers and the tests is committed; no personal data; licences CC0.

- **The look** (`helpers.ts` `lookOf`, after #407's): flat colours the tests know — `ground` #e8e8e8, `muted` #8c8c8c,
  `accent` #f2c230, `raised` #d4d4d4, `paper` #f0f0f0 (luma 240/255, 0.94), `black`, `white`, `ramp_lo` #0838a8,
  `ramp_hi` #f08020, `ink` #1b1d22 (its tiers at alphas d6, d6 and 33, `focus` the ink); Inter as `body`. Chosen so the
  look guard (`look::resolve_in`) resolves it, with the paper as its ground too, wherever status shows and everywhere: a
  refused look would fall back to the shipped one, which names none of these roles.
- **The fixture film** (`filmDoc`): 160 × 90 at 24 fps unless a test says otherwise; a ground, a static side panel
  over the left 40% (`muted`), a bar (`accent`) moving right a pixel a frame and a tick (`raised`) moving down a pixel a
  frame, each starting over at its edge (at 160 × 90 their periods, 92 and 87 frames, repeat together only after
  8,004 frames, and at 1920 × 1080 after 96,048), so no frame is blank or flat and, in every film a criterion needs it
  of, every frame differs. Its sound: a stereo float WAV, 440 Hz left at 0.2 and 660 Hz
  right at 0.15, over the whole span, at 48 kHz unless stated. Variants: 60 s (1,440 frames, AC12, AC26), 1,440 frames
  at 24000/1001 (AC21), 700 frames at 30000/1001 and 44.1 kHz (AC22), 1920 × 1080 at 60 fps for 60 s with 1 s of tone
  (AC25) or 10 s (AC14), 64 × 64 for 60 s (AC19), 320 × 180 for 3 s (AC7).
- **The black film** (AC1): a full-frame black rect shown on frames 24–27 (`adjust.opacity` held by a channel).
- **The paper film** (AC27): 3 s on the look whose ground is the paper: an ink block 40 × 40 drawn on 0–23 and 52–71,
  left out on 24–35; `TITLE` in Inter at 44 u, dark on the paper, on 36–47; a white full-frame rect on 48–51, declared.
- **The grain film** (AC4): the fixture film, 2 s, under the look with grain at 25%, beside the same film without.
- **The ramp** (AC13): no ground; a full-frame linear gradient `ramp_lo` → `ramp_hi` at `adjust.opacity: 0.5`, and an
  opaque accent block sliding 4 px a frame; 1 s.
- **The noise** (AC5): 20 s of seeded Gaussian stereo noise at σ 0.08 with a 1 ms 4 kHz burst at 0.9 every 100 ms, on
  #502's `masterFilm` (64 × 64, the sound on the master at unity).
- **The passage** (AC11): 60 s of a 1 kHz sine on both channels at 0.05, the 3 s from 30 s raised by d dB, d chosen so
  the passage's loudness sits 7 (or 4.5) LU over the whole film's integrated loudness:
  10^(d/10) = 57r ÷ (60 − 3r), r = 10^(LU/10), so 8.03 and 4.94 dB; at −23 LUFS the passage reads −16.0 (or −18.5).
- **The caption film** (AC11): the fixture film, 10 s, shots [0, 120) and [120, 240) frames with a cut, three caption-
  only lines (narrator CC0, locale en, netflix-en-adult): "Steam rises over the kettle at dawn" (35 characters) at 3 s,
  out by the rule at frame 114, 6 frames before the cut; "The tune dips under words" (25) at 6 s, out at 174; "Captions
  always show" (20) at frame 179, 5 frames later. Worked by hand from Narration and captions' layout rule.
- **The library film** (AC6): the stem (a 2 s tone) on a strip; `piano_lib` (a 1 s tone) its input, CC BY 4.0.
- **The narration film** (AC6): line `hello` at 0.5 s with its own recording (a 1 s tone, one word 0.1 to 0.5 s, its
  words record written here as #502's), the narrator's licence `{id: "LicenseRef-unknown"}`.
- **The chapters film** (AC17): 4 s, sections `s1` (frame 0), `s2` (29), `s3` (67).
- **The end-cut film** (AC19): 60 s at 64 × 64 with no tone; strip `tail`, an 8 s tone from 55 s.
- **The loop films** (AC28): 320 × 180 at 30 fps, 2 s, no moving bars; a 10 × 10 dot on per-frame keys: the orbit
  (centre (224, 90), radius 60, the angle stepping 6° − cos(2π(k + ½)/60), so 5° at the wrap and 7° half way) and the
  line (x from 105 to 305).
- **The test file systems** (AC25): a 64 MB HFS+ image filled to 20,000,000 bytes free after the film's assets are
  stored, and a 10 GB sparse bundle, each attached with `hdiutil attach -nobrowse` and detached after the file.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- AC3, AC13, AC17 (and the Oracle lane): BLOCKED without `ffmpeg` and `ffprobe` (PATH, `/opt/homebrew/bin`,
  `/usr/local/bin`, or `DEEP_FFMPEG` and `DEEP_FFPROBE`), with the unblock line `brew install ffmpeg, or name the
  binaries in DEEP_FFMPEG and DEEP_FFPROBE`.
- AC25: BLOCKED off macOS or when `hdiutil` can't make or attach an image; the 10 GB legs need that much free host disk
  for the planted run, which fills the sparse bundle.
- AC14: INCONCLUSIVE off a reference Mac (Mac15,7, Mac15,12, Mac17,10 by `scripts/benchmark.mjs` `fingerprint`) or not
  on mains power, Low Power Mode on, or the thermal state not nominal; and whenever `judgeLimit` reads the five runs as
  neither all within nor all over, or a run's load was above the core count.
- AC29: INCONCLUSIVE without the four pictures in `docs/evidence/157/` or without a recorded call on exactly them.

## The taste call

The check run puts `black-frames.png` (frames of the 4-black-frame fixture, from its exported file), `grain-starved.png`
and `grain-raised.png` (a frame of the grain look at the starved and at the raised bitrate, from each exported file) and
`prores-alpha.png` (a frame of the ProRes 4444 alpha export, over a checkerboard) in `docs/evidence/157/`, attaches them
to the PR and shows them in the session. The call is recorded in `tests/acceptance/157/TASTE.json`: `{issue: 157,
criterion: "#157.2b3d3587", verdict: "looks_right" | "looks_wrong", who, when (ISO 8601), screenshots: {<name>: sha256},
note?}`. This job writes no TASTE.json and makes no picture.

## Readings where the issue and design leave a choice

- **The nearest even size** of 1921 is 1920 or 1922, one away each; either is accepted.
- **"Naming max_s … and its time":** the loudest short-term window is exactly the passage, [30, 33) s; its time is
  accepted as its start or its end, within the meter's 0.1 s step.
- **"Fails with both numbers"** (AC5): the delivery's true-peak reading and the target it misses. The fixture is made to
  overshoot under the plant; the criterion's −0.7 is a reading, held here only as "over −1.0 and under 0".
- **"The raised quality floor passes it"** (AC4): the grain film delivered, every frame at its floor, and its
  `encoder.quality_floor` above the grainless twin's.
- **"Naming its worst frames"** (AC4): the issue's `worst_1pct` frames (or `frames`).
- **"From one session or two"** (AC7): two `deep-show run` processes started at the same moment whose export calls name
  the same session, or two; "the lease events" are each receipt's lease `acquired` and `released`.
- **"Fails at a seam, naming it"** (AC22): the first frame whose PCM hash differs is one of the 3-shard receipt's
  `seams`.
- **"Writes no raw frame to disk at any point"** (AC25): every 200 ms the volume is listed for raw frames (a raw-frame
  extension, or a folder of two or more files each exactly one frame's BGRA8 or 4:2:0 bytes), and the volume's use
  never grows past the PCM, the delivery and 64 MiB.
- **"Starts, fills the disk and fails, naming the file"** (AC25): the reply's issue `path` is a file; for the raw-frame
  plant, a folder, which this suite's watcher also names.
- **The redraw item** (AC26) changes colour on its second draw *in the process*: the export's own pass draws frame
  1,000 once, export.fidelity draws it again.
- **"A `ping_pong` document isn't checked"** (AC28): the line, which fails as `wrap`, is delivered as `ping_pong`.
- **AC2's clean film** is the one the NaN and the device loss are planted in, without the test item.

## Not tested, and why

No criterion asks: HEVC and `hevc_alpha` (the base refuses them `codec_unbuilt`); `purpose: draft`; the contact sheet;
a missing bake's stop and the encode tool's 10 s slot timeout; the software adapter's guards; "a film's span is a whole
number of frames, or the check names the hold it adds"; the crossing-cut caption rule; the podcast profile; #231's 2x
real time (#231's own budget); `licenses` for a non-shareable input in a shared export beyond the narrator.

## Not settled

- **The sync fixture** is written by these tests as a document (helpers.ts `syncFilm`); the design speaks of "the sync
  fixture" an encode tool qualifies on. If the product ships its own, these tests still hold the export to theirs.
- **`license.from` on an asset entry** is this job's reading of the issue's field; a job output in a document may come
  to carry `made_from` instead, and the credit walk would read either.
- **film.blank's flat rule and film.wrap** are in the issue, not yet in the design.
