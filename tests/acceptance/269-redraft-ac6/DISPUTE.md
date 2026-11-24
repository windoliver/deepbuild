# Dispute: #269 criterion 6, the first draft's budget fixture

**What fails.** `tests/acceptance/269/ac6-budgets.test.ts` plays the budget's fixture (`fixtures.ts` `warDoc`, a 256 ×
256 grid image fed by `programs.ts` `warProgram`) through `deep-gpu run`'s `film2d` and holds that every frame from 1
uploads rows of the grid. The `war` program writes all 65,536 cells in a loop at every step, and its logic item sets no
`budget.fuel`, so it runs under the design's default, 1,000,000 fuel a step (Logic `logic@1`: `budget: {fuel: per step =
1,000,000}`). The loop spends about 2,293,766, so the step traps at step 0, the array never changes, and no frame has a
row to upload:

```
frame 1: war_map uploads no row, though its step changed 2% of the grid
…
frame 59: war_map uploads no row, though its step changed 2% of the grid
```

The same film with `budget: {fuel: 10000000}`, the design's ceiling, uploads all 256 rows on every frame (each step
changes 1,310 or 1,311 cells over every row), and `draw_ms.war_map` reads about 0.1 ms on the debug build. At the base,
`deep_show` refuses the first draft's film with `logic.trap` at `war`.

**How the redraft was made.** One job, given only the issue, the design and a checkout of the base with the first suite
(`d84d541e9` plus `136acd22f`), never the work, the diff or this dispute, wrote `ac6-budgets.test.ts` here from criterion
6 alone. It probed its own fixture against the base, found the first draft's `war` traps at the default budget on its
own, and brought a program that moves exactly 1,311 cells a step over all 256 rows for 34,103 fuel. Its README says
what it changed.

**What runs.** `scripts/lanes-lists.mjs` times this folder's file and keeps the first draft's file by hand until the owner
swaps them; `benchmarks/budgets.json`'s `canvas-grid-image` task runs this file. No test was edited.
