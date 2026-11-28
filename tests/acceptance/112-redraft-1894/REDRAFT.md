# #112 blind redraft, after #1894: the record is given the shipped agents' transcript readers

#112's widening tests open a record of their own over an evidence store, archive each session's transcript in Claude
Code's format and cite your words in it by handle (`session:<id>#m1`). #1894 moves each agent's transcript reader out of
the record and into its adapter: `openRecord(options)` takes `readers?: readonly TranscriptReader[]`, and with no readers
the record reads no turn from any archived transcript, so a quote at a `session:<id>#<message>` handle is "not at its
handle". Whoever opens a record over an evidence store passes `transcriptReaders` from `@deepbuild/adapters`. No
criterion, expected value, fixture or plant of #112 is touched: only how the suite's own record is opened.

Written from issue #1894, the design (The learned layer, Reading by reference, What each agent gives us, Dogfooding),
`tests/acceptance/112/`, `tests/acceptance/112-redraft-3245/` and base `e87cefc44`, by a blind job. It never saw an
implementation of #1894.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `112/widen.test.ts` › AC8 after three sessions where it helped again, 20 replayed tasks with a higher mean gain whose bound is below 0 keep it at its session, INCONCLUSIVE; a decisive replay widens it | `#112.dbf62f22` | `112/helpers.ts`'s `openWorld` opens the record with `openRecord({ path, now, evidence })` and no readers. Its first step, `learnedInSession`, appends a `learn.applied` whose only evidence is a quote at `session:<id>#m1` in the transcript `startSession` archived. With no readers that quote is not at its handle, the change is refused, and the test stops at "applies to the session it came from" (`state` is not `applied`) |
| `112/widen.test.ts` › AC5 three complete replayed tasks, INCONCLUSIVE, neither widen a change in its session nor revoke one in force for the repo | `#112.477ca7b2` | the same `openWorld` and the same first step: it stops at the same assertion. The repo rule you applied next cites `session:<id>#m1` too |

What changed, and nothing else:

| | In #112's suite | In the redraft |
|---|---|---|
| `openWorld` (`helpers.ts`) | `openRecord({ path, now, evidence })` | the same world, with the record given `readers: transcriptReaders`. It first asserts that `@deepbuild/adapters` exports `transcriptReaders`, so the base, which has no such export, fails each test there, at an assertion. The adapters entry is imported as a namespace and the option is added to the options object after it is typed, so the folder type-checks at the base and after #1894 |
| The rest of `helpers.ts` | | #112's helpers, by `export *` from `../112/helpers.ts`: `startSession`, `learn`, `putReplay`, `layerRow`, `handleOf`, `sliceText`, the rule's plans and runs, the temp folders (`tempDir` and `removeRoots` are the original module's, so the redraft's worlds are removed with them) |
| `widen.test.ts` | | copied as it is, but for its comments: it imports `./helpers.ts`, which is now this folder's |

Files of the suite that need no redraft for #1894:

- `112/rule.test.ts` calls `compareReplay` and `planHash` on plans and runs built in memory. It opens no record and
  archives no transcript. It holds as it is.
- `112/eval.test.ts` and `112/ci.test.ts` were redrafted for #3245 (`tests/acceptance/112-redraft-3245/`). They, and
  their redrafts through `../112/helpers.ts`, use `evalWorld`, `runOnFake` and the fake `Launcher` only: a fixture git
  repo and `runEval`. Neither calls `openWorld`, `startSession` or any record. Nothing there reads a transcript.
- `112/live.test.ts` runs by hand on an input file of tasks you exported; it opens no record.

The original folder has no `lane.json`, no `twins.json` and no `twins/`, so the redraft writes none.

Run it:

```sh
npx vitest run --root tests/acceptance/112-redraft-1894
node node_modules/typescript/bin/tsc -p tests/acceptance/112-redraft-1894/tsconfig.json
```
