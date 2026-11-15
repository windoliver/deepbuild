# #142: two first-draft files disputed, and their blind redraft

The first draft of this suite (`tests(#142): blind acceptance suite for film recipes`) holds two files that can't
pass on any program, because their fixtures show number words the base already refuses. Under Dogfooding, each went
to a fresh run of the same job with the same inputs and the criterion, never the work, the diff or this dispute, told
the base fact below. The redraft's tests pass on the work, so the dispute came to the owner once. Nothing in either
draft was edited.

| Criterion | First draft (disputed) | Blind redraft | Why the first draft can't pass |
|---|---|---|---|
| AC9 `#142.30bc3e5b` | `142/ac9-timing.test.ts` (2 tests) | `142-redraft-ac9/timing.test.ts` (2 tests, pass) | Its cue words are ONE, TWO, FOUR, FIVE and SIX. The base's Honest numbers check refuses any displayed text showing a number word (`number_unsourced`, an error) unless the document marks it a name or turns number words off, so neither film is presented. |
| AC10 `#142.d708e2b3` | `142/ac10-pack.test.ts` (1 test) | `142-redraft-ac10/pack.test.ts` (1 test, pass) | Its slides say ONE and TWO: the pack kit checks the clean example and the twin as documents, both refused with `number_unsourced`, so acme/acme is refused at install. |

## The failing output on the work

```
ac9-timing.test.ts: the later cues follow cue_three, and the `at` cue stays:
  the films are not both presented with no error: [{"outcome":"refused","issues":[{"code":"number_unsourced","severity":"error","ids":["film.word.0"],"path":"items/film.word.0/params/text","actual":"ONE",...}]}]
ac9-timing.test.ts (planted): the original film: the reply's expansions hold a row for film; instances: []
ac10-pack.test.ts: acme/acme@1.0.0 installs: {"outcome":"refused","issues":[{"path":"kinds/acme.slides@1","actual":{"issues":[{"code":"number_unsourced",...}]}}]}
```

On the work, the first draft's other files pass 10 of 10 tests (AC6 and AC12 aside: AC6 reads INCONCLUSIVE off a
quiet reference Mac, and AC12 passes with the recorded call). The redraft's two folders pass 3 of 3.

## The ruling

The owner, in the session (Nov 15, 2026): "Swap; looks right". The redraft proves AC9 and AC10; the first draft's two
files are kept by hand (`scripts/lanes.mjs`).
