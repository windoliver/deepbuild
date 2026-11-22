# Acceptance tests for #553: rollback over logic occurrences, voices and saves, the app and the web player in one match, and the match budgets

Written first, blind, from issue #553 (live: its Scope, its five acceptance criteria, its Proof line and its Oracle
line), the design sections it links and those they lean on, and the base commit `2459c0ebc`: `4b7736f3a` (main
`e575a47af` with the open branches of #552, PR #2959, and #189, PR #2936, merged in; #550 and #551 are on main) with
only the two fixes that let `deep-show` build there (a closing `},` in `match`'s parse in `crates/deep-show/src/net.rs`,
and #189's world saves calling `derive::kept` with #194's arity), by a job that never saw an implementation. No other worktree, branch, pull request, stash or plan was read. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Lean: one file per criterion, each test's name carrying its criterion's ID, and exactly the plants and planted twins
the criteria name. The Oracle page says no upstream test checks any of the five criteria, so there is no Oracle lane.

## What was read

- The issue (`gh issue view 553 --repo windoliver/deepbuild`); for scope only, its parent #179, the epic #310 and its
  dependencies #551 (rollback, the window, page-diff snapshots), #552 (`match.me`, fog, draws), #544 (occurrences from
  logic, Spawn), #189 (saves, games that end) and #140 (the platform seams, the network seam's suite).
- The Oracle page `doneright/oracles/issues/553.md` on branch `doneright` of `DeepBuildAI/deepbuild`, as the issue's
  Oracle line summarizes it: 0 of 5 criteria have an upstream test.
- `node scripts/design-section.mjs --issue 553`: `docs/technical-design.md` The net module (Match, Rollback, Lockstep,
  Desync and replay, Relay and Join, Relay protocol); `docs/canvas-primitives.md` Shared play over a relay (Net `net@1`,
  Net: rollback, Net: lockstep, Net: random draws after commit, Net: desync and replay, Net: relay protocol `relay@1`),
  Seam and backend, Export: web player. And what those lean on: Logic `logic@1` (the read region, a trap in a match),
  Logic: occurrences, Logic: checkpoints and bake, Logic: saves (`request`, `ends`), Spawn, Sound and video on the
  picture's clock (128-sample blocks), Phase (a step runs at least a block ahead of the write head), Check input: net
  kinds, the cost model's class table (showpiece: 4 ms of frame CPU) and Frame budget (the five runs);
  `docs/parallel-proof.md`, sections 6 and 12a (the budget window). AGENTS.md.
- The suites `551/` (README, `helpers.ts`, `fixtures.ts`, imported), `549/` (README, `helpers.ts` and `fixtures.ts`,
  imported), `552/` (README, `fixtures.ts`, imported), `550/` (README: the relay log's `bytes`), `544/` (README and
  helpers: the tone, the WAV reader's form), `189/saves/` and `189/lab/` (READMEs and helpers: `saves_dir`, save files,
  `judgeLimit`), `194-redraft-ac11/` (README: a budget's no-work leg), and `140/platform/` (README: `seam_suite`).
- At the base, only for surfaces: `crates/deep-net/` (README, `copy.rs`: the report, the planted names, a step's run;
  `copy/rollback.rs`: `rolled_back`, `occurrences`, a trap held until its step is confirmed; `window.rs`: net.rollback's
  failures and net.budget's runs; `play.rs`: the relay's log and `deliver`; `message.rs`, `draw.rs`),
  `crates/deep-show/src/{net.rs,matched.rs,seams.rs,frames.rs,picks.rs,physics/saves.rs}` (`match`'s members, `effects`,
  `seam_suite` and its planted backends, `frames`, the `logic` call's `saves_dir`), `crates/deep-canvas-seams/src/network.rs`
  (the network seam's test relay), `crates/deep-relay/README.md`, `scripts/relay-kit.mjs`, `scripts/seams.mjs`,
  `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`), `crates/deep-logic/src/piece.rs` and `piece/checks.rs` (a
  slider's 264-byte slot, writes on 8-byte boundaries), `scripts/lanes.mjs`, `scripts/proof-change.mjs` (`criterionId`).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and `fixtures.ts`.

## What the base already does, and these tests don't credit

From the base's code and this job's run there (`BASE-FAILURE.txt`, on `2459c0ebc`; `4b7736f3a` itself doesn't build
`deep-show`, which is why the base moved):

- **#551's rollback in `match`**: prediction, the window, `relay.deliver`, a copy's `rolled_back` and `occurrences`, a
  trap in an unconfirmed step held until the step is confirmed and dropped by a rollback that replaces it, and
  net.rollback with a window, whose failures name the step where a copy keeps an occurrence, a step hash or a checkpoint
  the on-time run doesn't, but not the occurrence's kind. net.budget's five runs, each `{step, step_ms, window_ms}`.
- **#550's relay log `bytes` and #552's `messages`**, #552's draws, whose commitment travels as JSON with a 64-hex-digit
  hash, and #552's `effects`: the bursts and voices a copy's readers make, drawn after the match from its merged track,
  never the voices it played live.
- **#189's saves in the `logic` call** (`saves_dir`, `saves`, `open_save`); `match` takes no `saves_dir` and writes no
  save.
- **#140's network seam suite** (`seam_suite`: one in-process match through the seam's test relay on the correct test
  backend or the macOS backend) and #309's relay kit (the relay suite on the shipped relay, and the macOS backend's
  `relay_client` interop with its planted `net_writes_step_big_endian`). No interop part plays the app's backend against
  the web player's; there is no `scripts/net-interop.mjs`.

None of it is a copy's live voices or its audio thread, saves in a match, net.budget's checkpoint time, `net_ns`, the
interop part or any of this suite's planted names, which `deep-show run` refuses (`{"ok": false, "code": "bad_input"}`).
At the base the duel and the co-op piece are presented and their matches play, the paddle piece without its net item
gives its frames, and the paddle piece's messages of two entries already make frames under 128 B; a message carrying
one draw.commit is 110 B larger than the same message without draw_after, one carrying a draw.reveal 105 B. Every test
fails at the base and none is a guard; `BASE-FAILURE.txt` is the run.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH. In a fresh worktree run `npm ci` and `npm run build
--workspaces` once (the lease runs through `packages/cli/dist`). Then run one file at a time, each under the machine's
lease:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
for f in ac1-interop ac2-shot-dropped ac3-fifty-rollbacks ac4-budgets ac5-coop-saves; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/553 $f.test.ts --testTimeout=600000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/553/tsconfig.json   # type check
rm -rf tests/acceptance/553/node_modules                                      # vitest's cache after a --root run
```

Every `it` and every build hook passes its own timeout (#549's `TIMEOUT`, 5,400,000 ms), which `--testTimeout` doesn't
shorten. Each file builds `deep-show` (`cargo build --locked --bin deep-show --no-default-features --features full`, #549's
`useBuilds`, the binary copied out of the target) in `beforeAll`.

| File | Starts |
|---|---|
| `ac1-interop.test.ts` | the interop part twice (`node scripts/net-interop.mjs`, which builds and starts what it plays: README, The interop part), then `deep-show run` once (the replay) |
| `ac2-shot-dropped.test.ts` | `deep-show run` twice, a `match` of 400 steps with net.rollback each |
| `ac3-fifty-rollbacks.test.ts` | `deep-show run` three times, a `match` of 1,600 steps each |
| `ac4-budgets.test.ts` | `deep-show run` six times: two `match`es with net.budget, three with the relay's log, one `frames` |
| `ac5-coop-saves.test.ts` | `deep-show run` twice, a `match` of 900 steps each |

- **Processes and hosts.** Every `deep-show` is stopped by its PID after its test (#549's `useChildren`); the interop
  part by its PID (SIGTERM, then SIGKILL 10 s on), and it stops what it started by PID. In process nothing listens or
  opens a connection: `https://relay.test/553` is declared by pieces that `match` plays in one process.
- **Folders.** Evidence stores, saves folders and the interop part's inputs are temporary and deleted after each test.
- **Imports.** Node built-ins, vitest, `../549/helpers.ts`, `../549/fixtures.ts`, `../551/helpers.ts`,
  `../551/fixtures.ts`, `../552/fixtures.ts` (read only) and `scripts/benchmark.mjs`.

**Gates.** None is ever a pass. `BLOCKED:` when cargo can't run, or when the interop part reports BLOCKED (no openssl,
no Chrome, no WebGPU adapter headless), with its reason. `INCONCLUSIVE:` when the interop part reports INCONCLUSIVE or
doesn't finish in 40 minutes under a load above the core count (#549's `gaveUp`), and for criterion 4's times off a
reference Mac, under load or undecided by the five runs (`judgeLimit`).

## The lanes line

`scripts/lanes.mjs`, beside #552's (this job wrote it):

```js
// #553's files each build deep-show and play matches in process, rendering each copy's sound; ac1 runs the network
// seam's interop part, which builds deep-show and the shipped relay and plays the app against headless Chrome's web
// player through it, and ac4 reads net.budget's five runs (INCONCLUSIVE off a reference Mac or under load).
alone.push('tests/acceptance/553/');
```

Criterion 4 reads times through net.budget's own five runs, as #551's suite does; no file times anything itself, so
none is listed `timed`. No file is by hand.

## Criteria to tests

IDs are `#553.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue. Each test's name starts `AC<n> #553.<h8>`;
each file quotes its criterion in full and names the wrong programs it fails.

| AC | ID | File (tests) | Surface | What it asserts | Plants and twins |
|---|---|---|---|---|---|
| 1 | `#553.f47ade22` | `ac1-interop.test.ts` (2) | the interop part; `replay` (#551's) | The paddle piece, 1,200 steps, seed 553: the part reads PASS with no failure and net.rollback PASS; the app's backend is `network.macos` and the web's another; the test relay delayed, dropped, duplicated and reordered frames, at least one a step; the app's copy is player 1 and ran 1,200 steps, the web's player 2; both rolled back; both confirmed all but 3 windows; the records hold at least 10 entries of each player and the same merged track; both hold the same occurrences, at least one; each copy's full-state hash at every confirmed step is a replay of the app's record's. The planted part: FAIL, a failure with `field: "first"` and `backend` the web's, none naming the app's | `--planted web_writes_step_big_endian` |
| 2 | `#553.369b7549` | `ac2-shot-dropped.test.ts` (2) | `match` with `relay.deliver` and `check: "net.rollback"`; a copy's `voices`, `audio`, its WAV | The duel, 400 steps, player 2's step-295 message late to copy 1 until it ran step 300: net.rollback PASS; copy 1 rolled back to 295 from 300 or later; neither copy holds a shot at 300, both hold exactly the shots the run makes, row for row the same lists; the hashes agree at every confirmed step; copy 1 started one voice of the shot at 300 (spawn `bang`), which fades over 5 ms of output (240 samples at 48 kHz) after it began, and its WAV shows the tone before the fade, a loud first quarter, a quieter last and silence after; copy 2 started none for 300; every other voice is one for each shot the run makes, never faded. The planted rollback: net.rollback FAIL, a failure with `step` 300 and `kind` `shot` | `net_keeps_replaced_rows` |
| 3 | `#553.265463c7` | `ac3-fifty-rollbacks.test.ts` (3) | `match` with `relay.deliver`; a copy's `voices`, `audio.blocks`, `desync` | The duel, 1,600 steps, 50 cycles each late to copy 1 until it ran the shot's step: both copies run 1,600 steps with no desync or fault and agree at every confirmed step; copy 1 rolled back over each cycle's shot; copy 1's voices are one for each of the 50 shots, faded over 5 ms exactly in the 13 cycles whose turn ended, copy 2's one for each of the 37 made; both audio threads rendered every sample once and in order from 0 past the last voice's end. The planted media module: the judge fails, naming the first sample rendered again. The planted hash: both copies end `desync` with net.desync, and the judge fails | `media_restores_checkpoint`; `net_hash_covers_media` |
| 4 | `#553.b6df6698` | `ac4-budgets.test.ts` (4) | `match` with `check: "net.budget"` (`runs[].window_ms`, `checkpoint_ms`, `step_ms`; `window`, `rollback_snapshot_bytes`); the relay's log (`bytes`, `messages`); `frames` (`net_ns`, `ran`) | The paddle piece (window 8): five runs each restoring a window and taking checkpoints, `window_ms` under 4 and `checkpoint_ms` under 0.5 by `judgeLimit`. The army in lockstep: `window` 0, every run's `window_ms` and `checkpoint_ms` 0, no snapshot bytes, `step_ms` under 4 by `judgeLimit`. The paddle piece's frames: at least 10 messages of two entries, each with the 27-byte header and its u16 length under 128 B, as is every frame of one such step. The dice piece: at least 10 messages carrying one commitment and 10 one reveal, each under 64 B larger than the same player's message for the same step without draw_after. The paddle piece without its net item: `net_ns` 0 on every one of 240 frames, which ran nodes | the merge base's message format |
| 5 | `#553.7ab062d9` | `ac5-coop-saves.test.ts` (2) | `match` with `relay.deliver` and `saves_dir`; a copy's `saves`; save files' headers | The co-op piece, 900 steps, the shields at 295 and 695 late to copy 1 until it ran 300 and 700: each copy wrote exactly one save, slot 1's at step 120, not ended, and its folder keeps exactly that save; each ran 900 steps and its record ends healthy (end and record.end null or `left`, no fault, no desync); copy 1 rolled back to 295 from 300 or later and to 695 from 700 or later; the hashes agree at every confirmed step. The planted module: the judge fails, naming slot 1's ended save at a step from 296 to 301 | `net_saves_predicted` |

Test count: 2 + 2 + 3 + 4 + 2 = 13.

## The surface under test

The issue names an interop part, the shipped relay, the test relay's faults, net.rollback, net.desync, occurrence
lists, a voice's fade, the audio thread's samples, saves, `ends`, a trap, budgets and planted programs, but no call. As
#549's to #552's suites do, everything in the app is driven through `deep-show run` (#393: one JSON scenario on stdin,
one answer line `{"ok": true, "replies": [...]}`), every match in process through `match` (the design's test relay:
"Each runs copies of the piece in one process over a test relay, with no network"), and the interop part through a
script of the network seam's suite. **Every call, member, field and name below is marked as the issue's or the
design's own, an earlier suite's, or this job's choice. The implementer builds exactly these, or a dispute goes to a
blind redraft.** Times are flicks in calls (705,600,000 a second), output samples counted from the match's start at
the pieces' 48 kHz, and ms where a field says so.

### The scenario

#549's world (`scenario`: one agent's session, your shell's peer pid 3002, #383's clock, each document on a panel of its
own), plus `planted` (Planted twins, below).

### `match`'s members

#549's to #552's (`doc`, `steps`, `plays`, `relay.seed`, `relay.log`, `relay.deliver`, `check`, `secure`), and:

| Member | What | Whose |
|---|---|---|
| **`saves_dir`** | a folder; each copy keeps its saves in `<saves_dir>/<player>/` as the `logic` call's `saves_dir` keeps a piece's (#189): `<sha256>.save` files, #534's format, a JSON header line holding at least `slot`, `step` and `ended`. A save, an ended slot or a carry record a copy's steps ask for takes effect once its step is confirmed, from that step's state. Without it no copy writes a save | this job's |

### A copy's report

#549's, #550's and #551's (`player`, `ran`, `rollbacks`, `rolled_back`, `occurrences`, `hashes`, `end`, `desync`,
`fault`, `record` with `confirmed` and `track`), in `match`'s `copies` and in the interop part's `copies`, with:

| Field | What | Whose |
|---|---|---|
| **`voices`** | `[{spawn, step, kind, a, b, start, faded}]`: every voice the copy's media module started from an occurrence while it played the match, live, in start order, each once (a voice from an occurrence a corrected run makes again is the same voice): `spawn` its spawn's ID; `step`, `kind`, `a`, `b` its occurrence's; `start` the output sample it began at; `faded` null, or `{from, to}`, the output samples [from, to) over which it faded to silence once a rollback dropped its occurrence. A copy of a piece with spawns always reports it | this job's |
| **`audio`** | `{sample_rate, blocks: [{from, count}], wav}`: the copy's audio thread as it played the match on the relay's clock: every block it rendered, in the order it rendered them, `from` the output sample of the block's first; `wav` the SHA-256 of a WAV (IEEE float 32-bit or PCM 16-bit, any channel count) in the scenario's evidence store holding every sample it rendered, in render order | this job's |
| **`saves`** | `[{item, slot, step, hash, file, ended}]`: each save the copy wrote, once it read back whole, #189's `SaveWritten` | the shape #189's; the field this job's |

### A check's report

- **net.rollback** (#551's): each failure names the `step` it found; a failure for an occurrence a copy keeps that the
  on-time run doesn't make also names its **`kind`** (this job's).
- **net.budget** (#551's): `runs`, five runs after warm-up, each `{step, step_ms, window_ms}` and **`checkpoint_ms`**
  (this job's): the CPU time of the rollback checkpoints every canvas module with carried state but media took at that
  run's live match step, 0 when none is taken, as in lockstep; `window`; `rollback_snapshot_bytes` (#549's, 0 in
  lockstep).

### The relay's log

#549's rows with #550's `bytes` (the frame as hex, read in relay@1's documented layout: match 16 B, player u8,
confirmed u32, first u32, count u16, then each step as a u16 length and its bytes) and #552's `messages` (each step's
message as the net module's codec reads it back, `entries` among its members). An entry's name is the first element of
an `[name, value]` entry, or an entry object's `kind` or `control`; a draw's are `draw.commit` and `draw.reveal`.

### `frames`

#856's call, `{doc, step: "1f", count}` (from 0, one frame apart), each frame with #387's `ran`, and **`net_ns`** (this job's): the CPU time the
net module took in that frame (its match, prediction, rollback ring, the voices it fades and the saves it holds), 0 for
a piece with no net item.

### The interop part

The issue's: the network seam's suite (#140) gains an interop part, run in the local preflight. This job's: it is
`scripts/net-interop.mjs`, which the `seams` lane runs as the network seam's interop part.

```sh
node scripts/net-interop.mjs --doc <file> --evidence <dir> --plays <file> --steps <n> --seed <n> [--planted web_writes_step_big_endian]
```

- **What it plays.** It builds what it runs (`cargo build --locked --bin deep-show --bin deep-relay`, honoring
  `CARGO_TARGET_DIR`) and makes a throwaway certificate with the `openssl` CLI; starts the shipped relay on 127.0.0.1
  behind the network seam's test relay, whose faults, seeded by `--seed`, delay, drop, duplicate and reorder relay@1
  frames between each copy and the relay; points the piece's net item at that test relay; exports the web bundle. The
  app's copy (`deep-show run`: a person's click on Join, then `play_match` with player 1's script from `--plays` and
  `--steps`) opens the match as player 1, on the macOS backend. Headless Chrome's web player joins through the first
  player's link by a person's click as player 2, on the web's backend; its person presses keys the piece's controls name
  in `keys`, at least one a second, as player 2's entries (the web player takes no entries from a host page). The
  document is `--doc` (#391's envelope), its programs in the evidence store `--evidence`; `--plays` is `{"1": [{step,
  control, value}]}`, as `match`'s `plays`. It stops everything it started by PID, also when it is sent SIGTERM.
- **What it reports.** It prints its findings, then a last line `{"interop": Report}`, and exits 0 on PASS, 1 on FAIL, 2
  on INCONCLUSIVE and 3 on BLOCKED:

  ```text
  Report = {status: PASS | FAIL | INCONCLUSIVE | BLOCKED, reason?, steps, seed,
            backends: {app: {name, version}, web: {name, version}},
            relay: {frames, delayed, dropped, duplicated, reordered},
            check: {kind: "net.rollback", verdict, failures},
            failures: [{backend, field?, step?, what}],
            copies: {app: <a copy's report>, web: <a copy's report>}}
  ```

  `relay`: what the test relay did. `check`: net.rollback on the two copies, PASS when they reach the on-time run's
  full-state hash at every confirmed step, hold no occurrence from a replaced step and record its merged track.
  `failures`: everything that failed the part, each naming the backend whose copy or frame it found (`backend`, as
  `backends` names it), and, for a frame that doesn't read in relay@1's documented little-endian layout, the field
  (`field`, as the layout names it). `copies`: each copy's report as its own backend's copy gives it (`play_match`'s
  reply, `probe().match`). BLOCKED with a `reason` and its unblock when openssl, Chrome or a WebGPU adapter is missing;
  INCONCLUSIVE when a live phase didn't finish under a load above the core count.

### Planted twins

Each is one criterion's wrong program, reachable only through the scenario's `planted` (or the interop part's
`--planted`), and changes nothing else. The names are this job's; the programs are the issue's.

| Name | Criterion | The wrong program | The test |
|---|---|---|---|
| `web_writes_step_big_endian` (`--planted`) | 1 | the web player's network backend writes each frame's `first` big-endian | the part fails, a failure naming `first` and the web's backend |
| `net_keeps_replaced_rows` | 2 | a rollback keeps the occurrence rows of the steps it replaces, beside the rows the corrected run makes | net.rollback fails, naming step 300 and the kind `shot` |
| `media_restores_checkpoint` | 3 | the media module keeps a checkpoint of its own state (its voices and its write head) at each match step and restores it on a rollback, so its audio thread renders the replaced steps' samples again | the judge fails, naming the first sample rendered again |
| `net_hash_covers_media` | 3 | the full-state hash also covers media's state (its live voices and its write head) | both copies end with net.desync and the judge fails |
| `net_saves_predicted` | 5 | a save, an ended slot or a carry record is written when its step runs, whether or not the step is confirmed | the judge fails, naming slot 1 and the ended save's step |

Criterion 4 names no planted program; its wrong program is a build over a limit, as the merge base's commitment is.

## Fixtures

All made at test time in `fixtures.ts`; no personal data; CC0. Programs are WebAssembly written as bytes (MVP
instructions, no import), each exporting `memory` (one page, maximum = minimum), `init`, `step`, `reads_at` 0,
`writes_at` 4096 and, with emits, `emits_at` 12,288. Each reads two sliders, named alphabetically, a slot of 264 B each
(a u32 count and 4 zero bytes, then entries of a u32 player, 4 zero bytes and the f64 value); each write is an i32 on an
8-byte boundary, the names alphabetical in declaration order.

- **The duel** (`duelDoc`, criteria 2 and 3): a 3D scene, 640 × 360, 48 kHz; the sliders `fire` (0 to 1 by 0.5) and
  `turn` (0 to 1 by 0.25); the logic item `duel` (60 Hz, reading both, writing `blocked` and `shots`, emitting `shot
  {power: f64}`); the spawn `bang` on `duel.occurrences` filtered to `shot`, playing #552's tone (0.25 s of a 1 kHz
  cosine at 0.5, a 16-bit WAV in the evidence store); the net item `match` (2 players, 60 Hz, delay 2, window 8, a
  hash every step). `duel` (`duelProgram`): a `turn` entry at or above 0.5 sets `blocked` to its step + 10; a `fire`
  entry at or after `blocked` emits one `shot` row (a its step, b 1, power its value) and counts into `shots`.
  `duelPlays`: in cycle n, player 1's fire lands at step 60 + 30n and player 2's turn entry 5 steps before it, ending the
  turn when n ≡ 0 (mod 4), else 0 or 0.25. `lateTurns`: player 2's message for cycle n's turn step reaches copy 1 only
  once copy 1 has run the shot's step.
- **The co-op piece** (`coopDoc`, criterion 5): the sliders `go` and `shield` (0 to 1 by 1); the logic item `coop`
  (60 Hz, writing `ends`, `hp` and `request`, `saves: {slots: 1, request: "request", ends: "ends"}`); the net item as the
  duel's. `coop` (`coopProgram`): `hp` 100 from `init`; a `shield` entry shields the hero for 10 steps; step 119 writes 1
  into `request`; at step 300 an unshielded hero with hp dies (hp 0, 1 into `ends`); at step 700 an unshielded hero
  meets the trap (`unreachable`); `go` entries count into a word of its own. Player 1 goes every 50 steps from 10;
  player 2 shields at 295 and 695 (`coopPlays`); each shield reaches copy 1 only once it has run step 300, or 700
  (`lateShields`).
- **The paddle piece** (#551's `paddleDoc`, its `rulesProgram` and `rally`): criteria 1 and 4; criterion 1 with a hash
  every step and a timeout of 120 s, as #551's live match. **The army** (#549's `lockstepDoc`, `armyProgram`, `scripts`):
  300 units at 20 Hz, window 0. **The dice piece** (#552's `diceDoc`, `diceProgram`, `attacks`): with and without
  `draw_after`. **A piece without the net module**: the paddle piece with its net item and `net` module taken out.
- **The scratch run.** Both programs were run in Node's own WebAssembly with the read region filled as above: on time
  the duel makes exactly the 37 shots of the cycles whose turn didn't end, none at step 300; without player 2's entry
  at 295 it shoots at step 300; on time the co-op piece asks for slot 1 at step 119, never writes `ends` and never traps;
  without the shield at 295 it writes `ends` at step 300 with hp 0; without the one at 695 it traps at step 700.

## Readings where the issue and the design leave a choice

- **"The interop part"** (criterion 1): the network seam's suite part the Scope adds, run in the local preflight, so the
  test runs it and reads its report; "pass net.rollback together" is its net.rollback on the two copies, which the
  test holds to the substance by a replay of the app's record and the two records. **"Behind the test relay's
  faults"**: the network seam's test relay (#140: "a test relay that delays, drops, duplicates and reorders") between
  each copy and the shipped relay; its counts must each be above 0. **"The two-player piece"**: #551's paddle piece.
  **"Naming the field and the backend"**: a failure's `field` `first` (relay@1's frame field that holds a frame's
  first step, as #309's suite names it) and `backend`, the web's backend name.
- **"A late entry from player 2 at step 295 … at step 300"** (criterion 2): the entry is stamped at 295 and reaches copy
  1 once it has run 300, so copy 1 shot at 300 on a prediction. **"The row is dropped"**: no `shot` row at step 300 in
  either copy's occurrence list. **"Its voice fades out over 5 ms"**: `faded` spans 5 ms of output after the voice
  began, and the rendered samples show it. **"Naming the step and the kind"**: a net.rollback failure's `step` and
  `kind`.
- **"In that match, across 50 rollbacks that each replace a step whose shot spawned a voice"** (criterion 3): the same
  duel with 50 cycles, each late to copy 1 until it ran the shot's step; copy 1 rolls back over each. **"Renders each
  output sample once and in order"**: the audio thread's blocks, in render order, tile the output from sample 0 with no
  gap and no overlap. **"Naming the first"**: the judge names the first sample rendered a second time. **"Stops the
  match with net.desync"**: both copies end `desync`, each reporting net.desync.
- **Budgets** (criterion 4): "compared with the merge base" is the budget window's record for the change's commit
  (`docs/parallel-proof.md`, section 12a), which compares each task with the merge base; this file judges the issue's
  limits by the five-run rule. "Restores and steps again" is a run's `window_ms`; "one match step's checkpoints" its
  `checkpoint_ms`; "the busiest 20 Hz match step" in lockstep a run's `step_ms`. **"A frame with one step outstanding
  and two entries"**: relay@1's 27-byte header and one step's u16 length and message of two entries, computed from each
  such message the log holds, and read whole from any frame that carries only it. **"Add under 64 B to their
  messages"**: each message that carries one commitment, or one reveal, is under 64 B larger than the same player's
  message for the same step, with the same other entries, in the same match without draw_after. **"Gains no work per
  frame"**: `net_ns` 0 on every frame of a piece with no net item.
- **"Leaves the slot's earlier save in place"** (criterion 5): the step-120 save is the one save each copy wrote and the
  one its folder keeps. **"The record ends healthy"**: `end` and `record.end` null or `left`, no fault, no desync.
  **"Naming the slot and the step"**: the judge's failure names slot 1 and the step of the ended save the predicted death
  wrote. **"A trap only a predicted step reached"**: step 700, run by copy 1 before the shield at 695 reached it; "both
  copies playing with equal hashes": both run 900 steps and agree at every confirmed step.

## Not tested, because no criterion reaches it here

A carry record in a match; a trap still in a step once it is confirmed (#551's and #550's); the interop part's run in
the `seams` lane (the Scope's, this README is the instruction); net.feel; the media module's lead on the audio write head
counting toward the window. They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- In the net module and `deep-show`'s `match`: `saves_dir`, and saves, ended slots and carry records held to confirmed
  steps; a copy's `voices`, `audio` and `saves`; net.rollback's failure `kind`; net.budget's `checkpoint_ms`; the four
  scenario planted names.
- In the media module: live voices in a match, a voice from a dropped occurrence fading over 5 ms, no rollback ring.
- `frames`' `net_ns`.
- `scripts/net-interop.mjs`, the interop part, with its planted web backend, and the `seams` lane running it.
