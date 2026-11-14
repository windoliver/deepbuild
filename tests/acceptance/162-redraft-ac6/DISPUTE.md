# Dispute: the first draft's AC6 twist leaves its outline unchanged at every angle

This redraft exists because of this dispute. The first draft is `tests/acceptance/162/`, commit `e007b0be8`.

## What fails

`repeater.test.ts`, "the tiles export as four groups 30 u apart at opacities 100, 100, 100 and 50; the knot's path is
keyed at every export frame from 12 to 36", keys a twist's `angle` from 0 to 90° about (160, 130) on a closed outline
from (40, 100) to (280, 160), and expects the written path to change at every export frame from 13 to 36. The twist
#160 built (`crates/deep-canvas-marks/src/pathops.rs`, `twist`) turns each point by `angle × (1 − d ÷ reach)`, where `d`
is the point's distance from the centre and `reach` the largest such distance. All four corners of that outline lie
`reach` from (160, 130), so each turns by 0 at every angle: the twist's output is the outline itself throughout, the
document's own frames draw it unmoved, and the export writes it unkeyed, as "keyed at each export frame where it
changes" asks of a path that never changes. The test fails on its fixture, never on what the export writes:

```
FAIL  repeater.test.ts > AC6 #162.bc95e877 … > … the knot's path is keyed at every export frame from 12 to 36
AssertionError: the twisted path is keyed: {"a":0,"k":{"c":true,"v":[[40,100],[280,100],[280,160],[40,160]],
"i":[[0,0],[0,0],[0,0],[0,0]],"o":[[0,0],[0,0],[0,0],[0,0]]}}: expected false to be true
```

The repeater half of the same test (four groups 30 u apart, opacities 100, 100, 100 and 50) is held by the redraft too.

## The redraft

A fresh run of the blind job, with the issue, the design, the oracle map and base `53c0e72a3` and this criterion only,
never the work, the diff or this dispute, wrote `repeater-twist.test.ts` (commit `d2bf56706`). Its twist turns a plate
about a corner while the plate's width is keyed, so its output path changes at every export frame from 13 to 36, which
the test checks of its own fixture before it exports. The first draft's file is kept as written and run by hand only
(`scripts/lanes.mjs`); the redraft runs in its place.
