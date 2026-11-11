# Dispute: the first draft's films (criteria 1, 2, 3, 5, 6, 7 and 9, and the Oracle lane)

This redraft exists because of this dispute. The first draft is `tests/acceptance/154/` and `tests/acceptance/154-oracle/`, commit `7454b497c`.

## The films had no `requires`

The first draft presents every score in a film built by `helpers.ts` `film()`, and that envelope has no `requires`. On the first build, `score.music@1` was the motion module's kind. The base's document check refuses any module kind that its document's `requires.modules` doesn't name (`crates/deep-canvas/src/document/check.rs`: "kind `…` is the `…` module's, and `requires.modules` does not name it"). #499's first draft hit the same refusal for its probe item (`tests/acceptance/499/module/redraft/DISPUTE.md`). So each of these files failed on its own fixture before any score behaviour ran: rules, cache, fetch, onsets, stems, loop, budgets and 154-oracle.

This redraft's films have no `requires` either. Both drafts read the design the same way: a document uses a score without naming a module. So the work changed to fit them. `score.music@1` is now a core kind whose fields belong to the motion module (`module_param`, as `media.strip@1`'s do). A document needs only the module to be present, and the first draft's films are no longer refused.

## The harp test spreads a whole stem into `Math.max`

`stems.test.ts`, "a harp note added to keys changes no other note's noise", computes `Math.max(...Array.from(mono(s.alone), Math.abs))` (line 76). That spread throws `RangeError: Maximum call stack size exceeded` on a stem of about 300,000 samples. Both drafts hold that a stem starts at the film's time 0: the render's `note_on` sample is the plan's, which `onsets.test.ts` checks. The harp note sits at `3:2.5` on the song's tempo, so its stem is that long on any correct program. The test fails on its own code, never on the stem.

Criterion 1 runs from this redraft's `determinism.test.ts`. The first draft's `stems.test.ts` is kept by hand in `scripts/lanes.mjs`, as #2026's first-draft AC3 file is.

The criteria went to a fresh run of the blind job with the same inputs and the criteria. It never saw the work, the diff or this dispute (design: Dogfooding).
