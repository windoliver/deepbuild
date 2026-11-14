# Dispute: the first draft's Oracle lane takes the upstream answer where the design gives another

This redraft exists because of this dispute. The first draft is `tests/acceptance/539-oracle/`, commit `c8e33f1a6`.

## What fails

`focus-group.test.ts`, "the grid with a cell in the centre that can't take focus: each arrow skips it", ports the pinned
upstream case on a 3 × 3 grid whose centre (1, 1) can't take focus. Its Right and Left cases pass. Its Down and Up cases
expect the focus to jump the centre within its column: Down from (1, 0) to (1, 2), and Up from (1, 2) to (1, 0).

The design's rule for grids (canvas primitives: Control: picks on rows and grid focus) gives another answer: "Up and
Down to the nearest row that way holding a drawn cell, at the drawn cell whose center's x is nearest the focused one's,
ties to the smaller cx". Row 1 holds the drawn cells (0, 1) and (2, 1), both 16 u from x of (1, 0), so Down from (1, 0)
lands on (0, 1), the smaller cx, and Up from (1, 2) lands on (0, 1) too. The same rule decides the main suite's hex tie
(`tests/acceptance/539/ac5-grid-focus.test.ts`: Up from (1, 1) to (1, 0)), which passes.

The run, on the work at the time:

```
FAIL  focus-group.test.ts > AC5 #539.ece9dcef … > the grid with a cell in the centre that can't take focus: each arrow skips it
AssertionError: the grid with a hole:
  the grid with a non-focusable centre: Down from r1c2 skips r2c2 to r3c2: after Tab, ArrowDown the focus is ["strip#1,0","strip#0,1"], not ["strip#1,0","strip#1,2"]
  the grid with a non-focusable centre: Up from r3c2 skips r2c2 to r1c2: after Tab, ArrowUp the focus is ["strip#1,2","strip#0,1"], not ["strip#1,2","strip#1,0"]
```

The first draft's other three tests (one Tab stop, the simple grid, Home and End) pass on the work.

## How the redraft was made

Criterion 5's Oracle lane went to a fresh run of the blind job with the same inputs: the issue, its parent and oracle
page, the design and a base with no implementation (commit `c8e33f1a6`, which holds the main suite; the job was told not
to read the first draft's lane, and its README says it didn't). It never saw the work or the diff, and wasn't told of
this dispute. One disclosure: its brief said, in general terms, that where an upstream check and the design disagree it
should decide from the issue and the design what the lane can honestly port, and say which cases it ports and why.

The redraft ports 18 upstream cases and a planted run, and leaves out the two Down and Up cases past the dead centre,
because the design's rule gives (0, 1) where upstream expects (1, 2) and (1, 0) (its README: Left out). On the work it
passes all 19 tests.

## What is decided, and what is yours

The first draft's lane is kept by hand in `scripts/lanes.mjs`; the redraft runs in its place. This is the one dispute
that comes to you (design: Dogfooding): keep the design's rule, as the work and the redraft do, or change the design so
Up and Down skip a cell that can't take focus within its column, as upstream does; then the first draft's lane runs
again and the work changes to pass it.
