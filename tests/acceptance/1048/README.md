# Acceptance tests for #1048: rules.legal, a soak, a model bot counted through replay, layered grids, edge values

Written first, blind, from issue #1048 ("Play interface: rules.legal, a soak, a model bot counted through replay, and
layered grids with links": its Scope, Fields, the 4 acceptance criteria, the 3 criteria its "Amended (Nov 8)" section
adds for `logic.edges`, and its Proof line), its Oracle page, the design sections it names and the base commit
52aa05fd3 ("Merge pull request #2729 …"), by a job that never saw an implementation; none existed, and no other
worktree, branch, pull request, plan or session was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test file per criterion, with the
planted twins each criterion names in its own file.

## What was read

- The issue, live (`gh issue view 1048 --repo windoliver/deepbuild --comments`; no comments). Its 7 criteria are tagged
  by `scripts/proof-change.mjs`'s rule (`#1048.` and the first 8 hex of SHA-256 of the text, white space collapsed).
  That script reads criteria only under "Acceptance criteria", so it sees criteria 1 to 4; 5 to 7 carry tags made by
  the same rule from the amended list.
- Its Oracle page (`doneright/oracles/issues/1048.md` in DeepBuildAI/deepbuild, branch `doneright`): no upstream test
  checks any criterion; each is held to this suite's own fixtures and planted twins.
- `docs/canvas-primitives.md`: Check input: playtest; Play interface `game.play@1`; Check input: `rules.legal`; The
  closed function list; Control, Control: kinds as a registry, Control: actions, Control: point, Control: text (the
  slider's `range` is Control's own); Logic `logic@1`; Logic: sandbox (memory can't grow); Logic: saves (a save keeps
  logic's memory as its 64 KiB pages that hold a nonzero byte); Check input: logic kinds (the trap report); Input track
  entries; Replica `deep_drive`; Units and axes.
- `docs/technical-design.md`: Checks for work beyond code (the Playtest bullet); Dogfooding. AGENTS.md.
- At the base, read only for the surfaces these tests use: `tests/acceptance/555` (README, `helpers.ts`, `programs.ts`,
  `ac03-missing.test.ts`), `tests/acceptance/184` (README, `helpers.ts`), `tests/acceptance/533/helpers.ts`,
  `tests/acceptance/308` (`helpers.ts`, `module.test.ts`); `packages/checks/playtest` (every file);
  `packages/extension-host/src` (`host.ts`: options, plants, `runCheck`, `deep.canvas.play` and its validator,
  `deep.registerSource`, `deep.fetch`; `sources.ts` and `source-types.ts`: recordings and replay);
  `packages/conformance` (`CheckSpec`, `CheckResult`, `isCheckResult`); `crates/deep-logic` (`play.rs`, `grid_bot.rs`,
  `track.rs`, `piece.rs`'s control slots and text limits, `world.rs`'s read region, traps and checkpoints, `lib.rs`'s
  calls); `crates/deep-replica/src/drive` (`play.rs`, `plant.rs`); `crates/deep-canvas-input/src/kit.rs`;
  `crates/deep-canvas-sandbox` (the grow rule); `crates/deep-show/src/registries.rs`,
  `crates/deep-canvas/src/registry/lists.rs`; `Cargo.toml`'s dev profiles; `scripts/lanes.mjs`,
  `scripts/proof-change.mjs`, `scripts/lease`.

What the base does, which these tests don't credit: the playtest plug-in registers only `playtest`, so `runCheck` of
`rules.legal` or `logic.edges` answers `missing`; its input has no soak, its results no `runs`; no model bot (a
`{model}` bot plays as no bot), no source of the plug-in's; a policy's string names only an action; the play interface
has no layers or links (`grid.cells` must hold size[0] × size[1] i32, so the 2-layer map fails `play.missing`); no
`explorer-ignores-links` plant; `control@1`'s kit has the parts replay, read_region, keyboard and input, and its entries
no edge values. What it already does, which the tests rely on: #184's replica `play` and #555's play interface,
first-party bots, bands and `play.missing`; `lockPlay`; the host's `runCheck`, `deep.canvas.play` and its validator; the
host's `http`, `replay` and `secrets` options (#102); the logic module's traps (`divide`, `bounds`) with function and
offset; deep-show's `registries` call.

## Run them

```sh
npm ci                          # once, in a fresh worktree
npm run build --workspaces      # once
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  sh scripts/lease npx vitest run --root tests/acceptance/1048 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/1048/tsconfig.json
rm -rf tests/acceptance/1048/node_modules/.vite
```

Every test passes its own timeout (90 minutes; criterion 7's 2 hours) above `--testTimeout`. The builds, each once a
file and honoring `CARGO_TARGET_DIR`: `deep-drive` debug with `env-plants` (#184's helper), `deep-logic` (#533's helper,
for the layout probes), #533's assembler built from a copy into `target/acceptance-555-wat` (#555's helper), and
`deep-show --no-default-features --features full` (#308's helper, criterion 7). **The folder is in `alone` in
`scripts/lanes.mjs`**: its files start replicas and hubs and play for minutes.

Gates. Off macOS every test that plays (criteria 1 to 6) fails `INCONCLUSIVE:` first thing, never a pass; criterion 7
plays nothing. Cargo that can't run is `BLOCKED:`. The only timing any test meets is the soak's step limit, which the
design counts only on the reference Mac (a reading elsewhere); on this Mac the crawler's window p99 read 0.10 to 0.49 ms
in a debug replica under a load of about 170. Folders are temporary and deleted; processes are #184's helpers'
children, stopped by PID.

Time (estimates: the suite can't run before the implementation). With the binaries built: a 100,000-step soak of the
clean crawler took 8 s here and of the leak twin 33 s (its 10 MiB memory hashed at each checkpoint), so criterion 2 is
about 2 minutes with replays; criterion 1 plays 3 × 3 runs of up to 600 steps and tests 150 samples × about 11 entries
on each fixture, minutes by how the restores are made; criterion 3's model runs are 600 to 3,675 steps with up to 253
calls each; criteria 4 to 7 under a minute each. A whole run should take 10 to 20 minutes, plus about 10 for cold
builds (warm, here: `deep-drive` 3 minutes, `deep-show` 3).

## The surface

The issue and the design name the kinds `rules.legal` and `logic.edges` of the playtest plug-in beside `playtest`;
`rules.legal {playtest, samples = 50, unlisted = 8, seed}` and its result `{tested, listed_refused: [{run, step, row}],
unlisted_taken: [{run, step, entry}]}`; the playtest input's `soak: {bot, steps, every = 3,600, limits: {memory: MiB,
save: KiB, step: ms (p99)}}`; the bot `{model: {provider: name@version, every: steps ≥ 15, budget: {calls, tokens}}}`;
the result per run `{seed, track, outcome, replay, frames, counted}`; `grid.layers: u8 = 1`, `grid.links` with
`links.count`, rows of (from, to, two_way); `logic.edges` with `samples` and `settle`; the codes
`rules.listed_refused`, `rules.unlisted_taken`, `playtest.soak`, `playtest.band`, `play.missing`, `play.out_of_range`,
`logic.trap`. **Every name below that the issue or the design doesn't give is this job's invention**, the smallest the
criteria need; the implementer builds exactly these, or a dispute goes to a blind redraft. #184's and #555's surfaces
(their READMEs: The surface) stay as they are.

### The new kinds through `runCheck`

- `runCheck('rules.legal', spec)` and `runCheck('logic.edges', spec)`, with check.kind@1's fields as a playtest's spec
  has them (`runner: 'deep.canvas.play'`, …), plus their own input: **`legal: {playtest, samples, unlisted, seed}`** or
  **`edges: {playtest, samples, settle, seed}`** (`playtest` the requirement ID they name), and **`play`: the input of
  the playtest they name**, as a playtest's own spec carries it (#184). The runs they read are that input's runs, each
  bot's run i at hash(seed, i), played through `deep.canvas.play`, so the host's checks of each play hold against that
  input. This suite passes every field; no default is read.
- Both are the playtest plug-in's (`deepbuild/playtest`), its manifest's `checks` and `codes` holding them and their
  codes, and the plug-in still passes its conformance check in the hub (the suite asserts `check(installed).passed`).
- Before any run, as a playtest does (#555): a name the interface declares that the piece publishes no array for fails
  with a failure whose message starts `play.missing:` and names the name; the check counts no run (`testsRun` 0) and
  every replica call it made ran no step.

### rules.legal

- A sample is the state run i's step s left, s a step at which the run's `legal.count` was above zero; each listed row
  and each drawn unlisted entry is stamped at step s + 1 and one step runs, each in a throwaway copy from that state.
  **"Every other name as it was"** is read against that state stepped once with no entry (the crawler's wraith moves
  on its own every 4th step).
- A row or an entry is spelled **`[action, a, b]`**: `action` its index in `actions` in declaration order, `a` and `b` a
  cell's x and y (0 and 0 for args `none`), as `legal.rows` lays a row out.
- The result gains **`legal: {samples: [{run, step}], tested, listed_refused: [{run, step, row}], unlisted_taken: [{run,
  step, entry}]}`** (the design's fields, and `samples`, each state it sampled); `run` is **`"bot <b> run <i>"`**;
  `tested` counts the entries tested.
- Each failure: `test` `bot <b> run <i>`; its message starts with its code (`rules.listed_refused:` or
  `rules.unlisted_taken:`) and names the run as `bot <b> run <i>`, the step as **`step <k>`** and the row as **`row
  [a0, a, b]`** or the entry as **`entry [a0, a, b]`** (white space inside the brackets free).

### The soak

- **`soak.bot`** is a bot as `bots` spells one (here the input's one explorer). The soak is one run of it, beside the
  input's other runs.
- **memory**: the bytes of the piece's logic memories held in 64 KiB pages that hold a nonzero byte (as a save keeps
  logic's memory), summed over its items, in MiB. The sandbox lets no memory grow, so this is how a memory grows.
- **save**: read only when the play interface names a save action; the crawler's names none, so no save is read here.
  **step**: the window's p99 step time, deciding only on the reference Mac (the design).
- **Window n** (n from 1) holds steps (n − 1) × every to n × every − 1, and each measure is read at its last step.
- The first window over a limit fails one failure: `test` **`soak`**; its message starts `playtest.soak:` and names the
  measure (`memory`), the window as **`window <n>`** and the value as **`<v> MiB`** (the number as JavaScript prints
  it: `8.0625 MiB`).

### The model bot

- Its calls go through the hub as calls of the plug-in's source **`ext.playtest.model`** (its manifest lists it),
  never the plug-in's own network. Installed under #555's grant (documents only), it needs no host or secret to replay.
- With `openExtensionHost({replay})`, each ask is answered by **the first recorded call of source
  `ext.playtest.model` not yet answered, whatever its request's method, URL and body** (a prompt holds the run's state,
  so a recording is a model's answers in order); no call goes through the host's `http` and no secret is read.
- **The bot asks after step k, for k = 0, every, 2 × every, …** (as the first-party bots act after a step), showing the
  rows step k listed, at most `budget.calls` times a run.
- **The answer's body is the model's reply text.** A reply that is a row listed at the step the bot asked, written as
  JSON **`[action, a, b]`**, is played as that row's gesture entries (#555's), with the writer `bot`, stamped at the
  next step; any other reply is dropped and sends no entry. A model run keeps playing the entries its model chose: it
  never reads them back from a reply's recorded track.
- **Stuck for a model run**: `within` counts only the steps at which the run's track holds a bot entry; the run is
  stuck at the first step k at which the steps holding a bot entry after the measure's last move, up to and including
  k, number `within` (in steps). Its replay is judged by the same rule from the same track.
- The result gains **`runs: [{test, seed, track, outcome, counted}]`**, one per run of every bot: `test` `bot <b> run
  <i>`, `track` the recorded track's sha256 as a replica reply names it, `outcome` `{kind: reached | ended | stuck |
  trap | over_budget | invalid, step, …}` (#184's outcomes), `counted` false for a model bot's runs and true for the
  others'. Goals, bands, expectations and a pass read counted runs only.
- A model run's stuck, trap or over-budget outcome fails the check only when its track, played again without the model
  in a fresh replica, fails the same way at the same step. Otherwise the run is refused: a failure with `test` `bot <b>
  run <i>` whose message starts **`refused:`** and names the run, and its own failure doesn't stand (no
  `playtest.stuck` for it).

### Policies on a text control

- **A policy's string value on a text control is a commit of that string** (its UTF-8 bytes), not an action's name;
  #555's rule (a string names an action) stays for every other control.

### Layers and links

- `grid.layers` (1 by default): `grid.cells` holds size[0] × size[1] × layers i32.
- **A cell is named (x, layer × size[1] + y)** wherever the interface names a cell (a row's a and b, `units.cell`, a
  point entry's cell), so its index is b × size[0] + a: layer × size + the row-major cell.
- **`grid.links: {rows: <array path>, count: <array path>}`** (the issue's `grid.links` and `links.count`): i32 rows of
  (from, to, two_way), from and to cell indices, `count` of them.
- A cell's neighbours never cross layers. The explorer and the descender take a link as one move from its from cell
  (and from its to cell when two_way), through the listed row whose target is the link's other end.
- Replica plant **`explorer-ignores-links`** (`DEEP_DRIVE_PLANT`, the `env-plants` build): the explorer reads no links;
  its search takes none and it plays no listed row whose target isn't next to its cell on its layer.

### logic.edges

- The controls it puts are those the play interface's actions name. Each kind's edge values come from its `control@1`
  entry (criterion 7), on the control's own declared range: a slider 0, `range[0]` and `range[1]`; a text control an
  empty text and one of 256 bytes.
- Each value is put at step s + 1 from the state a sampled step s left, in a throwaway copy, the other controls as the
  run had them, then `settle` steps run.
- A value the logic module's check refuses (a text past its control's `max_bytes`) never reaches a step: it is listed
  under `edges.refused` and fails nothing.
- A value is spelled as a number as JavaScript prints it (`0`, `10`), or a text as **`text of <n> bytes`**.
- The result gains **`edges: {put: [{run, step, control, value}], refused: [{run, step, control, value}]}`**.
- A trap's failure: `test` `bot <b> run <i>`; its message starts `logic.trap:` and names **`control <id>`**, **`value
  <v>`**, **`step <k>`** (the step it was put in from), **`function <f>`** and **`offset <o>`** (the trap's, as the
  logic module reports them) and **`track <sha256>`**: the recorded track of the replica play that trapped, as its reply
  names it, which plays again to the same trap.

### `control@1`

- Each entry's value gains **`edges`**: its kind's declared edge values, a non-empty list (their form the input
  module's).
- The kit gains the part **`edges`**: an entry that declares none fails it, its result naming the entry; among the
  registry's planted entries, one declares none and fails `edges` alone.

## Fixtures (`programs.ts`)

- **The clean crawler** is #555's (its `programs.ts`): 3 floors of 32 × 32 from the run's seed, a hero, a wraith that
  strikes a hero who took no move that step every 4th step, move, wait and descend.
- **Twins**, a copy of #555's crawler text with one change each (criterion 1's test asserts the unchanged copy assembles
  to #555's clean program): **wall** takes a press on any wall cell as a move into it; **descend** lists descend on every
  cell and takes it only on the exit; **leak** has 10 MiB of memory (budget.memory 10), 64 pages written from its start
  and one more at every step k with k % 1,000 == 0 (65 + floor(k / 1,000) pages after step k); **calm** is #555's
  nofight, byte for byte (its wraith never strikes); **pit** is calm, and the first cell the hero may enter from its
  start (north, east, south, west) is a pit, where every entry is refused while the moves out stay listed.
  **noturn** is #555's own twin.
- **The map**: one logic item, 2 layers of 16 × 16; on the surface room A (x 1 to 5, y 1 to 5, the start at (1, 1),
  the gate at (5, 5)) and room B (x 9 to 14, y 9 to 14, the teleporter's end at (9, 9), the exit at (14, 14)), walled
  apart; in the cave a corridor from the gate's lower end (5, 21) down to (5, 26) and east to the teleporter (10, 26).
  Links: the gate (85 ↔ 341, two-way) and the teleporter (426 → 153, one-way). A press moves the hero to a passable
  neighbour on its layer or along a link; it lists those moves.
- **The duel** and its clamped twin: armor (a slider, range [0, 10]) starts at 5; each entry sets it and deals 60 /
  armor (i32.div_s), as does each step with none; the twin holds armor to at least 1.
- **The tag**: the text control `name` (max_bytes 60, a 64-byte read region); each step writes the name's last byte,
  indexed at length − 1 with no test for an empty name.

## How the fixtures were checked

Before any implementation, on the base's `deep-drive` (`play` with #555's bots and with tracks this suite built) and by
this suite's own breadth-first routes, in a scratch file that isn't part of the suite:

- The copy's clean and calm texts assemble to #555's clean and nofight programs. The descender's runs at hash(1048, i),
  i < 3, win on the clean, wall and descend fixtures alike, with 142 to 209 steps listing a row. From step 30 of run 0
  the wall twin takes a press on the wall (0, 0) (the hero stands there, accepted 30 → 31); the descend twin lists
  [2, 0, 0] on an open cell and refuses it (refused 0 → 1, depth 1).
- The calm descender's 225 rows, one every 15 steps, reach depth 3 at step 2,551 with nothing refused; the same rows on
  the clean crawler leave the hero dead at step 95 on floor 1. On the pit twin (start (1, 1), pit (2, 1)) a move into
  the pit raises turn to 1 and 25 moves back are refused, turn staying 1.
- 100,000 steps of the explorer: clean, no trap, 8 s; leak, no trap, 33 s; window p99 at most 0.17 and 0.49 ms.
- The map: no route without the links; with them 30 moves through both; played as a track, the hero stands on the exit
  at step 30; the gate's row is listed on (5, 5), the teleporter's on (10, 26), none back on (9, 9).
- The duel traps (divide) at the step armor 0 is read, at function 0, offset 109; its policy's runs never trap (hurt 7 to
  30); the clamped twin reads 60 at armor 0 and 6 at 10. The tag runs clean with a name every step; an empty name traps
  (bounds) at its step, and so does a 256-byte commit the base's play steps (the region is left empty).

## Criteria to tests

| ID | Criterion (short) | Test, and the wrong program it fails on |
|---|---|---|
| AC1 #1048.e36b203c | rules.legal: clean passes, 50 samples a run; wall twin unlisted_taken; descend twin listed_refused; noturn play.missing | `ac01-rules-legal.test.ts`: on 3 descender runs of each, the clean crawler passes with 50 samples a run from steps listing a row and ≥ 9 entries a sample; the wall twin fails naming the run, the step and a move entry whose cell is a wall there, unlisted, and taken from that state; the descend twin fails naming row [2, 0, 0] at a step off the exit; noturn fails play.missing naming turn, no run, no step. Fails on the base, a check that passes untested, samples states no run reached, compares with the state before the step, never draws cells, names another step or entry |
| AC2 #1048.3109851b | soak: clean passes; leak twin fails memory, first window past 8 MiB | `ac02-soak.test.ts`: clean passes with no soak failure; leak fails playtest.soak, test soak, naming memory, window 18 and 8.0625 MiB, no earlier window. Fails on the base, a soak reading the declared memory, at another moment, or never failing |
| AC3 #1048.1ea738c9 | model bot: pit stuck replays; deep share and verdict unchanged, counted false; refused; junk sends nothing | `ac03-model.test.ts`: the pit run fails playtest.stuck, counted false, its track replaying to the step turn last moved and holding it to the stuck step, 20 bot steps after; junk replies send no entry and no stuck; deep's share, verdict and failures equal without the model, the model's run reached and uncounted; a run whose track replays to no stuck is refused, named, no stuck failure. Fails on the base, an unlisted reply played, idle steps counted, a model run counted, a failure taken without replay |
| AC4 #1048.657a36a7 | 2-layer map: explorer 20 of 20, never back; planted explorer band | `ac04-layers.test.ts`: passes, 20 runs reached, each down the gate and up the teleporter and never on the cave again; with `explorer-ignores-links` it fails playtest.band naming explorer, exit, share 0, [1, 1], no run reaching the exit. Fails on the base, an explorer ignoring links, a band never failing |
| AC5 #1048.c2ba93df | armor 0 traps; logic.edges names control, 0, function, offset; track reproduces; clamped passes | `ac05-armor.test.ts`: logic.trap naming control armor, value 0, the step, function and offset, and a track that traps (divide) at both in a fresh replica; 0, 0 and 10 put; the clamped twin passes. Fails on the base, a check that never puts 0, names another place, or fails the clamped twin |
| AC6 #1048.354e0af2 | 256 bytes refused at check, never stepped; a check skipping text passes a buggy fixture | `ac06-text.test.ts`: logic.trap naming control name and text of 0 bytes; text of 256 bytes listed refused, in no failure, in no play that ran a step. Fails on the base, a check skipping text controls, one stepping a text past max_bytes |
| AC7 #1048.2c7f09e5 | edge values from control@1; planted kind with none fails the kit, named | `ac07-registry.test.ts`: control@1's kit has the part edges; every entry declares edges and passes it; a planted entry declaring none fails edges alone, named. Fails on the base, a kit passing a kind with none |

## Planted twins

| Twin | Where | Criterion | The wrong program, and how the test catches it |
|---|---|---|---|
| wall | `programs.ts` | 1 | takes a move into a wall: rules.unlisted_taken naming run, step and the entry, checked against the run's own state |
| descend | `programs.ts` | 1 | lists descend everywhere, takes it on the exit: rules.listed_refused naming row [2, 0, 0] off the exit |
| noturn | #555's `programs.ts` | 1 | no turn array: play.missing naming turn before any run |
| leak | `programs.ts` | 2 | one more 64 KiB page every 1,000 steps: playtest.soak naming memory, window 18, 8.0625 MiB |
| pit | `programs.ts` | 3 | the hero can't leave: the model's run ends stuck, and replays to the same step |
| the planted hub replica | `ac03-model.test.ts` | 3 | tracks reported without their bot entries: the run's stuck doesn't replay, so the run is refused |
| `explorer-ignores-links` | the replica (env-plants) | 4 | an explorer blind to links: playtest.band naming explorer and share 0 |
| the duel | `programs.ts` | 5 | divides by armor: logic.trap at 0, its track reproducing it; the clamped twin passes |
| the tag | `programs.ts` | 6 | indexes past an empty name: only a check that puts the empty text finds it |
| the planted edgeless entry | `control@1`'s planted entries | 7 | a kind with no edge values: fails the kit's edges part, named |

## Readings where the issue and design leave a choice

- **The clean fixture** is #555's crawler (criteria 1 and 2). For criterion 3's model, which the design lets act at
  most once in 15 steps, the clean crawler can't be won: its wraith strikes a hero that took no move that step every
  4th step, and on the base the descender's own path played one move in 15 left the hero dead at step 95 on floor 1. So
  "reaches deep on the clean fixture" is read on the calm crawler, #555's nofight program, the same floors and rules
  but a wraith that never strikes; the pit twin is the calm crawler with a pit.
- **Unlisted entries leave every other name as it was** against the same state stepped once with no entry: the crawler
  moves its wraith every 4th step whatever the hero does, and a rule read against the state before the step would fail
  the clean fixture.
- **The named playtest's runs**: criterion 1 names no count; 3 descender runs of 600 steps, each from its own floors,
  each listing rows at 142 to 209 steps, enough for 50 samples, under the goal deep, which each reaches. Every playtest
  here names a goal or a ranged name, so each run's play reads values, which #184's host requires of a pass; the soak's
  short explorer run takes the goal `turn >= 1`, reached at its first move.
- **"A move into a wall cell"**: rules.legal draws unlisted cells from the whole grid, so the wall twin takes a press on
  any wall, not only one next to the hero, which a draw would rarely hit.
- **Memory** is the bytes in pages that hold a nonzero byte, since the sandbox traps any growth; the leak twin starts at
  4 MiB so its growth passes 8 MiB inside 100,000 steps. `every` is passed as the design's default, 3,600, and a window
  is read at its last step. **Save**: the crawler names no save action, so the soak reads none and passes (a save's size
  read from 64 written pages would pass 256 KiB at once and hide the memory limit). **Step**: a reading off the
  reference Mac.
- **The model's recording** answers in order, so each check gives the model bot one run; its provider is
  `test.recorded@1`; its stuck rule reads turn (the crawler's count of entries taken, which the pit holds); its pit is
  the start's first open neighbour. Each recording opens with a reply that is no row (`pass`), so a bot whose first
  ask came before any step listed a row would still play the same moves from its second ask.
- **A run whose track replays to no stuck** needs a fault, since a faithful track always replays: the test's own hub
  replica reports each play's recorded track without its bot entries (the replica played them), so the replay holds no
  bot entry and, by the model's stuck rule, is never stuck.
- **Deep's share** is the share of the counted runs that reach deep. Beside the model, #555's waiting policy, banded
  {deep: [0, 0]}, under the goal deep: counting the model's run would reach the goal and turn the verdict.
- **Layers**: a cell's y runs on through the layers, (x, layer × 16 + y), so rows, units and points keep two numbers.
  **Links**: `grid.links` takes `rows` and `count` as `legal` does.
- **logic.edges' counts**: 2 samples a run and 4 settle steps (the criteria name none). The duel's slider range is [0,
  10], so its edges are 0, 0 and 10; the duel listing only the slider, a trap can come only from armor.
- **The text fixture** must see a name at every step, since an empty commit and no commit lay out the same in the read
  region (a length of 0); its playtest's policy commits one every step, and only the empty edge makes it trap.
- **Edge values' form** in `control@1` is the input module's; this suite reads only that each kind declares some.

## Not covered (scope with no criterion here)

The command form's reader for rules.legal, rules.solve and grid.reach; the model bot's tokens, spend and prompt,
hidden names, several model runs in one check; a soak's save size; a link naming a cell outside the grid
(`play.out_of_range`); logic.edges' records of a non-finite value or an array value outside its range; the edge values
of picks, sticks and actions; a module's new kind played through logic.edges end to end; BLOCKED for a named playtest
never run; the conformance kit's cases for the new codes (only that the plug-in still passes its conformance).

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `helpers.ts` (the pool, its plants and planted reports, the hub with
its source seams, the kinds' specs and the results' readers), `programs.ts` (the twins, the map, the duel and the tag),
and one test file per criterion: `ac01-rules-legal`, `ac02-soak`, `ac03-model`, `ac04-layers`, `ac05-armor`,
`ac06-text`, `ac07-registry`.
