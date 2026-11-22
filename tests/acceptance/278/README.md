# Acceptance tests for #278: rooms that gather and play again

Written first, blind, from issue #278 (its Scope, Fields, six acceptance criteria and Proof line; it has no comments),
the design sections it links and those they lean on, and the base commit `7a256fd4b` (main, which holds #549's to
#551's net module, #172's web player and #277's seats), by a job that never saw an implementation. No other worktree,
branch, pull request, stash or plan was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

Lean: one file per criterion, each test's name carrying its criterion's ID, and exactly the four planted twins the
criteria name. There is no Oracle lane: the issue's Oracle line says no upstream test checks any of the six criteria.

**The issue is the newer word.** It reopens "the match starts when that many have joined" and "nobody joins after the
start" (Net `net@1`, with its It can never "take a player after the start") and the deferred lobbies (Cut, or
deferred). The design's glossary also sets "lobby" and "room" aside as words for a match; the issue uses both. Where
the issue and those lines disagree, these tests follow the issue.

## What was read

- The issue as saved (`issue-278.md`, and `issue-278-body.md` for the criterion IDs); for scope only, #179, #277,
  #550, #551, #172, #309 and the epic #219. Their behaviour isn't tested here.
- `docs/canvas-primitives.md`: Shared play over a relay (Net `net@1`, Net: rollback, Net: desync and replay, Net:
  relay and Join, Net: relay protocol `relay@1`), Check input: net kinds, Logic `logic@1` (its fields, among them
  `due: array name`; the read region; `writes` and their types). `docs/technical-design.md`: The net module (Match,
  Desync and replay, Relay and Join, Relay protocol), Cut, or deferred, Who drafts it, Proven on the base, Criteria to
  tests, Wrong programs, Dogfooding, Tests written first. `AGENTS.md`, `CONTRIBUTING.md`.
- The suites `277/` (README, helpers, fixtures, tests; this suite imports its helpers), `549/` (README, helpers,
  `ac2-join-only`; imported), `550/` (its relay-log check; `frameOf` and `MESSAGE_MAX` imported), `551/` (`replay`,
  `relay.deliver`, `rolled_back`, `referenceMacProblem`; imported), `172/` (its taste test and `TASTE.json`).
- At the base, only for surfaces: `crates/deep-show/src/net.rs` (`match`'s and `play_match`'s members),
  `crates/deep-net/` (README; `src/play.rs`, the test relay and its log; `src/kind.rs`, `players`; `src/prompt.rs`;
  `src/message.rs`; the copy's report), `crates/deep-relay/src/wire.rs` and `relay.rs` (head), `crates/deep-logic/`
  (`piece.rs`: types and layout; `piece/checks.rs`: fields, `due`; `world/seats.rs`, `track.rs`: `net.seats`),
  `packages/contracts/slots/relay@2.json`, `packages/contracts/digests.json` (relay lines), `scripts/benchmark.mjs`
  (`validateBudgets`), `scripts/lanes.mjs` (#277's line), `benchmarks/budgets.json` and `benchmarks/net-seats.mjs`
  (#277's task), `scripts/proof-change.mjs` (`criterionId`).

Not read: `docs/parallel-proof.md` (the brief names its sections 6 and 12a; this suite takes the reading rule for "in
the local preflight" as #277's README states it), the Tour, Replica and Frame budget sections (the tests reach a
tour's entry and a replica's click as #549's suite does, and time nothing).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and `fixtures.ts`.

## What the base already does, and these tests don't credit

From the base's code and this job's runs there (`BASE-FAILURE.txt`):

- **`players: {min, max}` is refused** (`bad_unit` at `items/match/params/players`), and so are a logic item's `open`
  and `finish` (`logic_refused`: "logic@1 has no field open"), so every piece of this suite but criterion 5's piece
  with one count isn't presented, and every test of criteria 1 to 4 stops at its first assertion.
- **The four planted names are refused** (`{"ok": false, "code": "bad_input"}`).
- **A piece with one player count and no `open` or `finish`** is presented and plays: the base counts the work
  `BASE_WORK` holds for criterion 5's match. Criterion 5's one test holds that part beside two the base fails (the
  budget window's task, the join's replay), so it is never credited alone.
- `match` ignores the members `start`, `join` and `next`; there is no `lobby` call, no `state.start`, no
  `data-deep-start`; the test relay's answer to a catch-up isn't in its log.

Every test fails at the base and none is a guard.

## Run them

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
for f in ac1-start ac2-join-open ac3-come-back ac4-finish ac5-budgets ac6-taste; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/278 $f.test.ts --testTimeout=600000 --hookTimeout=180000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/278/tsconfig.json   # type check
rm -rf tests/acceptance/278/node_modules                                      # vitest's cache after a --root run
```

Every `it` and build hook passes #549's `TIMEOUT`. What each file builds (#549's `useBuilds`) and starts:

| File (tests) | Builds | Starts |
|---|---|---|
| `ac1-start.test.ts` (4) | `deep-show` (`full`), `deep-relay` | `match` three times; a certificate, the shipped relay behind #549's door, and a room of three app copies (after a lobby of two); the relay and door again, the web bundle served, one headless Chrome and two app copies |
| `ac2-join-open.test.ts` (3) | `deep-show` | `match` three times |
| `ac3-come-back.test.ts` (3) | `deep-show` | `match` three times |
| `ac4-finish.test.ts` (3) | `deep-show`, `deep-relay` | `match` three times, `replay` twice; a certificate, the relay behind the door, a room of three app copies (about a minute of match, then 10 s) |
| `ac5-budgets.test.ts` (1) | `deep-show` | `match` twice; `git merge-base` and `git show` of `benchmarks/budgets.json` |
| `ac6-taste.test.ts` (1) | nothing | nothing |

Every `deep-show` this suite starts is stopped by its PID after its test; the relay, door, server and Chrome are
#549's and closed after their test; temporary folders are deleted. Everything listens on 127.0.0.1.
`https://relay.test/278` is declared only by pieces that never join. Imports: Node built-ins, vitest,
`../549/helpers.ts`, `../550/helpers.ts`, `../551/helpers.ts`, `../277/helpers.ts` (read only) and, through #277's,
`scripts/benchmark.mjs`.

**Gates.** None is ever a pass. `BLOCKED:` as #549's helpers say it (cargo, the `openssl` CLI, Chrome or WebGPU
missing). `INCONCLUSIVE:` when a live phase didn't finish and the 1-minute load is above the cores (#549's `gaveUp`),
when criterion 5's reading is taken off a reference Mac, and when criterion 6's pictures or call are missing. No file
times anything itself as an assertion on speed.

## What the implementer adds outside this folder

The lanes line, in `scripts/lanes.mjs` beside #277's:

```js
// #278's files each build deep-show (ac1 and ac4 also the shipped relay) and play matches in process; ac1 and ac4 also
// play live rooms of app copies, ac1 one with headless Chrome's web player, through the shipped relay.
alone.push('tests/acceptance/278/');
```

A task in `benchmarks/budgets.json` naming criterion 5 (the test asks only for a task whose `criteria` hold
`#278.fe1a5277` in a manifest valid against the merge base's; the script is the implementer's, as #277's
`benchmarks/net-seats.mjs` is, and can read the line the test logs, `a join's replay of the eight-seat piece: …`):

```json
{
  "id": "net-rooms",
  "command": ["node", "benchmarks/net-rooms.mjs"],
  "margin": 0.5,
  "limits": {},
  "initialReason": "Issue #278 first measurement (#278.fe1a5277): the merge base has no join after the start. node benchmarks/net-rooms.mjs runs the criterion's blind acceptance test (tests/acceptance/278/ac5-budgets.test.ts), which plays the eight-seat piece over the test relay twice: once with one player count and no open or finish, four copies, counting the frames, bytes, messages, rollbacks and steps run against the merge base's counts for the same match, and once started by three copies and joined by a fourth at step 600, recording the join's replay in steps a second (a reading, counted only on a reference Mac). The window times the run against its merge base; once main has this task, p50 and peak memory get a 50% merge-base margin.",
  "criteria": ["#278.fe1a5277"]
}
```

Criterion 6's record: the check run's pictures in `docs/evidence/278/` and the call in
`tests/acceptance/278/TASTE.json` (The taste call, below). Everything under The surface under test.

## Criteria to tests

IDs are `#278.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed,
computed from `issue-278-body.md` by this job. Each test's name starts `AC<n> #278.<h8>`; each file quotes its
criterion in full.

| AC | ID | File (tests) | Surface | What it asserts | Wrong programs it fails |
|---|---|---|---|---|---|
| 1 | `#278.108a8250` | `ac1-start.test.ts` (4) | `match` with `start`; a live room in the app (`lobby`, `scope`'s `state.start`, `input`, `track`, `play_match`); the web player's `data-deep-start` | In process, three of eight: each copy's record holds exactly `seat {1..3, joined}` at step 0, written by `net`; the rules' tally after step 0 is 106,572, the fold of those three rows in player order; `owner` is `[1, 2, 3, 0, 0, 0, 0, 0]` at the first and last step; seats 1 to 3 rest and the bot has moved seats 4 to 8 at step 0; 600 steps with equal hashes. Start unclicked: no copy runs a step; under the planted module the same judge fails naming step 0. App: Start is `open` with three joined, after a tour's entry and after a posted click; `play_match` answers `not_started`; after a person's click the three copies run 300 steps with the three `joined` entries and equal hashes. Web: `data-deep-start` stays `open` after every scripted click, the page's copy has run nothing and no frame crossed the door; a person's click then starts the match | the merge base; a match that waits for eight; a start without `joined` rows or with rows for empty seats; a Start a tour, a posted click or a page's script presses; planted `net_starts_on_third_join` |
| 2 | `#278.9b37a90c` | `ac2-join-open.test.ts` (3) | `match` with `start`, `join`, `relay.log` | Open: `rules.lobby` true at 600; one `seat {4, joined}` at one step after 600 on all four records and no other seat entry; the log check (below) passes; copy 4's one replay runs from step 0 through 600 or later; all four run 1,500 steps; seat 4 is the bot's before the entry's step and player 4's from it; every copy reports the same hash at the next hash interval; copy 4's own entries appear only from then; the four records agree line for line. Closed (lobby false from 300): `join_refused` is `started`, copy 4 ran nothing, no seat entry or frame for it, copies 1 to 3 play on. Planted: the log check fails, naming a frame to copy 4 | the merge base; a joiner handed state, or entries only from the present; a join stamped at different steps, twice or never; a joiner that parts; a join taken while closed; planted `relay_sends_joiner_state` |
| 3 | `#278.aa43e69b` | `ac3-come-back.test.ts` (3) | `match` with `start`, `kill`, `join`, `relay.log` | Open: `seat {3, left}` at 903 on copies 1 and 2; one `seat {3, joined}` after 1,500 on all three records; the log check passes over what the relay handed copy 3 once copy 1 had run step 1,500; its one replay runs from 0 through 1,500 or later; seat 3 is player 3's before 903, the bot's (gone `left`) until the entry's step, player 3's from it to the end; equal hashes at the next interval and throughout; the records agree. Closed: `join_refused` is `started`, the bot keeps seat 3, copies 1 and 2 play on. Planted: the log check fails, naming a frame to copy 3 | the merge base; a returning copy handed its old seat's state, or only the entries since it left; one seated as a new player; a return taken while closed; planted `relay_sends_old_seat_state` |
| 4 | `#278.bbb4eb66` | `ac4-finish.test.ts` (3) | `match` with `start`, `next`, `relay.deliver`; `replay`; a live room in the app | Finish: every copy ends `finished` with `ended.step` 3,000, its record's `end` `finished`, confirmed through 3,000, having run step 3,000 and at most the window past it; `rules.done` 0 at 2,999 and 1 at 3,000. Next: the same three copies, `joined` at step 0, `owner` and tally as at a document's start, 600 steps, equal hashes; each record holds its own scripts' entries and the scripts differ; each record replayed alone gives its own match's hashes, and the two matches' hashes differ. Late entry: nobody ends, copy 1 rolled back to 3,000 from 3,004 or later, `held` 1 and `done` 0 at 3,000 on every copy, all play 3,600 steps. Planted: copy 1 alone ends `finished`, and the judge names step 3,000. App: the three copies finish; Start is `open` again where it was; after a person's click they play the next match as players 1 to 3 under a new match ID, with five joins and five connections through the door in all (two the lobby of two's) | the merge base; a finish on one copy or on a predicted step; a room that needs a new Join or new connections; a next match carrying the last one's state or track; planted `net_finishes_on_predicted_step` |
| 5 | `#278.fe1a5277` | `ac5-budgets.test.ts` (1) | `benchmarks/budgets.json`; `match` with `relay.back` and `log`; `match` with `join` | A task names the criterion and the manifest is valid against the merge base's; the piece with `players: 4` and no `open` or `finish` counts `BASE_WORK` and holds no seat entry; the copy that joined records one replay from step 0 in steps a second, its steps over its seconds, counted only on a reference Mac | the merge base; a module that sends, reruns or stamps more for a piece with one count; a replay with no reading |
| 6 | `#278.c711dda6` | `ac6-taste.test.ts` (1) | `docs/evidence/278/`, `TASTE.json` | The four files exist and the recorded call names exactly their SHA-256s and says `looks_right`; anything missing is INCONCLUSIVE | a run with no pictures; a call on other pictures; `looks_wrong` |

Test count: 4 + 3 + 3 + 3 + 1 + 1 = 15.

## The surface under test

The issue names a player range, `open`, `finish`, a `joined` seat entry, a Start, a relay's log, a record's `end`
and planted programs, but no call. As #549's to #277's suites do, everything in the app is driven through `deep-show
run`, every match in process through `match`, and the live rooms through `play_match` and the web player in headless
Chrome. **Each name below is marked as the issue's or the design's own, a surface the base already has, or this
job's choice. The implementer builds exactly these, or a dispute goes to a blind redraft.**

### Documents

| Field | As written | Whose |
|---|---|---|
| `net@1` `players` | `{"min": 2, "max": 8}`; `4` in criterion 5's piece | the issue's |
| `logic@1` `open` | `"lobby"`: the name of one of the item's own `writes`, a bool array of count 1 | the issue's field; on the logic item, as the design's `due: array name` is (this job's reading of "a logic item may name an `open` bool array") |
| `logic@1` `finish` | `"done"`: the name of one of the item's own `writes`, an i32 array of count 1 | the issue's field; placed as `open` is |
| `logic@1` `reads` | `["net.seats", "aim", "stay"]` | #277's `net.seats` |

### Seat entries and `net.seats`

- The issue's `seat {player, state: joined}`, in #277's entry shape: `{t, seq, seat: {player, state: "joined"},
  writer: "net", player}` on every copy's merged track.
- **At the start** *(this job's reading of "seats past those joined are empty in `net.seats`")*: a match of a piece
  with a `{min, max}` count holds one `seat {p, joined}` entry at step 0 for each copy that had joined when Start
  was clicked, in player order, and none for a seat nobody took. A piece with one count holds none, as today.
- **A joiner or a returning copy**: one `seat {p, joined}` at its stamped step, the same on every copy's record, its
  own included.
- In the read region a `joined` row's state is **4**, after #277's 1 `left`, 2 `absent`, 3 `back` *(the number is
  this job's)*.
- **A returning copy keeps its player number** *(this job's reading: the piece's rules can decide "whether it gets
  its old seat" only if the entry names its old player)*.

### `match`'s members

The base's (`doc`, `steps`, `plays`, `relay.seed`, `relay.log`, `relay.back`, `relay.deliver`, `kill`) and:

| Member | What | Whose |
|---|---|---|
| **`start`** | `{joined: n}`: copies 1 … n have joined when the first player's Start is clicked, and the match starts then with the other seats empty. `{joined: n, click: false}`: nobody clicks Start; the call returns with each of the n copies' reports as it stands in the lobby (`ran: 0`, no hash, `end: null`) | the issue's "three copies joined and the first player's Start clicked"; the member this job's |
| **`join`** | `[{player, step}]`: copy `player`'s person clicks Join right after the first player's copy runs match step `step`. A player that wasn't there at the start, or one that was killed (`kill`) and comes back. Entries of its script whose `step` is before the step its `joined` entry is stamped at are never made | the issue's "joins at match step 600", "joins again at step 1,500"; the member this job's |
| **`next`** | `{steps, plays}`: once the match has finished, the first player's Start begins the room's next match with the same copies, which plays `steps` steps on `plays` | the issue's "the first player's Start begins the next"; the member this job's |

The reply is `{copies, relay}` with **`next: {copies, relay}`**, the next match's own reports and records, when `next`
was asked and the match finished *(this job's)*. `copies` holds one report a player that joined or tried to; a player
whose copy was killed and came back is reported by the copy that came back.

### A copy's report

The base's (`player`, `ran`, `ran_at`, `rollbacks`, `rolled_back`, `hashes`, `end`, `ended`, `match`, `record`,
`steps` rows with `arrays["rules.<name>"]`, #277's `catch_ups`) and:

| Field | What | Whose |
|---|---|---|
| `end: "finished"`, `record.end: "finished"` | the issue's Record `end` | the issue's |
| **`ended.step`** | with `end: "finished"`: the step whose confirmed `finish` value ended the match (3,000) | this job's, beside the base's `ended` details |
| **`join_refused`** | `"started"` on a copy whose Join was refused because the piece's `open` array was false; such a copy's report has `ran: 0`, empty `hashes`, `waits` and `notices`. Absent or null otherwise | the issue's "refused, as today" (relay@1's `started`); the field this job's (`refused` is #550's list of refused entries) |
| `catch_ups` | a joiner's or a returning copy's replay is one row, `{from: 0, to, steps, seconds, steps_per_s}` | #277's field, reused for the issue's replay and its reading |

### The relay's log

#550's `relay.log` rows, `{player, to, first, count, confirmed, at, delivered, bytes}`. **Every frame the test relay
hands a copy is a row, the frames that answer a joiner's catch-up included** (at the base those aren't logged), and
a planted relay's state is a row to the joiner too, `bytes` what it handed. The log check (`helpers.ts`
`onlyEntries`), after #550's check for "nothing but entries": each row to the joiner from the join on is a relay
frame in its documented layout, of the match's ID, from the seat of its row's player, with its row's `first` and
`count`; no step's message passes #550's `MESSAGE_MAX` (4,096 B); no message holds a value of the piece's state
(`rules.pos`, `rules.ema`, as f64 bytes either way round or as decimal text); and the rows carry each other player's
message for every step from 0 through the join. A failure about one frame starts `frame <row index> (to copy <n>, …`,
which is how the planted relays' failures name the frame. A refused copy is handed no frame.

### The app's Start, `lobby` and `play_match`

- **`scope`'s `state.start`** *(this job's, beside #549's `state.join`)*: `null` when the app shows no Start; else
  `{"state": "open" | …, "button": [x, y, w, h]}` in panel px, shown to the first player once `min` copies have
  joined. `state` is `open` while unpressed and anything else once a person's click pressed it; after a finished
  match it is `open` again, with the same `button`. The app draws it at the same place in every run of one piece on
  one panel, since a first lobby reads where it is and the room clicks there (as #549's Join).
- **`lobby`** *(this job's call)*: `{call: "lobby", panel: "main", until: {joined: n}, link_to?}`. After a person's
  click on Join, this copy opens its connection, is seated, writes the first player's link to `link_to` (#549's),
  and the call returns once n copies have joined: `{player, joined}`. A later `play_match` goes on from there.
- **`play_match`**: #549's. For the first player with Start unpressed it answers **`{code: "not_started"}`** and
  nothing starts. Another copy's waits for the start. After a match that finished, a second `play_match` in the same
  run plays the room's next match (the first player's after a new person's click on Start; the others' wait for it),
  on the connection the room kept.
- A person's click is #549's `input` press and release; deep_drive's click in a replica is the same two events with
  `source: "synthetic"` and the posting process's `pid`; a tour's entry is #549's `track` load of an entry on the
  piece's own press control (`start` here).

### The web player's Start

*(This job's, beside #549's `data-deep-join`.)* An element with the attribute `data-deep-start` in the page's own
tree, whose value is `open` while Start is unpressed and anything else after; its first `button` is Start. A page
that shows no Start has no such element. `probe().match` is #549's (`link`, `ran`).

### Planted twins

Reachable only through the scenario's `planted`; each changes nothing else.

| Name | Criterion | The wrong program |
|---|---|---|
| `net_starts_on_third_join` | 1 | the match starts when the third copy joins, with no click on Start |
| `relay_sends_joiner_state` | 2 | the test relay hands a joiner the match's state instead of the entries from step 0 |
| `relay_sends_old_seat_state` | 3 | the test relay answers a returning copy with its old seat's state instead of the entries from step 0 |
| `net_finishes_on_predicted_step` | 4 | a copy ends the match as finished when a step it ran on a prediction writes `finish`, without waiting for the step to be confirmed |

### The taste call

`docs/evidence/278/start-after-second-join.png`, `lobby-open.png`, `next-start-after-finish.png` and
`join-and-play-again.webm`, taken by the check run from the app, and `tests/acceptance/278/TASTE.json`:
`{issue: 278, criterion: "#278.c711dda6", verdict: "looks_right" | "looks_wrong", who, when, screenshots: {<name>:
<sha256>}, note?}`, #172's shape *(the file names are this job's)*.

## Fixtures

All made at test time in `fixtures.ts`; no personal data; CC0.

- **The eight-seat piece** (`roomPiece`): #277's arena, 640 × 360, showpiece class, seed 278; sliders `aim` (−8 to 8
  by 0.5) and `stay` (0 or 1); the logic item `rules` (60 Hz; reads `net.seats`, `aim`, `stay`; writes `done` i32,
  `ema` f64 × 8, `gone` i32 × 8, `held` i32, `lobby` bool, `owner` i32 × 8, `pos` f64 × 8, `tally` i32; `open:
  "lobby"`, `finish: "done"`); the net item `match`: `players: {min: 2, max: 8}`, 60 Hz, delay 2, window 8, a hash
  every 60 steps, timeout 5 s (120 s live). Variants: a lobby closed from step 300; a finish at step 3,000; one count
  of 4 with no `open` or `finish` (criterion 5); a press control `start` with a tour that presses it (criterion 1).
- **The rules** (`rulesProgram`): WebAssembly written as bytes, one 64 KiB page, no import. Seat s is played by
  `owner[s]`, a player or 0, the bot. A `joined` row gives player q seat q; `left` or `absent` hands the seat to the
  bot; `back` returns an absent player's. An `aim` entry sets the goal of the seats its player plays; a `stay` entry
  from a player who plays its seat sets `held`. Each row is folded into `tally` in the order read. The bot steers
  each seat it plays from the seat across; every seat moves at most 0.25 a step; `ema` trails `pos`, so the state
  holds numbers no entry carries. `lobby` is true while the step is below the piece's closing step; at step 3,000
  the rules write 1 to `done` unless `held`. A scratch run in Node's own WebAssembly, and scratch matches at the
  base of the piece with one count, checked all of this (`BASE-FAILURE.txt`).
- **Scripts** (`roomPlays`): every player sets `aim` every 10 steps, all at the same steps, values from seed 278 (the
  next match: 2780) plus the player; criterion 4's player 2 also makes a `stay` entry at step 2,998.
- **`BASE_WORK`**: criterion 5's counts at the merge base.

## Readings where the issue and the design leave a choice

- **Where a criterion is judged.** Joins, returns, the finish and every planted twin are judged in process over the
  test relay, whose log the criteria name and where a planted relay is reached by `planted`. Start and "no Join" need
  a person's click, so they are also played live through the shipped relay behind #549's door.
- **"Joins at match step 600"**: right after the first player's copy runs step 600. **"At a stamped step"**: one step,
  the same on every record, after 600; which step isn't held. **"At the next hash interval"**: the first multiple of
  60 after the entry's step.
- **"Receives only entries, as the relay's log shows"** and **"fails the log check, naming the frame"**: The relay's
  log, above; the frame is named by its row in the log.
- **"The same join is refused"**: as relay@1 refuses a join after a match's first frame, `started`.
- **"Fails, naming the step"** (criterion 1): this suite's judgement that no copy runs a step with Start unclicked
  fails, naming step 0, the first step a match runs.
- **"Ends it on one copy alone and fails, naming the step"**: copy 1, the one copy the late entry reaches late, alone
  ends `finished`, and the judgement that nobody may end names step 3,000.
- **"Once step 3,000 is confirmed"**: each copy has run step 3,000 and at most its window past it, and its record is
  confirmed through 3,000.
- **"From the document's start with the same seats and no Join"**: the next match's step 0 holds the same three
  `joined` entries and a fresh `tally`; live, no further `join` message and no further connection cross the door,
  and the next match has its own match ID (the design's "a match ID drawn at random for each match").
- **"Each replaying alone to its own full-state hashes"**: #551's `replay` of each record gives that match's hash at
  every hash interval, and the two matches' hashes differ.
- **Criterion 5**: as #277's criterion 4 is read: the window's task; "gains no work" as counts no load moves, equal
  to `BASE_WORK`, read at `7a256fd4b` by this job from the same piece; the reading as `catch_ups[0].steps_per_s`.
- **Player numbers** are #549's: 1 for the first copy the relay seated.

## For the early question

Stated conditions these tests hold only through a reading of this job's, or don't hold:

1. **Criterion 1, "fails, naming the step"**: the criterion doesn't say which check fails or which step. Held as
   step 0 of a match nobody started. One sentence would settle it: "the failure names step 0, the first step a copy
   ran with Start unpressed", or the check kind that reports it.
2. **Criteria 2 and 3, "at a stamped step"**: no law says which step (how far ahead of the replay's end). Not held
   beyond "one step, after the join, the same everywhere". Settled by a sentence such as #277's for `back`: "stamped
   `delay` steps ahead of the last step it replayed".
3. **Criteria 2 and 3, "naming the frame"**: how a frame is named isn't stated. Held as the frame's row in the
   relay's log. Settled by: "the log check's failure names the log row of the frame that carried the state".
4. **Criterion 3, "the seat the piece's rules give it"**: held through the reading that a returning copy keeps its
   player number. Settled by a sentence saying how a returning copy is told from a new one.
5. **Scope, "`open: array name`" and "`finish: array name`"**: the Fields don't say which item carries them. Held on
   the logic item. Settled by "(on `logic@1`)" or "(on `net@1`)" beside each.
6. **Scope, "seats past those joined are empty in `net.seats`"**: how a piece's rules learn which seats are taken at
   the start isn't stated. Held as `joined` entries at step 0. Settled by one sentence on what `net.seats` holds at
   step 0.

Found in the issue or the base, for a person:

- **relay@2.** The issue asks for "relay@2 messages beside #277's", while `packages/contracts/slots/relay@2.json`
  says "A new shape is relay@3, never a change here" and relay@2's digest is committed. These tests name no relay
  message, so they pass either way.
- **`{min: 1 to 8, …}`**: no criterion plays a match of one copy or a refused range.
- **Criterion 6, "at the reference window"**: the test reads the record, not a window size.

## Not asserted, because no criterion says so

relay@2's new messages on the wire and their relay suite cases; net.rollback and net.desync run with seeded joins
and a finished match; a join through the shipped relay while a lobby is open (the Proof line's live join); a join
while `open` changes during the replay; `min: 1`; who but the first player sees Start; what the Join prompt says in a
lobby; a web copy joining late or playing a next match; the second match's replay through an export. They are
follow-ups for the implementer's own tests.
