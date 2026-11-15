# Acceptance tests for #466, AC6 (blind redraft): captions the look designs, and a caption that points at its text

A fresh run of the blind acceptance-test job, redrafting one criterion of issue #466 ("Films in time: operator
transitions, boil cycles, tempo motifs, reveal sounds and captions the look designs"):

> AC6 `#466.84cc08bc`: A caption designed by the look keeps its profile's timing and line limits and passes
> render.contrast, and a caption pointing at an intertitle draws no second copy while the .srt still carries its line

Written from the issue, the design sections below, the Oracle page and base commit `27a7c0706` ("Merge
remote-tracking branch 'origin/worktree-github-issue-1938-282ccb' into worktree-github-issue-466-dee1e1"), by a job
that never saw an implementation, the first draft (`tests/acceptance/466/`), or any other worktree, branch, PR or stash.
The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- The issue, live (`gh issue view 466 --repo windoliver/deepbuild`): its Scope ("Captions designed by the look (a plate,
  an entrance, an anchor per shot, a stage before or after the finish), still timed by the caption profile; a line
  whose words already show points at that text instead of drawing twice"), its Fields (Look `look@1`: captions) and AC6.
- Its Oracle page, `doneright/oracles/issues/466.md` on branch `doneright` of `DeepBuildAI/deepbuild`: criterion 6 has
  no upstream test ("Captions designed by the look are ours"), so nothing is ported.
- `docs/canvas-primitives.md`: Look `look@1`: captions (the fields; "the caption profile still sets their timing and
  line limits, and render.contrast and the film audit still check them. A caption whose words already show on screen
  points at that text with `shown_by` instead of drawing twice, and the .srt still carries it"); Narration and captions
  (the captions block with `shown_by: text ID`, `kind: caption` lines, the caption layout rule, the caption layer);
  Check input: loop kinds (`render.contrast {text: wcag | apca = wcag, min: 4.5, subject_ratio: f32 = 1.5}`).
- `docs/technical-design.md`: Films and figures on the canvas ("Captions are always on, designed by the look and timed
  by their caption profile"); Dogfooding.
- At the base: AGENTS.md; `crates/deep-canvas-media/src/captions.rs` (the profile netflix-en-adult: 42, 2, 20 a second,
  5/6 s, 7 s, 2 frames); `crates/deep-show` (`export.rs`: `captions {profile, files, mode}`, the sidecars, the receipt's
  `captions.cues`; `narration.rs`: the caption layer; `pixels.rs`: render.contrast's `at_times` and its text@1 items);
  sibling suites `tests/acceptance/502` and `1938` (and `493`, `501`, `407`) for conventions only.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/466-redraft-ac6 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/466-redraft-ac6/tsconfig.json   # type-check (exits 0)
```

`cargo` must be on PATH. The file builds `deep-show` once in `beforeAll` (`cargo build --locked --bin deep-show
--no-default-features --features full`, 2 h timeout); every `it` passes `TIMEOUT` (30 min). `scripts/lanes.mjs` needs
`'tests/acceptance/466-redraft-ac6/'` in its `alone` list (the implementer makes that edit). render.contrast reads
pixels on one machine; it is judged here on the machine that draws. Node built-ins and vitest only.

## The surface under test

No new binary or call: `deep-show run`, its `deep show`, #501's and #502's `export` with `captions` (receipt and
`.srt`), and #403's `claims` and `verdict` with #1938's `render.contrast`. **Every name below that the issue or the
design doesn't give is this job's choice**; the implementer builds exactly these, or a dispute goes to a blind redraft.

| Surface | Request fields | Reply fields read | New or existing |
|---|---|---|---|
| scenario | `evidence`, `sessions`, `processes`, `panels`, `docs`, `claims`, `calls` | `ok`, `replies` | existing |
| `deep show` | `peer`, `doc`, `document` (no `layers`, no item `layer`), `include: ["issues"]` | (none read) | existing |
| `export` | `doc`, `out` (a folder), `frame_rate: [24, 1]`, `video: {codec: "png_seq"}`, `captions: {profile: "netflix-en-adult", files: ["srt"], mode: "open" \| "closed"}` | `outcome: "exported"`, `receipt.frame_hashes`, `receipt.captions.cues: [{name, line, text, in, out}]` (`text` the lines joined by `\n`, times in flicks); the `.srt` at `<out>.srt` | existing (#501, #502) |
| `verdict` | `claim` | the row of the requirement `{kind: "render.contrast", at_times: ["2s"]}`: `result`, `issues[]: {code, severity, …}` | existing (#1938); judging the caption layer is new |
| look@1 `captions` | `{plate: "card", entrance: "unfold", text_after: 0.5, anchor: [0.5, 1], stage: "after_finish"}` | — | the design's fields; `anchor` as [x, y] fractions of the safe area *(chosen form)* |
| `script.captions.shown_by` | `"intertitle"` (a text@1 ID), in the captions block of a script whose one line's text is the intertitle's words | — | the design's field, where the design puts it |
| `script.narrator` | `{name, license: {id: "CC0-1.0", …, shareable: true}, synthetic: false}` | — | as #502's suite writes it (an export carries a script only under a shareable license) |
| a contrast issue naming a caption | — | a string field (not `what` or `fix`) equal to the line ID, `<line>.<n>`, or a path holding `lines/<line>` | *(chosen)*: how an issue names a caption, as #407's suite reads it |

### The fixtures

`helpers.ts` builds every document and look; nothing is on disk. Two looks, each a look@1 on a drawing basis with flat
roles (white ground, graphite ink `#1b1d22`, `raised` `#f5f5f5`, `muted` `#7c7c7c`): the caption look, with the
`captions` field above, and the plain look, the same with no `captions`. Every film is 640 × 360 u at 24 fps, `locale:
"en"`, with a `muted` field over half the frame, ordered first, so no frame is one flat luma (the export refuses that as
film.blank), and a script of `kind: caption` lines (no sound) under `{profile: "netflix-en-adult", font: "body", size:
24, plate}`.

- **The harbour film** (5 s): the line `harbour`, t = 0.5 s, "A small lamp glows over the quiet harbour while the
  fishing boats sleep" (71 characters), on a `raised` plate; its contrast twin has the plate in `muted` (4.05:1 against
  the ink, 4.17:1 against white: under 4.5 either way). No text@1 item, so render.contrast at 2 s judges the caption
  alone.
- **The intertitle film** (3 s): an intertitle text@1 `intertitle`, "The harbour sleeps", 40 u, centred on the white top
  half and shown the whole film; the line `sleeps`, t = 0.5 s, of the same words; `shown_by: "intertitle"` in its
  captions block. The control is the same film without `shown_by`.

The expected captions, worked out by hand from the layout rule (Narration and captions), Δ = 1/24 s: `harbour.1` is
"A small lamp glows over the quiet harbour" (41) / "while the fishing boats sleep" (29), in at ⌊0.5 ÷ Δ⌋ = frame 12,
out at ⌈(0.5 + 71 ÷ 20) ÷ Δ⌉ = ⌈97.2⌉ = frame 98 (3.58 s, inside 5/6 s to 7 s, 19.8 a second); in the .srt 500 to
4,083 ms. `sleeps.1` is "The harbour sleeps" (18), frames 12 to ⌈33.6⌉ = 34 (22 frames, over 20 for 5/6 s); 500 to
1,416 ms. The base lays both out exactly so and draws the films as described (checked by running their exports on the
base: it draws the `sleeps` caption under the intertitle as a second copy, on frames 12 to 33).

### Planted programs

None. The criterion names no planted program; two twin documents prove the checks see what they judge:

| Twin | Criterion part | What it must do |
|---|---|---|
| the harbour film with the plate in `muted` | passes render.contrast | fail the same judge (`contrastFailures`), a failure naming the caption `harbour` |
| the intertitle film without `shown_by` | draws no second copy | its open export differ from its closed one on exactly frames 12 to 33, so the frame comparison sees a caption |

## Criteria to tests

The test names start with `AC6 #466.84cc08bc` (`scripts/proof-change.mjs`).

| Criterion | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC6 `#466.84cc08bc` | `captions.test.ts` (5) | (1) the harbour film's open export under the caption look: one cue `harbour.1` with the expected lines and frames 12–98 in its receipt, the same in its .srt (500 to 4,083 ms), at most 2 lines of at most 42 characters, and receipt cues and .srt identical to the plain look's (fails a look whose entrance or plate retimes or rewraps a caption). (2) render.contrast at 2 s PASSes it with nothing raised (fails a caption drawn under 4.5:1). (3) its muted-plate twin fails that judge, naming the caption `harbour` (fails a render.contrast that never reads captions). (4) the intertitle film pointing at its intertitle: open and closed exports byte-identical frame for frame (72 frames), and its receipt and .srt still carry `sleeps.1` at frames 12–34 (fails a caption drawn twice, or dropped from the .srt). (5) the control without `shown_by` differs on exactly frames 12–33 |

## Choices where the issue is open

1. **"Keeps its profile's timing and line limits"** is read on the export's receipt and .srt: exactly the layout rule's
   cue, and exactly the plain look's cues and .srt.
2. **`shown_by`** is written where the design puts it, in the script's captions block, as a text@1 ID, on a script of
   one line whose text equals the intertitle's, so the block's pointer and that line agree under any reading.
3. **"Draws no second copy"** is the open export's frames byte-identical to the closed export's (which draws no caption),
   by receipt hash.
4. **render.contrast** judges at `at_times: ["2s"]`, while `harbour.1` shows and its entrance is long done; it judges the
   caption layer's text against its plate. The harbour film has no text@1 item, so nothing else is judged there.
5. **A caption-only script** (`kind: caption` lines, no recordings) keeps the films free of sound and speech jobs; its
   narrator carries a shareable license so the export may carry it.
6. **The look's `anchor`** is written as [0.5, 1] (bottom centre of the safe area, the layer's default place); the
   film has no shots.

## Criteria out of reach

None: every part is read from the export, its .srt or the verdict. Whether the designed caption looks right (its card,
its unfold) is the issue's taste call (AC9), not this criterion's.

## What the base already does and these tests don't credit

The base lays captions out by the profile, writes the .srt and the receipt's `captions.cues`, and draws the caption layer
over every item (#502); it reads no look `captions` and no `shown_by`, and its render.contrast reads text@1 items only.
So at the base test (1) passes (the look changes nothing yet), test (2) fails (render.contrast is BLOCKED `no_subject`:
it finds no text to judge), test (3) fails (BLOCKED, no failure names the caption), test (4) fails (the caption draws on
frames 12 to 33) and test (5) passes. These tests were not run on the base; the fixtures' exports and verdicts were.

## Scope not under a criterion

The other criteria of #466 are not redrafted here. Captions drawn before the finish (`stage: before_finish`), an anchor
per shot, the film audit on designed captions and closed delivery without a plate are follow-ups.
