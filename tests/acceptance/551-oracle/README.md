# Acceptance tests for #551, Oracle lane: the upstream rollback, resimulation and snapshot tests, run against our copies

Written first, blind, from four sources:

- issue #551 (live: `gh issue view 551 --repo windoliver/deepbuild`), whose Oracle line reads: "upstream tests, pinned
  by commit, for 4 of 11 criteria … A linked test counts only when run against our output (#136). Without a runner the
  lane is BLOCKED with one unblock ask";
- its Oracle page, `doneright/oracles/issues/551.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the upstream files that page pins, at the commits it pins (its vendor copies under `doneright/oracles/vendor/`);
- the #551 suite's surface (`tests/acceptance/551/README.md`, written by the same job) and the base commit `2bfb67db1`
  ("Merge #550's branch … as #551's base").

The job never saw an implementation of #551, and no other worktree, branch or pull request was read. #136's rule
applies: each case here is our document and our `match` call (or our live match), and asserts on what our copies
report. We have the runners (the test relay behind `match`; the app and the web player through the shipped relay, as
#549's suite runs them), so the lane isn't BLOCKED for want of one; where Chrome or WebGPU can't run, the portability
case is BLOCKED by #549's helpers, never a pass. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

The page links upstream tests to criteria 1, 2, 4 and 11; its "No upstream test" table gives criteria 3 and 5 to 10
none, and they stay with `tests/acceptance/551/`.

## Sources

| Criteria | Upstream, pinned | File and tests | Use | What it checks | Here |
|---|---|---|---|---|---|
| 1 `#551.6a2c4947` | the upstream physics engine, `3406750a38286a0d3c7d0f4be2f9d53153e81d90` | `tests/snapshot_roundtrip.rs` (its 3D crate) | port | a world restored from its snapshot and stepped on gives the snapshot of the run that never stopped at every later step | `rollback.test.ts`, first test |
| 1 | the same, same commit | `tests/snapshot_portability.rs` (its 3D crate) | port | one world's snapshot digest holds to one golden natively and on wasm32 | second test |
| 1 | an engine's physics solver, `396c9f059903aed5fec78ecd3d437a40c6415368` | its headless physics tests' rewind file: `RewindTest_ResimInSync`, `RewindTest_ResimDesyncAfterChangingMass` | port | a rewound solver resimulates: with the same inputs every resimulated step stays in sync; a change during the resimulation desyncs it from that step on, and the desync names the one particle that differs | first test |
| 1, 2 | the upstream rollback library, `d8e2cf1e16abe5c761ee6b01bab2888084c5e74c` | `src/input_queue.rs`: its unit tests (`test_delayed_inputs`, `test_prediction_repeats_last_input`, `test_first_incorrect_frame_tracked_on_mismatch`, `test_confirmed_input_returns_correct_value`) | formula | an input with a delay of 2 lands two frames later; a missing frame is predicted as the player's last input; a confirmed input that differs from the prediction sets the first incorrect frame; confirmed inputs read back by frame | third test |
| 1, 4 | the same, same commit | `tests/test_synctest_session.rs` (`test_advance_frame_with_rollbacks`, `test_state_is_deterministic`, `test_advance_frames_with_random_checksums`), `src/sync_layer.rs` | port; formula | with a check distance of 2 every frame loads an earlier one and resimulates; a deterministic game passes; two sessions with the same inputs agree; a game whose checksum doesn't survive a load fails with a mismatched checksum | fourth test |
| 11 `#551.b7783405` | the same, same commit | `src/sync_layer.rs`, lines 342 to 353 (`check_simulation_consistency`) and 610 to 622 (`test_check_simulation_consistency_finds_mismatch`) | formula | a rollback loads the earliest first incorrect frame over every player's input queue; by it, entries for steps 640 and 636 roll back to 636 | fifth test |

Licenses as the oracle repo's pins record them. No upstream code is copied or run: each case is re-expressed as our
document and our calls, and the receiving file names its upstream files, tests and commits. Nothing is copied, so no
notice is carried.

## Re-expressed

All on the #551 suite's paddle piece (`../551/fixtures.ts`: the world `court` with a ball and two paddles, the logic
item `rules` in a 4 MiB memory, net at 60 Hz, delay 2, window 8).

- **The snapshot round-trip and the in-sync resimulation** (first test). Upstream steps a world, snapshots it, restores
  the snapshot and steps both on, comparing every later step; a rewound solver resimulates with the same inputs. Ours:
  600 match steps of the honest rally, once with every message on time and once with each frame held back a seeded
  whole number of match steps up to 8, so each copy restores its checkpoints and steps again many times. **Expected,
  upstream's rule**: each copy rolls back, and its full-state hash equals the run that never stopped at every
  confirmed step.
- **A change during the resimulation** (first test). Upstream changes a force or a mass during the resimulation and the
  run desyncs from that step on, naming the one particle. Ours: #550's `plant`, 1 added to `rules.tally` each time copy
  2 runs step 310, its re-runs included, in the held-back match with a hash every 60 steps. **Expected**: net.desync on
  both copies names step 310 and the one field, the tally, and no copy hashes past the next interval.
- **Portability** (second test). Upstream holds the snapshot's digest to one golden natively and on wasm32. Ours: one
  live match of 300 steps between the app's copy (native) and the web player's copy in headless Chrome (wasm32),
  through the shipped relay behind #549's door with no hold, a hash every step. **Expected**: the two copies' full-state
  hashes are equal at every confirmed step.
- **The input queue** (third test, formula). Upstream's queue takes input i at frame i, delay 2. Ours: player 1 moves
  its paddle to i / 2 at each step i under 10; player 2 moves its paddle once, at step 40 (stamped 42), and `deliver`
  holds that message from copy 1 until it has run step 45. **Expected**: each record holds every entry 2 steps after it
  was made and nothing else (a prediction adds no entry), and copy 1's rollbacks after step 45 restore step 42, the
  first incorrect step.
- **The sync-test session** (fourth test). Upstream: both players give input i at frame i, a check distance of 2, 200
  frames. Ours: each player's paddle at (i mod 7) − 3 at every step i, no input delay, every message held back exactly
  2 steps, 200 steps: every received message brings a late entry. **Expected**: net.rollback passes; each copy rolls
  back at least 180 times; its hashes equal the on-time run's at every confirmed step, and a second run's. A game
  whose checksum doesn't survive a load: the #551 suite's planted ring that misses the page `memory.fill` writes;
  **expected**: net.rollback fails, naming the first step its copies part from the on-time run.
- **The earliest first incorrect frame** (fifth test, formula). Upstream's rule over every player's queue. Ours: the
  three-player paddle piece, player 2's entry for step 640 and player 3's for step 636 both held from copy 1 until it
  has run step 643. **Expected**: copy 1's rollbacks after step 643 go back to step 636.

## Left out, and why

- **The rest of those files**: queue bookkeeping (`test_add_input_wrong_frame`, `test_add_input_twice`, the discard and
  delay-change cases), spectators, sessions' builders, sparse saving, single-player sessions, and the other rewind
  cases. The page links only the rules above to #551.
- **The snapshot's bytes.** Upstream compares serialized bytes; ours compares full-state hashes, which take each float
  by its bits in canonical order (Checkpoint ring) and are what the copies exchange.
- **The relay, Join, the net checks' reports and the budgets**: the page calls them ours; criteria 3 and 5 to 10 test
  them in `tests/acceptance/551/`.

## Run

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/551-oracle rollback.test.ts --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/551-oracle/tsconfig.json   # type check
rm -rf tests/acceptance/551-oracle/node_modules                                      # vitest's cache after a --root run
```

It builds `deep-show` (`full`) and `deep-relay`, makes a certificate, and starts the relay, the door, the bundle's
server and headless Chrome for the second test, stopping each by its PID after it. Its run at the base is in
`../551/BASE-FAILURE.txt`.
