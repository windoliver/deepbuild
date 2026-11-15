# Acceptance tests for #1164: the first rule game, tic-tac-toe whose rules run as sandboxed logic at a fixed step, played with keys in the app, replayed to the same frames and seeked the same as played

Written first, blind, from issue #1164 (its Scope, its seven acceptance criteria and its Proof line, read live on
November 15, 2026, with its one comment), the design sections it links and the base, by a job that never saw an
implementation; none existed, and no other worktree, branch, pull request or session was read. The base is this
worktree's HEAD, `dc9b43154` ("Merge pull request #2578: radius-bounded ambient visibility"), which holds main's
`0e5572731` ("Merge pull request #2529 …") and one later merge that touches no logic, input or hub code. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). The issue has no oracle page.

## What was read

- The issue, live (`gh issue view 1164 --repo windoliver/deepbuild --comments`); its comment says #1724's dry run plays
  this game through the live hub once `logic` is in the build.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks); Dogfooding; Wrong
  programs ("A planted wrong program lives in test code, or behind a build feature a release build refuses to compile,
  and is never chosen by an environment variable"); Tests written first.
- `docs/canvas-primitives.md`: Input track (a seek or a scrub only moves the playhead and leaves the hash; a new entry
  where later entries exist forks the track at its flick, drops them and records `fork_at`); Logic `logic@1` (fields,
  exports, the read region's control slots, a trap freezes only its item); Logic: sandbox; Logic: checkpoints and bake
  (full-state hashes at checkpoints; equal step hashes only locate where outputs part); Check input: logic kinds
  (`logic.determinism {at_times, compare}`, `logic.budget {fuel_share, on}`, `logic.trap {item, step, t, kind,
  function, offset, inputs}`); Control (`keys: {key → value}`, a press); Driver.
- At the base, for surfaces and conventions only: AGENTS.md; `scripts/proof-change.mjs` (criterion IDs); the suites
  `1162/` (`deep show` from a test process in the agent's tree, the claim, `verdict`, the taste call), `1163/` (the
  shown test, `docs/evidence/<n>/`), `531/` (its Rust `rules/` crate, `deep-sandbox`'s `check` and `rewrite` in the role
  logic), `532/`, `533/` (logic in documents, the evidence store), `539/` (`deep-show run` on the scope's virtual clock,
  `input` keys, the `logic` call), `548/` (deep_query's logic read, `flock-rs/`), `384/` (the `playhead` control);
  `crates/deep-show/src/` (`main.rs`'s call list and `planted` names, `logic.rs`'s `logic_read`, `picks.rs`'s `logic`
  call with `seeks` and `check`, `played.rs`'s track and `enter`, `input.rs`'s key routing, `time.rs`'s `determinism`),
  `crates/deep-logic/src/` (`lib.rs`'s planted names, `module.rs`'s logic.determinism and logic.budget, `piece.rs`'s slot
  sizes and 8-byte-aligned writes), `crates/deep-canvas-input/src/track.rs` (`fork_at`, the track's hash),
  `crates/deep-sandbox-wasmtime/src/service.rs`, `crates/deep-show/tests/logic_canvas.rs`.

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and this suite's own
program.

## What the base has

See `BASE-FAILURE.txt` for the run. The base runs a document's logic items in the hub (#533), reads them with `eval`'s
`arrays`, deep_query's logic read (`region_map`, each step's arrays and fuel, `trap`, #548) and the `logic` call
(steps, hashes, arrays, checkpoints, `seeks`, `check: "logic.determinism"`, #539, #213, #548); registers
logic.determinism and logic.budget as claim checks; keeps the hub's input track per document; and has #532's planted
`check_compares_step_hashes` in `deep-logic`. It has no `track` call, no `hash` in deep_query's logic read, no
`steps` in a seek, no `restore_zeroes_move_count`, no list form of `planted`, and no `docs/evidence/1164/`.

What the run found. The base refuses the game itself: `deep show` answers with `ref_unresolved` at
`drivers/o1_shown/vars/b` ("motion's drivers read only a logic item's scalar f64 output"), so a driver can't read
the cell's entry in `rules.board`, an i32 array of nine, as the issue's Scope asks. Every test that plays the game
fails there, and AC3 and AC5 fail earlier on the missing `track` call (the whole scenario `bad_input`). To learn what
lies behind that refusal, and to check this suite's judgements against the real hub, two debug runs were made and
undone before this commit, changing no expectation: one without the drivers, where each digit key appends nothing
(a press control's `keys` doesn't reach its control at the base); and one without the drivers that sent each press
as a control event (`{type: control, control: cN, value: 1}`) in place of its key. In that run the base passes both
AC2 tests and AC6's first: the presses land at steps 30, 60, …, 210, the board and winner read as the issue says,
`takes_taken_cell` fails naming step 60 and `rules.board`, and logic.budget passes with every step far under half its
fuel. Still behind it there: AC6's `loops_on_9` claim reads PASS, because the claim's logic checks bake the document
without the hub's input track (logic.budget's worst step is step 0, 318 fuel), so they never see the press of 9;
AC4 stops at the missing `seeks[].steps` (its `determinism` over 57 times took about 23 minutes on a loaded Mac) and
at the missing planted name. `BASE-FAILURE.txt` has the base run and both debug summaries.

## Run them

```sh
npm ci && npm run build --workspaces        # once, in a fresh worktree
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 30 -- \
  scripts/lease cargo build --locked --bin deep-show --no-default-features --features full
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 30 -- \
  scripts/lease cargo build --locked --bin deep-sandbox
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run \
  --root tests/acceptance/1164 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1164/tsconfig.json
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set;
helpers.ts puts Homebrew's rustup on PATH when present), each once per file in `beforeAll` and copied out of the target
folder (a no-op after the leased builds above when the environment matches):

- **`deep-show`**: `cargo build --locked --bin deep-show --no-default-features --features full`.
- **`deep-sandbox`** (#238's runner, AC1 only): `cargo build --locked --bin deep-sandbox`.
- **The rules program** `rules/` (crate `acceptance-1164-rules`, no dependencies, outside the workspace by its empty
  `[workspace]` table, its own `Cargo.lock`, `panic = "abort"`): `cargo build --locked --release --target
  wasm32-unknown-unknown [--features <one>]` run in `rules/` (so the checkout's `rust-toolchain.toml`, 1.99.1 with its
  wasm32 target, and `.cargo/config.toml` apply), into `target/acceptance-1164-rules/<name>/`; link arguments
  (build.rs) give one memory of two pages whose maximum is its minimum. Each program's bytes go into each test's
  evidence store at their SHA-256 (`<2 hex>/<62 hex>`), and the document names them there.

Every test passes a 90-minute timeout; the shown test 60 s. Each test's evidence store is a temporary folder, deleted
after it; what each test read is written to `$TMPDIR/deep-1164-proof/` (the issue's Proof line) and never read back.
Node built-ins and vitest only. No process is started but cargo, `deep-show` and `deep-sandbox`, each waited for and
stopped only by `spawnSync`'s own timeout on the child it started. Gates, none a pass: no cargo is `BLOCKED:`; a rules
program that doesn't build is `BLOCKED:` with cargo's error; AC7 is `INCONCLUSIVE:` until its files and its taste call
exist.

The harness was checked before the base run: all four rules builds compile; run unrewritten in Node's own WebAssembly
on a hand-made read region with the seven presses at steps 30, 60, …, 210, `rules` gives the issue's boards at each
press, winner 1 from step 180 and [1, 1, 1, 2, 2, 0, 0, 0, 0] at the end, its move count 5; `takes_taken_cell` writes
2 to cell 1 at step 60; `imports_function` imports `env.note`; no build imports anything else, and each exports
`memory`, `init`, `step`, `reads_at`, `writes_at` and `moves_at`.

## The surface under test

The issue names `deep show` from a test process standing in for an agent, the claim with logic.determinism and
logic.budget, deep_query, the input track with its hash and `fork_at`, seeks, render-back snapshots, the app at the
reference window and four wrong programs, but no call API. As in #1162's and #539's suites everything goes through
`deep-show run` (#393's scenario binary: one JSON scenario on stdin, one `{"ok": true, "replies": […]}` line, exit 0)
with the merged calls unchanged, adding only what a criterion needs and the base lacks. **Every name the issue or the
design doesn't give is marked *(chosen)*; the implementer builds exactly these, or a dispute goes to a blind
redraft.** Times are flicks (705,600,000 a second; a step of `rules` is 23,520,000).

**The world** (#1162's): the agent session `sess-game` (process 4100), its tool shell 4101 and the test process 4102
that runs `deep show` (`peer: {pid: 4102, start: 1200}`); one panel `main` (600 × 600 px) showing the document
`01JB1164D00000000000000001`; the claim `claim:01JB1164C00000000000000001` (#403's form) whose deliverable is the
document, with two requirements: `logic.determinism {at_times: [1s … 7s, 7.5s], compare: same_machine}` and
`logic.budget {fuel_share: 0.5, on: [app]}`. **The app** is the scope's virtual clock (`clock: {refresh_hz: 120, lead:
2 ms, check: 0.5 ms}`, `display: [1600, 900]`, #539's), every call at its `at`; **a fresh headless process** is
another `deep-show run` whose scenario has no clock and no display.

| Call | Request fields | Reply fields read | New or existing |
|---|---|---|---|
| `deep show` | `peer`, `doc`, `document`, `check: true`, `claim`, `include: ["issues"]` | `outcome`, `issues` (`code`, `severity`, `ids`, `path`, and any field holding `refusals`) | existing (#393, #403) |
| `input` | `panel`, `event: {type: "key", key: "1"…"9"}`; `{type: "down" \| "up", pos}`; `{type: "control", control: "playhead", value: flick}` | `appended` (one entry `{t, control, value, …}` per key) | existing (#383, #504, #384); a press control's `keys` reaching its control is the implementer's |
| **`track`** *(chosen)* | `doc`, **`load?: [Entry]`** *(chosen)* | `track: [Entry]` (the hub's input track of the document, in order), `hash` (the track's hash, `deep_canvas_input::track`'s: its entries and `fork_at`), `fork_at` (flick or null) | new. With `load`, the hub's track for the document becomes exactly those entries first: how a fresh process replays a recorded track |
| `logic` | `doc`, `steps: 360`, `seeks?: [{to: step}]`, `check?: "logic.determinism"`, `at_times?: [s]` | `steps[k].{step, hash.rules, arrays}`, `checkpoints.rules[].{step, deep_hash}`, `seeks[].{to, from, checkpoint: {step, deep_hash.rules}}`, **`seeks[].steps`** *(chosen)*, `check.verdict` | existing (#539, #213, #548); `seeks[].steps` new: each step the seek ran from `to` through its first checkpoint after `to`, in the form of `steps[k]` |
| `deep_query` | `session`, `doc`, `what: "logic"`, `items: ["rules"]`, `steps: [k]` | `logic.rules.{region_map, steps[].{step, arrays, fuel}, trap}`, **`logic.rules.hash`** *(chosen)* | existing (#548); `hash` new: the SHA-256 of the bytes the engine runs (#531's `Checked.hash`) |
| `eval` | `doc`, `t`, `pixels: true` | `snapshots[0].sha256` | existing (#387) |
| `determinism` | `doc`, `display_hz: 60`, `at_times: [flick]` | `frames[].{t, play.pixels, seek.pixels}` | existing (#488) |
| `revisions` | `doc` | the `current` revision's `hash` | existing |
| `verdict` | `claim` | `result`, `key.revisions[].{doc, hash}`, `requirements[].{id, result}` | existing (#403) |
| scenario `planted` | one name, or **a list of names applied together** *(chosen)* | | existing form; the list is new |
| `deep-sandbox` | `{call: "rewrite" \| "check", program: base64, role: "logic"}` | `hash`; `code`, `refusals` | existing (#238, #531) |

### The document

As the agent sends it (no `id`, no `layers`, no item `layer`), `helpers.ts` `game(sha)`: a `figure` (not a film,
whose viewer takes the digit keys), 600 × 600 u, `seed` 1164, `camera: "cam"` (a 2D orthographic `camera@1` over the
page), `transport: {span: "12s", frame_rate: [30, 1]}`, `requires.modules: {input: "^1", logic: "^1"}`, the program
in `assets.rules_program` by SHA-256 with a CC0 license.

- **`rules`** (`logic@1`): `program` (its SHA-256), `step_rate: 30`, `reads: [c1 … c9]`, `writes: {board: {type: i32,
  count: 9}, winner: {type: i32}}`, `budget: {fuel: 1000000}`.
- **Controls** `c1` to `c9`: `{kind: "press", class: "document", label: "Cell n", role: "button", keys: {"n": 1}}`.
- **The board**: `grid` (a `path@1` of the four lines) and nine cells, each an X path `x<n>` and an O path `o<n>`
  (`path@1`, `adjust: {opacity: 0}`), and per cell two drivers: `items/x<n>/adjust/opacity` = `max(0, 1 − abs(b − 1))`
  and `items/o<n>/adjust/opacity` = `max(0, 1 − abs(b − 2))`, `b` reading `rules.board[n − 1]`, so a cell shows X for
  1, O for 2 and nothing for 0.

**The rules program** (`rules/src/lib.rs`): hot-seat tic-tac-toe. Its read region holds each press control's 264 B
slot (a u32 count, 4 zero bytes, 16 entries of a u32 player, 4 zero bytes and an f64), c1 to c9 in order, then the
seed; its write region `board` at 0 and `winner` at 40. A step with no winner yet puts the mover's mark on each pressed
empty cell (X, 1, when the board holds an even number of marks, else O, 2), a taken cell changes nothing, and three in
a line writes `winner`; after that, presses change nothing. Its move count lives only in memory and changes no array or
later move; it exports the immutable global **`moves_at`** *(chosen)*, the count's address, so the planted restore can
find it. Before any test relies on that layout, AC2 checks it in deep_query's region map.

### The play

The issue's Scope, in the app on the virtual clock (`Script` in helpers.ts): `deep show` at flick 2; a click on the
board's corner at 0.5 s, so the panel holds the keys; then one key a second from 1 s: `1` (X), `1` (O, a taken cell),
`4` (O), `2` (X), `5` (O), `3` (X, a win), `9` (O, after the end). Each press must append exactly one entry on its
control. The reads follow from 9 s, a millisecond apart. At 30 steps a second the presses' steps are 30, 60, …, 210.

## Planted wrong programs

Each fails its criterion's judgement, which names the criterion's ID in its failure.

| Name | Where | Criterion | The wrong program | What its failure names |
|---|---|---|---|---|
| `imports_function` *(chosen)* | cargo feature of `rules/` | AC1 | the rules program whose step calls `env.note`, which it imports | `AC1 #1164.29c6a1db item rules: …` |
| `takes_taken_cell` *(chosen)* | cargo feature of `rules/` | AC2 | a press on a taken cell puts the mover's mark there: 2 on cell 1 at step 60 | `AC2 #1164.fb851e24 step 60 …: rules.board reads …` |
| `restore_zeroes_move_count` *(chosen)* | scenario `planted` | AC4 | a restore made for a seek to 7.5 s (step 225; a `logic` seek or logic.determinism's restores toward a sample at 7.5 s) zeroes the u32 at the program's `moves_at`; every other restore is the real one | `AC4 #1164.bfcc143f … the full-state hash of checkpoint 240 …` |
| `check_compares_step_hashes` | scenario `planted`, beside the one above | AC4 | #532's twin in `deep-logic`: logic.determinism compares step hashes alone; reached here through the scenario, applied with `restore_zeroes_move_count` as a list *(chosen)* | `AC4 #1164.bfcc143f logic.determinism reads PASS … step hashes alone` |
| `loops_on_9` *(chosen)* | cargo feature of `rules/` | AC6 | a press of 9 loops forever, before the program looks at the winner | `AC6 #1164.9ffde386 logic.budget reads … / rules trapped …` |

The guest programs are test code; the two host twins are reached only through the scenario's `planted`, never an
environment variable, as the base's planted names are. Any other `planted` value stays `bad_input`.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#1164.` + the first 8 hex digits of the SHA-256 of each criterion's text,
trimmed, white space collapsed. Each test's name starts with `AC<n> #1164.<id>`; each file's head quotes its criterion.
Eleven tests: one per criterion and one per wrong program.

| AC | ID | File | Tests, and the wrong program each fails on |
|---|---|---|---|
| 1 | `#1164.29c6a1db` | `ac1-present.test.ts` (2) | Headless: `deep show --check` presents the game with `issues: []`; deep_query's `hash` equals `deep-sandbox rewrite`'s hash in the role logic and isn't the program's own SHA-256; the same piece naming `imports_function` isn't presented, an error naming `rules` carries `refusals` equal to `deep-sandbox check`'s; the current revision's hash is unchanged. Wrong program: `imports_function`, judged as the piece after the real program passes the same judgement |
| 2 | `#1164.fb851e24` | `ac2-board.test.ts` (2) | The play; the region map's layout; deep_query at all 360 steps: at each press's step (the first at or after its entry's `t`) the issue's board and winner, the taken cell and the press after the win equal to the step before, winner 0 before step 180 and 1 from it, the board's end. Wrong program: `takes_taken_cell` |
| 3 | `#1164.636499d1` | `ac3-replay.test.ts` (1) | The play, then `track`, `logic` and seven snapshots at press + 0.1 s; a fresh headless process loads the recorded track and reads the same; the track's hash, every checkpoint's full-state hash, every step hash and every snapshot equal. Wrong program: the base |
| 4 | `#1164.bfcc143f` | `ac4-seek.test.ts` (2) | A first run gives the presses' flicks; a second plays and asks `determinism` at those 7 flicks and 50 seeded times in [0, 10 s) (play and seek frames equal), `logic` seeks to each (each step on the way and the first checkpoint after equal the straight run's), and the claim's logic.determinism row PASS keyed to the current revision's hash. Wrong programs: `restore_zeroes_move_count` (every step hash and array equal, the failure names checkpoint 240's full-state hash, logic.determinism FAIL), then with `check_compares_step_hashes` (logic.determinism PASS, so this test's requirement fails, naming AC4) |
| 5 | `#1164.535ab8f5` | `ac5-fork.test.ts` (1) | The play; seeks to 4 s, a scrub to 5 s, seeks to 6 s and 1 s: the track's hash and entries unchanged; the playhead at 2.5 s and key 5 at that moment: its entry at 2.5 s, `fork_at` 2.5 s, the two entries before it and the new one, the hash changed; from step 75 on, every checkpoint's full-state hash, the seek's checkpoint and every step hash equal a fresh straight run of the forked track. Wrong program: the base |
| 6 | `#1164.9ffde386` | `ac6-budget.test.ts` (2) | The play; the claim's logic.budget row PASS; fuel at every step under 500,000 (half of 1,000,000); no trap. Wrong program: `loops_on_9`, played in two processes: kind fuel at step 210, the same function and offset, the press of 9 among the trap's inputs; board and winner at steps 209, 210 and 359 the last good values; the claim FAIL; AC6's judgement fails |
| 7 | `#1164.6ccc5166` | `ac7-shown.test.ts` (1) | The check run's files and the recorded taste call; INCONCLUSIVE without them |

## The taste call

The check run is **`node scripts/checkpoint-1164-shots.mjs`** *(chosen; the implementer writes it, as
`scripts/checkpoint-1162-shots.mjs` was written for #1162)*: it plays the game with keys in the app at the reference
window (1512 × 982 points at 2×, as #1162's and #539's check runs draw it through `deep-show screen`) and writes into
**`docs/evidence/1164/`** *(chosen)*:

| File *(chosen)* | What it shows |
|---|---|
| `x-and-o.png` | the board after O 4: an X on cell 1, an O on cell 4, 3024 × 1964 px |
| `taken-cell.png` | the board just after O's press on cell 1, the taken cell: still one X, 3024 × 1964 px |
| `win.png` | the board after X 3: X across the top row, O on 4 and 5, 3024 × 1964 px |
| `game-keys.mp4` | a recording of the game played with keys |

The files are attached to the PR and shown in the session; the one call is recorded later, by whoever is shown them,
in `tests/acceptance/1164/TASTE.json`: `{"issue": 1164, "criterion": "#1164.6ccc5166", "verdict": "looks_right" |
"looks_wrong", "who", "when" (ISO 8601), "screenshots": {<each of the four names>: sha256}, "note"?}`. This job wrote
none. No other test reads a picture to judge it: AC3 compares snapshots by hash only.

## Readings where the issue leaves a choice

- **"Each press's step, the first at or after its flick"**: the press's flick is its entry's `t` as `appended` gives
  it; the step is ⌈t ÷ 23,520,000⌉. "`rules.winner` reads 1 from step 180" then holds the win's press to step 180,
  6 s exactly, as the issue's numbers imply.
- **"Change nothing"**: board and winner at the press's step equal the step before's.
- **"Played hot-seat in the app through the replica"**: key events to the panel on the scope's virtual clock, after
  a click that gives the panel the keys; the game's press controls take the digit keys their `keys` name.
- **"The recorded input track"** is the `track` reply's entries; **"replaying … in a fresh headless process"** is a
  second `deep-show run` with no clock or display that loads those entries and reads the same calls. **"Render-back
  snapshots at 0.1 s after each press"**: `eval` with pixels at press + 0.1 s, by the PNG's SHA-256.
- **"The full-state hash playing gives"** at a seek: the seek restores and runs to the first checkpoint after it
  (#213's seek), whose full-state hash must equal the straight run's at that checkpoint, every step it ran on the way
  matching too. **"The frame hash"**: #488's `determinism`, played to and seeked to (a cold jump), by `pixels`.
- **"The 50 random times"**: `seeded(1164)` (mulberry32) times in [0, 10 s), so a failing run replays; a seek to t
  shows the last step at or before t.
- **"Keyed to the revision"**: the verdict's `key.revisions` holds the document with the current revision's hash.
- **The zeroing restore's "first checkpoint after the seek"**: the seek to 7.5 s shows step 225; checkpoints come
  every 60 steps (the default), so it is checkpoint 240. The move count is in memory and in no array, and the program
  takes the turn from the board, so zeroing it changes no array and no step hash, only full-state hashes.
- **"A check that compares step hashes alone passes that restore and fails this test"**: under both names,
  logic.determinism (the `logic` call's check, sampling 7.5 s) reads PASS; this test requires logic.determinism to
  catch the zeroing restore, so its judgement fails, naming AC4.
- **"Seeking back to 2.5 s and pressing 5"**: the playhead set to 2.5 s and the key at that same moment, so the
  stamp is 2.5 s; **"seeks and scrubs alone"**: playhead moves to 4 s, then 4.2 … 5 s in 0.2 s steps, then 6 s and
  1 s. **"The full-state hash from there"**: every checkpoint at or after step 75, and the seek to step 75's.
- **"The busiest step under half its fuel"**: deep_query's `fuel` at every one of the 360 steps under 500,000.
- **"logic.trap names the step, the function, the offset and the press"**: deep_query's `trap` (#548: `{item, step,
  t, kind, function, offset, inputs}`) with the press of 9's step and its entry among `inputs`.
- **"The board keeps its last good values"**: board and winner from the trap's step on equal the step before's,
  [1, 1, 1, 2, 2, 0, 0, 0, 0] and 1. **"The claim reads FAIL"**: the verdict's `result`.

## What the implementer adds outside this folder

- The lanes line in `scripts/lanes.mjs` (this README is the instruction; the files build deep-show and a wasm32 crate
  and run long hub scenarios, so they run alone):

  ```js
  // #1164's files build deep-show, deep-sandbox and a Rust program for wasm32, and play a game through the hub.
  alone.push('tests/acceptance/1164/');
  ```

- In deep-show: the `track` call with `load`, deep_query's logic `hash`, `seeks[].steps`, a list in `planted`, the
  planted `restore_zeroes_move_count` and `check_compares_step_hashes` reachable through the scenario, and whatever
  the base lacks for the criteria (a press control's `keys`, stamping at the playhead, the fork, the claim's logic
  checks reading the hub's track).
- `scripts/checkpoint-1164-shots.mjs`, writing `docs/evidence/1164/` (above).

## Not tested, because no criterion reaches it here

The play interface, bots, the turn clock and logic columns on mark sets (the issue leaves them to their own issues);
cross-machine and web logic.determinism; the X and O pixels themselves (only the taste call judges a picture);
`logic.layout` and `logic.provenance`.
