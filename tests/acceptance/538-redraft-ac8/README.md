# Blind redraft of #538 AC8: the budgets

This folder is a blind redraft of #538's eighth criterion, AC8 `#538.ed6f8052` (docs/technical-design.md: Dogfooding: "A
disputed test goes to a fresh run of that job, with the same inputs and the criterion, never the work, the diff or the
dispute"):

> Budgets, on the reference Mac in the local preflight, compared with the merge base: comparing 1 MiB of arrays after a
> step takes under 0.2 ms; remapping one changed row of a 9,216-row layer under 20 µs and the whole layer under 1 ms;
> uploading 1,000 changed slots of a 100,000-slot instancer under 0.5 ms; a 256 × 256 overlay upload under 0.1 ms; the
> fit check over a 5,000-key table in three locales under 2 s at check; and a document with no logic columns gains no
> work per frame

It was written from the issue (`gh issue view 538`), its parent #186, the design documents and the checkout at
`e06eed295` (origin/main `53c0e72a3`, the first suite `fdfdeeae2` under `tests/acceptance/538/`, and its lanes line), before
any implementation, and without reading any other worktree, branch, pull request or session. No dispute was given to it.
It stands beside `tests/acceptance/538/ac8-budgets.test.ts` and changes nothing there; which draft stands is the
Dogfooding rule's call, not this folder's. The implementing agent doesn't edit it (AGENTS.md, Proof).

## What was read

- Issue #538 (Scope, Fields, the nine criteria, Proof, Oracle line) and #186 (its parts and Proof).
- `docs/technical-design.md`: Numbers version 0 has to hold (the canvas budget, "Every task carries its own budgets", the
  reference Macs), Sandbox and budgets, Dogfooding, Proven on the base; the canvas module table's text, cells, logic and
  data rows.
- `docs/canvas-primitives.md`: Logic `logic@1` (`budget: {fuel: per step = 1,000,000, memory: MiB = 4, stack: KiB =
  64}`) and Logic: sandbox; Array and table: column view; Mark set: logic columns (its Cost line: comparing written
  arrays O(bytes written) a step, remapping O(changed rows), a full remap after a seek O(rows)); Instance `instance@1` and
  its logic columns ("only changed slots upload"); Builder plate: terrain overlays ("only rows a step changed upload", 64
  KiB at 256 × 256); Cell grid `cells@1`: logic grid; Text `text@1`: keyed copy.
- In the checkout, for surfaces and conventions: the first suite's `README.md` (its surfaces, fields and the budgets
  task, reused here), `helpers.ts`, `programs.ts`, `fixtures.ts`, `ac8-budgets.test.ts` and `BASE-FAILURE.txt` (all
  disclosed: this draft chose its own readings, guards and still documents); `../537/helpers.ts`; `../2017/ac3-budgets.test.ts`
  and `../2017-redraft-ac2/` (a budgets task, a redraft's README); `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`,
  `validateBudgets`), `scripts/lanes.mjs` (`alone`, `timed`), `benchmarks/budgets.json`, `benchmarks/canvas.mjs` (how a
  canvas task's targets are judged); `crates/deep-show/src/frames.rs` (`frames`: `ran`, `remaps`), `logic.rs` (the host
  bakes every logic item's steps at check), `hub.rs` and `packs.rs` (`deep_show`'s `timing` block);
  `crates/deep-logic/src/bake.rs` and `world.rs` (each step's written arrays compared with the step before's),
  `piece.rs` (a logic item's `budget` defaults), `lib.rs` and `main.rs` (the `deep-logic` runner's `bake` call, its
  `traps` and per-step `fuel`); `crates/deep-canvas-sandbox/src/rewrite.rs` (fuel: each block charges its instruction
  count);
  `crates/deep-gpu-layer/src/view3d.rs` and `fed.rs` (`view3d`'s `counts`: `element_uploads`, `instances_written`,
  `meshes_built`).

Every expected value comes from the issue, the design and the programs (the first suite's and this file's); code was
read to learn surfaces and the logic item's budget.

## Run it

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:/opt/homebrew/opt/rustup/bin:$PATH \
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  npx vitest run tests/acceptance/538-redraft-ac8/ac8-budgets.test.ts --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/538-redraft-ac8
```

`../538/helpers.ts` builds what the file drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, and copies it to a
temporary folder: `cargo build --locked --bin deep-show` and `cargo build --locked --bin deep-gpu`, and on a reference Mac
at rest only both again with `--release`; it assembles the programs with #544's assembler (`tests/acceptance/544/wat`,
read only) into `target/acceptance-538-wat/`. The only processes started are cargo, the assembler, `deep-show run` and
`deep-gpu run` (and the `sysctl`, `pmset`, `osascript` and `sw_vers` reads of `fingerprint`, through `judgeLimit`), each
waited for, none stopped by name or port. Folders are temporary and deleted. Node built-ins and vitest only.

Gates, none a pass: off macOS, or where `view3d` answers `unsupported_platform` or `gpu_unavailable`, the test fails
`INCONCLUSIVE:` (the uploads are drawn on Metal); off a reference Mac at rest the timings are not taken and the test
fails `INCONCLUSIVE:` with the perf lane's reason, after everything that answers on any machine has passed.

**The lanes lines.** The implementer adds these to `scripts/lanes.mjs` (this README is the instruction):

```js
// #538's redraft of AC8 builds deep-show and deep-gpu, draws on the GPU and judges the task's budgets on the reference Mac.
alone.push('tests/acceptance/538-redraft-ac8/');
timed.push('tests/acceptance/538-redraft-ac8/ac8-budgets.test.ts');
```

## What the test does

One test, `AC8 #538.ed6f8052 …`, in four parts. Parts 1 to 3 run on every machine and gather what is missing or wrong
into one list, asserted in the test file before any timing, so one run names all of it.

1. **No work per frame without logic columns**, by counters, not time.
   - `deep-show run`: `frames` of six frames with `timings: true` on a still 2D document with no logic columns, and on the
     bare one, in the same process. The still document is the first suite's `stillDoc` (a text, 30 labels from data
     columns, a group of two rects) with one item more, `note`, a text showing #407's localized copy (`copy: "note"`
     from `data.copy.en`), the copy path keyed copy joins. The bare one is a rect. No frame after the first runs more
     operators (`ran`) than the bare one's same frame, and each frame's `compares` and `remaps` are empty lists.
   - `deep-gpu run`'s `view3d` with `counts` and `timings`: six frames of a still 3D scene with no logic columns,
     `quiet` (320 × 200 px, a 64 m terrain plate at 1 m spacing with no overlay, and 200 boxes from an `instance@1` whose
     `ids` and `pos` are data). No frame after the first writes an instance record (`instances_written` 0), builds a
     mesh (`meshes_built` 0), uploads an element (`element_uploads` all empty) or spends upload time (`upload_ms` holds
     no value but 0).
2. **The timing surfaces, on the debug build, over the fixtures the clauses name**, each guarded so what it times is the
   clause's work. The logic programs are this file's own where the first suite's don't run (Programs, below):
   - **Comparing 1 MiB after a step**: `heap` (520 × 520 u): the logic item `heap` (`a` i32 × 262,144) and `reader`, an
     atlas tile set of 512 × 512 cells of 1 u on the first suite's eight-cell atlas, its `tile` column `{array: "heap.a",
     as: "u16"}`. `frames` of 20 frames with `timings`. Each frame after the first has one `compares` entry for `heap`
     with `bytes` 1,048,576 and its `ms`, and the reader remaps one row: the step ran and changed one element.
   - **Remapping a row, and the whole layer**: the first suite's `layer` and its program (96 × 96 atlas cells from
     `map.cells`, step k changing cell k), 40 frames and then five one-frame seeks back to frames 30, 25, 20, 15 and 10.
     Frames 1 to 39 each have one `remaps` entry for `layer` with `rows` 1 and its `ms`; frame 0 (a new reader) and each
     seek have one with `rows` 9,216 and its `ms`.
   - **The fit check**: `goods`, the first suite's `fitDoc` and `shop` program (5,000 keys in en, fr and de, each
     `"<word> <letters>: {0}"` with its argument at `'999'`), its text item `ware` given `box: {w: 300, h: 20}` and
     `max_lines: 1`, every string fitting. `deep_show` presents it, and with `include: ["issues", "timing"]` gives
     `timing.copy_fit_ms`. Its twin, the same table with de's last key (4999) the first suite's long German sentence
     (`LONG_DE`), is refused at check with an error whose own fields name 4999 and de, so the fit check timed reads
     every key of every locale against a bound.
   - **The uploads** (`view3d`, 30 frames at 60 fps, `counts` and `timings`): the first suite's `swarm` (an
     `instance@1` of 100,000 slots of a 0.6 m box from `crowd`'s `live`, `gen` and `pos`, 420 m across 640 × 400 px) and
     `field` (a 256 × 256 m terrain plate at 1 m spacing with one overlay `{grid: "fogger.fog", size: [256, 256], roles:
     ["fog", "dim", "none"], opacity: 1}`, 512 × 512 px), both over 0.5 s, fed by this file's `crowd` and `fogger`. Each
     frame after the first: `element_uploads.swarm` holds 1,000 slots, the field's `pixel_hash` differs from the frame
     before's, and `upload_ms.swarm` and `upload_ms.field` are numbers above 0.
3. **The record, compared with the merge base.** `benchmarks/budgets.json` holds the task `canvas-game-state` exactly as
   the first suite's README (The budgets, item 1) gives it: `command: ["node", "benchmarks/canvas.mjs", "game-state"]`,
   `margin: 0.5`, `targets: {compare_ms: 0.2, remap_row_us: 20, remap_layer_ms: 1, upload_slots_ms: 0.5,
   overlay_upload_ms: 0.1, fit_check_ms: 2000, idle_steps: 0}`, `criteria` holding `#538.ed6f8052` and an `initialReason`
   naming #538; the lane's `validateBudgets` accepts the file; and `scripts/lanes.mjs`'s `timed` holds this file.
4. **The timings, judged only where the lane can.** `judgeLimit` on five zero readings first: anything but PASS (off the
   reference Macs, on battery, Low Power Mode on, thermal state not nominal, or the load above the cores) fails
   `INCONCLUSIVE:` before anything is timed. Then release builds, one warm-up run of part 2 and five, each run's
   readings: `compare_ms` the median `compares[].ms` of heap's frames 1 to 19; `remap_row_us` 1,000 × the median one-row
   `remaps[].ms` of the layer's frames 1 to 39; `remap_layer_ms` the median of the six full remaps; `upload_slots_ms` and
   `overlay_upload_ms` the median `upload_ms` of the swarm's and the field's frames 1 to 29; `fit_check_ms` goods'
   `timing.copy_fit_ms`. Each is judged by `judgeLimit` against the issue's number with the five runs' loads: a FAIL
   fails the test; anything but PASS leaves it `INCONCLUSIVE:` with the readings; all six PASS passes.

## Programs

In the test file, as WebAssembly text in the first suite's layout (`../538/programs.ts`: `memory` with its maximum
equal to its minimum, `init(seed)`, `step(k)`, `reads_at` 0, `writes_at` 4096, arrays in declaration order on 8-byte
boundaries), assembled by #544's assembler. The logic item's budget is left at its defaults (design: Logic `logic@1`,
`budget: {fuel: per step = 1,000,000, memory: MiB = 4, stack: KiB = 64}`), and each program keeps every step inside it.
The first suite's `heap`, `crowd` and `fogger` don't: at the base each runs out of fuel at step 0 (probed below), so its
item freezes with its arrays as `init` left them (technical design: Sandbox and budgets, "a trap freezes only that item"), and every
frame reads unchanged arrays: nothing changed for the comparison to find, no live slot in the swarm, an overlay that
never changes. Its `layer` and `shop` run, and are used as they stand.

| Program | Arrays | After step k | Fuel a step at the base |
|---|---|---|---|
| `heap1mib` (item `heap`) | `a` i32 × 262,144 (1 MiB) | element i is 1 once step i has run, else 0; every step stores all 1 MiB, 16 i64 stores a loop pass, so step k changes element k alone | 565,286 at step 0, 20 more each step after |
| `spawn` (item `crowd`) | `live` bool, `gen` i32, `pos` vec3, × 100,000 | for k under 100, step k spawns block k, slots 1,000 k to 1,000 k + 999: live, gen 1, at ((s mod 400) − 200, 0, ⌊s ÷ 400⌋ − 125) m; nothing else changes | 44,016 |
| `flipfog` (item `fogger`) | `fog` i32 × 65,536 on 256 × 256, index 256 cz + cx | (cx + cz + k) mod 2: every cell flips between roles 0 (fog) and 1 (dim) at every step, 16 i64 stores a loop pass | 141,320 |
| the first suite's `layer` (item `map`) | `cells` i32 × 9,216 on 96 × 96 | ((cx + 3 cy) + [i ≤ k]) mod 8: step k changes cell k | 276,483 |
| the first suite's `shop` (item `rules`) | `item`, `count` i32 × 1 | item 1, count 5 | 7 |

## Surfaces

The base's: `deep-show run` (one scenario line in, `{"ok": true, "replies": […]}` out), `deep_show`, `frames` (`ran`,
`remaps: [{set, step, rows}]`, #535), `deep_show`'s `timing` block (`check_ms`); `deep-gpu run`'s `view3d` (#378) with
`counts` (`element_uploads`, `instances_written`, `meshes_built`) and `timings`.

The new fields are the first suite's (its README: The surface under test), used as it defines them:

| Field | Where | As the first suite defines it, and what this draft adds |
|---|---|---|
| `compares: [{logic, step, bytes, ms}]` | each frame of `frames` with `timings: true` | One entry per logic step whose arrays the frame applies first, `bytes` the bytes that step wrote, `ms` the CPU time the logic module took comparing them with their values after the step before and finding the changed ranges, where that step ran. **Added here, plainly:** with `timings` it is a list on every frame, `[]` on a frame that applies no logic step, as every frame of a document with no logic does. |
| `remaps[].ms` | each `remaps` entry of `frames` with `timings: true` | The CPU time in ms the data module took remapping those rows. |
| `upload_ms: {<item>: ms}` | each frame of `view3d` with `timings: true` | For each instancer fed by logic and each plate with overlays, the CPU time in ms from the start of writing this frame's changed slot records (or overlay cells) to the return of the queue's write of them; 0 for an item the frame uploads nothing for. **Added here, plainly:** it is an object on every frame, `{}` in a scene with neither. |
| `timing.copy_fit_ms` | `deep_show` with `include: ["issues", "timing"]` | The CPU time in ms the text module's fit check over every key of every copy table in every locale the document carries took at this check. |
| `canvas-game-state` | `benchmarks/budgets.json` | Unchanged (above); with `benchmarks/canvas.mjs game-state` and its judge, which the perf lane and the budget window run, as the first suite's README asks. What the mode measures is the implementer's; a mode built on the first suite's `heap`, `crowd` and `fogger` would time arrays that never change (Programs). |

No other surface, field, plant or feature is asked for.

## Readings where the issue leaves a choice

- **"Compared with the merge base."** The perf lane and the budget window run a budgets.json task on both sides and
  compare (design: Every task carries its own budgets); the test holds that record and judges the issue's own numbers.
  It runs no git, so the validator is given no merge-base file (`{tasks: []}`).
- **"On the reference Mac in the local preflight."** The lane's own rule, `judgeLimit` with `fingerprint`, five runs
  after a warm-up; `timed` in `scripts/lanes.mjs`, which the local preflight runs under a timed grant.
- **"Takes under"**: a run's median over the frames that do the work; five runs judged by `judgeLimit`.
- **"Comparing 1 MiB of arrays after a step"**: the logic module's comparison of the 1,048,576 bytes one step stored
  (design: Mark set: logic columns, "comparing written arrays O(bytes written) a step"), with one element changed, so the
  comparison scans the whole array to find one range; a reader of the array is there so the changed range is needed
  and seen.
- **"Remapping one changed row … and the whole layer"**: a remap the column view reports for one row, and one for all
  9,216 (a new reader's first frame and a seek back, design: Array and table: column view).
- **"Uploading 1,000 changed slots of a 100,000-slot instancer"**: the frames that upload exactly the 1,000 slots their
  step changed, in an instancer whose slot count is 100,000 (fixed at check by the arrays' count). The slots change by
  spawning, not by moving every live one: a step that rewrites all 100,000 slots' 3.2 MB takes at least 400,000
  eight-byte stores of three instructions each, past the default 1,000,000 fuel, and the program's memory keeps what
  earlier steps wrote. **"A 256 × 256 overlay upload"**: a frame whose
  step changed every cell, so the whole overlay uploads whether a frame uploads changed rows or changed cells.
- **"The fit check over a 5,000-key table in three locales … at check"**: `deep_show`'s check of a document carrying the
  table, its text bounded by a one-line box so every string is measured; the refused twin shows that check reaches the
  last key of the last locale.
- **"A document with no logic columns gains no work per frame"**: frames after the first of a still document do no more
  than the bare document's (operators run) and nothing of what this task's budgets time (arrays compared, rows remapped,
  instance records written, elements uploaded, upload time), in 2D and in 3D. A cell grid is left out of the still 2D
  document, as the first suite leaves it out (its README: the cells module's operator reads `t` at the base, so it runs
  every frame for any grid, which is not this task's work); this draft didn't probe a grid. So is a flip by keys, which
  is driven by time.

## What was probed at the base

Each program and document, once, through the base's real components (debug builds of `deep-show`, `deep-gpu` and, for
the programs alone, the logic module's own runner `deep-logic`), before relying on it, by probe files not committed:

- **The programs**, each baked four steps by `deep-logic`'s `bake` with no `budget` written: the first suite's `heap`,
  `crowd` and `fogger` each trap with kind `fuel` at step 0, having used the whole 1,000,000, and every later step reads
  `failed`, no hash and no changed range; its `layer` (276,483 fuel a step) and `shop` (7) run. This file's `heap1mib`,
  `spawn` and `flipfog` run every step with the fuel in the table above, and their changed ranges are: `a` element k
  alone at step k; slots 1,000 k to 1,000 k + 999 of `live`, `gen` and `pos` at step k; half the cells at step 0 (those
  `init` left at the step's value stay), then every cell at every step.
- **`heap`** with `reader` is presented with no issue; `frames` gives 20 frames, the reader remapping 262,144 rows on
  frame 0 and one row on each frame after (`ran` 2), no `compares` (the base has none). The deep-show call took 36 s on
  this loaded Mac's debug build.
- **`layer`** is presented; frame 0 remaps 9,216 rows, frames 1 to 39 one row each, and each of the five seeks 9,216, all
  with no `ms` (the base has none).
- **`goods`** with its box is refused, `bad_doc` at `items/ware/params/text` ("text.shape can't evaluate this"), as is
  its twin: the base has no keyed copy. The same document with `ware`'s text a literal string, keeping the box and
  `max_lines`, is presented, so `box` and `max_lines` are the base's own fields.
- **The still documents**: the still 2D document (with `note`) and the bare one are presented; frames 1 to 5 of each run
  0 operators, allocate nothing and remap nothing. A group with a flip by one key (`keys: [{t: 0, show: "left"}]`) ran 0
  operators after frame 0 too, but isn't kept (above). The still 3D scene draws; frame 0 writes 201 instance records and
  builds 2 meshes, and frames 1 to 5 write, build and upload nothing.
- **`swarm`** fed by `spawn`: frame 0 uploads all 100,000 slots, and each frame n from 1 to 29 exactly the 1,000 slots
  1,000 n to 1,000 n + 999; no `upload_ms` (the base has none). **`field`** fed by `flipfog` draws, its `pixel_hash`
  alternating between two pictures frame by frame. The swarm fed by the first suite's `crowd` writes no instance record
  and uploads no slot on any of its frames.

## Not tested

No clause reaches these: the logic grid's or keyed copy's own per-frame costs on documents that use them; GPU time;
memory; templates holding `{copy: …}`; a document reading a logic array with `interpolate: linear`.

## Files

- `ac8-budgets.test.ts`: the test.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, as the first suite's.
- `BASE-FAILURE.txt`: the run at the base.
