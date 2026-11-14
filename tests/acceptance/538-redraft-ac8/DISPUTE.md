# Dispute: #538 criterion 8, the first draft's budget fixtures

**What fails.** `tests/acceptance/538/ac8-budgets.test.ts` reads `frames`' `compares` over `heap` (a 1 MiB `i32` array),
`view3d`'s `upload_ms` over `swarm` (100,000 slots fed by `crowd`) and over `field` (a 256 × 256 overlay fed by
`fogger`). Each of those programs writes every element in a loop at every step, and none of their logic items sets
`budget.fuel`, so each runs under the design's default, 1,000,000 fuel a step (Logic `logic@1`: `budget: {fuel: per
step = 1,000,000}`). A loop of 262,144 (or 100,000, or 65,536) stores spends more than that, so the step traps at step
0, the item's arrays never change, and no step has a comparison to report:

```
heap frame 1 compares the arrays of the one step it applies: []: expected +0 to be 1
```

The same program with `budget: {fuel: 10000000}`, the design's ceiling, bakes, and `compares` reports 1,048,576 bytes
a step. The cut-off sits between 16,384 elements (bakes) and 65,536 (traps) at the default fuel.

**How the redraft was made.** One job, given only the issue, the design and a checkout of the base with the first suite
(`53c0e72a3` plus `fdfdeeae2` and the lanes line), never the work, the diff or this dispute, wrote
`ac8-budgets.test.ts` here from criterion 8 alone. It probed its own fixtures against the base, found the first
draft's `heap`, `crowd` and `fogger` trap at the default budget on its own, and brought programs that fit it. Its
README says what it changed.

**What runs.** `scripts/lanes.mjs` times this folder's file and keeps the first draft's file by hand until the owner
swaps them. No test was edited.
