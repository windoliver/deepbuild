# Acceptance tests for #184: playtests

Written first, blind, from issue #184 ("Playtests: seeded bots play a piece live and headless, and a run that sticks,
misses a goal, traps or blows its frame budget fails": its Scope, Fields, 15 acceptance criteria and Proof line), its
Oracle page, the design sections it names, and the base commit 0e5572731 ("Merge pull request #2529 …"), by a job that
never saw an implementation; none existed, and no other worktree, branch, pull request, plan or session was read. The
worktree stood at dc9b43154, whose only changes past 0e5572731 are #2578's ambient-occlusion work (its docs, evidence and
two `scripts/lanes.mjs` lines for #2516), none in a surface read here. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion
(criterion 14 has its Linux leg apart), with the planted twins each criterion names run in its own test.

## What was read

- The issue, live (`gh issue view 184 --repo windoliver/deepbuild`, with its two comments: playtests run on the Mac).
- Its Oracle page (`doneright/oracles/issues/184.md` in DeepBuildAI/deepbuild, branch `doneright`): one upstream test, for
  criterion 6, from an upstream game library's basic tests: seeded random play, a history that holds every action
  applied, and a state rebuilt from the serialized history that must equal the one played. Its rule is ported as
  criterion 6's own test (`ac06-replay.test.ts`); no upstream code is copied.
- `docs/canvas-primitives.md`: Check input: playtest; Check input: plug-in reads; Input track; Input track entries;
  Replica `deep_drive`; Logic `logic@1` (the read region's control slot); Play interface `game.play@1` (only to see what
  this task leaves to it).
- `docs/technical-design.md`: Checks for work beyond code (the Playtest bullet); Extension API (TypeScript, in-process),
  with `deep.registerCheck` and `deep.canvas.play`; Dogfooding. AGENTS.md.
- At the base, read only for the surfaces these tests extend: `tests/acceptance/124` (`deep-drive`, `Drive`, the
  `env-plants` build, `requireMacos`), `411` (a first-party test check plug-in installed under a grant, `runCheck`'s
  refusal of a PASS without a read's keys), `533` and `531` (`deep-logic`'s protocol, pieces, layouts, bakes, the
  assembler), `213` (the timed file's pattern), `68` (a check result judged by the verdict engine), `349`;
  `crates/deep-replica` (`drive/mod.rs`'s call dispatch, `drive/plant.rs`, `deep_drive.rs`, Cargo features),
  `crates/deep-logic` (`budget.rs`'s ceilings, `metering.json`, `piece.rs`'s control slots and classes, `track.rs`),
  `crates/deep-canvas/src/budget.rs` (class limits), `packages/extension-host/src/host.ts` (`deep.canvas.read`,
  `runCheck`, `Plant`, `install`/`check`/`load`), `packages/conformance` (`CheckSpec`, `CheckResult`),
  `packages/verdicts`, `packages/gate/src/claim.ts`, `packages/hub/src/kinds.ts`, `packages/jobs/bakes` (a first-party
  plug-in package's layout), `scripts/benchmark.mjs`, `scripts/lanes.mjs`, `scripts/proof-change.mjs`,
  `benchmarks/budgets.json`.

What the base does, which these tests don't credit: `deep-drive` answers a `play` call `{"ok": false, "error": {"code":
"refused", "message": "no replica runs here: launch one first"}}`, and has no `drops-first-bot-entry` or
`entry-on-change` plant and no `test-renders-unkept-frames` feature; `packages/checks/playtest` doesn't exist;
`ExtensionHostOptions` has no `replica`, the host no `deep.canvas.play` and no `plays-any-seed` plant; `runCheck` on a
kind no loaded package registered answers `missing` with "no loaded extension registered the check kind playtest",
naming no plug-in; `benchmarks/budgets.json` has no playtest task. What it already does, which the tests rely on: the
logic module (`deep-logic`) checks, bakes and steps this suite's maze; deep-show `full` builds and runs the canvas kit;
`runCheck`, grants by `docs`, and the verdict engine's own-check and missing-run rules.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/184 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/184/tsconfig.json
rm -rf tests/acceptance/184/node_modules/.vite
```

Every test passes its own timeout (90 minutes, the timed file's 3 and 6 hours), above `--testTimeout`. Each file builds
what it drives once, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set
and Homebrew's rustup put on PATH when present, and copies each binary to a temporary folder:

| Build | Command | Used by |
|---|---|---|
| `deep-drive` debug | `cargo build --locked -p deep-replica --bin deep-drive --features env-plants` | every file |
| `deep-drive` release | `cargo build --locked --release -p deep-replica --bin deep-drive` | `budgets.test.ts`, reference Mac only |
| `deep-drive` planted release | `… --release --features test-renders-unkept-frames` | `budgets.test.ts`, reference Mac only |
| `deep-logic` | #533's helper (`cargo build --locked --bin deep-logic`) | layouts, the 240 Hz twin's sizing, fuel comparisons |
| #533's assembler | `tests/acceptance/533/wat`, built into `target/acceptance-533-wat` | every program |
| `deep-show` full | #533's helper (`cargo build --locked --bin deep-show --no-default-features --features full`) | `ac08-plugin-off.test.ts` |

**Add the folder to `alone` in `scripts/lanes.mjs`** (`'tests/acceptance/184/'`: its files start replicas and hosts and
each runs minutes) **and `tests/acceptance/184/budgets.test.ts` to `timed`**, as #213's lines do.

Gates. Off macOS every test that plays fails `INCONCLUSIVE:` first thing (the replica's binaries exit on any other OS),
never a pass. Cargo that can't run is `BLOCKED:`. The timed file judges its timings only where the perf lane's rule holds
(`judgeLimit` given five zero readings against a limit of 1 must read PASS: a reference Mac on mains power, Low Power Mode
off, thermal state nominal, the load under the core count); elsewhere it fails `INCONCLUSIVE:` with the rule's reason
after every part that doesn't depend on the machine has passed, and is never retried. Criterion 14's Linux leg always
fails `INCONCLUSIVE:` (no Linux replica host before #71). Nothing else depends on load. Folders are temporary and
deleted; processes are this file's own children, stopped by PID.

## The surface

The issue names a check kind a first-party plug-in registers, a play mode in the replica, `deep.canvas.play`, outcome
codes, a validator rule and planted twins, but no command line, package path or field spelling. **Every name below that
the issue or the design doesn't give is this job's invention**, the smallest surface the criteria need; the implementer
builds exactly these, or a dispute goes to a blind redraft.

### The replica's play mode: `deep-drive`'s `play` call

`deep-drive --out <dir>` (#124's binary) answers a new call with no replica launched. Each `play` call plays in a fresh
replica of its own, headless, on the virtual clock, a step at a time, and closes it; nothing carries from one call to the
next. While it plays, the process runs at the platform's background priority (on macOS read as `ps -o nice=` above 0, as
background QoS and `nice` both show).

```text
{"call": "play", "piece": Piece, "assets"?: {<sha256>: base64}, "seed": u53, "span": seconds | {"steps": n},
 "bot"?: Bot, "track"?: [Entry], "values": [array path], "frames": [step]}
→ {"ok": true, "t", "steps": n, "track": sha256, "entries": [Entry], "values": {<path>: [value per step]},
   "trap": LogicTrap | null, "bot_trap": LogicTrap | null, "step_times": [ns per step],
   "fuel": {<logic ID>: [fuel per step]}, "ceilings": {<logic ID>: fuel},
   "checkpoints": [{"step": c, "hash": hex}], "final": hex, "frames": [{"step": k, "sha256": sha256}]}
```

- **Piece** is `deep-logic`'s piece (#531's `Piece`: `seed`, `class`, `controls`, `items`, `assets`); this suite's have
  one logic item, `maze`, of class `figure`, reading the slider control `arrow`. A step is a step of the piece's logic.
  The piece keeps its own seed (`piece_seed: own`).
- **Bot** is Check input: playtest's: `{"policy": {"keys"?: {control: [[t_s, value]]}, "pick"?: {control: {"from":
  [value] | [min, max], "every": s = 0.25}}}}` or `{"logic": {"program": sha256, "reads": [array path], "plays": {name:
  control ID}, "budget"?}}`. A logic bot's program is in `assets`; the replica adds it to its own copy of the piece as the
  logic item `bot`, stepping at 60 Hz, with its `reads` and one write array a `plays` name, each `f64` × 2: the value,
  then the serial. Each step whose serial differs from the step before (before step 0: 0) puts that value on the control
  as one entry stamped at the bot's next step. A policy's picks are drawn by hash(the run's seed, the control, the step).
  Bot entries carry the writer `bot`. The bot's fuel and trap are its own (`bot_trap`), never the piece's.
- **track**, given in place of a bot: the entries to play, without a bot (a replay).
- **Entry** is #531's control entry: `{"t", "seq", "control", "value", "writer", "player"}`; `entries` is the recorded
  track, in order, and `track` its sha256 (equal tracks, equal hashes).
- **values**: each path's array as each step left it (#531's: a list of `count` values), one per step.
- **trap**: the piece's `logic.trap` (#531's `LogicTrap`: `item`, `step`, `kind`, …, `inputs`, the entries that step
  read), or null. **fuel**: each piece item's fuel per step, as `deep-logic bake` counts it for the same piece and track.
  **ceilings**: each item's step ceiling for its class and rate on the app (logic.budget's `held`).
- **checkpoints**: the full-state hash of the piece's carried state (the bot's excluded) at each checkpoint, step 0
  first; **final**: after the last step. A replay of a recorded track reaches the same ones.
- **frames**: one per step asked, the replica's render of the piece at that step, a PNG kept at
  `<out>/frames/<sha256>.png`, named by its own SHA-256. Frames never decide anything here.
- **seed** is a JSON-safe integer. **Run i's seed** is hash(the check's seed, i): the first 8 bytes, big-endian, of
  SHA-256(seed as u64 little-endian ‖ i as u32 little-endian), shifted right 11 bits (`runSeed` in helpers.ts).
- An error answers `{"ok": false, "t", "error": {"code", "message"}}`, as every call does.

Plants, read only in the `env-plants` build through `DEEP_DRIVE_PLANT`: **`drops-first-bot-entry`** (the recorded track
leaves out the run's first bot entry; the piece still read it) and **`entry-on-change`** (a logic bot's `plays` make an
entry only when the value changes). Cargo feature **`test-renders-unkept-frames`** of `deep-replica` (in no shipped
build, allowed in a release build): every play renders a frame at every step and keeps only those asked.

### The extension host: `deep.canvas.play`

- `ExtensionHostOptions.replica?: (call) => Promise<reply>`: the hub's replica, as `canvas` is the hub's canvas core.
  The host calls it with `{"call": "play", "piece": "<doc>@<rev>", "seed", "span", "bot"?, "track"?, "values",
  "frames"}`, the plug-in's call after the host's checks; the hub resolves the piece and answers the replica's reply (in
  these tests a pool of `deep-drive` processes behind a map of pieces).
- `deep.canvas.play(piece: "<doc>@<rev>", run: {seed, span?, bot?, track?, values?, frames?})` → the replica's reply; a
  reply with `ok: false` throws its error. It is a check runner's call, read against the running check's spec:
- **A check's input** is its spec's `play` field (`CheckSpec` gains it): for the playtest, the whole playtest input
  (below); for any check that plays, at least `{piece, seed, runs?: 20, span?, bots?: [Bot], tracks?: [[Entry]]}`.
- Refused (a thrown error, nothing played): a piece whose doc isn't in the grant's `docs`, naming the piece; a seed that
  is neither the input's seed nor hash(it, i) for i below its runs, naming it (`seed 8`); a bot not in its `bots`; a
  track not in its `tracks` nor recorded by a play of the same check run.
- **The validator** (`runCheck`, after the runner returns): a result reported `passed` by a check whose input has a seed
  is refused, its outcome no longer `passed`, with a failure naming the run as `run <i>` (`bot <b> run <i>` with bots)
  and its seed, when run i (of each bot) wasn't played, when its play's track hash isn't in `evidence`, or when its play
  read no values; `testsRun` must count the input's runs (runs × bots).
- `runCheck` of a kind whose plug-in is installed but not loaded answers `missing` with a failure naming the plug-in.
- `Plant` gains **`plays-any-seed`**: the host plays any seed a runner passes.

### The playtest plug-in: `packages/checks/playtest`

A first-party plug-in package (like `packages/jobs/bakes`): `deepbuild.json` with `"id": "deepbuild/playtest"`,
`"checks": ["playtest"]`, `deep.canvas.play` in `requires.preview`, its digest its files'; `index.ts`, whose default
export registers the kind `playtest` through `deep.registerCheck`, loaded in the hub as a release package, and whose
named export **`playtestSource(input) → "own" | "definition"`** gives the check's source for the verdict: `own` when
every bot carries `"by": "agent"` (the working agent wrote it), else `definition`.

- **Its input** (the spec's `play`): Check input: playtest's fields, as `{piece: "<doc>@<rev>", bots, runs, seed, span,
  stuck: {measure, by, within}, goals: [{name, when: array path, each?}], frames: {every}}`, a bot optionally with `by:
  "agent"`. This suite's: `stuck {measure: "maze.cell", by: 1, within: 10}`, goal `{name: "won", when: "maze.won"}`
  (reached at the first step its array is non-zero).
- Run i of bot b plays with seed hash(seed, i) and the bot; every run's recorded track is played again without its bot,
  through `deep.canvas.play`. A policy naming a control the piece doesn't declare is refused before any play.
- **Its result**: `testsRun` the runs counted; `evidence` holds every run's track hash and its first frame's hash (and its
  replay's and outcome's); one failure per failed run, `test` `"bot <b> run <i>"`, its message starting with the code
  (`playtest.stuck`, `playtest.trap`, `playtest.over_budget`, `playtest.replay`), and a run made invalid by its bot's trap
  saying `invalid`; a missed goal's failure `test` `"goal <name>"`, starting `playtest.goal_missed`. Messages name steps
  as `step <k>` and numbers as plain integers: stuck names the step the measure last moved, the measure and the frame
  hash at the step it was found stuck (that step + `within`); trap names the item, its step and each entry the step
  read as its JSON; over_budget the first step past the ceiling, its fuel and the ceiling; replay the first checkpoint
  step whose hash differs.

### The perf lane

`benchmarks/budgets.json` gains tasks `playtest-maze` (`command: ["node", "benchmarks/canvas.mjs", "playtest-maze"]`,
`margin: 0.5`, `targets: {maze_40_runs_s: 300, idle_work: 0}`, `criteria` naming #184.0bdc1a84) and `playtest-throughput`
(`command: [… "playtest-throughput"]`, `margin: 0.5`, `targets: {fixture_realtime_x: 50}`, `criteria` naming
#184.694b8a04), each with an `initialReason` naming #184, valid by `validateBudgets`.

## The maze and its bots (`programs.ts`)

A 6 × 6 grid, the token at (0, 0), `won` from the step it stands on (5, 5); five inner walls, every cell with two open
sides or more, so a seeded policy never sits 10 s in a dead end. An `arrow` entry's value: 1 north (+y), 2 east, 3 south,
4 west. The maze writes `cell` [x, y], `won` and `presses`. Twins: **stuck** (moves nothing once on (3, 4)), **walled**
((5, 5) closed from both neighbours), **trap** (divides by 40 − presses on each press), **heavy** (240 Hz, every step an
LCG burn sized by two `deep-logic` bakes to 9,000,000–9,100,000 fuel, fuel budget 10,000,000). Bots: the **route bot**
(every 4th step until won, the press its table gives for `maze.cell`: E E E N N N N E E N, a shortest route through
(3, 4)), the **policy** (picks from 1–4 every 0.25 s), the **trap bot** (divides by k − 5), the **two-press** and
**keep-serial** bots. Region offsets come from `deep-logic check`.

## Criteria to tests

| ID | Criterion (short) | Test, and the wrong program it fails on |
|---|---|---|
| AC1 #184.5a3904f8 | the clean maze passes 20 + 20 runs | `ac01-clean-maze.test.ts`: passed, testsRun 40; from the replica's own plays: runs at hash(184, i), every route-bot run reaches won, no 600-step stay before won, no trap, every step within the 60 Hz ceiling (12,000,000), each track replayed without its bot to the same checkpoints and final hash, each run's track and first frame in the evidence |
| AC2 #184.f5950275 | stuck at (3, 4) | `ac02-stuck.test.ts`: each route-bot run fails `playtest.stuck` naming the step the values show the token entering (3, 4), `maze.cell`, and a frame hash its plays returned for that step + 600, kept as a PNG of that hash |
| AC3 #184.7131c480 | exit walled off | `ac03-goal-missed.test.ts`: `goal won` fails `playtest.goal_missed` naming won; no run's `maze.won` is ever 1 |
| AC4 #184.66d5f782 | divide by zero on the 40th press | `ac04-trap.test.ts`: every policy run traps at the step of its 40th press, its failure naming maze, the step and each entry the replica's trap says it read (the track's entries of that step); route-bot runs (10 presses) don't |
| AC5 #184.430caa9a | 240 Hz, 9,000,000 fuel | `ac05-over-budget.test.ts`: every run fails `playtest.over_budget` naming step 0, its fuel (≥ 9,000,000) and 3,000,000; every step's fuel equals the logic module's bake of the run's track; the clean maze's busiest step stays within 12,000,000 |
| AC6 #184.9cae67c4 | replica drops the first bot entry | `ac06-replay.test.ts` (ported rule): on `drops-first-bot-entry` replicas each run reaches won, its track is an unplanted replica's less the first entry, and it fails `playtest.replay` naming the first checkpoint step whose hash differs |
| AC7 #184.25600094 | trapping bot; undeclared control | `ac07-bots-refused.test.ts`: each run of the trap bot has a `bot_trap` at step 5, no piece trap, a failure saying invalid, and the check doesn't pass; a policy on `jump` is refused naming jump with no play |
| AC8 #184.8c80cb23 | plug-in off; short PASS refused | `ac08-plugin-off.test.ts`: deep-show full's kit passes for every registry module; with deepbuild/playtest installed and not loaded the run is `missing` naming it and the verdict BLOCKED naming it; the maze player's PASS with 19 of 20 runs, or without run 7's track, is refused naming the run and its seed; with every track it passes |
| AC9 #184.1d76cea0 | the agent's own bot | `ac09-agent-bot.test.ts`: both playtests pass; `playtestSource` is `own` for `by: "agent"`, giving INCONCLUSIVE with one ask, and `definition` without it, giving PASS |
| AC10 #184.396b3e5c | serials are entries | `ac10-serials.test.ts`: two new serials → entries at steps 3 and 4, token (0, 2); a kept serial → none; `entry-on-change` fails the two-press fixture naming step 4 |
| AC11 #184.a01f1ce5 | another plug-in plays a recorded track | `ac11-plugin-play.test.ts`: the maze player gets the playtest replay's track hash, values and final hash, and passes; frames-only PASS refused naming run 0; a grant without the piece refused naming it, nothing played |
| AC12 #184.af2d1b3a | seeds from the input only | `ac12-seeds.test.ts`: seeds 7 and hash(7, 0..2) played, 8 refused naming it; on `plays-any-seed` the seed judge fails naming test/maze-player |
| AC13 #184.0bdc1a84 | 40 runs in 5 min on 2 replicas; no work without the plug-in | `budgets.test.ts`: a piece played with no bot spends the bake's fuel at every step (idle_work 0); the `playtest-maze` record; on a reference Mac, five readings of the playtest on two release replicas under 300 s |
| AC14 #184.8ba629a5 | Mac and Linux alike | `ac14-machines.test.ts`: Mac leg, twice on fresh replicas: clean passes, 240 Hz twin fails each run at step 0, the same words both times though the step times differ, replicas at background priority; Linux leg: `INCONCLUSIVE` by design (#71) |
| AC15 #184.694b8a04 | 50 times real time on 4 replicas | `budgets.test.ts`: each fixture run replays to its hashes; the `playtest-throughput` record; on a reference Mac, five batches of 20 runs on 4 release replicas within 48 s, and on `test-renders-unkept-frames` the floor's judge names runs under 50 times |

## Planted twins

| Twin | Where | Criterion | The wrong program, and how the test catches it |
|---|---|---|---|
| stuck, walled, trap, heavy mazes | `programs.ts` | 2, 3, 4, 5 | the piece's own faults; each must fail with its code |
| trap bot | `programs.ts` | 7 | a bot's trap must make its run invalid, never pass |
| `drops-first-bot-entry` | `DEEP_DRIVE_PLANT` | 6 | the track misses an entry the piece read; replay must fail |
| `entry-on-change` | `DEEP_DRIVE_PLANT` | 10 | serials ignored; the two-press fixture's judge names step 4 |
| `test-renders-unkept-frames` | `deep-replica` Cargo feature | 15 | renders a frame every step; the floor's judge names the runs |
| `plays-any-seed` | extension host `plant` | 12 | the seed rule's judge names test/maze-player |
| 19 of 20 runs; run 7's track left out; frames only | maze player config | 8, 11 | the validator must refuse each, naming the run |
| plug-in off | installed, never loaded | 8 | BLOCKED naming deepbuild/playtest, never PASS |
| `by: "agent"` | the bot | 9 | `playtestSource` must make it the agent's own check |

## Readings where the issue and design leave a choice

- **The piece** is `deep-logic`'s piece JSON, the logic module's own view of a document's logic, so the maze needs no
  drawn items; a frame is whatever the replica draws of it, and only its hash and file are read.
- **Runs in a fresh replica**: each `play` call is one, in a `deep-drive` process that serves calls one at a time; "two
  replicas" and "4 replicas" are that many processes at once.
- **The playtest's input** sits in the spec's `play`, the one place the host reads seeds, bots and tracks from, so the
  validator and the seed rule are the host's, for any check plug-in, as #411's content-key rule is.
- **"Every logic-bot run reaches won"** is read on the replica's values, not as a goal with `each: true`, which the
  policy's runs, some of which never reach the exit, would fail.
- **Fewer runs where a criterion names none**: the 240 Hz twin plays 2 runs a bot for 240 steps (its 120 s would burn
  2.6 × 10¹¹ fuel a run), criteria 6, 7, 9 and 11 3 or 1 runs of the route bot, and criterion 14's Mac leg 2 runs a bot.
- **"The same on every machine"** (criterion 5) is read as fuel alone deciding: every step's fuel the replica reports is
  `deep-logic bake`'s for the same piece and track, and the ceiling is the class's from the metering record. Criterion
  14's Mac leg runs on this Mac, any Mac: its outcomes rest on fuel, not time.
- **"The checks process run at background priority"** is the replica process that plays.
- **"A piece played without the plug-in gains no work per frame"** is a play with no bot and no track spending, at every
  step, the logic module's own bake's fuel.
- **A run's multiple of real time** (criterion 15's naming) is its share of the batch's: 4 × 120 s over the time its play
  and replay took; the batch's floor is 20 × 120 s ÷ 50 = 48 s.

## Not covered (scope with no criterion)

`playtest.not_live` and live-play subjects (#1046), saves (#1047), `game.play@1` and its bots, bands, `expect`, soaks,
model bots, `piece_seed: run`, the plug-in's own conformance kit as a list of fixtures (each twin is caught in its
criterion's test instead), the check catalog's text for each code, and the policy's `keys`.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `helpers.ts` (builds, replicas and their pool, the hub, runs, the
verdict), `programs.ts` (the maze, its twins and the bots), `fixtures/maze-player/` (the test check plug-in), and one
test file per criterion: `ac01-clean-maze`, `ac02-stuck`, `ac03-goal-missed`, `ac04-trap`, `ac05-over-budget`,
`ac06-replay`, `ac07-bots-refused`, `ac08-plugin-off`, `ac09-agent-bot`, `ac10-serials`, `ac11-plugin-play`,
`ac12-seeds`, `ac14-machines`, and `budgets` (criteria 13 and 15, the timed file).
