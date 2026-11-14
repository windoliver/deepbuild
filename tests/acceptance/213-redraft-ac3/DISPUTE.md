# Dispute: #213 criterion 3, the first draft's records after a trap

This redraft exists because of this dispute. The first draft is `tests/acceptance/213/ac3-trap-fuel.test.ts`, from the
blind suite's commit `cecc9d821` (written blind on base `fe5a88f17`).

**What fails.** The first draft's flood test runs `deep-show run`'s `logic` call for 30 steps over an item that writes
257 requests at step 20, and requires a record for every step 0 to 29 (`showSteps(ran, 30)`), the arrays from step 20 on
holding step 19's. Since the suite was written, main merged #548, whose README defines the same call for every item
(tests/acceptance/548/README.md: "`logic`'s `track` and `trap`"): "When an item traps, the replay stops there: `steps`
holds the records of steps 0 through the trap's step and none after", and its ac4 test holds the call to it ("the
replay runs steps 0 to 412 and none after"). On the merged head the call stops at step 20 as #548 requires, so the
first draft reads 21 records where it wants 30:

```
the flood: steps 0 … 29: expected [ 0, 1, …, 20 ] to deeply equal [ 0, 1, …, 29 ]
```

Both can't hold for one call over one trapping item; #548's is on main. The trap itself (`{step: 20, kind: services,
service: physics.cast@1, count: 257}`), step 20's arrays holding step 19's, and the meter's fuel test pass.

**How the redraft was made.** One job, given only the issue, the design and a checkout of main (`658b44f04`) with the
first suite (`8dc27cc15`), never the work, the diff or this dispute, wrote this folder from criterion 3 alone. It reads the bake through deep_query's logic read (#548), which gives each asked step's arrays and the trap, so it
sees the arrays after the trap without the replay.

**What runs.** `scripts/lanes.mjs` runs this folder alone and keeps the first draft's file by hand until the owner swaps
them. No test was edited.

## Your call, once

- **Keep #548's rule** (recommended): the logic replay stops at a trap; this redraft stands and the first draft's file
  runs by hand.
- **Step on past a trap**: the first draft stands, and #548's ac4 test and README change instead.
