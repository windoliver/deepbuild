# Acceptance tests for #555: the play interface, first-party bots and outcome bands

Written first, blind, from issue #555 ("Play interface: game.play@1 locked in the brief, first-party bots and outcome
bands counted through replay": its Scope, Fields, 4 acceptance criteria and Proof line), its Oracle page, the design
sections it names and the base commit 1ab891283 ("Merge pull request #2597 …"), by a job that never saw an
implementation; none existed, and no other worktree, branch, pull request, plan or session was read. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
Lean: one test file per criterion, with the planted twins each criterion names in its own file.

## What was read

- The issue, live (`gh issue view 555 --repo windoliver/deepbuild --comments`; no comments).
- Its Oracle page (`doneright/oracles/issues/555.md` in DeepBuildAI/deepbuild, branch `doneright`): one upstream test,
  for criterion 1, from an upstream game library's basic tests: seeded random play that picks only listed legal
  actions, and a state rebuilt from the history that must equal the one played. Its rule is ported into criterion 1's
  test (each first-party bot's entries are listed rows' entries; each run's track replays to the same hashes); no
  upstream code is copied.
- `docs/canvas-primitives.md`: Check input: playtest; Play interface `game.play@1`; Check input: `rules.legal` (only to
  see what this task leaves to #1048); The closed function list; Control: actions, key repeat and gamepads; Control:
  point; Control: picks on rows and grid focus; Input track entries; Units and axes.
- `docs/technical-design.md`: Checks for work beyond code (the Playtest bullet); Dogfooding. AGENTS.md.
- At the base, read only for the surfaces these tests use: `tests/acceptance/184` (its README's surface, `helpers.ts`,
  `programs.ts`, three test files) and `tests/acceptance/184-redraft-ac7-2` (the owner's ruling on "before any run"),
  `tests/acceptance/533/helpers.ts` (the assembler, `deep-logic check`); `packages/checks/playtest` (every file);
  `packages/extension-host/src/host.ts` (`deep.canvas.play`, the validator); `crates/deep-logic` (`play.rs`,
  `track.rs`, `point.rs`, `piece.rs`'s control slots, `world.rs`'s read region and write region, `lib.rs`'s calls);
  `crates/deep-replica/src/drive/play.rs`; `crates/deep-canvas/src/grammar/unit.rs` (the units the canvas names);
  `scripts/proof-change.mjs` (criterion tags), `scripts/lanes.mjs`, `scripts/throttle.mjs`; `.cargo/config.toml` and
  `tests/acceptance/533/wat` (why its assembler won't build `--locked` in place).

What the base does, which these tests don't credit: the playtest plug-in exports no `lockPlay` and reads no `play`
field, no goal expression, no `share` or `expect`; its bot slot (`bots.ts`) registers no first-party bot; `deep-drive`'s
`play` takes only a policy or a logic bot, a policy's values only as numbers, and no `play` field. What it already does,
which the tests rely on: `deep-drive`'s `play` plays the crawler from a seed, `piece_seed: run`, a span in steps and a
track of point and number entries; the plug-in replays each run's track without its bot; the host's `deep.canvas.play`
and its validator (#184).

## Run them

```sh
npm ci                          # once, in a fresh worktree
npm run build --workspaces      # once
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/555 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/555/tsconfig.json
rm -rf tests/acceptance/555/node_modules/.vite
```

Every test passes its own timeout (90 minutes) above `--testTimeout`. The builds, each once a file and honoring
`CARGO_TARGET_DIR`: `deep-drive` debug with `env-plants` (#184's helper: `cargo build --locked -p deep-replica --bin
deep-drive --features env-plants`), `deep-logic` (#533's helper: `cargo build --locked --bin deep-logic`, for the
layout probe), and #533's assembler (`tests/acceptance/533/wat`, read only) built by this suite's `helpers.ts` from a
copy outside the repo into `target/acceptance-555-wat`. At the base the repo's `.cargo/config.toml` patches have
outgrown that crate's lockfile, so `cargo build --locked` of it in place fails with "cannot update the lock file"; the
copy's lock leaves out its `[[patch.unused]]` entries, which name only the repo's patches, and builds `--locked` with
every package at its locked version. **The folder is in `alone` in `scripts/lanes.mjs`**: its files start replicas and
a hub and play the crawler.

Gates. Off macOS every test that plays fails `INCONCLUSIVE:` first thing (the replica's binaries exit on any other
OS), never a pass; the lock's test (criterion 4's first) plays nothing and runs anywhere. Cargo that can't run is
`BLOCKED:`. Nothing depends on time or load: every outcome rests on the replica's steps and values. Folders are
temporary and deleted; processes are #184's helpers' children, stopped by PID.

Time. A 4,000-step play of the crawler took 0.15 to 0.2 s in a debug replica on this Mac under heavy load, and a
full run plays about 370 of them (criterion 1's 80 runs, their 80 replays and this suite's 60 replays of the
first-party runs and 20 one-step plays; the twins' 3 × 40; criterion 4's 2 × 12; criterion 3's contrast, 4), so with
the binaries built a full run should take a few minutes plus whatever the plug-in's bots and host add (estimate; the
suite can't run before the implementation). A cold `deep-drive` build took about 9 minutes here.

## The surface

The issue and the design name `game.play@1`'s fields, the bots and their fields, `share`, `expect`, goals as
expressions, spans in steps, and the codes `play.missing`, `play.out_of_range`, `playtest.band` and `playtest.expect`.
They leave open how the brief locks an interface, how a declared name carries its unit and range, how a policy names
an action, what the replica plays for a first-party bot, and the failures' words. **Every name below that the issue or
the design doesn't give is this job's invention**, the smallest the criteria need; the implementer builds exactly
these, or a dispute goes to a blind redraft. #184's surfaces (its README: The surface) stay as they are.

### Locking the interface: `lockPlay`

- `packages/checks/playtest/index.ts` gains the named export **`lockPlay(play)`**: given a `game.play@1` as JSON, it
  returns the interface as locked (a JSON value), or throws (or rejects with) an Error whose message names each
  refusal. This suite always passes the value `lockPlay` returned as the playtest input's `play`.
- A declared name is an array path (`crawler.hp`) or **`{name: <array path>, unit?: <unit>, range?: [min, max],
  step?: <number>}`** (the issue's `unit`, `range` and `step`). A `unit` the canvas doesn't name (Units and axes; the
  canvas unit grammar) is refused at the lock, naming the unit: this suite's `furlong` is refused, its `m` locks.

### The playtest's input (the spec's `play`, #184's)

- It gains **`play`**: the locked `game.play@1`.
- A goal's `when` may be an expression over the interface's names (this suite's: `depth` and `dead`, keys of
  `values`), with the closed function list's operators, reached at the first step it is true (non-zero): this suite's
  goals are `{name: "deep", when: "depth >= 3"}` and `{name: "dead", when: "dead >= 1"}`.
- Bots, as Check input: playtest spells them, beside #184's policy and logic bot: **`{legal: {pick: "seeded" |
  "greedy", every}}`**, **`{explorer: {every}}`**, **`{descender: {action, every}}`**; any bot may carry
  **`share: {goal: [min, max]}`** and **`expect: {goal: "miss"}`**.
- **A policy's value on a control may be the name of an interface action on that control** (a key of `actions` whose
  `control` it is), a string, put as the entry that action's gesture makes. This suite's waiting policy:
  `{policy: {pick: {wait_key: {from: ["wait"], every: 0.25}}}}`.
- Refused before any run (the check counts no run and no replica call it makes plays a step: the owner's ruling on
  #184), with a failure naming what: a name the interface declares that the piece doesn't publish, with a failure whose
  message starts **`play.missing:`** and names the interface's name (`turn`); a policy value or a bot's `action` that
  names an action the interface doesn't declare, naming the action (`pray`, `dive`).

### The replica's play call (#184's `play`)

- Its `bot` also takes **`{legal}`, `{explorer}` and `{descender}` as the input spells them** (`share`, `expect` and
  `by` may ride along; the replica ignores them), and the call carries **`play`**, the locked interface, which those
  bots and a policy's action names read. A bot's kind is its first key among policy, logic, legal, explorer and
  descender, and that is how this suite tells one bot's runs from another's in a playtest of several.
  #184's host rule (a run's bot is one the input gives) and validator (each bot's run i played, its track in the
  evidence) hold for these bots as for a policy, each told apart by its kind and fields.
- A first-party bot reads only the interface's names, and at each step acts at most once, through a row the piece
  listed at the step it read, as the entry a player's gesture makes, stamped at the next step with the writer `bot`
  (design: Play interface `game.play@1`): a row `(action, a, b)` of an action whose `args` is `cell` is two entries on
  its point control at that step, **`{phase: "press", button: "primary", cell: [a, b]}` then `{phase: "release",
  button: "primary", cell: [a, b]}`**; an action whose `args` is `none`, on an actions control, is one entry on that
  control (the action's index in the control's `actions`, repeat 0, in a form `deep-logic` reads on an actions
  control; this suite's crawler reads only that an entry came).
- Each run's play asks `values` for at least the array paths of the names its goals read and of every name declared
  with a `range`.

### The result

- **`playtest.band`**: for each bot and each goal of its `share` whose share of the bot's counted runs reaching the
  goal falls outside `[min, max]` (ends included): one failure, `test` `"bot <b>"`, its message starting
  `playtest.band:` and naming the bot's kind (`descender`, `policy`, …), the goal, the share as **`share <s>`** (runs
  reaching it over runs counted, as JavaScript prints the number: `share 0.15`, `share 0`) and the band as **`[min,
  max]`** (`[0.9, 1]`, `[1, 1]`).
- **`playtest.expect`**: for each run of a bot that reaches a goal its `expect` says it misses: one failure, `test`
  `"bot <b> run <i>"`, its message starting `playtest.expect:` and naming the goal and **`step <k>`**, the first step
  it was reached.
- **`play.out_of_range`**: for each run in which a value of a name declared with a `range` leaves it: one failure,
  `test` `"bot <b> run <i>"`, its message starting `play.out_of_range:` and naming the interface's name (`hp`),
  **`row <r>`**, the value (`120`) and **`step <k>`**, the first step it is out.
- As #184's: messages name numbers as plain integers or decimals, and `testsRun` counts runs.

## The crawler (`programs.ts`)

One logic item, `crawler`, at 60 Hz, of class figure, reading `aim` (a point control), `wait_key` (an actions control
with the one action `wait`) and `stairs` (an actions control with the one action `descend`). `init` generates three
floors from its seed (each run's own, with `piece_seed: run`): 32 × 32, walled, with R rooms (6 to 10) in a 3 × 4 grid
of slots taken in snake order; rooms 0 to R − 2 are joined one to the next by corridors whose ends are doors, and
room R − 1 is a vault joined to room R − 2 through one locked cell. The hero starts in room 0, the exit lies in room
R − 2, the vault's key in a room between, and a wraith (it passes walls) starts in room R − 2's corner. Classes:
open 0, blocked 1, door 2, locked 3, key 4, exit 5; `locks {3: 4}`.

Each step: a press on `aim` at a cell next to the hero that it may enter moves it there (a locked cell once it has
stood on this floor's key); an entry on `stairs` while it stands on the exit descends (on floor 3: won); an entry on
`wait_key` waits only when the hero has no move. Every other entry is refused. Every 4th step the wraith steps toward
the hero, or, within one cell, strikes it for 10 if the hero took no move or descend that step; at hp 0 the hero is
dead. A living hero arriving on a floor below the first drinks its potion, which heals to 100. It publishes `grid`
(the current floor), the units `cell`, `hp`, `side`, `alive` (row 0 the hero, row 1 the wraith), `turn` (accepted
entries), `depth`, `won`, `dead`, the legal rows (each move, the descend on the exit, the wait when there's no move;
none once dead or won), `accepted`, `refused`, and `rooms` (each floor's room count, this suite's own reading).

Its interface (`crawlerPlay`): `grid {cells: crawler.grid, size: [32, 32], shape: square, moves: 4, classes, locks,
floor: crawler.depth}`, `units {cell, hp, side, alive, self: 0}` (the hero is the self unit), `turn`, `values {depth,
won, dead}`, `actions {move: {control: aim, args: cell}, wait: {control: wait_key, action: wait, args: none}, descend:
{control: stairs, action: descend, args: none}}`, `legal {rows: crawler.legal, count: crawler.nlegal}`, `accepted`,
`refused`. Criterion 1's input (`crawlerInput`): 20 runs a bot, seed 555, `span: {steps: 4000}`, the goals deep and
dead, `piece_seed: run`, and the bots in this order: the descender with `share {deep: [0.9, 1]}`, the explorer, the
seeded legal bot, and the waiting policy with `expect {deep: miss}` and `share {dead: [1, 1]}`.

Twins: **lag** publishes the hero's cell as the step before left it; **nofight**'s wraith never strikes; **sinker**
moves the hero down a floor on its own at every step k > 0 with k % 500 = 0; **noturn** declares and writes no `turn`;
**potion**'s potion heals to 120.

## How the fixture was checked

Before any implementation, the crawler was played here without the plug-in, by a scratch harness that isn't part of
the suite: reference bots written from the design's words (a breadth-first descender and explorer, a seeded pick of
listed rows, a wait every 15 steps) drove `deep-logic` sessions of the assembled crawler a step at a time, and two of
their tracks were played again through the base's `deep-drive` `play` to the same depths and no refused entry. With
the run seeds hash(555, i), i < 4: the descender reached depth 3 by step 96 to 180 and won every run, hp at 100; the
waiting hero died by step 71 to 163 at depth 1; on the lag twin the descender never reached depth 3 in 4,000 steps;
on the nofight twin no waiting hero died in 1,200 steps; the explorer and the legal bot lived 4,000 steps short of
depth 3; the sinker twin reached depth 3 at step 1000; the potion twin's hp read 120 at the descend's step. A
TypeScript model of the same rules over 100 seeds: the descender reached depth 3 in 100, the waiting hero died in 100
(by step 171), the lagging descender reached depth 3 in 1, the explorer in 15 and never died (85 runs reaching no
goal), the legal bot in 0. The first 20 run seeds' floors: 1,024 cells, one locked, one key and one exit cell, and 6
to 10 rooms on each floor. On the base plug-in, a playtest of a waiting policy with numeric values through this
suite's pool and hub passed its 2 runs, each found with its one replay by `runsOf`.

## Criteria to tests

| ID | Criterion (short) | Test, and the wrong program it fails on |
|---|---|---|
| AC1 #555.c6cb5bbb | the crawler passes 4 × 20 runs | `ac01-crawler.test.ts`: the floors (one-step plays of each run's seed: 32 × 32, one locked, key and exit cell, 6 to 10 rooms a floor); passed, testsRun 80; from the replicas' own plays: each bot's runs at hash(555, i), the descender's share of depth 3 at least 0.9, no waiting run reaching it and every one dead, every run reaching no goal played exactly 4,000 steps, each track replayed without its bot to the same checkpoints and final hash; the ported rule on the 60 first-party runs. Fails on the base, a plug-in that passes without playing, a span read as seconds, a bot acting outside the listed rows |
| AC2 #555.2e7fd78d | three planted twins | `ac02-twins.test.ts`: lag: playtest.band on `bot 0` naming descender, deep, the share its runs measured and [0.9, 1]; nofight: playtest.band naming policy, dead, `share 0` and [1, 1], no run's hero dead; sinker: playtest.expect on `bot 0 run 0` naming deep and step 1000, the step its values reach depth 3. Fails on a plug-in that never fails a band or expectation, or names another share or step |
| AC3 #555.4e926f67 | play.missing; undeclared actions | `ac03-missing.test.ts`: the noturn twin under criterion 1's input fails play.missing naming turn, counting no run, no call playing a step; a policy naming pray and a descender naming dive are each refused naming it, likewise; the waiting policy and the descender naming wait and descend are played and counted. Fails on a plug-in that plays the twin, or plays an undeclared action |
| AC4 #555.f6861216 | range, out_of_range, unit at the lock | `ac04-range.test.ts`: `m` locks and `furlong` is refused naming furlong; hp `[0, 100]` passes on the crawler with hp read at 0 and 100; on the potion twin each run whose hp first reads 120 at step k fails play.out_of_range naming hp, row 0, 120 and step k, and no waiting run does. Fails on a lock taking any unit, a range never read, read with open ends, or at another step or row |

## Planted twins

| Twin | Where | Criterion | The wrong program, and how the test catches it |
|---|---|---|---|
| lag | `programs.ts` | 2 | the hero cell lags a step: the descender's band must fail with its measured share |
| nofight | `programs.ts` | 2 | the wraith never strikes: the waiting policy's dead band must fail with share 0 |
| sinker | `programs.ts` | 2 | the hero sinks every 500 steps: the waiting policy's expectation must fail at step 1000 of run 0 |
| noturn | `programs.ts` | 3 | no turn array: play.missing naming turn before any run |
| pray, dive | the bots | 3 | an action the interface doesn't declare: refused before any run, naming it |
| potion | `programs.ts` | 4 | heals to 120: play.out_of_range at the drink's step, row 0 |
| furlong | the interface | 4 | a unit the canvas doesn't name: refused at the lock |

## Readings where the issue and design leave a choice

- **The goal dead.** Criterion 1 calls deep "the goal", and the waiting policy's `share {dead: [1, 1]}` needs a goal
  named dead: `dead >= 1`. A run is counted as reaching a goal at the first step its expression is true.
- **Each run its own floors.** The input says `piece_seed: run` (the technical design: a generated game's brief has
  each run play the piece from the run's own seed), so the 20 runs of a bot are 20 crawls.
- **"Hero", "hp", "depth", "won", "dead", "turn"** are the self unit (row 0 of `units`), `units.hp`, and `values`
  depth, won and dead, and `turn`, which counts the entries the crawler took.
- **The wait is listed only when the hero has no move**, and the wraith strikes only a hero that stood still. So the
  waiting policy's hero, whose entries the crawler refuses, stands still and dies in every run; every moving bot lives,
  so explorer and legal runs that don't descend twice reach no goal and the 4,000-step clause is read on real runs.
  With a wait listed, a descender whose hero cell lags would walk its path after each random wait and could keep its
  band; without one, each of its steps after a move finds no listed row toward its path's next cell and takes the
  legal bot's seeded pick of a move, a random walk along a chain of rooms that rarely descends twice in 4,000 steps.
- **"Sends the descender into walls"**: a first-party bot acts only through listed rows, so it never walks into a
  wall; the lagging cell is read as its path's next cell never being a listed row's target. What the test reads is
  the band failure and the share the runs measured.
- **The twins' playtests** run criterion 1's input with only the bot their clause names (20 runs, its band or
  expectation), so `bot 0` is that bot. **Criterion 4**, which names no count, runs the descender and the waiting
  policy 3 runs each; the waiting policy's dead hero puts hp at 0, the descender's potions at 100.
- **"Before any run"** is the owner's ruling on #184: the check counts no run, and every replica call it made is an
  error or a play of no step.
- **A policy names an action** by its value on the action's control (a string naming an interface action), since a
  policy names controls and an actions control's value is an action; a bot names one in its `action`.
- **The ported rule** is checked on the three first-party bots' 60 runs: this suite plays each run's track again with
  the legal list asked for, and each step's entries must be a row listed at the step before.
- **`m` and `furlong`**: `m` is in Units and axes and the canvas unit grammar; `furlong` is in neither.

## Not covered (scope with no criterion here)

`rules.legal`, `grid.reach`, the soak, the model bot and layered grids (#1048, #556); the greedy legal bot and
`legal.score`; hex grids, `moves: 8`, `floor`'s `ready`, `start`, `rewards`, `hidden`; the other forms (space, side,
vehicle, command, none); `play.missing` for an array of the wrong type; `step` on a name; keyed copy and prompts shown
in a unit; a game project's build as subject; the plug-in's conformance kit and catalog text for the new codes.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `helpers.ts` (the pool, the hub, runs and values), `programs.ts`
(the crawler, its twins, its interface and the bots), and one test file per criterion: `ac01-crawler`, `ac02-twins`,
`ac03-missing`, `ac04-range`.
