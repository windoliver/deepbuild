# Acceptance tests for #1047: playtests from a save

Written first, blind, from issue #1047 ("Playtests from a save: each run starts at the save's step, after
logic.layout": its opening sentence, its one Scope line, its `Runs on:` line, its 2 acceptance criteria and its Oracle
line), its Oracle page, the three closed issues it depends on, the design sections it links and those they lean on, and
the base commit ebf1e7f44 (its last merge is #3411), by a job that never saw an implementation: no other worktree,
branch, pull request, plan or session was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, and the one planted
runner criterion 1 names in a test of its own.

## What was read

- The issue as saved for this job (title, state, labels, body; it has no comments), and its body byte for byte, from
  which each criterion's ID is computed by `scripts/proof-change.mjs`'s rule: `#1047.310638fa` and `#1047.660130ec`.
- Its Oracle page: no upstream test checks either criterion, so nothing is ported; both are held to this suite's own
  fixtures and planted runner.
- The bodies of #184 (playtests), #534 (saves) and #189 (saves bound to a state layout, and logic.layout).
- `docs/canvas-primitives.md`: Check input: playtest; Replica `deep_drive`; Input track; Export: web player; Check
  input: plug-in reads; Logic: saves; Logic: saves across changes; Check input: logic kinds (logic.layout); Logic:
  checkpoints and bake. None of them writes `from` down: the issue's Scope line is its only definition.
- `docs/technical-design.md`: Checks for work beyond code (the Playtest bullet); Extension API (TypeScript,
  in-process); Saves; Saves across changes; How we know version 0 works (Criteria to tests, Closed issues stay proven,
  Criteria in a checked shape, Wrong programs, Dogfooding, Tests written first, Repo guards); How runs become one of
  five verdicts. `docs/parallel-proof.md` sections 5 to 7. AGENTS.md.
- At the base, for call shapes and conventions only: `tests/acceptance/184` (README, `helpers.ts`, `programs.ts`,
  `fixtures/maze-player`, `ac01`, `ac08`, `ac11`), `555` and `1048` (`helpers.ts`, README), `534` (README surface,
  `helpers.ts`, `dungeon.ts`, `ac01`), `189/saves` (`helpers.ts`, `programs.ts`, `ac02-logic-layout.test.ts`), `533`
  (`helpers.ts`); `packages/checks/playtest` (`index.ts`, `run.ts`, `types.ts`, its manifest);
  `packages/extension-host/src` (`host.ts`: options, `deep.canvas.play`, `runCheck`, `unplayed`; `plays.ts`);
  `packages/conformance/src/families.ts`; `packages/verdicts/src/engine.ts` (what reads INVALID); `crates/deep-logic/src`
  (`play.rs`, `saves.rs`, `saves/layout.rs`, `checks/layout.rs`, `checks.rs`'s probes, `track.rs`, `lib.rs`'s `bake` and
  `layout`, `world/world_impl.rs`'s run loop); `crates/deep-replica/src/drive/play.rs`; `scripts/lanes.mjs`,
  `scripts/proof-guard.mjs` (the lane file's shape), `scripts/throttle.mjs`, `scripts/lease`.

What the base does, which these tests don't credit: the playtest's input has no `from` and `runPlaytest` passes none
on; the host hands a run's `from` to the hub's replica unchanged, as any field it doesn't know; the replica's play
reads no `from` and plays from step 0, so a playtest `from` any save plays its 20 runs from step 0 and passes; the
validator asks nothing about where a run started; nothing reaches logic.layout from a playtest. What it already does,
which the tests rely on: the logic module writes a save when a step asks (`deep-logic`'s `bake` with `saves_dir`),
its header naming its step, its layout and each item's full-state hash; `deep-logic`'s `layout` call refuses a save
of another layout under the piece's program, naming both layouts; the replica's `play` plays a recorded track from
step 0 and answers its checkpoints, step 0 first, and its `final`; #184's hub, playtest, maze player and validator.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npm run build --workspaces      # once: the hub's record reads packages/record/dist (as #1048's README says)
export PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
npx vitest run --root tests/acceptance/1047 ac01-from-save.test.ts --testTimeout=600000 --no-file-parallelism
npx vitest run --root tests/acceptance/1047 ac02-layout-refused.test.ts --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/1047/tsconfig.json
rm -rf tests/acceptance/1047/node_modules/.vite
```

Each file is its own command, run as a lane runs a suite that is alone (`node scripts/throttle.mjs test --wait 60 --
npx vitest run …`). Every test passes its own timeout (90 minutes), above `--testTimeout`. Each file builds what it
drives once, through the base's helpers, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set and Homebrew's rustup put on PATH when present:

| Build | Command | Used by |
|---|---|---|
| `deep-drive` debug | `cargo build --locked -p deep-replica --bin deep-drive --features env-plants` (#184's `driveBin`) | both files: the replicas |
| `deep-logic` | `cargo build --locked --bin deep-logic` (#533's `logicBin`) | both files: the region offsets, the saves, logic.layout's own answer |
| #533's assembler | `tests/acceptance/533/wat`, into `target/acceptance-533-wat` (#533's `assemble`) | both files: the maze, the route bot |

No other binary is driven. No planted replica is used, so `DEEP_DRIVE_PLANT` is never set; the debug build with
`env-plants` is #184's, reused so one build serves both suites.

**The folder runs alone**: `lane.json` says so (`shared: the sandbox log stream`, #184's reason: each file opens an
extension host with its supervisor, and starts two replicas).

Gates. Off macOS every test fails `INCONCLUSIVE:` first thing (the replica's binaries exit on any other OS), never a
pass. Cargo that can't run is `BLOCKED:`; a build that fails, a replica that doesn't say ready and a plug-in that
doesn't load fail naming it. A save the logic module didn't write, at step 1,800, whole, is `BLOCKED:`, naming what
its bake answered. Neither criterion reads a time and nothing here depends on the machine's load. Folders are
temporary and deleted; processes are #184's helpers' children, stopped by PID.

Time (estimates: the suite can't pass before the implementation): with the binaries built, `ac01-from-save` plays one
1,800-step run, 20 runs and 20 replays of up to 7,200 steps on two debug replicas and 20 more runs for the planted
runner, a minute or two; `ac02-layout-refused` plays nothing past the refusal, under a minute. A cold build of
`deep-drive` takes many minutes more.

## The surface

The issue names `from: {save: asset ID}`, the save's step, the save's full-state hash, logic.layout, 0 runs and
INVALID, and a planted runner. It gives no spelling for how a play is told of the save, how a play says where it
started, or what a refusal reads. **Every name below marked "mine" is this job's choice**, the least the criteria
need, each reusing a field the base already has; the implementer builds exactly these, or a dispute goes to a blind
redraft. Everything else is the base's, as #184's README, "The surface", gives it.

### The playtest's input

- **`from: {save: "<asset ID>"}`** (the issue's; optional), in the playtest's input, the check spec's `play`. This
  suite's: `{"piece": "01JD1047P00000000000000001@1", "bots": [{"logic": {…}}], "runs": 20, "seed": 184, "span": 120,
  "stuck": {"measure": "maze.cell", "by": 1, "within": 10}, "goals": [{"name": "won", "when": "maze.won"}],
  "frames": {"every": 0}, "from": {"save": "5c0e…"}}`, #184's input and one field more.
- **The asset ID is the save's SHA-256** (mine): 64 lower-case hex digits, the name the logic module gives the save's
  file (`<sha256>.save`), as a bot's `program` is its program's SHA-256.

### `deep.canvas.play` and the replica's play mode

- **`run.from: {save: "<asset ID>"}`** (mine: the input's own field, on the run): the playtest gives it to each run's
  play and to each run's replay. The host hands it to the hub's replica with the run's other fields, as it does at the
  base. The tests read it on the play call as the replica got it: `call.from.save` is the asset ID. Other keys beside
  `save` aren't read.
- **The save's bytes** reach the replica as a bot's program does: the hub hands every asset it keeps in the play
  call's `assets`, `{<sha256>: base64}`. In these tests that is the route bot's program, the save, and in criterion
  2 the earlier program that wrote the save. The piece's own `assets` hold its own program only.
- **The reply's `checkpoints` start where the play started** (mine): a play from a save answers
  `checkpoints: [{"step": 1800, "hash": <full-state hash>}, …]`, its first the save's step with the piece's
  full-state hash there, where a play from step 0 answers step 0 first. `hash` is the base's: the SHA-256 of
  `<item ID>=<that item's full-state hash>` and a line end for each of the piece's own items, in piece order, a bot's
  left out. For this piece the save's is `sha256("maze=" + header.deep_hash.maze + "\n")`. The later checkpoints and
  `final` are the base's. `steps` is above 0 for a run that played. Example, a run's reply as the tests read it:
  `{"ok": true, "steps": <above 0>, "entries": [six presses of arrow by the writer bot], "checkpoints": [{"step":
  1800, "hash": "…"}, {"step": 1860, "hash": "…"}, …], "final": "…", …}`.
- **A play whose run gives no `from` still plays, from step 0**, whatever the check's input says, as at the base.

### The playtest's result

- From a save that opens: `outcome: "passed"`, `testsRun: 20`, as #184's.
- From a save logic.layout refuses (mine, but for the count): **`testsRun: 0`**; an `outcome` the verdict engine reads
  as INVALID, which is **`ran_nothing`**, never `passed` and not `failed` (FAIL); and **one failure whose `message`
  holds `logic.layout` and both layouts in full**, the save's and the piece's, each as the logic module's own refusal
  names it (`differs: [{"what": "layout", "save": <the save's layout>, "piece": <the piece's>}]`). Example:
  `refused before any run: logic.layout: the save 5c0e…'s layout 91ab… isn't the piece's, 77f0…, and the piece
  declares no migration`. The failure's `test` isn't read.
- **No play of the piece runs a step** before that refusal: every play the replicas logged for the piece answered
  `ok: false` or `steps: 0`.

### The host's validator

- **A result reported `passed` by a check whose input gives `from: {save}` is refused when a run of it started
  anywhere but the save** (mine): its outcome is no longer `passed`, and for each such run one failure's `message`
  names the run as **`run <i>`** (as #184's validator does: `bot <b> run <i> (seed <s>)`) and its first step as
  **`step <k>`**, `step 0` for a run played with no `from`. Example: `test/maze-player's ext.maze-player.play
  reported passed without bot 0 run 7 (seed 5126…) started from its save: it started at step 0, not step 1800`. One
  failure that names several runs counts for each it names.

## The maze and its save (`programs.ts`)

**The clean maze** is #184's: its 6 × 6 grid, its five walls, the token at (0, 0), `won` from the step it stands on
(5, 5), one cell an `arrow` press (1 north, 2 east, 3 south, 4 west), the arrays `cell`, `won` and `presses`, one
logic item `maze` of class `figure` at 60 Hz. #184's maze declares no saves, so a save of it can't exist. This one
adds what a save bound to a state layout needs and nothing else: an i32 array `save`, `saves: {slots: 1, request:
"save"}` with no migration, a step that writes 1 into `save` at the end of step 1,799 (0 at any other), so the logic
module saves slot 1 at step 1,800, and its state layout (`layout_at`): where it keeps the token, the press count and
`won`.

**Who writes the save**: the logic module. `saveOf` runs `deep-logic`'s `bake` of the piece for 1,800 steps with a
`saves_dir` and the recorded input, reads the one save it reports (`maze`, slot 1, step 1,800) from
`<saves_dir>/<sha256>.save`, checks the bytes hash to the name, and reads the header's `step`, `layout` and
`deep_hash`. Nothing is kept in this folder: the fixture is built each run. Its asset ID is that SHA-256, and the test
keeps the bytes among the hub's assets with #184's `keepAsset`.

**The recorded input** before the save is the route's first four presses (east, east, east, north) at steps 300, 600,
900 and 1,200, as yours. They leave the token on (3, 1) with 4 presses counted, so the saved state isn't the start's.
From there #184's route bot (every 4th step until `won`, the press its table gives for `maze.cell`) makes the route's
last six presses, north, north, north, east, east, north, and reaches `won`.

**The earlier maze** (criterion 2) is an earlier program of the same piece: the same rules with the press count kept
before the token, exporting another state layout. Its save at step 1,800 is the fixture save whose layout differs.

## Criteria to tests

| ID | Criterion (short) | Test, and the wrong program it fails on |
|---|---|---|
| AC1 #1047.310638fa | 20 runs each start at step 1,800 with the save's full-state hash, a straight run's there; each track replays from the save to the same hashes | `ac01-from-save.test.ts`, first test. The save's hash, from its header, equals the `final` of a straight run: the maze played in a replica from step 0 on the same presses for 1,800 steps, which ends on (3, 1) with 4 presses and whose step-0 hash is another. The playtest passes with `testsRun` 20; each run's play was given the save and its first checkpoint is step 1,800 with that hash; each run's bot pressed the route's last six; each run played steps, has a later checkpoint and ends on another hash; each run's own replay was given the save, starts the same and has the run's checkpoints and `final`. **Fails on the base**, where `from` does nothing: each run starts at step 0, and the failure names each run and its first step |
| AC1 #1047.310638fa | a planted runner that starts at step 0 fails, naming the run and its first step | `ac01-from-save.test.ts`, second test. The planted runner's 20 plays went through, each from step 0; its result isn't `passed`, and each run is named with `step 0`. **Fails on the planted runner unless the host refuses it**; at the base its PASS goes through |
| AC2 #1047.660130ec | a save of another layout, no migration, refused by logic.layout before any run, naming both layouts; 0 runs, INVALID, never PASS | `ac02-layout-refused.test.ts`. `deep-logic`'s `layout` call fails on the save, refusing to open it under the piece's program for its layout: those are the two layouts. The playtest from it counts 0 runs, isn't `passed`, and one failure names logic.layout and both layouts; the verdict engine reads its requirement INVALID and the claim not PASS; no play of the piece ran a step. **Fails on the base**, which plays 20 runs from step 0 and passes |

## The planted runner

Criterion 1's planted runner is test code, standing on the base's files: #184's maze player
(`tests/acceptance/184/fixtures/maze-player`, a check plug-in other than the playtest, whose runner makes the plays a
test's config names through `deep.canvas.play` and reports passed), installed in this suite's hub under the maze's
grant. It runs the same check the shipped runner passes: the spec's `play` is the playtest's input, `from: {save}`
included. Its config plays each of the 20 runs as the shipped runner does, seed hash(184, i), the route bot, the
stuck measure and the goal as values, 120 s, and reports `passed` with `testsRun: 20` and every play's track as
evidence, which is all the base's validator asks. What it doesn't do: give any play the save. So every run starts at
step 0. Nothing but the host's validator stands between it and a PASS, and at the base nothing does.

## Readings where the issue and design leave a choice

- **The clean maze with a save slot.** "A save written at step 1,800" of "the clean maze" needs a maze that declares
  saves and asks for one; #184's doesn't. The maze here is #184's with the least added (see above), and the save is
  the logic module's own, not bytes a test made.
- **The asset ID** is the save's SHA-256, since that is how the logic module names a save and how every other asset a
  play takes is named; the hub hands the bytes in `assets`.
- **"The save's full-state hash"** is read as the replica's play reports a full state, one hash over the piece's
  items, formed from the save header's `deep_hash`. So the comparison with a straight run and with each run's first
  checkpoint is of like with like.
- **"A straight run's at that step"**: a play from step 0, never stopped and never seeked, on the save's own recorded
  input, for 1,800 steps (design: Logic: checkpoints and bake, "must equal a straight run in full"). Its `final` is
  the state at step 1,800; reading `final` rather than a checkpoint keeps the test off the checkpoint spacing.
- **Where a run says it started**: its reply's first checkpoint, the one field the base already has for "the state at
  a step" (step 0 first there). No new reply field is invented.
- **The run carries `from`** to `deep.canvas.play` and the replica under the input's own spelling, and the replay
  carries the same ("each run's replay starts from the same save").
- **Runs that play on from the saved state.** The criterion's hash could be reported without the state behind it, so
  the test also reads what the route bot did from there: six presses, not the ten it makes from the start.
- **The span from a save** isn't read. The input keeps #184's 120 s. Whether a run from step 1,800 plays 7,200 steps
  or stops at step 7,200 is the implementer's; the tests ask only that it plays on, past a checkpoint, to another
  state. So are the indexes of `values` and the steps a result's outcomes name.
- **logic.layout runs in the replica, on the play.** The hub here is #184's, whose replica is handed play calls and
  nothing else (its `hub` plays whatever call the host hands it), so a playtest reaches the logic module only through
  `deep.canvas.play`. The replica's play mode is the logic module's, where logic.layout already lives, so no new
  seam, API method or replica call is needed, and the tests invent none. They read only what logic.layout decided:
  the result's failure, and that nothing was played.
- **"Before any run"** is read on the replicas: no play of the piece ran a step. A play of no step, such as the
  playtest's own first play of each bot, is no run (as #1048's suite reads #184's "refused before its first step").
- **"Counts 0 runs and stays INVALID"**: `testsRun` 0 and a verdict of INVALID from the verdict engine on a claim
  whose one requirement this check covers (#184's `judge`), which at the base means outcome `ran_nothing`.
- **"Naming both layouts"**: the two layout hashes in full, in one failure with `logic.layout`. The expected pair
  comes from the logic module's own logic.layout answer on the same save and piece in the same test, never a
  constant.
- **"A planted runner that starts at step 0"** starts every run there, and "naming the run and its first step" is
  read per run, as #184's validator names each run it finds lacking: each of the 20 is named with `step 0`.
- **The planted runner really starts at step 0.** The test first shows its 20 plays went through from step 0, so a
  host that refuses a play for lacking `from` wouldn't run this wrong program at all; the criterion has it start and
  then fail.
- **This suite's own hub.** #184's `openHub` holds the playtest's manifest to the one kind it had then, so, as #555's
  and #1048's suites do, this one opens its own: the playtest loaded under a grant of the maze's document, and the
  maze player beside it for the planted runner.

## Not covered (no criterion says so)

A migration declared for the fixture save's layout; a save damaged, cut short or missing from the hub's assets; a save
whose content or module set differs; a `from` the check's input doesn't give (the host's rule for seeds and bots);
which code a refused play answers and what the replica's error holds beyond what reaches the result; the result's
`runs` list and each run's outcome step; evidence beyond what the base's validator asks; frames; a policy bot, a
play interface, a soak or `piece_seed: run` from a save; a save of a piece with several items or a world; the web
player; budgets and timings; the check catalog and the design docs' text for `from`.

## What the implementer adds outside this folder

Nothing for the suite to run: no line in `scripts/lanes.mjs` (the folder's `lane.json` puts it in `alone`), no
dependency, no fixture, no build feature and no planted name. The work itself is theirs: `from` in the playtest's
input and its runs and replays, the replica's play from a save after logic.layout, the result of a refused save, the
validator's rule, and the docs. One thing the hub checks at install: `packages/checks/playtest/deepbuild.json`'s
`digest` must be its files' once they change, or the plug-in isn't installed and every test here fails in `openHub`.

## The judges (`judges.ts`)

Each clause is decided by a function from plain data to a list of what is wrong: `notFromSave`, `notPlayedOn`,
`stoodStill`, `replayDiffers` (criterion 1), `notRefusedAtStart` (the planted runner), `notRefusedByLayout` and
`ranSteps` (criterion 2), with `fullState`, the play's own rule for one hash over a piece's items. They import only
Node's crypto, so before any replica was built each was run as a plain node script against planted inputs: a good
input passes, and each wrong one fails naming what its criterion names (a run and `step 0`; a run and the first step
whose hash differs; the count, the PASS and the layouts).

## Imports from other suites

- `../184/helpers.ts`: the replica process and its pool, the hub's pieces and assets (`putPiece`, `keepAsset`), the
  playtest's input and spec (`playInput`, `runPlaytest`), the maze player's run (`runPlayer`), the runs as the
  replicas played them (`runsOf`), the verdict (`judge`), `driveBin`, `macOnly`, `tempDir` and plain tools: the
  playtest's surface as #184 built it, read one way.
- `../184/programs.ts`: the grid, walls, exit and route, the route bot's program and bot: the clean maze's own.
- `../184/fixtures/maze-player`: copied into a temporary folder and installed: the planted runner.
- `../533/helpers.ts`: its assembler (`assemble`) and `deep-logic` (`onLogic`, `checkCall`), as #184's programs use
  them; the `bake` with `saves_dir` and the `layout` call are #534's and #189's calls, written out as JSON.
- `packages/extension-host`, `record`, `asks` and `supervisor`, by their `src/index.ts`, as #184's, #555's and
  #1048's helpers import them to open a hub.

## Files

`README.md`, `lane.json`, `tsconfig.json`, `helpers.ts` (the hub, the save), `programs.ts` (the maze with its save
slot, the earlier maze, the recorded presses), `judges.ts`, `ac01-from-save.test.ts` (criterion 1 and its planted
runner), `ac02-layout-refused.test.ts` (criterion 2), and `BASE-FAILURE.txt` once the suite has run at the base.
