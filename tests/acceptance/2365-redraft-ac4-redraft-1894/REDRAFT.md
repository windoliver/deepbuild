# #2365 AC4 blind redraft, after #1894: the suite's record is opened with the shipped agents' transcript readers

`tests/acceptance/2365-redraft-ac4/` (itself a blind redraft of #2365's AC4) opens its own record over an evidence
store (`tests/acceptance/20/helpers.ts`, `openWorld`), has an archive copy a Claude Code transcript into it, and then
reads the messages back through that record: `record.transcript(session)` and `record.resolve('session:<id>#m<n>')`
(`helpers.ts`, `rewriteAfterCopy`). #1894 moves each agent's transcript reader out of the record and into its adapter:
`openRecord` takes `readers`, and "with no readers the record reads no turn from any archived transcript".
`@deepbuild/adapters` exports `transcriptReaders`, and whoever opens a record over an evidence store passes them. No
criterion, expected value, fixture or plant of the suite is touched: only that the record the suite opens is given
`readers: transcriptReaders`.

Written from issue #1894, the design, `tests/acceptance/2365-redraft-ac4/` and base `e87cefc44`. It never saw an
implementation of #1894.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `2365-redraft-ac4/rewritten.test.ts` › "AC4 archived at 480 lines, first megabyte rewritten from line 3, 20 lines gained: …" | `#2365.<hash>` (AC4, computed in `2365-redraft-ac4/helpers.ts`) | the world's record was opened with no readers, so `record.transcript(session)` is empty after the first pass, and `copiedAgainFromStart` stops at "before the rewrite, the archived transcript reads as the file first written" (the reading ends after line 0) |
| `2365-redraft-ac4/rewritten.test.ts` › "AC4 (wrong program) an archive that appends the rewritten file's tail to the old parts fails, naming line 3, the first line that differs" | the same | it first runs the real archive through the same check, which stops as above; and the twin's own reading, through the same kind of record, is empty, so "the twin's archived transcript has as many lines as the rewritten file" could not hold either |

The file has only these two tests; both are carried over.

What changed, and nothing else:

| | In `2365-redraft-ac4` | In the redraft |
|---|---|---|
| `openWorld` (`rewritten.test.ts`'s import) | #20's, from `../20/helpers.ts`: `openRecord({ path, now, evidence })` | the sibling redraft's, from `../20-redraft-1894/helpers.ts`: #20's `openWorld` with one change, it first asserts `@deepbuild/adapters` exports `transcriptReaders`, then opens the record with `readers: transcriptReaders`. Imported, not copied a second time: it is the same helper this suite took from #20 |
| `handle`, `openArchiveOn`, `removeTemps` | from `../20/helpers.ts` | the same import |
| `helpers.ts`, `wrong.ts` | `./helpers.ts`, `./wrong.ts` | imported from `../2365-redraft-ac4/`, unchanged: both take the world they are handed and open no record |
| `rewritten.test.ts` | | otherwise copied as it is, but for its comments |
| `tsconfig.json` | | copied |

The test names, and so the criterion tag in the `describe` (`AC4 #2365.<hash>`, from the original's `AC4`), are the
original's.

At the base `@deepbuild/adapters` has no `transcriptReaders`. `20-redraft-1894/helpers.ts` imports the module as a
namespace, so that is no link error: both tests fail at `openWorld`'s assertion, "@deepbuild/adapters exports
transcriptReaders (#1894)". That helper builds the options as `RecordOptions` and adds `readers` through a cast, so
the folder type-checks with and without the option.

This folder depends on `tests/acceptance/20-redraft-1894/helpers.ts`. If that folder is not kept, copy its `openWorld`
(and the private `counting`) into a `helpers.ts` here and import it from there; nothing else changes.

## Files that need no redraft

- `2365-redraft-ac4/helpers.ts`: opens no record. It reads through the world's record it is handed (`transcript`,
  `resolve`, `raw`, and #20's `allEvents`). Reused by import.
- `2365-redraft-ac4/wrong.ts`: the twin appends a `transcript.archived@2` event to the world's record and puts its
  copy in the world's store; it opens no record. Reused by import.

## Twins

The suite has no `twins.json` or `twins/`. Its wrong program is test-side, `wrong.ts` (`tailAppendArchive`), run on
the world it is given; the redraft imports it from `tests/acceptance/2365-redraft-ac4/` unchanged. Its test still
needs the record to read the twin's one whole copy as a Claude Code transcript (500 lines, old `m3`), which the
readers now give.

## Lanes

`tests/acceptance/2365-redraft-ac4/` has no `lane.json`, and none is written here. Which lane runs this folder, and
the swap of `2365-redraft-ac4/rewritten.test.ts` for it, are the lanes' owner's.

## Doubts

- The real archive (`openArchiveOn`, `packages/archive`) is handed the world's record, which now has the readers. If
  a program meeting #1894 had the archive open a record of its own to read turns, that is its to pass readers to.
- The twin's event is `transcript.archived@2` with `agent: 'claude'` in its peer. If a program meeting #1894 chose the
  reader by something the twin's event does not carry, the twin's reading would be empty and the second test would
  stop at the twin's 500 lines. The issue's criterion 3 (learned rows as the merge base's) and "with them, every
  reading is what it was at the base" say it reads as before.

## How to run

```sh
npx vitest run --root tests/acceptance/2365-redraft-ac4-redraft-1894
npx tsc -p tests/acceptance/2365-redraft-ac4-redraft-1894/tsconfig.json --noEmit
```
