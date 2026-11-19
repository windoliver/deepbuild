# Dispute: #1359 AC9's `help` anywhere, after #1812

**The first draft's test can't pass on #1812's work.** #1812's Scope says "`help` asks for help only as the first argument after the command. `-h` and `--help` stay as they are". Its fourth criterion says "`deep find help` searches for the word". Both read `help` as a help word only in `deep help`. #1812's Scope also says "An exit or a line an acceptance suite pins moves only through that suite's blind redraft".

`tests/acceptance/1359/help-acts-nothing.test.ts` (AC9, `#1359.f0bb482f`) holds `help` anywhere in the arguments as a help request. One run on the work (`05d624f27`, before main was merged in) fails 4 of its 10 cases. Under #1812 each of these is a first-run command's arguments: `deep status help` doesn't fit status's forms, and `help` is the option, folder or lesson in the other three. So each runs the first command's setup in a home nobody set up, which is #2200's ground:

```
AssertionError: deep status help wrote in a home nobody set up (exit 2, ...)
AssertionError: deep inbox answer a1 help wrote in a home nobody set up (exit 3, ...)
AssertionError: deep install help wrote in a home nobody set up (exit 2, ...)
AssertionError: deep memory keep help wrote in a home nobody set up (exit 3, ...)
```

The file's other cases (`-h` and `--help` anywhere, and every listed command with `--help`) pass on the work.

**The redraft.** A fresh run of the blind job wrote this folder (commit `72b217bf1`, cherry-picked as `71248932a`). It was given #1359, #1812, the frozen suite, #1812's blind suite, the design and the base `c0a9de979`, which holds no implementation of #1812. It never saw the work, the diff or this dispute. Its file replaces the frozen one whole. It keeps the first test and the six `-h`/`--help` cases unchanged. `deep status help` becomes status's usage and exit 2, in a home where setup finished. `deep inbox answer a1 help` becomes `--help` in the same place, and `deep help` holds the word in its one place. The table of every listed command reads prose lines as #1812's suite does (REDRAFT.md). At the base 1 of its 12 tests fails, at `deep status help`'s exit (`BASE-RESULTS.txt`).

On the work merged with main, at `71248932a`, one run passes all 12 tests: `Test Files 1 passed (1); Tests 12 passed (12)`.

## Your call, once

- **Swap in the redraft** (recommended): it runs in the first draft's place. `scripts/lanes.mjs` moves `tests/acceptance/1359/help-acts-nothing.test.ts` to `byHand`. The signed approval tag on that lanes commit is owed with it.
- **A third draft**: name the reading to change, and a blind job writes AC9 again on that ruling.

Until then both drafts stay in the lanes as their commits registered them, and neither draft was edited.
