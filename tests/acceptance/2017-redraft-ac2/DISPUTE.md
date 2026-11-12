# Dispute: the first draft's AC2 test spreads every pixel into `Math.max`

This redraft exists because of this dispute. The first draft is `tests/acceptance/2017/`, commit `108fea237`.

## What fails

`ac2-light-holds.test.ts`, "under a sun 10° up, every pixel of a tile that changes level keeps its lit color within one
code value", collects the green of every pixel of every tile that changes level into `greens`, then computes
`Math.max(...greens) - Math.min(...greens)` (line 64). That spread throws `RangeError: Maximum call stack size
exceeded` once `greens` holds a few hundred thousand values. The fixture's own readings put every tile in view at level 1
as written and level 0 with `lod_px` lowered (its README, Criterion 2: level 1's error 0.39 px, level 2's 1.16 px), so
every one of the frame's 960 × 540 = 518,400 pixels lies on a tile that changes level, on any program that selects as
the criterion asks. The test fails on its own code before its judge runs, never on a picture.

The run, on the work at the time:

```
FAIL  ac2-light-holds.test.ts > AC2 #2017.e778fe83 … > … keeps its lit color within one code value
RangeError: Maximum call stack size exceeded
 ❯ ac2-light-holds.test.ts:64:23
     64|     const span = Math.max(...greens) - Math.min(...greens);
```

The same file's planted test, which never builds that list, passes: `terrain_shades_own_level_normals` fails its judge
on all four tiles, naming each. #154's first draft fell the same way (`tests/acceptance/154-redraft/DISPUTE.md`).

## How the redraft was made

Criterion 2 went to a fresh run of the blind job with the same inputs: the issue, its parent and oracle page, the design
and a base with no implementation (commit `108fea237`, which holds the first draft, so that run read the first draft's
README and its AC2 file, as its own README says). It never saw the work or the diff, and wasn't told of this dispute.
One disclosure: its brief asked, in general terms, that every statistic over the compared pictures run in bounded stack
and memory for any number of pixels, since they can hold hundreds of thousands.

The redraft chose its own fixture (an 8 m ripple 8 cm high, level 3 as written) and judge, through the first draft's
surfaces and plant name. On the work it passes both tests. The first draft's AC2 file is kept by hand in
`scripts/lanes.mjs`; the redraft runs in its place. Whoever settles the dispute swaps them (design: Dogfooding).
