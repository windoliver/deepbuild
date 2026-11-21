# Acceptance tests for #277: seats that change while a match runs

Written first, blind, from issue #277 (live: its Scope, its Fields, its six acceptance criteria, its Proof line and its
Oracle line), the design sections it links and those they lean on, and the base commit `e575a47af` (main, which holds
#550's and #551's net module and #172's web player), by a job that never saw an implementation. No other worktree,
branch, pull request, stash or plan was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

Lean: one file per criterion, each test's name carrying its criterion's ID, and exactly the planted twins the criteria
name. There is no Oracle lane: the Oracle page says no upstream test checks any of the six criteria.

## What was read

- The issue (`gh issue view 277 --repo windoliver/deepbuild`); for scope only, its parent #179, the epic #219, its
  dependencies #550, #551 and #172, the relay issue #309 and the siblings #278 (starting with whoever is there, joins
  while a lobby is open, rooms of many matches), #552 (`match.me`, fog, draws; its PR isn't in the base), #553 and #554.
  Their behaviour isn't tested here.
- The Oracle page `doneright/oracles/issues/277.md` on branch `doneright` of `DeepBuildAI/deepbuild`: no upstream test
  for any criterion, so no Oracle lane.
- `docs/canvas-primitives.md`: Net `net@1`, Net: rollback, Net: lockstep, Net: desync and replay, Net: relay and Join,
  Net: relay protocol `relay@1`, Check input: net kinds; Logic `logic@1` (the read region, `net.draws` in `reads`),
  Logic: work across steps (the step ceiling), Logic: checkpoints and bake, Check input: logic kinds (logic.budget's
  `on`, logic.determinism's `compare: web`), Input track (entry kinds the net module writes, the writer `net`), Frame
  budget (the five runs), the class table (showpiece: 4 ms of frame CPU). `docs/technical-design.md`: The net module
  (Match, Rollback, Lockstep, This copy's player, Desync and replay, Relay and Join, Relay protocol), Cut, or deferred,
  Decided (Shared play over a relay). `docs/parallel-proof.md` sections 6 and 12a (budget windows, the reading rule for
  "in the local preflight"). `CONTRIBUTING.md`, AGENTS.md.
- The suites `549/` (README, `helpers.ts`, which this suite imports), `550/` (README, fixtures: logic programs written as
  bytes, `plant`, net.desync's report), `551/` (README, helpers, which this suite imports for `referenceMacProblem`;
  the live app-and-web match), `309/` (README, the shipped relay), `172/` (README; budgets judged by `judgeLimit`;
  planted web bundles through the export's scenario), `2856/` (README) and `1017/` (a merge-base budget's split).
- At the base, only for surfaces: `crates/deep-net/` (README; `src/play.rs`, the test relay's faults; `src/copy.rs`,
  a copy's report and `closed`), `crates/deep-show/src/net.rs` (`match`'s and `play_match`'s members),
  `crates/deep-show/src/picks.rs` (the `logic` call, its rows and its logic.determinism), `crates/deep-play/src/net.rs`
  (a copy's rows), `crates/deep-logic/src/lib.rs` (a golden's shape), `crates/deep-logic/src/piece/checks.rs` (reads),
  `crates/deep-player/web/element.js` (the web player's match loop) and `src/net.rs` (`probe().match` is the copy's
  report), `packages/contracts/slots/relay@1.json`, `scripts/benchmark.mjs` (`judgeLimit`, `validateBudgets`),
  `scripts/budget-window.mjs` (criterion IDs), `scripts/lanes.mjs`, `scripts/loads-lint.mjs`.

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and `fixtures.ts`.

## What the base already does, and these tests don't credit

From the base's code and this job's runs there (`BASE-FAILURE.txt`):

- **A leave ends the match.** `match` and `play_match` end every copy as `left` when a player's connection ends, and
  as `timeout` when its messages stop for `timeout`; `match` reads no `kill`, `freeze`, `hide` or `relay.withhold`
  (from the code: no test reaches them at the base, since every piece of this suite stops at check first).
- **`net.seats` isn't a read.** A logic item that names it in `reads` is refused at check, so every piece of this suite
  but criterion 4's merge-base form isn't presented at the base, and every test fails at its first call.
- **The four planted names are refused** (`{"ok": false, "code": "bad_input"}`).
- **A match whose seats never change**: the merge base plays criterion 4's match, the eight-seat piece without its
  `net.seats` read, and counts the work `BASE_WORK` holds. Criterion 4's one test holds that part beside two the base
  fails (the budget window's task, the catch-up reading), so it is never credited alone.

Every test fails at the base and none is a guard; `BASE-FAILURE.txt` is the run.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH. In a fresh worktree run `npm ci` and `npm run build
--workspaces` once (the lease runs through `packages/cli/dist`). Then run one file at a time, each under the machine's
lease:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
for f in ac1-kill ac2-held-back ac3-absent ac4-budgets ac5-hidden-tab ac6-strategy; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/277 $f.test.ts --testTimeout=600000 --hookTimeout=180000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/277/tsconfig.json   # type check
rm -rf tests/acceptance/277/node_modules                                      # vitest's cache after a --root run
```

Every `it` and every build hook passes its own timeout (#549's `TIMEOUT`, 5,400,000 ms), which `--testTimeout` doesn't
shorten. What each file builds in `beforeAll` (#549's `useBuilds`: `cargo build --locked --bin deep-show
--no-default-features --features full`, the binary copied out of the target, so the files run one at a time) and
starts:

| File | Builds | Starts |
|---|---|---|
| `ac1-kill.test.ts` | `deep-show` (`full`), `deep-relay` | a certificate; the shipped relay behind #549's door; the web bundle served on 127.0.0.1; two app copies (`deep-show run`, about 75 s of match); two headless Chromes; then `match` in process twice |
| `ac2-held-back.test.ts` | `deep-show` | `match` twice |
| `ac3-absent.test.ts` | `deep-show` | `match` three times |
| `ac4-budgets.test.ts` | `deep-show` | `match` twice; `git merge-base` and `git show` of `benchmarks/budgets.json` |
| `ac5-hidden-tab.test.ts` | `deep-show` (`full`), `deep-relay` | a certificate; the shipped relay behind the door; the bundle served (one export plain, one planted); one app copy and one headless Chrome per test (about 3 min of match with five 20 s hides, then about 1 min with one); the `logic` call three times |
| `ac6-strategy.test.ts` | `deep-show` | one `match` of 8 copies for 36,000 steps |

- **Processes and hosts.** Every `deep-show`, relay and Chrome is stopped by its PID after its test (#549's helpers);
  the door and the bundle's server live in the test process and are closed after their test; temporary folders are
  deleted. Everything listens on 127.0.0.1 at a port it picks. `https://relay.test/277` is declared only by pieces that
  never join: `match` plays every copy in one process with no network.
- **Imports.** Node built-ins, vitest, `../549/helpers.ts` and `../551/helpers.ts` (read only; they import their own
  fixtures and `../309/helpers.ts`), and `scripts/benchmark.mjs` (dynamically, as #172's helpers do).

**Gates.** None is ever a pass. `BLOCKED:` when cargo can't run, the `openssl` CLI is missing (the live matches'
certificate), Chrome isn't at its path or offers no WebGPU adapter headless (#549's `Chrome` and `mustBeReady`), or
headless Chrome leaves a page visible after its window is minimized (`setHidden`). `INCONCLUSIVE:` when a live phase
didn't finish in its time and the 1-minute load is above the core count (#549's `gaveUp`), when criterion 4's catch-up
reading is taken off a reference Mac, and when criterion 5's five runs read neither PASS nor FAIL by `judgeLimit`
(off a reference Mac, a run's load above the cores, or neither all within nor all over by the margin).

## The lanes line

`scripts/lanes.mjs`, beside #551's:

```js
// #277's files each build deep-show (ac1 and ac5 also the shipped relay) and play matches in process; ac1 and ac5 also
// play live matches between app copies and headless Chrome's web player through the shipped relay.
alone.push('tests/acceptance/277/');
```

No file times anything itself: criterion 4 reads the copy's own catch-up reading, and criterion 5 the web player's own
frame times, judged by `judgeLimit`. No file is by hand.

## Criteria to tests

IDs are `#277.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed (the
trace lane's `criterionId`), computed from the live issue. Each test's name starts `AC<n> #277.<h8>`; each file quotes
its criterion in full and names the wrong programs it fails.

| AC | ID | File (tests) | Surface | What it asserts | Plants and twins |
|---|---|---|---|---|---|
| 1 | `#277.bbe9c183` | `ac1-kill.test.ts` (2) | `play_match` in two app copies and the web player in two headless Chromes through the shipped relay behind #549's door; the test crashes copy 3's page (`Page.crash`) once it has run step 900; then `match` with `kill` and `relay.hold` | Live: copies 1, 2 and 4 each hold one `seat {3, left}`, written by `net`, at one step, the step after the highest step copy 3 sent a message for through the door; the app copies run all 4,500 steps and the web copy 4 too; no other seat entry; equal full-state hashes at every hash interval through the match; the same merged track. In process, the honest copies stamp the leave at 903 and agree at every step; under the planted module the copies part, a copy stamps its leave where they part, and every copy stops with net.desync naming that step | `net_leave_at_notice` |
| 2 | `#277.4413887e` | `ac2-held-back.test.ts` (2) | `match` with `kill` and `relay.withhold` (`log`) | The relay's log shows every frame of copy 3's to copy 2 carrying steps 899–902 undelivered; copy 2's record holds copy 3's entries at 899–902 as copy 1's does; one `seat {3, left}` at 903 on copies 1, 2 and 4; they play on with equal hashes. The planted copy 2 stamps the leave at 899, the others at 903, and every copy's net.desync names 899 | `net_skips_last_exchange` |
| 3 | `#277.a4a81099` | `ac3-absent.test.ts` (3) | `match` with `hide`; with `freeze` | Hidden: one `seat {4, absent}` at 1,203 on every copy, no leave; copies 1–3 wait no longer than 8 steps (0.133 s) for copy 4, play all 3,000 steps, and the match doesn't end; one `seat {4, back}` at one step no earlier than 2,400; copy 4's one catch-up runs from 1,201 to at least 2,400; it hashes every interval, every copy's hashes agree, and every copy reports the next interval after the back. Planted: copies 1–3 agree, copy 4 parts at or after 1,203, every copy's net.desync names the first step that differs (a hash every step). Frozen: one `seat {4, left}` at 1,203 on copies 1–3, no absent; they waited at least the timeout less 0.25 s, then play on with equal hashes | `net_catch_up_in_arrival_order` |
| 4 | `#277.2c9337c4` | `ac4-budgets.test.ts` (1) | `benchmarks/budgets.json`; `match` with `relay.back` and `log`; `match` with `hide` | A task names the criterion and the manifest is valid against the merge base's (the window's comparison); the eight-seat piece's match whose seats never change counts the merge base's frames, bytes, messages, rollbacks, steps run again and steps run (`BASE_WORK`), with no seat entry; the hidden copy records one catch-up in steps a second (its steps over its seconds), counted only on a reference Mac | none |
| 5 | `#277.cda3f5b9` | `ac5-hidden-tab.test.ts` (2) | `play_match` in the app and the web player in headless Chrome through the shipped relay behind the door; its window minimized (`document.visibilityState` hidden) for 20 s; `probe().match` (`catch_ups`, `golden`); the `logic` call's rows and its logic.determinism `compare: "web"` | One `seat {2, absent}` within a second of 1,203 on both copies for the first hide, and its back; seat 2's `owner` is player 2 before, the bot (0) from the absent step to the back, player 2 at the back (the app's record played by the `logic` call); the first catch-up starts at the absent step less the delay and runs at least the 1,200 steps owed, to the step before the back's less the delay; every catch-up's frames hold its steps; the web copy's golden has every step it ran; equal hashes, and both report the next interval after the back; logic.determinism `web` passes on the honest run; logic.budget on [web]: five hides, each catch-up's frames' 95th percentile, by `judgeLimit` against 4 ms. Planted: the web copy's golden first lacks the absent step less the delay, and logic.determinism `web` fails, naming that step | `web_catch_up_jumps` |
| 6 | `#277.402a14da` | `ac6-strategy.test.ts` (1) | `match` of 8 copies with `kill` | One `seat {3, left}` at 27,005 on the other seven copies; seat 3's `owner` is player 3 before it, the bot (0) with `gone` left from it, player 4 from the take at 27,304 to the end (copies 1 and 4's rows); the seven run all 36,000 steps, the match doesn't end, and their hashes agree at every interval from 27,000 | none |

Test count: 2 + 2 + 3 + 1 + 2 + 1 = 11.

## The surface under test

The issue names seat entries, `net.seats`, relay@2's messages, a timeout, an absent copy, a catch-up reading, check
kinds and planted modules, but no call. As #549's to #551's suites do, everything in the app is driven through
`deep-show run` (#393: one JSON scenario on stdin, one answer line `{"ok": true, "replies": [...]}`), every match in
process through `match`, and the live matches through #549's `play_match` and the web player in headless Chrome.
**Every call, member, field and name below is marked as the issue's or the design's own, an earlier suite's, or this
job's choice. The implementer builds exactly these, or a dispute goes to a blind redraft.** Times are flicks in tracks
(705,600,000 a second) and seconds in calls and reports, unless a field says ms; hashes are lower-case hex.

### The scenario

#549's world (one agent's session, the process table with your shell's peer pid 3002, the documents on panel `main`,
#383's clock), plus `planted` (Planted twins, below).

### `match`'s members

| Member | What | Whose |
|---|---|---|
| `doc`, `steps`, `plays` | the presented document, how many match steps, each player's script `{"<player>": [{step, control, value}]}`: an entry `{step: g}` is made when step g is the first its copy hasn't run, stamped `delay` steps later | #540's, #549's |
| `relay.seed`, `relay.log` | the test relay's seed; its log, each row a frame to one copy, `{player, to, first, count, confirmed, at, delivered, bytes}` | #549's, #550's |
| `relay.hold` | `[{player, at, for}]` (seconds): every frame that player sends from `at` waits at the relay until `at + for` | #549's |
| `relay.back` | `{up_to: n}`: each frame held back a seeded 0 to n match steps | #551's |
| **`kill`** | `[{player, step}]`: right after copy `player` runs match step `step` its connection ends and it sends nothing more, as a killed process's does (so its last message is for `step + delay`); the relay tells the other copies `closed {match, player, reason: left}` (relay@1) | the issue's word; the member this job's |
| **`freeze`** | `[{player, step}]`: right after copy `player` runs match step `step` it stops and sends nothing more, its connection still open; it never comes back | the issue's "frozen without `absent`"; the member this job's |
| **`hide`** | `[{player, step, for}]`: right after copy `player` runs match step `step` it is about to be hidden, so, as the Scope says, it sends `absent` from its next unsent step (`step + delay + 1`) and stops; `for` seconds later on the relay's clock it returns, gets every message since its last step, runs them headless until it reaches the others, and sends `back` stamped `delay` steps ahead | the issue's words; the member this job's |
| **`relay.withhold`** | `[{player, to, last}]`: when copy `player`'s connection ends, the relay has never handed copy `to` any frame that carries one of the last `last` messages `player` sent (it keeps them from that copy alone; the frames reach every other copy as usual, and appear in the log with `delivered: null`) | the issue's "holding copy 3's last 4 messages back from copy 2 alone"; the member this job's |

The reply is #549's `{copies, relay}`; each copy's report as below, with #540's `steps` rows.

### The test relay

What the issue asks of a relay, the test relay does in process (Check input: net kinds), on its own clock:

- A copy's connection that ends (`kill`) is told to the match's other copies at once, as relay@1's `closed {reason:
  left}`; a copy whose messages stop for `timeout` (`freeze`) is told to them once the timeout has passed. Either way
  the copies then exchange relay@2's `holds` and forward what another lacks before any stamps the leave (the Scope).
- relay@2's `catch_up {match, from}` is answered by the test relay itself, from the frames it carried: every other
  player's messages from `from` on, **the highest player's first** (this job's choice), so a catch-up that applied
  messages in arrival order would apply a step's entries out of (step, player, seq) order on every step that holds
  several players' entries.

The shipped relay speaks relay@2 beside relay@1 (the Scope); the live tests reach it only through the copies.

### Seat entries on the track

The issue's `seat {player, state: left | absent | back}`, the writer `net`, on every copy's merged track (its
`record.track`, in `match`'s copies, `play_match`'s reply and `probe().match`): an entry `{t, seq, seat: {player,
state}, writer: "net", player}`, `t` its step's time, `player` the seat's player (so the entry is the same on every
copy). The tests also read an entry `{control: "seat", value: {player, state}}` as one. *(The member `seat` is this
job's choice, after present mode's `{t, seq, present, writer}` entries; the fields are the issue's.)*

### `net.seats` in the read region

A logic item names `net.seats` in `reads`, as it names `net.draws`, and gets the issue's `{player, state, step}` for
each seat entry stamped at that step. In the read region it takes its place in declaration order, laid out as a
control's slot (Logic `logic@1`): a u32 count and 4 zero bytes, then at most 16 rows of a u32 player, a u32 state (1
`left`, 2 `absent`, 3 `back`), a u32 step and 4 zero bytes, 264 B. *(The layout is this job's; it is a control's slot
with the issue's three fields.)* The piece played alone (the `logic` call on a record's track) reads it from the
track's seat entries, as `net.draws` is derived from the track's reveal entries.

### A copy's report

#549's (`player`, `ran`, `rollbacks`, `hashes`, `waits`, `notices`, `end`, `record`), #550's `desync` (`{cause:
"state", first_step, module, field, players}` or `{cause: "entries", player, step}`; the tests read `first_step`, else
`step`), #551's `rolled_back`, and:

| Field | What | Whose |
|---|---|---|
| **`catch_ups`** | `[{from, to, steps, seconds, steps_per_s, frames?}]`: each return's catch-up: the first and last match step it ran headless, how many, the host's seconds they took and their rate, the reading criterion 4 records; in the web player also **`frames`**: `[{steps, ms}]`, each frame of the catch-up, the steps it ran and their CPU ms | the issue's "a reading in steps a second"; the fields this job's |
| **`golden`** | in the web player's `probe().match`: the copy's own golden of its run, in deep-logic's golden shape: `{step_hashes: {<logic item>: [hash after step k for k = 0, 1, …]}}`, `null` at a step it never ran | the design's golden (Logic: checkpoints and bake; logic.determinism `web`); the field this job's |

### The `logic` call and logic.determinism `web`

#539's `logic` call with #548's `track` (exists): the presented document's logic items stepped from 0 on that track,
`steps` rows `{step, hash, arrays}` (the tests read `rules.owner` and `rules.gone`). **With `check:
"logic.determinism"`, `compare: "web"` (the design's value) and `web: <a golden>`** (this job's member), logic.determinism
compares the given web run's step hashes with the app's bake on that track, step by step: `PASS` only when every step
hash it gives equals the bake's, `FAIL` with a failure naming each item's first step that differs or that the web run
lacks (`failures[].step`). Without `web` it stays BLOCKED, as the design says, until the web player has run.

### The live matches (criteria 1 and 5)

#549's and #551's surfaces as their READMEs give them: the app's prompt and a person's click, `play_match` with `plays`
and `link_to`, the web bundle (`export` with `video.codec: "web"`), its `<deep-player>` with `ready`, `probe().match`
and the `data-deep-join` prompt, a person's keys on a control's `keys`, the door. This suite adds:

- **Two web copies, each in a headless Chrome of its own.** In headless Chrome, activating a second tab of one browser
  makes the first one's page hidden, even in a window of its own (a scratch run of this job's), and a hidden copy
  sends `absent`; so each web copy has a browser.
- **A kill of a web copy**: `Page.crash` on its page once `probe().match.ran` reaches the step. Its renderer dies with
  its connection, so the relay sees the connection end, as a kill's. The test reads the highest step copy 3 sent a
  message for from the frames the door carried on its connection (found by the relay's `joined` answer).
- **Hiding a web copy**: its window minimized with `Browser.setWindowBounds` (`windowState: minimized`) through its
  page's session, and restored; the test waits until `document.visibilityState` says `hidden`, then `visible` (a
  scratch run of this job's: both hold in this Chrome headless). The web player, about to be hidden, sends `absent`, as
  the Scope says, and back in view catches up off the live frame.

### Planted twins

Each is one criterion's wrong program, reachable only through the scenario's `planted` (for the web copy, the export's
scenario, as #172's and #2856's planted players are), and changes nothing else.

| Name | Criterion | The wrong program |
|---|---|---|
| `net_leave_at_notice` | 1 | each copy stamps the `left` entry at the step at which it noticed the close, with no exchange and no agreed step |
| `net_skips_last_exchange` | 2 | each copy stamps the `left` entry after the highest step it itself holds the player's message for, with no `holds` exchange and nothing forwarded |
| `net_catch_up_in_arrival_order` | 3 | a returning copy applies the messages it missed in the order they arrived, not by step, player and seq |
| `web_catch_up_jumps` | 5 | the web player's copy, back in view, jumps to the confirmed step without running the steps it missed |

## Fixtures

All made at test time in `fixtures.ts`; no personal data; CC0.

- **The eight-seat piece** (`arenaPiece`): a 3D scene of 640 × 360 in the showpiece class, seed 277, span 600 s; a
  camera and a table; the slider `aim` (−8 to 8 by 0.5; the keys 1 to 7 at −6 … 6); the logic item `rules` (60 Hz,
  reads `net.seats` then `aim`, writes `gone`, `owner` i32 × 8 and `tally`); the net item `match`: 4 players, 60 Hz,
  delay 2, window 8, a hash every 60 steps, timeout 5 s (criterion 5: 2 players; the live matches: the door's address
  and a timeout of 120 s; criteria 1 and 3's planted runs: a hash every step).
- **The rules** (`rulesProgram`): WebAssembly written as bytes, MVP instructions, one 64 KiB page, no import. Seat s is
  played by `owner[s]`, a player or 0, the bot; `init` gives seats 1 … players to their players and the rest to the
  bot. Each step reads `net.seats` (a `left` or `absent` row hands that player's seat to the bot and marks `gone` 1 or
  2; `back` gives an absent player's seat back), then `aim` (an entry sets the goal of every seat its player plays, and
  no other's: the rules validate the player), then `take` (strategy only: a player takes a seat whose player left and
  the bot plays, on their own team of four, while they still play their own), folding every row into `tally` (i32,
  × 31 + the row) in the order read, so a step's entries in another order change the state. Then the bot sets the goal
  of each seat it plays from the state (−0.75 × the first unit of the seat across the arena plus the seat's offset,
  within ±8) and each unit moves at most 0.25 a step toward its seat's goal. Goals and positions live in memory past the
  write region (8,192 on), which checkpoints and full-state hashes hold, so a row stays small. A scratch run in Node's
  own WebAssembly checked: it validates; an absent row hands seat 2 to the bot and a back row gives it back; an aim
  entry moves only its player's seats; two entries in the other order give another tally; a take before the leave or
  from the other team is refused, and player 4's after the leave of 3 is taken.
- **The strategy fixture** (`strategyPiece`): the same program with two units a seat and the `take` control (1 to 8 by
  1), 8 players, 30 Hz, lockstep, delay 4, a hash every 60 steps, timeout 5 s, span 1,300 s.
- **Criterion 4's merge-base form** (`arenaPiece({seats: false})`): the eight-seat piece whose `rules` reads `aim` alone.
- **Scripts**: `arenaPlays`: every player sets `aim` every 10 steps, all at the same steps, values drawn from seed 277 +
  the player; criterion 2's copy 3 also at every step from 880 to 900, so each of its last messages holds an entry.
  `strategyPlays`: each player every 30 steps (player p at k ≡ 3p mod 30), seed 2770 + p; player 4's `take` of seat 3
  at step 27,300. The web copies' persons press aim's keys, one every 0.3 s in a seeded order, while their page shows.
- **`BASE_WORK`**: criterion 4's counts at the merge base (Criterion 4, below).

## Readings where the issue and the design leave a choice

- **"An eight-seat test piece whose net item declares `players: 4`"** is this suite's own (a fixture document, as
  #551's paddle piece is), not a gallery piece: its rules play seats 5 to 8 with the bot always, and any left or absent
  seat from that seat entry's step. **"A two-copy match of the eight-seat piece"** (criterion 5), against `players: 4`:
  the match starts when as many have joined as the net item declares (Net `net@1`), and starting with whoever is there
  is #278's, so criterion 5's piece is the same piece with its net item for 2 players, its rules playing seats 3 to 8
  with the bot; a seat of the two players' that is absent passes to the bot as in the four-player piece.
- **"Played by four copies, two in the app and two in headless Chrome's web player, from seeded tracks over the test
  relay"** (criterion 1): copies in two processes and two browsers can't share the in-process test relay, so, as #551's
  suite resolved it, the live match goes through the shipped relay behind #549's door on 127.0.0.1; the app copies play
  their seeded scripts and the web copies' persons press keys in a seeded order (the web player takes no script). The
  planted module is judged in process, where the step each copy notices the close can be made to differ: copy 1's
  frames held 0.5 s just before the kill, so copies 2 and 4 stand at their window when it comes.
- **"Killing copy 3 at match step 900"**: in process, right after copy 3 runs step 900; live, a crash of its page once
  its probe reads step 900, which lands within a few steps; the leave's step is then checked against what copy 3 sent
  through the door, the issue's "the step after the highest", and a kill landing more than a second late gives up.
- **"Stamps one `seat {3, left}` entry at the same step"**: exactly one per surviving copy, written by `net`, all at
  one step: 903 in process, the step after copy 3's last message (it sends k + 2 when it runs k).
- **"Play on for 3,600 steps with equal full-state hashes at every hash interval and record the same track"**: the
  app copies play 4,500 steps; each surviving copy reports a hash at every interval through 4,380, all equal, and their
  records' merged tracks agree, line for line, up to the last step all three confirmed.
- **"Naming that step"** (criterion 1): the first step at which the planted copies' hashes part (a hash at every step),
  which must be the step a planted copy stamped its leave at.
- **"Copy 2 gets them from the others before the `left` entry"** (criterion 2): copy 2's record holds copy 3's four
  entries, though the relay never delivered them to it; the leave at 903, after the last of them (902). **"Stamps it 4
  steps earlier on copy 2 … naming the step"**: copy 2's leave at 899, and every copy's net.desync naming 899.
- **"Wait no longer than the window at that step"** (criterion 3): every wait a copy reports for the hidden copy is at
  most 8 match steps' time (0.133 s). **"The match doesn't end"**: every copy plays all 3,000 steps with `end` null.
  **"Sends `absent` first"**: at step 1,203 and no `left` for it. **"Catches up headless"**: its catch-up from 1,201,
  and a hash from it at every interval, equal to the others'. **"At the next hash interval"**: the first multiple of 60
  after the back's step. **"A copy frozen without `absent` is `left` after the timeout, as the killed copy is"**: one
  leave at 1,203, the step after its last message, after the others waited the timeout (5 s, less 0.25 s for the steps
  they ran ahead in their window).
- **Criterion 4, "in the local preflight, compared with the merge base"**: by the reading rule (parallel-proof 12a) the
  scheduled budget window's record meets such a criterion once a task of `benchmarks/budgets.json` names it, so the test
  asks for that task (as #172's does). **"A match whose seats never change does the same work per step as before"**: a
  work measure no load moves, the counts the test relay and the copies report for one seeded match of 1,800 steps (the
  frames carried, their bytes and messages, the rollbacks, the steps they ran again, the steps run), equal to the merge
  base's for the same match: `BASE_WORK`, read at `e575a47af` by this job (`BASE-FAILURE.txt`) from the piece without
  its `net.seats` read, the one form the merge base presents; a seat read changes no message, so the counts are the
  same match's. A change on main that moves these counts for a reason of its own goes to a blind redraft. **"Recorded
  as a reading in steps a second"**: the hidden copy's `catch_ups[0].steps_per_s`, its steps over its seconds, never
  judged against a limit; it counts only on a reference Mac.
- **"Logic.budget with on [web] passes over its catch-up frames"** (criterion 5): a timing, so the five-run rule:
  five hides of 20 s in the one match, one every 1,800 steps from 1,200, each catch-up a run, its frames' 95th
  percentile against the showpiece class's 4 ms of frame CPU (Frame budget), by `scripts/benchmark.mjs`'s `judgeLimit`
  with each run's load at its return and its end. The first hide is the criterion's; the others add an absent and a back
  each, which the test reads only for the first. The fuel half of logic.budget (a step's fuel against the web's step
  ceiling) is the bake's and doesn't change with a catch-up; this piece's steps use a few thousand fuel units.
- **"From which the piece's bot plays that seat"**: the rules' `owner` of seat 2 is the bot from the absent step until
  the back, read from the `logic` call on the app's record, since `play_match` reports no rows.
- **"A planted copy that jumps to the confirmed step without running the steps fails logic.determinism, naming the
  step"**: logic.determinism with `compare: "web"` on the web copy's own golden; "the step" is the first step it jumped
  over, the absent step less the delay, which its golden lacks.
- **"Its units pass to the piece's bot, or to player 4 by a `take` entry"** (criterion 6): both, in one match: the bot
  from the leave, player 4 from its take 300 steps later.
- **Player numbers** are #549's: 1 for the first copy the relay seated; the app copies join first.

## Not tested, because no criterion reaches it here

relay@2 on the wire and the relay suite's new part (the Scope; the live tests reach relay@2 only through the copies);
net.rollback and net.desync run with seeded leaves and absences (the Scope); drawing the match again only once a hidden
copy has caught up; a pause by the class table; `take` refusals beyond the fixture's own rules; joins while a lobby is
open and rooms of many matches (#278); fog and draws (#552). They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- The lanes line above (this job wrote it).
- In the net module: seat entries and `net.seats`; the agreed leave after the `holds` exchange; absent, catch-up and
  back; a silent copy made `left` after the timeout; relay@2 (`seat`, `holds`, `catch_up`) beside relay@1 in the
  module, the test relay, the shipped relay and the web player; the four planted names; `match`'s `kill`, `freeze`,
  `hide` and `relay.withhold`; the copy report's `catch_ups` and, in the web player, `golden` and the catch-up's
  `frames`.
- In logic: `net.seats` as a read, in the app, the web player and the `logic` call on a track; logic.determinism's
  `compare: "web"` with `web`.
- A task of `benchmarks/budgets.json` naming `#277.2c9337c4`.
