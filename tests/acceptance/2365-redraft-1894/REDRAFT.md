# #2365 blind redraft, after #1894: the suite's record is opened with the shipped agents' transcript readers

#2365's suite opens its own record over an evidence store (`tests/acceptance/20/helpers.ts`, `openWorld`, which
`tests/acceptance/2365/helpers.ts` re-exports), has the archive copy transcripts into it, and then reads messages back
through that record: `resolve('session:<id>#<message>')` and `transcript(session)`. #1894 moves each agent's transcript
reader out of the record and into its adapter: `openRecord` takes `readers`, and "with no readers the record reads no
turn from any archived transcript". `@deepbuild/adapters` exports `transcriptReaders`, and whoever opens a record over
an evidence store passes them. No criterion, expected value, fixture or plant of #2365 is touched: only that the record
the suite opens is given `readers: transcriptReaders`.

Written from issue #1894, the design, `tests/acceptance/2365/` and base `e87cefc44`. It never saw an implementation of
#1894. Not run by this job (the base checkout has no `node_modules`).

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `2365/tail.test.ts` › "by passes", "on demand" | `#2365 AC3` | `halfKeyScenario` ends on `resolved(w, id, 'm6')`, the record's `resolve` of `session:<id>#m6`. The world's record was opened with no readers, so the handle resolves to nothing and the test stops at "session:<id>#m6 resolves through the parts" |
| `2365/tail.test.ts` › "a last line with no line end" | `#2365 Scope` | the same record: `session:<id>#m6` and `#m8` resolve to nothing |
| `2365/rewrite.test.ts` › "rewritten and grown" | `#2365 AC4` | the same record: the edited prompts' handles and the last message's resolve to nothing, and `record.transcript(session)` is empty |
| `2365/rewrite.test.ts` › "one letter rewritten" | `#2365 AC4` | the same record: the rewritten line's handle resolves to nothing |
| `2365/heavy/ac1.heavy.ts` › "the pass that follows" | `#2365 AC1` | its check opens the same world on the run's home and resolves the last message gained: nothing |
| `2365/heavy/ac2.heavy.ts` › "one pass", "the copy of one session on demand" | `#2365 AC2` | the same: "`session:<id>#m<n>` resolves for its last message" is read through a record with no readers |

The other tests of those files read no message through the record (`tail.test.ts`'s three-step line and its
cut-at-end twin; `rewrite.test.ts`'s append-tail twin; `ac1.heavy.ts`'s whole-file twin). A swap is by file, so the
redraft carries them over.

What changed, and nothing else:

| | In #2365's suite | In the redraft |
|---|---|---|
| `openWorld` (`helpers.ts`) | #20's, by re-export: `openRecord({ path, now, evidence })` | #20's `openWorld` copied with its private `counting`, with one change: it first asserts `@deepbuild/adapters` exports `transcriptReaders`, then opens the record with `readers: transcriptReaders`. Everything else of #2365's and #20's helpers is re-exported from `../2365/helpers.ts` |
| `tail.test.ts`, `rewrite.test.ts` | import `./helpers.ts`, `./wrong.ts` | import this folder's `./helpers.ts` and the original twins from `../2365/wrong.ts`; otherwise copied as they are, but for their comments |
| `heavy/ac1.heavy.ts`, `heavy/ac2.heavy.ts` | import `../helpers.ts`, `./run.ts` | import this folder's `../helpers.ts` and the original `../../2365/heavy/run.ts` (which runs the original `probe/` scripts in place); otherwise copied as they are, but for their comments |
| `heavy.config.ts`, `tsconfig.json` | | copied; the config's comments dropped |

At the base `@deepbuild/adapters` has no `transcriptReaders`. The module is imported as a namespace, so that is no
link error: every test that opens a world fails at `openWorld`'s assertion, "@deepbuild/adapters exports
transcriptReaders (#1894)". The one test that opens no world (`ac1.heavy.ts`'s whole-file twin) holds at
the base as the original does. The options object is cast (`as unknown as RecordOptions`), so the folder
type-checks with and without the `readers` option.

Test names keep the original's tags as they are: this suite names its tests `#2365 AC<n>` and `#2365 Scope`, not
`#2365.<hash>` (`2365/criteria.ts` computes the IDs; no test name of these files holds one).

## Files that need no redraft

- `2365/identity.test.ts` (AC5): opens the same world, but reads no message through the record. Its checks read the
  record's events (`record.read`), the evidence store (`store.read`) and Node's file reads (`reads.ts`). It holds as it is.
- `2365/heavy/budgets.heavy.ts` (AC6): opens no record.
- `2365/helpers.ts`, `reads.ts`, `criteria.ts`, `wrong.ts`, `heavy/run.ts`, `probe/*.mjs`: reused by import or run in
  place. `probe/pass.mjs` opens a record of its own in a child, with no readers, over the built packages; it only
  runs the archive's pass and reads no message through that record. The archive at the base calls neither `resolve`
  nor `transcript` on the record it is given.

## Twins

The suite has no `twins.json` or `twins/`. Its wrong programs are test-side: `wrong.ts` (`cutAtEndArchive`,
`appendTailArchive`), which take the world they are given, and `probe/twin-whole.mjs`, loaded by `probe/pass.mjs`. The
redraft imports and runs them from `tests/acceptance/2365/` unchanged; nothing of them is copied.

## Lanes

`tests/acceptance/2365/` has no `lane.json`, and none is written here. `scripts/lanes-lists.mjs` at the base names no
path of #2365: which lane runs this folder, and the swap of `2365/tail.test.ts` and `2365/rewrite.test.ts` (and, by
hand, the two heavy files) for it, are that file's owner's.

## Doubts

- `heavy/ac1.heavy.ts` and `heavy/ac2.heavy.ts`: the archive's pass runs in `probe/pass.mjs`, whose record has no
  readers, and the handles are then resolved by this process's record, which has them. That holds if a reading of an
  archived transcript is made when it is asked for, from the evidence, by the record asked. If a program meeting #1894
  parsed turns only when the copy's event was appended, by the appending record's readers, these two would still
  resolve nothing, and `probe/pass.mjs` would need the readers too. This job copied no probe script.
- AC3's rotate ask is raised by the archive, which at the base finds the key in the transcript file itself and reads
  no message through the record. If a program meeting #1894 had the archive read turns through the record it is handed,
  the redraft's record has the readers; `probe/pass.mjs`'s would not.

## How to run

```sh
npx vitest run --root tests/acceptance/2365-redraft-1894
npx vitest run --config tests/acceptance/2365-redraft-1894/heavy.config.ts
npx tsc -p tests/acceptance/2365-redraft-1894/tsconfig.json
```

The second is the heavy runs (AC1, AC2), as `tests/acceptance/2365/README.md`, How to run, says of the originals: they
need the built packages (`npm run build --workspaces`), a reference Mac for a PASS, and hours and several GB under `/tmp`.
