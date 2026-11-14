# #466: three first-draft files disputed, and their blind redraft

The first draft of this suite (`test(#466): blind acceptance suite`) holds three files that can't pass on any program,
because their fixtures trip rules the base already enforces. Under Dogfooding, each went to a fresh run of the same job
with the same inputs and the criterion: never the work, the diff or this dispute. The redraft's tests pass on the
work, so under the design the dispute comes to you once, with both drafts and the failing output. Nothing in either
draft was edited.

| Criterion | First draft (disputed) | Blind redraft | Why the first draft can't pass |
|---|---|---|---|
| AC3 `#466.4f5a25b8` | `466/ac3-boil.test.ts` (4 tests) | `466-redraft-ac3/boil.test.ts` (3 tests, pass) | The zigzag `line` has order `c1` and the frame-filling `back` rect has order `cback`. Items draw in order-key order, so `back` covers the line and every frame is plain white: no boil can show, and the flicker plant has nothing to differ on. |
| AC6 `#466.84cc08bc` | `466/ac6-captions.test.ts` (6 tests) | `466-redraft-ac6/captions.test.ts` (5 tests, pass) | Every export is refused by the base's `film.blank` guard: all 192 frames are flat white. The intertitle orders under `back` and sits at opacity 0 until 4 s, so only captions show. The clean contrast test judges at t = 0, the check's default time, where the intertitle draws nothing and reads 1:1. |
| AC7 `#466.e1124907` | `466/ac7-blur.test.ts` (2 tests) | `466-redraft-ac7/quantized-blur.test.ts` (2 tests, pass) | The export is refused by `film.blank`: a 12 × 40 box on a 320 × 180 white frame leaves 99.2% of each frame one luma, over the guard's 98%. |

## The failing output on the work

```
ac7-blur.test.ts: the blur film's export is exported: {"outcome":"failed","code":"export.frames","issues":[{"check":"film.blank","code":"film.blank","severity":"error","kind":"flat","first":0,"last":23,...,"what":"frames 0 to 23 (1.000 s) are flat: one luma window from 253 holds 98% of their pixels; declare the span an exception if it is meant"}]}

ac3-boil.test.ts: the boil's cycle: frames 0 to 14, one period of 0.25 s, hold 1 drawings, not 3
  (every eval snapshot's pixels sum to 320 × 180 × 4 × 255: the frame is plain white)
ac3-boil.test.ts (planted boil_seed_follows_playback): the planted program passes the check it must fail

ac6-captions.test.ts: the designed film's export is exported: {"outcome":"failed","code":"export.frames","issues":[{"check":"film.blank","code":"film.blank","severity":"error","kind":"flat","first":0,"last":191,...}]}
ac6-captions.test.ts (render.contrast): render.contrast on the designed caption film is FAIL, not PASS: [{"code":"loop.contrast","ids":["card"],"actual":{"t":0,"ratio":1,"ground":1,"min":4.5},...}]
```

On the work, the first draft's other six files pass: 14 of 14 tests in `ac1`, `ac2`, `ac4`, `ac5` and `ac8`. The
redraft's three folders pass 10 of 10. The one test in `ac6-captions.test.ts` that passes on the work is
`caption_plate_in_text_role`.

## What the redraft was told

The redraft's brief named the same inputs (the issue, the design sections, the oracle page, base `27a7c0706`, sibling
suites for conventions), and three facts about the base that any blind draft must respect:

- the export's `film.blank` guard;
- items draw in `order`-key order;
- render.contrast reads every text at the times it judges.

It never saw the work, the diff or this dispute.

## The ruling

Asked of the owner, once: swap the first-draft files above for the redraft's folders. Until then the first-draft
files stay as written and fail.
