# Criterion 2 of #1546, blind redraft for #1458's way to write a time

Redrafted blind from issue #1546, issue #1458 (whose text amends #1546's criterion 2, approved by the owner),
`docs/technical-design.md`, AGENTS.md, the suite in `..` (its README and `helpers.ts`) and the code at the base
`2721ca7b`. No other branch, PR or session was read. `ac2-quiet-row.test.ts` here replaces `../ac2-quiet-row.test.ts`
once the owner swaps it in; the old file is left as it is. The fixture is `../fixtures/quiet.events.jsonl`, unchanged.

| | |
|---|---|
| Old test | `../ac2-quiet-row.test.ts`: the quiet session's sidebar row reads "last seen 1 min ago" at launch and "last seen 2/3/4 min ago" from 30 s, 90 s and 150 s of the replica's clock; its plant `no-age-timer` is named by "... last seen 1 min ago" where "... last seen 2 min ago" was due |
| New test | `ac2-quiet-row.test.ts` (this folder) |
| Amended criterion | #1546 AC2, "A fixture session going quiet, on the virtual clock with no input, updates its row by the next minute. A planted app with the timer removed fails, naming the row", read with #1458's "One way to write a time": "A length reads "40 s", "12 min", "3 h" or "2 d", with a space and no "ago": the slot's place says it's since", and its AC11, "A planted row reading "2 min ago" ... fails, naming the string" |
| Wrong program | The base `2721ca7b`, whose quiet row still reads "quiet · last seen N min ago" (`crates/deep-app/src/states.rs`, `State::text`). Also, as before: `no-age-timer` (the drawn row keeps "1 min"), a timer that fires once (3 and 4 min), an age read early (the readings 2 frames before each minute) |
| Run | see below |

## What changed, and what didn't

Only the words the row must read. The judge now wants `last seen N min` with "min" a whole word and no "ago" anywhere in
the row, and names the row's string, adding `with no "ago"` when that is what it got wrong. The planted test's
expectations read "last seen 1 min" for the drawn row and "last seen 2 min" for the forced one, and neither may say "ago".

Unchanged from `../ac2-quiet-row.test.ts`: the six readings (2 frames before and after the 2nd, 3rd and 4th minute), that
the clock step past each minute draws a frame by itself, that no step's forced frame differs from the last drawn one, the
still frame after the last minute drawing nothing, the claim PASS, and for `DEEP_HUB_PLANT=no-age-timer` the judge
failing first at the 2 min reading, the claim FAIL, and a finding at the clock step that crossed 2 min, in the sidebar,
naming the same row in both frames.

## Run

```sh
npm ci && npm run build --workspaces             # once
npx tsc -p tests/acceptance/1546/tsconfig.json  # its include covers this folder
npx vitest run --root tests/acceptance/1546 --no-file-parallelism --testTimeout=600000 redraft-1458
```

`cargo` must be on `PATH`; the test builds `deep-drive` with `--features env-plants` (`../helpers.ts`, #124's
`buildDrive`). macOS only, as `..`'s suite.

## On the base

`BASE-FAILURE.txt`: both tests fail at a named assertion, because the base writes "ago". The first fails at "the drawn
row reads "last seen N min", with no "ago", at each minute", listing all six readings; the planted one fails at "naming
the quiet session's row, at the first minute it missed", whose first problem is the 1 min reading's "ago".

## Ambiguities

1. **What may follow "min".** #1458 fixes the length's form, not the rest of the row. The test asks for
   `last seen N min` with "min" a whole word and "ago" nowhere in the row; anything else after it (a separator and more
   text) is allowed.
2. **"last seen"** stays, as the old test and `../helpers.ts`'s `quietRow` find the row by it. #1458 says the slot's
   place says it's since; it doesn't name the row's other words, so a program that drops "last seen" would fail here
   and in `quietRow`, and that is a dispute, not an edit.
3. **The planted test on the base** fails at the judge's first problem (the 1 min reading's "ago") rather than at a
   missed minute, since at the base the plant's row and the app's row both say "ago" from the start.
