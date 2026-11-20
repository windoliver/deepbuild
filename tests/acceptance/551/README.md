# Acceptance tests for #551: rollback with prediction, a window, logic's page-diff snapshots, the rate rule and the lead rule

Written first, blind, from issue #551 (live: its Scope, its Fields, its eleven acceptance criteria, its Proof line and
its Oracle line), the design sections it links and those they lean on, and the base commit `2bfb67db1` ("Merge #550's
branch … as #551's base": main `86b99ac36` plus #550's open branch, which #551 depends on), by a job that never saw an
implementation. No other worktree, branch, pull request, stash or plan was read. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Lean: one file per criterion, each test's name carrying its criterion's ID, and exactly the plants and planted twins
the criteria name. The Oracle line's lane is `tests/acceptance/551-oracle/`.

## What was read

- The issue (`gh issue view 551 --repo windoliver/deepbuild`); for scope only, its parent #179, the epic #310, its
  dependencies #550 and #522, and the siblings #549 (closed), #552 (`match.me`, fog, draws), #553 (rollback over logic
  occurrences' voices and saves, the app and web interop through the shipped relay, the match budgets) and #554
  (bridges, ports, readings, world pages). Their behaviour isn't tested here.
- The Oracle page `doneright/oracles/issues/551.md` on branch `doneright` of `DeepBuildAI/deepbuild`, and the upstream
  files it pins (its vendor copies, read for the Oracle lane alone).
- `docs/technical-design.md`: The net module (Match, Rollback, Lockstep, Desync and replay, Relay and Join, Relay
  protocol); Scenes, physics and the canvas core (Physics, Logic, Shared play); Every task carries its own budgets and
  The reference Macs (the five-run rule). `docs/canvas-primitives.md`: Shared play over a relay (Net `net@1`, Net:
  rollback, Net: lockstep, Net: desync and replay, Net: relay and Join, Net: relay protocol `relay@1`); Check input:
  net kinds; Logic `logic@1`, Logic: sandbox (the page bitmap: every store, `memory.fill` and `memory.copy`), Logic:
  checkpoints and bake; World and backend, Input track entries, Physics output, Checkpoint ring (#522); Control (its
  `keys`); The cost model's class table (showpiece: 4 ms of frame CPU) and Frame budget (the five runs).
  `docs/parallel-proof.md`, section 6. `CONTRIBUTING.md`. AGENTS.md.
- The suites `549/` (its README, `helpers.ts` and `fixtures.ts`, which this suite imports), `549-oracle/`, `550/`
  (README, helpers, fixtures), `550-oracle/`, `522/` (README: worlds, the ring, seeks, late entries), and the READMEs of
  `546/` (a budget's web part BLOCKED, `blocked: [{host, ask}]`), `172/` (the web player's budgets) and `540/` (a world
  in a piece, `launch` with `from.pos`).
- At the base, only for surfaces: `crates/deep-net/` (its README's deviations: lockstep only; "A physics world in a
  match's piece isn't stepped live or hashed yet"), `crates/deep-net/src/play.rs` (the test relay's faults),
  `src/checks.rs` (net.rollback and net.budget answer BLOCKED above window 0; net.budget's `busiest`, `frame_ms`,
  `window`, `rollback_snapshot_bytes`), `src/kind.rs` (net@1's ranges), `crates/deep-show/src/net.rs` (`match`'s members),
  `crates/deep-player/web/element.js` and `src/page.rs` (the web player takes no key or pointer input yet; `probe()`),
  `crates/deep-canvas-physics/src/doc.rs` and `doc/data.rs` (a world's bodies, `locks`, input `data` expressions with
  `vec3`), `crates/deep-logic/src/play.rs` (a logic item reads a world only through a character's readings),
  `crates/deep-show/gallery/net-rally.json`, `scripts/proof-change.mjs` (`criterionId`), `scripts/public-text.mjs`.

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and `fixtures.ts`.

## What the base already does, and these tests don't credit

From the base's code and this job's runs there (`BASE-FAILURE.txt`, and a scratch run of the fixtures):

- **#549's lockstep match and #550's checks**: `match` plays every copy in one process over the test relay; a match
  whose window is above 0 plays in lockstep, never predicts, and reports `rollbacks: 0`; net.rollback and net.budget
  answer `BLOCKED` for it. A copy steps its logic items only, never a world, and its report holds no `rolled_back` and
  no `occurrences`. `match` ignores `relay.back`, `relay.deliver`, `relay.latency`, `seek`, `ring` and `on`; there is no
  `replay` call; the eight planted names are refused (`{"ok": false, "code": "bad_input"}`).
- **net@1's ranges**: a net item with delay 31 or window 17 is refused at check, naming the field, and delay 30 with
  window 0 is accepted (the scratch run). Criterion 10's test holds them in one `it` with the budget half, which fails
  at the base, so no test credits them alone.
- **The fixtures are valid at the base**: the paddle piece, its three-player form, the economy piece and the burning
  pieces are each presented with no error issue (the scratch run).
- **The rate rule** isn't there: a 7 Hz logic item in a 20 Hz match is presented.
- **net.budget in lockstep** already measures the busiest match step: on the calibration piece (window 0, delay 6) it
  reads PASS with `busiest {copy, step, ms}`, `frame_ms` 4, `window` 0 and `rollback_snapshot_bytes` 0, but no `runs`.
- **The web player** takes no key or pointer input, and `probe().match` holds no `rolled_back` or `occurrences`. In
  headless Chrome on this Mac its bundle stops before `ready` with the notice "unreachable" on every 3D piece with a
  mark this job tried at the base, #549's lockstep piece included, and is ready on the same piece with its marks taken
  out (a scratch run). So criterion 1's live part and the Oracle lane's portability case stop there at the base, before
  their match; the paddle piece itself isn't what the player refuses.

Every test fails at the base and none is a guard; `BASE-FAILURE.txt` is the run.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH. In a fresh worktree run `npm ci` and `npm run build
--workspaces` once (the lease runs through `packages/cli/dist`). Then run one file at a time, each under the machine's
lease:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
for f in ac1-app-and-web ac2-replay-export ac3-budget-window ac4-page-snapshots ac5-rate-rule ac6-page-before-image \
         ac7-replaced-checkpoint ac8-lead-rule ac9-budget-together ac10-lockstep-budget ac11-three-players; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/551 $f.test.ts --testTimeout=600000 --hookTimeout=180000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/551/tsconfig.json   # type check
rm -rf tests/acceptance/551/node_modules                                      # vitest's cache after a --root run
```

Every `it` and every build hook passes its own timeout (#549's `TIMEOUT`, 5,400,000 ms), which `--testTimeout` doesn't
shorten. What each file builds, in `beforeAll` (#549's `useBuilds`: `cargo build --locked --bin deep-show
--no-default-features --features full`, the binary copied out of the target, so the files run one at a time), and
starts:

| File | Builds | Starts |
|---|---|---|
| `ac1-app-and-web.test.ts` | `deep-show` (`full`), `deep-relay` | a certificate; the shipped relay behind #549's door; the web bundle served on 127.0.0.1; headless Chrome; the app's live copy (about 20 s of match); then `match` in process three times |
| `ac2-replay-export.test.ts` | `deep-show` | `match` of 3,600 steps; the replays and two png_seq exports of about 600 frames; `match` of 1,200 steps |
| `ac3-budget-window.test.ts` | `deep-show` | `match` with net.budget, twice |
| `ac4-page-snapshots.test.ts` | `deep-show` | `match` six times |
| `ac5-rate-rule.test.ts` | `deep-show` | `deep show` three times, `match` once (more where the planted rule presents) |
| `ac6-page-before-image.test.ts` | `deep-show` | `match` three times |
| `ac7-replaced-checkpoint.test.ts` | `deep-show` | `match` and `replay`, twice each |
| `ac8-lead-rule.test.ts` | `deep-show` | `match` twice |
| `ac9-budget-together.test.ts` | `deep-show` | `match` with net.budget, twice |
| `ac10-lockstep-budget.test.ts` | `deep-show` | `deep show` of three net items, `match` with net.budget twice |
| `ac11-three-players.test.ts` | `deep-show` | `match` four times |

- **Processes and hosts.** Every `deep-show`, relay and Chrome is stopped by its PID after its test (#549's helpers);
  the door and the bundle's server live in the test process and are closed after their test; temporary folders are
  deleted. Everything listens on 127.0.0.1 at a port it picks. `https://relay.test/551` is declared only by pieces that
  never join: `match` plays every copy in one process with no network.
- **Imports.** Node built-ins, vitest, `../549/helpers.ts` (read only; it imports `../309/helpers.ts` and
  `../549/fixtures.ts`).

**Gates.** None is ever a pass. `BLOCKED:` when cargo can't run, the `openssl` CLI is missing (criterion 1's
certificate), Chrome isn't at its path or offers no WebGPU adapter headless (criterion 1's web part, #549's `Chrome`
and `mustBeReady`). `INCONCLUSIVE:` when a live phase didn't finish in its time and the 1-minute load is above the core
count (#549's `gaveUp`), and for a timing verdict (criteria 3, 9 and 10) off a reference Mac or where net.budget's five
runs don't decide.

## The lanes line

`scripts/lanes.mjs`, beside #550's:

```js
// #551's files each build deep-show (ac1 and the Oracle lane also the shipped relay) and play matches in process; ac1 and
// the Oracle lane also play a live match between the app and headless Chrome's web player through the shipped relay.
alone.push('tests/acceptance/551/', 'tests/acceptance/551-oracle/');
```

Criteria 3, 9 and 10 read times through net.budget's own five runs; no file times anything itself, so none is listed
`timed`. No file is by hand.

## Criteria to tests

IDs are `#551.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue. Each test's name starts `AC<n> #551.<h8>`;
each file quotes its criterion in full and names the wrong programs it fails.

| AC | ID | File (tests) | Surface | What it asserts | Plants and twins |
|---|---|---|---|---|---|
| 1 | `#551.6a2c4947` | `ac1-app-and-web.test.ts` (2) | `play_match` in the app and the web player in headless Chrome, through the shipped relay behind #549's door; `match`, `check: "net.rollback"`, `relay.back` | The app's copy (player 1, its script) and the web player's (player 2, a person's key presses) under frames held back up to 8 steps: both roll back; their full-state hashes, at every confirmed step, equal each other's and the on-time `match` run's; their occurrences equal the on-time run's; their records' merged tracks equal the on-time run's and the entries made, player 2's being the keys pressed, in order. In process, net.rollback passes the honest copies under a seeded hold of up to 8 steps and fails the planted one, its lowest named step being the first step its copies part from the on-time run | `net_applies_at_arrival` |
| 2 | `#551.9b064904` | `ac2-replay-export.test.ts` (2) | `match` with `relay.back`, `replay`, `sockets`, `export` (png_seq) | 3,600 steps with at least 50 rollbacks; both records agree on every step both confirmed and hold exactly the entries made, 2 steps on; each record's `replay`, alone, gives the match's hash at every hash interval and the two replays agree; `sockets` shows nothing opened; the exports from both records hold equal raw frame hashes, one a frame up to the last confirmed step, at least 10 distinct. The planted copy fails the same track rule, naming a step where its record holds an entry no player made | `net_records_predicted` |
| 3 | `#551.5f93fc7b` | `ac3-budget-window.test.ts` (2) | `match`, `check: "net.budget"` | The paddle piece: PASS, as its five runs give. The burning piece (about 0.8 ms a step, window 8): FAIL as its five runs give, a failure naming module `logic`, each run's live step within the frame and its window over it | the burning piece, window 8 |
| 4 | `#551.44ef3626` | `ac4-page-snapshots.test.ts` (3) | `match`, `check: "net.budget"`, `ring: "full"`, `relay.back`, `check: "net.rollback"` | `snapshot_bytes_per_s.logic` under 12 MiB/s and at least one page a step (3.75 MiB/s); with whole copies, 4 MiB × 60 a second (within 1%). Rollbacks from page diffs and from whole copies give equal full-state hashes at every confirmed step. The planted ring fails net.rollback, its lowest named step the first its copies part from the on-time run | `net_ring_misses_fill` |
| 5 | `#551.25b0bcea` | `ac5-rate-rule.test.ts` (3) | `deep show`; `match`, `check: "net.rollback"`, `relay.back` | The economy piece (20 Hz match, 1 Hz `economy`, 120 Hz court) is presented and net.rollback passes it, both copies rolling back and agreeing at every confirmed step. With `market` at 7 Hz it is refused, an error issue naming `market` and both step lengths (100,800,000 and 35,280,000 flicks, or 1/7 s and 1/20 s), none naming `economy`. Under the planted rule the same judge fails, the economy piece refused at check, naming `economy` | `net_rate_faster_only` |
| 6 | `#551.8bad0f6c` | `ac6-page-before-image.test.ts` (2) | `match` with `relay.deliver`, `check: "net.rollback"` | Copy 1 rolls back to 625 from step 628 or later and never past the window, its hash at 625 is the on-time run's, and so is every confirmed step's after; copy 2's too. The planted ring fails net.rollback, naming step 625 as the lowest step | `net_ring_keeps_after` |
| 7 | `#551.9ce1e5fd` | `ac7-replaced-checkpoint.test.ts` (2) | `match` with `relay.deliver` and `seek`; `replay` | Copy 1 rolls back to 598 after step 601; after the match its seek to 610 restores checkpoint 600 and gives the hash a straight `replay` of its record gives at 610. Under the planted rollback the same judge fails, naming the seek from checkpoint 600 | `net_keeps_replaced_checkpoint` |
| 8 | `#551.1600fba6` | `ac8-lead-rule.test.ts` (2) | `match` with `relay.latency: [5, 80]` | Both copies roll back; their mean rollback depths differ by at most one step; neither waits. The planted copy fails the same judge, a failure naming both copies' depth histograms | `net_ignores_lead_rule` |
| 9 | `#551.75e2a4bd` | `ac9-budget-together.test.ts` (2) | `match`, `check: "net.budget"`, `on: ["app", "web"]` | The burning piece (about 2.4 ms a step, window 1): FAIL as its five runs give, naming `logic`, each run's live step and window each within the frame. The paddle piece on app and web: verdict BLOCKED, one `blocked` entry, host web, with its ask, no failure naming web | the burning piece, window 1 |
| 10 | `#551.4b4f0458` | `ac10-lockstep-budget.test.ts` (1) | `deep show`; `match`, `check: "net.budget"` | Delay 31 and window 17 refused, naming the field and the item; delay 30 with window 0 presented. The 3 ms piece with window 8: FAIL, naming `logic`; with window 0 and delay 6: PASS, no window time in any run, `window` 0, `busiest.step` one of the heavy steps and `busiest.ms` at least half the heavy step's calibrated time and within the frame | the 3 ms piece |
| 11 | `#551.b7783405` | `ac11-three-players.test.ts` (3) | `match`, `check: "net.rollback"` (its own schedules; then `relay.deliver`) | With no schedule given, net.rollback passes the three-player piece and lists 9 schedules: 8 seeded (distinct seeds) and one `{exactly: 8}`. Under the frame at 643 it passes, copy 1 rolls back to 636, and every copy's hash equals the on-time run's at every confirmed step. The planted rollback fails net.rollback, naming 636 as the lowest step | `net_rewinds_to_last_read` |

Test count: 2 + 2 + 2 + 3 + 3 + 2 + 2 + 2 + 2 + 1 + 3 = 24 (and 5 in the Oracle lane).

## The surface under test

The issue names a ring, a prediction, `confirmed`, check kinds and their reports, a seek, an export, a depth
histogram and planted programs, but no call. As #549's and #550's suites do, everything in the app is driven through
`deep-show run` (#393: one JSON scenario on stdin, one answer line `{"ok": true, "replies": [...]}`), every match in
process through `match` (#540's, #549's, #550's), the live match through #549's `play_match` and the web player in
headless Chrome. **Every call, member, field and name below is marked as the issue's or the design's own, #549's or
#550's suite's, or this job's choice. The implementer builds exactly these, or a dispute goes to a blind redraft.**
Times are flicks in calls (705,600,000 a second) and seconds in reports, unless a field says ms; hashes are lower-case
hex.

### The scenario

#549's world (`helpers.ts`'s `world`: one agent's session, the process table with your shell's peer pid 3002, the
documents on panels `main`, `side-1`, …, #383's clock), plus `planted` (Planted twins, below).

### `match`'s members

| Member | What | Whose |
|---|---|---|
| `doc`, `steps`, `plays` | the presented document, how many match steps, each player's script `{"<player>": [{step, control, value}]}`: an entry `{step: g}` is made when step g is the first its copy hasn't run, stamped `delay` steps later | #540's, #549's |
| `relay.seed`, `relay.log` | the test relay's seed; its log | #549's |
| **`relay.back`** | `{up_to: n}`: the relay holds each frame back a seeded whole number of match steps from 0 to n, so frames may arrive in another order than sent ("held back by up to 8 steps in a seeded order"); `{exactly: n}`: every frame exactly n steps ("one that holds every message 8 steps") | this job's |
| **`relay.deliver`** | `[{player, step, to, at}]`: player `player`'s message for match step `step` reaches copy `to` only once that copy has run step `at`; every frame of that player's to that copy carrying it waits till then (the repeat rule carries it in later frames too), and everything else is on time. Two entries with one `to` and `at` reach that copy in one delivery, before it runs step `at` + 1 | this job's |
| **`relay.latency`** | `[ms, …]`, one per player: that player's frames take that long to the relay and from it, on the relay's own clock (net.feel's `latency`, one-way, one per player) | the design's word; the member this job's |
| `check` | `"net.rollback"` or `"net.budget"`: runs that check kind on this match and adds `check` to the reply | #549's |
| **`on`** | `["app"]` or `["app", "web"]`: net.budget's hosts | the design's `on` |
| **`seek`** | `[{player, step}]`: after the match ends, in copy `player`, as the match left its record and its modules' own rings, a seek to match step `step`: each canvas module restores its nearest checkpoint at or before it on its own ring and steps forward. The reply's **`seeks`** holds one `{player, step, from, hash}` each: `from` the step of the logic checkpoint it restored, `hash` the full-state hash at `step` | this job's |
| **`ring`** | `"full"`: logic's rollback checkpoints hold its whole memory and globals at each match step, in place of the pages each step wrote: the reference criterion 4 compares page diffs with | this job's |

The reply's `copies` are the run under the relay's schedule. With `check: "net.rollback"`, the check plays the on-time
run beside it: when `relay` gives `back` or `deliver`, its held-back run is that schedule's; when it gives neither,
net.rollback plays the design's own: 8 schedules seeded from `relay.seed` that hold each player's messages back by up to
the window in a seeded order, and one that holds every message exactly `window` steps, and the reply's `copies` are the
first held-back run's.

### `replay`

**`{call: "replay", doc, track, steps, hash_every}`** (this job's) → `{hashes: [{step, hash}]}`: the presented
document played alone from its start on `track` (a record's merged track, entries `{t, seq, control, value, writer,
player}`), in this process with no relay and no peer, every canvas module stepped as a match's copy steps it, for
`steps` match steps, its full-state hash at every `hash_every`-th step, keyed as a match copy's `hashes` are.

`sockets` (#549's) after it must list nothing. `export` is #501's, with `track`, `range` in frames, `size`,
`frame_rate` and `video.codec: "png_seq"`; its `receipt.frame_hashes` are the raw frames' hashes.

### A copy's report

#549's (`player`, `ran`, `rollbacks`, `hashes`, `waits`, `notices`, `end`, `record` with `confirmed` and `track`,
`ran_at`, `steps`), in `match`'s `copies`, `play_match`'s reply and the web player's `probe().match`, with:

| Field | What | Whose |
|---|---|---|
| `rollbacks` | how many times it rolled back | #549's |
| **`rolled_back`** | `[{from, to}]`, every rollback: `from` the last match step it had run when the late message arrived, `to` the match step whose checkpoints it restored, the late entry's step; its **depth** is `from − to + 1`, the steps it stepped again | the design's depth; the field this job's |
| **`occurrences`** | the occurrences of every step it confirmed, as it holds them at the end: rows `{step, item, kind, …}`, each canvas module's (the world's contacts, logic's), `step` the match step that made it, `item` its item | the design's word; the field this job's |
| `hashes` | the full-state hash at each hash interval it confirmed; with `hash_every: 1`, at every confirmed step | #549's |
| `record.confirmed` | the issue's `confirmed: step` | #549's |
| `waits` | each time it waited, as at the window | #549's |

### A check's report

#549's `{kind, verdict, failures}`, with:

- **net.rollback**: each failure names the `step` it found (the first step whose full-state hash, occurrences,
  checkpoints, step hashes or track part from the on-time run's, or a rollback's step past the window); **`schedules`**:
  the held-back runs it played, each `{seed}`, `{exactly: n}`, or the given one.
- **net.budget**: **`runs`**: five runs after warm-up, each `{step_ms, window_ms}`: the live match step with its
  checkpoints, and restoring and stepping the full window again with a checkpoint at each re-run step (0 in lockstep),
  their sum a run's worst frame; `frame_ms` (#549's), the class's frame CPU; `verdict` by the five-run rule; each
  failure names the **`module`** that costs most; `busiest` (#549's) `{step, ms}`; `window` (#549's); **`snapshot_bytes_per_s`**:
  `{<canvas module>: bytes}`, the rollback snapshot bytes each module's ring writes a second at the live step rate;
  **`blocked`**: `[{host, ask}]` for a host in `on` that hasn't run (#546's shape).

### The live match (criterion 1)

#549's surfaces as its README gives them: the app's prompt and a person's click, `play_match` with `plays` and
`link_to`, the web bundle (`export` with `video.codec: "web"`), its `<deep-player>` with `ready`, `probe().match` and
the `data-deep-join` prompt, the door. This job adds one: **a person's keys on the web player**. While its copy plays a
match, the web player takes a person's key presses on the page (the browser's own input, `Input.dispatchKeyEvent`
from DevTools, the page focused by the person's Join click) for each control whose `keys` name the key (Control:
`keys: {key → value}`), as entries of its player, as a person's input in the app is. The paddle piece's `paddle2` takes
the keys 1 to 7.

### Planted twins

Each is one criterion's wrong program, reachable only through the scenario's `planted`, and changes nothing else.

| Name | Criterion | The wrong program |
|---|---|---|
| `net_applies_at_arrival` | 1 | a late entry is applied at the step the copy was on when it arrived, not restored to its own step |
| `net_records_predicted` | 2 | a copy's record keeps an entry for each predicted step of a player, repeating the player's last input |
| `net_ring_misses_fill` | 4 | logic's rollback ring finds written pages from stores alone, missing what `memory.fill` writes |
| `net_rate_faster_only` | 5 | the rate rule accepts only an item whose step divides the match step's |
| `net_ring_keeps_after` | 6 | logic's rollback checkpoint keeps each step's pages as the step left them, not as they were before it |
| `net_keeps_replaced_checkpoint` | 7 | a rollback keeps the checkpoints the replaced steps took on logic's own ring |
| `net_ignores_lead_rule` | 8 | a copy never holds its clock for its lead |
| `net_rewinds_to_last_read` | 11 | a frame's late entries roll back to the step of the last entry read, not the earliest |

The plants named by the criteria that aren't programs: criterion 3's, 9's and 10's burning pieces.

## Fixtures

All made at test time in `fixtures.ts`; no personal data; CC0.

- **The paddle piece** (`paddleDoc`): a 3D scene of 640 × 360 in the showpiece class, seed 551, span 70 s; a camera,
  a table, and the ball and two paddles drawn where the world puts them (its outputs to `items/<id>/at`); the sliders
  `paddle1` and `paddle2` (−10 to 10 by 0.5; `paddle2` also on the keys 1 to 7, at −7.5 to 7.5), `serve` (−1 to 1 by
  1) and `spin` (−1 to 1 by 0.25); the world `court`, the logic item `rules` and the net item `match` (2 or 3 players,
  60 Hz, delay 2, window 8, a hash every 60 steps unless a test sets 1).
- **`court`** (physics.world@1, 120 Hz, no gravity): a ball of radius 0.5 (dynamic, its y and turning locked), two
  paddles 6 m long at x = ∓18 (dynamic, every axis locked, so a ball bounces off them as off a wall) and two walls at
  z = ±11, all with friction 0 and restitution 1. Inputs: `move_1`, `move_2` (a `launch` from the paddle control's
  value, `from.pos` `vec3(∓18, 0.5, paddle<n>)`), `serve` (a `launch` of the ball from the middle at `vec3(9 × serve,
  0, 5)`).
- **`rules`** (`rulesProgram`): WebAssembly written as bytes, 64 pages (4 MiB), no import. Its write region holds
  `score` (i32 × 2), `serving` (i32) and `tally` (i32), read back each step. A serve from the serving player scores them
  a point and passes the serve; every paddle and spin entry folds into the tally (t × 31 + player × 1000 + ⌊value ×
  scale⌋ + c). At k ≡ 3 (mod 10) it fills page 50 whole with `memory.fill`, its byte from the tally and the step; at k
  ≡ 10, 27 (mod 60) it stores the step and the tally at the start of page 40. Nothing else writes either page, so a step
  writes at most 3 of its 64 pages: page 0 (its regions) always. Its logic checkpoints come every 60 steps. A scratch
  run in Node's own WebAssembly checked it validates and writes pages 40 and 50 as said.
- **The economy piece** (`economyDoc`, criterion 5): the court and `economy` (the same program at 1 Hz) in a 20 Hz
  match, a hash every step; `market` (7 Hz) beside them for the refusal.
- **The burning pieces** (`burnDoc`, criteria 3, 9, 10): logic items `burn_1` … `burn_n` (`burnProgram`: four
  dependent 64-bit divisions an iteration, so its fuel stays under each item's 10,000,000 a step) that together spend
  the step's time, beside a world of one ball resting on a floor, which costs next to nothing. The iterations per
  millisecond (`ITERATIONS_PER_MS`, 68,000) were read off net.budget's `busiest.ms` in lockstep at the base on the
  reference Mac this job ran on (an M5 Max), the dev build these tests run: 50,000, 100,000 and 150,000 iterations read
  0.74, 1.45 and 2.18 ms. At most 150,000 iterations an item (9,000,000 fuel). Criterion 3's piece about 0.8 ms every step, criterion
  9's about 2.4 ms every step, criterion 10's about 2.6 ms one step in every 10, under 4 ms on the slower reference
  Macs too.
- **Scripts** (`rally`): serves alternate every 240 steps from step 30; every 12 steps each paddle player aims at where
  the file's own model of the court says the ball next reaches its paddle, half a slider step either side in turn, so
  its paddle hits the ball and its entries keep changing; a third player spins every 7 steps. The model is only the
  script's aim; no test reads it. `withOnly` clears a player's entries around a criterion's own late entry.

## Readings where the issue and the design leave a choice

- **"The two-player piece"** is this suite's paddle piece, made in test code: its logic keeps score and its world has
  the ball both paddles hit. A logic item can't read a world at the base beyond a character's readings, and the issue
  doesn't ask for it, so the score is kept from the players' entries (serves), and the ball lives in the world alone.
- **"A copy in the app and a copy in headless Chrome's web player over a local test relay"** (criterion 1): two
  processes can't share the in-process test relay, so the local relay is the shipped one on 127.0.0.1 behind #549's
  door, which holds each frame it forwards back by a seeded 0 to 8 steps' time (133 ms at 60 Hz). The door keeps the
  frames' order on each connection; the in-process schedule `relay.back` is where frames may also change order, and
  criterion 1's planted copy is judged there.
- **"From recorded input tracks"** (criterion 1): the app's copy plays player 1's script through `play_match`; the
  web player takes nothing from a host page but play, pause, the clock and the stages (its element's own rule), so its
  player's track is recorded the way a person makes one: key presses on paddle 2's keys. The run where every message
  is on time then plays player 1's script and player 2's entries at the steps the records hold them; the test also
  holds player 2's recorded entries to the keys pressed, in order.
- **"Holds no occurrence from a replaced step"**: each copy's `occurrences` equal the on-time run's on every step both
  confirmed: a row a replaced step made is one the on-time run never makes.
- **"The same full-state hash at every confirmed step"**: `hash_every: 1` where a criterion reads it.
- **"Replays … alone and with the network off"** (criterion 2): `replay` in a `deep-show run` that joins nothing, and
  `sockets` listing nothing. **"Exports to frames whose raw hashes equal a second replay's export"**: png_seq exports
  from copy 1's record and from copy 2's, 10 frames a second up to the last step both confirmed (the range's end is in
  the document's frames, 60 a second, since the time grammar's `"<n>f"` counts those, so 6 to an export frame); at
  least 10 distinct frames, so the frames show the match. **"A planted copy that records a predicted entry fails, naming the step"**: the
  track rule (both records agree, and hold the entries made and nothing else) names the step where they part, which is
  a step the planted record holds an entry no player made.
- **"Within its class's frame time"** (criteria 3, 9, 10): the showpiece class, 4 ms of frame CPU, the class the design
  names for an action game; each piece names it. "Each fit alone but not together" (criterion 9): each run's
  `step_ms` and `window_ms` are each under `frame_ms` and the verdict is FAIL by the five-run rule on their sum.
- **"The canvas module that costs most"**: a failure's `module`; the burning pieces' logic is far costlier than their
  resting world, so `logic`.
- **"Reads BLOCKED until its headless Chrome run"** (criterion 9): net.budget on `["app", "web"]` is run by `match` in
  the app's process, which starts no browser, so its web part has had no headless Chrome run there: it reads BLOCKED,
  with one ask, and the verdict is BLOCKED, never PASS. This suite doesn't make the web part's browser run itself: the
  issue says what the part reads until then, and the design gives that run to the check, not to a test.
- **"Net.budget counts under 12 MiB/s of logic snapshot bytes at 60 Hz"** (criterion 4): bytes a second at the live
  step rate, one checkpoint a match step: whole copies of 4 MiB at 60 Hz are 240 MiB/s exactly, which the `ring: "full"`
  run must count. **"A rollback from these snapshots … as one from full copies"**: the same held-back schedule under
  both rings, equal hashes at every confirmed step.
- **"Fails net.rollback, naming the first step that differs"** (criteria 1, 4): the lowest step net.rollback's failures
  name equals the first step at which the held-back run's copies (the reply's `copies`, under the given schedule) part
  from the on-time run's, which the test finds from both runs' hashes.
- **"Naming step 625, whether it restores the wrong bytes or steps again from the checkpoint at step 600"** (criterion
  6): the lowest step net.rollback names is 625 either way; a rollback to 600 is past the window of 8 from 628.
- **"After the match, a seek in that copy"** (criterion 7): `match`'s `seek`, in copy 1 as the match left it; **"a
  straight replay of its record"**: `replay` of copy 1's record from step 0. **"Fails that seek, naming checkpoint
  600"**: the judge's failure names the checkpoint the seek restored, 600, and the hash it gave.
- **"Mean rollback depth"** (criterion 8): over a copy's `rolled_back`, each `from − to + 1`; **"its depth
  histogram"**: the counts of those depths, which the failure prints for both copies. **"Waits at the window"**: any
  entry in `waits`.
- **"Busiest match step costs 3 ms"** (criterion 10): one step in every 10, calibrated to about 2.6 ms on the M5 Max so
  the slower reference Macs stay under 4 ms; **"reports that one step's time"**: `busiest` names a heavy step, with at
  least half its calibrated time.
- **"8 seeded schedules and one that holds every message 8 steps"** (criterion 11): net.rollback's own, listed in
  `schedules`; **"including a frame that brings …"**: a second net.rollback under `relay.deliver`, which the design's
  seeded schedules can't be asked to contain.
- **Player numbers** are #549's: 1 for the first copy the relay seated.

## Not tested, because no criterion reaches it here

Rollback over logic occurrences' voices and saves, the trap held at an unconfirmed step, the interop part through the
shipped relay with its faults, and the match budgets against the merge base (#553); `match.me`, fog and draws (#552);
bridges, ports, readings and world pages in a match (#554); net.feel; net.budget's `windows` report (the Scope and the
design name it, no criterion reads it); an export never showing a predicted frame beyond criterion 2's exports from the
records. They are follow-ups for the implementer's own tests or the sibling parts.

## What the implementer adds outside this folder

- The lanes line above (this job wrote it).
- In the net module and `deep-show`'s `match`: prediction, the rollback ring of every canvas module with carried state
  but media (logic's from page diffs) and rollback within the window; a world stepped and hashed in a match; the rate
  rule at check; the lead rule; `relay.back`, `relay.deliver`, `relay.latency`, `seek`, `ring`, `on`; the copy report's
  `rolled_back` and `occurrences`; net.rollback's schedules and net.budget's report as above; the `replay` call; the
  eight planted names.
- In the web player: a person's keys on a control's `keys` during a match, and `probe().match`'s `rolled_back` and
  `occurrences`.
