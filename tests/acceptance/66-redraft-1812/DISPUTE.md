# Dispute: #66's `deep fix` reads, after #1812

**The first draft's tests can't pass on #1812's work.** #1812's Scope says "A command a person runs prints a sentence, and JSON only with `--json`: `deep fix`, …". Its seventh criterion says "`deep fix` on a fixture issue prints one sentence naming what started, and with `--json` prints the object the merge base printed, byte for byte". Its Scope also says "An exit or a line an acceptance suite pins moves only through that suite's blind redraft".

`tests/acceptance/66/fix.test.ts`'s `fix()` parses the last line of plain `deep fix <id>` as `{"task","link"}`. One run on the work (`05d624f27`, before main was merged in) fails both of the file's tests there, AC1 (`#66.3e42b2ec`) and AC5 (`#66.3ddbb14e`), before the hub half asserts anything:

```
SyntaxError: Unexpected token 'S', "Started ta"... is not valid JSON
```

**The redraft.** A fresh run of the blind job wrote this folder (commit `a5ca38cb9`, cherry-picked as `cfaa7fb8d`). It was given #66, #1812, the frozen suite, #1812's blind suite, the design and the base `c0a9de979`, which holds no implementation of #1812. It never saw the work, the diff or this dispute. Its `fix.test.ts` runs `deep fix <id> --json` and reads the object as the first draft did. Only the command's arguments and the helper's two messages change, and no assertion is dropped. At the base both tests fail at that call's usage error (`BASE-RESULTS.txt`).

On the work merged with main, at `cfaa7fb8d`, one run passes both tests: `Test Files 1 passed (1); Tests 2 passed (2)`, in 29 s.

## Your call, once

- **Swap in the redraft** (recommended): it runs in the first draft's place. `scripts/lanes.mjs` moves `tests/acceptance/66/fix.test.ts` to `byHand`. The signed approval tag on that lanes commit is owed with it.
- **A third draft**: name the reading to change, and a blind job writes these tests again on that ruling.

Until then both drafts stay in the lanes as their commits registered them, and neither draft was edited.
