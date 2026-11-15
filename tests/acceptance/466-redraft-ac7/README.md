# Acceptance tests for #466, AC7 (blind redraft): quantized time under motion blur, one blur per drawing

A fresh run of the blind acceptance-test job, redrafting one criterion of issue #466 ("Films in time: operator
transitions, boil cycles, tempo motifs, reveal sounds and captions the look designs"):

> AC7 `#466.e1124907`: With the look's quantize at 12 Hz, a 24 fps export, motion blur on at a 180° shutter and a box
> moving at 240 u/s, frames 2m and 2m + 1 are byte-identical and each shows one blur; a planted blur that quantizes
> each sample shows two half-opacity copies on even frames and fails, naming the frame

Written from the issue, the design sections below, the Oracle page and base commit `27a7c0706` ("Merge
remote-tracking branch 'origin/worktree-github-issue-1938-282ccb' into worktree-github-issue-466-dee1e1"), by a job
that never saw an implementation, the first draft (`tests/acceptance/466/`), or any other worktree, branch, PR or stash.
The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- The issue, live (`gh issue view 466 --repo windoliver/deepbuild`), and AC7.
- Its Oracle page, `doneright/oracles/issues/466.md` on branch `doneright` of `DeepBuildAI/deepbuild`: criterion 7 has
  no upstream test ("Quantized time under motion blur, one blur per export frame, are ours"), so nothing is ported.
- `docs/canvas-primitives.md`: Look `look@1` (`time.quantize_hz`); Look `look@1`: samples (a frame is the mean of N
  sub-samples; `vary`); Motion blur ("an exposure window centered on the frame's time after the look's and its
  placements' quantize, with fixed stratified samples of the pure evaluation, averaged in linear light. Each sample
  adds its shutter offset after that quantize and is never quantized again, so every frame of a held drawing shows the
  same blur"; `shutter_angle: deg = 180`, `phase: centred`, `samples: u8 = 8`, `adaptive`); Motion blur: velocity.
- `docs/technical-design.md`: Films and figures on the canvas ("motion blur sampled from the pure evaluation at
  sub-frame times, applied only during declared moves"; Export); Dogfooding.
- At the base: AGENTS.md; `crates/deep-show` (`export.rs`: the call, the png target, the receipt's `frame_hashes` and
  `frame_rate`; `export/guards.rs`: film.blank's flat rule; `main.rs`: the scenario's `planted`);
  `crates/deep-canvas-motion` (`doc.rs`'s `time.quantize_hz`, read only by `deep-motion`); sibling suites
  `tests/acceptance/493`, `501`, `407`, `419`, `464` for conventions only.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/466-redraft-ac7 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/466-redraft-ac7/tsconfig.json   # type-check (exits 0)
```

`cargo` must be on PATH. The file builds `deep-show` once in `beforeAll` (`cargo build --locked --bin deep-show
--no-default-features --features full`, 2 h timeout); every `it` passes `TIMEOUT` (30 min). `scripts/lanes.mjs` needs
`'tests/acceptance/466-redraft-ac7/'` in its `alone` list (the implementer makes that edit). The export draws on this
machine's GPU adapter as #501's does. Node built-ins and vitest only.

## The surface under test

No new binary or call: `deep-show run`, its `deep show`, #501's `export` to a png_seq with its receipt, and the
scenario's `planted` field. **Every name below that the issue or the design doesn't give is this job's choice**; the
implementer builds exactly these, or a dispute goes to a blind redraft.

| Surface | Request fields | Reply fields read | New or existing |
|---|---|---|---|
| scenario | `evidence`, `sessions`, `processes`, `panels`, `docs`, `planted`?, `calls` | `ok`, `replies` | existing |
| `deep show` | `peer`, `doc`, `document` (no `layers`, no item `layer`), `include: ["issues"]` | (none read) | existing |
| `export` | `doc`, `out` (a folder), `frame_rate: [24, 1]`, `video: {codec: "png_seq"}` | `outcome: "exported"`, `receipt.frame_rate`, `receipt.frame_hashes`; the PNG files under `out`, in name order | existing (#501) |
| look@1 `time` | `{quantize_hz: 12, state: {…}}` | — | the design's field |
| look@1 `motion_blur` | `{scope: "declared_moves", shutter_angle: 180, phase: "centred", samples: 8, adaptive: true}` | — | the design's Motion blur fields, on the look *(chosen place, as #419's suite chose)* |
| look@1 `samples` | `{live: 1, export: 1}` | — | the design's field |

### The fixture

`helpers.ts` builds the look and the film; nothing is on disk. The blur look: a look@1 on a drawing basis with flat roles
(white ground, graphite ink `#1b1d22`, mid-grey `muted` `#7c7c7c`) and the three fields above. The film (`blurFilm`):
640 × 360 u at 24 fps, 2 s (48 frames); a `muted` field over the bottom half, ordered first (so no frame is ≥ 98% one
luma, which the export refuses as film.blank); the box, a 12 × 40 u rect@1 in ink at y 60–100, its `at/pos/0` keyed
linearly from 40 u at 0 s to 520 u at 2 s (240 u/s), a declared move. At the base the export is delivered, 48 frames,
and the box draws sharp on row 80, 12 px wide, moving 10 px a frame (checked by running the export on the base).

Numbers: frame k's time after the quantize is ⌊k ÷ 2⌋ ÷ 12 s, the box's left edge 40 + 20 ⌊k ÷ 2⌋ px. A 180° shutter of
a 1/24 s frame is 1/48 s, in which the box travels 5 px, so one blur on row 80 is one run of non-ground pixels 12 + 5 =
17 ± 2 px long, 12 − 5 = 7 ± 2 px of it full ink (coverage ≥ 0.97 in linear light), ≥ 3 partial pixels each side,
centred within 1 px on 40 + 20 ⌊k ÷ 2⌋ + 6. A blur that quantizes each sample again sends the 4 samples before m/12 s
to (m − 1)/12 s and the 4 after to m/12 s: on frame 2m, two sharp copies 20 px apart, each at half coverage.

### Planted programs

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `blur_quantizes_samples` | the scenario's `planted` | AC7 | motion blur whose every sample time (the frame's time plus its shutter offset) is quantized by the look's 12 Hz again before it is evaluated |

The plant goes through the judge the clean export passes (`exportFailures`) and must fail it naming `frame 2:`; the
test also reads its observation, two half-opacity copies 20 ± 1.5 px apart on every even frame from 2 to 46.

## Criteria to tests

The test names start with `AC7 #466.e1124907` (`scripts/proof-change.mjs`).

| Criterion | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| AC7 `#466.e1124907` | `quantized-blur.test.ts` (2) | (1) the export's receipt is [24, 1] with 48 frames; frames 2m and 2m + 1 have one receipt hash and the same decoded pixels for m = 0..23; frames 2 to 47 each show one blur as above. Fails no quantize (the box moves every frame), no blur, a blur about the unquantized time, and the plant. (2) under `blur_quantizes_samples`, even frames 2–46 show two half-opacity copies a step apart, and judge (1) fails naming `frame 2:` |

## Choices where the issue is open

1. **Motion blur lives on the look** as `motion_blur` (the Motion blur section's fields), with one look sub-sample
   (`samples.export: 1`), so a frame's samples are the shutter's alone.
2. **The shutter angle is of the export's frame**, 1/24 s: 180° is 1/48 s and 5 px of travel at 240 u/s.
3. **"Shows one blur"** is read on the box's middle row (y = 80) as the run above, with coverage in linear light against
   the white ground and the ink; "byte-identical" as one receipt hash (BLAKE3 of the raw frame) and equal decoded PNG
   pixels.
4. **Frames 0 and 1** are judged for byte identity only: their exposure reaches before 0 s, where the box holds still,
   so their blur is shorter by design, not by fault.
5. **"Fails, naming the frame"** is the suite's judge failing with a message that starts `frame <k>:`; the test asks
   for `frame 2:`, the first judged even frame.
6. **The planted program's door** is the scenario's `planted` field.

## Criteria out of reach

None: both halves of the criterion are read from the exported frames.

## What the base already does and these tests don't credit

The base exports a film to png_seq with a receipt of frame hashes (#501) and refuses flat runs as film.blank (#157). Its
`deep-show` doesn't read the look's `time.quantize_hz` (only `deep-motion eval` does) and has no 2D motion blur and no
`blur_quantizes_samples`. So at the base test (1) fails (frames 2m and 2m + 1 differ; the box is sharp) and test (2)
fails (the scenario naming the plant is refused). These tests were not run on the base; the fixture's export was.

## Scope not under a criterion

The other criteria of #466 are not redrafted here. Velocity blur, `adaptive`'s 0.5 px skip, `exclude`, `preview_cap` and
a reading hold's unblurred span are follow-ups.
