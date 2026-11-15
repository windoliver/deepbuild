# Dispute: the first oracle draft's tick at every whole number (criterion 1's oracle lane)

This redraft exists because of this dispute. The first draft is `tests/acceptance/226-oracle/`, from the blind suite's
commit `d79af0395`.

## The first draft needs a tick at y = 3

The first draft's linear test measures each point against "the tick at that coordinate" on each axis, and picks its
coordinates "on a tick", reading the ticks as "every whole number on [−4, 4]". The design gives the 3D axes `axis@1`'s
rule ("Ticks come from `axis@1`'s rule, on 1, 2 and 5 × 10^k"), and criterion 6 holds the 3D axes' ticks equal to a 2D
`axis@1`'s on the same scale. `axis@1` aims at about five ticks across a domain (`crates/deep-canvas-marks/src/data.rs`,
`linear_step`), so [−4, 4] ticks at −4, −2, 0, 2 and 4. The criterion's point (2, 3, 1) has y = 3, which no y tick holds,
so the first draft fails at "linear axes: the y axis has a tick at 3" before it measures any position. Its log twin
passes. The main suite's criterion 1 test, which reads the point's world position, passes on the same work.

## The redraft

The criterion went to a fresh run of the blind job with the same inputs (the issue, its oracle page, the design and base
`9b77cd2cd`). It never saw the work, the diff or this dispute (design: Dogfooding). It reads each point's world position
from `geometry`, so it doesn't depend on how many ticks the rule picks, and it passes on the work: both tests, the
linear points and the log twin's offsets of 2 m a decade.

## Your call, once

- **Keep `axis@1`'s rule** (recommended): the redraft stands; the first draft stays in the tree and runs by hand
  (`byHand` in `scripts/lanes.mjs`).
- **Ticks at every whole number on [−4, 4]**: the first draft stands, and `axis@1`'s density changes for every 2D axis
  too, since criterion 6 holds the two equal.
