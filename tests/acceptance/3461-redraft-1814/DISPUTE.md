# Dispute: #3461's table pins `deep session rules`, which #1814's Scope renames

**The first draft's `tests/acceptance/3461/table.test.ts` (`#3461.b4a5c8f4`) is BLOCKED on #1814's change for a reason outside its criterion.** It finds each form's usage line by the line's start, and one form is `{ line: 'deep session rules', ... }`. #1814's Scope says "`deep session rules` becomes `deep rules session`", so on the work `deep --help` lists no such line:

```
BLOCKED: deep --help shows no line "deep session rules…" for the form deep session rules session:<ulid> --json
```

On the merge base 9bbe0f24c the first draft passes (5 of 5 files). `tests/acceptance/3461/once.test.ts` is already redrafted (`3461-redraft-once/`), which passes on the work.

**The redraft.** A fresh run of the blind job wrote `tests/acceptance/3461-redraft-1814/`, given #3461, #1814's Scope, the design, the base 9bbe0f24c and the frozen suite. It never saw the work, the diff or this dispute (REDRAFT.md).

- On the base: passes, 88 rows (`BASE-RESULTS.txt`).
- On the work: one run, `Tests 1 passed (1)`.
- The frozen twins `first-wins-reader` and `last-wins-reader` fail it, 88 and 86 of 88 rows (REDRAFT.md).

## Your call, once

- **Swap in the redraft** (recommended): `scripts/lanes-lists.mjs` maps `tests/acceptance/3461/table.test.ts` to it and moves the first draft to `byHand`; the signed approval tag on that commit is owed with it.
- **A third draft**: name the reading to change, and a blind job writes the criterion's test again on that ruling.

Neither draft was edited.
