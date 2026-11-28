# #2495 blind redraft (after #3245), after #1894: the record is given the shipped agents' transcript readers

`2495-redraft-3245/report.test.ts` is #2495's `report.test.ts` with the judge #3245 needs. Its two AC2 tests put the
stored report into a record of their own (`openWorld` of `../112/helpers.ts`, imported as `openRecordWorld`), archive a
session's transcript in Claude Code's format and apply a change citing your words in it by handle (`session:<id>#m1`),
before widening it on the report. #1894 moves each agent's transcript reader out of the record and into its adapter:
`openRecord(options)` takes `readers?: readonly TranscriptReader[]`, and with no readers the record reads no turn from
any archived transcript, so a quote at a `session:<id>#<message>` handle is "not at its handle". Whoever opens a record
over an evidence store passes `transcriptReaders` from `@deepbuild/adapters`. No criterion, expected value, fixture or
plant of #2495 is touched: only how the suite's own record is opened.

Written from issue #1894, the design (The learned layer, Reading by reference, What each agent gives us, Dogfooding),
`tests/acceptance/2495-redraft-3245/`, `tests/acceptance/2495/`, `tests/acceptance/112-redraft-1894/` and base
`e87cefc44`, by a blind job. It never saw an implementation of #1894.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `2495-redraft-3245/report.test.ts` › #2495 AC2 a learn.widened change by the local-first rule that cites the handle › passes the check when the report adopts: the repo reads it | #2495 AC2 (the title carries no hash tag) | `widening` opens its record with `112/helpers.ts`'s `openWorld`: `openRecord({ path, now, evidence })`, no readers. It appends a `learn.applied` whose only evidence is a quote at `said(first, 'm1')` in the transcript `startSession` archived. With no readers that quote is not at its handle, the change is refused, and the test stops at "the change applies to the session it came from" (`state` is not `applied`) |
| `2495-redraft-3245/report.test.ts` › #2495 AC2 … › is refused naming the outcome when the report does not adopt: the repo does not read it | #2495 AC2 | the same `widening`, the same first step: it stops at the same assertion, before the widening it is about |
| `2495-redraft-3245/report.test.ts` › #2495 AC1 the evidence store holds the report, and the handle the run prints resolves to it › stores the frozen plan and every run by hash, and keeps the file the preflight reads | #2495 AC1 | a program meeting #1894 can pass it: it opens no record and reads no transcript. It is carried over because a swap is by file |

What changed, and nothing else:

| | In `2495-redraft-3245` | In the redraft |
|---|---|---|
| `report.test.ts`, the record's world | `openWorld as openRecordWorld` and the other record tools from `../112/helpers.ts` | the same names from `../112-redraft-1894/helpers.ts`: #112's helpers by `export *`, with `openWorld` giving the record `readers: transcriptReaders` behind an assertion that `@deepbuild/adapters` exports it. That folder is a sibling redraft of the same brief and is imported, not copied |
| `helpers.ts` | the hub's world with #3245's judge, #2495's helpers | all of it by `export *` from `../2495-redraft-3245/helpers.ts`, and `storeOf` with one line before it: the assertion that `@deepbuild/adapters` exports `transcriptReaders` (imported as a namespace, so the base fails at the assertion and not at link time). It returns the original's store unchanged |
| `report.test.ts`, the rest | | copied as it is, but for its comments |

Why `storeOf` asserts. The lanes fail a new tagged test that passes on the merge base, and AC1 opens no record, so the
sibling's `openWorld` cannot fail it there. The file's world is made in `beforeAll`, and a failure in a hook is not a
test's failure at an assertion. `storeOf` is the first thing every test of the file calls of this folder's helpers, after
`handleOfRun` (whose own assertions hold at the base): AC1 directly, the two AC2 tests as `widening`'s first line. So on
the base all three tests fail at "@deepbuild/adapters exports transcriptReaders (#1894)", and on a program meeting #1894
the assertion holds and nothing else differs. The AC2 tests would fail at the same words in `openRecordWorld` one line
later.

Files of the suite that need no redraft for #1894: `report.test.ts` is its only test file. `2495/closure/` is another
suite's, redrafted by another job (`tests/acceptance/2495-redraft-1894/`).

What else reads here, and holds as it is: the hub the world starts (`packages/cli/dist/main.js`) and
`scripts/config-eval.mjs run` open their own records and stores; the tests read the hub's evidence store by hash
(`storeOf`, `get`, `read`), never a transcript through it. `sliceText` reads `record.startSlice` on the record the test
opened, which is the one given the readers.

Lanes: `scripts/lanes-lists.mjs` names `tests/acceptance/2495/report.test.ts` in `byHand` (it was redrafted for #3245)
and names `tests/acceptance/2495-redraft-3245/` nowhere: not in `alone`, `timed`, `slow`, `redrafted` or `byHand`, so it
runs in the shared lane. Neither `2495/` nor `2495-redraft-3245/` has a `lane.json`, a `twins.json` or a `twins/`, so
the redraft writes none.

Run on base `e87cefc44`: `2495-redraft-3245` passes its three tests; this folder fails its three, each at
"@deepbuild/adapters exports transcriptReaders (#1894): expected false to be true".

Run it:

```sh
npm run build --workspaces
npx vitest run --root tests/acceptance/2495-redraft-3245-redraft-1894
node node_modules/typescript/bin/tsc -p tests/acceptance/2495-redraft-3245-redraft-1894/tsconfig.json --noEmit
```
