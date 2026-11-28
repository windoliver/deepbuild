# #62 blind redraft, after #1894: the suite's own record is opened with the shipped transcript readers

#62's suite opens its own record over a real evidence store (`tests/acceptance/62/helpers.ts`, `openWorld`), archives each
session's transcript as Claude Code JSONL, and then cites messages of it as `session:<id>#<message>` handles in every learned
change. At #62's base the record parsed that format itself. #1894 moves each agent's transcript reader to its adapter: the
record "takes turns in one shape and names no agent", `openRecord(options)` takes `readers?: readonly TranscriptReader[]`,
and with no readers the record reads no turn from any archived transcript, so such a handle resolves to nothing and a quote
at one is not at its handle. `@deepbuild/adapters` exports the shipped agents' readers as `transcriptReaders`, and whoever
opens a record over an evidence store passes them. No criterion, expected value, fixture or plant of #62 is touched: only
how the suite's one record is opened.

Written from issue #1894, the design it rests on (The learned layer; Reading by reference; What each agent gives us, and
the limits we design around; Dogfooding), `tests/acceptance/62/` and base `e87cefc44`, by a job that never saw an
implementation of #1894.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `62/base.test.ts` › AC9 | AC9 | your typed rule `rule:nopush` cites `session:<S1>#m1`; with no readers the quote is not at its handle, so the base change you apply is refused and the test stops at "the rule you typed" |
| `62/base.test.ts` › AC1 | AC1 | "a base change you apply goes through" cites `session:<S1>#m1`: refused for its evidence, not applied |
| `62/budgets.test.ts` › AC8 apply, AC8 roll back, AC8 rebuild | AC8 | every measured change quotes `session:<S>#m1` and each test first expects it applied ("Measured only what was applied"); none is. Off a reference Mac the three tests skip before they open a record, in the original and in the redraft alike |
| `62/drafting.test.ts` › AC7 | AC7 | the three drafting changes quote `session:<S1>#m1`; a change whose quote is not at its handle is refused, so none is held or applied |
| `62/evidence.test.ts` › AC2 | AC2 | "an applied change lists its handles and quotes": its first handle is `session:<S1>#m1`, which resolves to nothing |
| `62/evidence.test.ts` › AC10 | AC10 | "a quote at its handle up to NFC and whitespace is applied": the handle is `session:<S1>#m2` |
| `62/evidence.test.ts` › AC5 | AC5 | "your own words are not outside content: a claim on them goes in" cites `session:<S1>#m1`, which resolves to nothing, so the test stops at "a claim on your own message"; the promoted claim's fetch handle `session:<S1>#f1` resolves to nothing too |
| `62/proof-redraft.test.ts` › Proof (redraft) | Proof | every change of the week quotes a message of an archived session; from Monday's first change on, none is applied |
| `62/rollback.test.ts` › AC11 | AC11 | A, B and E quote `session:<S1>#m1..m3`; none is applied, so there is nothing to roll back or flag |
| `62/rollback.test.ts` › AC4 AC11 | AC4, AC11 | each change before and after the date quotes a message of `S1`; none is applied, so no slice holds what the test reads |
| `62/scope.test.ts` › AC3 (a session's change), AC3 (a rule you typed), AC6 | AC3, AC6 | each change, your typed rule and each install claim quotes `session:<S>#m…`; none is applied, so no session's slice holds it |

Every test of every test file of the suite is in the table: each opens its world with `openWorld` and needs at least one
change applied whose only evidence is a message of a transcript the suite archived. #62's test names carry no `#62.<hash>`
tag (they name their criterion as `AC<n>` or `Proof`); the redraft keeps each name exactly.

What changed, and nothing else:

| | In #62's suite | In the redraft |
|---|---|---|
| `openWorld` (`helpers.ts`) | `openRecord({ path, now, evidence })` | the same world, with one assertion before the record opens, that `@deepbuild/adapters` exports `transcriptReaders`, and then `openRecord({ path, now, evidence, readers: transcriptReaders })`. The adapters module is imported as a namespace, so the base fails each test at that assertion, not at link time |
| The rest of `helpers.ts` | | #62's own, by `export * from '../62/helpers.ts'`: the clock, the ULIDs, the temp roots and `removeRoots`, the connections, the transcript fixture, the events, the reads, the reference-Mac gate and the judge. One module instance, so the ULID order and the roots are shared as before |
| `base.test.ts`, `budgets.test.ts`, `drafting.test.ts`, `evidence.test.ts`, `proof-redraft.test.ts`, `rollback.test.ts`, `scope.test.ts` | import `./helpers.ts` | copied as they are, but for their comments (a new suite file starts the comment ratchet at zero); `./helpers.ts` is now this folder's |

Files of the suite that need no redraft: none of its test files. `helpers.ts` is reused by import, `README.md` still
describes the surface, and `BASE-FAILURE.txt` is #62's own base run.

Lanes: `tests/acceptance/62/` has no `lane.json` and no `tsconfig.json`, so the redraft writes no `lane.json`; its
`tsconfig.json` is the one `tests/acceptance/62-sweep-2047/` and `tests/acceptance/112-redraft-3245/` carry. In
`scripts/lanes-lists.mjs` the suite's only listed file is `tests/acceptance/62/budgets.test.ts`, in `alone` and in `timed`
(and in `scripts/lanes.mjs`'s timing list); nothing of the suite is in `byHand`, `slow`, `exclusive` or `redrafted`. The
redraft's `budgets.test.ts` measures the same budgets and wants the same listing.

Twins: `tests/acceptance/62/` has no `twins.json` and no `twins/`. Its tests name their wrong programs in prose only, and
that prose went with the comments; the wrong programs are unchanged. (`tests/acceptance/62-sweep-2047/` is another suite,
with its own twins, and is not part of this redraft.)

Run it:

```sh
npx vitest run --root tests/acceptance/62-redraft-1894
```
