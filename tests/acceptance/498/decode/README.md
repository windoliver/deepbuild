# Acceptance tests for #498, part "decode": the decode worker's caps, edit lists, priming, probes and color

Written first, from issue #498 (as of Nov 1, 2026: its Scope lines on the decode worker, its Decode worker field, and
acceptance criteria 2, 3, 6, 7 and 8), its oracle map, the design sections it links and those they lean on, and base
commit `c9225aa3` ("Merge pull request #976"), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Criteria 1, 4, 5 and 9 (the device gate, capture and the chime) belong to the other parts of #498's suite.

What was read:

- The issue: Scope ("Decoding in the sandboxed decode worker … with no network and no devices, on the platform's own
  codecs and under the same caps; export with the platform's own encoder"; "The decode worker, asset probes, the
  device gate and capture are the trusted ring's and the codecs seam's"; "The probe keeps each frame's presentation
  time as a rational in the stream's own time base, never rounded to flicks, and reports `frame_rate: variable` for a
  stream whose frame durations differ"; "Untagged color is assumed under one written rule and named: … `color.assumed:
  [field]`, as BT.709 and limited range at heights of 720 and over and BT.601 below"), its Decode worker field
  (`codecs`), criteria 2, 3, 6, 7, 8 and its Proof line ("the refused files at each cap, and the decode worker's
  reference times").
- The oracle map: FATE's `tests/fate/mov.mak` and the reference outputs it lists, at FFmpeg commit
  `24e860f6d3c4f2ebae65ed7649e2a8860d512879`, for criterion 3; the flicks divisor test (`flicks_test.cpp`, Flicks
  `6d6362fb77`) for criterion 7: 15,360 and 12,288 aren't rates a flick divides.
- `docs/technical-design.md`: The media module (1871), Media asset ("probed for its streams, its duration in flicks,
  its rates and its color"), Device gate, capture and export (1931: "encoded by the encode job kind's tools, the
  platform's own encoder first"), Panels and devices (1947), the threat row "Media files that attack their parser"
  (2380: "Decoding happens only in a sandboxed media worker with no network, on the platform's own codecs, with caps on
  size and duration"), the platform seams' codecs line (2465: "codecs, hosted by the decode worker, which is the
  trusted ring's … VideoToolbox and AVFoundation in the sandboxed decode worker on macOS … decoded planes are compared,
  never encoded bytes"; "The same seam hands an export's frames to the encode tool's process"), Dogfooding (2518).
- `docs/canvas-primitives.md`: Time and the flick (9–25: one flick is 1/705,600,000 s; decimal rates normalized at
  probe), Sound and video on the picture's clock (7042), Asset (7048: `probe: {streams: [{type, codec, time_base:
  rational, duration: flick, frame_rate: rational (normalized), sample_rate, layout, color: {primaries, transfer,
  matrix, range}, alpha, size}]}`, `decoder: {name, version}`, `proxies: [{sha256, gop: 1 | 10, scale}]`; "probed once
  in the decode worker, with flicks derived exactly from the stream's own time base"; "It can never: … be decoded
  outside the worker; assume a color space it wasn't tagged with"), Decode worker (7546: `sandbox: no network, no
  devices`, `caps: {max_bytes, max_duration: s, max_pixels}`, `out: YUV planes + color tags | BGRA …; PCM f32`; "All
  probing, decoding and proxies happen here; encoding runs in the encode tool's own process"; "RGB conversion uses the
  stream's tagged matrix and range"), Export (7564: the receipt's `encoder {name, version, hardware}` and `av_offset
  (with AAC priming and edit-list state)`), Export: encode job (7728: "A tool runs as its own process"; "It can never: …
  run in the canvas core or the decode worker"), Seam and backend (1201).
- At the base: AGENTS.md; `tests/acceptance/105/` (`deep-show run`, planted programs, `BASE-FAILURE.txt`, the
  `INCONCLUSIVE:` rule, a local listener stopped by its PID), `tests/acceptance/140/` (the thirteen seams, `codecs`
  among them, and `backends` on results), `tests/acceptance/15/` (the evidence store), `tests/acceptance/488/` (its
  `export` call, a plan with no file); `crates/deep-show/src` (`main.rs`'s scenario and `planted` parsing, `capture.rs`,
  `time.rs`), `crates/deep-canvas-seams` (the seam list).

What the base already does and these tests don't credit: `deep-show run` plays scenarios of calls and answers
`{"ok": false, "code": "bad_input"}` for a call or `planted` value it doesn't know; it has #488's `export` call (a plan
at rates, writing no file) and #105's capture calls; `deep-canvas-seams` names a `codecs` seam. There is no decode
worker, no probe, no decoder, no caps, no proxy, no encode tool and no export that writes a file anywhere in the base.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/498/decode --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/498/decode/tsconfig.json   # type-check
```

Each test file first builds `deep-show` once with `cargo build --locked --bin deep-show`, copies it out of
`target/debug` into a temporary folder, and fails each of its tests when the build fails. Every run gets its own
evidence folder, and every fixture its own temporary folder, deleted after the test. The tests use node built-ins and
vitest only. A run with `--root` may leave Vitest's cache in `tests/acceptance/498/decode/node_modules/.vite`; delete
it. `scripts/lanes.mjs` needs `tests/acceptance/498/decode/` in its one-at-a-time list (`alone`) beside `105/`, since
each file builds a cargo binary; this README is the instruction, and the implementer makes that edit.

Platform needs:

- **macOS** for a passing run: the decode worker's codecs are AVFoundation and VideoToolbox (the seam's macOS backend).
  The tests themselves are platform-neutral; elsewhere they fail wherever the platform's backend is missing.
- **ffmpeg and ffprobe** (FFmpeg 4.4 or later, with libx264 and the `setts` bitstream filter), found on `PATH`, in
  `/opt/homebrew/bin` or `/usr/local/bin`, or named by `DEEP_FFMPEG` and `DEEP_FFPROBE`. They only make fixtures and
  references (README: Fixtures) and never stand in for the decode worker. Without them a test that needs a fixture
  fails with a message starting `BLOCKED:` and the unblock line `brew install ffmpeg`.
- **Network on first use** for criterion 3 only (README: The FATE samples).

What is deterministic: criteria 2, 6, 7 and 8 run on fixtures the tests make and read no wall time and no network
(criterion 2's listener is local and must see nothing). Criterion 3 fetches its samples once and is deterministic from
the cache. No part needs a person.

`BASE-FAILURE.txt` is the run at the base (home paths redacted): all 8 tests fail, each because `deep-show run`
answers `{"ok": false, "code": "bad_input"}` (the base has no `media_import`, nor any call below). That is the missing
behaviour, not a test mistake.

Nothing missing passes (invariant 2): a reply without a field a test reads fails the test naming the field; a run that
answers `bad_input`, exits non-zero or writes other than one line fails every test that drove it; a FATE sample that
can't be had fails `INCONCLUSIVE:`, and a missing fixture tool fails `BLOCKED:`; nothing is skipped.

## The surface under test

The issue names the decode worker, its caps, probes, proxies, an export's record and its encoder, but no code API.
So these tests extend the binary that already plays the hub's trusted ring for tests, `deep-show run` (#393, #105),
with the smallest set of fields and calls they need, in its own style. No new binary. Unlike #105, these scenarios
use no virtual clock: calls carry no `at`.

What the calls stand for: `media_import`, `media_decode` and `media_proxy` are the media module (or the data, scene3d
or cells modules) asking for an asset's probe, its decoded planes and samples, and a proxy, each of which the decode
worker does in its own process; `media_export` is an export of a film whose one strip is a file, encoded by the encode
job's tool in its own process; `workers` reads which helper processes the run started and what each ran. Real
components throughout: on macOS the worker is a separate sandboxed process (App Sandbox and XPC, per the field) using
AVFoundation and VideoToolbox, plus our own audio decoders for the formats the field lists, and the encode tool is
VideoToolbox in its own process. Nothing in the contract names a platform.

### Scenario fields added

```json
{"evidence": dir,
 "decode_caps"?: {"max_bytes"?: n, "max_duration"?: s, "max_pixels"?: n},
 "planted"?: one of the planted programs below,
 "calls": [...]}
```

- `decode_caps`: this run's decode-worker caps (the field's `caps`); each one left out keeps the worker's default.
  Criterion 2 sets `max_duration: 10` and `max_pixels: 10000`, so the files one over them stay small.
- `planted`: selects one wrong program (below) for the whole run; any other value is `bad_input`, as today.

### Times

Every time in a reply is an exact rational of seconds, written `[num, den]`: two JSON whole numbers, `den > 0`. The
tests compare times as integers (cross-multiplied with BigInt), never as floats. The probe's per-frame times
(`pts`) also keep the stream's own ticks: `den` is the stream's `time_base` denominator, unreduced, so frame k of a
stream at time base 1/15360 presented at 513 ticks reads `[513, 15360]`. A rate is `[num, den]` too; the probe's
`frame_rate` is that rational, normalized as the Time section says, or the string `"variable"`.

### Calls and replies

One reply per call, in call order.

- **`{"call": "media_import", "path"}`** → `{"asset": {"sha256", "kind": "video" | "audio" | "image", "probe":
  {"streams": [stream]}, "decoder": {"name", "version"}}, "worker": {"pid"}}`, or a refusal (below). The file is
  probed in a decode worker; `asset.sha256` is the file's SHA-256; `worker.pid` is the OS process id of the process
  that probed it. A video or image `stream` is `{"index", "type", "codec", "time_base": [n, d], "frame_rate": [p, q] |
  "variable" (video), "size": [w, h], "color": {"primaries", "transfer", "matrix", "range", "assumed": [field]}, "pts":
  [[n, d], …] (video)}`; an audio stream `{"index", "type": "audio", "codec", "time_base", "sample_rate", …}`. Read by
  the tests: `type`, `time_base`, `frame_rate`, `size`, `color` and `pts`.
  - `pts`: every frame's presentation time, in presentation order, with any edit list applied, as the stream's own
    ticks (README: Times).
  - `color`: `matrix` is `"bt709"` or `"bt601"` (or another name for other matrices), `range` `"limited"` or
    `"full"`, `primaries` and `transfer` `"bt709"` for BT.709. `assumed` lists each of `primaries`, `transfer`,
    `matrix`, `range` the stream leaves unspecified (in its bitstream and its container both), whose value the probe
    then gives by the written rule: BT.709 primaries, transfer and matrix and limited range at heights of 720 and over,
    and BT.601 matrix with limited range below; `[]` for a fully tagged stream.
- **`{"call": "media_decode", "path", "out": dir, "format"?: "yuv" | "bgra", "video_frames"?: n}`** →
  `{"decoded": {"worker": {"pid"}, "streams": [decoded stream]}}`, or a refusal. The file is decoded in a decode worker,
  which writes what it decoded under `out` (created if missing); file names are relative to `out`.
  - A video or image stream: `{"index", "type": "video" | "image", "size": [w, h], "frames": [{"pts": [n, d],
    "file"}]}`: its first `video_frames` frames in presentation order (all when left out; `0` decodes none), each a file.
    With `format: "yuv"` (the default) a frame's file is its decoded planes, unconverted: for 8-bit 4:2:0, Y then Cb then
    Cr, each plane's rows top-down with no padding (I420, the layout FFmpeg's `rawvideo` `yuv420p` hashes in FATE's
    framemd5). With `format: "bgra"` it is BGRA8, rows top-down with no padding, converted with the matrix and range
    the probe gives (tagged, or assumed by the rule). `pts` is the frame's presentation time as in the probe.
  - An audio stream: `{"index", "type": "audio", "sample_rate", "channels", "first": [n, d], "samples", "file"}`: the
    file is every kept sample as f32 little-endian, interleaved; `first` is the presentation time of the first kept
    sample, after any edit list and the encoder's priming are removed; `samples` the frames kept per channel.
- **`{"call": "media_proxy", "path", "gop": 1 | 10, "scale"}`** → `{"proxy": {"sha256", "gop", "scale"}, "worker":
  {"pid"}}`: a proxy of the file (the asset's `proxies` entry) made in a decode worker.
- **`{"call": "media_export", "source": path, "out": file, "video": {"codec": "h264"}}`** → `{"export": {"file":
  {"path", "sha256"}, "receipt": {"encoder": {"name", "version", "hardware": bool, "process": {"pid", "role"}}, …}}}`:
  an export of a film whose one strip is `source` over its whole span, at its size and rate, delivered as an MP4 at
  `out`. Its frames are encoded by the encode job's tool, which runs as its own process; the receipt (the export's
  record) names that tool and its process: `process.pid` is the OS process id that encoded, `process.role`
  `"encode_tool"`. `file.sha256` is the delivery's SHA-256.
- **`{"call": "workers"}`** → `{"workers": [{"pid", "role": "decode_worker" | "encode_tool", "jobs": [{"op": "probe" |
  "decode" | "proxy" | "encode", "file": sha256}]}]}`: every helper process this run started so far, each once, with
  every job it ran, in order. `file` is the SHA-256 of the file the job read (probe, decode, proxy) or wrote (encode).
  deep-show's own process is never listed.

A **refusal** is `{"refused": {"code", …}}` (a `worker` beside it is allowed):

- `{"code": "over_cap", "cap": "max_bytes" | "max_duration" | "max_pixels", "limit": n}`: the file is over that cap,
  whose value is `limit` (seconds for `max_duration`, pixels for `max_pixels`). A file at a cap is admitted; one over
  it is refused, by `media_import` and by `media_decode` both.
- `{"code": "external_reference", "url"}`: the file points at a URL (an HLS playlist's segment, a movie's external
  data reference), which `url` names; it is refused without anything opening that URL.

### Planted programs

Each reachable only through `planted`, only to prove a test fails on a wrong program; every test runs its own and
asserts that it fails, naming what the criterion says it names.

| Name | The wrong program | Test |
|---|---|---|
| `skips_caps` | the decode worker checks no cap: every file is probed and decoded whatever its duration and pixels | AC2 caps |
| `follows_urls` | the decode worker opens what a file points at (fetches the playlist's segment, reads the external data reference) before answering | AC2 URL |
| `decodes_in_app` | `media_import` and `media_decode` probe and decode in deep-show's own process; their `worker.pid` is deep-show's pid | AC2 worker |
| `ignores_edit_lists` | edit lists are not applied: frames are presented from the first stored sample, each at its stored time (decode time plus composition offset), in the probe and the decode | AC3 edit lists |
| `keeps_priming` | the AAC decoder keeps the encoder's priming samples: the first kept sample is the first priming sample, at its stored time | AC3 priming |
| `encodes_in_decode_worker` | `media_export`'s encode runs inside a decode worker; the receipt's `encoder.process` is that worker | AC6 |
| `probe_rounds_to_flicks` | the probe rounds each presentation time to the nearest whole flick and reports that, `[flicks, 705600000]` | AC7 |
| `assumes_bt601` | untagged streams are assumed BT.601 (matrix) at every height, in the probe and in the BGRA conversion | AC8 |

## Fixtures

Made at test time by pinned recipes, in each test's temporary folder; none is committed.

- **By node alone** (helpers.ts): a 16-bit mono 8 kHz WAV of a 440 Hz tone, 10 s and 11 s; RGB PNGs of 100 × 100
  (10,000 pixels) and 73 × 137 (10,001); an HLS playlist whose segment is `http://127.0.0.1:<port>/hls/seg0.ts`.
- **By ffmpeg** (fixtures only):
  - an 11 s AAC-LC M4A (`sine` → `aac`, 96 kb/s);
  - `cfr30`: 60 frames of `testsrc2` at 30 fps, libx264 without B-frames, encoder time base 1/15360, the `setts`
    filter adding one tick to every presentation time, `-video_track_timescale 15360 -use_editlist 0`: frame k is
    presented at (512k + 1)/15360 s. The test checks with ffprobe that the file came out so;
  - `screenVfr`: 20 frames at a nominal 60 fps in a MOV at time base 1/600, frame k at 10k ticks up to frame 10 and at
    10k + 20 after it, so frame 10 lasts 30 ticks, three nominal frames (`setts`, `-use_editlist 0`); checked likewise;
  - a QuickTime movie of one second whose one track's data reference is rewritten by the test to a single external
    `url ` entry (flags 0) naming `http://127.0.0.1:<port>/dref/media.mov`;
  - 75% bars: eight bars left to right, each W/8 wide (white, yellow, cyan, green, magenta, red, blue, black at 191 or
    0 per channel), converted by the test itself to limited-range Y'CbCr 4:2:0 with the BT.709 (1920 × 1080) or BT.601
    (720 × 480) matrix, encoded by libx264 at QP 10 without B-frames into an MP4 with no color description in the
    stream or the container (ffprobe reads all four as unknown, checked); the control is the 1080p bars with BT.709
    primaries, transfer and matrix and limited range written (`setparams`, checked).
- **A reference by ffmpeg**: FFmpeg's own decode of `aac-2048-priming.mov` to f32 (criterion 3; FFmpeg drops the 2,048
  samples FATE's reference marks as skipped).

### The FATE samples

The 13 samples in `fixtures/fate/samples.json` are fetched from `https://fate-suite.ffmpeg.org/<path>` on first use
into a cache outside the checkout: `DEEP_FATE_SAMPLES` when set, else `~/Library/Caches/deepbuild/fate-suite` on macOS
(`~/.cache/deepbuild/fate-suite` elsewhere), and each is checked against its SHA-256 there. They are never committed.
Offline, or on a hash mismatch, both criterion-3 tests fail with one line starting `INCONCLUSIVE:` that says how to
unblock. The reference outputs are vendored unchanged in `fixtures/fate/` from the pinned commit, with `NOTICE` (source
URLs and the commit) and FFmpeg's `COPYING.LGPLv2.1`.

## Criteria to tests

Each test's name starts with its criterion. Each builds its criterion's failures as sentences naming what failed, and
runs its wrong program to show the same check fails on it, naming what the criterion names.

| ID | Criterion | Test, and the wrong program it fails on |
|---|---|---|
| AC2 | Caps: an audio file one second over its duration cap and an image one pixel over its pixel cap are refused naming the cap | `caps.test.ts`: with `decode_caps` 10 s and 10,000 pixels: an 11 s WAV is refused `over_cap` naming `max_duration`, limit 10, on import and on decode; an 11 s AAC M4A on import; a 73 × 137 PNG naming `max_pixels`, limit 10,000, on import and on decode; a 10 s WAV and a 100 × 100 PNG are admitted (asset by the file's hash, of its kind). Fails on: `skips_caps`, naming `max_duration` and `max_pixels` |
| AC2 | A file that points at a URL is refused with no connection made | `caps.test.ts`: a local listener (a child process on an ephemeral port, stopped by its PID) logs every TCP connection; an HLS playlist and a movie with an external `url ` data reference, both pointing at it, are refused `external_reference` naming the URL on import and on decode, and 500 ms after the run the listener has seen no connection. Fails on: `follows_urls`, naming the connection |
| AC2 | Every audio, image and video asset the media module decodes goes through that worker | `caps.test.ts`: a WAV, a PNG and an MP4 are imported and decoded; each reply's `worker.pid` isn't deep-show's (the pid `spawnSync` started), `workers` lists it as a `decode_worker` that ran that `probe` or `decode` on that file's hash, and never lists deep-show. Fails on: `decodes_in_app`, naming each kind |
| AC3 | Edit lists: the first video (and audio) times FATE's reference outputs give | `fate.test.ts`: for the nine H.264 and HEVC framemd5 samples, the first decoded frame (`video_frames: 1`, planes) is at FATE's first pts × its time base (0 s), is FATE's dimensions, and its planes are FATE's first frame by size and MD5; `invalid_elst_entry_count.mov` (MPEG-4 Part 2) by time and dimensions; `twofields_packet.mp4` (`mov-bbi-elst-starts-b`) by its probe's first video `pts` and its decoded first audio sample, each at FATE's first time for its stream; `mov_neg_first_pts_discard.mov` by its first frame at FATE's `start_time` (0.000000). Fails on: `ignores_edit_lists`, naming `mov-1elist-1ctts` (its first frame two frames late) and `mov-ibi-elst-starts-b` (another frame first) |
| AC3 | AAC priming: the first audio time FATE's reference output gives | `fate.test.ts`: `aac-2048-priming.mov` decodes with `first` at (FATE's first packet pts −2048 + its 2,048 skipped samples) × 1/44100 = 0 s, at 44,100 Hz (FATE's time base, from its pts against pts_time), and its first 4,096 samples are FFmpeg's decode of the same file within 1e-3. Fails on: `keeps_priming`, naming the sample |
| AC3 | Fetched on first use and never committed | `fate.test.ts`'s fetch into the cache above, checked by SHA-256; the suite holds no sample |
| AC6 | The decode worker probes, decodes and makes proxies and never encodes; an export's record names the encode tool's own process | `encode.test.ts`: the 30 fps clip is imported, decoded (2 frames), proxied (`gop: 1`, scale 0.5) and exported to H.264. Each of the probe, decode and proxy ran in a `decode_worker` that has that job on the clip's hash; no decode worker ran anything but probes, decodes and proxies; the receipt's `encoder` has a name, version and hardware flag, and its `process` is listed as an `encode_tool` with an `encode` job writing the delivery's hash, apart from every decode worker and from deep-show; no other process encoded; the delivery is at `out`, hashing to the receipt's hash, a whole MP4 (`ftyp` first, `moov` and `mdat`, boxes adding up). Fails on: `encodes_in_decode_worker`, naming that process (`process <pid> (decode_worker; jobs: …)`) |
| AC7 | Exact rational presentation times; `frame_rate: variable`; flick rounding fails on the first, naming the frame | `times.test.ts`: `cfr30` probes with `time_base` 1/15360, `frame_rate` 30/1 and 60 times, frame k `[512k + 1, 15360]`; `screenVfr` with `time_base` 1/600, `frame_rate` `"variable"` and 20 times as its recipe. Fails on: `probe_rounds_to_flicks`, on the first fixture, naming frame 0 (1/15360 s is 45,937.5 flicks) |
| AC8 | Untagged 1080p bars: `color.assumed` names the matrix and range; RGB within ±2 of the BT.709 reference; BT.601 misses and fails, naming the field | `color.test.ts`: the untagged 1080p bars probe with `color.matrix` `bt709`, `range` `limited`, `primaries` and `transfer` `bt709`, and `assumed` the four unspecified fields (so naming `matrix` and `range`), and decode to BGRA within ±2 code values of the bars in each bar's interior (16 px in from its sides, the middle half of the rows). Scope: the untagged 720 × 480 bars assume `bt601` and limited and decode true to the bars under BT.601; the tagged 1080p bars assume nothing (`[]`). Fails on: `assumes_bt601`, naming `color.matrix` (yellow lands 11 code values off, green 32, in an authoring check with FFmpeg's own conversion) |

## Readings where the issue and design leave a choice

- **One binary for the decode worker's calls.** The decode worker serves the app and the hub, which a test can't
  drive headless; `deep-show run` already plays the trusted ring's parts for tests, so the worker's work is its
  scenario's calls. The worker itself must be a real separate process, on the platform's codecs.
- **"Goes through that worker"** is read from process ids: the reply names the process that probed or decoded,
  `workers` lists the helper processes with their jobs, and neither may be deep-show's own process (the one the test
  started). That a separate process is sandboxed with no network is held by its behaviour: the URL test's listener must
  see nothing. No device is reachable through any call here, so "no devices" isn't tested.
- **Caps set per run.** The field makes caps values (`caps: {max_bytes, max_duration: s, max_pixels}`), and the design
  gives none, so a run sets them (`decode_caps`) and the tests read the refusal against those values; one second over
  10 s and one pixel over 10,000 keep the files small. At the cap is admitted.
- **"Naming the cap"** is `refused.cap` with the field's own name, and its value in `refused.limit`.
- **"A file that points at a URL"**: an HLS playlist (which AVFoundation would fetch) and a QuickTime movie whose data
  reference is an external URL; both are refused `external_reference`, naming the URL. "No connection made" is the
  listener's log: every accepted TCP connection, for the whole run and 500 ms after it.
- **FATE's first times.** A framemd5 reference's timestamps are FFmpeg's after it subtracts the input's start time;
  with the edit list applied the presentation starts at 0 (`mov_neg_first_pts_discard.mov`'s `start_time=0.000000`
  shows the same), so FATE's first pts × its time base is the first frame's time on the presentation timeline, where
  the decode worker's times live. Since that time is 0 for every sample, the test also holds which frame is first, by
  FATE's own MD5 of its planes, for H.264 and HEVC, whose decoding the standards fix bit for bit (an authoring check
  with VideoToolbox through FFmpeg gave FATE's MD5 for `mov-3elist` and `mov-ibi-elst-starts-b`). Not for MPEG-4 Part 2,
  whose IDCT the standard leaves to the decoder (FATE pins FFmpeg's own `-idct simple`), nor for `twofields_packet.mp4`,
  whose field-pair packets VideoToolbox refused in that check; those are held by time.
- **AAC priming's first time** is FATE's first packet pts plus the `skip_samples` its side data gives (−2048 + 2048 =
  0, at 1/44100). A first time alone can't tell a decoder that keeps the priming but relabels it 0, so the samples from
  the first kept one are compared with FFmpeg's decode, which FATE's reference describes (in an authoring check,
  AudioToolbox and FFmpeg agreed within 6e-5 when aligned and differed by over 0.1 with the priming kept).
- **"Every frame's presentation time as an exact rational"**: `[num, den]` in the stream's own ticks. A 30 fps stream
  starting at 0 at 1/15360 has every frame on a whole flick (512 ticks = 23,520,000 flicks), where rounding to flicks
  changes nothing; so the first fixture starts one tick late (a composition offset of 1, no edit list), and then no
  frame's time is a whole flick, which is the flicks test's point about 15,360. The screen recording's 1/600 is a whole
  flick a tick, so the planted rounding passes it, as the criterion's "fails on the first" expects.
- **`frame_rate: variable`** is the string `"variable"` in place of the rational.
- **The untagged rule's range below 720** is limited, as above 720: the Scope sentence changes only the matrix
  ("BT.601 below"). Primaries for BT.601 (525 or 625 line) aren't read.
- **"Naming the field"** is `color.matrix`: every failure of the BGRA check names the matrix in use, and a probe that
  reports the wrong matrix names it too.
- **The export's record** is the export's receipt (Export: "Export records raw hashes, …"); its `encoder` gains the
  process it ran in. The export here is the smallest one that runs the encode job: a film of one strip of a file.

## Not tested, and why

- Criteria 1, 4, 5 and 9: the other parts of #498's suite.
- `max_bytes`, `memory: MB = 200`, video over a duration cap, and "no devices": no criterion of this part names them.
- Every audio format the Decode worker's `codecs` lists (WAV, AIFF, CAF, MP3, AAC-LC and HE-AAC, ALAC, FLAC, Opus,
  Vorbis), and FLAC and Opus through our own decoders: a field of the issue, but no criterion of this part checks it;
  WAV and AAC appear here only as cap fixtures.
- The export's other receipt fields (raw hashes, loudness, caption coverage, licenses, `av_offset`), its fidelity
  decode in a fresh worker, and the encode tool's sandbox: Export's and the encode job's own criteria.
- The evidence player and render-back naming an assumption (Scope): no criterion of this part reads them.
- A rate outside the valid list staying the source's own (Scope): #488's suite tests the rate rule.

## The Oracle lane

Criterion 3's oracle is FATE's own: these tests run FATE's MOV edit-list and AAC-priming samples through our decode
worker and compare with FATE's reference outputs at the pinned commit, read from the vendored files (#136: a linked
test counts only when run against our output). Criterion 7's oracle is the flicks divisor test, used as a formula: the
first fixture's ticks are 45,937.5 flicks each. Criteria 2, 6 and 8 have no upstream test; these tests are their local
proof.
