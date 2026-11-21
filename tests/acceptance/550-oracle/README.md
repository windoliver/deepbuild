# Acceptance tests for #550, Oracle lane: the upstream desync tests, run against our copies

Written first, blind, from four sources:

- issue #550 (live: `gh issue view 550 --repo windoliver/deepbuild`), whose Oracle line reads: "upstream tests,
  pinned by commit, for 1 of 7 criteria … A linked test counts only when run against our output (#136). Without a
  runner the lane is BLOCKED with one unblock ask";
- its Oracle page, `doneright/oracles/issues/550.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the two upstream files that page pins, at the commits it pins (its vendor copies);
- the #550 suite's surface (`tests/acceptance/550/README.md`, written by the same job) and the base commit `531da1ef0`
  ("Merge pull request #2910").

The job never saw an implementation of #550, and no other worktree, branch or pull request was read. #136's rule
applies: each case here is our document and our `match` call, and asserts on what our copies report. We have that
runner (the test relay behind `match`, #549's), so the lane isn't BLOCKED. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The page links upstream tests to criterion 1 alone (its own count, "1 of 7", predates criteria 8 to 10); its "No
upstream test" table gives criteria 2 to 7 none, and they stay with `tests/acceptance/550/`.

## Sources

| Criterion | Upstream, pinned | File and tests | Use | What it checks | Here |
|---|---|---|---|---|---|
| 1 `#550.92355c66` | a rollback networking library, `d8e2cf1e16abe5c761ee6b01bab2888084c5e74c` | `tests/test_p2p_session.rs`: `test_desyncs_detected` | port | two peers with desync detection every 100 frames run 110 frames on inputs i, then one peer's state is messed up each frame while the inputs hold steady; each peer reports exactly one desync, at frame 200, with its own checksum and the other's, which differ and cross-match | `desync.test.ts`, first test |
| 1 `#550.92355c66` | an engine's physics solver, `396c9f059903aed5fec78ecd3d437a40c6415368` | its headless physics tests' rewind file: `RewindTest_ResimInSync`, `RewindTest_ResimDesyncAfterChangingMass` | port | a rewound solver resimulates: with the same inputs every resimulated step stays in sync; a force added during the resimulation at step 4 desyncs it from that step on; a mass change skipped in the resimulation desyncs it from the next step, and the desync report names the one particle that differs | `desync.test.ts`, second test |

The page's own words for the rows: the first is "a change caught at the next hash interval, as our step 310 is at 360.
Naming the first step and the field is ours"; the second is "Same rules as a rollback that must land on the forward run
and a desync named by what differs."

Licenses as the oracle repo's pins record them (the first MIT OR Apache-2.0). No upstream code is copied or run: each
case is re-expressed as our document and our `match` call, and the receiving file names its upstream files, tests and
commits. Nothing is copied, so no notice is carried.

## Re-expressed

- **The rollback library's desync test.** The game is the stub game of #549's Oracle lane (`stubProgram`, `stubDoc` in
  `../549/fixtures.ts`): the logic item `game` reading the slider `inp`, whose `state` gains 2 on a step whose entries
  sum to an even number and loses 1 otherwise, and whose `frame` counts steps. The match: 2 players, 20 Hz, window 0,
  no input delay (upstream sets none), a full-state hash every 100 match steps. The inputs: each player gives i at step
  i for i below 110, then player 1 gives 0 and player 2 gives 1 (upstream's steady inputs) on to step 400, so a copy
  that missed the hash for 200 would hash again at 300. "Mess up the state" is the plant `{player: 1, step: 110,
  field: "game.state", add: 1}`: right after copy 1 runs step 110, `game.state` gains 1, and again whenever copy 1
  runs that step. Upstream sets the state to 1234 before every frame from 110; our state carries forward, so one
  change keeps the copies apart, and our lockstep never loads a state that could repair it. **Expected, upstream's**:
  no desync before frame 200 (the copies share the hash at steps 0 and 100); both report the desync at frame 200 with
  differing checksums (each copy's hash at step 200 differs from the other's, so each copy's own and the other's
  cross-match); and the report comes at the first interval after the change (neither copy hashes past 200, and both
  end `desync`).
- **The engine's rewind tests.** The piece is the #550 suite's paddle piece (`../550/fixtures.ts`), whose net.desync
  locator steps each copy again from its checkpoint and compares full-state hashes step by step, as a rewound solver
  resimulates. "The same inputs, every resimulated step in sync" is the honest rally with no plant: both copies play
  600 steps with no desync and share every full-state hash. "A force added during the resimulation at step 4" is the
  plant `UNIT_SHIFT`, a one-unit push to the ball's x velocity in copy 2 at match step 310, made again whenever copy 2
  runs that step (upstream adds its force only during the resimulation; ours lands on the forward run and on every
  run again alike, so the copies part where upstream's runs part). **Expected, upstream's**: in sync before that step
  and desynced from it on (net.desync's first step is 310 on both copies, and their hashes at 360 still differ); and
  the one particle that differs is named (net.desync names one field, the ball's x velocity `court.ball_vx`, with
  module `logic`).

## Left out, and why

- **Everything else in the two files**: input delay, prediction, rollback by sync test, spectators, sessions and the
  other rewind cases (sleeping, teleports, spawns, kinematic changes, sim callbacks, followers). The page links only
  the cases above to #550; rollback is #551's.
- **The net.desync report's step and field beyond the engine's "one particle"**: the page calls them ours; criterion 1
  and its neighbours test them in `tests/acceptance/550/`.
- **A real network between the peers.** Our check kinds run copies in one process over a test relay with no network
  (Check input: net kinds), and so does this lane.

## Run

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/550-oracle desync.test.ts --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/550-oracle/tsconfig.json   # type check
rm -rf tests/acceptance/550-oracle/node_modules                                      # vitest's cache after a --root run
```

`helpers.ts` re-exports the #550 suite's helpers and fixtures (`../550/`, read only) and the stub game of #549's suite
(`../549/fixtures.ts`), so both lanes build and ask the same binary the same way: `cargo build --locked --bin deep-show
--no-default-features --features full`, once, in `beforeAll`, copied to a temporary folder. The lane starts no relay,
certificate, door or browser: every copy runs inside one `deep-show run`. Each `it` passes its own 5,400,000 ms
timeout. Without cargo a test is `BLOCKED:`; a `deep-show run` that doesn't finish in 40 minutes is `INCONCLUSIVE:`
when the 1-minute load is above the cores, and a plain failure otherwise. Neither is a pass.

**`scripts/lanes.mjs` needs `'tests/acceptance/550-oracle/'` in its `alone` list.** The #550 README gives the line, and
the implementer makes that edit.

## The surface under test

The #550 suite's (its README: The surface under test), with nothing added: `deep show` of each piece; `match` with
`plays`, `relay: {seed}` where given and `plant`; each copy's `player`, `ran`, `end`, `hashes` and `desync`.

## Criteria to tests

| ID | Test (in `desync.test.ts`) | Upstream | Ours |
|---|---|---|---|
| `#550.92355c66` | a state messed up after step 110 is caught by both copies at the hash for step 200, every 100 steps, each with its own hash and the other's differing | `test_desyncs_detected` | the stub game, a hash every 100 steps, `game.state` + 1 in copy 1 after step 110: hashes shared at 0 and 100, differing at 200, nothing hashed past 200, both `desync` |
| `#550.92355c66` | with the same inputs every hash stays in sync, and a push to the ball at step 310 desyncs the copies from that step on, naming the one field that differs | `RewindTest_ResimInSync`, `RewindTest_ResimDesyncAfterChangingMass` | the paddle piece: with no plant, 600 steps, every hash shared, no desync; with `UNIT_SHIFT`, net.desync names 310, `logic` and `court.ball_vx` on both copies and the hashes at 360 differ |

Test count: 2. Wrong programs each fails on: the merge base (no plant, no locator, below); a desync check that waits
past the next interval or catches nothing; a locator that names the hash's step or another field.

## At the base

Both tests fail at the base `531da1ef0`, at an assertion, and neither is a guard
(`tests/acceptance/550/BASE-FAILURE.txt` holds the run; this lane's part reads `desync.test.ts (2 tests | 2
failed)`):

- "a state messed up after step 110 …": the base's `match` ignores `plant`, so both copies share the hash at 200 too
  (`4e279c2fbdf54c21` on both), play on to step 400 hashing 300, and end with no desync.
- "with the same inputs every hash stays in sync …": its first half, 600 steps with no plant, holds at the base, every
  hash shared; its second fails, the plant ignored, both copies sharing the hash at 360 (`27e9650d75149827`) and their
  reports holding no `desync`.
