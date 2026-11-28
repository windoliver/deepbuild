# #723 blind redraft, after #1894: the record reads a transcript through the readers it is given

#723's suite opens its own record over a real evidence store (`tests/acceptance/723/helpers.ts`, `openWorld`), archives each
session's transcript in Claude Code's JSONL, and cites one message of it (`session:<id>#m1`) as the evidence of every learned
change and guard rule it appends. #1894 moves each agent's transcript reader out of the record and into its adapter: "an
adapter owns its transcript reader; the record takes turns in one shape and names no agent". `openRecord` takes
`readers`, `@deepbuild/adapters` exports the shipped agents' as `transcriptReaders`, and a record opened with no readers
reads no turn from any archived transcript: a quote at a `session:<id>#<message>` handle is "not at its handle". No
criterion, expected value, fixture or plant of #723 is touched: only the readers the suite's own record is opened with.

Written from issue #1894, the design it links, `tests/acceptance/723/` and base `e87cefc44`. It never saw an
implementation of #1894, and it was not run here (the base checkout has no `node_modules`).

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `723/load.test.ts` › AC4 (its one test) | #723 AC4 | `openWorld` opens the record with no readers, so the day-1 quote at `session:<S1>#m1` is not at its handle: the three specs you apply are refused, and the test stops at "AC4 a step spec you applied on day 1: state … expected 'refused' to be 'applied'" |
| `723/loosening.test.ts` › AC1, AC3 | #723 AC1, AC3 | the same record: the journeys step spec you apply first cites `session:<id>#m1`, is refused, and each test stops at "the journeys step spec you applied for the repo" |
| `723/loosening.test.ts` › AC2, AC5 | #723 AC2, AC5 | the same record: every change cites `session:<id>#m1`, so none can be held for its clause or applied; the test stops at its first `expectHeld`, or at the latest at the control it expects applied |
| `723/proof.test.ts` › Proof (its one test) | #723 Proof | the same record: the three baseline changes you apply cite `session:<S0>#m1`, are refused, and the test stops at "your step:shop-journeys" |

The tests of #723 carry no `#723.<hash>` tag in their names (they are named `AC1` … `AC5` and `Proof`), so the redraft
carries none; each name is the original's, to the letter.

What changed, and nothing else:

| | In #723's suite | In the redraft |
|---|---|---|
| `openWorld` (`helpers.ts`) | `openRecord({ path, now, evidence })` | the same world, with `readers: transcriptReaders` from `@deepbuild/adapters`. The adapters module is imported as a namespace and the export is asserted first ("@deepbuild/adapters exports transcriptReaders (#1894)"), so the base, which has no such export, fails each test at that assertion and not at link time. The option is spread in under a cast, so the folder type-checks at the base (no `readers` option) and after #1894 |
| `removeRoots` (`helpers.ts`) | removes the temp folders `openWorld` made | the same, for the redraft's `openWorld`: the original keeps its list of folders private, so the two functions are copied together |
| The rest of `helpers.ts` | | #723's, by `export * from '../723/helpers.ts'`: the clock, ULIDs, connections, `startSession`, `apply`, `addGuard`, `verdict`, the reads and the table comparison all take the world they are given |
| `load.test.ts`, `loosening.test.ts`, `proof.test.ts` | import `./helpers.ts` of `723/` | otherwise copied as they are, but for their comments (a new suite file starts the comment ratchet at zero), importing `./helpers.ts` of this folder |

Every test file of `tests/acceptance/723/` needs the redraft: all three open their record through `openWorld` and cite a
message of an archived transcript. Nothing in the suite reads a transcript another way: it starts no hub, runs no CLI
command and no benchmark script. `README.md` and `BASE-FAILURE.txt` are #723's own and stay where they are.

At the base (`e87cefc44`) `loadLearned` and the holds of #723 are already there, so the one reason each redrafted test
fails there is the missing `transcriptReaders` export, at the assertion in `openWorld`.

`tests/acceptance/723/` has no `lane.json`, and `scripts/lanes-lists.mjs` names neither the folder nor any file of it
(not in `alone`, `slow`, `timed` or any other list), so it runs in the shared lane; the redraft writes no `lane.json` and
needs no entry either. The suite has no `twins.json` and no `twins/`: its wrong programs are named in the tests' own
assertions, and the redraft copies those as they are.

Run it:

```sh
npx vitest run --root tests/acceptance/723-redraft-1894
node node_modules/typescript/bin/tsc -p tests/acceptance/723-redraft-1894/tsconfig.json   # type check
```
