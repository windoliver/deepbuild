# #239 evidence: the spine proved on two fixture films

Both fixture films run the whole spine on the reference Mac (Mac17,10, Apple M5 Max, 64 GiB, on mains power). The
gate found two faults in it, each fixed test-first: seek against play never drew a film's shots, and the frame
budget read the last pass's end timestamp before the GPU wrote it.

Base `53c0e72a3`. The blind suite is `tests/acceptance/239/`, cherry-picked unchanged as the branch's first commit.

## The films

| Film | Document | What it holds |
|---|---|---|
| Strokes and paper | `tests/fixtures/films/strokes-and-paper/film.json` | the `notebook_pencil` look (a drawing look, paper ground); five strokes drawn on by a channel on each one's trim end; a title; five cue and hold markers; a 4 s CC0 chime looping under it |
| Camera and transitions | `tests/fixtures/films/camera-and-transitions/film.json` | the `clean` look; three panels side by side; a push, a pan and a pull, joined by a cross-fade and a wipe; a title; its own chime loop; `reduced_motion: slow`, so under reduced motion its moves keep their paths |

Both are 1280 × 720, 300 frames at 30/1, 48 kHz, a `showpiece`, and name `marks2d` and `motion` in
`requires.modules`. Each film's look and sound sit in its `assets/` folder, named in the document by SHA-256.

## The blind suite, file by file

Each file ran once on its final code; a file ran again only after the code it covers changed.

| File | Result | Notes |
|---|---|---|
| `films.test.ts` | 2/2 | |
| `seek-play.test.ts` | 2/2 | failed first on the camera film (below), passed after the fix |
| `exports.test.ts` | 2/2 | 289 s |
| `checks.test.ts` | 8/8 | 5/8 first: the tick twins need a film that lists its modules, and the camera film's title held 1.933 s of 2.833 s under reduced motion; both are film changes, below |
| `budget.test.ts` | 4/4 | INCONCLUSIVE first (thermal state fair, load near 150 on 18 cores), then BLOCKED on reversed timestamps, then 4/4 after the meter fix (below) |
| `off-reference.test.ts` | 2/2 | this Mac is a reference Mac, so its own leg reads the stub fingerprints; the real-run leg ran when its thermal state was fair and read INCONCLUSIVE |
| `links.test.ts` | 2/2 | live links read Nov 13 |
| `shown.test.ts` | 1/1 | on `TASTE.json` |

## Fault 1: seek against play never drew a film's shots

The `determinism` call rastered each side through `canonical_rgba`, the document camera's view. On the camera and
transitions film every time hashed one frame, the first panel, and `seek-play.test.ts` failed:

```
AssertionError: the camera and transitions film: the 20 play hashes aren't all one, so the film moves and the hash sees it: expected 1 to be greater than 1
```

Each side now draws the film's sides at its last time through `film_rgba`, as eval's still and the export do
(`crates/deep-show/src/time.rs`). No other suite sends a 2D film with camera shots to `determinism`, so the change
reaches none of their documents.

## Fault 2: the frame budget read the output pass's end before the GPU wrote it

On the camera film, `frame_budget` read BLOCKED: in all five runs some frames' `scene3d.output` pass ended about
480 µs before it began. A probe build (not committed) printed the ticks:

```
frame 127 pass 1 scene3d.output ticks [522700422343833, 522700421864500]
  scene3d.geometry [522700422337041, 522700422369333]
```

The end slot held the frame before's value. The resolve was encoded in the frame's own command buffer, and Metal
orders no read of a counter sample against the pass that writes it. It now runs in a submission of its own once
the frame's work has drained (`crates/deep-gpu-layer/src/budget.rs`). Before: 63 reversed passes in one run, and
BLOCKED in every run of the camera film. After: none in 15 runs, and both films pass. #1899's `invalid-frames.test.ts`
passes on the change (5/5).

## Film changes the checks asked for

- `requires.modules` names `marks2d` and `motion`, so the determinism twin's `test.tick@1` joins a declared list.
  The films don't name `media`: `deep-gpu`, which times them, has no media module and refuses a document that names
  it, and a strip is no item kind.
- The camera film's `transport.reduced_motion: slow`. Under the default, a move cuts to its final framing at its
  midpoint, which broke the title's hold at 1.933 s.

## Files here

| File | What it is |
|---|---|
| `<film>.receipt.json` | each H.264 + AAC export's receipt, from `node scripts/checkpoint-239-films.mjs` |
| `strokes-and-paper-drawing.png`, `-drawn.png` | frames 69 and 285 decoded from the exported MP4 |
| `camera-and-transitions-shot.png`, `-transition-1.png`, `-transition-2.png` | frames 174, 120 and 225: the pan, the cross-fade and the wipe |
| `<film>.mp4` | each exported MP4, its recording |
| `reports.json` | each check's verdict row on each film beside its planted twin's, and each frame-budget result beside its over-budget twin's, from `node scripts/checkpoint-239-reports.mjs` |

In `reports.json` every check PASSes on both films and FAILs on its twin, naming `seek_differs` at 352,799,999
flicks, `film.hold_short` on the title, `layout.cut` on `layout-twin`, and the GPU limit at 100 ms. The camera
film's own frame budget there reads INCONCLUSIVE on both limits, with every reading inside them (GPU p95 0.29 ms of
10, CPU 0.09 to 0.15 ms of 4) and no invalid frame. So the check judged this Mac's conditions off the reference at
that moment; its reply names no reason. `budget.test.ts` read PASS on the same code minutes before.

Both receipts show 300 frames, `nonfinite: []`, nclx 1-1-1 limited range within 1.13 code values, PSNR-Y 47.8 dB
(strokes) and 48.7 dB (camera) against the 40 dB floor, AAC at 48 kHz, and `av_offset` 0 samples.

## Not run or not shown

- No neighbouring suites and no `node scripts/affected.mjs`: the owner's rule. The only existing file run is
  #1899's `invalid-frames.test.ts`, the one that drives `measure`'s readings.
- `scripts/lease` ran unleased: no `deep` CLI on PATH in this worktree. Every build and test still went through
  `scripts/throttle.mjs`.
- The paper draws as the look's flat cream ground in an export. Its rules, margin and tooth draw only in the live
  GPU view. A follow-up, filed with the PR, as are two more the gate turned up: `frame_budget` refuses a film that
  names `media`, and the live view's and the envelope's pass timers (`live.rs`, `envelope.rs`) still resolve
  inside the frame's encoder.
- Seen, not judged: `notebook_pencil` maps the role `body` to `hand`, yet the title with `font: body` is set in
  Inter.
- The lanes commit needs a signed `deep/approved/239-lanes` tag, which can't be made until `.deepbuild/approvers`
  exists on main.
