# Acceptance tests for #488: canvas time core — one clock in flicks, valid frame and sample rates, and seeking that equals playing

Written first, from issue #488 (its scope, its Transport field list, its seven acceptance criteria and its
proof line), the design sections it names and those they lean on, and base commit `a8e5480` ("Merge pull
request #767 … feat/63-read-by-reference"; the worktree's checkout is `6a1966d`, the merge of #768 on top of
it, which touches none of the canvas time surface), by a job that never saw an implementation; none existed.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Films and figures on the canvas (546: "Every frame is a function of the time
  and the controls, with seeded randomness, so scrubbing, replay and export match exactly"); The canvas core
  and the canvas module table (1041–1076); Dogfooding and Tests written first (2508–2546).
- `docs/canvas-primitives.md`: Time and the flick (9–27: the unit, "a rate is valid only if its frame, sample
  or step length is a whole number of flicks", the valid and the not-valid lists with 8, 12 and 16 fps's
  frames and the sample rates, the conversion rules: "Integer arithmetic only. Time to index floors … Euclidean
  division, so a time before start floors toward −∞. Any product of a flick count and a rate is formed in
  i128", the property test "at 10,000 seeded times in [−2^62, 2^62] flicks and at k·Δ − 1, k·Δ and k·Δ + 1",
  "A display that runs at one samples the document, and its times round to the nearest flick"); Document
  envelope (291); Frame clock and scheduler (723: arms a frame only on a change or a `valid_until`; "Draw
  unasked" never); Carried state (1166: "Seeking restores the nearest checkpoint or pre-rolls the tail and
  steps forward, so seeking equals playing"); Look: frame history (2553: "exports, render-back, goldens,
  checks and content keys never read the window"); Transport (5088: the fields, `frame(t) = eval(doc, t,
  inputs ≤ t, view)`, "Each frame returns `valid_until`, and the app sleeps until then", "It can never: Run
  while nothing changes; let the rate, the display rate or the seek path change a frame; hold time in f32
  seconds"); Marker (5219: `t: time`, `kind`); Input track (5703: `checkpoint_every: s = 0.5`); Logic:
  checkpoints and bake (6694: "A seek restores the nearest checkpoint at or before t and steps forward");
  Determinism (8877: the default `at_times` set, "Playing to t means the live transport's warm path: every
  display frame from the start, or from the last seek, at the document's rate on a 144 Hz display, through
  every cache the app keeps; seeking means a cold evaluation at t reached by a jump from a later time. A
  comparison that renders both sides through the same cold evaluation is INVALID"); Determinism class
  (9199: "it passes the same-machine check that seeking equals playing").
- At the base: AGENTS.md; `tests/acceptance/387/` (closest: `deep-show run` scenarios as JSON lines, builds
  per Cargo feature set, `useBuilds`, `scenario`, `evalCall`, `planted`, test canvas modules as `test-*`
  features, criterion-tagged test files), `391/` (the frame clock on a virtual display, `drawn` and
  `valid_until`), `305/` and `393/` (`bad_input`, the reply stamps), `371/` (`transport.span` in boards),
  `14/` (fast-check); `crates/deep-show` (`src/main.rs`: `scenario()` 529–806 with `clock` and `planted`,
  `call()` 246–420 where `eval`'s `t` goes through `hub::flicks`, `--planted` 1311; `src/hub.rs`: `Planted`
  44, `flicks()` 506 resolving literals at a hard-coded 60/1, `call` dispatch 738–840, the refusal reply
  1040–1070; `src/frames.rs`: `eval` 207, `frames` 300; `src/kit/fixtures.rs` 89–115 `seek_and_play`, two
  cold sessions; `src/kit/carried.rs`; `Cargo.toml` features); `crates/deep-canvas` (`src/grammar/time.rs`:
  `FLICKS_PER_SECOND`, `frame_flicks` refusing a non-whole frame only when an `f` literal resolves,
  `Time::parse/resolve`, `TimeContext` with `markers`; `src/document/shape.rs` 51–57 the transport default
  without `sample_rate`; `src/document/check.rs` 1580 `duration()`; `src/document/mod.rs` `ENVELOPE_KEYS`
  with `markers`; `src/schedule/steps.rs`: steps replay from 0 on a backward seek, no checkpoints;
  `src/registry/mod.rs`: `Operator::steps`, `Registrar::carried`, `Stepper`, `CARRIED_KINDS`);
  `crates/deep-canvas-motion` (`src/doc.rs` `frame_rate_of` 310, no whole-flick check; `src/main.rs`
  `deep-motion run` with `refresh_hz`); `crates/deep-canvas-test-modules/src/lib.rs` (how a test module
  registers: `manifest`, `kind`, `r.array`, `r.operator(…).steps(…)`, `View::carried`, `earlier`, `t`);
  `crates/deep-show/src/kit/modules.rs` (`test.kit.carry`: a `Stepper` with checkpoints);
  `crates/deep-gpu-layer/src/live.rs` (no seek event, no 144 Hz notion); `scripts/canvas-lint.mjs` (no
  statics, f32 time, clocks or HashMap in a `deep-canvas*` crate); `scripts/lanes.mjs` (the `alone` list).

What the base already does and these tests don't credit: time literals parse, and `f` literals resolve at a
document's frame rate inside the check's `duration()` (`frame_flicks` refuses a non-whole frame there, and
only there), while `deep-show`'s `eval` resolves its `t` at 60/1 whatever the document says; `deep-motion run`
refuses a display `refresh_hz` that doesn't divide 705,600,000; the kit's `seek_vs_play` sidecar compares a
fresh session framed at t with one framed every frame, both cold, with no checkpoints and no 144 Hz warm path.
There is no `sample_rate` anywhere, no export-rate check, no checkpoint restore in the scheduler (a backward
seek replays the steps from 0), no frame-number-keyed test module and no planted twin for any of this. A
document at 85/1 fps is presented. So these tests define the surface below.

## Run them

They build cargo binaries per feature set, like #387's, so they run with `--no-file-parallelism`.
`scripts/lanes.mjs` needs `'tests/acceptance/488/'` added to its `alone` list (the one-at-a-time line beside
`'tests/acceptance/387/'`). This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/488 --no-file-parallelism
npx tsc -p tests/acceptance/488/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds each feature set it uses, once, with `cargo build --locked --bin deep-show
--no-default-features --features <set>[,<test feature>…]` in the checkout, copies each binary out of
`target/debug` under its own name in a temporary folder, and fails each test that uses a build that failed.
Each test opens an evidence store root in a temporary folder and deletes it. The tests use node built-ins,
vitest and fast-check (a dev dependency at the base). A run with `--root tests/acceptance/488` leaves
Vitest's cache in `tests/acceptance/488/node_modules/.vite`; delete it. Everything runs headless on the CPU
(canonical renders through Vello CPU, as #393's render-back); no GPU, no app, no reference-Mac gate.
`BASE-FAILURE.txt` is the run at the base: all 23 tests fail there, because `deep-show run` answers
`bad_input` to a scenario holding any of the new calls or an `eval` whose `t` is a flick count, a document
at 85/1 fps or 128 kHz is presented, and neither `test-*` feature of this suite exists, so those builds fail.

Property tests (fast-check) record their seeds in the test files (`SEED`), so a failure replays; fast-check
shrinks a failure and prints its counterexample. Sizes are set for minutes, not hours: `rates.test.ts` runs
8 generated scenarios of up to 40 frame indices each (seed 488_0001; about a minute). The design's 10,000
seeded times over every pair of valid frame and sample rates are the release preflight's to run with a
larger `numRuns`, not this suite's. The two `determinism` comparisons over the default set (about 120 times,
each playing up to 432 display frames of a four-item board and rendering twice at 320 × 200) take a few
minutes per test; timeouts are set at 30 minutes.

## The surface under test

The issue names a clock, a rate rule, a transport, checkpoints, canonical renders and planted wrong
programs, but no code API. These tests extend #387's `deep-show` binary: its Cargo features select the build
set and the test canvas modules, its `run` subcommand answers scenarios of calls, and #393's, #305's and
#387's conventions (JSON lines, `bad_input`, the scenario, the calls and replies, the `core` and `set_digest`
stamps, `planted`) hold unchanged. What follows is what this issue adds. Times in the new calls and replies
are flicks as JSON integers (as #391's binaries take them); every time these tests send or read is below
2^53 except 2^62, which one scenario writes as text.

### The rate rule: `{"call": "rate"}`

```json
{"call": "rate", "frame_rate": [p, q] | "sample_rate": Hz (exactly one),
 "t"?: flick, "k"?: integer, "source"?: true (sample rates only)}
```

answers the design's valid-rates rule for one rate, with no document:

```json
{"outcome": "valid", "rate": "p/q" | "<Hz> Hz", "length": Δ,
 "index"?: ⌊t ÷ Δ⌋ (with "t"; Euclidean, so a time before 0 floors toward −∞),
 "t"?: k × Δ (with "k")}
{"outcome": "refused", "code": "bad_rate", "rate": "p/q" | "<Hz> Hz"}
{"outcome": "resampled", "rate": "<Hz> Hz"}
```

- `length` is the whole-flick frame (705,600,000 × q ÷ p) or sample (705,600,000 ÷ Hz). A rate whose
  length isn't a whole number of flicks is `refused`, naming the rate as the text `rate` carries (`"85/1"`,
  `"128000 Hz"`); the tests read the number out of the reply's JSON, so the field may carry more.
- A sample rate asked with `source: true` is the rule for a source (a sound at that rate): valid as above,
  and otherwise `resampled`, naming the rate, never refused: a 128 kHz, 384 kHz or 44,056 Hz source is
  resampled to the transport's rate (R6's mixer does the resampling; here the rule is what's proven).
- `index` and `t` are computed in integers: the product of a flick count and a rate in i128, the division
  Euclidean (Conversions). `t` may be any i64 (2^62 among them); `index` and `t` in the reply are JSON
  integers.

### Times in a document: `{"call": "time"}` and `eval`'s `t`

- `{"call": "time", "doc", "text": time literal}` answers `{"outcome": "resolved", "t": flicks}`, the
  literal resolved against the document's current revision: `f` at `transport.frame_rate`, `@marker±span`
  at the document's `markers` (`markers: {id → {t, kind, name}}`, the Marker fields, resolved at check), or
  `{"outcome": "refused", "code": "bad_time" | "time_unresolved"}`.
- `eval`'s `t` (and `pixels`, `size`, as #387 defines them) also takes a JSON integer, a flick count; a
  literal resolves as `time` does, against the document's rate and markers, never a fixed 60/1. The reply's
  `t` is the flick evaluated (#387's reply already carries it).

### The document's transport

`transport.frame_rate: [p, q] = [60, 1]` and `transport.sample_rate: Hz = 48000` (Transport, in the
document). At deep_show the check refuses a rate whose frame or sample isn't a whole number of flicks with
an error issue `{"code": "bad_rate", "severity": "error", "path": "transport/frame_rate" |
"transport/sample_rate", …}` whose JSON names the rate (`85/1`, `128000`): the document is `refused` and
no revision of it becomes current (#387's `out_of_range` convention). 8/1, 30000/1001 and 44,100 Hz are
presented.

### Exports: `{"call": "export"}`

```json
{"call": "export", "doc", "frame_rate"?: [p, q], "audio"?: {"sample_rate": Hz}}
```

plans an export of the document's current revision at the given rates, defaulting to the document's
`transport.frame_rate` and `transport.sample_rate`, and answers `{"outcome": "planned", "frame_rate": [p,
q], "frame": Δ, "sample_rate": Hz, "sample": Δs}` or `{"outcome": "refused", "code": "bad_rate", "rate":
…}` naming the rate that has no whole-flick frame or sample. No file is written; the plan is the rate rule
applied where an export's rates are set (Transport: "an export's `audio.sample_rate` defaults to it").

### The live transport: `{"call": "play"}`

```json
{"call": "play", "doc", "display_hz": 144, "to": flick}
```

plays the document's session on a virtual display at `display_hz` from the timeline's start to `to`: the
display runs a frame at every k × (705,600,000 ÷ display_hz) ≤ `to`, and the transport draws a frame only
when the frame clock arms one (Frame clock and scheduler: the first frame, then each frame's `valid_until`
or a change), through the session's caches. It answers `{"outcome": "played", "frames": display frames run,
"drawn": frames drawn, "last_drawn": flick | null}`. A still board draws one frame, its first; a board that
slides for 2 s and rests draws every display frame of the slide, the frame it rests on, and no other. 144
is a valid display rate (4,900,000 flicks); the tests use no other.

### Seek against play: `{"call": "determinism"}`

```json
{"call": "determinism", "doc", "display_hz": 144, "play"?: "warm" (default) | "cold", "at_times"?: [flick]}
```

compares, for each time t of `at_times` (default: Determinism's default set for the document, below), the
frame reached by playing to t with the frame reached by seeking to t, on canonical renders, and answers

```json
{"outcome": "compared", "at_times": [flick, ascending, unique],
 "frames": [{"t": flick,
             "play": {"pixels": sha256, "nodes": [{"operator", "module", "item": ID | null, "result": sha256}]},
             "seek": {"pixels": sha256, "nodes": […]}}]}
```

- **Play (warm)** is the live transport's warm path: a fresh session of the document, evaluated at every
  display frame k × 4,900,000 < t from 0, in order, then at t, all in that one session through its caches,
  carried state and checkpoints (the every-vsync run; no frame is skipped because nothing changed). The
  frame at t is the one rendered.
- **Seek (cold)** is a cold evaluation at t reached by a jump from a later time: a fresh session, evaluated
  at t + 1 s, then at t. The jump back restores the last checkpoint at or before t and steps forward from
  it; a session with no checkpoints replays from the start.
- **Play (cold)** (`play: "cold"`) is a fresh session evaluated at t alone: the comparison the design calls
  INVALID, on the surface only so a test can show what passes it. It never counts as proof.
- `pixels` is the SHA-256 of the canonical render's PNG at t (the document's size, through Vello CPU, as
  #393's snapshots; the PNG in the evidence store), which never reads frame history. `nodes` are the frame's
  nodes as #387's `eval` lists them, with each node's `result` (the SHA-256 of what it wrote), so a test can
  name the module whose result differs; `key`, `phase` and `run` are not needed here.
- **The default `at_times`** is Determinism's: the start; every key, marker, cut, wrap and fork flick and
  the flick before each; every checkpoint flick, the flick before it and the midpoint to the next; the
  span's last flick; and 100 times from the check's seed (the document's `seed`), the same list on every
  call for one document. The tests require every named time of their boards to be present and at least
  100 others; the flick before 0 is neither required nor refused.

### Checkpoints

A stepping canvas module that declares carried state of kind `checkpoint` has a checkpoint taken at every
multiple of 0.5 s (Input track: `checkpoint_every: s = 0.5`), the first at 0; a checkpoint at flick c holds
the module's state as of c, after the step at c if there is one. A seek to t restores the last checkpoint
at or before t and steps forward through (c, t]; playing on never restores. Checkpoints live in the
session (the carried state's byte budget); nothing here touches the disk.

### New scenario `planted` values

Each is a wrong program reachable only through the scenario's `planted` (as #387's):

- `checkpoint_nearest_in_distance`: a seek restores the checkpoint nearest to t by |c − t|, the earlier of
  two equally near, then steps forward when it is before t and shows its state unchanged when it is after
  (so at 0.5 s − 1 flick it shows the state of 0.5 s).
- `accepts_every_sample_rate_8_to_192k`: the sample-rate rule (in `rate`, the document check and `export`)
  accepts every rate from 8,000 to 192,000 Hz inclusive and refuses the rest.
- `frame_index_i64_product`: `rate`'s `index` forms t × p in i64 (it wraps at 2^62 × 240000).
- `frame_index_truncating_division`: `rate`'s `index` divides truncating toward 0 (so t = −1 gives 0).

No new `--planted` startup value.

### The test canvas modules (Cargo features of `deep-show`)

Each is in no shipped build. A document that uses one's kind declares it in `requires.modules`
(`{"test.tick": "^1"}`). A kind "drawn as `rect@1`" draws its `box` filled, as #305's `test.a@1` does, and
an array that `contributes_to` the transform moves the item as #387's `test.nudge` does.

| Feature | Module | Manifest and registration | For |
|---|---|---|---|
| `test-tick` | `test.tick` 1.0.0 | Kind `test.tick@1` {`box`}, drawn as `rect@1`. Array `test.tick.count` (i64, document, simulate) and `test.tick.offset` (item) with `contributes_to` the transform. Operator `test.tick.step` (simulate; `.steps(11_760_000)`, 60 Hz; reads `[]`; writes `test.tick.count`: its count one up per step, carried from the last step), declaring carried state `checkpoint` (`r.carried("checkpoint", "test.tick.state", 64)`), checkpointed every 0.5 s as above. Operator `test.tick.offset` (items; reads `[self, test.tick.count]`; writes `test.tick.offset`): the item moves by `[count mod 48, 0]` u, so each step changes the frame | criterion 1 |
| `test-frame-cache` | `test.cache` 1.0.0 | Kind `test.cache@1` {`box`}, drawn as `rect@1`. Array `test.cache.offset` (item) with `contributes_to` the transform, and the module's memo (carried state it declares, kind `tail`, `test.cache.memo`). Operator `test.cache.offset` (items; reads `[self, t]`; writes `test.cache.offset` and its memo): the item moves by `[⌊(t mod Δ) ÷ 490,000⌋, 0]` u with Δ = 11,760,000 (the document frame at 60 fps), computed from the exact t the first time the frame number ⌊t ÷ Δ⌋ is seen in the session and answered from the memo whenever that frame number was seen before: the cache keyed by frame number | criterion 7 |

Builds the tests make: `full`, `full,test-tick`, `full,test-frame-cache`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and
the leading `- [ ] ` dropped (#305's command). Each test's name starts with its criterion's ID. Where a
criterion names a wrong program, the test runs it through `planted` or a test feature and asserts that it
fails the way the criterion says, naming what it says.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| `#488.304e296f` | Jumping to each time in Determinism's default set gives the same frame, pixel for pixel on one machine, as playing to it, for the same document, recorded input track, rendering mode, backend and settings, compared on canonical renders, which never read frame history; a planted seek that restores the checkpoint nearest in distance fails one flick before the second checkpoint, naming that flick | `seek-play.test.ts`, on `full,test-tick`, a board with a `test.tick@1` item (steps at 60 Hz, checkpoints every 0.5 s), a rect sliding over 2 s and a label, 3 s long: the default set holds 0, the key flicks 2 s and 2 s − 1, every checkpoint 0.5 s … 2.5 s with the flick before each and the midpoints 0.25 s … 2.75 s, 3 s − 1, and at least 100 seeded others, the same on a second call; at every time the cold seek's `pixels` and every node's `result` equal the warm play's, while the frames at 0.5 s − 1 and 0.5 s differ (the board moves); on `full`, a plain sliding board passes the same comparison. `planted: "checkpoint_nearest_in_distance"` over the named times fails, the first failure at 352,799,999 (0.5 s − 1), naming that flick, the seek's frame there being the play's frame of 0.5 s, and nothing failing at 0.25 s. Wrong programs: the base (no call, no checkpoints, no module); the planted restore; a play side that renders through the cold path (it would hide a stale cache) |
| `#488.ee0f61fe` | A still timeline draws no new frames | `still.test.ts`, on `full`: a still board played 3 s on a 144 Hz display runs 433 display frames and draws 1, at 0; a board that slides for 2 s draws between 288 and 290 frames, the last at 2 s, so none in the still second after. Wrong program: a transport that draws every display frame |
| `#488.12324609` | 8, 12 and 16 fps and their ×1000/1001 forms have whole-flick frames (88,200,000, 58,800,000 and 44,100,000 flicks at the integer rates) and round-trip frame to flicks to frame exactly | `rates.test.ts`, on `full`: `rate` answers 88,200,000, 58,800,000, 44,100,000, 88,288,200, 58,858,800 and 44,144,100 flicks for the six rates; frames 0, 1, 195, 2^20 and −7 round-trip at each (frame(k·Δ) = k, frame(k·Δ − 1) = k − 1, frame(k·Δ + 1) = k; frame 195 at 8 fps is 17,199,000,000 flicks); a generated property (fast-check, seed 488_0001, 8 runs of up to 40 frames in [−2^26, 2^26] at the six rates) does the same. Wrong programs: a rate table in float seconds; a conversion through f64 |
| `#488.5827cbd0` | A document or export rate whose frame isn't a whole number of flicks is refused naming the rate, and times written as `195f` or `@marker+1.25s` store exact flicks | `document-rates.test.ts`, on `full`: boards at 85/1 and 11/1 fps are refused with `bad_rate` at `transport/frame_rate` naming the rate; boards at 30000/1001 and 8/1 are presented and export at 23,543,520 and 88,200,000 flicks a frame; an export at 85/1 of a 30 fps board is refused naming `85/1`, one at 24000/1001 is planned at 29,429,400; on a 30 fps board with a marker `m` at 2 s, `time` resolves `195f` to 4,586,400,000, `@m+1.25s` to 2,293,200,000, `@m-0.5s`, `1.25s` and `@m`, and refuses `@nowhere+1s` as `time_unresolved`; a placement at `195f` shows its first key at flick 4,586,400,000 and not at 4,586,399,999 (that frame is the frame at 0), and `eval` at the literals `195f` and `@m+1.25s` lands on those flicks. Wrong programs: the base (85/1 presented; `195f` at 60/1 = 2,293,200,000); a refusal that doesn't name the rate |
| `#488.3783b684` | A sample rate is valid only when its sample is a whole number of flicks: 8, 11.025, 16, 22.05, 24, 32, 44.1, 48, 88.2, 96, 176.4, 192 and 352.8 kHz pass; a 128 kHz source (5,512.5 flicks a sample), a 384 kHz one and a 44,056 Hz one are resampled, and an export set to 128 kHz is refused, naming the rate; a planted check that accepts every rate from 8 to 192 kHz passes 128 kHz and fails this test, naming the rate | `sample-rates.test.ts`, on `full`: the thirteen rates are valid with samples of 705,600,000 ÷ Hz flicks; 128,000, 384,000 and 44,056 Hz are refused as rates (`bad_rate`, naming the rate) and `resampled` as sources; a board at 128 kHz is refused with `bad_rate` at `transport/sample_rate` naming `128000`, one at 44.1 kHz is presented and exports at 44,100 (16,000 flicks a sample), the default is 48,000 (14,700), an export at 128 kHz is refused naming `128000` and one at 96 kHz planned (7,350). `planted: "accepts_every_sample_rate_8_to_192k"`: the rule check on 128 kHz (`rate`, a source, an export) and 44,056 Hz fails, the failure naming `128000`. Wrong program: the planted accept-all check |
| `#488.75ff3f37` | At 240000/1001 fps, t = 2^62 flicks gives frame ⌊2^62 ÷ 2,942,940⌋ and t = −1 gives frame −1; a planted i64 product overflows on the first and a truncating division gives 0 on the second, each failing | `edges.test.ts`, on `full`: `rate` at 240000/1001 has a frame of 2,942,940 flicks; t = 2^62 (sent as text) gives 1,567,033,652,887; t = −1 gives −1; t = −Δ gives −1 and −Δ − 1 gives −2. `planted: "frame_index_i64_product"` fails the 2^62 check naming the time; `planted: "frame_index_truncating_division"` fails the −1 check (frame 0, or no answer). Wrong programs: the two planted conversions |
| `#488.e8e56351` | A test canvas module whose cache is keyed by frame number passes a cold-against-cold comparison and fails this one, where playing runs the live transport's warm path at a 144 Hz display from 0 to t and seeking is a cold jump from a later time, naming the module and the first frame that differs | `frame-cache.test.ts`, on `full,test-frame-cache`, a board with a `test.cache@1` item, a sliding rect and a label: `play: "cold"` over the default set finds no difference; the warm comparison fails, every failure naming `test.cache`, the first naming a compared flick at which an earlier display frame of the same document frame filled the memo; over the explicit times 0, 4,900,000, 9,800,000, 11,760,000 and 14,700,000 exactly 4,900,000 and 9,800,000 differ, the first failure naming 4,900,000 and `test.cache`. Wrong program: a comparison whose play side is a cold evaluation (it passes the stale module) |

## Readings where the issue and design leave a choice

- **One binary, more calls.** Canvas time is observed through `deep-show run`, the binary #305 and #387 left
  with the seal, its build sets and test features; a separate binary would need its own seal and session.
- **Times are integers on the new surface.** The clock is an i64 count of flicks; the new calls take and
  give flicks as JSON integers, and `eval` learns to take one too (its literal `t` is kept, resolved
  honestly). 2^62 is the one value past 2^53 the tests send, as text.
- **The rate rule is a pure call.** `rate` answers the valid-rates rule and the integer conversions with no
  document, since the criteria name rates, frames and flicks, not documents; the document and export checks
  reach the same rule through deep_show and `export`.
- **"A 128 kHz source is resampled"** is read as the rule's classification of a source: taken, with a
  resample to the transport's rate, never refused. No audio lands in R1, so the resampler isn't on the
  surface; the rule that sends such a source to it is.
- **"An export set to 128 kHz is refused"** is the `export` call: a plan at explicit rates, refused with
  `bad_rate` naming the rate. The plan writes no file; a real export is the export kinds' (R6).
- **"Naming the rate"** is read on the reply's JSON: the rate's text (`85/1`, `128000`) appears in the
  refusal (`rate`, or the issue's fields); the tests don't fix which field.
- **The frame history** never reaches a canonical render (Look: frame history); the render-back these
  comparisons hash has no frame history to read in R1, so that half of the criterion holds by construction
  and the tests assert only that `pixels` is the canonical render's hash.
- **The recorded input track, rendering mode, backend and settings** are the same on both sides by
  construction: one document, no input track at the base, one renderer (Vello CPU), one size.
- **"A cold jump from a later time"** is a fresh session framed at t + 1 s then at t; "a cold session" seek
  (framed at t alone) is the INVALID play side, kept only for the cold-against-cold test. The design's
  second seek, "from one last played past the target", is the same jump made in the warm session; it isn't
  on this surface.
- **Checkpoints** are the scheduler's for any stepping module that declares `checkpoint` carried state,
  taken every 0.5 s (the input track's default spacing), each holding the state as of its flick, so a seek
  to the flick before a checkpoint must not use it. The planted nearest-in-distance twin breaks ties toward
  the earlier checkpoint so the named failure is at 0.5 s − 1 and not at the midpoint 0.25 s; its first
  failure over the named times is read in ascending time order. The planted check runs over the named set
  only (no seeded times), since the twin also fails at any seeded time nearer to the next checkpoint than
  to the last, and the criterion names the flick before the second checkpoint.
- **"Pixel for pixel"** is equality of the canonical render's SHA-256; **"the frame"** is also every
  node's result, so a difference names the module whose result moved.
- **"Draws no new frames"** is the transport's own count of frames drawn and the last one's time, on a
  virtual 144 Hz display, as #391's `deep-motion run` counts presented frames; the first frame is always
  drawn.
- **The default `at_times`** are checked for the named members and for at least 100 others; the seeded
  times are the binary's, from the document's seed, so the list repeats.
- **The transform** in the test modules is whatever array the build composes `at` into, as #387's
  `test.nudge` names it; the modules' boxes move so their state reaches the pixels.

Not tested, because no criterion asks or the surface can't reach it: the audio master, `latency`,
`loop: ping_pong`, `rate` (the run-time preview rate), `master`, `span: open`, `reduced_motion` under the
transport (#371 and #387 cover it), the audio spans per frame, the file timescales, display rates that
don't divide 705,600,000 (the design samples at them; nothing here plays on one), the input track, the
cross-machine comparison, `compare: shards`, physics and logic steps proper (the test modules stand in for
stepping modules), and the design's full 10,000-time property over every pair of rates (the preflight's).

## Upstream tests (the Oracle lane)

The issue's Oracle page (`doneright/oracles/issues/488.md` in `DeepBuildAI/deepbuild`, branch `doneright`)
names other projects' own tests, pinned by commit, for 3 of the 7 criteria. That repository was not
reachable from this machine when these tests were written (HTTP 404), so the Oracle lane is **BLOCKED** for
#488 with one unblock ask: give this job read access to `DeepBuildAI/deepbuild@doneright` (or a copy of
`doneright/oracles/issues/488.md` and the vendored tests it pins), and the oracle tests can be mapped to
their criteria beside these. Until then these tests are the local proof for all seven criteria, written
from the issue and the design alone; an oracle that later disagrees with one of them goes to the blind
redraft, never to an edit of these files.
