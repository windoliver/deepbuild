# Blind redraft of #280's criterion 4: rollback depth at a fixed 80 ms, and the rollbacks after a copy's last step

A redraft of `tests/acceptance/280/ac4-depth.test.ts`, written blind by the job that wrote the first draft. It was
written from issue #280's criterion 4, the design sections the first draft read, the base `e575a47af`, and a base fact
the coordinator passed on (below). No other worktree, branch, pull request, stash or plan was read. The implementing
agent doesn't edit these files (AGENTS.md, Proof). The lanes swap is the coordinator's: this folder replaces the first
draft's file, and nothing under `tests/acceptance/280/` changes.

Criterion 4, `#280.3cddbab4`: "With a fixed 80 ms one-way latency, no jitter, delay 2 at 60 Hz and every player's input
changing every step, each rollback's depth is within one step of ⌊(80 ms − 2 step lengths) ÷ the step length⌋ + 1 = 3;
a planted meter that counts depth from the step the late message arrived on reads 0 and fails, naming the copy".

## Why a redraft

The first draft held every rollback in each copy's `rolled_back` to within one step of 3. A run of it on the change
merged with main failed only there: each of the eight copies had one rollback 1 deep. Its planted test passed.

The base fact, from #551 and already in the base (`crates/deep-net/src/copy.rs` and `copy/rollback.rs`): a copy stops
stepping at the match's `steps` limit (`stopped()`), but it isn't done until every step it ran is settled (`done()` waits
for `roll.settled >= next`). Until then it still takes late messages and rolls back at its tick (`rewind()` runs whether
or not the copy has stopped). A rollback re-runs from its `to` up to the last step the copy ran (`rewind` steps forward
to `next`). After the copy has run the match's last step N − 1, a late message for step N − 2 or N − 1 can only re-run
from that step through N − 1.

At 80 ms, delay 2 and 60 Hz, the message for step k reaches a copy once it has run step k + 2. So the copy's last three
rollbacks are `N−3..N−1` (3 deep), `N−2..N−1` (2) and `N−1..N−1` (1). The coordinator's 60-step probe showed
`57..59(3) 58..59(2) 59..59(1)` as each copy's last three. The 1,200-step run gave each copy 1,197 rollbacks of 3, one
of 2 and one of 1.

The criterion's formula is the depth the latency sets: the steps a copy has run past a message's step when that message
reaches it. A rollback after the copy has run its last step is cut short by the end of the match, not set by the
latency. Holding it to within one step of 3 fails an honest copy. Raising the match's steps doesn't help, because the end
always comes.

## What the redraft holds

Same surfaces as the first draft: `match` with `check: "net.feel"` and `feel` (README of `280/`), the eight-seat fixture
from `../280/fixtures.ts`, 1,200 steps, every player's entry flipping its mover at every step (`everyStep`), the profile
`FIXED_80` (80 ms one-way, no jitter, no spikes), each copy's `rolled_back` (#551's), net.feel's `depth {p50, p99}`, and
the planted `net_feel_depth_from_arrival`.

- **Every rollback a copy made before it ran the match's last step** (`from` below 1,199) is 3 deep within one step
  (`from − to + 1`, #551's depth). There are at least 600 such rollbacks a copy, since every message brings an entry.
  The first draft's assertion is unchanged for these.
- **Every rollback from the last step** (`from` 1,199, made as the copy settles) is at least 1 and at most 4 deep. It
  is never deeper than the latency allows plus one step, but it may be shallower, as the end of the match cuts it short.
  This holds the full-depth one from the last step (`1,196..1,199`, 3) and the two cut short (2 and 1).
- **No rollback is from past the last step.**
- **net.feel's readings**: every copy's `depth.p50` and `depth.p99` are within one step of 3 (the criterion's judge,
  unchanged). With about 1,199 rollbacks a copy, of which two are cut short, both percentiles read 3.
- **The planted meter**: every copy reads depth 0 at p50 and p99, and the same judge fails it, naming a copy
  (unchanged).

## What it leaves out

- The depth of a rollback from the last step isn't held to the latency's value. Only the bounds above apply (1 to 4).
  A wrong program that cut ordinary rollbacks short would still fail on the rollbacks before the last step.
- How many rollbacks come from the last step isn't counted. At 80 ms it is three a copy, but the test doesn't read that
  number from the design.
- As in the first draft: the time a rollback takes, and depth under jitter or spikes (criteria 3 and 6 cover those
  profiles).

## Run it

As the first draft's suite runs (README of `280/`), one file, under the machine's lease:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/280-redraft-ac4 ac4-depth.test.ts --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/280-redraft-ac4/tsconfig.json   # type check
```

It builds `deep-show` (`full`) in `beforeAll` (#549's `useBuilds`) and plays `match` with net.feel twice, 1,200 steps of
eight copies each. Imports: `../280/fixtures.ts`, `../280/helpers.ts` and `../551/helpers.ts` (read only).

| Test | ID | Asserts | Plant |
|---|---|---|---|
| `AC4 #280.3cddbab4 with a fixed 80 ms one-way latency, no jitter, delay 2 at 60 Hz and every player's input changing every step, each rollback a copy makes before its last step is within one step of 3, those from its last step no deeper, and net.feel reads depth 3 within one step` | `#280.3cddbab4` | the bullets above | none |
| `AC4 #280.3cddbab4 a planted meter that counts depth from the step the late message arrived on reads 0 and fails, naming the copy` | `#280.3cddbab4` | every copy reads depth 0; the judge fails naming a copy | `net_feel_depth_from_arrival` |

At the base both tests fail at an assertion, net.feel not being a check kind there and the planted name refused
(`BASE-FAILURE.txt`).
