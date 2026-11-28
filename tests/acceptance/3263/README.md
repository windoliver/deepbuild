# Acceptance tests for #3263: a `grid.reach` need proves what a goal needs, and a route that skips it fails, naming the route

Written first, blind, from issue #3263 ("A reach check proves what a goal needs: with the key, the bridge or the boss
room closed, the exit must be out of reach, and a route that skips it fails, naming the route": its opening paragraph,
Scope, `Runs on:` line, six acceptance criteria and Proof line; it has no comments), the design sections it links and
the base commit a7ae0e804 (its last merge is #3696), by a job that never saw an implementation; none existed, and no
other worktree, branch, pull request, plan or session was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test file per
criterion, with the twins and the one planted check the criteria name.

**Criterion 4 (`#3263.a50d3e46`, `nav.reach`) has no test here**, by the caller's ruling (Not asserted, below): the
suite covers criteria 1, 2, 3, 5 and 6, so the issue stays open on criterion 4.

## What was read

- The issue as saved for this job, and the issues it names or stands under, each as saved with its comments: #219
  (epic), #193 (parent), #556, #271 and #272 (beside it), #183, #3265, #555, #1048, #184 and #415. Its six criteria
  are tagged by `scripts/proof-change.mjs`'s rule (`#3263.` and the first 8 hex of SHA-256 of the text, white space
  collapsed), each ID computed here from the issue's body.
- `docs/canvas-primitives.md`: Check input: `grid.reach`; Check input: `nav.reach`; Play interface `game.play@1`;
  Check input: playtest; Check input: plug-in reads (the catalog's `by: "agent"`). `docs/technical-design.md`: How
  runs become one of five verdicts (the table, Whose checks count, Protection); What done means, fixed at the start
  (Locked); Numbers version 0 has to hold (Every task carries its own budgets, The reference Macs); How we know
  version 0 works (Criteria to tests, Closed issues stay proven, Criteria in a checked shape, Wrong programs, The
  edit guard, Dogfooding, Tests written first, Repo guards). `docs/parallel-proof.md`: Binaries for tests, section
  7 (a suite's own lane file), 7a and 12a (budget windows). `AGENTS.md`, `CONTRIBUTING.md`, `GLOSSARY.md`,
  `docs/adr/0001-code-carries-no-comments.md`.
- At the base, read only for the surfaces these tests use and for what the base does today:
  `packages/checks/playtest` (`reach.ts`, `index.ts`, `kit.ts`, `iface.ts`, `run.ts`, `codes.ts`, `deepbuild.json`,
  `fixtures/reach.json`, two `.wat` fixtures), `packages/checks/README.md`, `packages/checks/test/playtest.test.ts`,
  `packages/checks/catalog/index.ts`; `packages/extension-host/src` (`host.ts`: `runCheck`, `judgeCheck`,
  `deep.canvas.play`, `unplayed`; `plays.ts`; `digest.ts`); `packages/hub/src` (`kinds.ts`, `gate-runner.ts`'s
  `verdictOf`, the head of `approved-spec.ts`); `packages/contracts/src/canonical.ts`. The suites
  `tests/acceptance/3265` (all of it), `556` (README, `helpers.ts`, `programs.ts`, `ac01`), `556-redraft-ac5` (all
  of it), `184` (`helpers.ts`, `ac09`), `533/helpers.ts` (its exports), `555` (`helpers.ts`, `programs.ts`, the
  README's crawler), `3225` (`ac7-budget.test.ts`, `lane.json`, its README's budget lines), `1515` and `1518` (their
  budget tests), `33/edited-assertion.test.ts`, the head of `3466/README.md`. `benchmarks/budgets.json` (the playtest
  tasks), `benchmarks/playtest.mjs`, `benchmarks/canvas.mjs` (its judge), `scripts/benchmark.mjs` (`judgeLimit`,
  `validateBudgets`, `judgeTargets`), `scripts/proof-change.mjs` (`TAG`, `tagsIn`, `isTestFile`, `spans`,
  `tagsWithImports`), `scripts/proof-runs.mjs` (`prepareRuns`), `scripts/lanes.mjs` and `scripts/lanes-lists.mjs` (how
  a lane file is read), `scripts/wait-ratchet.mjs`, `scripts/repo-rules.mjs` (its patterns), `scripts/throttle.mjs`
  (its head).

What the base does, which these tests don't credit: `grid.reach` reads no `needs`, so the twin whose opened wall lets
a route skip the key passes, a floor with no key cell passes, and a need marked as the working agent's passes; its kit
plants no check that closes one class; its manifest lists no `grid.skipped`; no task of `benchmarks/budgets.json`
names this issue's budget criterion. What it already does, which they rely on: #184's replica, #556's `grid.reach`
with its result (`floors`, `coverage`, `distinct`, `search_ms`), `grid.unreached` and the kit, #3265's INCONCLUSIVE
(`uncounted`), the extension host's `runCheck`. At this base the plug-in's manifest holds its files' digest (checked
by this job's own copy of `packageDigest`, in a scratch file, and then by the base run, in which every file's hub
installed the folder), so the hub installs the folder as it ships and this suite opens #556's hub unchanged.

**What has run.** Each test file once on the base, under a test grant (BASE-FAILURE.txt): six tests, each failing
at an assertion it names for the reason its criterion gives, none at load; `ac01` ran a second time after its
assertion's message gained the twin's floors. No implementation existed, so nothing past each failing assertion has
run on a check: no route, INCONCLUSIVE or refusal was read from a real result, the planted check wasn't run, and the
budget's gate and five readings weren't reached. Those parts rest on the judges' own run on planted results
(Criteria to tests, below) and on one probe of the base, since deleted: the kit's reference fill and its
`opens-locks` fill each played this suite's two-room piece through the kit's replica and passed.

## Run them

```sh
npm ci                          # once, in a fresh worktree
npm run build --workspaces      # once, as #556's suite has it
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs test --wait 60 -- npx vitest run --root tests/acceptance/3263 --testTimeout=600000 --no-file-parallelism ac01-locked-door.test.ts
```

and the same line for `ac02-two-rooms.test.ts`, `ac03-no-key-and-walled.test.ts`, `ac05-edited-need.test.ts` and
`ac06-budget.test.ts`; with no file named, the whole folder. Then:

```sh
npx tsc -p tests/acceptance/3263/tsconfig.json
rm -rf tests/acceptance/3263/node_modules/.vite
```

Every test passes its own timeout (#556's 90 minutes; the budget's twice that) above `--testTimeout`.

What each file needs: the packages' `dist` (the build above), and three builds its helpers start themselves, each
once a file and honoring `CARGO_TARGET_DIR`: `deep-drive` debug with `env-plants` (#184's helper: `cargo build
--locked -p deep-replica --bin deep-drive --features env-plants`), `deep-logic` (#533's: `cargo build --locked --bin
deep-logic`, for the layout probe) and #533's assembler from a copy (#555's, into `target/acceptance-555-wat`).
`ac06-budget.test.ts` builds nothing else: what it times is the plug-in's own search, in the hub's process, and its
replicas (debug) only record the floors. With the binaries built, on the base at a load near 18: files 1, 2, 3 and 5,
which play a few two-step runs each, took 5 to 12 s each, the assembler's build from its copy among it (62 s when
that build was cold); file 6, which plays 400 one-step runs of the crawler on two debug replicas, took 7 s up to its
record. On an implementation each file runs past the assertion the base stops it at, a few more two-step runs; on a
reference Mac at rest file 6 plays 1,000 more one-step runs.

The folder runs alone by its own `lane.json`, reason `timing`: `ac06-budget.test.ts` calls the perf lane's
`judgeLimit` and is named as timed there; every file builds binaries into this checkout's `target/` and starts
replicas and a hub. Nothing of it is in `scripts/lanes-lists.mjs`.

Gates. Off macOS every test fails `INCONCLUSIVE:` first thing (the replica's binaries exit on any other OS), never a
pass. Cargo that can't run is `BLOCKED:`. A missing binary, a hub that doesn't install the plug-in, a result without
`reach`, a failure without what a test reads in it, each fails its test, naming what is missing. The budget's five
readings are judged only where `judgeLimit` given five zero readings against 1 reads PASS (a reference Mac on mains
power, Low Power Mode off, thermal state nominal, the load under the cores); anywhere else the file fails
`INCONCLUSIVE:` with that rule's reason, after every part that doesn't depend on the machine has passed, and is
never retried. No test waits for time: no timer, no sleep, no clock read. Folders are temporary and deleted;
processes are #184's helpers' children, stopped by PID.

## The surface

The issue names, and this suite takes as given: `needs: [{goal: cell | class, through: [cell | class]}]` in
`grid.reach`'s input; the code `grid.skipped {run, seed, depth, goal, route}`; a need INCONCLUSIVE on a floor with no
cell of a `through` class; one `grid.unreached` and no need judged where the plain search doesn't reach the goal; a
planted check that closes only the first class listed; a run refused when the working agent's session edited a need;
200 floors of 32 × 32 with four needs under a second. #556's and #3265's surfaces (their READMEs: The surface) stay
as they are: the hub's `runCheck('grid.reach', spec)` with the check's own input in the spec's `reach` and the named
playtest's in `play`, the result's `reach`, a failure's `test` and `message`, the kit.

**Every name below marked yours is this job's choice where the issue and the design leave one open**, the least the
criterion needs. The implementer builds exactly these, or a dispute goes to a blind redraft.

### The input

`needs` sits in the spec's `reach`, beside `starts`, `goals`, `every` and `depths`. A `goal` or a `through` entry is a
class name of the play interface or a cell `[x, y]`, as `goals` spells them. One well-formed spec (criterion 1's):

```json
{ "kind": "grid.reach", "runner": "deep.canvas.play", "inputs": [], "depth": "journey", "oracle": "code", "contract": null,
  "reach": { "playtest": "R-floor", "starts": [[1, 4]], "goals": ["exit"], "every": ["open"], "depths": [1],
             "needs": [{ "goal": "exit", "through": ["key"] }] },
  "play": { "piece": "<doc>@1", "play": { "grid": { "cells": "level.cells", "size": [9, 9], "shape": "square", "moves": 4, "floor": "level.depth",
              "classes": { "open": [0], "blocked": [1], "door": [2], "locked": [3], "key": [4], "exit": [5] }, "locks": { "3": 4 } } },
            "bots": [{ "policy": {} }], "runs": 2, "seed": 3263, "span": { "steps": 2 }, "goals": [], "frames": { "every": 0 } } }
```

The tests give `through` as one class (`["key"]`, `["door"]`), two classes (`["door", "key"]`) and a class with a cell
(`["key", [4, 3]]`), and `goal` as a class (`exit`; in the budget `key` and `locked` too).

- **Yours: `by: "agent"` on a need**, `{"goal": "exit", "through": ["key", [4, 3]], "by": "agent"}`: the need is one
  the working agent's session wrote or edited, as a bot's `by: "agent"` says of a bot (#184) and a catalog input's
  of its roots (#194). A need without it is the brief's or the definition's.

### A pass

The outcome `passed`, no failure, `testsRun` the runs it read, and `reach.floors` one a recorded floor, each
`reached: true` (#556's result). A need that holds on every floor adds nothing to the result.

### `grid.skipped`

A floor on which a need's goal is still reached with its `through` cells closed fails the check: the outcome is
`failed`, and the result holds **one failure for that floor and need** whose

- `message` starts `grid.skipped`;
- run is named: its `test` is the run, `bot <b> run <i>`, as `grid.unreached`'s is, or its message holds those words;
- message names **`seed <s>`**, the run's seed, hash(the check's seed, i), and **`depth <d>`**, the floor's depth;
- message names the goal's cell as **`goal [x, y]`** (yours: the label; white space inside the brackets is free);
- message names the route as **the cells `[x, y]` that follow its last word `route`** (yours), in order from a start
  to the goal. Any separator stands between two cells (`[1, 4] [2, 4]`, `[1, 4] → [2, 4]`, `[[1,4],[2,4]]`), and no
  cell that isn't the route's follows that word.

The rest of the wording is free. A well-formed failure (criterion 1's twin, run 0):

```
test:    bot 0 run 0
message: grid.skipped: bot 0 run 0 (seed 8640247471194106), depth 1, step 0: goal [7, 4], exit, is reached with key closed, by the route [1, 4] [2, 4] [3, 4] [3, 3] [4, 3] [5, 3] [5, 4] [6, 4] [7, 4]
```

What holds the cells to be a route (`judges.ts`, `routeWrong`): the first is one of the input's `starts`; the last is
the goal's cell; each next cell is one of the 4 neighbours of the one before; and every cell is one this suite's own
search stands on with the need's `through` cells closed, so none is a closed cell, a wall, or a locked cell whose key
that search can't reach. No particular route is held. The floor's other judgement stands beside it: `reach.floors`
still lists the floor `reached: true` with `unreached: []`, and no other failure is reported for it.

The plug-in's manifest (`packages/checks/playtest/deepbuild.json`) lists `grid.skipped` in `codes`, as it lists
`grid.unreached`, `grid.same` and `grid.flow`.

### INCONCLUSIVE

A need none of whose `through` entries names a cell on a floor is INCONCLUSIVE there: when nothing fails and no
listed depth is unseen, the outcome is **`uncounted`** (what #3265's single-seed depth reports, which `judgeCheck`
reads INCONCLUSIVE and the verdict engine never counts), with a failure whose `message` starts **`INCONCLUSIVE:`** and
names the floor and the class: the run (its `test`, or the words `bot <b> run <i>` in the message), **`seed <s>`**,
**`depth <d>`** and the class's name as a word (`key`). One failure a floor, or one that names every such floor,
both read. A well-formed one:

```
test:    bot 0 run 1
message: INCONCLUSIVE: bot 0 run 1 (seed 1430125455624297), depth 1, step 0: the floor holds no key cell, so the need {goal: exit, through: [key]} closes nothing there
```

### A goal the plain search doesn't reach

Stays as the base reports it (#556): one `grid.unreached` failure for the floor, its `test` the run, naming `seed
<s>`, `depth <d>` and the goal as `cell [x, y]`. The floor's needs add no failure of any kind: the result holds one
failure a floor and none that starts `grid.skipped`.

### The planted check (yours: its name)

`reachKit(replica).planted` (the plug-in's `kit.ts`, #556's surface) holds a fill named **`closes-first`**, beside
`opens-locks` and `previous-run`: it is `grid.reach` but that a need closes only the cells of the first entry its
`through` lists. A test reaches it as #3265's reaches `previous-run`: `fillOf(kit, 'closes-first')` and the fill's
check.kind@1 `run(spec, ctx)`, its plays through the kit's replica. On the two-room floor with `through: ["door",
"key"]` it must fail `grid.skipped` on each floor, naming a route through the room of class `key`, where the kit's
reference fill (`clean()[0]`) and the hub's `grid.reach` pass.

### A need the working agent's session edited

Through `runCheck`, a run whose `needs` hold a need with `by: "agent"` is refused: its outcome is **not `passed`**
(which outcome is free), and a failure's message holds the word **`refused`** and names the edited need by its goal
and each class of its `through`, each as a word (here `exit` and `key`; how a `through` cell is written is free). When
it is refused, before any run or after, is free. A well-formed one:

```
outcome: failed, testsRun 0
message: refused before any run: the need {goal: exit, through: [key, [4, 3]]} is the working agent's (by: agent); a need comes from the brief or the definition
```

### The time budget

- **The record**: `benchmarks/budgets.json`'s task **`playtest-crawler`** names **`#3263.530bc8ce`** in its
  `criteria`, beside #556's, and keeps its target **`reach_200_floors_s: 1`**; the perf lane's `validateBudgets` takes
  the file. A task's `criteria` aren't frozen (`scripts/benchmark.mjs`, `definition`), its targets are, so this is
  the one line the record needs.
- **The reading**: `reach.search_ms` (#556's field), the time in ms of the check's own searches over the floors it
  recorded, the needs' searches among them, its plays left out.

## Fixtures (`floors.ts`, `programs.ts`)

Five floors of 9 × 9, each one logic item, `level`, whose `init` writes the drawn cells to `level.cells` and 1 to
`level.depth` and whose step changes nothing: WebAssembly text assembled by #533's assembler (#555's helper builds it
from a copy), its write offsets from `deep-logic check` of a probe, as #3265's generators are. A fixture floor is a
floor a playtest's run recorded: each is played by 2 runs of 2 steps of a policy that puts nothing, check seed 3263,
under one interface (the grid above: 4 moves, `floor: level.depth`, #555's class values, `locks {3: 4}`), so
`grid.reach` reads it at step 0 of `bot 0 run 0` and `bot 0 run 1`, depth 1, and it never reads a floor no run
generated. The piece keeps its own seed (`piece_seed` left out): both runs record the same floor, each under its own
run seed. Every test first holds the drawn floor to what its criterion says of it, by this suite's own search
(`floors.ts`: breadth-first over open, door, key and exit cells by 4 neighbours, a locked cell opening once a cell
holding its key is reached, a set of closed cells never entered), and then holds the piece to publish exactly the
drawn cells (its own one-step play, outside the hub).

`#` blocked 1, `.` open 0, `d` door 2, `L` locked 3, `k` key 4, `E` exit 5; `S` is the start `[1, 4]`, an open cell
given as `starts`; x runs right from 0, y down from 0. The exit is `[7, 4]` on every floor.

```
locked (criterion 1)      opened (its twin; 1, 5)   rooms (criterion 2)
  012345678                 012345678                 012345678
0 #########               0 #########               0 #########
1 #...#...#               1 #...#...#               1 #..ddd..#
2 #...#...#               2 #...#...#               2 #.#ddd#.#
3 #...#...#               3 #.......#               3 #.#ddd#.#
4 #S..L..E#               4 #S..L..E#               4 #S#####E#
5 #...#...#               5 #...#...#               5 #.#kkk#.#
6 ##d######               6 ##d######               6 #.#kkk#.#
7 #.k.#####               7 #.k.#####               7 #..kkk..#
8 #########               8 #########               8 #########

nokey (criterion 3)       walled (criterion 3)
  012345678                 012345678
0 #########               0 #########
1 #...#...#               1 #...#...#
2 #...#...#               2 #...#...#
3 #...#...#               3 #...#..##
4 #S..d..E#               4 #S..L.#E#
5 #...#...#               5 #...#..##
6 ##d######               6 ##d######
7 #...#####               7 #.k.#####
8 #########               8 #########
```

- **locked**: the exit lies behind the locked door `[4, 4]`; the key `[2, 7]` is in a side room behind the door `[2,
  6]`. This suite's search: the exit and every open cell are reached; with the locked door closed, or the key closed,
  the exit is not; with the side room's door closed the key is not.
- **opened**: locked with one cell changed, the wall cell `[4, 3]` beside the locked door, open. The exit is reached
  with the key closed, and not with the key and `[4, 3]` closed, so every route that skips the key crosses `[4, 3]`.
- **rooms**: a north room of 9 cells of class `door` and a south room of 9 cells of class `key`, between a west and
  an east corridor; no locked cell, so a key cell here is a cell like any other. The exit is reached with either
  room closed, and not with both.
- **nokey**: locked with the locked door a plain door and no key: the exit and every open cell are reached, and no
  cell is of class `key`.
- **walled**: locked with the exit's three open neighbours blocked: the exit is unreached, every open cell reached,
  and the key is there to close.

**The budget's floors** are #555's crawler's (its `programs.ts`, read only; the plug-in's kit fixture and
`benchmarks/playtest.mjs`'s `reach_200_floors_s` use the same): 200 descender runs of one step, check seed 3263,
`piece_seed: run`, so 200 floors of 32 × 32, one a run at step 0, depth 1, each from its own seed; the start is the
self unit's cell. Its input: `goals: [exit, key, locked]`, `every: [open]`, `depths: [1]` and four needs,
`{exit, [door]}`, `{key, [door]}`, `{locked, [door]}` and `{locked, [key]}`. The crawler's rooms are joined in a chain
by corridors whose ends are doors, the hero starts in the first, the key lies in a room past it, the exit in the
last room before the vault, and the vault's entrance is the locked cell; so each need should hold on every floor.
The test doesn't take that from this paragraph: it reads the 200 floors by its own one-step plays and holds, by its
own search, that on each floor each need's goal is reached, its `through` class has cells, and its goal is unreached
with them closed.

## Criteria to tests

| ID | Criterion (short) | Test, and the wrong program it fails on |
|---|---|---|
| AC1 `#3263.07996a8a` | the locked 9 × 9 floor passes `needs: [{goal: exit, through: [key]}]`; its twin with one wall cell beside the door opened fails `grid.skipped`, naming the run, the seed, the exit and a route across the opened cell; the twin passes every other criterion, and that run is shown | `ac01-locked-door.test.ts`: locked passes with the need; opened passes with no needs; opened with the need is `failed`, each run's floor with one `grid.skipped` naming the run, its seed, depth 1, `goal [7, 4]` and a route that holds `[4, 3]`, nothing else failing and both floors still `reached`; the manifest lists the code. Fails on the base (the twin passes), a check that closes nothing or opens the lock without its key, one that names the check's seed, another cell, no route, a route through the key, the lock or a wall, or one that marks the floor unreached |
| AC2 `#3263.df7081dd` | a floor whose exit is reached through either of two rooms passes with both rooms' classes in `through`, fails with one, naming a route through the other; a planted check that closes only the first class listed finds that route with both named and fails this test | `ac02-two-rooms.test.ts`, two tests. Hub: `[door, key]` passes; `[door]` fails `grid.skipped` on each floor with a route through the key room, `[key]` with one through the door room. Planted: `closes-first` on `[door, key]` fails `grid.skipped` on each floor with a route through the key room, this criterion's judge of the pass (`passedWrong`) faults it, and the kit's reference fill and the hub pass the same spec. Fails on the base (one class passes; the kit plants no `closes-first`), a check that closes only the first or only the last class, one that closes every room whatever `through` says, a kit whose planted check passes |
| AC3 `#3263.d8cd5e67` | a floor with no key cell reads the need INCONCLUSIVE, naming the floor and the class; a floor whose exit is walled in fails `grid.unreached` once, and the result holds no `grid.skipped` for it | `ac03-no-key-and-walled.test.ts`, one test, two floors. walled first: `failed`, each run's floor with exactly one failure, `grid.unreached` naming `cell [7, 4]`, and the result with one failure a floor and no `grid.skipped`. Then nokey: `uncounted`, each run's floor named by an `INCONCLUSIVE:` failure with its run, seed, depth 1 and `key`, nothing else reported, the verdict never PASS. Fails on the base at the no-key floor (it passes there), on a check that passes or fails a need with nothing to close, on one that names no floor or no class. The walled half passes on the base, as behavior that must not change, which is why it shares the test: a tagged test that passes on the merge base proves nothing in the before lane. It fails on a check that reports the unreached goal a second time through its need, as `grid.skipped`, `grid.unreached` or INCONCLUSIVE (shown on planted results, below) |
| AC4 `#3263.a50d3e46` | `nav.reach`: a bridge, a drop link, `kinds: [walk]` | none: Not asserted, below |
| AC5 `#3263.a31661e1` | a run in which the working agent's session edited a need is refused, as any change to a check is | `ac05-edited-need.test.ts`: on opened, the need `{exit, [key, [4, 3]]}`, which closes the opened cell too, passes as a definition gives it; with `by: "agent"` the run is not `passed`, and a failure says `refused`, naming `exit` and `key`. Fails on the base and on any check that takes the edited need as the brief's (both pass the run) |
| AC6 `#3263.530bc8ce` | budgets, drafted, on the reference Mac in the local preflight: 200 floors of 32 × 32 with four needs stay under a second | `ac06-budget.test.ts`, one test in parts: the crawler's 200 floors are what the needs judge (own plays, own search); `grid.reach` passes them with the four needs, 200 floors, and reports `search_ms`, printed as a reading with the load; the record names the criterion; then, only where `judgeLimit` can judge, five more readings against 1 s. Fails on the base (the record doesn't name the criterion), a check with no `search_ms`, one that fails or can't judge the needs on these floors, and on a reference Mac at rest a search over 1 s in all five readings by more than the margin. Elsewhere it ends `INCONCLUSIVE:`, never a pass |

Every judge in `judges.ts` was run in phase 1 as a plain node script on a result of the shape it must pass and on
planted wrong results (78 cases): each passes the good one and fails each wrong one, naming what its criterion
names. The walled floor's judges fail on a result with `grid.unreached` twice for a floor, with an INCONCLUSIVE or a
`grid.skipped` beside it, with a third failure, with another cell named, and on a pass.

## Readings where the issue and design leave a choice

- **How a fixture floor reaches the check.** As a piece a playtest's runs play (Fixtures), never as a floor handed
  to the check: "check a floor no run generated" is on its can-never line. Two runs, so "naming the run, the seed"
  has two runs to tell apart, and every judge reads one floor at a time.
- **One failure a floor and need.** Each fixture's need has one goal cell, and "one need adds one search a floor":
  the judge wants exactly one `grid.skipped` for a run's floor. A need whose goal is a class of several cells isn't
  played.
- **Where a route is read: the failure's message.** The criteria say the failure names the run, the seed, the exit
  and a route, and #556's and #3265's readers read what a failure names in its `test` and `message`. The Scope's
  `{run, seed, depth, goal, route}` gives the labels: `seed`, `depth` and `goal` as #556 reads `seed`, `depth` and
  `cell`; `route` followed by its cells. The Scope lists `depth`, so the judge reads it though criterion 1's sentence
  doesn't. No field of the result is read for it: the issue names none, and one reading is enough.
- **What makes it a route**: see `grid.skipped`, above. "A route that crosses the opened cell": the route holds `[4,
  3]`. "A route through the other": it holds a cell of the other room's class (and none of the closed one, which any
  route must).
- **"The twin passes every other criterion of `grid.reach`, and that run is shown."** The test holds the twin's
  pass with no `needs`, and, with the need, that nothing but `grid.skipped` fails and each floor is still `reached`.
  The run shown is the base's own: BASE-FAILURE.txt holds the base's result for the twin with the need, a pass.
- **"Both rooms' classes."** A class is one of the play interface's six, and `through` names one by its name, so
  each room's cells are of a class of their own: `door` and `key`, the two passable classes besides open and exit.
  "Fails with one" is held for each of the two.
- **"A planted check that closes only the first class listed"** lives in the plug-in's kit, as `opens-locks` and
  #3265's `previous-run` do (design: Wrong programs; the playtest's "each with a planted twin in its conformance
  kit"), under no environment variable. "Finds that route with both named": on `[door, key]` its failure names a
  route through the key room. "Fails this test": the judge that holds the floor to pass finds fault with its result.
- **"Naming the floor and the class."** A floor is its run, seed and depth (the Scope's fields); the class is the
  `through` class with no cell there. INCONCLUSIVE is the base's own: the outcome `uncounted` and a failure starting
  `INCONCLUSIVE:` (#3265, #832).
- **"Fails `grid.unreached` once, and the result holds no `grid.skipped` for it"**, with the Scope's "stays one
  failure … and its needs aren't judged": exactly one failure for the floor, of any kind.
- **Criterion 5.** What the base does with a check the working agent changed: a write to a definition's drafted
  check or to the approved file is guarded and the claim is judged on the approved bytes (Protection, Locked;
  `approved-spec.ts`); an approved check whose own files the claim changed counts as the agent's own and can't pass
  the claim (`gate-runner.ts`, #33); and a check input that says `by: "agent"` makes its check the agent's own
  (`playtestSource`, `catalogSource`; #184, #194). At the base a `grid.reach` check reaches none of the first two:
  the hub routes no definition to it (`packages/hub/src/kinds.ts`, `PLUGIN_KINDS` holds `playtest` and the catalog
  kinds). So the reading taken is the third surface, the one a test can drive: the need carries `by: "agent"`, and
  the check's run (GLOSSARY: one execution of one check) is refused through `runCheck`. "Refused" is held as #3265
  holds its refusal, less its timing: not `passed`, a failure that says `refused`, naming the need. Left: the hub's
  guard and gate on a definition that holds a `grid.reach` check, which needs the hub to route the kind; who marks
  the need; and INCONCLUSIVE with one ask, as a bot the agent wrote reads (#184), since the criterion says refused.
  The edit played is the one that would turn the twin's failure into a pass: the opened cell added to `through`.
- **Criterion 6.** "On the reference Mac in the local preflight" is met by a budget window's record for the commit
  once a task of `benchmarks/budgets.json` names the criterion (`docs/parallel-proof.md`, 12a, Reading rule), so the
  test holds that record: the task that already times `grid.reach`'s own searches over 200 crawler floors against 1
  s names this criterion too. No new task, target or judge. The test's own readings follow #556's redraft and
  #3225: through the hub, `reach.search_ms / 1000`, a warm-up reading (the one printed) and five more, judged by the
  perf lane's `judgeLimit` against the record's 1 s, FAIL failing and anything but PASS `INCONCLUSIVE:`. Outside a
  reference Mac at rest they are readings and the test ends `INCONCLUSIVE:`; a window's record is the result. The
  build: no binary is timed, the search runs in the hub's process, so the replicas stay debug. The four needs and
  the 200 floors are the fixture's (Fixtures); every need's goal is listed in `goals`, so no reading of an unlisted
  goal is taken. **"One need adds one search a floor" is not asserted as a count: no surface gives one**
  (`reach.search_ms` is a time), and the test adds none.

## Not asserted (scope with no criterion here)

- **Criterion 4, `#3263.a50d3e46`, and the Scope's `nav.reach` line** (`needs: [{start, goal, through: [box | item
  ID]}]`, `nav.skipped`): they wait for #183 and #271, with #272. At the base `nav.reach` is a name
  (`crates/deep-canvas/src/registry/check_kinds.rs`) and a design section: no check, runner, job or fixture of it is
  in the tree, no navigate job bakes a graph and nothing searches one (searched here: `nav.reach` and `nav.skipped`
  occur in the two design docs, that registry row, a doc comment in `crates/deep-canvas-physics/src/backend.rs`, and
  two other suites' text). A world fixture, a baked graph, `kinds` and a drop link are those three open issues' to
  define in suites of their own; a test written here would fix their surfaces from this issue. By the caller's
  ruling this suite holds no test tagged `#3263.a50d3e46` and nothing that plays or stands in for a graph, so the
  issue stays open on that criterion.
- A `goal` given as a cell; a need whose goal is a class of several cells; several needs failing on one floor; a
  `through` that names `locked` or `open`; two locks; hex grids, 8 moves, layers and links; `needs` with the flow
  form or with `differ`.
- What a check reads when one floor passes its need and another reads it INCONCLUSIVE, or one fails beside it, or a
  listed depth is unseen beside it: only the base's own order of outcomes says, and no criterion.
- When an edited need is refused, and with which outcome; who marks a need as the working agent's; the hub's guard
  on a definition's drafted check.
- The count of searches (criterion 6, above); that the task's own command, `node benchmarks/canvas.mjs
  playtest-crawler`, gives `grid.reach` four needs: this suite doesn't run it (it builds release binaries and plays
  80 runs of 4,000 steps), and a window's record is that command's.
- The kit's own fixture that catches `closes-first` (the folder's test, `packages/checks/test/playtest.test.ts`,
  holds every planted fill to one); the code's meaning and fix in `codes.ts`; the design's Fields and Codes lines.
- The Scope's last line, what is not in this task: routes a body's physics allows and the graph doesn't hold, a
  limit on jumps or on time, any search in the piece's own code.

## What the implementer adds outside the folder

- `packages/checks/playtest/deepbuild.json`: `"grid.skipped"` in `codes`, and `digest` set to the folder's
  `packageDigest` once its files are final. Every test installs the folder as it ships, so a stale digest fails each
  of them at the hub's install, naming both digests.
- `benchmarks/budgets.json`, task `playtest-crawler`: `"criteria": ["#556.eb50d272", "#3263.530bc8ce"]`. Nothing
  else of the task changes; its numbers are frozen.
- Nothing in `scripts/lanes.mjs` or `scripts/lanes-lists.mjs`: the suite's own `lane.json` says the folder runs
  alone and names `ac06-budget.test.ts` as timed, and lands with the suite.
- Nothing for criterion 4.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json` (#3265's), `lane.json`, `floors.ts` (the five drawn floors
and this suite's own search; it imports nothing), `judges.ts` (the readers of a failure's message and each
criterion's judge; it imports `floors.ts` alone, so plain node runs it), `programs.ts` (the pieces, the interface and
the inputs), `helpers.ts` (the hub, a piece's own play), and one test file per criterion drafted:
`ac01-locked-door`, `ac02-two-rooms`, `ac03-no-key-and-walled`, `ac05-edited-need`, `ac06-budget`. Imports: Node
built-ins, vitest, and the helpers the nearest suites already import for the same things: #556's `helpers.ts` (the
pool, the hub, `runCheck`, `reachSpec`, the kit and its fills, a suite's own play), #184's (`judge`, `none`, the
perf lane's tools), #533's (`checkCall`, `onLogic`) and #555's `programs.ts` (the crawler). No file holds a comment.
