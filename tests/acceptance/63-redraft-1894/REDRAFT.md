# #63 blind redraft, after #1894: the world's record is given the adapters' transcript readers

#63's suite opens its own record over an evidence store (`tests/acceptance/63/world.ts`, `openWorld`), archives Claude
Code transcripts into it, and lets an install reading write what it learned to a wiki opened on that record. #1894 moves
each agent's transcript reader out of the record and into its adapter: "an adapter owns its transcript reader; the record
takes turns in one shape and names no agent". `openRecord(options)` takes `readers?: readonly TranscriptReader[]`, and with
none the record reads no turn from any archived transcript: a `session:<id>#<message>` handle resolves to nothing and a
quote at one is not at its handle. `@deepbuild/adapters` exports `transcriptReaders`, and whoever opens a record over an
evidence store passes them. No criterion, expected value, fixture or plant of #63 is touched: only that the record the
suite opens itself is given `readers: transcriptReaders`.

Written from issue #1894, the design, `tests/acceptance/63/` and base `e87cefc44`. The job never saw an implementation
of #1894.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `63/install.test.ts` › AC1 "every wiki line the install wrote cites a handle it was delivered, the quote at that handle, and each project's fact is on the wiki" | `#63.f697c796` | the install writes through `w.wiki`, opened on `openWorld`'s record. The wiki checks each quote by `record.resolve(<session>#<message>)`, and the record checks a learned change's quotes again as it is appended. That record was given no readers, so every message handle resolves to nothing, every claim is refused, no page is written, and the test stops at "the install wrote wiki pages" |
| `63/quotes.test.ts` › AC2 its one test | `#63.084da449` | the same record: the true finding's quote is not at its handle either, so nothing is learned, and the test stops at "the install wrote its other findings as learned changes" (or earlier, at "the true finding is kept", where a refused claim's finding is dropped) |
| `63/outside.test.ts` › AC5 its one test | `#63.69997dd3` | the same record: no claim reaches the wiki, and the test stops at "the wiki holds the fetched claim" (or earlier, at "a finding cites …", where a refused claim's finding is dropped) |

`63/install.test.ts`'s four other tests (AC1: the corpus is archived and linked; AC1: every session read within 5% of a
window; AC4: no prompt past a capped slice; AC4: the pasting twin) read no transcript through the world's record and
still hold as they are. A swap is by file, so the redraft carries them over.

What changed, and nothing else:

| | In #63's suite | In the redraft |
|---|---|---|
| `openWorld` (`world.ts`) | `openRecord({ path, now, evidence })` | the same function, copied, with `readers` set to `@deepbuild/adapters`' `transcriptReaders`. Everything else of `63/world.ts` (`runReading`, `readingModule`, `CORE`, `ARCHIVE`, `hookIn`, `dataOf`, `toJson`, the types) is re-exported by `export *`, so the redraft's `world.ts` has the original's whole export list |
| The adapters import (`world.ts`) | `import { shipped }` | `import * as adapters`, so a missing `transcriptReaders` is no link error: `adapters.shipped()` is the same call |
| That the export is there (`world.ts`) | | `w.reading()` and `w.events()` first assert, with vitest's `expect`, that `@deepbuild/adapters` exports `transcriptReaders` (#1894). The assertion is there and not in `openWorld` because `install.test.ts` opens and seeds its world in `beforeAll`: asserted in `openWorld`, the base would fail in a hook, not at an assertion in each test. Every test of the three files reaches `w.reading()` (through `runReading`) or `w.events()` (itself, or through `storedMessages` in `pasteJob`), so at the base each fails there, for that reason |
| `install.test.ts`, `quotes.test.ts`, `outside.test.ts` | import `./world.ts`, `./helpers.ts`, `./corpus.ts`, `./checks.ts`, `./wrong.ts` | import this folder's `./world.ts` and the rest from `../63/`; otherwise copied as they are, but for their comments |

The types hold at the base (no `transcriptReaders`, no `readers` option) and after #1894: the readers' type is read off
`openRecord`'s own options, and the adapters namespace is cast to an object that may hold them.

## Files of the suite that need no redraft

| File | Criterion | Why it holds as it is |
|---|---|---|
| `63/delivered.test.ts` | `#63.d01b86b0` | `summary` readings only: each quote is checked on the slices `@deepbuild/reading`'s slicer serves from the root, and the slicer opens its own reader, with the readers, itself. Nothing is written to the wiki. The world's record is asked for events only |
| `63/marker.test.ts` | `#63.d3ce9787` | a `summary` reading; the pasting twin reads the archived copy's bytes from the evidence store (`storedMessages`), never through the record |
| `63/models.test.ts` | `#63.b0064604` | `summary` and `premise` readings; reads `reading.finished` events only |
| `63/quotes-redraft.test.ts` | `#63.46c00344` | a `summary` reading; the archived bytes from the evidence store, the slices from `deep read`, the verdicts from the reading's result and `reading.dropped` events |
| `63/transcript.test.ts` | `#63.52524f64` | every read is `deep read` as a process (the CLI passes the readers itself), the evidence store's bytes, or the twin's own file read |
| `63/budgets.test.ts` | `#63.82892e51` | `deep read` as a process, the evidence store's bytes, and the perf lane's benchmark script, which passes the readers itself |

These hold on a program that, as #1894's surface says, has the slicer and the CLI pass the readers themselves and checks a
reading's quotes on the slicer's slices, as the base does. The world's record still reads each archived copy as it lands
(with no readers, to nothing); none of these tests reads anything from that.

`helpers.ts`, `corpus.ts`, `checks.ts`, `wrong.ts` and `fixtures/fake-reader.pl` open no record and are used by import.

## Lanes, twins

`63/` has no `lane.json`, and the redraft writes none. `scripts/lanes-lists.mjs` lists one file of the suite,
`tests/acceptance/63/budgets.test.ts`, in `timed` and in `alone`; none is in `byHand` or `redrafted`. The redraft carries
no timed test.

`63/` has no `twins.json` and no `twins/`. Its wrong programs are functions in `63/wrong.ts`, run inside the tests after
the real program. The one a redrafted file uses, `pasteJob` (AC4, in `install.test.ts`), is imported from `../63/wrong.ts`
unchanged.

## How to run

As the original (its README, How to run): on macOS, after `npm run build --workspaces`.

```sh
npx vitest run --root tests/acceptance/63-redraft-1894 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/63-redraft-1894/tsconfig.json
```
