# Acceptance tests for #546: step ceilings per budget class, host and rate; the guide's split search and dice; pipelined slow steps

Written first, from issue #546 (its Scope, Fields, five acceptance criteria and Proof line: "The guide's search in one
step and split across steps, the web and app ceilings, the dice game's shifted roll, and deep_kinds' table"), the
design sections it names and the base commit `f38d2b39` ("Merge pull request #2155 … issue-1653"), by a job that never
saw an implementation; none existed, and no other branch, worktree, issue or plan was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue body, as handed to this job.
- `docs/canvas-primitives.md`: Budget classes (the table: frame CPU 2 ms for core view and data view, 4 ms for figure,
  work product and showpiece, none for export); Logic `logic@1` (step k's seed, rolls keyed by the seed `init` gets and
  the action, `rng.timing` a kit's check, the read region's layout, `checkpoint.every`); Logic: interpolated writes
  (linear draws one step late; hold); Logic: work across steps; Logic: step blocks; Logic: sandbox; Check input: logic
  kinds (`logic.budget {fuel_share, on}`, the ceiling rule from the bake's fuel alone, `web` BLOCKED until the timed
  run).
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks); Dogfooding.
  AGENTS.md.
- At the base: `crates/deep-logic` (`about`, `check`, `bake` with seeks, `budget` with `blocked`, `view` and `frame`,
  `budget.rs`'s ceiling for the figure class's 4 ms from this host's measured ns per fuel unit, failing the first step
  over it only and reading `web` as BLOCKED), `crates/deep-canvas/src/budget.rs` (the classes and their frame CPU),
  `crates/deep-show/src/kinds.rs` (deep_kinds' ops; guides read by name in pages); the suites `tests/acceptance/532/`
  (the pattern this one follows: README, helpers.ts, programs.ts, the assembler crate) and `tests/acceptance/412/`
  (deep_kinds through `deep-show run`).

What the base already does, which these tests don't credit: logic.budget's ceiling rule for the figure class at 4 ms
(first step over it only, from the ns per fuel unit this host measures as it runs) and its BLOCKED reading of `web`;
bakes with seeks and checkpoint hashes; the live view of #532. It has no `step_ceilings` op, no `logic` guide, no
`ns_per_fuel` in `about`, no `pipelined`, no per-class or per-host table, no `play`, `ended` or `drawn` on a frame, and
none of this suite's planted names.

**What the base measures.** At the base, logic.budget's own calibration on this Mac reads about 0.072 ns per fuel unit
in the app (`report.fixed.app.ns_per_fuel`, from `budget.rs`'s 100,000-iteration loop), far below the design's
estimate of about 1 ns. If the reference Mac's fixed metering benchmark reads near that, the figure class's app
ceiling is about 41,000,000, past the fuel budget's cap of 10,000,000: criterion 1's one-step window (over 1.2 times the
ceiling, under 10,000,000) is empty, and the test fails saying so. Criterion 2 likewise needs a step between the web
and app ceilings under the cap. The tests don't adapt to that; the criteria's values stand.

## Run them

```sh
npm ci                          # once, if node_modules is missing
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once: the Linux x86_64 host (rust-toolchain.toml's channel)
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/546 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/546/tsconfig.json
rm -rf tests/acceptance/546/node_modules/.vite
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set;
helpers.ts puts Homebrew's rustup on PATH when present):

- **`deep-logic` and `deep-show`** for this Mac: `cargo build --locked --bin deep-logic --bin deep-show` in the
  checkout (deep-show's default features, `full`).
- **The assembler**: #532's crate (`tests/acceptance/532/wat`, reused, not copied into this folder), copied to a
  temporary folder outside the checkout and built there with the toolchain rust-toolchain.toml names, into
  `target/acceptance-546-wat/`. At this base its lockfile fails `cargo build --locked` in place (its `[[patch.unused]]`
  list predates two patches `.cargo/config.toml` has since added), so the copy is built without `--locked`: outside the
  checkout no patch applies, cargo only drops the copy's unused-patch entries, and every version stays the one the
  lockfile pins. Nothing in the checkout changes.
- **`deep-logic` for Linux x86_64** (criterion 2 only): the same command in `docker run --platform linux/amd64` with
  `rust:<channel>-slim-bookworm`, the checkout mounted read-only, caches under `target/acceptance-546-linux/`. Nothing
  is pulled.

Every test passes an explicit timeout (90 minutes: the Linux build runs under emulation; it overrides
`--testTimeout`). Temporary folders are deleted. Node built-ins and vitest only. **`scripts/lanes.mjs` needs
`'tests/acceptance/546/'` in its `alone` list**: the files build cargo binaries, start Docker, and criterion 5 reads
CPU times per frame. This README is the instruction; the implementer makes that edit.

Gates: a missing host is `BLOCKED:` (a failed test, never a pass): no Docker or no linux/amd64 image names the `docker
pull` command; an assembler that doesn't build names cargo's error. Nothing skips. `BASE-FAILURE.txt` is the run at
the base.

## The surface under test

The issue names `logic.budget`, `deep_kinds`' table, the logic module's guide with its two examples and `rng.timing`,
pipelining and planted twins, but no call, field or name for most of them. As in #532's suite, the logic module is
driven through `deep-logic` (#531's and #532's JSON-lines protocol), and deep_kinds through `deep-show run` (#412's
scenario `{"evidence": folder, "calls": [...]}`). **Every call, field, example name and planted name below that the
issue or the design doesn't give is this job's invention**, the smallest surface the criteria need; the implementer
builds exactly these, or a dispute goes to a blind redraft. Calls and fields not named here stay as #531's, #532's and
#412's READMEs define them.

### deep_kinds: `step_ceilings`

`{"call": "deep_kinds", "op": "step_ceilings"}` takes no other field (an unlisted one is refused at its path, as the
other ops refuse) and answers `{"step_ceilings": {<rate>: {<class>: {"app": fuel, "web": fuel}}}}`, the Fields line's
`{budget class → {app: fuel, web: fuel}} per step rate`:

- `<rate>`: each step rate it publishes, in Hz as a decimal string; `"30"`, `"60"` and `"120"` at least. Every rate it
  lists is checked.
- `<class>`: every budget class: `core_view`, `data_view`, `figure`, `work_product`, `showpiece`, `export`.
- Each value an integer, the fuel one step may use: for a class with frame CPU F ns (the design's table:
  2,000,000; 2,000,000; 4,000,000; 4,000,000; 4,000,000), `⌊((F × 0.75) ÷ ⌈rate ÷ 60⌉) ÷ ns_per_fuel⌋` evaluated in
  f64 in that order, with the host's `ns_per_fuel` from `deep-logic`'s `about` (below). `export`, which has no frame
  CPU, reads the fuel budget's cap, 10,000,000, at every rate and host.
- The reply may carry the fields every deep_kinds reply carries (`core`, `set_digest`).

### The logic module's guide

A guide named `logic` among the installed guides, read with the existing `read` op (`{"call": "deep_kinds", "op":
"read", "guide": "logic", "offset"?}`), paged as any guide. Its text holds:

- For each example `grid_search`, `grid_search_split` and `dice`, exactly one fenced block whose info string is
  `wat <name>` and exactly one whose info string is `json <name>` (the fence three backticks at a line's start, the
  info string alone on that line, the block ending at a line of three backticks).
  - The `wat` block: the example's program as WebAssembly text, which #532's assembler (`wat` 1.263.0, validated by
    `wasmparser` 0.263.0) assembles and logic@1's subset admits.
  - The `json` block: the logic item's params as one JSON object (`step_rate`, `reads`, `writes`, `budget`,
    `checkpoint`, as the example needs), without `program` and `assets`. The tests add `program` (the assembled
    block's sha256, its bytes in the piece's `assets`), for the two searches `assets: [the grid]` and `budget.fuel:
    10,000,000` (keeping the block's other budget fields), and for one bake of the split search `checkpoint.every`.
- A sentence holding both `rng.timing` and the word `kit` (a sentence: text between `.`, `!` or `?` followed by white
  space, or between blank lines).

### The guide's examples: what each program does

- **The grid asset** (one data asset, which the logic module copies to `assets_at` after a u32 of its length, as
  #532's README lays assets out): a u32 width, a u32 height, a u32 start cell and a u32 goal cell, little-endian,
  then width × height bytes, row by row (cell = y × width + x), 0 open and 1 wall. The tests give square grids of 8 to
  1,024 cells a side; the example's params give it the memory that takes.
- **`grid_search`** and **`grid_search_split`**: a breadth-first search over the four neighbours from the start to
  the goal, beginning at step 0, writing `done: {type: i32}` (0 while the search is pending, 1 once it has ended),
  `route_len: {type: i32}` (the route's cells, start and goal included, once it has ended; 0 before, and when no route
  exists) and `route: {type: i32, count: 4096}` (the route's cells, start first, goal last, in `route[0..route_len]`);
  after the search ends, later steps leave the arrays as they are. Both find a shortest route, the same one cell for
  cell for the same grid. `grid_search` does the whole search in step 0. `grid_search_split` keeps its progress in
  memory and does a share each step, every step's fuel at or under the figure class's app step ceiling at its step
  rate, and ends within 600 steps for every grid the tests give.
- **`dice`**: reads one control, `roll`; each entry of it a step reads is one throw (the action), numbered 1, 2, 3, …
  in the order the track gives them; each throw's face, 1 to 6, comes from a stream keyed by the seed `init` gets and
  the throw's number, never the step's seed; writes `die: {type: i32}`, the face of the latest throw, 0 before the
  first. A fixed clock (the default).

### deep-logic: what this suite adds

- **`about`** gains `"ns_per_fuel": {"app": number, "web": number}`: the ns per fuel unit the logic module measured
  with its fixed metering benchmark on the reference Mac, in the app (wasmtime) and in headless Chrome's own
  WebAssembly engine. A value the build carries, the same in every process and on every host (Linux included).
- **The piece's `class`** (#532's field: a budget class name) is read: logic.budget holds each step to the ceiling for
  the piece's class, the item's step rate and each host in `on`. The tests always give it.
- **`check`** (and `view`'s `items`) gains `"pipelined": bool` on each item: true for an item stepping at 30 Hz or
  slower whose writes are all `linear` or `hold` (the strong default, the assumption row).
- **logic.budget** (`{"call": "budget", …}`, #532's; every call here passes `fuel_share: 1`):
  - The ceiling rule gives one failure `{"rule": "ceiling", "item", "step", "host", "ceiling", …}` for every step and
    every host in `on` whose fuel passes that host's ceiling, not only the first. `ceiling` is the table's value for the
    piece's class, the item's step rate and the host; for a pipelined item, twice the table's value at its rate, within
    one fuel unit. From the bake's fuel alone, so every machine gives the same failures.
  - With `web` in `on` and no failure: verdict `BLOCKED`, `failures: []`, and `blocked: [{"host": "web", "ask":
    string}]` (one entry, the base's shape) until the player's timed run (#1044). Any failure: `FAIL`. With `app`
    alone and no failure: `PASS`.
  - `report.items[<id>]` gains `"ceiling": {<host>: fuel}` for each host in `on` (what that item's steps are held to)
    and `"pipelined": bool`.
- **The live view** (#532's `view` and `frame`). A pipelined item runs step k + 1 off the render worker, on a logic
  thread, across the frames that draw k − 1 to k.
  - `{"call": "frame", "session", "play": true}`: before the frame, the playhead moves one 60 Hz frame (11,760,000
    flicks) on, within the span. A frame with neither `play` nor `seek` is at the playhead as it stands (a view opens
    at t = 0).
  - `eval_ns` (#532's): the render worker thread's CPU time this frame; a pipelined step's CPU on the logic thread
    isn't in it.
  - `"ended": {<logic ID>: [{"step": k, "deep_hash": 16 hex}]}`: each step of the item whose run ended after the
    previous frame's draw and before this frame's draw, in step order, with the item's full-state hash just after it
    (what a bake's checkpoint at step k + 1 records). Every step is listed once, in the first frame drawn after it
    ends; `{}` or an empty list when none ended.
  - `"drawn": {"<logic ID>.<array>": {"step": k, "hash": 16 hex}}`, for every array of every item: `step` is the
    newest step whose values this frame's draw read (for a linear write the k of the k − 1 to k blend, for hold the
    step shown); `hash` the first 16 hex digits of the SHA-256 of the values step k left in that array, as its write
    region lays them out (each element in order: an f64 and each vector component a little-endian f64, an i32
    little-endian, a bool a little-endian u32 of 0 or 1).

### Planted twins (`--planted <name>`)

Each is one criterion's wrong program, reachable only through this argument, and changes nothing else.

| Binary | Name | Criterion | The wrong program |
|---|---|---|---|
| `deep-logic` | `budget_holds_steps_to_fuel_budget` | 1 | logic.budget holds each step only to its item's fuel budget (`budget.fuel`): it gives no `ceiling` and no `frame` failure for a step within `budget.fuel`; every other rule unchanged |
| `deep-logic` | `budget_web_passes_from_fuel` | 2 | logic.budget on `web` passes, from the bake's fuel alone, a piece whose steps all fit the web ceiling: no `blocked` entry for web, verdict `PASS` when nothing else fails; its web ceiling failures unchanged |
| `deep-show run` | `guide_dice_rolls_from_step_seed` | 3 | the guide's `dice` program (its `wat` block) draws each throw from the step's seed (the read region's seed) in place of the seed `init` gets and the throw's number; its `json` block and the rest of the guide unchanged |
| `deep-show run` | `step_ceilings_publish_fuel_cap` | 4 | `step_ceilings` answers 10,000,000 for every rate, class and host |
| `deep-logic` | `pipeline_draws_before_step_ends` | 5 | the live view draws a pipelined item's arrays for the step due at the frame's time without waiting for that step to end; `drawn.step` names that step, and `ended` lists it only once it has ended |

## Programs

`programs.ts` holds this suite's own programs as WebAssembly text and the grids. `burn` runs a loop `counts[k]` times
at step k (its counts in a data segment; fuel b + a × count, its line read off one calibration bake) and writes `acc`
(i32, hold), its fuel budget 10,000,000. `crowd` moves 600 units each step after W iterations per unit of a square
root and division chain, writing `pos` (600 vec2, linear) and `phase` (600 i32, hold), at 30 Hz with a checkpoint
every step. `grid` draws a seeded square grid, a fifth of its cells walls, start and goal at opposite corners and
reachable; `shortest` is the test's own breadth-first search. The guide's examples come from deep_kinds.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID. Hosts: this Mac for every test; criterion 2's first
test also needs Docker with the linux/amd64 image.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#546.9988cce1` | `ac01-grid-search.test.ts` (2) | The guide's searches and the figure class's app ceiling c at their rate, from deep_kinds; a grid sized until `grid_search`'s step 0 spends over 1.2c, under 3c and under 10,000,000: it finds a shortest route; logic.budget on [app] reads FAIL with exactly one ceiling failure, step 0, host app, ceiling c. `grid_search_split` on that grid ends at a step d > 0 within 600 steps with the same route, cell for cell, no step over c, and logic.budget passes it with no failure; with a checkpoint every E = ⌊d/2⌋ + 1 steps (E in the search, 2E past its end) a seek to E restores the checkpoint at E and plays to 2E with playing's step hashes and full-state hash. `budget_holds_steps_to_fuel_budget` reads PASS on the one-step search, and the judgement fails naming step 0 and host app. Fails: a ceiling from the fuel budget, a failure naming another step, host or ceiling, a split search that differs or passes the ceiling, progress outside a checkpoint |
| 2 `#546.73b1f110` | `ac02-web-ceiling.test.ts` (2) | The figure class's 60 Hz ceilings from deep_kinds, web below app; `burn`'s step 5 spends between them (about 30% of the way up) or half the web one. On [app, web], on this Mac and in a linux/amd64 container: `between` reads FAIL with exactly one ceiling failure, step 5, host web, the web ceiling, and nothing naming host app; `fits` reads BLOCKED with no failure and one blocked host, web; Linux reads the same verdicts, failures and blocked hosts as macOS. `budget_web_passes_from_fuel` reads PASS on `fits`, and the judgement fails naming host web. Fails: a web ceiling that is the app's, a web rule that waits for the browser, a PASS from fuel alone, hosts that differ |
| 3 `#546.a29a5ebb` | `ac03-dice.test.ts` (2) | The guide's `dice`, eight document seeds, throws at steps 10 and 40 against 11 and 40 on a fixed clock: each throw's face (1 to 6) is the same either way, and the first throws aren't one face for all eight seeds; a sentence of the guide names `rng.timing` and `kit`. Served by `guide_dice_rolls_from_step_seed`, the dice game rolls another face for some seed and the judgement fails naming step 11. Fails: rolls from the step's seed, rolls that ignore the seed init gets, a guide that doesn't name the check |
| 4 `#546.21066ef8` | `ac04-step-table.test.ts` (2) | Every rate the table lists (30, 60 and 120 among them), every class and both hosts: each ceiling the formula's with `about`'s ns per fuel unit, export's 10,000,000; for each class with frame CPU, web below app, 30 Hz equal to 60 Hz, 120 Hz within one fuel unit of half 60 Hz's. `burn` with steps straddling each ceiling by a loop iteration or two (a step near the cap for a ceiling over it), for every class with frame CPU at 60 Hz on [app, web], figure at 120 Hz on [app, web], and figure at 30 Hz (pipelined) on [app] against twice the 30 Hz ceiling: logic.budget's ceiling failures are exactly the steps over, each naming its ceiling. `step_ceilings_publish_fuel_cap`: the judgement fails naming every class with frame CPU. Fails: a ceiling off the formula, one table for every class or rate, a rule that fails only the first step or the wrong ones, a pipelined item held to one ceiling |
| 5 `#546.d7e6a2fc` | `ac05-pipelined.test.ts` (2) | `crowd` (600 units, 30 Hz, linear and hold writes) in a figure piece, its step about 1.6 times the 30 Hz app ceiling or 9,000,000 fuel, whichever is less: check and logic.budget read it pipelined; logic.budget on [app] passes it and holds it to twice the 30 Hz ceiling within one fuel unit. A live view, frame 1 at t = 0 and 120 frames of `play`: each frame one 60 Hz frame on; no frame's `eval_ns` past 4,000,000; steps 0 to 60 each end once, their full-state hashes the inline bake's after them; each frame draws `crowd.pos` and `crowd.phase` at the step due at its time, an ended step, with the bake's values for it. `pipeline_draws_before_step_ends`: the judgement fails, its first failure naming the frame and the array. Fails: a step on the render worker, a pipeline whose state differs from inline, a draw before its step ends, a budget held to one ceiling |

Test count: 2 + 2 + 2 + 2 + 2 = 10.

## Readings where the issue leaves a choice

- **The surfaces.** `deep-logic` for logic.budget, bakes and the live view, as #531's and #532's suites drive the
  logic module; `deep-show run` for deep_kinds (#412). deep-show's documents aren't driven.
- **"The guide's grid search … the guide's version split across steps"**: two examples of the guide, read and
  assembled from its blocks; the grid is the test's, the programs and their item params the guide's.
- **"Between 1.2 and 3 times … and under 10,000,000"**: strictly, over 1.2c and under both 3c and 10,000,000. A
  ceiling of 8,333,334 or more leaves no such step and the test fails naming the empty window.
- **"Fails logic.budget in that class, naming the step, the host app and the ceiling"**: the piece's class is
  `figure`; exactly one `ceiling` failure, naming the item, step 0, host app and c. Another rule (such as `frame`) may
  fail too. Every logic.budget call passes `fuel_share: 1`, setting the share rule aside: these criteria are about the
  step ceiling, and the one-step search spends more than half its fuel budget whenever 1.2c passes 5,000,000.
- **"Every step under the ceiling"**: every baked step's fuel at or under c (logic.budget fails only a step over it).
- **"Seeking into the middle of the search equals playing by full-state hash"**: #532's bake seeks: the seek restores
  a checkpoint taken while the search is pending and plays on through the first checkpoint after the search has
  ended, whose full-state hash, and the step hashes on the way, equal playing's.
- **"Passes … and so fails this criterion"** (a planted budget): it reads PASS, and the criterion's judgement of its
  reply fails.
- **"Passes on the app"**: no failure of any rule names host app. **"From the bake's fuel alone and the same on macOS
  and Linux"**: the linux/amd64 container, where no browser runs, gives the same verdict, failures and blocked hosts.
  **"Until the player's timed run"**: that run (#1044) isn't made here; the piece that fits must read BLOCKED.
- **"Keys each roll by the seed init gets and the action's number"**: a throw is one entry of `roll`, numbered by its
  order; "stamped one step later" moves the first throw's entry from step 10 to step 11; the faces compared are
  `die` just after each throw's step. Eight seeds, so a twin rolling from the step's seed lands on the same face for
  all eight about once in 1.7 million.
- **"Names rng.timing as the kit check"**: a sentence of the guide holds `rng.timing` and `kit`.
- **A class with no frame CPU**: export has no frame cap, so no frame binds its steps; its ceiling is the fuel budget's
  cap, 10,000,000, at every rate and host.
- **"Within one fuel unit"**: 120 Hz's ceiling within 1 of half 60 Hz's; a pipelined item's ceiling within 1 of twice
  the table's (a step over twice it by one fuel unit may or may not fail; one over by more must).
- **"Fails exactly the steps over the ceiling deep_kinds returns for the piece's class"**: per piece, the set of
  (step, host) ceiling failures equals the set of steps whose bake fuel passes that host's ceiling, each failure
  naming it. A ceiling within 4 loop iterations of the cap can't be passed by any step: a step near the cap must then
  not fail.
- **"A planted table … fails, naming the class"**: the table's judgement names each class with frame CPU.
- **"A 600-unit item"**: 600 units, each moved every step. Its step's size isn't given; the test makes it heavy
  enough that run on the render worker it would pass 4 ms on this Mac.
- **"No render-worker frame passes 4 ms"**: every frame's `eval_ns` ≤ 4,000,000.
- **"Its full-state hashes equal an inline run's at every step"**: the inline run is the bake, with a checkpoint
  every step; each ended step's hash equals the bake's checkpoint after it, for steps 0 to 60.
- **"Holds it to twice the 30 Hz ceiling"**: the report's app ceiling for the item, within one fuel unit of twice
  the table's, and PASS with its step over the 30 Hz ceiling where the cap allows.
- **"Draws a step's arrays before the step ends … naming the first frame and the array"**: a frame's `drawn` names a
  step its `ended` lists haven't reached; the judgement's first failure, in frame order, names that frame and array.

## Not tested, because no criterion reaches it here

The fixed metering benchmark itself and its run in headless Chrome (the tests read its published result); the
generated skill's line about splitting work; step blocks' critical path against the ceiling; world pages counted as
fuel; ceilings held in checks and exports apart from logic.budget; the player's timed run on the web (#1044); turn
clocks with `due`; the guide's real-time arena examples; `net.budget`.
