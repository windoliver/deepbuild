# Acceptance tests for #860: rewind as an input, with branches kept on the track, seen kept across them, and seeking still equal to playing

Written first, from issue #860 (its Scope, its five acceptance criteria and its Proof line: "The story's rewind beside a
fresh play by hash at every stop, the seen array across branches, the puzzle's undo, the save across a rewind, and the
bots' runs with their replays"), its Oracle page (`doneright/oracles/issues/860.md` in DeepBuildAI/deepbuild, branch
`doneright`: no upstream test checks any criterion), the design sections it names and base commit `7d5000134` ("Merge
pull request #2739 …"), by a job that never saw an implementation; none existed, and no other branch, worktree, pull
request or session was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). The owner approved building this issue, which reopens "rewind as an
input" from Cut, or deferred.

## What was read

- The issue, live with `gh issue view 860 --repo windoliver/deepbuild --comments` (no comments), and its Oracle page.
- `docs/canvas-primitives.md`: Logic: checkpoints and bake; Input track; Input track entries; Marker: present mode;
  Logic: saves; Logic: saves across changes; Logic `logic@1`; Logic: turn clock; Check input: logic kinds; Check input:
  playtest; Play interface `game.play@1`; Net `net@1`; Net: rollback; Export: web player; Replica `deep_drive`;
  Transport; Carried state. `docs/technical-design.md`: Cut, or deferred; The logic module (Logic bake and checks, Saves,
  Turn clock); Dogfooding. AGENTS.md.
- At the base, for the surfaces used: `crates/deep-logic` (`Logic::handle` and its calls, `track.rs`, `world.rs`'s
  `deep_hash`, `world/world_impl.rs`'s checkpoints, turn clock and `append`, `play.rs`, `saves.rs`, `piece/checks.rs`),
  `crates/deep-replica/src/drive/play.rs`, `crates/deep-show` (`track_call.rs`, `picks.rs`'s `logic` call, `points.rs`'s
  `match`, `net.rs`), `crates/deep-play/src/logic.rs`, `crates/deep-player/src/play.rs`, `crates/deep-canvas-input`'s
  track, `crates/deep-canvas/src/document/mod.rs`'s top-level keys, `packages/checks/playtest`, the extension host's
  play validator, and the suites `tests/acceptance/531/`, `532/`, `533/`, `534/`, `545/`, `184/`, `555/`, `1048/`,
  `1164/`, `540/`, `169/` and `172/` (their READMEs and helpers).

What the base has, which these tests don't credit: the turn clock, checkpoints, bakes, seeks, logic.determinism, saves,
the replica's play mode with policy bots, the playtest plug-in, the app's `logic`, `track` and `match` calls and the web
player. It has no rewind: an input track entry is a control's or a reading's (deep-logic's `Entry::parse` refuses any
other, so a bake of a track holding one answers `bad_input`, while deep-show's `logic` call drops one silently), a
document's top level has no `rewind`, a policy reads only `keys` and `pick`, and none of this suite's replies, codes or
planted names exist.

## Run them

```sh
npm ci && npm run build --workspaces        # once, in a fresh worktree
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 sh scripts/lease node node_modules/vitest/vitest.mjs run \
  --root tests/acceptance/860 --no-file-parallelism --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/860/tsconfig.json
rm -rf tests/acceptance/860/node_modules
```

Every test passes its own 90-minute timeout, above `--testTimeout`; `--hookTimeout=180000` lets the browser file's
cleanup outlast vitest's default. What a run builds, each once per file through the named helper (other suites' read
only), honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set:

| Build | Command | Used by |
|---|---|---|
| `deep-logic` | #534's helper: `cargo build --locked --bin deep-logic` | every file |
| #533's assembler | #555's helper: `tests/acceptance/533/wat` built from a copy into `target/acceptance-555-wat` (in place its lock no longer builds `--locked`) | every file |
| `deep-show` | `app.ts`'s `useShowBin`: `cargo build --locked --bin deep-show --no-default-features --features full`, as #169's helper builds it but with rustup's proxy first on PATH, as #534's and #184's helpers run cargo, so the three builds don't rebuild each other's crates | ac03, ac05 |
| `deep-drive` | #184's helper: `cargo build --locked -p deep-replica --bin deep-drive --features env-plants` | ac05 |

With warm builds, all five files ran in 30 s at the base, where each test stops early; with the implementation expect
one to two minutes (ac05's playtest, 40 replica plays of 600 steps, took 13 s at the base, then 21 logic.determinism
runs, an export and a headless Chrome; every other test a few seconds). Cold, on a heavily loaded Mac, the builds took
about 20 minutes (`deep-logic` 9, `deep-drive` 8, `deep-show` 4 after it) besides `npm run build --workspaces`.

Gates, none a pass: off macOS every test fails `INCONCLUSIVE:` first thing (the replica and the app's player run on
macOS only; the whole suite is held to it). Cargo that can't run is `BLOCKED:`. The browser leg is `BLOCKED:` without
Google Chrome at `/Applications/Google Chrome.app` (or `CHROME_BIN`) or without a WebGPU adapter in headless Chrome
(#172's helpers). Temporary folders are deleted; processes are the helpers' children (replicas, `deep-logic`, the
server, Chrome), each stopped by its PID. `scripts/lanes.mjs` lists the folder in `alone`.

`BASE-FAILURE.txt` is one run of each file at the base.

## The surface

The issue names the input-track entry `rewind {to: step | stop}`, the piece's `rewind: {stops: array path, depth: u16 ≤
512}`, the `seen` array as carried state the piece declares, branches kept on the track, saves, logic.determinism, the
playtest plug-in's bots, the app, the web player, a match's refusal and two planted rewinds, but no call or field
spelling past those. Everything goes through the base's surfaces, unchanged where this list doesn't say otherwise:
`deep-logic`'s JSON lines (#531's README: deep-logic; #532's, #534's, #545's additions), the replica's `play` (#184's
README), `deep-show run` (#393's scenario binary; #1164's, #540's and #172's READMEs) and the web player's `probe()`
(#172's README). **Every name the issue or the design doesn't give is marked *(chosen)*; the implementer builds exactly
these, or a dispute goes to a blind redraft.**

### The piece's rewind

- **`rewind: {stops, depth, seen?}`**, the issue's field, at the top level of a piece (`deep-logic`'s Piece, which the
  replica's `play` takes too) and of a document (deep-show, beside `controls`) *(place chosen)*.
- **`stops`**: an array path `<logic ID>.<name>` naming one of that item's own `i32` or `bool` arrays of count 1 *(type
  chosen)*. A step that ran and left it nonzero is a stop; the state at a stop is the state after that step ran.
- **`depth`**: the issue's, at most 512: a rewind may go back at most `depth` stops.
- **`seen`** *(chosen)*: an array path naming one of the item's own arrays: the issue's `seen` array, declared as carried
  state by naming it here. After a rewind restores the stop's state, the logic module puts back, in the item's write
  region and in its arrays, the values that array held just before the rewind, so the next step reads them there.
  Nothing else crosses a branch; a piece whose rewind names no `seen` carries nothing across.

### The rewind entry

`{"t": flick, "seq": u32, "rewind": {"to": {"stop": n}}, "writer", "player": 1}` *(shape chosen)*, on every input track
the base's calls take and list: `deep-logic`'s `bake`, `determinism`, `open`, `append` and `open_save`; the replica's
`play` (`track`, and `entries` in its reply); deep-show's `logic` call's `track`, the `track` call's `load` and its
listing, and `export`'s `track`.

- `"to": {"stop": n}`: back `n` stops from the current stop on the current branch (n ≥ 1; one press of a viewer's back
  is n = 1). The issue's other form, `"to": {"step": k}`, returns to the stop at step k on the current branch *(chosen)*;
  no test writes it.
- It takes effect at its stamp, before any step at that time runs, and runs no step of its own (a turn clock runs none
  for it).
- After it, the state at any time is the fold over the current branch's entries (those up to the stop's step, then those
  after the rewind), restored from the checkpoint ring and stepped forward: every step that runs later, with its step
  hash and arrays, and every checkpoint after the rewind, with its full-state hash, equals a fresh play of those entries
  at the same times. The entries of the closed branch and the rewind stay on the track: a reply that lists the track
  lists them.
- A rewind of more than `depth` stops is refused, naming the depth (`append`, below).

### `deep-logic`

- **`bake`** gains **`closed: [{"stop": s, "rewind": r}]`** *(chosen)*: each branch a rewind closed, `s` the step of the
  stop it returned to and `r` the rewind's own step, oldest first; `[]` with none. Its `track` lists every entry it read,
  closed branches and rewinds included.
- **`append`** of a rewind entry to a session takes it as any entry (`{"ok": true, "entry"}`); one past the depth is
  refused and not appended: **`{"ok": false, "code": "rewind.past_depth", "depth": <the piece's depth>}`** *(chosen)*.
  A session's `step` then reports its `deep_hash` and `track` as now.
- **`open_save`** (#534's): a save taken after a rewind holds its current branch (its state, and the stops a later rewind
  may return to within depth), its closed branches within depth and the carried seen; the opened run plays the given
  track on from the save, rewinds included. Its reply gains **`closed`** *(chosen)*: the closed branches the save holds,
  as `bake` lists them.
- **`determinism`** (#532's logic.determinism), on a track holding rewinds, also plays a fresh play of each rewind's
  current branch and compares it with the run by full-state hash at every stop after the rewind; a difference is a
  failure **`{"item", "run": "branch", "rewind": r, "stop": s, "field": "deep_hash", …}`** *(chosen; the tests read
  `run`)*, beside #532's failures, and the verdict is FAIL.

### The replica's play mode and the playtest

- `deep-drive`'s `play` (#184's) takes a piece with `rewind` and rewind entries on its `track`; a replay plays them.
- A policy bot gains **`rewind: {"every": s, "from": [min, max]}`** *(chosen)*: at each multiple of `every` seconds after
  0 within the span, once the replica has played through the step there, the bot draws an integer n from `min` to `max`
  by hash(the run's seed, `rewind`, the step), as a pick draws, and when n ≥ 1 and at least n stops lie behind the
  current one within the depth, writes `rewind: {to: {stop: n}}` stamped at the next step with the writer `bot`;
  otherwise nothing. The play's `entries` list those rewinds. The playtest plug-in passes the bot through as it does any
  policy.

### The app (`deep-show run`) and the web player

- A document's top-level `rewind` (above), beside a `net@1` item too.
- **`match`** (#540's) on a document whose track holds a rewind entry answers **`{"code": "rewind.in_match", "match":
  <the net@1 item's ID>}`** and plays no copy *(chosen)*; a track without one plays as now. The `track` call's `load`
  takes such a track (a recorded track, not a match).
- An export with `video.codec: web` on a track holding rewinds: the bundle's player plays them as the app does, so
  `probe().checkpoint_hashes.<logic ID>` are the app's `logic` call's `checkpoints.<ID>[].deep_hash` on the same track.

### Planted twins of `deep-logic` (`--planted <name>`)

Each is one criterion's wrong rewind, reachable only through this argument, and changes nothing else:

| Name | Criterion | The wrong rewind |
|---|---|---|
| `rewind_restores_arrays_only` *(chosen)* | 1 (and 5's check that logic.determinism can fail) | a rewind puts back only the item's arrays as the stop left them (in its write region and its arrays) and leaves the rest of its memory and its globals as they stood when the rewind came |
| `rewind_clears_seen` *(chosen)* | 2 | a rewind zeroes the declared seen array (in the write region and the arrays) instead of keeping it |

## The story and the puzzle (`programs.ts`)

WebAssembly text assembled by #533's assembler against the region map `deep-logic check` reports for each piece (a probe
program first); each exports `memory` (one page, its maximum its minimum), `init`, `step`, `reads_at` (0) and
`writes_at` (8192). Both step at 60 Hz on a turn clock (`clock: on_input`) and checkpoint after every step that runs
(`checkpoint: {every: 1}`), so each stop has a full-state hash. Before the base run, both were run unrewritten in Node's
own WebAssembly on hand-made read regions, with the expected rewind modelled by a fresh instance played to the stop and
the carried seen written back: every expected value below held. Then, at the base, with every rewind left out: the
base's `deep-logic` gave the region maps the programs are built for, ran exactly the steps listed below with a
checkpoint labelled step + 1 after each, saved and reopened the story and gave the puzzle's boards; the puzzle document
presented, replayed to the model's board, exported with `video.codec: web` and played in headless Chrome with the
player's checkpoint hashes equal to the app's; the match document played two copies; and a 20-run playtest of the
puzzle passed, with logic.determinism passing on every run's track.

- **The story**, item `story`: 40 lines and 3 choices (offered at lines 8, 18 and 28). Controls `next`, `choose` (1 or
  2), `skip` (the skip-read control) and `save`. Line 1 shows at step 0; `next` shows the next line except where a
  choice is offered; `choose` takes an option there and shows the next line; `skip` shows line after line while each
  line's text is in `seen`, stopping at the first unread line, at a choice or at line 40. A line's text is its number,
  except lines 23 to 27 after option 2 of the second choice (texts 41 to 45). Each line shown marks its step a stop and
  its text read in `seen` (`i32` × 48, read and written in the write region); `save` writes slot 1 into `request`. The
  read position and the options are globals, never read back from the write region. Writes: `line`, `text`, `stop`,
  `choices` (×3), `seen`, `request`. Its rewind: `stops: story.stop`, depth 64, `seen: story.seen` in criteria 2 and 4.
- **The track**: line n at step 6(n − 1) to line 30 at step 174 (option 1 at each choice), a rewind of 12 stops at step
  180 (to line 18 at step 102, which offers the second choice), option 2 at step 186 (line 19), then an action every 6
  steps (line 40 at step 312). Criterion 2 skips at step 192 (lines 20 to 22 read on the closed branch; it stops at
  line 23, text 41). Criterion 4 reads to line 24 (step 216), saves at step 222, rewinds 8 stops at step 228 back past
  the branch to line 16 (step 90), reads to line 18, takes option 2 at 246 and skips at 252 (stopping at line 25,
  text 43, the first line no branch read).
- **The puzzle**, item `puzzle`: the eight-tile sliding puzzle, 3 × 3, the blank at cell 8; control `move` (1 up,
  2 right, 3 down, 4 left); each move made marks its step a stop; the board lives in its own memory (from 16384) and the
  blank and move count in globals; writes `board` (×9), `moves`, `stop`. Its rewind: `stops: puzzle.stop`, depth 5.
  Criterion 3's moves: up, up, left, down, left, down, right, up at steps 10 to 80 (each legal, no board met twice).
  Criterion 5's app track: those moves, a rewind of 3 stops at step 90 (to move 5's stop, step 50), then up and right
  at steps 100 and 110.
- **The documents** (deep-show): the puzzle as a 300 × 300 figure of 2 s at 60 frames a second, the slider `move`, the
  logic item `puzzle` and the top-level `rewind`; for the match, also the `net@1` item `duel` (2 players, 60 Hz,
  delay 2, window 0).
- **The bot**: `{policy: {pick: {move: {from: [1, 2, 3, 4], every: 0.25}}, rewind: {every: 1.1, from: [0, 3]}}}`.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#860.6adcae15` | `ac01-story-rewind.test.ts` (2) | The fresh play of the entries up to line 18 then option 2 shows lines 19 to 40 at steps 186 to 312 (the fixture). The rewound run: lines 1 to 30 first, the track keeps the rewind and the closed branch's entries, `closed` is `[{stop: 102, rewind: 180}]` (the fresh play's `[]`), lines 19 to 40 again after it, a checkpoint after each, and every step hash, array and full-state hash after the rewind equals the fresh play's. `rewind_restores_arrays_only` shows another line at step 186 and the comparison fails, naming the stop (step 102, line 18) and the line. Fails: a rewind that restores arrays or memory only in part, one that drops the closed branch's entries, a state that isn't the current branch's fold |
| 2 `#860.e18a3535` | `ac02-seen.test.ts` (2) | With no rewind the skip from line 19 stops at line 20 (the fixture). After the rewind, option 2 shows line 19 with the third choice unmade, `seen` holds texts 20 to 30 (read only on the closed branch), the skip at step 192 stops at line 23 (text 41) and `next` shows line 24. `rewind_clears_seen`'s skip stops at line 20 and the judgement fails, naming that line and line 23. Fails: seen restored or cleared with the rest of the state, more than seen crossing |
| 3 `#860.af17db8f` | `ac03-puzzle-undo.test.ts` (2) | In a session, 8 moves and the first 3 alone give the model's boards (the fixture); a rewind of 6 stops is refused `rewind.past_depth` naming depth 5; a rewind of 5 is taken and the session's full-state hash at step 100 equals the 3-move session's (and not the 8-move state's); the track holds the rewind taken and not the refused one. In the app, the match document plays its moves as a match of 2 copies, takes a track with a rewind, and its `match` answers `rewind.in_match` naming `duel`, playing no copy. Fails: an undo that leaves state behind, no depth limit or a refusal that names none, a match that plays a rewind |
| 4 `#860.5892cccc` | `ac04-save.test.ts` (1) | The run saves slot 1 at step 223, then rewinds 8 stops to line 16 and its skip stops at line 25. Opened in another process: the save's hash and step, the recorded full-state hash, `closed` `[{stop: 102, rewind: 180}]`; after the rewind past the load, line 17, `seen` holding texts 20 to 30, 41 and 42, the skip stopping at line 25, and every step and checkpoint after the rewind equal to the run that never stopped. Fails: a save that drops the stops behind it, the closed branches or seen |
| 5 `#860.08c1702c` | `ac05-determinism-web.test.ts` (2) | The playtest of 20 runs passes with testsRun 20; every run's track holds the bot's rewinds (writer `bot`, 1 to 3 stops), its replay without the bot reaches the same checkpoints and final hash, the runs' rewinds differ, and logic.determinism passes on each run's track; under `rewind_restores_arrays_only` it fails run 0's track with a `run: "branch"` failure. In the app the rewound run equals the fresh play of its current branch after the rewind (checkpoints 101 and 111, the model's board), and the web player's full-state hash at every checkpoint of the current branch equals the app's. Fails: bots that never rewind, a replay that differs, a logic.determinism that can't see a wrong rewind, an app or a player that ignores the rewind or plays it differently |

Test count: 2 + 2 + 2 + 1 + 2 = 9. Criterion 5's 20 runs are the issue's count; every other test plays one run or two.

## Readings where the issue leaves a choice

- **Criterion 1's story declares no seen.** A carried seen holds the lines the closed branch read, which a fresh play of
  the current branch never read, so a story declaring it can't equal that fresh play by full-state hash. Criterion 1
  bakes the story (the same program) with no `seen` in its rewind, so nothing crosses the branch; criteria 2 and 4 declare
  it. "Nothing else crosses a branch" is read in criterion 2 on the third choice, made on the closed branch and unmade
  after the rewind.
- **"Full-state hash"** is a logic item's `deep_hash` (Logic: checkpoints and bake) at its checkpoints, and a session's
  `deep_hash`; "at every later line" is every checkpoint after the rewind, one after each step that showed a line.
- **Stops.** "A line shown, a choice offered, a move made": the story's line that offers a choice is one stop, so line 30
  back 12 stops is line 18; the puzzle's stops are its moves, not its start.
- **Time after a rewind.** The clock runs on: the state is the fold of the current branch's entries at their own times
  (the Scope's "a frame after a rewind equals the same frame of a fresh play"), so the fresh plays keep the entries'
  steps. On a turn clock nothing runs in the time a closed branch spanned, so the state just after a rewind is the
  stop's own.
- **"Fails, naming the stop" and "naming the line"**: the test's own judgement of the planted run fails, its message
  naming the stop (its step and line) and the line the run shows, or the line the skip stopped at and the first unread
  line.
- **"Rewinding past depth is refused"**: a viewer's rewind written live, through a session's `append`, which refuses it
  and leaves the track as it was. **"A match refuses a rewind entry"**: deep-show's `match` (the only match the base
  has, #540's) on a recorded track holding one.
- **"Rewinding before the save"**: the same rewind in the run that took the save and never stopped (the Scope's "a loaded
  save rewinds as the run did"); it goes back past the first branch's stop, so the save must keep the stops behind it.
  **"Closed branches within depth"** is read through `open_save`'s `closed`.
- **"Bots rewind at random stops"**: one policy bot whose rewinds are drawn from each run's seed; random means the 20
  runs don't all rewind alike. **"Each replaying from its track alone to the same hashes"** is the plug-in's replay of
  every run (playtest.replay) and the replays in the pool's log. **"logic.determinism passes"** is #532's `determinism`
  on each run's recorded track, held to the Scope's comparison of a rewound run with a fresh play of its current branch;
  a check that can't fail proves nothing, so the arrays-only twin must make it fail with a `run: "branch"` failure.
- **"A rewind in the app equals the same rewind in the web player"**: the same recorded track, the app's `logic` call
  against the player's `probe()` at its last step, at every checkpoint of the current branch. The app's rewind is held
  to a fresh play of its current branch first, since an app and a player that both ignored the rewind would agree.
- **The skip-read control** is the story's own control and rule; the platform knows only the carried seen.

## Not covered (scope with no criterion here)

`rewind {to: step}` (specified, no test writes it); refusals at check of a malformed `rewind` (a `stops` that names no
such array, a depth past 512); a closed branch beyond depth left out of a save; how far consecutive rewinds reach once
one has used part of the depth; logic.determinism on a piece with a carried seen; a viewer's back key in the app or the
player's `back()` writing a rewind (the tests write rewind entries on the track); "a choice made" kept in seen (the
story keeps texts read); rewinding physics; that a rewind never changes a document, a check or a verdict; budgets.
