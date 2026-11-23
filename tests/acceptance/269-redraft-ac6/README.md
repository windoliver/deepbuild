# Blind redraft of #269 AC6: the grid image's budget

This folder is a blind redraft of #269's sixth criterion, AC6 `#269.6ad7e180` (docs/technical-design.md: Dogfooding: "A
disputed test goes to a fresh run of that job, with the same inputs and the criterion, never the work, the diff or the
dispute"):

> Budgets, on the reference Mac in the local preflight, compared with the merge base: a 256 × 256 grid that changes 2%
> of its cells a step, drawn `smooth` at 512 × 512 px, stays within the data view class's 2 ms of frame GPU, with its
> draw time recorded as a reading

It was written from the issue (`gh issue view 269`), the design and the checkout at `136acd22f` (origin/main `d84d541e9`
plus the first suite `tests/acceptance/269/`), before any implementation, and without reading any other commit, branch,
pull request, worktree, stash or checkout naming #269 or `grid_image`. No dispute was given to it. It stands beside
`tests/acceptance/269/ac6-budgets.test.ts` and changes nothing there; which draft stands is the Dogfooding rule's call,
not this folder's. The implementing agent doesn't edit it (AGENTS.md, Proof).

## What was read

- Issue #269 (Scope, the seven criteria, Proof, Oracle line; no comments).
- `docs/technical-design.md`: Cut, or deferred; Budgets by class; Sandbox and budgets ("a trap freezes only that item,
  whose arrays keep their last values"); Dogfooding.
- `docs/canvas-primitives.md`: the sections the issue links (Mark set: logic columns, Cell grid `cells@1`: logic grid,
  Draw path: GPUI or the GPU layer); the budget class table (data view: 2 ms of frame GPU, 2 ms of frame CPU); Frame
  budget (five runs after warm-up, each run's p95 against the class); Logic `logic@1` (`budget: {fuel: per step =
  1,000,000, memory: MiB = 4, stack: KiB = 64}`; `init` and `step(k)`; a trap leaves the item's arrays as the last step
  left them); Logic: work across steps (the step ceiling); Logic: sandbox (fuel: each block charges its instruction
  count).
- In the checkout, for surfaces and conventions: the first suite's `README.md`, `helpers.ts`, `fixtures.ts`,
  `programs.ts`, `judges.ts`, `ac6-budgets.test.ts`, `ac3-rows-seek.test.ts` and `BASE-FAILURE.txt`; `../538/helpers.ts`
  and `../538/programs.ts`; `../537/helpers.ts` (`putAsset`); `../1634/helpers.ts` (`lane`, `judgeLimit`,
  `timingProblem`, `timedFiles`); `../265/ac6-budgets.test.ts` and `../538-redraft-ac8/` (a budget test and a budget
  redraft); `scripts/benchmark.mjs` (`judgeLimit`, `validateBudgets`), `scripts/lanes.mjs` and `scripts/lanes-lists.mjs`
  (`alone`, `timed`, `byHand`, `LANE_FILE`), `scripts/budget-window.mjs` (`criterionId`), `benchmarks/budgets.json`,
  `benchmarks/canvas-world.mjs`; `crates/deep-logic/src/piece.rs` (`FUEL`: 1,000,000 by default, 10,000,000 at most),
  `budget.rs`, `bake.rs` and `world/world_impl.rs` (a trap marks the item failed and its arrays stay); `crates/deep-show`
  (`main.rs`'s `eval` and `deep_query` calls, `query.rs`'s and `logic.rs`'s logic read: each asked step's arrays and fuel,
  and the item's trap); `crates/deep-play/src/read.rs` (`eval`'s `arrays` reads only one-element logic arrays);
  `crates/deep-gpu-layer/src/film.rs` (`film2d`: `gpu_ms`, `from`, `hash`).

Every expected value comes from the issue, the design and this folder's program; code was read to learn surfaces and the
logic item's budget.

## Run it

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  npx vitest run tests/acceptance/269-redraft-ac6/ac6-budgets.test.ts --testTimeout=600000 --hookTimeout=600000
npx tsc --noEmit -p tests/acceptance/269-redraft-ac6
```

`../538/helpers.ts` builds what the file drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, and copies it to a
temporary folder: `cargo build --locked --bin deep-gpu`, and on a reference Mac at rest only `cargo build --locked
--release --bin deep-gpu`; it assembles the program with #544's assembler (`tests/acceptance/544/wat`, read only) into
`target/acceptance-538-wat/`. The only processes started are cargo, the assembler, `deep-gpu run`, `git` (the merge base
and its `benchmarks/budgets.json`, read only) and node (scripts/benchmark.mjs and scripts/lanes.mjs, through #1634's
helpers, with `fingerprint`'s `sysctl`, `pmset` and `sw_vers` reads), each waited for, none stopped by name or port.
Folders are temporary and deleted. Node built-ins and vitest only.

Gates, none a pass: off macOS, or where `film2d` answers `no_device` or `unsupported_platform`, the record (part 1) is
judged and then the test fails `INCONCLUSIVE:` (the grid is drawn on the Metal device); off a reference Mac at rest (Low Power Mode on, thermal state not nominal, or the load above the
cores, as the lane's `judgeLimit` reads them) the timings are not taken and the test fails `INCONCLUSIVE:` with the
lane's reason, after everything that answers on any Mac has passed; five runs that neither all pass nor all fail by the
margin are `INCONCLUSIVE:`.

**The lanes lines.** The implementer adds these to `scripts/lanes-lists.mjs` (this README is the instruction; a folder
named `269-redraft-ac6` can't hold a `lane.json`, whose pattern takes digits only):

```js
// #269's blind redraft of AC6 builds deep-gpu (for release where it times) and draws on the Metal GPU; it judges the
// grid image's frame GPU on the reference Mac.
alone.push('tests/acceptance/269-redraft-ac6/');
timed.push('tests/acceptance/269-redraft-ac6/ac6-budgets.test.ts');
```

and `'tests/acceptance/269-redraft-ac6/'` to the `timing` list of `aloneReasons` in `scripts/lanes.mjs` (its one test
file is timed, so its reason is `timing`, as `538-redraft-ac8/`'s is). If the owner rules that this draft runs in the
first draft's place, `byHand.push('tests/acceptance/269/ac6-budgets.test.ts')` keeps the first by hand, as #538's line
does.

**The budget's task.** "Compared with the merge base" is the perf lane's and the budget window's: they run a
`benchmarks/budgets.json` task and compare it with the merge base at the task's margin. The implementer adds a task
whose `criteria` hold `#269.6ad7e180` and whose `command` the lane runs, valid by `validateBudgets` against the merge
base's file. As #265's does, it can run this file through `benchmarks/canvas-world.mjs` (this file added to that
script's `TESTS` with `#269.6ad7e180`), for example:

```json
{"id": "canvas-grid-image", "command": ["node", "benchmarks/canvas-world.mjs", "tests/acceptance/269-redraft-ac6/ac6-budgets.test.ts"],
 "margin": 0.5, "limits": {}, "targets": {"frame_gpu_p95_ms": 2}, "initialReason": "<why, naming #269>",
 "criteria": ["#269.6ad7e180"]}
```

The test asks only for a task naming the criterion with a command, valid against the merge base; the first suite's
README gives the same task with its own file in the command.

## What the test does

One test, `AC6 #269.6ad7e180 …`, in three parts. Parts 1 and 2 gather what is missing or wrong into one list, asserted
before any timing, so one run names all of it.

1. **The record, compared with the merge base.** `benchmarks/budgets.json` holds a task whose `criteria` name
   `#269.6ad7e180`, with a command; the lane's `validateBudgets` accepts the file against `git merge-base HEAD
   origin/main`'s; and `scripts/lanes.mjs`'s `timed` holds this file.
2. **The grid draws, changing 2% of its cells a step, on the debug build** (on macOS). `deep-gpu run`'s `film2d` of the
   first suite's budget fixture holding this folder's program, 120 frames at 60 fps from frame 0, with `counts`,
   `timings` and `hash`. Every frame answers `gpu_ms` and `draw_ms.war_map`, each a time above 0; every frame n from 1
   has `row_uploads.war_map` equal to the rows holding the 1,311 cells step n changed (`programs.ts` `rowsMovedAt`: all
   256 rows at every step), and a `pixel_hash` other than frame n − 1's.
3. **The timings, judged only where the lane can.** `timingProblem()` (the lane's `judgeLimit` on five zero readings)
   first: anything but PASS fails `INCONCLUSIVE:` before anything is timed. Then a release build, one warm-up run and five,
   each a fresh process playing the same 120 frames with `timings` only (nothing hashed or counted). Each run's reading is
   the p95 of `gpu_ms` over frames 10 to 119, every one of them answering `gpu_ms` and `draw_ms.war_map` above 0; the five
   are judged against 2 ms by `judgeLimit` with each run's load at its start and end. A FAIL fails the test; anything but
   PASS leaves it `INCONCLUSIVE:`; PASS passes. Each run's median `draw_ms.war_map` over the same frames is printed as the
   reading, and never judged.

## The fixture and the program

The fixture is the first suite's, unchanged (`../269/fixtures.ts` `warDoc` in `sessionForm`): the logic item `war`
(`writes: {ground: {type: "i32", count: 65536}}`, 60 steps a second, no `budget` written, so the defaults hold), a
backdrop in the `ground` role, and `war_map`, a `grid_image@1` of `war.ground`, `size: [256, 256]`, `cell: [2, 2]`,
`roles: ["term_red", "term_green", "term_blue", "none"]`, `sample: "smooth"`, `edge: 1`, at (0, 0), 512 × 512 px; a 4 s
film at 60 fps.

The program is this folder's (`programs.ts`, `skirmish`), in the first suite's layout (`memory` with its maximum equal to
its minimum, 5 pages; `reads_at` 0, `writes_at` 4096; no imports), assembled by #544's assembler:

| | `war.ground` |
|---|---|
| `init` | blocks of 16 × 16 cells, ((x ÷ 16) + (y ÷ 16)) mod 4: the three teams and `none`, so every role of the grid's `roles` is held |
| step 0 | unchanged |
| step k ≥ 1 | the 1,311 cells of slots 1,311 (k − 1) to 1,311 k − 1 each move on by one value, v → (v + 1) mod 4, slot t being cell (40,503 t) mod 65,536 |

So every step from 1 changes exactly 1,311 of 65,536 cells, 2.0004% (2% is 1,310.72), in all 256 rows, 3 to 6 a row, and
a cell changes about once every 50 steps; the values after every step are `programs.ts` `valueAt`. It keeps its state
in memory from step to step, as the design allows (Logic `logic@1`: memory and globals are the program's whole state,
and checkpoints hold them), since a program that writes all 65,536 cells at every step spends more than the default
fuel (below).

## What was probed at the base

Once, through the base's real components (a debug `deep-show` and #544's assembler), by a scratch vitest file inside this
worktree, not committed. One `deep-show run` scenario presented three films and read each logic item through
`deep_query`'s logic read (`what: "logic"`, which bakes the document's logic items under their budgets and answers each
asked step's arrays, the fuel each step used and the item's trap):

- **This folder's program in the budget's fixture** (`warDoc(program())`, program SHA-256 `862fa0da…a4bee`):
  `deep_show` presents it with no issue (the base keeps the unknown `grid_image@1` and skips it, with an `unknown_kind`
  notice). Steps 0 to 120 read back: every one of the 65,536 cells at every step equals `programs.ts` `valueAt` (0
  mismatches); each step from 1 to 120 changes exactly 1,311 cells from the step before, in all 256 rows, the rows
  `rowsMovedAt` names; no trap; 4 fuel at step 0 and 34,103 at every step after, 3.4% of the default 1,000,000. `eval` at
  step 60 raises no issue. The scenario took 6 to 7 s.
- **The first suite's `war` program in the same fixture** (`warDoc(warProgram())`): `deep_show` refuses the document,
  `logic.trap` at `war` ("logic.step can't evaluate this"), so `deep_query` has no revision to read.
- **That program with `budget: {fuel: 10000000}`** (the design's ceiling) on its logic item: presented; 2,293,766 fuel at
  steps 0, 1, 2 and 60, 2.3 times the default budget, and its array changes. So under the default budget its first step
  runs out of fuel.

## How this draft differs from the first

- **The program.** The first suite's `war` program writes all 65,536 cells at every step, about 35 instructions a cell,
  and leaves the logic item's budget at its default: 2,293,766 fuel a step against 1,000,000, so its first step traps and
  the base's check refuses its film (above). An implementation that runs logic as the design says can't draw that film
  changing 2% a step: it refuses the film, as the base's check does, or freezes the item with its arrays as `init` left
  them (a trap freezes only that item), so no frame from 1 uploads a row and the first draft's own guard fails. This draft keeps the first suite's fixture and swaps in a program that changes 1,311
  cells a step within the default budget.
- **The guard on what is timed.** The first draft asks that every frame from 1 uploads some row; this one asks that it
  uploads exactly the rows its step changed (the first suite's own `row_uploads` definition) and draws a new picture
  (`pixel_hash`), and that `gpu_ms` and `draw_ms.war_map` are times above 0, so frames that skip the grid or report
  nothing don't pass for the criterion's.
- **The frames.** 120 frames with readings over frames 10 to 119, where the first draft takes 60 and frames 5 to 59, so
  each run's p95 is of 110 frames.
- **Off macOS** the record is still judged before the test fails `INCONCLUSIVE:`.

Everything else is the first suite's surface as its README defines it (The surface under test): the kind `grid_image@1`
with the issue's fields; `deep-gpu run`'s `film2d` with `assets` (the program by its hash), `counts` (`row_uploads`),
`timings` (`draw_ms`) and `hash`; frame n of a 60 fps film drawing the grid as step n left it; the perf lane's hold; and
#1634's helpers for the judge. No surface, field, plant or feature is added.

## Readings where the issue leaves a choice

- **"Compared with the merge base."** The perf lane and the budget window run a budgets.json task on both sides and
  compare (design: Every task carries its own budgets); the test holds that record, valid against the merge base's file,
  and judges the issue's own number.
- **"On the reference Mac in the local preflight."** The lane's own rule, `judgeLimit` with `fingerprint`, five runs after
  a warm-up; `timed` in `scripts/lanes.mjs`, which the local preflight runs under a timed grant.
- **"A 256 × 256 grid that changes 2% of its cells a step."** Exactly 1,311 of its 65,536 cells at every step, as the
  logic module runs the program under its default budget, spread over every row, so every step's rows upload; frame n at
  60 fps is step n.
- **"Drawn `smooth` at 512 × 512 px."** The first suite's fixture: 2 px a cell, `sample: "smooth"`, `edge: 1`.
- **"Stays within the data view class's 2 ms of frame GPU."** Each run's p95 of `film2d`'s `gpu_ms` (#417's frame GPU: the
  GPU layer's part, the compositor's and the window's) over frames 10 to 119; five runs judged by `judgeLimit` against 2.
- **"With its draw time recorded as a reading."** `draw_ms.war_map`, each run's median printed beside the verdict; a time
  above 0 on every frame, never judged against a limit.

## Not tested

No clause reaches these: the grid image's frame CPU, its GPU memory, a seek's whole upload, other sizes or samples, and
the web player.

## Files

- `ac6-budgets.test.ts`: the test.
- `programs.ts`: the program and the values it writes.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, as the first suite's.
- `BASE-FAILURE.txt`: the run at the base.
