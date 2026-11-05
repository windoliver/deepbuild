# Blind redraft of #412's AC14 tests

This folder replaces `moves.test.ts` in the original blind suite for #412 (`tests/acceptance/412/`). It was written by a
blind redraft job (AGENTS.md, Proof; design: Dogfooding) that read the issue, the design, base commit `960045da` and
the original suite, and never saw an implementation. `helpers.ts` and `fixtures/` beside this folder are the
original's, copied unchanged so `../helpers.ts` resolves.

## What was disputed

The original AC14 tests read the pop-in's expansion through deep_query at times written by `helpers.ts` `timeText`,
which always writes nine fraction digits of seconds (`0.000000000s`, `0.130999375s`), on a grid of 441 flicks
(1/1,600,000 s). At the base the time grammar refuses a seconds literal with more than five fraction digits
(`crates/deep-canvas/src/grammar/time.rs`, `MAX_SECONDS_DIGITS = 5`, with `1.123456s` and `0.000000001s` refused in
`crates/deep-canvas/src/grammar/tests.rs`), and deep_query parses `at` with that grammar (`crates/deep-show/src/main.rs`
`query_call`, `hub.rs` `flicks`). So every AC14 scenario is refused as `bad_input` before the criterion is judged.
Checked at the base: `deep-canvas parse time` gives `bad_time` for `0.130999375s` and `0.000000000s`, and a deep_query
with those times answers `{"ok":false,"code":"bad_input"}`, while the same query at `0s`, `0.13104s`, `0.5s` is
answered (BASE-FAILURE.txt).

## What changed, and why

Only how the test writes and samples times, and what follows from that:

- **Times** sit on the finest grid the grammar accepts, 0.00001 s (7,056 flicks), written as the shortest exact decimal
  (`0s`, `0.5s`, `0.13104s`), each of which the base parser accepts and prints back as itself.
- **The peak.** The spring's peak (π / (2π·4·√(1 − 0.3²)) ≈ 0.1310356 s) falls between grid times. The nearest grid
  sample is then up to 5 µs off it and, with this spring's curvature there, up to 2.3e-9 below the peak value, so
  comparing that one sample to the listed peak within 1e-9 would fail a correct program. The redraft reads the
  expansion at the three grid times around the listed peak and takes the expansion's peak as the vertex of the
  parabola through them; for this spring that vertex lands within 2.6e-10 s and 2.3e-13 of the true peak wherever
  the peak falls between grid times (computed in closed form across the whole grid step). The listed peak's time
  and value are each compared with that vertex within 1e-9.
- **Every other sample** (the three around the peak, and seven between start and end at span·i/8.5, as before) is
  compared within 1e-9 with the closed-form spring of the listed frequency and damping ratio at that sample's own grid
  time, as the original did at its grid times. Start (→ from) and end (→ to) are on the grid exactly (0 s, 0.5 s,
  0.8 s), so they are compared as before; nothing past the listed peak, and decay = 2π · frequency · damping ratio,
  are as before.
- The check (`sampleTimes`, `moveFailures`) lives in `moves-redraft.test.ts` rather than `helpers.ts`, which stays
  the original's; it reuses the original's `springFromRest`, `scaleMove`, `EPS`, builds, scenario and deep_query
  helpers.

Unchanged: the surface (features `test-cue` and `test-cue-span`, registry `test.cue.kind@1`, entry `pop_in`, kind
`test.cue.list@1`, the Move shape, `--planted moves_stored_text`, deep_query `paths`/`at`/`values`), the board, the
three tests and their names, and each criterion value: a scale from 0 to 1, a spring of 4 Hz and damping ratio 0.3,
spans 0.5 s and 0.8 s, tolerance 1e-9, decay = 2π·f·ζ. Each test has an explicit 1_800_000 ms timeout.

## Fails on a wrong program

Run offline against a simulated expansion (the closed-form spring, holding `to` from start + span, sampled at the
redraft's grid times converted through flicks): the right listing at span 0.5 s and at 0.8 s gives no failures; the
planted stored text (span 0.5 s listed, expansion at 0.8 s) fails with `pop_in: span: the listing ends at 0.5s with
1, the expansion holds 0.98466… there`; a peak value or peak time 2e-9 off fails naming `peak`; a frequency 1e-6 Hz off
fails at 7 samples; a decay 1e-8 off fails naming `decay`; no values, or a move with no numbers, fails. The tests
can't pass if every call returns nothing: `run` requires an accepted scenario with one reply per call, `popIn` one
listed scale move, and `expansion` a deep_query value per sample time.

## Run

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/412/redraft --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/412/redraft/tsconfig.json
```

At the base all three tests fail at "the binary builds" (the test features don't exist yet); BASE-FAILURE.txt is
that run.
