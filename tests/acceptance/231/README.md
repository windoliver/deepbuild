# Acceptance tests for #231: export speed — held frames reuse their buffer, drafts, phase timings

Written first, blind, from issue #231 (as saved on November 22, 2026: its opening paragraph, its Scope, its Fields,
its 10 acceptance criteria, its Proof line and its dependencies), its oracle map, the design sections it links and
those they lean on, and the base commit `5fcfb690b` (`5fcfb690ba6592ad567c303ecf67054dbcbdfc3c`), by a job that never
saw an implementation; none exists at the base, and no other worktree, branch, stash, PR or transcript was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). The one upstream test the oracle map links, for criterion 1, is in `tests/acceptance/231-oracle/`.

## What was read

- The issue as saved, body and comment (the comment is older than the body's later edits, so the body is the issue).
  Each test's name starts `AC<n> #231.<id>`, the first 8 hex digits of the SHA-256 of the checkbox's text after
  `- [ ] `, trimmed, white space collapsed, as `scripts/proof-change.mjs`'s `criterionId` computes it.
- `docs/canvas-primitives.md` at the base: Export (fields, receipt, Semantics, Cost), The cost model, Export: encode
  job, Frame clock and scheduler, Dirty classes, Content key, Bound value, Look (grain), Particles `particles@1`,
  the analysis bake's spectrum, Determinism class. `docs/technical-design.md`: Films and figures on the canvas (Six
  fixture films first, Export), How we know version 0 works (Canvas modules: the export module's two laws), The
  reference Macs, Wrong programs, Dogfooding. `docs/parallel-proof.md`: a suite's own lane file, the timed list.
- At the base, for call shapes only: `crates/deep-show/src/export.rs` (`parse`, `Job`, `planted`), `export/run.rs`
  (the receipt), `export/frames.rs`, `export/fidelity.rs` (`redraw`), `export/tools.rs` and `export/test_tools.rs`
  (which tool takes a GPU surface), `capture.rs` (`send`), `kit/mod.rs` and `kit/export.rs` (the kit call, parts and
  cases), `main.rs` (the scenario's keys; one scenario a line), `hub.rs` (the scenario's `record`),
  `scripts/benchmark.mjs` (`fingerprint`, `references`, `validateBudgets`), `scripts/proof-runs.mjs` (`twins.json`).
- Suites as patterns only (nothing is imported from them): `157` and `518` (the export's films, replies, planted
  programs, budgets and README), `501` (still exports, the receipt), `239` (the fixture films), `105` (`send`), `138`
  (the kit's report), `503` (a spectrum bake and its bar chart), `449` (a `particles@1` item), `169` and `392`
  (status bindings and bound values).

## What the base already does, which these tests don't credit

The base's export draws, reads back and hashes every frame, at about real time. Its video receipt holds `frames`,
`frame_hashes`, `fidelity`, `handoff` (`copy` for the system's hardware encoder, `surface` for #518's test tools),
`encoder`, `lease` and `timing: {open}`; it reads no `purpose`, and has no `start`, `reused_frames`, work counters or
reports. Its `send` call queues any file the store holds. A still export (`range: {still: {t}}`) already gives the
frame hash of one frame drawn alone, and #501 holds it to the live frame. So no test here passes on a frame hash, a
delivery or a Send alone: each reads a count, a field or a refusal the base lacks, or runs a planted program.

## Run them

Put Node 24.22 and the pinned Rust toolchain first on PATH, then run one file at a time. A file builds each
`deep-show` feature set it uses when a test first needs it, with the two commands below, in the checkout, into
`$CARGO_TARGET_DIR` or `target/`, and copies `debug/deep-show` out. With **`DEEP_231_BIN_DIR`** *(chosen)* set to a
folder that holds `deep-show-full` and `deep-show-full+test-encode-tools`, no cargo runs and those are used.

```sh
cargo build --locked --bin deep-show --no-default-features --features full
cargo build --locked --bin deep-show --no-default-features --features full,test-encode-tools
node node_modules/vitest/vitest.mjs run --root tests/acceptance/231 --no-file-parallelism holds.test.ts     # AC1, AC2, AC6 (both builds)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/231 --no-file-parallelism seeks.test.ts     # AC8 (full)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/231 --no-file-parallelism send.test.ts      # AC4 (full)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/231 --no-file-parallelism counters.test.ts  # AC10 (test-encode-tools; macOS)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/231 --no-file-parallelism wall.test.ts      # AC3 (full; a clock)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/231 --no-file-parallelism starts.test.ts    # AC5 (full; a clock)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/231 --no-file-parallelism speed.test.ts     # AC5, AC7, AC9 (full; reference Mac)
node node_modules/typescript/bin/tsc -p tests/acceptance/231/tsconfig.json                                  # type-check (exits 0)
```

Every test has an hour (helpers.ts sets it). Temp folders are removed after each test or file; no process is stopped
by name or port (a timed run is stopped only by its own PID, at the test's limit). Nothing leaves the machine and no
model is called. Each judge is shown failing a planted set, and passing its clean twin, when `helpers.ts` loads
(`judges.ts` `proveJudges`), before a binary is asked for.

**How many exports a whole run makes.** At 1080p60, whole fixtures: `counters.test.ts` 1 (the city, by GPU surfaces,
which writes 3,600 PNGs: allow some gigabytes of temp space) and two 2 s cuts; `wall.test.ts` 2 (the city);
`starts.test.ts` 7 (the set twice in one process, and the orbit); `speed.test.ts` 21, on a quiet reference Mac only
(18 timed runs read by three criteria, and the planted guard's 3). Small films (320 × 180): `holds.test.ts` 8 exports
and 48 stills; `send.test.ts` 2; `seeks.test.ts` 2 exports and 240 stills of its own film, and one export and one
still a frame for each fixture film delivered (300 stills each for the two at the base). Two kit runs are in
`counters.test.ts` and one in `holds.test.ts`.

`tests/acceptance/231/lane.json` says the suite runs alone. `scripts/lanes.mjs` needs this line (this job writes only
its folders; the implementer adds it): the three files read a clock and the machine's load.

```js
timed.push('tests/acceptance/231/speed.test.ts', 'tests/acceptance/231/wall.test.ts', 'tests/acceptance/231/starts.test.ts');
```

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it; BLOCKED and INCONCLUSIVE
legs fail with a line starting `BLOCKED:` or `INCONCLUSIVE:`.

## Criteria to tests

| AC | ID | File | Tests, and the wrong program each fails on |
|---|---|---|---|
| 1 | `#231.ceba88e3` | holds.test.ts | 3: the 30 s hold's H.264 delivery counts `work` draws 1, hashes 1, fidelity 1 and 1, `reused_frames` 1,799, every counter equal to the 1 s hold's, 1,800 equal frame hashes, `fidelity.frames` 1,800 and an MP4 track of 1,800 samples of 1/60 s; the same hold as a draft by GPU surfaces reads back no frame and 1 digest of 32 bytes while the tool reports 1,800 frames of the one hash; the kit's `held_span` law is PASS with its counts. Wrong program: the merge base (1,800 draws, no `work`) |
| 2 | `#231.c9318808` | holds.test.ts | 1: the film whose reading changes at frame 40 and whose status binding changes at frame 80 counts 3 draws and equals its seek renders at frames 0, 39, 40, 41, 79, 80, 81 and 119; planted `reuse_across_readings` fails, naming frames 40 and 80 |
| 3 | `#231.84a45611` | wall.test.ts | 2: the city's draft in a fresh process: `timing` holds every phase and `wall`, no phase above `wall` (any machine), `wall` within 5% of the time measured outside (quiet reference Mac); planted `receipt_wall_sums_phases` fails, naming `wall`, above the measured time |
| 4 | `#231.63877b11` | send.test.ts | 1: a Send of a draft is refused with nothing queued, naming `purpose`, while a delivery's Send is queued (a 2 s hold as the draft, a 1 s hold as the delivery, so the two files differ). Wrong program: the merge base (no `purpose`; both Sends queued) |
| 5 | `#231.0c28c755` | starts.test.ts, speed.test.ts | 3: the set exported twice from one fresh process, the first export `start: cold` with `timing.prepare` within 5% of the `reports`' seconds, the second pass `start: warm`, prepare 0, nothing reported; planted `receipt_books_compiles_under_draw` fails, naming prepare, its `wall` still matching; the judge refuses a warm run among the three, and on the reference Mac all 18 timed runs read cold and hold 4x and 2x |
| 6 | `#231.69ce6ea8` | holds.test.ts | 2: 1 draw (the hold), 720 (grain at 24 fps) and 1,800 (a particle item), ten sampled frames of each equal to seek renders, the grain holding over frames 0 to 2 and new at 3, the particles moving; planted `reuse_ignores_valid_until` fails: not 720 draws, the first wrong frame 3 |
| 7 | `#231.f202d6a5` | speed.test.ts | 3: a perf-lane task names `#231.f202d6a5`, valid against the merge base's budgets; on the reference Mac each fixture's delivery (every guard, each distinct frame drawn twice) takes at most 18 s, 5 s and 30 s as the mean of 3 cold runs; planted `guard_waits_8_4_ms` takes the city past 30 s and fails, naming the city and `guards` |
| 8 | `#231.6136cb61` | seeks.test.ts | 2: every frame of each fixture film delivered equals a still at its time, BLOCKED until six are there; the spectrum film equals its stills frame for frame, and planted `content_key_without_spectrum_band` fails, naming the first frame the tone changes |
| 9 | `#231.2bfc9b79` | speed.test.ts | 2: on the reference Mac each fixture within its own two limits; the planted judge `judge_times_set_as_whole` passes 34 s, 14 s and 4 s (52 s against 53 s) and this suite's judge fails them, naming the city |
| 10 | `#231.77030cf3` | counters.test.ts | 3: the city's draft by GPU surfaces counts 3,600 draws, no frame read back and 3,600 digests of 32 bytes, the tool's 3,600 slot hashes the receipt's; planted `export_hashes_on_cpu` gives the same hashes on the first 2 s and fails, naming `frames_read_back`; the kit's `surface_digest_only` law is PASS, and FAIL under the plant |

22 tests in 7 files.

## The surface under test

`deep-show run` (one scenario line on stdin, one answer line `{"ok": true, "replies": [...]}`), with the scenario's
`planted` key for the wrong programs; the file an export writes; and the kit call. No new binary, subcommand or Cargo
feature. Names the issue or the design give are used as given; **every name marked *(chosen)* is this job's**, taken
from the design's words and shaped like its neighbours; the implementer builds exactly these, or a dispute goes to a
blind redraft. Times in calls are flicks; times in receipts are seconds; hashes are lower-case hex.

### The scenario

`{"evidence", "sessions", "processes", "panels", "docs", "record"?, "planted"?, "calls"}`, as the base's suites write
it. `record` is the base's: the record's objects by handle, `{"reading:…": {"session": null, "value": 3, "as_of": 0},
"verdict:…": {"session": null, "state": "running"}}`. `sessions` holds one agent session, which makes the Sends.

### `export`

The delivery form (#501, #157, #518). Request fields read here:

| Field | Value | From |
|---|---|---|
| `purpose` | `"draft" \| "delivery"`, `delivery` when left out, beside `video`, `audio` and `out` on the call. Example: `{"call": "export", "doc": …, "out": "/tmp/x/film.mp4", "video": {"codec": "h264"}, "audio": {"codec": "aac"}, "purpose": "draft"}` | issue |
| `readings` | `[{t: flicks, handle, value?: number, state?: string, as_of?: flicks}]`: the record's changes on the film's clock. A frame at time ≥ `t` reads the record object `handle` with that `value` or `state`; before it, the scenario's `record`. A still at a time takes the same list. Example: `"readings": [{"t": 470400000, "handle": "reading:01JB231R000000000000000001", "value": 7}]` | *(chosen)*: it stands in for a replayed film's mapped record time (Bound value: `as_of`), shaped like the input `track` |
| `range`, `video.codec`, `audio.codec`, `out`, `tool`, `brief: {tools}` | as the base | existing |

A draft is written at `out`, as a delivery is. Outcomes: `"exported"` with `receipt`, `work` and `reports`; a Send's
refusal is below. The receipt keeps the base's fields. Read here:

| Field | Shape | From |
|---|---|---|
| `timing` | `{prepare, evaluate, draw, hash, convert, handoff, encode, guards, wall}`, each a finite number of seconds ≥ 0. Example: `"timing": {"prepare": 0.41, "evaluate": 1.9, "draw": 6.2, "hash": 1.4, "convert": 0.4, "handoff": 0.1, "encode": 9.8, "guards": 0.9, "wall": 13.6}` | issue |
| `start` | `"cold" \| "warm"` | issue |
| `reused_frames` | whole number: frames that took the frame before's buffer and hash | issue |
| `frames`, `frame_hashes`, `frame_rate`, `size`, `fidelity {frames}`, `handoff`, `encoder.report.frames`, `color_probe`, `nonfinite`, `lease.waited_ms` | as the base | existing |

**`work`** *(chosen; on the reply, beside `receipt`)*: the export's work counters, counts that are the same on every
machine.

```json
"work": { "draws": 1, "hashes": 1, "fidelity": { "draws": 1, "hashes": 1 },
          "frames_read_back": 0, "digests_read_back": 2, "digest_bytes_read_back": 64 }
```

- `draws`, `hashes`: frames the export's own pass drew, and hashed. `draws + reused_frames` is the receipt's `frames`,
  and `hashes` equals `draws`: a frame is hashed once, when it is drawn.
- `fidelity.draws`, `fidelity.hashes`: frames export.fidelity drew again for its reference, and hashed: in a delivery
  one for each distinct frame (`draws`), in a draft 0.
- `frames_read_back`: frames whose pixels (the frame or its planes) came from the GPU to the CPU, for any reason. A
  frame handed over as a GPU surface: 0. The copy fallback's readback of the planes counts here.
- `digests_read_back`, `digest_bytes_read_back`: hash digests read back from the GPU, and their bytes, 32 each.

**`reports`** *(chosen; on the reply)*: what the compile thread and the decode worker report of this export's
preparing, as they report it: `{"compiles": [{"pipeline": "<name or key>", "seconds": 0.21}], "decodes": [{"asset":
"<sha256 or ID>", "seconds": 0.03}]}`. Both lists are empty when the export compiled and decoded nothing.

### The time from the command to the file

The suite measures it outside the export (helpers.ts `timedShow`): from the moment it starts a fresh `deep-show run`
with the scenario (the document's `deep show`, then the `export`) on its stdin, to the moment the file is first seen
under its name at `out`, looked for every millisecond. `timing.wall` is held to that span within 5%, so for a
process's first export it has to count what comes before the export call in that process. A fixture's speed is the
mean of three such runs, each `start: cold`.

### `send`, and the refusal

`{"call": "send", "session", "to": url, "files": [sha256]}` is the capture suite's: a Send by a session's agent of
files from the evidence store, queued as `{"send": {"id", "state": "waiting"}}`. **A Send that names a draft is
refused** *(chosen shape)*: the reply holds no `send`, has `outcome: "refused"` or a `code` (any), and names
`purpose`: **`"purpose": "draft"`** on the reply or on one of its `issues`. The test exports the draft in one process
and sends it from another on the same store, by the SHA-256 of the file's bytes, which it puts in the store itself,
so the export has to leave in the store what marks those bytes a draft.

### The kit's two laws

`{"call": "kit", "modules": ["export"], "parts": ["laws"], "backends": ["gpu"]}`: **`laws`** *(chosen)* is a part of
the kit that the export module runs, with two cases *(chosen names)*. Each states what it counted, by the export's
work counters, in **`counted`** *(chosen)*:

| Case | PASS when | `counted` |
|---|---|---|
| `held_span` | a held span costs one frame's draw and hash, and in a delivery one more of each | `{"draft": {"draws": 1, "hashes": 1}, "delivery": {"draws": 1, "hashes": 1, "fidelity": {"draws": 1, "hashes": 1}}}` |
| `surface_digest_only` | frames handed over as GPU surfaces are never read back, only their digests | `{"frames": n ≥ 2, "frames_read_back": 0, "digests_read_back": n, "digest_bytes_read_back": 32 × n}` |

`surface_digest_only` is BLOCKED where no hand-off by surface can be made. Under the scenario's planted
`export_hashes_on_cpu` it is FAIL and its `failure` names `frames_read_back`.

### Cargo features, environment variables, files outside the folder

- Features: `full`, and #518's `full,test-encode-tools` for its tool `test-frames@1.0.0`, which takes GPU surfaces.
  Both exist at the base; none is added.
- Environment: `DEEP_231_BIN_DIR` *(chosen)*, read by the suite alone (above); `CARGO_TARGET_DIR`, as the base.
- Outside the folder: a task in `benchmarks/budgets.json` whose reason or `criteria` name `#231.f202d6a5`; the
  `timed.push` line in `scripts/lanes.mjs`; the four fixture films the base lacks, which are another issue's.

## Planted programs (the scenario's `planted`)

Each is a wrong program the implementation builds, accepted in the scenario's `planted` beside the earlier suites'
names (an unknown name answers `bad_input`) and reachable no other way. Each planted test runs the check its shipped
twin passes and asserts that a failure names what the criterion says. `twins.json` maps each criterion to its names.

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `reuse_across_readings` | the reuse compares content keys with every reading and status binding left out, so a frame after a changed reading or status takes the frame before's buffer | 2 | frames 40 and 80 |
| `receipt_wall_sums_phases` | the receipt's `wall` is the sum of its eight phases | 3 | `wall`, above the measured time |
| `receipt_books_compiles_under_draw` | pipeline compiles are timed under `draw`, not `prepare`; `wall`, `start` and `reports` are as shipped | 5 | `timing.prepare` |
| `reuse_ignores_valid_until` | a frame whose content key and view equal the frame before's reuses it whatever that frame's `valid_until` | 6 | 720 draws not made; frame 3 |
| `guard_waits_8_4_ms` | one export guard waits 8.4 ms on every frame, timed under `guards` | 7 | the city, `guards` |
| `content_key_without_spectrum_band` | the content key of an item that reads a spectrum array leaves the band levels out | 8 | the first frame the tone changes |
| `judge_times_set_as_whole` | this suite's own (judges.ts `setAsWholeFailures`): the three fixtures' times added and held to the sum of their limits | 9 | the city |
| `export_hashes_on_cpu` | each frame is read back and hashed with BLAKE3 on the CPU; no digest is read back from the GPU | 10 | `work.frames_read_back` |

## Fixtures

All made at test time by `helpers.ts`; no personal data; licences CC0. Every film but the spectrum's plays a stereo
tone (440 and 660 Hz) for its whole length.

- **The 30 s and 1 s holds** (`holdFilm`): 320 × 180 at 60 fps, a ground, a side panel, a block and a tick, none
  moving, no channel: 1,800 and 60 frames of one picture, nothing in view reading the time.
- **The hold under grain** (`holdFilm(…, true)`): the same film under a look whose finish is `{grain: {amount: "25%",
  size: 1, tone: "flat", rate: 24}}`: 720 patterns in 30 s. At 60 fps frames 0 to 2 share the first pattern and frame
  3 (3/60 s, past 1/24 s) starts the second.
- **The hold with a particle item** (`particleFilm`): a 3D film, 320 × 180 at 60 fps for 30 s, a floor and a post that
  never move and one `particles@1` item emitting 16 dots a second, each living 4 s on a ballistic path.
- **The film whose reading and status binding change** (`readingsFilm`): 320 × 180 at 60 fps for 2 s, nothing moving;
  a text bound to a reading (`bound_values`; its own text is empty, as the document check asks of a bound text) and a
  plate whose fill is bound to a verdict's status (`status_bindings`). Under the scenario's `record` and the export's
  `readings`, the reading goes from 3 to 7 at frame 40 and the status from running to pass at frame 80.
- **The film whose bars read a spectrum** (`spectrumFilm`): as #503's redraft suite builds one, 320 × 180 at 60 fps
  for 4 s: a 16-bar chart (`marks@1`, mark `bar`, through a `scale@1`) whose `level` column reads the 16 log bands of
  the sound's spectrum bake (`bakes`, `spectrum.tone`), silent but for a 937.5 Hz tone from 1 s to 2 s. The picture
  holds until the tone, while it sounds, and after it.
- **The speed fixtures** (`speedFilm`), each 1920 × 1080 at 60 fps:
  - the **explainer**, 36 s, 2D: a title, a caption a part, twelve bars and a marker; six parts of 6 s, each 3.6 s of
    motion (the marker moves 4 px a frame, the bars grow) and a 2.4 s reading hold. The holds are 6 × 144 = 864
    frames, 40% of 2,160, so an export draws 1,302 frames and reuses 858;
  - the **orbit**, 10 s, 3D: the camera circles 27 boxes and a post once, a new position every frame: 600 draws;
  - the **city**, 60 s, 3D: a 50 × 50 grid of 2,500 buildings of seeded heights; the camera flies 3 units a second down
    an avenue, it and its target moving every frame: 3,600 draws, no frame its predecessor's picture.
- **The six fixture films** are read from `tests/fixtures/films/<name>/film.json` with `assets/`; this job writes
  none. `release-still` there is the release's own and isn't one of the six.
- **A seek render** (`seekRenders`) is a still: `range: {still: {t}}` as a PNG sequence of one frame, each in the one
  fresh process that makes a film's stills, apart from the process that exports the film.

**What the base run changed in the fixtures** (BASE-FAILURE.txt has the readings). Each was a document the base's
check refused, or couldn't draw, for a reason that isn't the work's:

- `readingsFilm`: the bound text's own `text` is now empty (the base refused `"0"` with `bound_typed_over`).
- `spectrumFilm`: the bars are `marks@1` with mark `bar`, a `level` column on the array and an `encode` through a
  `scale@1`, under a camera on the page, as #503's redraft builds them (the first form was refused `bad_encode`).
- The explainer's captions read "Part A" to "Part F" (a digit in a text was refused `number_unsourced`).
- The orbit's post and the city's buildings take the roles `ink`, `accent` and `muted` (the role `live` isn't in the
  shipped look: `ref_unresolved` at frame 0).
- `send.test.ts` exports two films, a 2 s hold as the draft and a 1 s hold as the delivery: a draft and a delivery of
  one film can be the same bytes, and are at the base, so their Sends couldn't be told apart.

At the base the fixtures count as built: the explainer's export, whole at a quarter size, holds 1,302 distinct frames
and 858 repeats; the orbit's 600 frames and the city's first 120 are each different; the grain film's frames 0 to 2
are one picture and frame 3 another; the spectrum film's picture first changes at frame 61.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- Any test: BLOCKED when cargo can't run or a build fails, or `DEEP_231_BIN_DIR` lacks the binary.
- AC1's surface test and AC10: BLOCKED off macOS (the tool that takes GPU surfaces is macOS's), and where the
  receipt's `handoff` reads `copy`. AC10's kit test also where the law itself reads BLOCKED.
- AC3: INCONCLUSIVE with its reading off a reference Mac (Mac15,7, Mac15,12, Mac17,10 by `scripts/benchmark.mjs`), not
  on mains power, Low Power Mode on, the thermal state not nominal, or a load above the core count at the run's start
  or end; only after the fields and "no phase above `wall`" are judged. Its planted test is judged anywhere.
- AC5 (speed.test.ts), AC7's two timed tests and AC9's first: INCONCLUSIVE off a quiet reference Mac, where nothing is
  timed; and with the readings when the load rose above the core count during the runs or a run waited 100 ms or more
  for the GPU lease.
- AC8's first test: BLOCKED while `tests/fixtures/films/` holds fewer than six fixture films, after every film that
  is there has been judged. Unblock: the issue that adds the other four.

## Readings where the issue and design leave a choice

- **The work counters** are on the reply as `work`; the issue's Fields give the receipt `timing`, `start` and
  `reused_frames` and say only that the counters exist.
- **"With no frame read back"** (AC1) is read by the kit's second law: a frame handed over as a GPU surface is never
  read back. The design's copy fallback reads the planes back, and at the base the system's hardware encoder gets
  copies. So the H.264 delivery is held to no frame read back only where its `handoff` reads `surface`, and always to
  the 1 s hold's counts; and one more run exports the hold through the tool that takes surfaces, where 0 must hold.
- **"1 more of each in export.fidelity's redraw"** is `work.fidelity`, counted apart from the export's own pass.
- **"Decodes to 1,800 frames at 60 fps"**: `fidelity.frames` (the delivery read in a fresh decode worker) and this
  suite's own reading of the MP4's video track, 1,800 samples each a sixtieth of a second.
- **"By pixel hash"** (AC6) and **"by frame hash"** (AC8) are one thing here: the export's hash of a frame's pixels,
  BLAKE3 over the canonical raw buffer, in the receipt's `frame_hashes`. A **seek render** is a still export at the
  frame's time, hashed by the same pass; #501 holds a still to the live frame.
- **"Ten sampled frames"**: frames 0, 2, 3 and 1,799 and six seeded draws (mulberry32, seed 231), the same ten for
  each film. **"Naming the first frame"** (AC6): frame 3, the first past the first frame's `valid_until`.
- **"A changed reading or status binding"** (AC2): the record changes on the film's clock through the export's
  `readings`; the base's record is fixed for a run. One planted program crosses both kinds of change.
- **Drafts where a plant may draw wrongly** (AC2, AC6's grain and particles, AC8's spectrum film): a draft runs no
  delivery decode, so the suite's judge reads the frames and export.fidelity can't stop the planted run first.
- **"A Send of a draft"** (AC4): the base's `send`, by hash from the store, from a second process. "Naming `purpose`"
  is the field `purpose: "draft"` in the refusal.
- **"The fixture set is exported twice from one fresh process"** (AC5): one scenario shows the three fixtures and
  exports the three as drafts, then the three again. "The first receipt" is the process's first export; the first
  pass's other two are held to cold or warm as each reads. "Within 5%": prepare against the sum of the reports'
  seconds, both the product's readings of one run, so any machine judges it.
- **"Still matches the wall time"** (AC5's plant): its `wall` within 5% of the measured time, a clock reading.
- **"Compared with the merge base"** (AC7): the perf lane's part, as #157's and #501's budget suites read it: a task
  in `benchmarks/budgets.json` names the criterion, valid against the merge base's budgets. The 2x is judged here.
- **"Naming the city and the guard"** (AC7): the judge's miss names the fixture and each phase whose mean busy time
  alone is over the limit; 3,600 waits of 8.4 ms are 30.24 s of `guards`. The receipt times guards as one phase.
- **The speeds are read off the dev binary** the acceptance tests run, as #157's 8x is, from the command to the file.
- **The mean of 3 cold runs** is judged as stated: mean ≤ limit, with no margin. The repo's `judgeLimit` takes five
  runs and no mean, so this suite's own judge holds the criterion's statistic and the same machine gate.
- **"Its frames handed over as GPU surfaces"** (AC10): through #518's `test-frames@1.0.0`, pinned by the export's
  brief, since at the base no other tool takes a surface. The planted twin runs the city's first 2 s, 120 frames.
- **The six fixture films** are found, not named: every folder of `tests/fixtures/films/` with a `film.json` but
  `release-still`. Four of the six have no name at the base.

## Not asserted, and why

No criterion says so, and neither the issue nor the design gives a value to hold it to: that the fixture set and its
timings are published with the release; that `purpose: draft` leaves `video.quality` as set; that a draft can't be
shared or attached by another route than a Send; where in the app's store a draft is kept; that a draft still runs
film.blank and frames.finite (the hold tests' drafts pass them, no planted blank frame is tried); the ring's slot
count and its GPU memory; the per-frame costs the Cost line estimates; `timing.open`; shards; the timing table against
the merge base (the perf lane prints it); a software adapter; any platform but macOS.

## Not settled

- **The city's density.** The issue says "a dense 3D city" and gives no number. The suite builds the set itself so
  that no fixture can be thinned, and takes 2,500 buildings. If the product's published set uses another count, a
  redraft changes `CITY_GRID`; the limits stay the issue's.
- **The base draws no `particles@1` item in a `deep-show` export** (the GPU layer's own binary does): at the base the
  particle film is shown and exported, and all its frames are one picture. AC6's particle clause needs the export to
  draw one: the test fails while the particle film's sampled frames are one picture.
- **AC1's "no frame read back" on the H.264 delivery itself** holds only once the system's hardware encoder takes GPU
  surfaces. Until then it is shown on the same hold through the test tool that does.
- **`wall` and a process's start-up.** The 5% is against a span that starts when the process does. On the city that
  is 0.75 s of a 15 s draft; on a shorter film the start-up would matter more, and no criterion asks it there.
- **`readings`, `work`, `reports`, the kit's `laws` part and the refusal's shape** are this job's. If the product
  settles other shapes, a redraft changes the readers in `helpers.ts`; the criteria don't depend on them.
- **AC8 can't pass whole** until the other four fixture films exist; that issue isn't among #231's dependencies.
- **The fixtures at the base.** Every fixture document is shown and exported by the base's `deep-show` (the speed
  fixtures in cuts and at a small size, not whole at 1080p60); BASE-FAILURE.txt says what the base run showed and
  what it changed in them.

## What the implementer adds outside this folder

The export's `purpose`, `readings`, receipt fields, `work` and `reports`; the Send's refusal; the kit's `laws` part;
the seven planted names in `crates/deep-show/src/export.rs`'s `planted`; a `benchmarks/budgets.json` task naming
`#231.f202d6a5`; the `timed.push` line in `scripts/lanes.mjs`. Nothing in this folder.

## Files

`helpers.ts` (builds, scenarios, the timed run, fixtures, readers, the kit, the machine), `judges.ts` (the judges and
their own proof), `holds.test.ts`, `seeks.test.ts`, `send.test.ts`, `counters.test.ts`, `wall.test.ts`,
`starts.test.ts`, `speed.test.ts`, `twins.json`, `lane.json`, `tsconfig.json`, and `BASE-FAILURE.txt`, what the base
run showed.
