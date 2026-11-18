# Acceptance tests for #549, Oracle lane: the upstream lockstep tests, run against our copies

Written first, blind, from four sources:

- issue #549 (live: `gh issue view 549 --repo windoliver/deepbuild`);
- its Oracle page, `doneright/oracles/issues/549.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the two upstream files that page pins, at the commit it pins;
- the #549 suite's surface (`tests/acceptance/549/README.md`, written by the same job) and the base commit `06e231702`
  ("Merge pull request #2735").

The job never saw an implementation of #549, and no other worktree, branch or pull request was read. It ran twice. The
first run wrote this lane's `helpers.ts`, `lockstep.test.ts` and `tsconfig.json` on November 16, 2026. The second, on
November 17, wrote only this README, from those files and the Oracle page; it didn't open the vendor copies, so the
line numbers and the license below are the first run's record, as `lockstep.test.ts` states them. #136's rule applies:
a linked test counts only when run against our output, so each case here shows our document and asserts on what our
copies of its match report. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

The page links upstream tests to criteria 4 and 5 of 8. The other six have none (the page's "No upstream test" table)
and stay with `tests/acceptance/549/`.

## Sources

| Criteria | Upstream, pinned | File and lines | Use | What it checks | Here |
|---|---|---|---|---|---|
| 4 `#549.a6b30a32`, 5 `#549.6bf6ea62` | a rollback networking library, `d8e2cf1e16abe5c761ee6b01bab2888084c5e74c` | `tests/test_p2p_session.rs`, lines 755 to 1026 | port | its lockstep tests (a prediction window of 0): a peer doesn't advance without the remote's input, with no input delay and with one; two peers advance 20 frames with no delay and with a delay of 1; they recover after repeated stalls | `lockstep.test.ts` |
| the same | the same, same commit | `tests/stubs.rs`, lines 173 to 191 | port | the stub game those tests step | `stubProgram` and `stubDoc` in `../549/fixtures.ts` |

The page's own words for the row: the lockstep tests "check that a peer doesn't advance without the remote input,
advances with an input delay once both inputs arrive, and recovers after repeated stalls: our window 0. The waiting
notice, the timeout and net.rollback's planted early step are ours."

License: MIT OR Apache-2.0, as the oracle repo's pins record it. No upstream code is copied or run: each case is
re-expressed as our document and our `match` call, the receiving file names its upstream files, commit and license, and
the expected numbers (20 frames, state 40) are upstream's. Nothing is copied, so no notice is carried.

## Re-expressed

- **The stub game** (`stubProgram`). Upstream's game keeps a frame count and a state: each frame the state gains 2 when
  the two players' inputs sum to an even number and loses 1 otherwise, and the frame count gains 1. Both players give
  input i on iteration i, so 20 frames leave state 40. Ours: the logic item `game` (20 Hz) reading the slider `inp`
  (0 to 255), with the arrays `frame` and `state` (an i32 each), its program written as WebAssembly bytes in test code.
  A step with no entry sums to 0, which is even. The piece's net item `match`: 2 players, 20 Hz, window 0, upstream's
  input delay as `delay`, a full-state hash at every step, and a 60 s timeout, so a 10 s hold stalls the match and
  doesn't end it.
- **The inputs.** Each player's script is `{step: i, control: "inp", value: i}` for i from 0. With an input delay d an
  entry lands d steps later, so only the 20 − d iterations that land inside the 20 frames are made.
- **"The remote's input hasn't arrived"** is the test relay holding player 2's messages from match time 0 (`relay.hold`).
  **"An attempt to advance"** is one step time of the match clock, 0.05 s. Both copies are run by `match` in one process
  over the test relay on its own clock, so no time here is this machine's.
- **A peer doesn't advance without the remote's input** (test 1). Upstream: one attempt with no input delay, and 200
  attempts with a delay of 3. Ours, for delays 0 and 3: player 2 silent for 200 step times (10 s). Copy 1's first wait
  is at step 0, for player 2, from the start (by 0.05 s) until the messages arrive at 10 s (by 10.1 s). Three
  render-backs of copy 1, at 0.05 s, 5 s and 9.95 s, each show step −1: the game is still before its first step. Where a
  copy reports its step times, step 0 ran no earlier than 10 s. Once the input arrives both copies advance all 20
  frames to frame 20 and state 40, with no rollback.
- **Two peers advance** (test 2). With no latency and no delay, and with an input delay of 1: both copies run 20 frames
  to frame 20 and state 40, with no rollback. **Repeated stalls**: upstream's peers spin 12 attempts (its delay of 2
  plus 10) with nothing crossing, then both advance. Ours: delay 2, player 2's messages held for 12 step times (0.6 s);
  copy 1's first wait is at step 0 for player 2 and ends no earlier than 0.6 s, and then both copies reach frame 20 and
  state 40.

## Left out, and why

- **The bounded wait helper's test.** `lockstep.test.ts` leaves it out as "that library's own call": it checks a call
  of that library, and no rule of ours.
- **Everything of that library outside its lockstep tests**: its tests of prediction, rollback and desync detection.
  The page links only the lockstep tests to #549. Rollback is #551's and locating a desync #550's.
- **The waiting notice, the timeout and net.rollback's planted early step.** The page calls them ours; they are tested
  in `tests/acceptance/549/` (ac5-waiting-notice.test.ts, ac4-lockstep-300.test.ts).
- **A real network between the peers.** Our check kinds run copies in one process over a test relay with no network
  (Check input: net kinds), and so does this lane. The live path, through the shipped relay, is criteria 2 to 4's.

## Run

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 node scripts/throttle.mjs build --wait 120 -- scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/549-oracle lockstep.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/549-oracle/tsconfig.json   # type check
rm -rf tests/acceptance/549-oracle/node_modules                                      # vitest's cache after a --root run
```

`helpers.ts` re-exports the #549 suite's helpers and fixtures (`../549/`, read only), so both lanes build and ask the
same binary the same way: `cargo build --locked --bin deep-show --no-default-features --features full`, once, in
`beforeAll`, copied to a temporary folder. The lane starts no relay, certificate, door or browser: both copies run
inside one `deep-show run`. Each `it` passes its own 5,400,000 ms timeout. Without cargo a test is `BLOCKED:`; a
`deep-show run` that doesn't finish in 40 minutes is `INCONCLUSIVE:` when the 1-minute load is above the cores, and a
plain failure otherwise. Neither is a pass.

**`scripts/lanes.mjs` needs `'tests/acceptance/549-oracle/'` in its `alone` list.** The #549 README gives the line, and
the implementer makes that edit.

## The surface under test

The #549 suite's (its README: The surface under test), with nothing added:

- `deep show` of the stub game's document, and the scenario as that suite writes it;
- `match` with `plays`, `relay: {seed: 549, hold: [{player: 2, at: 0, for}]}` and `render_back: [{player: 1, t}]`;
- each copy's `player`, `ran`, `rollbacks`, `waits` (`step`, `player`, `from`, `to`), `ran_at` where it is given, and
  the last row of `steps` with its arrays `game.frame` and `game.state`;
- each render's `step`, which is −1 for a copy that has run no step.

## Criteria to tests

| ID | Test (in `lockstep.test.ts`) | Upstream | Ours |
|---|---|---|---|
| `#549.a6b30a32`, `#549.6bf6ea62` | a copy doesn't advance without the remote's input, with no input delay and with a delay of 3 | no advance without the remote's input: one attempt with no delay, 200 with a delay of 3 | two matches, player 2 held 10 s: copy 1 waits at step 0 for player 2 until 10 s, three render-backs at step −1, then 20 frames to state 40 |
| `#549.a6b30a32`, `#549.6bf6ea62` | two copies advance 20 frames with no delay and with a delay of 1, and recover after repeated stalls | 20 frames with no delay and with a delay of 1; 12 stalled attempts with a delay of 2, then both advance | three matches: delays 0 and 1 unheld, delay 2 held 0.6 s; each to frame 20, state 40, no rollback |

Test count: 2. Wrong programs each fails on: the merge base (below); a copy that runs a step before it holds player
2's message (it shows a step during the hold, or runs step 0 early); a copy that drops or misplaces an entry (another
state than 40); a copy that rolls back in lockstep.

## At the base

Both tests fail at the base `06e231702`, at an assertion, and neither is a guard. From this job's run of the lane
there on 2026-11-17 (`tests/acceptance/549/BASE-FAILURE.txt` has the machine line and the commands; this lane's part of
the log reads `lockstep.test.ts (2 tests | 2 failed) 3160ms`):

- "a copy doesn't advance without the remote's input, with no input delay and with a delay of 3":

  ```
  AssertionError: the oracle: no remote input, delay 0: the stub game is presented: [{"check":"document.validate","code":"unknown_field","severity":"error","ids":["match"],"path":"items/match/params/hash_every","actual":1,"what":"net@1.0 does not define `hash_every`","fix":"Remove the field, or require the kind's minor that defines it."},{"check":"document.validate","code":"unknown_field","severity":"error","ids":["mat
  Expected: "presented"
  Received: "refused"
  ```

  at `presented` (`../549/helpers.ts:334`), from `play` (`lockstep.test.ts:46`, called at line 68).
- "two copies advance 20 frames with no delay and with a delay of 1, and recover after repeated stalls":

  ```
  AssertionError: the oracle: zero latency, zero delay: the stub game is presented: [{"check":"document.validate","code":"unknown_field","severity":"error","ids":["match"],"path":"items/match/params/hash_every","actual":1,"what":"net@1.0 does not define `hash_every`","fix":"Remove the field, or require the kind's minor that defines it."},{"check":"document.validate","code":"unknown_field","severity":"error","ids":["mat
  Expected: "presented"
  Received: "refused"
  ```

  at `presented` (`../549/helpers.ts:334`), from `play` (`lockstep.test.ts:46`, called at line 89).

The base's `net@1` is #540's and defines neither `hash_every` nor `timeout` (crates/deep-show/src/net.rs), so the
document check refuses the stub game and no match is played: the upstream cases have no answer at the base to compare.
The log cuts each line where shown. The type check of this folder exits 0 at the base, and `vitest list` collects the 2
tests. A scratch run of `stubProgram` in Node's own WebAssembly, on the lane's inputs, gives frame 20 and state 40 for
input delays 0, 1, 2 and 3 (the #549 BASE-FAILURE.txt says how).
