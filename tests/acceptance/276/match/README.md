# Acceptance test for #276, criterion 4: a profile record in a two-seat match

Written first, blind, from issue #276 (live, November 20, 2026: its Scope, its seven acceptance criteria, its Proof
line), the design sections it links and those they lean on, and the base commit `fcbfca05f` ("Merge #189's branch
(PR #2936, a4a247731) into main e575a47af as #276's base"), by a job that never saw an implementation; none existed,
and no other branch, worktree, pull request, plan or session was read. This folder holds the issue's fourth criterion
and the Scope's Join prompt line; the other criteria belong to other jobs' folders. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 276 --repo windoliver/deepbuild`).
- `node scripts/design-section.mjs --issue 276`: Saves, Carry records (technical design); Logic: saves, Logic: carry
  records, Export: web player (canvas primitives).
- The READMEs of `tests/acceptance/549/`, `550/`, `551/` (a two-seat match in process: `match`, its copies' reports,
  `rolled_back`, `confirmed`, net.desync) and `189/carry/` (a record entering at step 0, record files, the assembler).
- At the base, for surfaces only: `crates/deep-show/src/net.rs` (`match`'s members, a copy's report), `crates/deep-net`
  (`copy.rs`, `copy/rollback.rs`: prediction adds no entry, a hash and a record's entries only once confirmed;
  `prompt.rs`: the Join prompt's words; `play.rs`: the test relay's `back`), `crates/deep-play/src/net.rs` (a copy's
  step rows), `crates/deep-logic` (`carry.rs`, `track.rs`'s carry entry, `piece/checks.rs`'s region map,
  `piece.rs`'s control slots), `crates/deep-show/src/picks.rs` and `physics/saves.rs` (`saves_dir`),
  `scripts/proof-change.mjs` (criterion IDs) and `scripts/lanes.mjs`. Helpers were copied from the #189 carry suite
  and #549's suite and cut down; nothing is imported from another suite.

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and `fixtures.ts`.

## Run it

Put rustup's cargo and Node 24 on PATH; in a fresh worktree run `npm ci` once (and `npm run build --workspaces`, as
#551's README says, for the lease, which runs through `packages/cli/dist`; without it `scripts/lease` runs the command
unleased and says so); then:

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
npm ci
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/276/match ac4-match.test.ts --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/276/match/tsconfig.json   # type check
rm -rf tests/acceptance/276/match/node_modules                                      # vitest's cache after a --root run
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set;
`helpers.ts` puts Homebrew's rustup or `~/.cargo/bin` on PATH when present), each copied out of the target folder:

- **The assembler** `wat/` (crate `acceptance-276-match-wat`, the #189 carry suite's renamed; `wat =1.263.0`,
  `wasmparser =0.263.0`; outside the workspace, its own `Cargo.lock`) into `target/acceptance-276-match-wat/`.
- **`deep-logic`**: `cargo build --locked --bin deep-logic`, on the first call (the layout probe's `check`).
- **`deep-show`**: `cargo build --locked --bin deep-show --no-default-features --features full`, on its first use,
  after the logic calls, so a base without the logic module's surface fails before this long build.

Every `it` passes its own 5,400,000 ms timeout, which outranks the command line's. Node built-ins and vitest only.
Each `deep-logic` and `deep-show run` is a child process run to its end (`spawnSync`, killed by its own PID on its
timeout); nothing listens on a port and nothing is stopped by name. Temporary folders (saves folders, evidence stores,
binaries) are deleted after the file. A `match` plays every copy in this process on the relay's own clock, with no
network: `https://relay.test/276` is declared and never joined.

## The lanes line

`scripts/lanes.mjs` needs this line, since the file builds cargo binaries (this job writes only its folder; the
implementer adds it):

```js
// #276's match folder builds deep-logic and deep-show (full) and plays two-seat matches in process.
alone.push('tests/acceptance/276/match/');
```

No file times anything, and none is by hand.

## Criteria to tests

The ID is `#276.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue).

| AC | ID | Test | What it asserts, and the wrong programs it fails on |
|---|---|---|---|
| 4 | `#276.fc1389e0` | `ac4-match.test.ts`: `AC4 #276.fc1389e0: each copy's record enters …` | Viewer A's and viewer B's first sessions, alone in the app, each write one whole record into their own saves folder (A: stats [0, 60], xp 1200; B: stats [1, 60], xp 3400). The duel's match of 400 steps, copy 1 on A's folder and copy 2 on B's, every frame held back exactly 8 steps: neither copy ends or desyncs and each confirms through step 399; each copy's `record.track` holds exactly two profile entries, both at t 0, player 1's naming A's record by hash and player 2's naming B's; each copy's step 0 read `[1, 0, 60, 1200, 1, 1, 60, 3400]` (player 1's block, then player 2's); both copies give a full-state hash at every checkpoint (0, 60, …, 360) and they agree; each copy's folder gains exactly one record, whole, of confirmed step 60 (stats [1, 60], xp 65) and none other (step 300 asks only in a run past `confirmed`); copy 1's `rolled_back` holds a rollback over step 60 and one over step 300, so both were run past `confirmed` first. Fails on: the base; an own record that doesn't enter, enters at another step or as another player's; a peer's record that doesn't reach a copy; one block in the read region, or the copy's own record in both; a record written by a step run past `confirmed`, or none by a confirmed one |
| 4 | `#276.fc1389e0` | `ac4-match.test.ts`: `AC4 #276.fc1389e0: planted net_profile_from_own_store …` | The same judge over the same match under the planted twin fails, a failure reading `copy <n> ends desync, its desync naming step 0` (#550's net.desync: `first_step` 0, or `step` 0) |
| Scope | — | `ac4-match.test.ts`: `Scope #276: the Join prompt …` | The app's Join prompt for the duel (`scope`'s `state.join.text`) holds "Your profile's numbers go to the other players." Fails on: the base; a prompt without the sentence |

Test count: 3 (2 for the criterion, 1 for the Scope line).

## The surface under test

The issue names the logic item's `profile` field, the read region's u32 and arrays, the record entering the input
track at step 0 by hash, a record kept per piece and per viewer where saves are, `confirmed`, and the Join prompt's
sentence; it names no call, member, file or plant. The surfaces are the base's: `deep-logic` (#531's JSON-lines
protocol with #534's `saves_dir` and #189's records: the app's logic module) and `deep-show run` (#393) with `match`
(#549's, #550's and #551's members and copy reports) and `scope` (#549's `state.join`). **Every name marked *(chosen)*
is this job's**, the smallest surface the criterion needs, shaped like its neighbours; the implementer builds exactly
these, or a dispute goes to a blind redraft.

### The logic item's `profile`

- **`profile: {arrays: {name → {type, count}}, request: array name}`** on a logic item (the issue's field), in
  `deep-logic`'s pieces and in a document's `logic@1` item. Here each name in `arrays` is one of the item's own write
  arrays with that type and count *(chosen: a record holds the arrays "as the step left them", as a carry record holds
  `out`)*, and `request` is one of its own i32 arrays. The test's arrays are `stats` (i32 × 2) and `xp` (i32 × 1), in
  that order, which is also their names' order.
- **The read region** *(chosen)*: the item's region map gains the entry `{region: "reads", name: "profile", offset,
  size}`. It holds one block per player, player 1's first: in a document whose `net@1` item seats P players, P blocks;
  played alone (any `deep-logic` piece, or a document without a net item), one block, and the viewer is player 1. A
  block is `4 + Σ type size × count` bytes: a u32 1 and that player's record's arrays in `profile.arrays`' order, each
  laid out as a write of its type and count, end to end; or, where that player has no record, a u32 0 and zeros,
  whatever memory held there before. Step 0 holds it; the module writes it before step 0 runs. The entry's offset is
  the one `deep-logic`'s `check` reports for the item, and it doesn't depend on P (the program reads both blocks from
  that offset, `P × 16` bytes here): where the entry sits among the read region's other entries is the implementer's.

### The app writes a viewer's record

- **`bake`** (#531's call with #534's `saves_dir`): a step k that writes 1 into the item's `profile.request` writes a
  profile record of the `profile.arrays` arrays as step k left them, once step k ends, into the bake's `saves_dir`.
  The bake's reply needs no new field for this test (`ok: true`).
- **Record files** *(chosen, after #189's carry record files)*: `<saves_dir>/<sha256>.profile`, the sha256 of the
  file's whole bytes; one JSON object, UTF-8, whose `arrays` is `{name → [number]}` holding exactly the
  `profile.arrays` arrays, each as its `count` values. Every other field in it, and the white space, is the
  implementer's. Written under a temporary name and renamed once it reads back whole (the issue); no test here kills a
  write.

### `match`

- **`saves_dirs: {"<player>": folder}`** *(chosen)*, a new member of `match`: each copy's own saves folder, the store
  of that copy's viewer for this piece, in place of where the app keeps the piece's saves. Each copy reads only its own
  folder; a copy with no entry has no store.
- **At its start** each copy reopens the newest whole profile record in its own folder, which enters the match's input
  track at step 0 **as its own player's entry**: it goes to every other copy in that player's step-0 message (the
  record's numbers travel with it, "Your profile's numbers go to the other players"), and every copy's read region at
  step 0 holds every player's block.
- **The entry** on a copy's merged track (`record.track`) *(chosen, after #189's carry entry)*: `{"t": 0, "seq",
  "profile": <sha256>, "writer", "player"}`, one for each player whose copy reopened a record, `profile` that record's
  hash (its file's name), `player` its player. Other keys on it (such as the numbers it carried) are the
  implementer's. The test reads `t`, `player` and `profile` of every track entry that has a `profile` key.
- **Writing in a match**: a step that writes 1 into `request` writes a profile record into each copy's own folder only
  once that step is confirmed (the issue's "or once it's confirmed in a match"), with the arrays as the confirmed step
  left them (the same on every copy). A step run past `confirmed`, whether it is later run again or the match ends
  first, writes no record.
- **Copy reports** are #549's, #550's and #551's: `player`, `end`, `desync` (net.desync: `first_step`, or `step`),
  `hashes` (`{step, hash}` at each hash interval it confirmed), `record.confirmed`, `record.track`, `rolled_back`
  (`[{from, to}]`) and `steps` (#540's rows, `arrays["rules.seen"]` at step 0).

### The Join prompt

`scope` (#549's: `{call: "scope", panel}` → `state.join`), for a document on the panel whose logic declares a
`profile` and whose net item declares a relay: `state.join.text` holds the issue's sentence "Your profile's numbers go
to the other players." beside the words it holds at the base (the relay's host, who sees the copy's address).

### Planted twin

Chosen by the scenario's `planted` key on `deep-show run`, never an environment variable; at the base the name isn't
known. It changes nothing else.

| Name | What it does wrong | A failure must name |
|---|---|---|
| `net_profile_from_own_store` *(chosen)* | On copy 1 only, at step 0 each other player's block of the profile entry is filled from copy 1's own saves folder's newest whole record (its own viewer's), in place of the numbers that player's step-0 entry brought; that player's entry stays on copy 1's track as it came | step 0, in a copy's net.desync, which ends the match `desync` |

The other wrong programs the criterion names are the merge base and those in the table above (Criteria to tests).

## Fixtures

All made at test time (`fixtures.ts`); no personal data; CC0. The program is WebAssembly text assembled by `wat/`,
built against the region map `deep-logic`'s `check` gives a layout probe of the item (`check` with the item's fields,
so a base that refuses `profile` fails there).

- **The duel** (`duelDoc`): a 3D scene of 640 × 360 (as #549's lockstep piece: a camera and a box), the sliders `gain`
  (0 to 5,000 by 1) and `poke` (0 to 1 by 1), the logic item `rules` (60 Hz, reading `gain` and `poke`, a checkpoint
  every 60 steps, its `profile`) and the net item `match` (2 players, 60 Hz, delay 2, window 8, a hash every 60 steps,
  relay `https://relay.test/276`). The same item, controls and program form the `deep-logic` piece (`piece`).
- **`rules`** (`rulesProgram`): its init writes `0xa5a5a5a5` over both blocks of the profile entry (32 bytes). Step 0
  copies the two blocks into its state; every step adds each `gain` entry's value to `xp` and counts the `poke`
  entries, then writes `seen` (the 8 words step 0 read), `xp`, `stats` = [pokes so far, the step] and `ask` (its
  request) = 1 at step 60, and at step 300 only when that step read no `poke` entry.
- **The first sessions** (`SOLO_A`, `SOLO_B`): 90 steps each, alone, on an empty folder: A gains 500 at step 10 and
  700 at step 20; B pokes at step 5 and gains 3,400 at step 15. Each writes one record, at step 60.
- **The match** (`PLAYS`, #549's `plays`: made at step g, stamped g + 2): player 1 gains 25 at 32; player 2 gains 40
  at 42 and pokes at 60 and at 300. The test relay holds every frame back exactly 8 steps (#551's `relay.back`), so a
  peer's message for step k reaches a copy about 6 steps after it ran k: each copy runs every step past `confirmed`
  first, predicting no entry for its peer (crates/deep-net: a prediction adds no entry), and rolls back when the entry
  comes. Copy 1's first run of step 300 reads no poke and asks; its run once confirmed reads player 2's poke and
  doesn't. Its first run of step 60 holds stats [0, 60]; confirmed, [1, 60].

## Readings where the issue leaves a choice

- **"Each copy's record"**: the newest whole record in that copy's own store, here its viewer's only record, written
  by their first session alone in the app. The two records differ in both arrays, so a copy that enters its own record
  as the other player's, or its own twice, shows.
- **"Enters at step 0 as its player's entry"**: on every copy's merged track, one profile entry at t 0 for each
  player, naming that player's copy's record by hash; **"so every copy reads every player's profile"** (the Scope):
  every copy's step 0 read both blocks, player 1's first.
- **"Every copy's full-state hashes agree at every checkpoint"**: the hash both copies report at each logic checkpoint
  step (the net item's `hash_every` equals the item's checkpoint interval, 60), all seven present and equal.
- **"A step past `confirmed` writes no record"**: a step run before every player's message for it arrived. The
  schedule makes copy 1 run steps 60 and 300 that way; the test holds each copy's folder to exactly one new record,
  confirmed step 60's arrays, and checks copy 1 did roll back over both steps (else the clause wasn't exercised). The
  record the match writes holds the arrays as the confirmed step left them, the same on both copies: the issue names
  no per-player write.
- **"A planted copy that reads its peer's profile from its own store"**: copy 1 fills player 2's block from its own
  folder (README: Planted twin), so its step-0 state differs from copy 2's; **"desyncs and fails, naming step 0"**: the
  match ends `desync` and a copy's net.desync names step 0, which the judge's failure line carries.
- **The Join prompt line** (Scope) is read where the base has the app's prompt, `scope`'s `state.join` (#549's), for
  the duel; the web player's prompt isn't read (the web player is criterion 7's folder's).

## Base facts

At the base `deep-logic`'s `check` refuses the item's `profile` (`logic@1 has no field profile`), so every test fails
at its first call, the layout probe's `check`, before `deep-show` is built. The base has no profile record, no
`saves_dirs` on `match`, no profile entry on a track, no profile entry in a region map, no planted name and no
sentence about profiles in the Join prompt. `BASE-FAILURE.txt` is the run at the base.

The harness was checked against the base in a scratch test, not committed, with `profile` taken out where the base
refuses it and the profile entry stood in 8 bytes after `seed` (where the base never writes): the base's region map
puts `gain` at 0, `poke` at 264, `seed` at 528 and the writes `ask`, `seen`, `stats`, `xp` at 0, 8, 40, 48. The
program assembles and validates. In Node's own WebAssembly, filling the read region as the README says, it gives
viewer A's and viewer B's step-60 arrays alone, `SEEN` at step 0 of the match with both blocks filled, the match's
record arrays at step 60 and no ask at step 300 once confirmed, and an ask at a run of step 300 without player 2's
poke (stats [1, 300]), and stats [0, 60] at such a run of step 60; with block 2 unfilled it reads `0xa5a5a5a5` there.
The base's `deep-logic` bakes viewer A's session with the program with no trap: step 60 asks, with stats [0, 60] and
xp 1,200, and step 0 reads `0xa5a5a5a5` in all 8 words of the stood-in entry, which is what a module that leaves the
entry unfilled gives. Not tried here: `deep-show` (`full`) was not built on this loaded Mac, so the duel's
presentation, `match`, the copies' reports and `scope` were not run at the base; their shapes are #549's, #550's and
#551's as their READMEs and the base's `crates/deep-show/src/net.rs` give them.

## Not tested, and why

No part of this criterion asks: three or more seats; a copy with no record (its block u32 0 and zeros) in a match; a
record refused for its shape in a match; a replay of a match record that holds a peer's profile entry; the web
player's match (criterion 7's folder); the other criteria of #276. They are follow-ups for the implementer's own tests
or the sibling folders.

## What the implementer adds outside this folder

- The lanes line above (this job wrote it).
- In the logic module: `profile` on a logic item, its read entry, records written by `bake` with `saves_dir`.
- In `deep-show`'s `match` and the net module: `saves_dirs`, each copy's record entering as its player's step-0 entry
  and reaching every copy, records written only by confirmed steps, the planted name `net_profile_from_own_store`.
- In the app's Join prompt: the sentence, for a piece whose logic declares a profile.
