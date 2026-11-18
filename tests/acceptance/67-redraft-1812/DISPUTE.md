# Dispute: #67's `deep workspace` reads, after #1812

**The first draft's tests can't pass on #1812's work.** #1812's Scope says "A command a person runs prints a sentence, and JSON only with `--json`: `deep fix`, `deep workspace`, `deep rules` and `deep numbers refresh`". It also says "An exit or a line an acceptance suite pins moves only through that suite's blind redraft". `tests/acceptance/67/hub.ts`'s `workspace()` needs plain `deep workspace` to print one line of JSON.

One run on the work (`05d624f27`, before main was merged in) fails there. Of `diff`, `drift`, `landing`, `loop`, `revert` and `targets`, 5 tests fail and 13 are skipped when their `beforeAll` fails:

```
Error: `deep workspace new Web fleet` must print one line of JSON: exit 0 after 167 ms, stdout "Made the workspace Web fleet as Webfleet85e5684d, in <tmp>/h/.deepbuild/workspaces/webfleet-a90906ed.\n", stderr ""
Error: `deep workspace move Monthlyclientreportb1ceedbc <tmp>/clients/acme` must print one line of JSON: exit 0 after 62 ms, stdout "Moved Monthlyclientreportb1ceedbc to <tmp>/clients/acme.\n", stderr ""
```

`budgets.test.ts` reads only the exit and the time, and passes as it is.

**The redraft.** A fresh run of the blind job wrote this folder (commit `cacae59d4`, cherry-picked as `da933fc3b`). It was given #67, #1812, the frozen suite, #1812's blind suite, the design and the base `c0a9de979`, which holds no implementation of #1812. It never saw the work, the diff or this dispute. `hub.ts` here reads each object through `--json`, and the six test files are the originals with "(redraft 1812)" added to each name. No assertion changed. At the base its 5 tests fail and 13 are skipped at the `--json` call (`BASE-RESULTS.txt`).

On the work merged with main, at `da933fc3b`, one run passes all 18 tests: `Test Files 6 passed (6); Tests 18 passed (18)`, in 117 s.

## Your call, once

- **Swap in the redraft** (recommended): it runs in the first draft's place. `scripts/lanes.mjs` moves `tests/acceptance/67/{diff,drift,landing,loop,revert,targets}.test.ts` to `byHand`, and this folder stays `alone`. The signed approval tag on that lanes commit is owed with it.
- **A third draft**: name the reading to change, and a blind job writes these tests again on that ruling.

Until then both drafts stay in the lanes as their commits registered them, and neither draft was edited.
