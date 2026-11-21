# Dispute: #280 AC4's first draft holds the rollbacks a copy makes after its last step to a depth of 3

This redraft exists because of this dispute. The first draft is `tests/acceptance/280/ac4-depth.test.ts`, its first test
(the planted test passes).

## What fails

#280's AC4 reads: "With a fixed 80 ms one-way latency, no jitter, delay 2 at 60 Hz and every player's input changing
every step, each rollback's depth is within one step of ⌊(80 ms − 2 step lengths) ÷ the step length⌋ + 1 = 3". The
first draft holds every entry of each copy's `rolled_back` to that.

#551, already in the first draft's base (`e575a47af`), stops a copy at the match's `steps` limit (`stopped()`) but keeps
it until every step it ran is settled (`done()` waits for `roll.settled >= next`), still taking late messages and rolling
back at its tick. A rollback re-runs from its step through the last step the copy ran. After a copy has run the last
step N − 1, the messages for steps N − 2 and N − 1 arrive (each reaches a copy once it has run 2 steps past it) and can
only re-run 2 steps and 1 step. On a 60-step match, each copy's last three `rolled_back` entries are `57..59` (3),
`58..59` (2) and `59..59` (1). In the 1,200-step run each copy has 1,197 rollbacks of 3, one of 2 and one of 1, and the
first draft fails on the one of 1. Run once on #280's work merged with main (Nov 21, 2026, load ~17):

```
× AC4 #280.3cddbab4 with a fixed 80 ms one-way latency, no jitter, delay 2 at 60 Hz and every player's input changing
  every step, each rollback's depth is within one step of 3 1156839ms
AssertionError: every rollback is 3 steps deep within one step:
  AC4: copy 1 rolled back 1 times to a depth other than 3 within one step, the first 1
  … (the same line for copies 2 to 8)
✓ (the planted test, net_feel_depth_from_arrival)
```

Changing the program so that a copy past its last step rolls back once when it holds every message would make the end
one rollback of 2. It would also change the rollbacks and re-run steps #277's AC4 counts against its merge base's for
the same match, so it isn't done here.

## How the redraft was made

AC4 went back to the same blind job, in its own worktree at the first draft's commit (`79328e15c`, base `e575a47af`, no
implementation). It was given the base fact above, the probe's last three entries and the failing message. It read no
implementation. It keeps the first draft's surfaces (`match` with `check: "net.feel"`, the eight-seat fixture, 1,200
steps, `rolled_back`, net.feel's `depth {p50, p99}`, the planted `net_feel_depth_from_arrival`) and holds:

- every rollback before the copy's last step to 3 within one step, as the first draft did;
- every rollback from the last step to 1 to 4 deep (its README says why);
- no rollback from past the last step;
- net.feel's p50 and p99 to 3 within one step, and the planted meter to 0, failing naming a copy.

It fails at the base at an assertion (`BASE-FAILURE.txt`). On #280's work merged with main, both tests pass:

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  10:29:32
   Duration  2210.90s (tests 100%)
```

Run once on the head with main `213e8cdce` merged (Nov 21, 2026, 1-minute load 68 falling to 11).

## The swap

`scripts/lanes.mjs` runs this redraft in place of the first draft's `ac4-depth.test.ts`, which is kept as written and
runs by hand only. The owner rules on the swap.
