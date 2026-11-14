# Acceptance tests for #239: the spine gate, the clock, document checks and export guards proved on two fixture films

Written first, blind, from issue #239 (its Scope, its five acceptance criteria, its Proof line and the owner's comment
of November 9, read live on November 12, 2026), its oracle page, the design rows it links and those they lean on, and
the base commit `53c0e72a3` ("Merge pull request #2356"), by a job that never saw an implementation; none existed, and
no other worktree, branch, stash or pull request was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The two films are the deliverable and don't exist at the base. This job fixes where they go, what each must hold and
how each check is run beside its planted twin; the implementer writes the films and the check run, and adds nothing
else: no kind, check, field, call or option (Scope: "Not in this task").

## What was read

- The issue, live (`gh issue view 239 --repo windoliver/deepbuild --json body,comments`), and #77's body for its
  fixture wording only ("each a document kept as a fixture").
- The oracle page (`doneright/oracles/issues/239.md`, DeepBuildAI/deepbuild, branch `doneright`): no upstream test
  checks any of the five criteria, so there is no oracle lane.
- `docs/technical-design.md`: Films and figures on the canvas (Looks: lines, fills and paper; Motion grammars:
  strokes drawn on; Motion-graphics depth: trim with an offset; Timeline and camera shots; Audio and media; Export;
  "Six fixture films first": one per group, each a document kept as a fixture, "20 seeded off-grid times reached from
  later times"); Numbers version 0 has to hold (the canvas's budget classes; "Every task carries its own budgets": a
  frame-time p95 over at least 300 frames, five runs after warm-up, the margin; The reference Macs: a timing counts
  only on one of the three, on mains power, Low Power Mode off and the thermal state nominal); Dogfooding; Tests
  written first.
- `docs/canvas-primitives.md`: Determinism (same machine: canonical renders hashed on the GPU, 16 bytes read back;
  play is the warm path at 144 Hz, seek a cold jump from a later time); Frame budget (`machines: same`, so
  INCONCLUSIVE on any other; five runs; the margin); Export (the receipt; a delivery's guards; standard quality's
  PSNR-Y 40 dB floor; AAC priming removed); Check input and Check input: export kinds (film.blank, frames.finite,
  export.color, export.fidelity); Film audit (hold: max(min, pad + n ÷ rate), 15 graphemes a second outside CJK);
  Film layout (`at: cues`, `layout.cut`); Shot; Transition; Camera `camera@1`; Strip and track; Look `look@1` and Look
  `look@1`: paper; the cost model's budget class table.
- At the base, for surfaces and harness conventions only: `AGENTS.md`, `CONTRIBUTING.md`, `scripts/proof-change.mjs`
  (criterion IDs), `scripts/lanes.mjs`, `scripts/benchmark.mjs` (`fingerprint`, the reference Macs); the suites
  `tests/acceptance/1163/`, `157/`, `1897/`, `1899/`, `407/`, `408/`, `493/`, `501/` and `160/` (README, helpers,
  tests, TASTE.json); in `crates/`, only call shapes, scenario `planted` names and feature sets: `deep-show`'s
  `main.rs` (the planted list), `time.rs` (`determinism`), `verdict.rs` (the determinism row), `export.rs` (the
  receipt's fields), `Cargo.toml` (`test-tick`); `deep-gpu-layer`'s `main.rs`, `budget.rs` (`frame_budget`'s fields and
  its `test-meter` stubs), `Cargo.toml`; `deep-canvas`'s `budget.rs` (the class names);
  `deep-canvas-test-modules`'s `time.rs` (what `test.tick@1` draws); `deep-canvas-marks`'s `pathops.rs` (the `trim`
  op's fields). No expected value comes from them.
- The live dependency links, read the way the test reads them (AC4's surface).

## What the base has

Every issue #239 depends on is closed and merged at the base: the looks (#417), shots and transitions (#493), export
and its receipt (#501), document checks and verdicts on claims (#403), seek against play by the GPU pixel hash
(#1897), the frame-budget run with its test meter and stub environment (#1899), the film audit (#407), film.layout
(#408) and the export guards (#157). `deep-show run` answers `deep show`, `deep_show`, `eval`, `determinism`,
`export` and `verdict`; the scenario's `planted` takes `checkpoint_nearest_in_distance`; the `test-tick` build holds
`test.tick@1`; `deep-gpu run` answers `frame_budget`, whose `test-meter` build takes `stub_meter` and
`stub_environment`. There is no `tests/fixtures/films/`, no `docs/evidence/239/` and no `TASTE.json`. In the live
links criterion 4 already holds, as the owner's comment says.

`BASE-FAILURE.txt` has the run: every film test is BLOCKED on the missing film before it builds anything, the taste
test is INCONCLUSIVE, and the two link tests pass.

## Run them

```sh
npm ci
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
# Build once, leased (the tests build on first use otherwise, with the same arguments):
node scripts/throttle.mjs build --wait 30 -- scripts/lease cargo build --locked --bin deep-show --no-default-features --features full
node scripts/throttle.mjs build --wait 30 -- scripts/lease cargo build --locked --bin deep-show --no-default-features --features full,test-tick
node scripts/throttle.mjs build --wait 30 -- scripts/lease cargo build --locked --bin deep-gpu
node scripts/throttle.mjs build --wait 30 -- scripts/lease cargo build --locked --bin deep-gpu --features test-meter
node node_modules/vitest/vitest.mjs run --root tests/acceptance/239 --testTimeout=600000 --no-file-parallelism <file>
node node_modules/typescript/bin/tsc -p tests/acceptance/239/tsconfig.json
rm -rf tests/acceptance/239/node_modules
```

A test first reads its film (BLOCKED when it isn't delivered), then builds what it needs the first time it asks,
copying the binary out of the target folder (`CARGO_TARGET_DIR` honoured), so a build that fails reads BLOCKED with
cargo's error. Each file runs its films one at a time; every test writes under temporary folders and deletes them.
Node built-ins, vitest and `gh` (AC4) only; no process is stopped but by `spawnSync`'s own timeout on the child it
started. The GPU legs need a Mac with a GPU; a refusal naming the GPU reads BLOCKED.

`scripts/lanes.mjs` needs these lines (this job writes only its folder; the implementer adds them). Every file but
`links.test.ts` and `shown.test.ts` builds a cargo binary and draws both films on the GPU, and `exports.test.ts`
exports both whole at their own size; `seek-play.test.ts`, `budget.test.ts` and `off-reference.test.ts` read this
machine's fingerprint (`referenceMacProblem`), and `budget.test.ts` its load:

```js
// #239's files each build deep-show or deep-gpu and draw, export or time both fixture films on the GPU; seek-play,
// budget and off-reference read this machine's fingerprint, budget its load too.
alone.push('tests/acceptance/239/');
timed.push('tests/acceptance/239/seek-play.test.ts', 'tests/acceptance/239/budget.test.ts', 'tests/acceptance/239/off-reference.test.ts');
slow.push('tests/acceptance/239/exports.test.ts', 'tests/acceptance/239/checks.test.ts', 'tests/acceptance/239/seek-play.test.ts');
```

The `slow` line is expected, not measured: keep each file there only while its recorded run takes over two minutes,
as the list's own rule says.

## Criteria to tests

IDs are the first 8 hex digits of the SHA-256 of each criterion's text after `- [ ] `, trimmed and with white space
collapsed (`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #239.<id>`; every film test runs once per
film.

| AC | ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#239.72f4af59` | `films.test.ts` (2) | The film is delivered with its assets, holds its group's primitives and what the checks read (The two films), `deep show` presents it with no error, and `eval` draws its middle frame at its size. Fails on: the base (BLOCKED); a film missing a primitive (the group check names it); a document refused or raising an error; no frame drawn |
| 1 | `#239.72f4af59` | `seek-play.test.ts` (2) | At 20 seeded off-grid times, `determinism` (`compare: same_machine`, `display_hz` 144) gives equal play and seek GPU pixel hashes, and the 20 play hashes aren't all one; off a reference Mac, INCONCLUSIVE after that. Fails on: a seek that differs from play at any time, named with its flick and both hashes |
| 1 | `#239.72f4af59` | `exports.test.ts` (2) | The whole film as H.264 with AAC is delivered: receipt size, rate and frame count the film's; `nonfinite: []`; `color_probe` nclx 1-1-1, range tv, within ±2; `fidelity` every frame and every sample frame a channel at the 40 dB floor; AAC at the film's rate, a PCM hash a frame, `av_offset` 0; the MP4 holds an avc1 track of every frame tagged nclx 1-1-1 limited range and an mp4a track. Fails on: a delivery any guard stops (named by its check); a delivery without its sound or with frames or samples missing |
| 2 | `#239.a88a17ac` | `checks.test.ts` (8) | On each film document.determinism (rows `machines: same`), film.audit and film.layout PASS with no error. Twins: the film with ticks under `checkpoint_nearest_in_distance` FAILs at 352,799,999 flicks and only there, its unplanted twin PASSes; the film with its first text lengthened FAILs `film.hold_short` naming that text at a time inside the film; the film with `layout-twin` FAILs `layout.cut` naming it at a time inside the film. Fails on: a check that fails the film, passes a twin, or names another fault |
| 2 | `#239.a88a17ac` | `budget.test.ts` (4) | `frame_budget` on this machine's own fingerprint PASSes, both limits, five runs each within the limit; off a reference Mac in its conditions or under load, INCONCLUSIVE; the twin (test meter at 100 ms a frame, the reference Mac's stub fingerprint) FAILs on the GPU limit with each run's p95 at 100 ms and a 5% margin. Fails on: a FAIL on the film; a PASS off the reference Mac's environment; a twin passed or blocked |
| 3 | `#239.7ded5bb7` | `off-reference.test.ts` (2) | Under Mac14,6's stub fingerprint and the reference Mac's on battery, the film at 1 ms and at 100 ms a frame reads INCONCLUSIVE, its GPU limit too, five runs attached, while the reference Mac's reads PASS and FAIL; off a reference Mac in its conditions, the film's real run on this machine reads INCONCLUSIVE too. Fails on: a check that PASSes or FAILs off the reference Mac |
| 4 | `#239.68acd310` | `links.test.ts` (2) | Live: #142 and #222 to #229 each blocked by #239; #143 blocked by #239 or held through its open parts, each reaching #239 through open blockers; #99's blockers without #222. Planted link sets, each missing one link, fail naming #224, #143's part #462, its part #463, #143 with no parts and #99. Fails on: links that leave any of these free to start before #239 |
| 5 | `#239.85750ec9` | `shown.test.ts` (1) | The check run's screenshots (at each receipt's size), recordings and receipts in `docs/evidence/239/`, and `TASTE.json` recording `looks_right` on exactly those files; INCONCLUSIVE without them or on other files; `looks_wrong` fails |

## The two films

The implementer writes them, each the first two of #77's six fixture films, which #77 keeps as its fixtures:

| Film | Document | Its assets |
|---|---|---|
| Strokes and paper | `tests/fixtures/films/strokes-and-paper/film.json` | `tests/fixtures/films/strokes-and-paper/assets/` |
| Camera and transitions | `tests/fixtures/films/camera-and-transitions/film.json` | `tests/fixtures/films/camera-and-transitions/assets/` |

A document is the film as the agent sends it to `deep show` or `deep_show` (no `layers`, no item `layer`). Each of its
`assets.<id>` names its bytes by `sha256`, and a file holding those bytes, under any name, is in `assets/`; the tests
put every file there into the run's evidence store. **Both films** hold (from the design rows above, and what the
other criteria's checks read):

- `profile: "film"`; `size: [w, h]`, both even (H.264 is 4:2:0); `camera` naming a `camera@1` item;
- `transport: {span, frame_rate: [p, q], sample_rate?}`, with `span` in whole flicks or `"<n>s"`, a whole number of
  frames and at least 300 of them (a frame-time p95 is taken over at least 300 frames), and `p ÷ q` a whole number of
  frames a second (the frame-budget run's `fps`); the sample rate is 48 kHz when unset;
- `look: {asset: "<id>@1", theme}` naming `assets.<id>`, a look@1 JSON file in `assets/` (the frame-budget run is
  given it as its `look`);
- `budget: {class}` naming a class with a frame limit (`figure` for a film previewed in a panel, `showpiece` for one
  played full screen), not `export`;
- at least one `text@1` item with its words in `params.text`, so film.audit and film.layout have text to read;
- at least one marker of kind `cue`, `hold` or `shot`, or a shot, so film.layout's `at: cues` checks a time;
- sound: at least one strip whose `src` is a sound asset in `assets/` (by SHA-256 or asset ID), under a licence
  that lets the delivery carry it, such as CC0.

**Strokes and paper** (Looks: fills and paper; Motion grammars: strokes drawn on; Motion-graphics depth: trim): its
look's `basis` is `drawing` and its `ground.kind` is `paper` (Look `look@1`: paper, tooth and age as the film wants),
and at least one item strokes a path through a trim op (`params.ops` holding `{trim: {start, end, offset?}}`, with
`params.paint.stroke`) whose trim `start`, `end` or `offset` a channel (the document's or a clip's) keys through two
values or more, so the stroke is drawn on.

**Camera and transitions** (Timeline and camera shots; Shot; Transition): at least three shots on the document's
camera, each with a `move` other than `hold` and of two kinds or more (push, pan, pull, orbit, …), and at least two
transitions of two kinds or more other than `cut` (cross_fade, dip, wipe, push, iris, zoom_through, …).

Each must pass every criterion's check on its own; the tests read only the document's envelope, its look, and the
replies.

## The surface under test

No new binary, call, field or option. Every surface is the base's; names the issue and the design don't give are
this job's, marked *(chosen)*: the film and evidence paths above and below, the check run's script name, and this
suite's twins.

| Surface | Request | Reply read | From |
|---|---|---|---|
| `deep-show run`, your shell (`films`, `exports`) | #501's scenario; `deep show` with `peer`, `doc`, `document`, `include: ["issues"]` | `outcome: "presented"`, `issues` (no `severity: "error"`) | #393, #501 |
| `eval` | `doc`, `t` (flicks), `pixels: true` | `outcome: "evaluated"`, `snapshots[0].sha256` (a PNG in the store) | #501 |
| `export` | `doc`, `out` (`.mp4`), `video: {codec: "h264"}`, `audio: {codec: "aac"}` | `outcome: "exported"`, `receipt: {size, frame_rate, frame_hashes, pcm_hashes, nonfinite, color_probe {tags, max_error}, fidelity {frames, samples, floor {psnr_y}, psnr_y, ssim, worst_1pct}, audio, sample_rate, av_offset {samples}}`; else `issues`, each with `check` | #501, #157 |
| `deep-show run`, the agent (`seek-play`, `checks`) | #1897's scenario: session `sess-alpha`, `deep_show`, a claim of its whose deliverable is the film and whose requirements are `{kind: "document.determinism", compare: "same_machine", at_times?}`, `{kind: "film.audit"}`, `{kind: "film.layout"}`; `planted?` | `verdict` rows `{id, result, machines?, issues}`, each issue `{code, severity, ids, t, …}` | #403, #1897, #407, #408 |
| `determinism` | `doc`, `display_hz: 144`, `at_times`, `compare: "same_machine"` | `outcome: "compared"`, `frames[]: {t, play.pixel_hash, seek.pixel_hash}` | #488, #1897 |
| `deep-gpu run` (`budget`, `off-reference`) | `{out, calls}`; `frame_budget` with `look` (the film's look asset), `writer: "agent:alpha"`, `doc` (the document in a file), `render: {seconds: span, pixels: size}`, `fps`; on `test-meter` with `--backend noop`, `stub_meter: {frames: [{from: 0, gpu_ms}]}` and `stub_environment` | `verdict`, `limits.{gpu,cpu}.{limit_ms, verdict, runs[].{p95_ms, invalid}, margin}` | #377, #1899 |
| `gh api` (`links`) | `repos/windoliver/deepbuild/issues/<n>/dependencies/blocked_by`, `…/<n>/sub_issues`, `per_page=100` | `[{number, state}]` | GitHub's issue dependencies and sub-issues |

Builds: `deep-show` `--no-default-features --features full` and `full,test-tick` (#488's `test.tick@1`); `deep-gpu`
with no features (the shipped build, for the real frame-budget run) and `--features test-meter` (#1899's stubs).

## Planted twins

Each check runs beside its planted twin, made by this suite from the delivered film, and the twin must fail, naming
its fault. Nothing in a twin is new to the base: each is the film plus one fault, an existing planted program, or an
existing test build.

| Check | The twin | Must fail naming |
|---|---|---|
| document.determinism | The film plus a 16 × 16 grid of `test.tick@1` items over [−w/2, 3w/2) × [−h/2, 3h/2), each w/48 × h/36, one every w/8 and h/8 (`full,test-tick`; `requires.modules` gains `test.tick` when the film lists modules); `at_times` 0, 352,799,999 and 352,800,000; planted `checkpoint_nearest_in_distance` (a seek that restores the checkpoint nearest in distance, so 0.5 s's step shows a flick early). Its control, the same document unplanted, must PASS | an error with its `code` at `t` 352,799,999, and no other time |
| film.audit | The film whose first `text@1` (by draw order) holds `drawn` repeated for 15 × (span + 2 s) letters: at 15 graphemes a second and the 1.5 s pad, it needs longer than the film lasts | `film.hold_short` naming that text, at a `t` inside the film |
| film.layout | The film plus `layout-twin`, a `text@1` line of 116 characters in capitals at h/4 u, centred on the document frame's centre in a box 12 w wide, about eight widths long, in the first text's font and paint | `layout.cut` naming `layout-twin`, at a `t` inside the film |
| the frame budget | The film's run on `test-meter`, noop backend, every frame read at 100 ms of GPU, under the reference Mac's stub fingerprint | FAIL on the GPU limit (`limit_ms` under 100), each of the five runs' p95 at 100 ms, no invalid frame, margin 0.05 |

What the twins assume of the films: at 0.5 s each film's view shows one of the grid's ticks (a view at least w/8 wide
over the region around the document frame does); at each checked cue end each film's view is narrower than six
document widths and crosses the frame's middle band, so `layout-twin` is cut at both sides.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass; each fails with a first line starting `BLOCKED:` or `INCONCLUSIVE:`.

- Every film test: BLOCKED while its `film.json` or an asset it names is missing, and when a build it needs fails.
- A GPU leg on a machine with no GPU (`gpu_unavailable`, `no_device`): BLOCKED.
- Seek against play (AC1): INCONCLUSIVE off a reference Mac (Mac15,7, Mac15,12 or Mac17,10 by
  `scripts/benchmark.mjs`'s fingerprint), after its comparison has run and held.
- The frame budget (AC2): INCONCLUSIVE when the check reads INCONCLUSIVE (off a reference Mac's environment, or five
  runs it can't decide), and when it passes with the one-minute load above the core count at the run's start or end;
  BLOCKED when the check is BLOCKED (invalid frames, no pass timestamps).
- The real run in AC3: BLOCKED when the check is BLOCKED there.
- AC4: BLOCKED without `gh` or the network.
- AC5: INCONCLUSIVE without the check run's files in `docs/evidence/239/`, without `TASTE.json`, or with a call made
  on other files.

## The taste call

The check run is **`node scripts/checkpoint-239-films.mjs`** *(chosen; the implementer writes it, as
`scripts/checkpoint-1163-shots.mjs` was written for #1163)*. It exports each film whole to H.264 with AAC, as
`exports.test.ts` does, and writes into **`docs/evidence/239/`** *(chosen)*:

| File *(chosen)* | What it holds |
|---|---|
| `strokes-and-paper.receipt.json`, `camera-and-transitions.receipt.json` | each export's receipt, as the `export` reply gives it |
| `strokes-and-paper-drawing.png` | a frame decoded from the exported MP4 while a stroke is being drawn on, its trim part way |
| `strokes-and-paper-drawn.png` | a later frame, the strokes drawn, on the paper |
| `camera-and-transitions-shot.png` | a frame inside a shot, during its camera move |
| `camera-and-transitions-transition-1.png`, `camera-and-transitions-transition-2.png` | a frame inside each of two transitions of different kinds, both sides showing |
| `strokes-and-paper.mp4`, `camera-and-transitions.mp4` | a recording of each film: its exported MP4, or a smaller copy of it |

Each PNG is at its film's size, the size its receipt records. The files are attached to the PR and shown in the
session; the one call is recorded later, by someone else, in `tests/acceptance/239/TASTE.json`:

```json
{
  "issue": 239,
  "criterion": "#239.85750ec9",
  "verdict": "looks_right",
  "who": "who made the call",
  "when": "2026-11-12T00:00:00Z",
  "screenshots": {
    "strokes-and-paper-drawing.png": "<sha256>",
    "strokes-and-paper-drawn.png": "<sha256>",
    "strokes-and-paper.mp4": "<sha256>",
    "camera-and-transitions-shot.png": "<sha256>",
    "camera-and-transitions-transition-1.png": "<sha256>",
    "camera-and-transitions-transition-2.png": "<sha256>",
    "camera-and-transitions.mp4": "<sha256>"
  },
  "note": "optional"
}
```

`verdict` is `looks_right` or `looks_wrong`; `when` is ISO 8601; `screenshots` names the seven files, receipts left
out, each with its SHA-256 (#1163's and #157's form). This job writes no TASTE.json and makes no picture. The PR also
carries the Proof's reports, each check's on each film beside its twin's (the verdict rows and frame-budget results
these tests read); no test reads them.

## Readings where the issue leaves a choice

- **"On the reference Mac"** for seek against play: the machine's model, chip and memory (a pixel-hash comparison
  isn't a timing, so power and heat don't enter); for the frame budget, its whole fingerprint, conditions included,
  as the design's reference-Mac rule and #1899's check read it, and the load at the run's start and end, as the perf
  lane reads it (scripts/benchmark.mjs `judgeLimit`). The export and the three document checks hold anywhere, so
  they aren't gated.
- **"20 sampled times"**: 20 distinct flicks in (0, span), none a frame's start, from mulberry32 seeded 239 (#1897's
  generator), the design's "20 seeded off-grid times reached from later times"; the `determinism` call's seek jumps
  from a second later.
- **"Passes film.blank"**: a delivery, since film.blank stops an export that fails it (#157); the receipt says no
  more about it. frames.finite, export.color and export.fidelity are read from the receipt's own fields.
- **"Sound included"**: the receipt's AAC at the film's sample rate, a PCM hash a frame, export.fidelity's sample
  count ⌊frames × frame length × rate ÷ 705,600,000⌋ a channel with `av_offset` 0, and an mp4a track in the file.
- **"Five runs on the reference Mac's environment fingerprint"**: the check's own run with no stub, judged on the
  fingerprint it reads from this machine.
- **"Naming its fault"**: the code and the item or time each twin's fault lies at (above); for the frame budget, the
  limit and the five p95s.
- **"#143 … blocked by this issue"**: #143 is an umbrella, held through its parts (the owner's comment: "#462 is
  blocked by #239, and #463 by #462"). It passes when #239 blocks it directly, or when it has an open part and every
  open part reaches #239 through open blockers, at most four links; a closed issue holds nothing. Its parts are its
  sub-issues.
- **"#99 no longer depends on #222"**: #222 isn't among #99's blockers.
- **"Taken by the check run from the exported file"**: each screenshot at the size the export's receipt records,
  beside it in `docs/evidence/239/`.

## Not tested

- The export guards' own planted twins: criterion 1 names none, and #157's suite holds each guard to its twin.
- #77's other four films, its manifests and its every-cue-end seek check (#77's own criteria).
- Seek against play across machines, `compare: shards`, sound in the determinism comparison.
- The frame budget's `still`, `allocations` and envelope fields, and its GPU lease.
- The Proof's reports beside their twins', and the check run itself beyond the files it writes.

## Not settled

- Whether `deep-gpu`'s `frame_budget` draws a 2D film whose look is a drawing look; the issue asks for the spine as
  it is, so these tests run the films through it unchanged.
- The twins' assumptions about the films' views (Planted twins); a film whose camera breaks them needs a redraft of
  that twin, not a change to the film's check.
- `film.hold_short` and `layout.cut` are #407's and #408's codes, read as those suites name them.
