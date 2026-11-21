# Acceptance tests for #552: this copy's player with courtesy fog through a seen column, and random draws after commit

Written first, blind, from issue #552 (live: its Scope, its Fields, its seven acceptance criteria, its Proof line and
its Oracle line), the design sections it links and those they lean on, and the base commit `16fafb08b` (main at
`86b99ac36`, "Merge pull request #2932", with the branch of #550, open PR #2933, merged in), by a job that never saw an
implementation. No other worktree, branch, pull request, stash or plan was read. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Lean: one file per criterion, each test's name carrying its criterion's ID, and exactly the plants and planted twins
the criteria name. The Oracle page says no upstream test checks any of the seven criteria, so there is no Oracle lane.

## What was read

- The issue (`gh issue view 552 --repo windoliver/deepbuild`); for scope only, its parent #179, the epic #310, the
  siblings #551 (rollback), #553 (rollback over occurrences and voices, the match budgets) and #554 (bridges, ports,
  readings, world pages), and its dependencies #550, #535, #537 and #544. Their behaviour isn't tested here.
- The Oracle page `doneright/oracles/issues/552.md` on branch `doneright` of `DeepBuildAI/deepbuild`: 0 of 7 criteria
  have an upstream test.
- `docs/technical-design.md`: The net module (Match, Lockstep, This copy's player, Random draws after commit, Desync and
  replay, Relay and Join). `docs/canvas-primitives.md`: Shared play over a relay; Net `net@1`; Net: lockstep; Net: this
  copy's player; Net: random draws after commit; Net: desync and replay; Net: relay and Join; Mark set: logic columns;
  Logic `logic@1` (the read region, the step's seed, `reads: [… | net.draws]`); Logic: occurrences; Input track (draw
  entries, `net.draws`); Input track entries; Particles `particles@1`: occurrence bursts; Check input: `rng.timing`.
  `docs/parallel-proof.md`, section 6. `CONTRIBUTING.md`. AGENTS.md.
- The suites `550/` (README, `helpers.ts` and `fixtures.ts`, which this suite imports), `549/` (README, `helpers.ts`,
  imported), the READMEs, fixtures and helpers of `535/`, `537/` (instancers fed by logic, terrain overlays, the taste
  call), `544/` (occurrences, Spawn, the tone), `449/` (occurrence bursts), `184/` and `555/` (the replica's play
  mode), `169/` (the png_seq still export), `548/` (`deep-show screen` at the reference window) and `467/`'s PNG reader,
  imported.
- At the base, only for surfaces: `crates/deep-show/src/net.rs` (`match`, its members, render-back in a match, the Join
  prompt in `scope`), `crates/deep-net/src/{copy.rs,prompt.rs}` and its README (a copy's report, `ended`, the prompt's
  words), `crates/deep-show/src/{picks.rs,probe.rs,ask.rs,access.rs,export.rs,main.rs}` (`logic`, render-back's probes
  and hits, the accessibility tree's nodes, `export`'s still, `deep-show screen`), `crates/deep-logic/src/piece.rs` and
  `piece/checks.rs` (the read region's order: reads, then the step's seed), `crates/deep-canvas-scene3d/src/tints.rs`
  (an overlay's keys), `crates/deep-canvas-marks/looks/clean.json` (the shipped look's roles),
  `crates/deep-replica/src/drive/play.rs` (a play takes a document), `scripts/lanes.mjs`, `scripts/proof-change.mjs`
  (`criterionId`).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and `fixtures.ts`.

## What the base already does, and these tests don't credit

From the base's code and this job's run there (`BASE-FAILURE.txt`):

- #549's and #550's `match`: every copy of a document's match in one process over the test relay, with each copy's
  report (`player`, `ran`, `hashes`, `end`, `ended`, `desync`, `fault`, `record`, `steps` with their arrays), the
  relay's log with each frame's bytes, the scenario's `planted` for the net module's twins, and `render_back` rows
  that draw the document, not a copy. A timeout already ends a match with `ended: {player, step}`.
- #549's Join prompt in `scope`'s `state.join`, naming the relay's host and who sees the copy's network address, with no
  courtesy line for any piece.
- Instancers fed by logic (#537), terrain overlays of a logic grid (#537), occurrences from logic (#544), occurrence
  bursts (#449) and spawns (#544); render-back's probes and hits; `see`'s accessibility tree; `logic`'s replay of a
  given track (#548); the png_seq still export (#501); `deep-show screen` (#1162); the replica's play mode (#184),
  which takes a document; the step's seed in the read region after the reads.
- A logic item whose `reads` names `match.me` is already refused at the base, as a name that names no control. Criterion
  1's test of it sits in one `it` with the honest fog piece, which the base doesn't present.
- At the base the fog piece's one refusal is `seen` (`instance@1.0 does not define seen`); the war piece's are the
  logic item's `fog` and the overlay's `player`; the dice piece's are `net.draws` ("names no control or logic item")
  and `draw_after`. **A probe, not committed**, ran the fixtures on the base's `deep-show` with those fields left out:
  the fog piece is presented and its still export at 5 s is one 640 × 360 PNG drawing all four enemies at the pixels
  `enemyPx` gives (243,160,89 at each centre, the sky 0,0,0 at `SKY_PX`); the war piece is presented and its still at
  7 s, its overlay given a role for each raw value, shows every sampled cell in the color of its `cellValue` (one color
  a value, no spread: unseen `ink` 37,38,41, radar `muted` 128,131,138, the cover 155,185,126), so the grid's index,
  the cells' pixels and the shipped look's roles are as the judges read them. Render-back of either at the base refuses
  the logic arrays (`ref_unresolved`), which no test uses. The dice piece with `net.draws` swapped for a second slider
  (so the read region keeps its layout) and no `draw_after`: the base's replica plays it, reads all 200 attacks at
  their steps and rolls each as 1 + (the step's seed at offset 528, mod 6); the base's `match` runs it 700 steps, every
  attack landing at 14 + 3n, both copies rolling alike, and `logic` on copy 1's record ends with the same rolls (and
  no `hashes`).

None of it is `match.me`, a `seen` column, `draw_after`, `net.draws`, draw entries, a fog grid or its gate, the courtesy
line, or any of this suite's members and planted names. Every test fails at the base and none is a guard;
`BASE-FAILURE.txt` is the run.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH. In a fresh worktree run `npm ci` and `npm run build
--workspaces` once. Then run one file at a time, each under the machine's lease:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
for f in ac1-fog-column ac2-join-alone-export ac3-guesses ac4-draw-faults ac5-alone-draws ac6-fog-grid ac7-taste; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/552 $f.test.ts --testTimeout=600000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/552/tsconfig.json   # type check
rm -rf tests/acceptance/552/node_modules                                      # vitest's cache after a --root run
```

Every `it` and every build hook passes its own timeout (5,400,000 ms; criterion 3's first test twice that), which
`--testTimeout` doesn't shorten.

| File | Builds (in `beforeAll`) | Starts |
|---|---|---|
| `ac1-fog-column.test.ts` | `deep-show` (`full`, #549's `useBuilds`) | `deep-show run` four times; `match` of 600 steps three times |
| `ac2-join-alone-export.test.ts` | `deep-show` (`full`) | `deep-show run` three times; four still exports, one `match` |
| `ac3-guesses.test.ts` | `deep-show` (`full`) | `deep-show run` eleven times; six `match`es of 700 steps, ten `logic` replays |
| `ac4-draw-faults.test.ts` | `deep-show` (`full`) | `deep-show run` three times, one planted `match` each |
| `ac5-alone-draws.test.ts` | `deep-drive` (`cargo build --locked -p deep-replica --bin deep-drive --features env-plants`) | seven `deep-drive` processes, one `play` each |
| `ac6-fog-grid.test.ts` | `deep-show` (`full`) | `deep-show run` three times, a `match` of 300 steps each |
| `ac7-taste.test.ts` | `deep-show` (`full`) | `deep-show run` twice, `deep-show screen` three times; writes `docs/evidence/552/` |

- **Processes.** Every `deep-show` is stopped by its PID after its test (#549's `useChildren`), every `deep-drive` by
  its PID after its play; `deep-show screen` runs under `spawnSync` with a SIGKILL timeout. Nothing listens or opens a
  connection: `https://relay.test/552` is declared by pieces that never join (`match` plays every copy in one process).
- **Folders.** Evidence stores, export folders, the replica's HOME and out folder and the binaries are temporary and
  deleted. Only `ac7-taste.test.ts` writes outside them, its pictures to `docs/evidence/552/`.
- **Imports.** Node built-ins, vitest, `../549/helpers.ts`, `../550/helpers.ts`, `../550/fixtures.ts` and
  `../467/helpers.ts` (read only).

**Gates.** None is ever a pass. `BLOCKED:` when cargo can't run. `INCONCLUSIVE:` off macOS for every test that draws a
frame or plays the replica (the GPU and the replica are macOS's), and in criterion 7 until its taste call is recorded.
No test reads a time or the load.

## The lanes line

Added to `scripts/lanes.mjs` in the same commit, beside #550's:

```js
// #552's files each build deep-show (ac5 builds deep-drive with env-plants instead) and play matches in process; ac1,
// ac2, ac6 and ac7 draw on the GPU, ac7 the app's window, and ac7 waits on your taste call in tests/acceptance/552/TASTE.json.
alone.push('tests/acceptance/552/');
```

No file is `timed`: no test reads a time. No file is by hand.

## Criteria to tests

IDs are `#552.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue. Each test's name starts `AC<n> #552.<h8>`;
each file quotes its criterion in full and names the wrong programs it fails.

| AC | ID | File (tests) | Surface | What it asserts | Plants and twins |
|---|---|---|---|---|---|
| 1 | `#552.1b7a8fff` | `ac1-fog-column.test.ts` (4) | `match` with `views` and the relay's log; `deep show` | After steps 100 and 300 each copy's view reads `me` as its player, and its frame (pixel at each enemy's centre), its pick test at each enemy's centre and its accessibility tree show exactly the enemies its player's bit of `seen` sets: at 100 copy 1 omits `enemies#1.1`, which copy 2 shows. Both copies run 600 steps, no end, sharing every full-state hash (at least 9). Every message in the relay's log holds only the design's members. The fog piece whose `sight` reads `match.me` is refused at check, every error naming `sight`, while the same piece without that read is presented. Under the planted net module the log's judge fails naming the field `me`; under the planted column the view judge fails naming copy 2 at step 100 and `enemies#1.1` | `reads: ["match.me"]`; `net_sends_match_me`; `seen_reads_player_one` |
| 2 | `#552.1430609d` | `ac2-join-alone-export.test.ts` (2) | `scope`'s prompt; `export` (png_seq still at 5 s) with `record` and `me` | The fog piece's prompt text holds the courtesy line, word for word; the paddle piece's (#550's) doesn't. The still of the piece alone draws player 1's side; copy 1's record (whose `player` is 1) exported by default draws player 1's side, with `me: 2` player 2's, with `me: "none"` every enemy | none (the base) |
| 3 | `#552.18ec780d` | `ac3-guesses.test.ts` (2) | `match` with `secure`; `logic` replays with `hashes` | In each of 5 matches (secure seeds 1 to 5): both copies run 700 steps with every hash shared and the same final rolls, 200 attacks all resolved by a draw, and the planted guesser right on at most 50; each copy's record replays to the same final arrays and the same full-state hash at every hash step (at least 10). Without draw_after the same guesser is right on all 200, every roll from the step's seed | `net_guesses_from_seed` |
| 4 | `#552.6bdf52ad` | `ac4-draw-faults.test.ts` (3) | `match` (`fault`, `ended`, `desync`, `steps`) | Bad bits: both copies and records end `faulted`, each net.fault `{player: 2, step: 14, kind: "draw"}`. Withheld bits: both end `timeout`, copy 1's `ended.player` 2. Early draws: both end `desync`; the copies' arrays differ first at some step at or after 14, and each net.desync's `first_step` is that step | `net_reveals_other_bits`; `net_withholds_bits`; `draws_from_first_bits` |
| 5 | `#552.eff354f2` | `ac5-alone-draws.test.ts` (3) | `deep-drive`'s `play` with `document`, `seed`, `track`, `values` | Two plays from seed 552 give the same arrays at every step; the track holds no commitment and one reveal for each attack, player 1's, by `net`, at the next step, naming the attack's step; all 200 attacks drawn. The moved replay keeps every draw and roll, each attack read a step later from the 50th. Under the secure-source plant the second play differs first at step 11, and the judge says so; under the step-hashing plant the moved replay's draw 50 differs, and the judge names draw 50 | `alone-bits-from-secure`; `draw-hashes-step` |
| 6 | `#552.5d140522` | `ac6-fog-grid.test.ts` (3) | `match` with `views`; copies' `effects` | After step 140 each view reads `me` as its player, and its frame shows, at every fourth cell, its own player's state's color as the shared rows give it (seen apart from unseen, radar apart from both). The grenade at step 150 in player 1's fog makes a burst of `sparks` and a voice of `boom` on copy 2 alone; the one at 170, which both see, on both. Both copies run 300 steps sharing every hash (at least 4). The planted overlay fails naming copy 2 and a cell; the planted burst fails naming copy 1, the grenade occurrence (a 1, b 0) and step 150 | `fog_overlay_reads_player_one`; `burst_ignores_fog` |
| 7 | `#552.84746f1a` | `ac7-taste.test.ts` (1) | `deep-show screen` at the reference window, 2×; `match`'s `on_panel` | By replies first: the war piece is presented, its match answers two copies, the fog piece's prompt says the courtesy line. Then three windows of 3,024 × 1,964 px written to `docs/evidence/552/` with their SHA-256s, and `TASTE.json` read: none or a call on other pictures is INCONCLUSIVE, `looks_wrong` fails, `looks_right` on exactly these pictures passes. It judges no picture | none (the base) |

Test count: 4 + 2 + 2 + 3 + 3 + 3 + 1 = 18.

## The surface under test

The issue names `match.me`, a `seen` column, hit tests, the accessibility tree, the Join prompt's line, `draw_after`,
`draw.commit` and `draw.reveal`, `net.draws`, net.fault, net.desync, a fog grid, an overlay, bursts, voices, an export,
a replica and planted programs, but no call. As #549's and #550's suites do, everything in the app is driven through
`deep-show run` (#393: one JSON scenario on stdin, one answer line `{"ok": true, "replies": [...]}`, one reply per
call), every match through `match` (the design's test relay: "Each runs copies of the piece in one process over a test
relay, with no network"), the replica through `deep-drive`'s play mode (#184) and the window through `deep-show screen`
(#1162, as #548's check run). **Every call, key, field and name below is marked as the issue's or the design's own, an
earlier suite's, or this job's choice. The implementer builds exactly these, or a dispute goes to a blind redraft.**
Times are flicks in calls (705,600,000 a second) and time literals where `export` takes them.

### The scenario

`helpers.ts`'s `scenario` writes #549's world (one agent's session `sess-552`, your shell's peer pid 3002, #383's
clock), each document on a panel of its own size (the first on `main`). With `window` (criterion 7) it adds #548's
`display: [1728, 1117]` and `window: [1512, 982]`, and `main` fills the window. `planted` names one of the scenario's
planted twins below.

### `match`

#549's call and #550's members (`plays`, `relay: {seed, log}`); this job adds:

- **`secure: {seed}`**: each copy's platform secure random source replaced by a seeded test source, so a match's draws
  repeat. What the source gives is the implementer's; it must differ between copies and between draws.
- **`views: [{player, step, probes?}]`**: for each, that copy's view of the piece as it stood after match step `step`,
  drawn as the app draws its panel for that copy, through its own `match.me`. The reply gains `views`, one row each, in
  any order: `{player, step, me, snapshot, hits?, tree}`. `me`: the `match.me` that view read (1 or 2). `snapshot`: the
  SHA-256 of the frame, a PNG of the panel's size in the scenario's evidence store. `hits`: with `probes` (panel px),
  one list a probe, nearest first, each hit as render-back's probes give one (`{item, sub, …}`: an instancer's element
  by its item and, in `sub`, its address, `1.1` or `#1.1`), or as a plain ID. `tree`: the copy's accessibility tree,
  `see`'s nodes `{id, role, name}`, an element of an instancer fed by logic a node whose `id` is its element ID
  (`enemies#1.1`, #537's address).
- **`on_panel: <player>`**: after the match, the document's panel shows that copy as it stands after the match's last
  step, through its own `match.me`, as a panel shows its own copy in a live match, whatever the window's time
  (criterion 7).

### A copy's report

#549's and #550's (their READMEs), with:

| Field | What | Whose | Read by |
|---|---|---|---|
| `fault` | net.fault; for a draw, `{player, step, kind: "draw"}`, `step` the drawn step (the step the commitment names) | the design's fields; `player` read from it | 4 |
| `ended` | the base's detail of an end; for a timeout `{player, step}`, `player` the player whose message or bits are missing | the base's | 4 |
| `record.player` | the record's own player: the copy's | this job's | 2 |
| `effects` | `[{reader, made, step, kind, a, b}]`: every burst the copy drew (`made: "burst"`, `reader` the particles item) and every voice it started (`made: "voice"`, `reader` the spawn) from an occurrence, with the occurrence's step, kind, `a` and `b` | this job's | 6 |
| `guesses` | the planted guesser's alone: `[{step, roll}]`, one for each attack, `step` the step the attack lands on | this job's | 3 |

### The relay's log

#550's rows gain **`messages`** (this job's): one object for each step the frame carries, the message as the net
module's own codec reads it back, its members by name. The design's message is `{match, player, step, entries}` and
the hashes (Net `net@1`); #550 adds how the copy ended and its locator's parts. The judge allows exactly `match`,
`player`, `step`, `entries`, `confirmed`, `end`, `ended`, `fault`, `track`, names starting `locate` and names holding
`hash`; any other member is something a message never holds, named by the failure. Draw entries are entries.

### `logic`

#539's call with #548's `track`: `{doc, steps, track}`, the document's logic items stepped on the given track, here a
copy's `record.track`; it opens no connection. Its reply gains **`hashes: [{step, hash}]`** (this job's): the full-state
hash every `hash_every` steps of the document's net item, as a copy of a match takes it, so a replay compares with the
match's.

### `export`

#501's still export as #169's suite asks for one: `{doc, out, video: {codec: "png_seq"}, size, frame_rate, range:
{still: {t}}}`, its one PNG in `out`. This job adds **`record`** (a copy's record from `match`: the export draws the
recorded match from its track instead of the document's) and **`me`** (`1` to `8` or `"none"`: the side the export
draws; absent, the record's own player, and with no record the piece played alone, player 1).

### `deep show`, `scope`, `deep-show screen`

`deep show` from your shell (#393), its reply's `outcome` and `issues` (`severity`, `ids`, `path`). `scope`'s
`state.join.text` (#549's prompt). `deep-show screen` with `{…scenario, out, t, scale}` (#548's `runScreen`).

### The replica

`deep-drive --out <dir>` (#184), one process a play, its HOME fresh, `DEEP_DRIVE_PLANT` naming a plant in the
`env-plants` build: `{call: "play", document, assets: {<sha256>: base64}, seed, span: {steps}, track, values, frames:
[]}`, read: `ok`, `values` (each path's array after each step), `entries` (the recorded track). The play's `seed` is the
run's seed: a lone piece's bits come from hash(it, the draw's number).

### Draw entries and `net.draws`

- **On a track** (a record's `track`, a play's `entries`): the design's `draw.commit {step, hash}` and `draw.reveal
  {step, bits}`, written by `net`, as `{t, seq, player, writer: "net", kind: "draw.commit" | "draw.reveal", value:
  {step, hash} | {step, bits}}` (this job's form; the tests also take the kind in `control`). `hash` is 64 hex digits,
  `bits` the u64 as 16 hex digits or a number; neither is read.
- **In the read region** (this job's layout; the design gives none): `net.draws` in a logic item's `reads` takes a slot
  shaped as a slider's: a u32 count and 4 zero bytes, then up to 16 draws, each a u32 step (the drawn step), 4 zero
  bytes and the u64 value, 264 B; in declaration order like any read, the step's seed after the reads.

### Fields in the documents

| Field | As written | Whose |
|---|---|---|
| A `seen` column | `seen: {array: "sight.seen", as: "i32"}` on an `instance@1` fed by logic | the design's |
| `match.me` read by logic | `reads: ["match.me"]` (the planted item) | the design's name |
| `draw_after` | `draw_after: ["attack"]` on `net@1` | the design's |
| `net.draws` | in `reads` | the design's |
| A fog grid | `fog: {grid: "war.fog", size: [128, 128], origin: [-64, -64], cell: 1}` on the logic item | `grid` the issue's; `size`, `origin`, `cell` this job's (an overlay's, #537), since a point must find its cell |
| The overlay through `match.me` | `overlays: [{grid: "war.fog", size: [128, 128], roles: ["ink", "muted", "none"], opacity: 1, player: "match.me"}]` | #537's overlay; `player` this job's |
| Occurrences | `emits: {grenade: {fields: {point: vec3}}}` | #544's; `point` the burst's and the gate's point |
| The burst, the spawn | `particles@1` with `emit: {shape: "point", on: {list: "war.occurrences", kinds: ["grenade"], count: 16}}`; `spawns: {boom: {on, play: {src: {asset}, in, out}}}` | #449's and #544's forms |

### Planted twins and plants

Each twin is one criterion's wrong program, reachable only through the scenario's `planted` (or `DEEP_DRIVE_PLANT`),
and changes nothing else. The names are this job's; the programs are the issue's.

| Name | Criterion | The wrong program | The test |
|---|---|---|---|
| `net_sends_match_me` | 1 | the net module adds the member `me`, the copy's `match.me`, to every message it sends | the log's judge fails naming the field `me` |
| `seen_reads_player_one` | 1 | a `seen` column reads bit 0 (player 1's) on every copy, whatever its `match.me` | the view judge fails naming copy 2 at step 100 and `enemies#1.1` |
| `net_guesses_from_seed` | 3 | copy 2, as its own player's attack is stamped and as each peer's attack arrives, before it is confirmed, guesses its roll as the same piece without draw_after rolls it: 1 + (the step's seed of the step the attack lands on, hash(the document's seed, the logic ID, k), as a u64, mod 6), and lists its guesses in `guesses`; it plays honestly otherwise | the score: at most 50 of 200 with draw_after, 200 without |
| `net_reveals_other_bits` | 4 | copy 2 sends, for each drawn step, 64 bits other than those it committed to | both copies end faulted, naming player 2, step 14, `draw` |
| `net_withholds_bits` | 4 | copy 2 commits for each drawn step and never sends its bits | both copies end timeout, copy 1 naming player 2 |
| `draws_from_first_bits` | 4 | each copy's logic module delivers a step's draw as soon as the copy holds any player's bits for it, from those alone (its own, which it holds first), before every player's are on the track | the copies part; net.desync names the step they part at |
| `fog_overlay_reads_player_one` | 6 | an overlay that reads a grid through `match.me` reads player 1's two bits on every copy | the fog judge fails naming copy 2 and a cell |
| `burst_ignores_fog` | 6 | a burst reads every occurrence of its list, whatever this copy's bits at its point | the effects judge fails naming copy 1, the occurrence (a 1, b 0) and step 150 |
| `alone-bits-from-secure` (`DEEP_DRIVE_PLANT`) | 5 | a piece played alone in a replica takes its bits from the platform's secure source, not hash(the run's seed, the draw's number) | the two plays differ first at step 11, and the judge names it |
| `draw-hashes-step` (`DEEP_DRIVE_PLANT`) | 5 | the draw hashes the drawn step in place of the draw's number | the moved replay's draw 50 differs, and the judge names draw 50 |

The plant: criterion 1's fog piece whose `sight` reads `match.me`.

## Fixtures

All made at test time in `fixtures.ts`; no personal data; CC0. The programs are WebAssembly written as bytes (MVP
instructions, no import), each exporting `memory` (maximum = minimum), `init`, `step`, `reads_at` 0, `writes_at` 4096
and, with emits, `emits_at`. Each write region lays its arrays out in declaration order on 8-byte boundaries, a bool or
an i32 4 B, a vec3 24 B (three f64); the arrays' names are alphabetical in declaration order, so either order lays them
out alike.

- **The fog piece** (`fogDoc`, criteria 1, 2, 7): 640 × 360, seen from straight above (orthographic, 20 m across, +X
  right, +Z down: 32 px a metre), a black sky, an unlit grey floor over the frame's lower part (so a still is never
  blank), the logic item `sight` (20 Hz, reading nothing), the instancer `enemies` of an unlit orange 1.6 × 1 × 1.6 m
  box fed by it (`live`, `gen`, `pos`, `seen`), and the net item `match` (2 players, 20 Hz, delay 4, window 0, a hash
  every 60 steps, relay `https://relay.test/552`). `sight` (`sightProgram`) writes four enemies, live, generation 1, at
  x = −6 + 4i, z = −3 (centres at px (128 + 128 i, 84)), and `seen`: enemy 0 3 (both), enemy 1 2 (player 2) before step
  200 and 3 from it, enemy 2 1 (player 1), enemy 3 0 (neither).
- **The dice piece** (`diceDoc`, criteria 3, 4, 5): a camera and a table, the slider `attack` (0 to 1 by 1), the logic
  item `dice` (20 Hz) reading `attack` and `net.draws`, and the net item with `draw_after: ["attack"]`, or without it.
  `dice` (`diceProgram`): each attack the step reads becomes attack n (`step[n]` that step, `roll[n]` 1 + (the step's
  seed as a u64, mod 6), `drawn[n]` 0); each draw the step reads resolves the first undrawn attack whose `step` is the
  draw's step (`roll` 1 + (the value mod 6), `lo` and `hi` its 32-bit halves, `drawn` 1). The read region: `attack` at 0
  (264 B), `net.draws` at 264 (264 B), the step's seed at 528. In a match (`attacks`) players 1 and 2 alternate 200
  attacks, made at steps 10 + 3n, landing at 14 + 3n; alone (`aloneTrack`) player 1 attacks at steps 10 + 4n.
- **The war piece** (`warDoc`, criteria 6, 7): 1,024 × 1,024, a flat 128 × 128 m terrain plate (1 m cells) seen from
  straight above (8 px a cell, cell (cx, cz)'s centre at px (8 cx + 4, 8 cz + 4)), lit by one sun, its cover a lit
  green, its overlay through `match.me` in the shipped look's roles (`ink` unseen, `muted` radar, `none` seen); the logic
  item `war` (20 Hz, two pages) with its fog grid and grenades; the burst `sparks` (`accent` to `muted`); the spawn `boom`
  playing a 0.25 s 1 kHz tone (a 16-bit WAV in the evidence store); the net item. `war` (`warProgram`) writes row cz of
  `fog` at step cz < 128, each cell player 1's two bits then player 2's (0 unseen, 1 radar, 2 seen): rows 0 to 15 both
  seen; rows 16 to 103 player 1 sees cx < 48, radar 48 to 63, nothing from 64, and player 2 sees cx ≥ 80, radar 64 to
  79, nothing below 64; rows 104 to 111 radar for both; rows 112 on neither. It emits `grenade` (a 1) at step 150 at cell
  (100, 64)'s centre, (36.5, 0, 0.5) m, and (a 2) at step 170 at cell (20, 8)'s, (−43.5, 0, −55.5) m.
- **The paddle piece** is #550's `courtDoc`, imported.
- **The scratch run.** Each program was run in Node's own WebAssembly with its read region filled as above: `sight`
  writes its arrays at steps 0, 199, 200 and 300 as given; `dice` counts 200 attacks, rolls each from the seed until its
  draw comes and then from the draw, several draws pending at once, and without draws keeps the seed's roll; `war`'s
  16,384 cells equal `cellValue` from step 127, and it emits exactly its two rows.

## Readings where the issue and the design leave a choice

- **"Player 1's frames, pick tests and accessibility tree"** (criterion 1): each copy's view (`views`), since a copy
  lives only inside `match`. A frame "omits" an enemy where the pixel at its centre is the sky's, and "shows" it where
  it is enemy 0's color, which every side sees; a pick test omits it where no hit names the instancer or the element; a
  tree omits it where no node's ID is the element's. Read after steps 100 and 300, so a view that hides an element by
  its ID rather than its bits fails at 300.
- **"Fails on the relay's log, naming the field"**: the log's messages, decoded; a message's members are the design's
  and #550's, so the planted `me` is named. `match.me` equals the copy's player in a match, so no value on the wire can
  tell it apart: only its field can.
- **"Refused at check, naming the item"**: `deep show` doesn't present the piece, and every error issue names `sight`
  in its `ids` or its `path`, so a refusal of something else in the piece doesn't pass.
- **"A piece played alone reads match.me as 1"** (criterion 2): the piece's own still export, no record, draws player
  1's side. **"The recorded match"**: copy 1's record, since by default it draws player 1's fog.
- **"Draws player 1's fog"** for the fog piece: the enemies player 1 sees and no other, at 5 s (step 100).
- **"Guesses each six-sided roll … before its attack is confirmed"** (criterion 3): the guesser's rule is the seed
  roll the piece without draw_after makes, so "right on all 200" there proves it guesses; "each of 5 seeded matches":
  `secure` and `relay` seeds 1 to 5. A run's score is counted on the copies' final rolls, matched to guesses by step.
- **"The same piece without draw_after, rolling from the step's seed"**: the same program and reads, the net item
  without `draw_after`: no draw comes, so every roll is the step's seed's.
- **"Replays … with the network off"**: `logic` on the record's track, which opens no connection; "the same full-state
  hashes": at every step both the match and the replay hash, at least 10.
- **"Naming that player, the step and the kind draw"** (criterion 4): `fault.player` 2, `fault.step` the drawn step 14
  (the step the commitment names), `fault.kind` `draw`. **"Naming the player"** for a timeout: the base's `ended.player`
  on the honest copy. **"Makes the copies part … naming the step"**: their step rows' arrays differ, and net.desync's
  `first_step` is the first step at which they do.
- **"Played alone in a replica twice from one seed"** (criterion 5): two `play` calls with `seed: 552` and the attack
  track. **"No commitment on its track"**: no `draw.commit` among the play's entries; the reveals are checked too
  ("keep a draw off the recorded track"). **"Every later entry"**: every later attack; the replica writes the bits again
  for the moved track. **"The first step that differs"**: the first step whose arrays differ, step 11, where the first
  draw comes. **"Naming that draw"**: draw 50, by its number.
- **"Copy 1 draws fog over the cells player 1 doesn't see"** (criterion 6): each sampled cell shows the color of its
  player's state as the shared rows draw it; radar is a third state, drawn apart from both. **"Draws no burst and starts
  no voice"**: no `effects` row of the burst or the spawn for that occurrence. **"Naming the occurrence and the step"**:
  its kind, `a`, `b` and step.
- **"Taken by the check run from the app at the reference window"** (criterion 7): `deep-show screen`, the panel filling
  1,512 × 982 points, at 2×; each copy put on the panel by `on_panel`.

## Not tested, because no criterion reaches it here

`match.me` in a content key; a world input or a driver that names it; `match.me` in a checkpoint or a save; a replay
naming another player; the commitment's hash itself; a draw's latency; trails, paint stamps and a grid image mark gated
by fog; an overlay's radar color; `always_visible`; draws in rollback (#551); the match budgets (#553). They are
follow-ups for the implementer's own tests or the sibling parts.

## What the implementer adds outside this folder

- In the net module and `deep-show`'s `match`: `match.me` on each copy's view; `views`, `secure` and `on_panel`; draws
  after commit, with `draw.commit` and `draw.reveal` on the track and net.fault for bad bits; the relay log's `messages`;
  a copy's `effects`, `record.player` and the guesser's `guesses`; the eight planted names.
- In the canvas: `seen` on an instancer fed by logic (and a mark set); `match.me` refused for a logic item; the courtesy
  line on the Join prompt of a piece that reads `match.me`; `net.draws` in a logic item's reads; a logic item's `fog`
  grid gating its occurrences' readers; an overlay's `player: "match.me"`.
- `logic`'s `hashes`; `export`'s `record` and `me`; in the replica, a lone piece's draws and the two plants.
- `TASTE.json`, once the owner's call on the pictures is recorded.
