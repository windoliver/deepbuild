# Acceptance tests for #466: films in time: operator transitions, boil cycles, tempo motifs, reveal sounds and captions the look designs

Written first, blind, from issue #466 (its Scope, its Fields, its nine acceptance criteria, its Proof line "The
transition, boil, motif, reveal and caption fixtures with their seek-against-play hashes", its Depends on list), the
design sections it names and those they lean on, its Oracle page, and base commit `27a7c0706` ("Merge
remote-tracking branch 'origin/worktree-github-issue-1938-282ccb' …": main plus #1938's render checks), by a job that
never saw an implementation; none existed, and no other worktree, branch, PR or stash was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 466 --repo windoliver/deepbuild`). Nine criteria: eight functional and the "Shown
  to you" taste call (AC9). Each test's name starts `AC<n> #466.<id>`, the first 8 hex digits of SHA-256 of the
  checkbox's text, trimmed, white space collapsed (`scripts/proof-change.mjs`, `criterionId`); the nine were computed
  again here and match the IDs this job was given.
- The Oracle page (`doneright/oracles/issues/466.md`, DeepBuildAI/deepbuild, branch `doneright`): no upstream test
  checks any of the nine criteria, so nothing is ported.
- `docs/canvas-primitives.md`: Transition; Transition: operator, iris and dip; Look `look@1` (its `time` field: quantize
  and the boil with `cycle`); Look `look@1`: samples; Look `look@1`: motifs; Look `look@1`: captions; Motion blur and
  Motion blur: velocity; Text `text@1` (`reveal` and the `#head` rule); Path `path@1` (`build`); Spawn, Spawn: variants
  and Spawn: variant and span; Occurrence list; Marker; Tempo map and cue alignment; Narration and captions; Flicker
  check; GPU operator through Determinism class (steps, inputs, outputs, place in the frame, the check, the WGSL
  subset, cost and limits, the determinism class). `docs/technical-design.md`: Films and figures on the canvas;
  Dogfooding.
- At the base, for surfaces and conventions only: AGENTS.md; `crates/deep-show/src/main.rs` (the calls, the scenario's
  `planted`), `frames.rs` (`eval`'s `film` block); `crates/deep-motion/src/main.rs` (`eval`'s line: `look`, `planted`,
  `view`, `project`); `crates/deep-canvas-motion/src/motif.rs` (motifs with a rate in beats, as #462 left them),
  `constraint.rs` (`follow_path`) and `doc.rs` (`time.quantize_hz`); `crates/deep-canvas-effects/src/check.rs` (the cost
  estimate) and `crates/deep-canvas/src/steps.json`, `steps.rs` (the public steps' ports and weights);
  `packs/fx-1.0.0/pack.json` (a pack's `operators` and their declared costs); `crates/deep-canvas-marks/looks/clean.json`;
  and the sibling suites `tests/acceptance/493`, `502`, `500/spawn`, `462`, `419`, `429`, `464`, `407`, `491`, `496`,
  `1938`, `501`, `449`, `382` for their conventions and helpers, several imported here as they are.

## Run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                   # once, if node_modules is missing
export NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/466 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/466/tsconfig.json   # type-check (exits 0)
```

Files run one at a time: each builds what it uses once, in `beforeAll` (7,200,000 ms), and copies it out of `target/`:
`cargo build --locked --bin deep-show --no-default-features --features full` (AC3, AC5 to AC8), `cargo build --locked
--bin deep-motion` (AC2, AC4), `cargo build --locked --bin deep-gpu` (AC1). `scripts/lanes.mjs` needs
`'tests/acceptance/466/'` in its `alone` list (this job writes only this folder; the implementer makes that edit). Every
`it` passes a 1,800,000 ms timeout. `--root` leaves Vitest's cache in `tests/acceptance/466/node_modules/.vite`; delete
it. `ac1-mosaic.test.ts`'s pictures come from the GPU layer on macOS's Metal device: off macOS its drawing legs read
`INCONCLUSIVE:`, never pass. Nothing here needs `say`, a network or a model. The suite was not run on the base: none of
its surfaces exist there (no operator, iris or dip transition, no boil, no reveal list, no designed caption, no blur on
the canvas path), so no `BASE-FAILURE.txt` is recorded.

## The surface under test

No new binary, subcommand or call: `deep-gpu run`, `deep-motion eval` and `deep-show run` with their JSON-lines
protocols as the merged suites left them. Names the issue and the design give are used as they give them; **every
other name below is this job's choice** (each is listed again under Choices), the smallest surface consistent with the
design and the base. The implementer builds exactly these, or a dispute goes to a blind redraft. Times are whole flicks
(705,600,000 a second) in requests and replies, or the time grammar's text (`"2.9s"`) in documents.

### Documents (all criteria)

#391's envelope (`{format: 1, id, profile: "film", title, description, size, safe: 24, locale: "en", camera: "cam",
layers, transport, items, …}`, a 2D `camera@1` over the page, so 1 u is 1 px), with:

| Field | As the tests write it | From |
|---|---|---|
| A shot | #493's `shots: {ID → {start, end, camera, move: "hold", target, view_width}}` (3D: `orbit`, and #462's `look`) | existing |
| An operator transition | `transitions.<ID> = {from, to, kind: "operator", operator: {op: "<pack operator ID>", reads: ["outgoing", "incoming", "progress"]}, span, align: "reveal", progress: "linear"}`; the document lists the pack in `packs: ["test/mosaic@1.0.0"]` (#429's form) | design; `align`/`progress` as #493 |
| An iris | `{from, to, kind: "iris", iris: {center: "<item ID>", radius: f32 px, hold_at: f32}, span, progress}` | design; `radius` a number a channel keys *(chosen)* |
| The iris radius channel | `channels.<ID> = {target: "transitions/<transition ID>/iris/radius", type: "f32", keys}` | *(chosen)* |
| A dip | `{from, to, kind: "dip", dip: {color: "ink", hold: "0.5s"}, span: "2.9s", progress: "in_out_quad"}` | design and Scope; `hold` as a time literal *(chosen)* |
| A boil | the look's `time.boil = {hz: 12, amount_px: 2, scope: "all", while: "always", cycle: 3, seed: "item"}` | design; `scope: "all"` (every stroke) and `seed: "item"` *(chosen values)* |
| Quantized time | the look's `time.quantize_hz: 12` | design, and the base reads it |
| Samples and blur | the look's `samples: {live: 1, export: 1, at_rest: "none"}`, `vary: ["pixel"]`, `motion_blur: {scope: "declared_moves", method: "samples", shutter_angle: 180, phase: "centred", samples: 8, adaptive: true, exclude: []}` | design; `motion_blur` on the look as #419 put it |
| Motifs | the eval line's look `motifs.<slot> = {motion: "pulse", amount, rate: {beats: 1}, phase: "free", desync: false, seed: "item"}`; the document's `collections` and `motif_slots` | design, #462 |
| Tempo map | `tempo_map: {segments: [{at: "0s", bpm: 120, meter: [4, 4], span: 8, ramp: "none"}, {at: "3:1b", bpm: 144, …, span: 12}]}` | #491 |
| A text reveal | a `text@1`'s `params.reveal = {mode: "fade", order: "reading", progress: 0, emits: true}`, its progress keyed by a channel on `items/<id>/params/reveal/progress` | design; the channel path *(chosen)* |
| A spawn on a reveal | `spawns.<ID> = {on: {list: "<item>.reveal"}, play: {src: {asset: <sha256>}, in: 0, out: <flicks>}, cooldown: 0}` | design, #500 |
| A path follow | `constraints.<ID> = {owner, kind: "follow_path", path: [[x, y], …], fraction: {data: "<key>"}}` with `data.<key>` keyed | existing |
| Look-designed captions | the look's `captions = {plate: "card", entrance: "unfold", text_after: 0.4, anchor: [0.5, 0.85], stage: "after_finish"}` | design; `anchor` a fraction of the safe area *(chosen)* |
| A caption shown by a text | `script.captions.shown_by: "<text item ID>"`: every caption whose characters are that text's shown text (white space collapsed) points at it | design's field; how it picks its caption *(chosen)* |
| The script | #502's `script: {narrator: {name, license, synthetic: false}, lines: {ID → {t, text, kind: "caption"}}, captions: {profile: "netflix-en-adult", font: "body", size: 14, shown_by}}` | existing |
| A look | a look@1 asset of the document (`assets.<id> = {sha256, license}`, its JSON in the evidence store by its SHA-256) named by `look: {asset: "<id>@1", theme: "light"}`; every look here is the shipped clean look with the fields above | #1162, #493 |

### `deep-gpu run` (AC1)

- **`view3d`** (#378's call) with #429's `packs: [{id, dir}]` and #462's `looks`; frames `from` 60 for 91 frames at
  60 fps, `capture: "every"`, `targets: ["final"]` (PNG under `out`, named by SHA-256). The new transition kind: both
  sides draw through their own looks to the end of the finish chain, the pack's pass runs over them, and `align:
  "reveal"` puts the first frame at which the operator's `coverage` output averages at least 0.5 over the picture on
  the cut's time.
- **A pack operator's transition inputs** *(chosen)*: `{"type": "texture", "from": {"transition": "outgoing"}}`, the same
  with `"incoming"` (each side's finished, display-referred color target), and `{"type": "f32", "unit": "ratio", "from":
  {"transition": "progress"}, "range": [0, 1]}` (the transition's eased progress). Outputs are a pass's `color` and
  `coverage` (design) with `blend: "replace"`. The pack is `pack.json` with `operators: {ID → operator}`, `origin:
  "pack"`, as `packs/fx-1.0.0` writes them (`fixtures/packs/test-mosaic-1.0.0`).
- **Reading an earlier frame**: an input `{"from": {"texture": {"target": {"op": "<its own ID>", "output": "color"}}}}`
  (the operator's own output, which only an earlier frame holds; `fixtures/packs/test-mosaic-history-1.0.0`, input
  `last_frame`). The `view3d` reply is a refusal: a string `code`, no drawn `frames`, and its JSON names `last_frame`.
  No code is pinned.
- **`check_operator`** (#380, with #429's reply fields): `{"call": "check_operator", "operator": <the pack's operator
  as pack.json holds it>}` answers `outcome: "accepted"` with `estimate_ns`, or a refusal whose `issues` hold
  `{code: "cost_understated", …}` (the design's code).
- **`--planted mosaic_reveal_by_progress`** (Planted programs).

### `deep-motion eval` (AC2, AC4)

The line `{doc, times, planted?, look?}` as at the base, answering `{ok: true, frames: [{t, items, …}]}`. New:

- In each frame, `transitions: {<transition ID>: {"kind", "progress", "iris"?: {"center": [x, y], "radius": px}}}`
  *(chosen)* for every transition whose window holds t; `iris.center` is in px of the document's `size` (origin top left,
  y down), the projection of the iris's centre item's anchor through the camera the frame draws.
- The line's `look` may carry `motifs`: with the document's `motif_slots` and `collections`, each frame's `items.<id>`
  is the item after its motif (a pulse writes `at.scale`), as `film2d` draws it (#462) *(chosen: the eval answer shows the
  motif)*.
- `planted`: `iris_center_at_window_start`, `motif_beats_at_first_tempo`.

### `deep-show run` (AC3, AC5, AC6, AC7, AC8)

The scenario as #493's suite writes it (`{evidence, sessions, processes, panels, docs, calls}`), plus the scenario's
`planted` (the names below). Calls:

| Call | Request | Reply fields read | New or existing |
|---|---|---|---|
| `deep show` | `peer`, `doc`, `document` (no `layers`, no item `layer`), `include: ["issues"]` | `outcome: "presented"` | existing |
| `eval` | `doc`, `t`, `pixels: true` | `snapshots[0].sha256` (a PNG in the evidence store): now drawing boils, dips and designed captions | existing (#387); what it draws is new |
| `eval` | `doc`, `t`, `film: true` | `film.occurrences: {"<list ID>": [{"t": flicks, "unit": index, "grapheme": string}]}` *(chosen)*, every list a text reveal or a path build compiles; `film.glyphs.<text ID>[k].opacity` (#493's), now holding the reveal's fade | new field; existing block |
| `export` | `doc`, `out`, `video: {codec: "png_seq"}`, `frame_rate: [24, 1]`, `range: [0, flicks]`, `captions: {profile, mode: "open", files: ["srt"]}` | `outcome: "exported"`, `receipt.frame_hashes`, `receipt.captions.cues: [{name, line, text, in, out}]`; the PNG files under `out`; `<out>.srt` beside it | existing (#501, #502) |
| `media_mix` | `doc: <a film document>`, `segments: [{from, to, write: true}]` | `mix.voices[k].occurrence`, `mix.segments[0]` (`first`, `frames`, `channels`, `sha256`, `wav`) | existing (#499, #500); a spawn on `<item>.reveal` is new |
| `verdict` | `claim` (a claim of #407's alpha with one requirement, its deliverable a stored document) | the requirement's row: `result`, `issues` | existing (#403, #407) |

- **The reveal list's rows** *(chosen)*: one per unit (here a grapheme) in reading order, `t` the first flick at
  which that unit's own reveal reaches 0.5 (the `#head` rule's "passed 0.5"), `unit` its index, `grapheme` its text.
- **`film.flicker` on a boil whose seed follows playback**: the row FAILs with an error of code `film.reseed`
  *(chosen)* that names the boil (a field holding the text `boil`, such as `path: "look/time/boil"`). The clean boil
  PASSes with no error or warning.
- **`render.contrast` on a film's captions**: the row PASSes with nothing raised; under the plant it FAILs with an
  error naming the caption by its name, `note.1` *(chosen: the caption's name in `ids`)*.

### Planted programs

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `mosaic_reveal_by_progress` | `deep-gpu run --planted` | AC1 | `align: reveal` places the frame where the transition's progress reaches 0.5 on the cut, not the frame where the operator's coverage first reaches half |
| `iris_center_at_window_start` | `deep-motion eval` `planted` | AC2 | the iris is centred where its item's anchor stood at the window's first flick, and stays there |
| `boil_ignores_cycle` | `deep-show run` scenario `planted` | AC3 | the boil's seed is ⌊t × hz⌋, with no `mod cycle` |
| `boil_seed_follows_playback` | `deep-show run` scenario `planted` | AC3 (named) | the boil's seed counts the frames drawn since playback began, not ⌊t × hz⌋ mod n |
| `motif_beats_at_first_tempo` | `deep-motion eval` `planted` | AC4 | a motif's rate in beats is counted at the tempo map's first segment's BPM for the whole film |
| `reveal_emits_at_unit_start` | `deep-show run` scenario `planted` | AC5 | each reveal row's `t` is the flick its unit's reveal starts (leaves 0), not where it reaches half; spawns follow the rows |
| `designed_caption_after_entrance` | `deep-show run` scenario `planted` | AC6 | a caption the look designs is timed from the end of its entrance, so its in- and out-times move later than the profile lays them |
| `caption_plate_in_text_role` | `deep-show run` scenario `planted` | AC6 | the designed caption's plate is drawn in the role of its own text |
| `shown_by_ignored` | `deep-show run` scenario `planted` | AC6 | a caption that `shown_by` points at a text still draws its own copy |
| `blur_quantizes_samples` | `deep-show run` scenario `planted` | AC7 (named) | each motion-blur sample's time (the frame's time plus its shutter offset) is quantized by the look's `quantize_hz` |
| `dip_cross_fades_under_ink` | `deep-show run` scenario `planted` | AC8 (named) | at every time in the window the dip draws ½ ink + ½ the cross-fade (1 − p)·out + p·in, p the transition's progress |

Twin fixtures, not plants: `fixtures/packs/test-mosaic-history-1.0.0` (AC1: reads an earlier frame), the mosaic graph
declaring 0.006 ns a pixel (AC1: understated cost). Each plant goes through the same judge function as the clean run
and must fail it naming what the criterion names.

## Criteria to tests

| Criterion | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC1 `#466.409171e5` | `ac1-mosaic.test.ts` (4) | over frames 60 to 150 of a 1 s mosaic dissolve aligned on its reveal (coverage ∝ progress²), the first frame at least half incoming is the cut's frame 120 within one frame; frame 60 under 1% and frame 150 over 99% incoming. Plant `mosaic_reveal_by_progress` fails naming `transition mz`. The twin pack reading `last_frame` is refused, naming it, while the clean pack draws. `check_operator`: accepted, `estimate_ns` within 25% of the declared 0.015; declaring 0.006 is refused `cost_understated` |
| AC2 `#466.95cafa31` | `ac2-iris.test.ts` (2) | at 1,000 seeded times in [1 s, 3 s) the iris centre is within 0.5 px of the walker's arc-length place on its polyline; plant `iris_center_at_window_start` fails naming `transition ir` |
| AC3 `#466.4f5a25b8` | `ac3-boil.test.ts` (4) | snapshot hashes: frame n = frame n + 15 (0.25 s) for n ≤ 89; frames 0 to 14 hold exactly three drawings, frames 0, 5, 10; each of 105 frames sought (seeded order) equals played. Plant `boil_ignores_cycle` fails naming `frames 0 and 15`. `film.flicker` PASSes with nothing raised; plant `boil_seed_follows_playback` FAILs, naming `film.reseed` and the boil |
| AC4 `#466.3b9b126d` | `ac4-motif.test.ts` (2) | the pulse's upward crossings of scale 1 lie within one 60 fps frame of each of beats 1 to 19 (0.5 s apart to 4 s, then 60/144 s), one each, none elsewhere; plant `motif_beats_at_first_tempo` fails naming `beat 9 (` |
| AC5 `#466.d3ce896d` | `ac5-reveal.test.ts` (2) | `title.reveal` has ten rows, unit k and grapheme k of "Typewriter" in order, each where glyph k's opacity crosses 0.5 (under it the frame before, at least it the frame at or after); ten voices on occurrences 0 to 9; ten clicks in the mix, click k on sample ⌈t_k ÷ 14,700⌉. Plant `reveal_emits_at_unit_start` fails naming `title.reveal[0]` |
| AC6 `#466.84cc08bc` | `ac6-captions.test.ts` (6) | the designed export's cues are `note.1` (two lines, frames 12 to 68) and `act.1` (frames 100 to 130), lines within 42 characters and 2 lines, equal to the undesigned twin's; plant `designed_caption_after_entrance` fails naming `caption note.1`. `render.contrast` PASSes; plant `caption_plate_in_text_role` FAILs naming `note.1`. Frames 100 to 129 equal the twin without `act`, the twin without `shown_by` differs there, the .srt's second cue is "Meanwhile at the harbour" at 4,166 to 5,416 ms; plant `shown_by_ignored` fails naming `act.1: frames` |
| AC7 `#466.e1124907` | `ac7-blur.test.ts` (2) | frames 2m and 2m + 1 the same bytes and receipt hashes for m 0 to 11, 2m + 2 different; on each of frames 2 to 21 one run of coverage over 2% reaching 98%, 4 to 14 partial pixels, centred within 1 px of 20 + 20m + 6; plant `blur_quantizes_samples` fails naming `frame 4 (` |
| AC8 `#466.5255a50c` | `ac8-dip.test.ts` (2) | at 0.6 s into the dip ½ out + ½ ink within one code value; every frame from 1.2 s to 1.7 s exactly the ink control's color; at 1.8, 2.05, 2.3, 2.6, 2.85 s (1 − w)·in + w·ink within one code value; plant `dip_cross_fades_under_ink` fails naming `frame 180 (` |
| AC9 `#466.9163b880` | `taste.test.ts` (1) | reads the record only; no pictures or no call on exactly them is INCONCLUSIVE, never PASS (The taste call) |

## Choices where the issue is open

1. **Surfaces.** The mosaic needs the GPU layer, so AC1 is `deep-gpu`'s `view3d` and `check_operator`; the iris and the
   motif are evaluation, so AC2 and AC4 are `deep-motion eval`; everything else is the CPU canonical path, `deep-show
   run`'s `eval`, `export`, `media_mix` and `verdict`. No new binary, subcommand or call.
2. **"A pack's composed mosaic transition"** is the test pack `test/mosaic` (fixtures) whose one pass graph,
   `mosaic.dissolve@1`, shows the incoming side in a 64 × 64 grid of cells where a draw seeded from the cell falls
   under progress², so coverage and progress differ and a reveal read from progress lands about 0.2 s off. Its
   declared cost, 0.015 ns a pixel, is the base's estimate rule applied by hand to its steps (about 0.0152).
3. **"Aligns on its reveal within one frame"** is read on the pictures: the first 60 fps frame at least half nearer the
   incoming look's wall color is the cut's frame (2 s) within one frame.
4. **"Refused if it reads an earlier frame"**: the operator reads its own output, which only an earlier frame can hold
   (GPU operator: it "can never … read its own earlier output or any state from a previous frame"); the document is
   refused before it draws, naming the input.
5. **"Costs within 25% of its declaration"** is the check's estimate (`estimate_ns`) within 25% of the declared cost,
   and the check refusing a declaration the estimate exceeds by more than 25% (`cost_understated`). The measured leg
   is the release calibration run's (#429); see Criteria out of reach.
6. **The iris's anchor** is the centre item's anchor with no `#anchor` given: a `circle@1` centred on its own origin, so
   its place; the path is a `follow_path` constraint by arc length; 1,000 times are mulberry32 seed 466, whole flicks in
   the window. `iris.radius` is a number a document channel keys (`transitions/<id>/iris/radius`); `hold_at` is written
   (0.5) because the Fields give no default; no test reads what it does.
7. **The boil's drawing** is read as the snapshot's SHA-256: "repeats exactly" is the same bytes. "Every 0.25 s" is
   frame n against n + 15 at 60 fps, and three drawings in one period. "Seek against play" is the same times drawn in
   a seeded order in the same process.
8. **"A seed that follows playback"** is caught by the flicker check as `film.reseed`, naming the boil.
9. **The motif's beat** is where a pulse (scale 1 + amount · sin 2π·beats) rises through 1, interpolated between frames;
   `desync: false` so the cycle starts on the beat. The tempo change is a step at `3:1b` (4 s), not a ramp.
10. **"A typewriter title"** is `reveal: {mode: "fade", order: "reading"}` with linear progress over 2 s; a unit's
    "reveal time" is when its own reveal reaches half, read against `film.glyphs` opacities within one frame.
11. **"On its occurrence's sample"** is the first sample at or after the row's flick, ⌈t ÷ 14,700⌉ at 48 kHz, read from
    the mixed PCM (a one-sample click), not from the voice's reported start.
12. **The designed caption's timing** is checked twice: against the layout rule worked by hand, and against the same
    film under the undesigned clean look. **"Line limits"**: each line ≤ 42 characters, ≤ 2 lines.
13. **`shown_by`** sits in `script.captions` as the design's field and names a text item; the caption it applies to is
    the one whose characters equal that text's. **"Draws no second copy"** is read as the designed export's frames
    over the caption's span equal the same film without that line, with a control (no `shown_by`) that differs.
14. **The blur's look**: one sub-sample a frame, so a frame's pixels are the shutter's eight samples alone; coverage is
    read in linear light on the green channel against the clean look's ink (#1b1d22) on white.
15. **The dip's times** are into its window; the dip is centred on the cut at 3 s, so it spans [1.55 s, 4.45 s) and
    1.45 s into it is the cut, frame 180. Blending is per 8-bit channel of the finished sides, as #493 reads its
    cross-fade; "the ink role's color" is the color a frame-filling ink rect draws under the same look.
16. **Pictures for the taste call** live in `docs/evidence/466/`.

## Criteria out of reach

- **AC1's measured cost.** The design holds an estimate to the GPU's measured time only in the release preflight's
  calibration run on the reference Mac (Operator cost and limits; #429's `calibrate`). This suite checks the
  deterministic leg (estimate against declaration) and does not time the pass; a timing leg off the reference Mac or
  under load would be INCONCLUSIVE, never FAIL.
- **AC9's "taken by the check run from the canvas's own frames" and "attached to the PR and shown to you".**
  `taste.test.ts` reads what is recorded and can't see how a picture was made or where it was shown. It holds
  INCONCLUSIVE until the record exists.
- Nothing else: every functional criterion has a test that reads its observation.

## The taste call

The check run writes five files to `docs/evidence/466/`, each from the canvas's own frames: `mosaic.png` (the mosaic
transition near its reveal), `iris.png` (the iris on the moving walker), `dip.png` (a frame of the dip's fade to ink),
`caption.png` (a frame with the designed caption `note.1`) and `transitions-boil.apng` (a recording of the three
transitions and one boil cycle). The owner's one call goes in `tests/acceptance/466/TASTE.json`:

```json
{ "issue": 466, "criterion": "#466.9163b880", "verdict": "looks_right", "who": "…", "when": "2026-11-15T09:00:00Z",
  "screenshots": { "mosaic.png": "<sha256>", "iris.png": "…", "dip.png": "…", "caption.png": "…", "transitions-boil.apng": "…" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`; `screenshots` names all five with their SHA-256. No test judges a picture.
This job writes no TASTE.json and creates no picture.

## Scope not under a criterion

The issue's Scope and Fields also name: path builds that emit `<item>.build` (a scrape per stroke); the reveal's
`write` mode and `seeded` order; motifs' alternate phases and `hold_on` markers; the iris's `hold_at` and what its radius
channel draws; dips to roles other than ink; the caption plates, entrances and stages other than `card`, `unfold` and
`after_finish`, the anchor per shot and `text_after`; `captions.mode: closed` with a designed look; and the "can never"
rows (an operator transition carrying shader text, a transition containing a reading hold or a checked moment,
recoloring status, a caption with a status role or hidden behind an item). No criterion states an observation for
them, so these tests don't check them; they are follow-ups for the implementer's own tests.
