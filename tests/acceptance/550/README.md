# Acceptance tests for #550: peers' entries checked as the viewer's are, rules on every copy, matches that end on a fault, a desync located to its step and field, and net in the tools

Written first, blind, from issue #550 (live: its Scope, its ten acceptance criteria, its Proof line and its Oracle
line), the design sections it links and those they lean on, and the base commit `531da1ef0` ("Merge pull request
#2910"), by a job that never saw an implementation. No other worktree, branch, pull request, stash or plan was read.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

Lean: one file per criterion, each test's name carrying its criterion's ID, and exactly the plants and planted twins
the criteria name. The Oracle line's lane is `tests/acceptance/550-oracle/`.

## What was read

- The issue (`gh issue view 550 --repo windoliver/deepbuild`); for scope only, its parent #179, the epic #310 and the
  siblings #551 (rollback, the window, the rate and lead rules), #552 (`match.me`, courtesy fog, random draws), #553
  (rollback over occurrences, voices and saves, the interop part, the match budgets) and #554 (bridges, ports, readings,
  world pages). Their behaviour isn't tested here.
- The Oracle page `doneright/oracles/issues/550.md` on branch `doneright` of `DeepBuildAI/deepbuild`, and the two
  upstream files it pins (its vendor copies, read for the Oracle lane alone).
- `docs/technical-design.md`: The net module (Match, Lockstep, Desync and replay, Relay and Join, Relay protocol);
  Threats, and what stops each one (A shared piece's network). `docs/canvas-primitives.md`: Shared play over a relay;
  Net `net@1`; Net: rollback; Net: lockstep; Net: desync and replay; Net: relay and Join; Net: relay protocol
  `relay@1`; Check input: net kinds; Check input: logic kinds; Logic `logic@1` (the read region, a trap in a match);
  Logic: checkpoints and bake (step hashes and deep hashes); Play interface `game.play@1` (`accepted` and `refused`);
  Check input: `rules.legal`. `docs/parallel-proof.md`, section 6. `CONTRIBUTING.md`. AGENTS.md.
- The suites `549/` (its README, `helpers.ts` and `fixtures.ts`, which this suite imports), `549-oracle/`, the
  READMEs and helpers of `412/` (deep_kinds, `deep mcp`'s tool list, the merge base built apart), `548/`, `1939/` (a
  claim's verdict as deep_run's check), the file list of `309/`, `411/` and `540/`.
- At the base, only for surfaces: `crates/deep-net/` (the copy, the test relay, the checks, `net@1`, its README's
  deviations), `crates/deep-show/src/net.rs` (`match` and its members), `crates/deep-play/src/net.rs` (what a copy steps
  and its full-state hash), `crates/deep-logic/src/piece.rs` and `piece/checks.rs` (a slider's 264-byte slot in the read
  region, the region map's order), `crates/deep-logic/src/world/world_impl.rs` (`append`, `deep_hashes`),
  `crates/deep-canvas/src/registry/mod.rs` (the net check kinds' names), `crates/deep-canvas-sandbox/src/check.rs` (the
  subset's instructions), `crates/deep-show/src/kinds.rs` and `gallery/` (the listing and the gallery),
  `crates/deep-show/tests/gallery.rs` (the gallery's programs in the evidence store), `crates/deep-show/src/verdict.rs`
  (a requirement's row), `crates/deep-show/src/main.rs` (the calls, the build sets), `crates/deep-relay/src/wire.rs`,
  `packages/contracts/slots/relay@1.json`, `packages/hub/src/tools.ts`, `scripts/proof-change.mjs` (`criterionId`),
  `scripts/public-text.mjs`.

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and `fixtures.ts`.

## What the base already does, and these tests don't credit

From the base's code and this job's runs there (`BASE-FAILURE.txt`, and a scratch run of `match` on the paddle piece):

- **#549's lockstep match**: `match` plays every copy in one process over the test relay, and each copy's report holds
  `player`, `ran`, `rollbacks`, `hashes`, `waits`, `notices`, `end`, `record` (with its `end`), `ran_at` and `steps`.
  A full-state hash a peer doesn't share already stops the match on every copy as `desync`, its `ended` naming the
  hash's step and the players: never the first step or a field. A logic trap already ends the match `faulted` on every
  copy, at step 400 for the trapping piece, `ended` being `{step, trap}` with logic.trap's report inside
  (`{item, step, t, kind: "unreachable", function, offset, inputs, source}`), and the record ends `faulted`.
- **Each entry reaches the piece with its sender's player**: on criterion 3's script both copies' rules refuse (2,
  own_paddle) at 100, (2, not_serving) at 160 and (2, wall) at 220, nothing else, and every hash agrees over 600
  steps. An entry on a control the piece doesn't declare joins the track unchecked, and a slider value out of range
  reaches the program (the piece's own wall rule turned `paddle2` = 25 down); nothing names the player.
- **What isn't there**: `refused`, `desync`, `fault`, `match` and `hashes[].track` in a copy's report; `plant`,
  `relay.direct` and `plays[].to` (`match` ignores them, so no plant lands and copy 3's two entries reach both copies);
  the relay log's `bytes`; the five planted names (the scenario is refused, `{"ok": false, "code": "bad_input"}`);
  net.desync as `match`'s check answers `BLOCKED` ("net.desync's planted change and its locator land with #550"), and
  as a claim's requirement, judged by `verdict`, reads `BLOCKED` with `{code: "module_missing", kind: "net.desync",
  module: "net"}`, though the full build holds the net module (it registers no check kind). deep_kinds lists net@1 in
  `full` with no check kinds and doesn't list it in `core`; the gallery holds four examples and no two-player piece.
  No tool on `deep mcp`'s list joins or connects at the base either.

So criterion 3's rule half and criterion 4's faulted ending already hold at the base, and no test credits them: each
sits in one `it` with the half that fails there (the planted copy, net.fault). Every test fails at the base and none is
a guard; `BASE-FAILURE.txt` is the run.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH. In a fresh worktree run `npm ci` and `npm run build
--workspaces` once (criterion 6 starts `deep mcp` from `packages/cli/dist`). Then run one file at a time, each under
the machine's build grant:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
for f in ac1-unit-shift ac2-peer-entries ac3-rules ac4-trap ac5-memory-byte ac6-tools ac7-one-ulp ac8-entries-first ac9-cause-state ac10-track-bytes; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/550 $f.test.ts --testTimeout=600000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/550/tsconfig.json   # type check
rm -rf tests/acceptance/550/node_modules                                      # vitest's cache after a --root run
```

Every `it` and every build hook passes its own timeout (5,400,000 ms; 10,800,000 ms for criterion 10's `it`, which
builds the merge base and plays two live matches), which `--testTimeout` doesn't shorten. What each file builds, in
`beforeAll` (#549's `useBuilds`: `cargo build --locked --bin deep-show --no-default-features --features <set>`, the
binary copied out of the target under its own name, so the files run one at a time), and starts:

| File | Builds | Starts |
|---|---|---|
| `ac1-unit-shift.test.ts` | `deep-show` (`full`) | `match` in process, once |
| `ac2-peer-entries.test.ts` | `deep-show` (`full`) | `match` once |
| `ac3-rules.test.ts` | `deep-show` (`full`) | `match` twice (honest, `net_stamps_own_player`) |
| `ac4-trap.test.ts` | `deep-show` (`full`) | `match` twice (honest, `net_plays_on_past_trap`) |
| `ac5-memory-byte.test.ts` | `deep-show` (`full`) | `match` twice (honest, `net_locates_by_step_hashes`) |
| `ac6-tools.test.ts` | `deep-show` (`full`, `core`) | `deep_kinds` pages in both builds, the gallery, a verdict; `deep mcp` with a scratch HOME |
| `ac7-one-ulp.test.ts` | `deep-show` (`full`) | `match` twice (honest, `net_hash_rounds_floats`) |
| `ac8-entries-first.test.ts` | `deep-show` (`full`) | `match` twice, three copies (honest, `net_locates_by_state_alone`) |
| `ac9-cause-state.test.ts` | `deep-show` (`full`) | `match` once |
| `ac10-track-bytes.test.ts` | `deep-show` (`full`), `deep-relay`, and in its test the reference's `deep-show` (`full`) | `match` of 3,600 steps; a certificate; twice, the shipped relay behind #549's door and two live app copies for 3,600 steps (about three minutes each) |

- **The reference** (criterion 10): `git merge-base HEAD origin/main`, or HEAD's first parent where HEAD is the merge
  base (on main, once this change has landed, the reference is then the commit before it). It is exported whole with
  `git archive` into `target/acceptance-550-base/<sha>/`, which `target/` keeps out of git, and built there with its
  own target folder, kept, so a later run builds warm. git runs in this checkout with every `GIT_*` variable dropped;
  nothing but the archive's files is copied, never `.git`.
- **Processes and hosts.** Every `deep-show` and relay is stopped by its PID after its test (#549's and #309's
  helpers); the door lives in the test process and is closed after its test; temporary folders are deleted.
  Everything listens on 127.0.0.1 at a port it picks. `https://relay.test/550` is declared only by pieces that never
  join: `match` plays every copy in one process with no network.
- **Imports.** Node built-ins, vitest, `../549/helpers.ts` and `../549/fixtures.ts` (read only; they import
  `../309/helpers.ts`).

**Gates.** None is ever a pass. `BLOCKED:` when cargo can't run, or the `openssl` CLI (criterion 10's certificate).
`INCONCLUSIVE:` when a live phase didn't finish in its time and the 1-minute load is above the core count (#549's
`gaveUp`); with the load at or under the cores the same is a plain failure.

## The lanes lines

The implementer adds these to `scripts/lanes.mjs`, beside #549's (this README is the instruction):

```js
// #550's files each build deep-show (ac6 in two feature sets; ac10 also the shipped relay and the merge base) and
// play matches in process; ac10 also plays two live matches through the shipped relay. The Oracle lane builds
// deep-show alone.
alone.push('tests/acceptance/550/', 'tests/acceptance/550-oracle/');
```

No file is `timed`: no test reads a time. No file is by hand.

## Criteria to tests

IDs are `#550.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue. Each test's name starts `AC<n> #550.<h8>`;
each file quotes its criterion in full and names the wrong programs it fails.

| AC | ID | File (tests) | Surface | What it asserts | Plants and twins |
|---|---|---|---|---|---|
| 1 | `#550.92355c66` | `ac1-unit-shift.test.ts` (1) | `match`, `plant`, the relay's log | Both copies share the full-state hash at 300, differ at 360, hash nothing past 360, run no step at 420, end `desync` and record `desync`; each `desync` names `first_step` 310, module `logic`, field `court.ball_vx`. Every frame in the relay's log is relay@1's, of the copies' match ID, from its sender's seat; no step's message passes 4,096 B or holds a value of the ball's state | `UNIT_SHIFT` |
| 2 | `#550.ba2d6c1f` | `ac2-peer-entries.test.ts` (1) | `match`, `refused` | Each copy's `refused` is exactly player 2's `warp` = 1 at step 100 and `paddle2` = 25 at step 200; neither record keeps them; both run 600 steps with no end, desync or fault, sharing every full-state hash | player 2's two entries in `plays` |
| 3 | `#550.b639481c` | `ac3-rules.test.ts` (1) | `match`, the piece's `court.refused` | On both copies the rules refuse (player 2, own_paddle) at step 100, (2, not_serving) at 160 and (2, wall) at 220 and nothing else; both play 600 steps with every hash shared. Under the planted copy 1, copy 1 refuses nothing at 100 and copy 2 refuses (2, own_paddle); both end `desync` with `first_step` 100 | player 2's three entries; `net_stamps_own_player` |
| 4 | `#550.64a33e1a` | `ac4-trap.test.ts` (2) | `match`, `fault`, `record.end` | On the trapping piece both copies end `faulted` with `ran` 400 (or 401), records `faulted`, `fault` = `{step: 400, item: "court", kind: "unreachable"}`, no desync, every hash shared. The same judge fails the planted copy, a failure naming step 400 | the trapping piece; `net_plays_on_past_trap` |
| 5 | `#550.608848dc` | `ac5-memory-byte.test.ts` (2) | `match`, `plant`, step rows' `hash` | Caught at 360 as in criterion 1; each `desync` names 310, `logic` and `court.memory`; every step hash both copies give agrees, over at least 361 steps. The same judge fails the planted locator, a failure naming the step it gave in place of 310, while its step hashes still agree | `MEMORY_BYTE`; `net_locates_by_step_hashes` |
| 6 | `#550.8e0f54ea` | `ac6-tools.test.ts` (2) | `deep_kinds`, a claim's verdict, `deep mcp` | `full`: net@1 available, its seven fields, the defaults 60, 2, 8, 60, 5 for `step_rate`, `delay`, `window`, `hash_every`, `timeout`, and `check_kinds` holding net.rollback, net.desync and net.budget; `core`: net@1 listed, `available: false`, `code: "module_missing"`. The gallery holds a two-player piece; net.desync `{seed: 550}` on it reads PASS and its row's `results` give the planted step and field, equal to its net.desync's `first_step` and `field`. No tool name, and no property of any tool's input schema, names joining, a relay, a socket, a connection, a peer or a match | none (the base) |
| 7 | `#550.31a59430` | `ac7-one-ulp.test.ts` (1) | `match`, `plant` | Caught at 360 and named 310, `logic`, `court.ball_vx`; under the rounding hash the same judge fails with the copies agreeing at the hash for 360 | `ONE_ULP`; `net_hash_rounds_floats` |
| 8 | `#550.acebf9a7` | `ac8-entries-first.test.ts` (1) | `match` with three copies, `relay.direct`, `plays[].to` | Copies 1 and 2 share the full-state hash at 300, their track hashes differ at 360, nothing hashed past 360, `desync` on both and in their records, each `desync` `{cause: "entries", player: 3, step: 310}` with no module or field, copy 1's record keeping player 3's spin 0.5 at 310 and copy 2's −0.5. The same judge fails the state-only locator, a failure naming a field of the ball | copy 3's two entries; `net_locates_by_state_alone` |
| 9 | `#550.b37be976` | `ac9-cause-state.test.ts` (1) | `match`, `hashes[].track`, `desync.cause` | Under `UNIT_SHIFT` with an honest rally, each `desync` names cause `state`, 310, `logic`, `court.ball_vx`; both copies' hash rows at 360 carry one equal track hash of 16 hex digits | `UNIT_SHIFT` |
| 10 | `#550.e9bf3c06` | `ac10-track-bytes.test.ts` (1) | `match` of 3,600 steps with the relay's log; live copies through the door, here and on the reference | In process: both copies run 3,600 steps with no end, desync or fault, share every full-state hash and every track hash (at least 59 steps), and the relay's log passes criterion 1's frame rule. Live, for each player and hash step: the message that carries this build's full-state hash carries its track hash too, is the message for the same step as the reference's, and is at most 8 B longer; at least 58 compared a player | none (the base) |

Test count: 1 + 1 + 1 + 2 + 2 + 2 + 1 + 1 + 1 + 1 = 13 (and 2 in the Oracle lane).

## The surface under test

The issue names reports (net.desync, net.fault), a record's end, the relay's log, check kinds, deep_kinds, deep_run, a
gallery example and the tool list, but no call. As #549's suite does, everything in the app is driven through
`deep-show run` (#393: one JSON scenario on stdin, one answer line `{"ok": true, "replies": [...]}`, one reply per
call), and every match through `match`, #540's and #549's call for the design's test relay ("Each runs copies of the
piece in one process over a test relay, with no network": Check input: net kinds). **Every call, key, field and name
below is marked as the issue's or the design's own, #549's suite's, or this job's choice. The implementer builds
exactly these, or a dispute goes to a blind redraft.** Times are flicks in calls (705,600,000 a second) and seconds in
reports; hashes are lower-case hex.

### The scenario and calls

`helpers.ts`'s `scenario` writes #549's world (one agent's session `sess-550`, the process table with your shell's
peer pid 3002, the first document on panel `main`, #383's clock), plus `planted` (Planted twins, below) and, for
criterion 6, #403's `claims`.

| Call | What the tests send | What they read | Whose | At the base |
|---|---|---|---|---|
| `deep show` | #549's `present`: the whole document from your shell | `outcome` `presented`, no error issue | #393's | exists |
| `match` | `{doc, steps, plays, relay?, plant?}` | `copies` (A copy's report), `relay.log` | the call and `plays`, `relay.seed`, `relay.log` #549's; `plant`, `relay.direct`, `plays[].to` and the log's `bytes` this job's | exists without them |
| `deep_kinds` | `{op: "list", registry: "kind@1", cursor?}`, `{op: "gallery"}`, `{op: "read", example}` | entries, `next`, the gallery's examples, an example's `text` | #412's | exists |
| `deep_show` | `{session, doc, document, include: ["issues"]}` (the agent's, for the claim) | no error issue | #393's | exists |
| `verdict` | `{claim}` | the requirement's row: `result`, `results` | #403's, as #1939's suite reads deep_run's checks | exists |

`deep mcp`'s tools/list (#26) is read as #412's suite reads it: `node packages/cli/dist/main.js mcp` with a scratch
HOME, `initialize`, then `tools/list`.

### `match`'s members

- **`plays`** (#549's): `{"<player>": [{step, control, value, to?}]}`. An entry `{step: g, …}` is what that player's
  copy sends when match step g is the first it hasn't run, stamped `delay` steps later, so it lands at g + 4. The
  module checks it where every copy checks a peer's entry, at the step it lands, on every copy, the sender's included
  (the Scope: "refused alike on every copy"), so a script can hold an entry an honest copy's own player could never
  make. **`to: [player]`** (this job's): only criterion 8's planted copy 3 carries it. That copy sends the entry only to
  those players' copies, over the direct path; everything else it does is honest.
- **`relay`**: `{seed, log?, direct?}`. `seed` and `log` are #549's. **`direct: true`** (this job's) turns the test
  relay's direct paths on: each copy's frames go to each other copy apart, as they do on a direct path between copies,
  so one copy can send two others different messages (criterion 8: "over the test relay with direct paths on").
- **`plant`** (this job's): `{player, step, field, add? | flip?, at?}`, the design's planted change (Check input: net
  kinds: net.desync "plants a one-ulp shift in one field of one copy's state, which may be logic memory no step reads,
  at a seeded step, made again whenever that copy runs the step"), given here by step and field instead of a seed.
  Right after copy `player` runs match step `step`, each time it runs it (so again when the locator steps it again
  from its checkpoint), before any hash of that step, it changes `field`:
  - `<logic>.<array>`: the array's first element, with the write region's bytes under it, which the program reads
    back the next step. `add: n` adds n to its value (an f64 or an i32); `flip: b` flips bit b of its bits, bit 0
    being an f64's lowest mantissa bit.
  - `<logic>.memory` with `at: offset`: the byte at that offset of the item's memory; `add` wraps at 256.
- **`check`** (#549's) isn't sent: no criterion here reads a check kind through `match`.

### The relay's log

#549's rows `{player, first, count, confirmed, at, delivered}`, each gaining **`bytes`** (this job's): the frame as the
relay carried it, as lower-case hex. The tests read it in relay@1's documented layout
(`packages/contracts/slots/relay@1.json`, `x-frame`: match 16 B, player u8, confirmed u32, first u32, count u16, then
each step as a u16 length and its bytes, little-endian); a step's bytes are "a message" here. With `direct`, a row is
one frame from one copy to one other.

### A copy's report

#549's (its README: A copy's report), each copy in `match`'s `copies` and in `play_match`'s reply, with:

| Field | What | Whose | Read by |
|---|---|---|---|
| `match` | the match ID, 32 hex digits, in `match`'s copies too | #549's (`play_match`'s) | 1, 10 |
| `refused` | `[{step, player, control, value, …}]`: every entry the module refused, at the step it landed on, naming its player | this job's | 2 |
| `desync` | `null`, or the design's net.desync: `{cause: "state", first_step, module, field, players}`, or the issue's `{cause: "entries", player, step}` with no module and no field | the design's and the issue's fields; the member this job's | 1, 3, 5, 7, 8, 9 |
| `fault` | `null`, or the design's net.fault `{step, item, kind}` | the fields the design's; the member this job's | 4 |
| `hashes[].track` | the hash of the merged input track up to that step that the hash message carried, a u64 as 16 hex digits | the issue's; the field this job's | 8, 9, 10 |
| `end`, `record.end` | `left`, `timeout`, `desync` or `faulted` | the issue's, #549's members | 1, 3, 4, 5, 7, 8 |
| `steps` | #540's rows, each with `hash[<logic>]`, the logic item's step hash, and `arrays` | #540's and #549's | 1, 3, 5, 10 |

net.desync names fields as `<logic>.<array>` (`court.ball_vx`) and an item's memory as `<logic>.memory` (an offset in
brackets may follow), with `module: "logic"`. Where an array differs it names the array, the most specific field; it
names memory only where no array or global differs. The tests accept a `logic.` prefix and `.`, `:` or `/` between the
parts (`fixtures.ts`: `BALL_VX_FIELD`, `MEMORY_FIELD`).

### deep_kinds and deep_run

- **net@1's entry** (#412's one shape, in `kind@1`) gains **`check_kinds`** (this job's): its check kinds, each a name
  or an object whose `kind` is the name. In a build without the net module (`core` here) net@1 is still listed, with
  `available: false` and `code: "module_missing"`, as #412's listing marks the data module's kinds in a build without
  it.
- **The gallery's two-player piece**: an example the `gallery` op lists whose document, read by its hash, holds a
  `net@1` item for 2 players. Its program is in the evidence store as the gallery's own test puts it there: every
  `crates/deep-show/gallery/*.wasm` by its bytes' hash.
- **deep_run's net.desync**: the agent's claim on that piece, its one requirement `{kind: "net.desync", seed: 550}`
  (the design's `net.desync {seed}`), judged by `verdict`. Its row reads `result: "PASS"` and its `results` (this
  job's shape) hold `{planted: {step, module, field}, desync: <net.desync>}`.

### Planted twins and plants

Each twin is one criterion's wrong program, reachable only through the scenario's `planted`, and changes nothing else.
The names are this job's; the programs are the issue's.

| Name | Criterion | The wrong program | The test |
|---|---|---|---|
| `net_stamps_own_player` | 3 | copy 1 stamps every peer's entry with its own player, 1 | asserts what the criterion says of it: player 2's move of paddle 1 is let through on copy 1 alone, and both copies stop with net.desync naming step 100 |
| `net_plays_on_past_trap` | 4 | a trap in a confirmed step stops only its item, as a piece played alone does, and the match plays on since every hash agrees | the criterion's judge fails it, a failure naming step 400 |
| `net_locates_by_step_hashes` | 5 | the locator compares the logic items' step hashes in place of full-state hashes | the judge fails it, its net.desync naming another step than 310 or none |
| `net_hash_rounds_floats` | 7 | the full-state hash rounds every float to 1e-6 before hashing | the judge fails it, the copies agreeing at the hash for step 360 |
| `net_locates_by_state_alone` | 8 | the locator compares state alone, never the track hashes or the entries | the judge fails it, a failure naming a field of the ball |

The plants are test inputs, not programs: `UNIT_SHIFT` (`court.ball_vx` + 1 in copy 2 at step 310; criteria 1 and 9
and the Oracle lane), `ONE_ULP` (bit 0 of `court.ball_vx` flipped; criterion 7), `MEMORY_BYTE` (`court.memory` at
0xF000 + 1; criterion 5), the trapping piece (criterion 4), and copy 3's two entries (criterion 8).

## The paddle piece

All made at test time in `fixtures.ts`; no personal data; CC0.

- **The document** (`courtDoc`): a 3D scene of 640 × 360, seed 550, span 200 s, with a camera, a table, the sliders
  `paddle1` and `paddle2` (−10 to 10 by 0.5), `serve` (0 to 1) and `spin` (−1 to 1 by 0.25), the logic item `court`
  (20 Hz, reading the four sliders) and the net item `match`: 2 players (3 in criterion 8), 20 Hz, delay 4, window 0, a
  hash every 60 steps, relay `https://relay.test/550` (criterion 10's live match: the door's address, timeout 120 s).
- **`court`** (`courtProgram`): WebAssembly written as bytes, MVP instructions, one 64 KiB page, no import. Its state
  lives in its write region (from 4096: `ball_vx`, `ball_vy`, `ball_x`, `ball_y` f64; `in_play` i32; `paddle` f64 × 2;
  `refused` i32 × 16; `serving` i32), read back each step; the byte at 0xF000 is in no region and nothing touches it.
  `init` makes player 1 the server. Each step clears `refused`, then takes the step's entries control by control, in
  the read region's order (Logic `logic@1`: each slider a u32 count, 4 zero bytes and 16 B an entry: u32 player, 4 zero
  bytes, f64 value; 264 B a slider):
  - `paddle1`/`paddle2`: only that paddle's owner may move it (else **own_paddle**, rule 1), and never past the wall,
    |value| > 8 (else **wall**, rule 3); otherwise the paddle goes to the value.
  - `serve`: only the serving player (else **not_serving**, rule 2), and only while the ball waits (else **in_play**,
    rule 4); a serve puts the ball at the middle moving (±0.3, 0.17) a step, toward the other player.
  - `spin`: any player, while the ball is in play: the rise gains 0.05 × the value.
  
  Each refusal is a (player, rule) pair in `refused`. Then the ball moves by its velocity and bounces at y = ±10 and
  at the ends x = ±19, where a paddle within 2 adds english (0.05 × the ball's offset from it). With `trapAt: 400`
  (criterion 4's planted piece) the step runs `unreachable` when it runs step 400, on every copy alike.
- **Scripts** (`rally`): player 1 serves at step 10 (196 in criterion 3, so player 2's serve comes while the ball
  waits); players 1 and 2 move their own paddles every 20 steps inside the wall; player 1 spins every 50 steps, player
  2 every 70, player 3 every 30. The ball is in play from step 14, so the plants at 310 land on a moving ball.
- **A scratch run** of `courtProgram` in Node's own WebAssembly, filling the read region as above on criterion 3's
  script (`BASE-FAILURE.txt` says how), refuses (2, 1) at step 100, (2, 2) at 160 and (2, 3) at 220 and nothing else,
  serves at 14 and keeps the ball in play; with player 2's entries stamped player 1 it refuses nothing at 100; with
  `trapAt: 400` it traps at step 400.

## Readings where the issue and the design leave a choice

- **"The two-player piece"** (criteria 3, 4, and the ball of 1, 5, 7, 8, 9, 10) is this suite's paddle piece, made in
  test code as #549's suite made `army`, so every expected value comes from its own rules; criterion 6 names **the
  gallery's** two-player piece, which is the implementer's (the Scope: "a gallery example of a two-player piece") and is
  read only through deep_kinds.
- **"The ball"** is logic state, `court.ball_*`: at the base a copy steps a piece's logic items only (crates/deep-net's
  README: "A physics world in a match's piece isn't stepped live or hashed yet"), and a physics world in a match is
  #551's and #522's. **"That field"**, the ball's x velocity, is the array `court.ball_vx`; net.desync names the array
  rather than the memory under it.
- **"net.desync naming …"** and **"net.fault naming …"** are each copy's report's `desync` and `fault`, with the
  design's fields. **"Stops the match on both copies"**: both copies' `end` and record end `desync`.
- **"Caught at the hash for step 360"**: the copies share the full-state hash at 300, differ at 360, hash nothing past
  360 and run no step at 420. A copy may run a few steps past 360 before the other's hash for 360 arrives, as lockstep
  carries hashes in later messages.
- **"Refused on both copies at the same step, naming the player"** (criterion 2): the module's `refused` list, on each
  copy, at the step the entry lands on. **"By the piece's rules … naming player 2 and the rule"** (criterion 3): the
  piece's own `court.refused` pairs at that step on both copies; the module never knows the rules (Net `net@1`: "the
  module checks only that an entry is declared and in range").
- **"A peer's entry"**: `plays` is what a player's copy sends, checked at landing on every copy, its sender's
  included, so a refused entry is refused alike everywhere and never reaches the track.
- **"Lets the first through on that copy alone"** (criterion 3): the planted copy is copy 1; player 2 makes no entry
  before step 100 in that criterion's script, so the move of paddle 1 is the first entry of player 2's that copy 1
  stamps. "That step" is step 100, where the entry lands.
- **"Ends the match … at step 400"** (criterion 4): `fault.step` 400, `ran` 400 (or 401, where a copy counts the step
  it trapped in). **"Fails, naming step 400"**: the criterion's judge, run on the planted copy's report.
- **"A byte of logic memory no step reads"** (criterion 5): 0xF000, in no region. **"Every step hash … agrees"**: the
  logic item's step hash in each step row, at every step both copies give (at least 361). **"Names no step and
  fails"**: the judge fails a net.desync that names any step but 310, or none.
- **"One-ulp change, the lowest mantissa bit"** (criterion 7): bit 0 of the f64's bits flipped (`flip: 0`). The ball's
  x velocity is ±0.3 then, so the change stays far below 1e-6 through 360; "misses it" is the copies agreeing at 360.
- **"With direct paths on"** and **"sends copy 1 one entry and copy 2 another"** (criterion 8): `relay.direct` and two
  `plays` entries of player 3 for the same step, spin 0.5 `to: [1]` and −0.5 `to: [2]`, landing at 310. Player 3 has no
  paddle; its spin bends the ball, so a state-only locator would name a field of the ball. **"Caught at the hash for
  step 360"**: copies 1 and 2's track hashes differ there (their full-state hashes differ too). **"Neither names a
  module or a field"**: `module` and `field` absent or null. **"Each copy's record keeps the entry it held"** (the
  Scope): copy 1's record has 0.5 for player 3 at step 310, copy 2's −0.5.
- **"The track hash adds at most 8 B to each hash message"** (criterion 10): a hash message is the step message that
  carries a copy's full-state hash, found by the hash's 16 hex digits, its 8 bytes either way round or their base64;
  "adds" is against the reference, the build without the track hash, live through #549's door, since the test relay's
  log at the base gives no bytes. Each of this build's hash messages must carry its track hash too and sit at the same
  message step as the reference's. **"The relay's log still shows nothing but entries, the match ID and hashes"**:
  criterion 1's frame rule, on the test relay's log of the 3,600-step match.
- **"The relay's log shows no message holding anything but the player's entries, the match ID and hashes"** (criteria
  1, 10): every frame is a relay@1 frame of the copies' one match ID from its sender's seat, laid out exactly; no
  message passes 4,096 B (one 64 KiB memory page, or the arrays of many steps, would); and no message holds a value of
  the ball's state with more than six significant digits that no entry carries, as an f64 either way round or as its
  shortest decimal text. The test reads no message's own encoding, which is the implementer's.
- **"deep_run runs net.desync"** (criterion 6): a claim's verdict, as #1939's and #2513's suites read deep_run's
  checks. **The Proof line** says the planted peer entries, rules, trap and net.desync "run through deep_run"; the
  criteria themselves name both copies, their records and the relay's log, which a requirement's row doesn't carry, so
  criteria 1 to 5 and 7 to 10 drive `match` and criterion 6 drives deep_run.
- **"A build without the net module"** (criterion 6): `core`, which holds neither logic nor net. **"Check kinds"**:
  net.rollback, net.desync and net.budget, the three the Scope gives deep_run; net.feel isn't asked for.
- **"No tool opens a connection or joins a match, checked against the tool list"**: no tool name, and no property name
  anywhere in a tool's input schema, matches `join`, `relay`, `socket`, `connect`, `lobby` or `peer`, or is `match`
  or `match_id`. Descriptions aren't read, since a tool's "never" clause may name joining.
- **Player numbers** are #549's: 1 for the first copy the relay seated; a frame's seat byte counts from 0.

## Not tested, because no criterion reaches it here

Rollback, its window and prediction (#551); `match.me`, fog and draws, and `net.fault` for a draw (#552); the interop
part and the match budgets (#553); bridges, ports, readings and world pages (#554); net.rollback, net.budget and
net.feel through deep_run (the Scope names net.rollback and net.budget, no criterion runs them there); a fault a peer
tells the others of when only one copy traps (every copy traps alike in criterion 4); a peer's entry naming an input
the piece doesn't declare (no criterion's piece declares a world); `left` and `timeout` in a record (#549's suite); a
live match's desync or fault; draw_after in deep_kinds' net@1 (#552's field). They are follow-ups for the implementer's
own tests or the sibling parts.

## What the implementer adds outside this folder

- The lanes lines above.
- In the net module (`deep-net`) and `deep-show`'s `match`: a peer's entry checked as the viewer's are, at the step it
  lands, with the copy report's `refused`; the full-state hash's locator (each copy steps again from its checkpoint at
  or before the last matching hash, a hash at every step, then a hash per field at the first that differs), with
  `desync`; the track hash in each hash message and the entries-first exchange, with `hashes[].track` and `cause`; a
  trap in a confirmed step ending the match as faulted on every copy, with `fault`; `match` in `match`'s copies;
  `match`'s `plant`, `relay.direct` and `plays[].to`; the relay log's `bytes`; the five planted names.
- In `deep_kinds`: net@1's `check_kinds`, net@1 listed with `module_missing` in a build without the net module, and
  a gallery example of a two-player piece (its program among `crates/deep-show/gallery/*.wasm`).
- In the verdict path deep_run reads: `net.desync {seed}` on a claim's deliverable, with the row's `results`, and
  net.rollback and net.budget beside it (the Scope).
