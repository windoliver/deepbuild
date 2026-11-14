# #239 evidence: the spine proved on two fixture films

Both fixture films run the whole spine on the reference Mac (Mac17,10, Apple M5 Max, 64 GiB, on mains power). The
gate found two faults in the spine. Checking the pictures, video and sound afterwards turned up four more gaps. All
six are fixed in this PR, and each code fix starts from a failing test.

Base `53c0e72a3`, rebased onto `e5aa3923a` and then `3b9cf8654`; after the last rebase every file below ran once more, with the results shown. The blind suite is `tests/acceptance/239/`, cherry-picked unchanged as
the branch's first commit.

## The films

| Film | Document | What it holds |
|---|---|---|
| Strokes and paper | `tests/fixtures/films/strokes-and-paper/film.json` | the `notebook_pencil` look (a drawing look, paper ground); five strokes drawn on by a channel on each one's trim end; a title in the look's hand face; five cue and hold markers; a 4 s CC0 chime looping under it |
| Camera and transitions | `tests/fixtures/films/camera-and-transitions/film.json` | the `clean` look; three panels side by side; a push, a pan and a pull, joined by a cross-fade and a wipe; a title; its own chime loop; `reduced_motion: slow`, so under reduced motion its moves keep their paths |

Both are 1280 × 720, 300 frames at 30/1, 48 kHz, a `showpiece`, and name `marks2d`, `motion` and `media` in
`requires.modules`. Each film's look and sound sit in its `assets/` folder, named in the document by SHA-256.

## The blind suite, file by file

Each file was run once on its final code, and again only after code it covers changed.

| File | Final result | History |
|---|---|---|
| `films.test.ts` | 2/2 | |
| `seek-play.test.ts` | 2/2 | failed first on the camera film (fault 1), passed after the fix |
| `exports.test.ts` | 2/2 | passed while the sound was silent too; it reads the AAC track, its sample count and per-frame hashes, not loudness |
| `checks.test.ts` | 8/8 | 5/8 first: the tick twins need a film that lists its modules, and the camera title's hold under reduced motion |
| `budget.test.ts` | the check reads PASS on both films; the test reads INCONCLUSIVE | the check's five runs PASS (GPU p95 0.29 ms of 10, CPU about 0.5 ms of 4), but the one-minute load was 85 to 92 on 18 cores, so the test counts it neither way; after the rebase onto `3b9cf8654` the check read INCONCLUSIVE on this Mac's thermal state (fair), every reading inside its limits (GPU p95 0.39 to 0.57 ms of 10); both over-budget twins FAIL naming the GPU limit each time; an earlier run was BLOCKED (fault 2) |
| `off-reference.test.ts` | 2/2 | |
| `links.test.ts` | 2/2 | live links read Nov 13 |
| `shown.test.ts` | 1/1 | on `TASTE.json`, re-recorded on the final files |

## Faults the gate found

**1. Seek against play never drew a film's shots.** The `determinism` call rastered each side through
`canonical_rgba`, the document camera's view, so on the camera film every time hashed one frame and
`seek-play.test.ts` failed: "the 20 play hashes aren't all one … expected 1 to be greater than 1". Each side now
draws the film's sides through `film_rgba`, as eval's still and the export do (`crates/deep-show/src/time.rs`). No
other suite sends a 2D film with camera shots to `determinism`.

**2. The frame budget read the last pass's end before the GPU wrote it.** On the camera film every run read
BLOCKED: some frames' `scene3d.output` pass ended about 480 µs before it began, its slot still holding the frame
before's value (a probe build printed `ticks [522700422343833, 522700421864500]`). The resolve sat in the frame's
own command buffer, and Metal orders no read of a counter sample against the pass that writes it. It now runs in a
submission of its own once the frame's work has drained. Before: 63 reversed passes in one run. After: none in 15
runs. The live view and the envelope now resolve the same way (`Timer::resolve_after`,
`crates/deep-gpu-layer/src/liveview.rs`; #2413).

## Gaps found by checking the pictures, video and sound

**3. Both recordings were silent.** The fixture chimes were silence: each note's envelope starts at 0 in its 10 ms
attack, under the 1e-4 cut-off that ends a note, so every note stopped at its first sample (decoded peak 0, one PCM
hash for all 300 frames). The spine carried the silence faithfully. The chime now rings, and the loop's last 30 ms
fade to 0 so it wraps without a click. Both recordings measure −30.7 dBFS RMS in every second, peak −19.6 dBFS, and
121 distinct PCM hashes over 300 frames.

**4. A still, an export and seek against play set text in the bundled sans, not the look's font role.**
notebook_pencil maps `body` to its hand face, and the live view sets body text in it, but deep-show's core frame
shaped and built every text with the bundled roles. The session's look tokens now carry each font role a look sets
apart from the bundled one; the shape operator and the marks2d frame set text in it, and a look that names none
keeps its tokens and content keys. `tests/look-type.test.ts` sets one line under notebook_pencil and under clean: on
the base both lay out alike (397.03 px wide each), after the fix the hand face sets it in 280.13 px.

**5. `deep-gpu` had no media module (#2412),** so `frame_budget` refused a film that names `media`. Its shipped set
now includes it, as `deep_show`'s does.

**6. The pan was lopsided.** It started a quarter width short of its panel, showing white beside the card and
cutting the last bar. It now sweeps 192 u, evenly around the panel's middle.

## The paper

notebook_pencil's paper is a flat cream ground in the live view, a still and an export alike. Its `rules`, `margin`,
`spine`, `grid` and pencil line fields have no renderer anywhere, and the design gives them no semantics (#2439).
Paper with tooth or age does draw in the live view, on the GPU only, and stills and exports draw it flat (#2411). A
first version of this README said the live view draws notebook_pencil's rules, margin and tooth; that was wrong.

## Files here

| File | What it is |
|---|---|
| `<film>.receipt.json` | each H.264 + AAC export's receipt, from `node scripts/checkpoint-239-films.mjs` |
| `strokes-and-paper-drawing.png`, `-drawn.png` | frames 69 and 285 decoded from the exported MP4 |
| `camera-and-transitions-shot.png`, `-transition-1.png`, `-transition-2.png` | frames 174, 120 and 225: the pan, the cross-fade and the wipe |
| `<film>.mp4` | each exported MP4, its recording |
| `reports.json` | each check's verdict row on each film beside its planted twin's, and each frame-budget result beside its over-budget twin's, from `node scripts/checkpoint-239-reports.mjs` |

In `reports.json` every check PASSes on both films and FAILs on its twin, naming `seek_differs` at 352,799,999
flicks, `film.hold_short` on the title, `layout.cut` on `layout-twin`, and the GPU limit at 100 ms. Each film's own
frame budget there reads INCONCLUSIVE with every reading inside its limits (GPU p95 0.29 ms of 10) and no invalid
frame: the run's machine conditions were off the reference at that moment.

Both receipts show 300 frames, `nonfinite: []`, nclx 1-1-1 limited range, PSNR-Y 48.4 dB (strokes) and 48.6 dB
(camera) against the 40 dB floor, AAC at 48 kHz, and `av_offset` 0 samples.

## Not run or not judged

- No neighbouring suites and no `node scripts/affected.mjs`: the owner's rule. Existing files run once each because
  this PR changes code they cover: #1899's `invalid-frames.test.ts` (5/5) and #1903's `separate-items.test.ts`.
  `separate-items` passed 2 of 3: its real-GPU leg, five 60 s runs of 4,000 items, passed its 30-minute wall timeout
  at a load near 120. The envelope change adds one queue submission and one wait a frame; I did not re-run that leg
  on the base to rule it out.
- `tests/look-type.test.ts` passes (1/1). Its base failure was shown by running the base binary on the same two
  documents.
- `scripts/lease` ran unleased (no `deep` CLI on PATH in this worktree); every build and test went through
  `scripts/throttle.mjs`.
- The lanes commits need a signed `deep/approved/239-lanes` tag, which can't be made until `.deepbuild/approvers`
  exists on main.
