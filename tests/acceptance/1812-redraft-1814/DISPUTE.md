# Dispute: #1812's hub-down and not-set-up tables block on any command they don't name

**The first drafts `tests/acceptance/1812/hub-down.test.ts` (`#1812.e264e123`) and `not-set-up.test.ts` (`#1812.5a83f2e0`) are BLOCKED on the merge base and on #1814's change, for reasons outside their criteria.** Each table BLOCKS when `deep --help` lists a command it neither runs nor leaves out by name.

- On the merge base 9bbe0f24c: `BLOCKED: deep --help lists deep host add, which this table neither runs nor leaves out by name` (a command added after the first draft).
- On #1814's work: `BLOCKED: deep --help lists deep rules session, deep host add, ...`, since #1814's Scope renames `deep session rules` to `deep rules session`.

**The redraft.** A fresh run of the blind job wrote `tests/acceptance/1812-redraft-1814/`, given #1812, #1814's Scope, the design, the base 9bbe0f24c and the frozen suite. It never saw the work, the diff or this dispute (REDRAFT.md). It adds `host add` and `rules session` as rows of the tables, by the criterion's words, keeping the old `session rules` form.

- On the base: both pass, 57 and 41 rows (`BASE-RESULTS.txt`).
- On the work: one run, `Tests 2 passed (2)`.
- Its twins `inbox-raw-socket-error`, `raw-socket-error` and `hub-start-fix` fail it (REDRAFT.md).

## Your call, once

- **Swap in the redraft** (recommended): `scripts/lanes-lists.mjs` maps both files to it and moves the first drafts to `byHand`; the signed approval tag on that commit is owed with it.
- **A third draft**: name the reading to change, and a blind job writes these tests again on that ruling.

Neither draft was edited.
