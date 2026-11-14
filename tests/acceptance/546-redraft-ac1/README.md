# Blind redraft of #546's criterion 1, as amended: the data view class

`#546.4f54d30a`, criterion 1 of #546 as the owner amended it:

> The guide's grid search, sized so that done in one step it uses between 1.2 and 3 times the data view class's app
> step ceiling and under its fuel budget of 10,000,000, fails logic.budget in that class, naming the step, the host app
> and the ceiling; the guide's version split across steps finds the same route, cell for cell, with every step under
> the ceiling, passes logic.budget, and seeking into the middle of the search equals playing by full-state hash; and a
> planted logic.budget that compares each step with the fuel budget rather than the ceiling passes the one-step search
> and so fails this criterion

The amendment puts the data view class (`data_view`, 2 ms of frame CPU: canvas primitives, Budget classes) where the
criterion named the figure class (4 ms). Its old tag was `#546.9988cce1`, tested by `tests/acceptance/546/ac01-grid-search.test.ts`.
The tag here is the first 8 hex digits of the SHA-256 of the amended text, trimmed, white space collapsed
(`scripts/proof-change.mjs`).

Written by a job that saw no implementation of #546, no diff, no other branch and no plan. The implementing agent
doesn't edit these files. A dispute goes to another blind redraft (AGENTS.md, Proof; design: Dogfooding).

**What was read:**

- The amended issue body, as handed to this job.
- AGENTS.md.
- `docs/technical-design.md`: The logic module (Sandbox and budgets; Logic bake and checks).
- `docs/canvas-primitives.md`: Budget classes; Logic `logic@1`; Logic: work across steps; Logic: step blocks; Logic:
  sandbox; Check input: logic kinds.
- At `6e17c659` (base `f38d2b39` plus the original blind suite), read only:
  - `crates/deep-logic/src/budget.rs`: the figure class's 4 ms, this host's measured ns per fuel unit, only the first
    step over the ceiling, and `web` read as BLOCKED.
  - `crates/deep-show/src/kinds.rs`: deep_kinds' ops and guide reads.
  - The whole of `tests/acceptance/546/`.

## Run it

```sh
npm ci                          # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH   # rustup's cargo; ../546/helpers.ts also adds it when present
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/546-redraft-ac1 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/546-redraft-ac1/tsconfig.json
```

The file imports `../546/helpers.ts` and `../546/programs.ts` and builds what they build:

- `deep-logic` and `deep-show`: `cargo build --locked --bin deep-logic --bin deep-show`.
- #532's assembler, from a copy outside the checkout.

It runs on this Mac only, with no Docker. Each test passes the 546 suite's `TIMEOUT` (90 minutes).

**`scripts/lanes.mjs` needs `'tests/acceptance/546-redraft-ac1/'` in its `alone` list**, since the file builds cargo
binaries. This README is the instruction; the implementer makes that edit. `BASE-FAILURE.txt` says how it fails at the
base.

## The surface

This file uses exactly the surface in `tests/acceptance/546/README.md`, "The surface under test":

- deep_kinds' `step_ceilings`, read for `data_view`, `app` and the guide's step rate.
- The guide named `logic`, with its `wat grid_search`, `json grid_search`, `wat grid_search_split` and
  `json grid_search_split` blocks.
- The grid asset.
- deep-logic's `bake`, with `seeks` and, for one bake, `checkpoint.every`.
- `budget` (logic.budget), with `fuel_share: 1` and `on: ["app"]`.
- The piece's `class`, here `"data_view"`.
- The ceiling failure `{"rule": "ceiling", "item", "step", "host", "ceiling", …}`.
- `deep-logic --planted budget_holds_steps_to_fuel_budget`, defined in 546's README as a logic.budget that gives no
  `ceiling` and no `frame` failure for a step within `budget.fuel`.

One line of 546's README changes because the amended criterion needs it. 546's README, "The guide's examples", says
`grid_search_split` does "a share each step, every step's fuel at or under the figure class's app step ceiling at its
step rate". This redraft reads that line as follows (verbatim):

> **`grid_search_split`** does a share each step, every step's fuel at or under the **data view** class's app step
> ceiling at its step rate (`step_ceilings[<rate>].data_view.app`), and ends within 600 steps for every grid the tests
> give.

The data view class's ceiling is the smaller one: the same formula and ns per fuel unit, with 2 ms of frame CPU
against 4 ms. So a split search that meets this line meets 546's line too. Nothing else is added.

## What the tests assert

`ac1-data-view-search.test.ts` has 2 tests. Every piece is `class: "data_view"`, and every grid is the 546 suite's
seeded grid.

**Setup.**

- c is deep_kinds' `step_ceilings` for `data_view` and `app`, at the one-step search's `step_rate` (60 when absent).
- The window is over 1.2c and under both 3c and 10,000,000. When it is empty, the test fails and names it.
- The grid is sized by a bracketed search on its side, from 8 to 1,024, with up to 32 one-step bakes. Each guess
  scales the side by √(target ÷ fuel), where the target is the window's geometric mean. A guess outside the bracket
  bisects it instead. Sizing stops at the first grid whose step 0 lands in the window.

**Test 1, the criterion.**

- The one-step search, 1 step:
  - It doesn't trap, and its step 0 fuel is in the window.
  - It has ended at step 0 with a shortest route, checked by the test's own breadth-first search.
  - logic.budget on [app] reads FAIL, with exactly one `ceiling` failure: item `search`, step 0, host app, ceiling c.
    Other rules may also fail; the step is likely past the class's 2 ms frame too.
- The split search on the same grid, 600 steps:
  - It doesn't trap, and every step's fuel is at or under c.
  - It ends at a step d > 0, with the one-step route cell for cell.
  - logic.budget on [app] reads PASS with no failure.
- The seek. The split search is baked with a checkpoint every E = ⌊d/2⌋ + 1 steps:
  - The checkpoint at E holds the search pending: `done` is 0 after step E − 1.
  - The checkpoint at 2E holds it ended: `done` is 1 after step 2E − 1.
  - A seek to E restores the checkpoint at E and plays to 2E.
  - Its full-state hash at 2E is playing's checkpoint hash there, and its step hashes for E to 2E − 1 are playing's.

**Test 2, the twin.** `budget_holds_steps_to_fuel_budget` runs logic.budget on the same one-step piece. It must read
PASS, and test 1's judgement of that reply must fail with failures naming `step 0` and `host app`.

Wrong programs these tests fail on:

- A ceiling taken from the fuel budget, from another class (such as figure's 4 ms) or from another host.
- A ceiling failure naming another step, host or ceiling.
- A split search that finds another route, or passes the ceiling in some step.
- Progress kept outside what a checkpoint restores.
- A logic.budget that holds steps to `budget.fuel` alone.

## Readings where the criterion leaves a choice

- **The rate.** The criterion names none. The ceiling is the one at the guide's search's own `step_rate`. The split
  search's steps are checked against that same c ("the ceiling"). logic.budget's PASS also holds the split search to
  the ceiling at its own rate. The test doesn't require the two examples to share a rate, since 30 and 60 Hz share one
  ceiling and any faster rate has a smaller one.
- **"Between 1.2 and 3 times … and under 10,000,000".** Strictly: over 1.2c, and under both 3c and 10,000,000. The
  window exists only while c < 8,333,334. At 60 Hz the data view class's app ceiling is ⌊1,500,000 ÷ ns per fuel⌋, so
  the window needs the logic module's app ns per fuel unit (`about.ns_per_fuel.app`) over 0.18. The test doesn't adapt:
  an empty window fails, naming c.
- **"Fails logic.budget in that class".** The piece's `class` is `data_view`, `on` is [app], and the bake is 1 step.
  There is exactly one `ceiling` failure, naming the item, step 0, host app and c.
- **"Every step under the ceiling".** Every baked step's fuel is at or under c, since logic.budget fails only a step
  over it.
- **"Passes logic.budget".** PASS with no failure, on [app], in the data view class, with `fuel_share: 1` (as in the 546
  suite, setting the share rule aside).
- **"Seeking into the middle of the search equals playing by full-state hash".** #532's bake seeks. The seek restores a
  checkpoint taken while the search is pending, plays on through the first checkpoint after it ends, and equals
  playing by that checkpoint's full-state hash and by every step hash on the way.
- **"Passes … and so fails this criterion".** The twin reads PASS, and this criterion's judgement of its reply fails.

## Where this differs from 546's test of the old criterion

- The class is `data_view`, so c is the data view ceiling.
- Grid sizing is a bracketed search of up to 32 bakes, not 12 scaled guesses. A narrow window, as when 3c passes
  10,000,000, still finds a grid when one exists.
- The two searches aren't required to step at one rate (see Readings).
