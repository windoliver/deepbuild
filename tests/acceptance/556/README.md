# Acceptance tests for #556: grid.reach over every generated floor, its flow form, run seeds that reach the game

Written first, blind, from issue #556 ("Play interface: grid.reach over every generated floor, its flow form, run seeds
that reach the game, and the plug-in's codes": its Scope, Fields, 7 acceptance criteria and Proof line), its Oracle
page, the design sections it names and the base commit c5c5865ac ("Merge pull request #2769 …"), by a job that never saw
an implementation; none existed, and no other worktree, branch, pull request, plan or session was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test file per criterion, with the planted twins each criterion names in its own file.

## What was read

- The issue, live (`gh issue view 556 --repo windoliver/deepbuild --comments`; no comments). Its 7 criteria are tagged
  by `scripts/proof-change.mjs`'s rule (`#556.` and the first 8 hex of SHA-256 of the text, white space collapsed).
- Its Oracle page (`doneright/oracles/issues/556.md` in DeepBuildAI/deepbuild, branch `doneright`): no upstream test
  checks any criterion; each is held to this suite's own fixtures and planted twins.
- `docs/canvas-primitives.md`: Check input: `grid.reach`; Play interface `game.play@1`; Check input: playtest; Check
  input: `rules.legal`; Mark set: hex grid; Control: point; Control: actions; Logic `logic@1`; Input track entries;
  Replica `deep_drive`.
- `docs/technical-design.md`: Checks for work beyond code (the Playtest bullet); Dogfooding. AGENTS.md.
- At the base, read only for the surfaces these tests use: `tests/acceptance/184`, `555` and `1048` (READMEs,
  `helpers.ts`, `programs.ts`, a test file or two each), `tests/acceptance/533/helpers.ts`; `packages/checks/README.md`
  and `packages/checks/playtest` (`deepbuild.json`, `index.ts`, `kit.ts`, `run.ts`, `types.ts`, `bots.ts`, `iface.ts`,
  `legal.ts`, the kit's maze fixture, `packages/checks/test/playtest.test.ts`); `packages/extension-host/src/host.ts`
  (`deep.canvas.play`, `runCheck` and its validator); `packages/conformance` (`slot-types.ts`, `slot-runner.ts`,
  `runKit`); `crates/deep-logic/src/play.rs` (`seeded`, `Plants`, policy keys), `grid_bot.rs` (the interface's grid,
  hex neighbours, layers and links); `crates/deep-replica/src/drive/play.rs`, `plant.rs`, `deep_drive.rs`;
  `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`), `scripts/lanes.mjs`, `scripts/lease`,
  `benchmarks/budgets.json` (#184's playtest tasks).

What the base does, which these tests don't credit: the playtest plug-in registers `playtest`, `rules.legal` and
`logic.edges`, so `runCheck` of `grid.reach` answers `missing` ("no loaded extension registered the check kind
grid.reach"), and its manifest lists neither the kind nor the codes `grid.unreached` and `grid.flow`; its kit is
`playtestKit` alone; `deep-drive` has no `keeps-document-seed` plant (an unknown plant answers `{"ready": false}`);
`benchmarks/budgets.json` has no `playtest-crawler` task. What it already does, which the tests rely on: #184's replica
`play` (a seed, `piece_seed: run` putting the run's seed in place of the piece's, spans in steps, policy keys at their
times, recorded tracks, checkpoints and final hashes), #555's play interface, `lockPlay`, the descender and
`play.missing`, #1048's layers and links and `rules.legal`, the host's `runCheck`, `deep.canvas.play` and its
validator, and `deep-logic`'s bake.

## Run them

```sh
npm ci                          # once, in a fresh worktree
npm run build --workspaces      # once
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  sh scripts/lease npx vitest run --root tests/acceptance/556 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/556/tsconfig.json
rm -rf tests/acceptance/556/node_modules/.vite
```

Every test passes its own timeout (90 minutes; the budgets' 3 hours) above `--testTimeout`. The builds, each once a
file and honoring `CARGO_TARGET_DIR`: `deep-drive` debug with `env-plants` and, on a reference Mac only, release
(#184's helper), `deep-logic` (#533's helper: layout probes and criterion 5's bake), and #533's assembler built from a
copy into `target/acceptance-555-wat` (#555's helper). **The folder is in `alone` in `scripts/lanes.mjs`**, and
`ac05-budgets.test.ts` in `timed` (it calls `judgeLimit`): its files start replicas and hubs and play 200-run
playtests for minutes.

Gates. Off macOS every test that plays fails `INCONCLUSIVE:` first thing (the replica's binaries exit on any other OS),
never a pass. Cargo that can't run is `BLOCKED:`. The budgets' timings are judged only where the perf lane's rule holds
(`judgeLimit` given five zero readings against a limit of 1 must read PASS: a reference Mac on mains power, Low Power
Mode off, thermal state nominal, the load under the core count); elsewhere the file fails `INCONCLUSIVE:` with the
rule's reason after every part that doesn't depend on the machine has passed, and is never retried. Nothing else
depends on time or load. Folders are temporary and deleted; processes are #184's helpers' children, stopped by PID.

Time (estimates: the suite can't run before the implementation). With the binaries built (a cold `deep-drive` debug
build took 2 minutes here, warm caches): 400 one-step plays of the crawler took 21 s on two debug replicas, and a
640-step play of the flow fixture reading its three 4,096-cell arrays 1.6 to 4.4 s. Criterion 1 runs grid.reach over
200 runs three times and 3 runs once, with 200 one-step plays and 203 replays of its own; criterion 3 over 200 runs
three times, with 200 one-step plays and 201 replays; criteria 2, 4, 6 and 7 a few runs each, criterion 6 also the
kit's fixed part on one planted runner. A whole run should take 10 to 25 minutes off the reference Mac, by how
grid.reach reads each run's grid; on a reference Mac criterion 5 adds 18 readings on release replicas (#555's 80-run
playtest, rules.legal over it, grid.reach over 200 floors), perhaps 10 minutes more. The base run (BASE-FAILURE.txt)
took 53 s.

## The surface

The issue and the design name the kind `grid.reach` of the playtest plug-in beside `playtest`; its fields
`{playtest, starts, goals = [exit], every = [], depths}` and its flow form `{playtest, flow: {next, cost, solid =
[blocked], targets, spawns, lag = 0}}`; its result `{floors: [{run, seed, depth, step, reached, unreached, nearest}],
coverage: {depth → runs}, flow: [{run, step, cell, why: rises | solid | loops | unreached}]}`; the codes
`grid.unreached`, `grid.flow` and `play.missing`; the playtest input's `piece_seed: own | run`; and the plug-in's
conformance kit with planted runners. **Every name below that the issue or the design doesn't give is this job's
invention**, the smallest the criteria need; the implementer builds exactly these, or a dispute goes to a blind redraft.
#184's, #555's and #1048's surfaces (their READMEs: The surface) stay as they are.

### grid.reach through `runCheck`

- `runCheck('grid.reach', spec)`, with check.kind@1's fields as a playtest's spec has them (`runner:
  'deep.canvas.play'`, …), plus **`reach`**: grid.reach's own input, and **`play`: the input of the playtest it names**,
  as a playtest's own spec carries it (#184), as #1048's `rules.legal` takes `legal` beside `play`. The runs it reads are
  that input's runs: each bot's run i at hash(seed, i), with the input's `piece_seed`, played through
  `deep.canvas.play`, so the host's rules for each play and its validator hold against that input. `testsRun` counts
  the runs it read (runs × bots); `evidence` holds each run's track hash.
- The plug-in's manifest lists `grid.reach` in `checks` and `grid.unreached` and `grid.flow` in `codes`, and the
  plug-in still passes its conformance check in the hub (this suite asserts `check(installed).passed`).
- Before any run, as the playtest does (#555): a name the interface declares that the piece publishes no array for
  fails with a failure whose message starts `play.missing:` and names the name; no run counted (`testsRun` 0), every
  replica call it made an error or a play of no step.

### Floors

- **A floor is recorded at step 0, and at each later step at which the interface's `floor` value differs from the step
  before's**, when the interface declares no `ready` (#555's crawler declares `floor: crawler.depth` and no `ready`, and
  publishes the current floor as `grid` in the step it arrives there); with neither, at step 0 alone. (With `ready`
  declared, the design's rule: each step at which it turns true; no fixture here declares one.) A recorded floor's
  depth is the `floor` value at its step.
- Its starts are the input's `starts`, else the interface's `start`, else the self unit's cell at the floor's step (the
  design's default).
- **A cell is named `[x, y]`**, y running on through the layers (layer × size[1] + y, #1048's naming), wherever
  grid.reach names one: in its input (this suite's flow `spawns`), its result and its messages.
- The search is the design's: from the starts over open, door, key and exit cells, a locked cell opening once a cell
  holding its key value under `locks` is reached, every key kept, until nothing more opens; 4 or 8 neighbours on a
  square grid, on a hex grid the 6 at cube distance 1 by its orient and offset (Mark set: hex grid); a link's to cell a
  neighbour of its from cell, and back when `two_way` is 1; a cell on another layer reached only through a link.
- **Every recorded floor is checked**, at any depth; `depths` adds that each depth it lists must have been generated.

### The result: `reach`

The result gains **`reach: {floors, coverage, distinct, flow, search_ms}`**:

- **`floors`**: one per recorded floor: `{run: "bot <b> run <i>", seed, depth, step, hash, reached, unreached,
  nearest}`. **`hash`**: the SHA-256, lowercase hex, of the floor's cells as i32 little-endian, in the array's own order
  (row-major, layer by layer). `reached`: every goal cell and every cell of a class in `every` reached. `unreached`:
  those it didn't reach, each `[x, y]` (order free; `[]` when reached). `nearest`: the reached cell nearest the cell the
  floor's failure names (below), or null when reached.
- **`coverage`**: `{"<depth>": runs}`, for each depth in `depths` and each depth a run generated, the number of runs
  that recorded a floor at that depth (0 for a depth in `depths` none generated).
- **`distinct`**: `{"<depth>": floors}`, the number of distinct floor hashes recorded at that depth.
- **`flow`**: the flow form's failures, one per failing run, `{run, step, cell: [x, y], why}`; `[]` in the reach form
  or when nothing fails.
- **`search_ms`**: the wall time in ms of grid.reach's own searches over all the floors it recorded, its plays left out
  (criterion 5 reads it).

### Failures

- **`grid.unreached`**: one failure per recorded floor with an unreached cell: `test` `bot <b> run <i>`; the message
  starts `grid.unreached:` and names **`seed <s>`**, **`depth <d>`**, **`cell [x, y]`** and **`nearest [x, y]`**, each
  label once (white space inside the brackets free). The cell named is the first unreached goal cell, in the order
  `goals` lists them, or with every goal reached, the first unreached cell of a class in `every`, in row-major order.
  **`nearest`** is the reached cell at the smallest |dx| + |dy| from it (y through the layers), ties to the smaller
  row-major index.
- **A depth in `depths` that no run generated**: a failure, `test` `depth <d>`, whose message starts **`BLOCKED:`** and
  names **`depth <d>`** and **`<n> runs`** (`0 runs`); when nothing else fails, the outcome is **`missing`** (BLOCKED,
  never PASS); with another failure, `failed`.
- **`grid.flow`**: at most one failure per run, at its first failing step: `test` `bot <b> run <i>`; the message starts
  `grid.flow:` and names **`step <k>`** and **`cell [x, y]`**, each label once, and why as a word: `rises`, `solid`,
  `loops` or `unreached`.

### The flow form

- It reads the interface's grid and the arrays `next` and `cost` at every step of each run. **A change is a step whose
  grid differs from the step before's.** Steps c to c + lag − 1 after a change at step c aren't checked; every other
  step is.
- At a checked step, each cell that isn't solid (a class in `solid`) and isn't a target, from which grid.reach's own
  search over cells that aren't solid reaches a target, must have a `next` naming a neighbour that isn't solid (else
  `solid`) and whose `cost` is lower (else `rises`); then each spawn must reach a target by that search and by following
  `next` (else `unreached` or `loops`). **The run's failure is its first checked step with a failing cell or spawn,
  naming the first failing cell in row-major order, cells before spawns.**

### The plug-in's kit for grid.reach

- `packages/checks/playtest/kit.ts` exports **`reachKit(replica: (plant: string | null) => Play)`**: check.kind@1's kit
  for kind `grid.reach`, as `playtestKit` is kind playtest's, and **`reachPieces()`**: the pieces its cases name, by
  name, each `{piece, assets}` (a case names `<name>@1`), as `pieces()` gives the playtest kit's.
- Each of its fills, the reference (`clean()[0]`) and each planted one, has check.kind@1's **`run(spec, ctx)`**:
  grid.reach on `spec.reach` and `spec.play`, its plays through `replica(null)`, its result as `runCheck`'s.
- Its planted fills include **`offset-even`** (a hex grid's neighbours taken by offset even, whichever offset it
  declares) and **`stacked-layers`** (a cell's neighbours also hold the cells stacked above and below it on the other
  layers). **Its fixtures include #1048's 2-layer map without the teleporter's row**, expected to fail grid.unreached
  naming the exit; on `stacked-layers` (which passes it) the kit's case fails with a message naming **`cell [14, 14]`**.

### The replica's plant

- **`DEEP_DRIVE_PLANT=keeps-document-seed`** (the `env-plants` build): a play with `piece_seed: run` keeps the piece's
  own seed, runs and replays alike.

### The budget record

- `benchmarks/budgets.json` gains the task **`playtest-crawler`**: `command: ["node", "benchmarks/canvas.mjs",
  "playtest-crawler"]`, `margin: 0.5`, `targets: {crawler_80_runs_s: 300, legal_added_s: 60, reach_200_floors_s: 1,
  idle_work: 0}`, `limits: {}`, `criteria` naming #556.eb50d272, an `initialReason` naming #556, valid by
  `validateBudgets`; `scripts/lanes.mjs` runs `ac05-budgets.test.ts` as timed (this commit adds that line beside the
  folder's `alone` line).

## Fixtures (`programs.ts`)

- **The clean crawler** is #555's (its `programs.ts`): 3 floors of 32 × 32 from the run's seed, classes open 0, blocked
  1, door 2, locked 3, key 4, exit 5, `locks {3: 4}`, a vault behind one locked cell, its key in a room between; under
  #555's interface (`floor: crawler.depth`, no `ready`) and its descender.
- **The crawler's twins**, #555's own clean text (`crawlerText`) with one change each (a copy whose clean text assembles
  to #555's clean program byte for byte): **walled** reads the seed its init gets and, when it is 0 modulo 50, rings
  each floor's exit room (room R − 2) with blocked cells, and publishes `walled`, this suite's own reading; **vault**
  puts the key inside the vault (room R − 1) in place of a room between. The walled twin's document seed is
  4307912556001750 (runSeed(3556, 87)), a walling seed. #555's **noturn** twin is used as #555 built it.
- **The playtest grid.reach names on the crawler** (criteria 1 and 3): 200 descender runs of 150 steps, check seed 3556,
  `piece_seed: run`, no goals; grid.reach's input `{goals: [exit], every: [open], depths: [1, 2]}`.
- **The flow fixture**: one logic item, 64 × 64, every cell open but a core of 4 exit cells (x 31 to 32, y 31 to 32);
  its field is its own breadth-first search from the core (`cost` the distance, −1 where none; `next` the neighbour of
  lowest cost, ties north, east, south, west, −1 on the core). A slider `wall` entry blocks row 16 from x 16 to 47; the
  clean program refreshes its field 4 steps later. Its policy keys one entry at 10 s, stamped at step 600. **stale**
  never refreshes; **rising**, from step 300, steps (10, 40) west, to a neighbour whose cost is one higher. Spawns: the
  4 corners and 4 edge midpoints.
- **The hex fixture**: 6 × 6, pointy, odd rows shifted; rows 0, 1, 4 and 5 open, row 2 open only at (3, 2), row 3 only
  at (2, 3); the self unit on the start (0, 0); the exit (5, 5). Played by a policy that puts nothing.
- **The map** is #1048's (its `programs.ts`); the **no-teleporter twin** is a copy of its text whose links are a
  parameter, with the gate's row alone (`nlinks` 1), and the copy with both links assembles to #1048's map byte for byte.

## How the fixtures were checked

Before any implementation, on the base's `deep-drive` `play` and this suite's own search (`helpers.ts`), in scratch
files that aren't part of the suite:

- The crawler copy's clean text assembles to #555's clean program; the map copy with both links to #1048's map.
- The run seeds of check seed 3556, i < 200: 200 distinct first floors; this suite's search reaches the exit and every
  open cell on each clean first floor, keys kept. The walled twin walls runs 87, 97, 116, 132 and 146 (5 of 200; its
  flag and the search agree on all 200), its other runs' first floors equal the clean crawler's; run 87's exit is
  (28, 11) and the reached cell nearest it (28, 9). Other check seeds walled 1 (556), 2 (1556, 4556, 5560), 3 (2556)
  and 8 (6556) runs of 200. On walled runs the descender stays on depth 1 for 150 steps.
- The descender's 200 runs of 150 steps: depth 2 first at steps 39 to 107 in every run, depth 3 in 140, so coverage
  reads {1: 200, 2: 200, 3: 140}; the search reaches the exit and every open cell on every floor they record. On the
  walled twin they record 200, 195 and 138 floors at depths 1 to 3, every floor of an unwalled run fully reached and
  every walled floor's first unreached cell its exit.
- The key-in-vault twin's first floors (runs 0 to 5), and the 8 floors its runs 0 to 2 record in 150 steps: the exit
  reached, the key not, and the first unreached open cell behind the locked cell (reached when locked cells count as
  open).
- The flow fixture, 640 steps, the rule of The surface applied here: clean passes at every checked step, and at step 601
  (31, 15) still steps into the wall (none at 604), so the lag is what lets it pass; stale fails first at step 608,
  (31, 15), solid; rising at step 300, (10, 40), rises (cost 29 to 30). No trap.
- The hex fixture as published equals `hexCells()`; by offset odd every open cell and the exit are reached; blocking
  (3, 2) or (2, 3) leaves the exit unreached; by offset even the lower region's 13 cells, the exit among them, are
  unreached.
- The no-teleporter twin publishes links [85, 341, 1, 0, 0, 0], `nlinks` 1; the search reaches every open cell with
  both links, leaves room B's 36 cells (the exit among them) unreached with the gate alone, and reaches them again when
  stacked cells are neighbours.

## Criteria to tests

| ID | Criterion (short) | Test, and the wrong program it fails on |
|---|---|---|
| AC1 #556.9ac3832b | 200 descender runs pass with coverage; walled twin in its runs; key-in-vault twin; depth 4 BLOCKED | `ac01-floors.test.ts`: clean passes, testsRun 200, each run's floors (depth, step, seed) and coverage as this suite's replays find them; walled fails grid.unreached in exactly the 5 walled runs, each naming seed, depth 1, the exit and the nearest reached cell, the floor's unreached cells as the search finds them; vault fails every floor of 3 runs naming the first unreached cell behind the lock; depths [1, 2, 3, 4] read `missing`, BLOCKED naming depth 4 and 0 runs, coverage 4 → 0, verdict BLOCKED. Fails on the base, a check without key-and-door closure, one opening locks without keys, one reading floors no run generated, one passing an unseen depth |
| AC2 #556.92ad8bdf | flow form: clean passes; stale fails at 608; rising names the cell and rises | `ac02-flow.test.ts`: clean passes, no flow failure; stale fails grid.flow at step 608 naming the first cell its own values step into the wall and solid; rising fails at step 300 naming (10, 40) and rises. Fails on the base, a check ignoring the lag or counting it from another step, one checking only grid changes or the last step |
| AC3 #556.abf74c91 | 200 distinct first floors, counted per depth; replays from seed and track; planted play mode | `ac03-seeds.test.ts`: distinct 200 at depth 1 and as many as runs at each depth, each first floor's hash the one its seed's grid has, every run replaying from its seed and track to its hashes (and run 0 not from the document's seed); on `keeps-document-seed` distinct 1, every first floor the document seed's, this criterion's judge failing naming 1, the walled twin failing in all 200 runs. Fails on the base, a play mode keeping the document's seed, a report counting runs not floors |
| AC4 #556.2024793e | hex route through the odd shift; offset-even runner fails naming the exit | `ac04-hex.test.ts`: the fixture's facts by this suite's search; grid.reach passes through the hub and on the kit's reference fill; the kit's `offset-even` fill fails grid.unreached naming [5, 5]. Fails on the base, a check taking 4 neighbours or offset even |
| AC5 #556.eb50d272 | budgets: 80 runs + replays < 5 min, rules.legal < 1 min, grid.reach over 200 floors < 1 s, no work without an interface | `ac05-budgets.test.ts`: idle_work 0 against the bake; grid.reach over 200 floors reports search_ms; the `playtest-crawler` record; on a reference Mac five readings of each within its limit. Fails on the base (no grid.reach, no record) |
| AC6 #556.d8d26095 | map passes; no-teleporter twin fails naming the exit; stacked runner passes it, kit catches it naming the cell | `ac06-layers.test.ts`: the map passes; the twin fails grid.unreached in each run naming [14, 14]; `stacked-layers` passes the twin, the reference fill fails it, and runKit on `stacked-layers` reads FAIL with a case naming [14, 14]. Fails on the base, a check ignoring links or stepping between stacked cells, a kit that admits that runner |
| AC7 #556.cd2aad65 | noturn twin: play.missing naming turn before any run | `ac07-missing.test.ts`: grid.reach and #555's playtest each fail play.missing naming turn, testsRun 0, no call playing a step. Fails on the base, a check that plays before reading the interface |

## Planted twins

| Twin | Where | Criterion | The wrong program, and how the test catches it |
|---|---|---|---|
| walled | `programs.ts` | 1, 3 | walls the exit room on 1 seed in 50: grid.unreached in exactly those runs, naming seed, depth, exit, nearest; under `keeps-document-seed` in all 200 |
| vault | `programs.ts` | 1 | the key inside its own vault: every floor fails naming the vault's first unreached cell |
| depths [1, 2, 3, 4] | the input | 1 | a depth no run generated: BLOCKED naming depth 4 and 0 runs, never PASS |
| stale | `programs.ts` | 2 | never refreshes after the wall: grid.flow at step 608, the first cell stepping into the wall, solid |
| rising | `programs.ts` | 2 | one cell steps up its field from step 300: grid.flow naming (10, 40) and rises |
| `keeps-document-seed` | the replica (env-plants) | 3 | one first floor in 200 runs: the report counts 1, this criterion's judge fails naming it |
| `offset-even` | the kit's planted fill | 4 | neighbours by the other offset: fails the clean hex fixture naming the exit |
| no-teleporter | `programs.ts` | 6 | the teleporter's row removed: grid.unreached naming the exit |
| `stacked-layers` | the kit's planted fill | 6 | stacked cells as neighbours: passes the twin, and the kit fails it naming [14, 14] |
| noturn | #555's `programs.ts` | 7 | no turn array: play.missing naming turn before any run |

## Readings where the issue and design leave a choice

- **How grid.reach names its playtest**: as #1048's rules.legal does, its spec carries the named playtest's input in
  `play` beside its own `reach`, and it plays that playtest's runs.
- **A floor with no `ready`**: #555's crawler declares no `ready` and generates all floors at init, publishing the
  current one as `grid` in the step it gets there, so a floor is read at step 0 and at each step `floor` changes
  (rather than a fixture copy publishing a `ready` array, which would no longer be #555's clean fixture). A piece with
  no `floor` has one depth, 1.
- **Every recorded floor is checked**, at any depth; `depths` adds only the rule that each depth it lists was generated
  ("for each recorded floor"; "a depth the brief lists that no run generated is BLOCKED"). So depth 3's floors are
  checked under depths [1, 2] too.
- **"Reports how many runs generated each depth"** is `coverage`; **"which grid.reach's report counts per depth"**
  (distinct floors) is `distinct`, and each floor's `hash` is what "by grid hash" counts.
- **One failure per floor**, naming one cell: a goal first, so a walled floor names its exit and a vault floor, its exit
  reached, names the first unreached open cell, which is the vault's. **Nearest** is by |dx| + |dy| in the floor's
  coordinates, ties to the smaller index.
- **BLOCKED** is the result's outcome `missing` with a failure starting `BLOCKED:`, as the plug-in's rules.legal reports
  an unrun playtest; the verdict reads it BLOCKED.
- **The flow form at every step**: step 0 is no change, so the rising twin's cell, planted at step 300 with no grid
  change, fails at step 300; one failure per run, at its first failing step. The wall is a policy key at 10 s, which the
  replica stamps at step 600.
- **Run counts where a criterion names none**: the key-in-vault twin 3 runs, the flow fixture 1, the hex fixture 1, the
  map 2, the noturn twin 3. Criterion 1's span is 150 steps (depth 2 in every run, depth 3 in 140), criterion 3 reads
  the same runs; criterion 5's 200 floors are 200 descender runs of 2 steps.
- **The walled twin's "1 seed in 50"** is the seed its init gets modulo 50; on this suite's check seed 3556 that is 5
  of the 200 runs. **The planted play mode** keeps the document's seed for every play with `piece_seed: run`; the walled
  twin's document seed walls, so under it the twin fails in every run (the criterion's "every run or none").
- **"This criterion fails, naming the count"** is this suite's own judge of the report (`distinctFirstFloors`): none
  with 200 distinct first floors, else a failure naming the count, here 1.
- **The offset-even runner and the stacked-layers runner** are the kit's planted fills (as kit.ts plants today), run on
  this suite's fixtures through their check.kind@1 `run`; the kit "catches it" when its fixed part reads FAIL with a
  case naming the cell.
- **Criterion 5**: "compared with the merge base" is the perf lane's record (`playtest-crawler`), which the budget window
  compares with the merge base; "no work per frame" is #184's reading, a piece played with no play interface spending
  the logic module's own bake's fuel at every step; "grid.reach over 200 recorded floors" is its own searches' time,
  `search_ms`, its plays left out; "rules.legal over them adds" is rules.legal's own run over the playtest's 80 runs.

## Not covered (scope with no criterion here)

The codes in the check catalog with their meaning and fix; `deep_kinds`' listing of game.play@1's fields, the bots and
the new kinds; the kit's crawler fixture and its planted twin for each code, and its planted runner that opens locks
without their keys (scope, #68); a game project's build and its hook's start verb; `ready` declared by a piece;
`starts` and `goals` given as cells; 8 neighbours; spawns that fail (`loops`, `unreached`); the flow form's `solid`
other than blocked; play.out_of_range.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `helpers.ts` (the pool, the hub, the kit's replica, the result's
readers and this suite's own search), `programs.ts` (the crawler's twins, the flow fixture, the hex fixture, the map's
copy), and one test file per criterion: `ac01-floors`, `ac02-flow`, `ac03-seeds`, `ac04-hex`, `ac05-budgets`,
`ac06-layers`, `ac07-missing`.
