# #355 blind redraft, after #1894: the suite's own record is given the shipped transcript readers

#355's suite seeds the hub's ledger itself: `355/helpers.ts`'s `withRecord` opens `@deepbuild/record` over the evidence
store, `seedSession` archives a Claude Code transcript there, and the wiki's writer, handed that record, checks each
`session:<id>#<message>` source's quote through it. #1894 takes the transcript formats out of the record: "an adapter
owns its transcript reader; the record takes turns in one shape and names no agent". `openRecord` takes
`readers?: readonly TranscriptReader[]`, and with none "a `session:<id>#<message>` handle resolves to nothing".
`@deepbuild/adapters` exports the shipped agents' readers as `transcriptReaders`, and whoever opens a record over an
evidence store passes them. No criterion, expected value, fixture or plant of #355 is touched: only that the record
the suite opens itself is opened as #1894 says.

Written from issue #1894 and the surface its owner decided, the design, `tests/acceptance/355/` and base `e87cefc44`.
The job never saw an implementation of #1894, and could not run the suite (the base checkout had no `node_modules`):
neither side of any test here has been run.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `355/pages.test.ts` › AC1, AC7, AC3 (the 20 queries), AC3 (the link) | AC1, AC3, AC7 | `withRecord` opens the record with no readers, so no message of the three seeded sessions resolves. Every fixture claim that cites `session:<id>#<message>` (the `you` claims, the link, `proof3`, `proof1`) is dropped as not at its handle, and the file's one shared world lacks them: AC1 stops at "the wiki wrote" the first of them, AC7 at the count of three, AC3 at the first query that should find one, the link test at its claim's line |
| `355/outside.test.ts` › AC5, AC4 (the planted index), AC4 (wrong program), AC6 | AC4, AC5, AC6 | both claims of the file's one world cite messages of session R (`#readme`, `#ask`), so neither is written and every test stops at "the wiki writes both claims"; the wrong-program test's rejection never names `wiki:repos/api#setup` |
| `355/scope.test.ts` › AC8 (the default index), AC8 (the planted index), AC8 (wrong program) | AC8 | every heron claim cites messages of sessions X and A, so none is written and each test stops at "the wiki writes"; the wrong-program test's rejection never names a claim |

`355/pages.test.ts`'s Proof test may still hold as it is: its claim cites a decision, which the record resolves with
no reader. A swap is by file, so the redraft carries it over.

What changed, and nothing else:

| | In #355's suite | In the redraft |
|---|---|---|
| `withRecord` (`helpers.ts`) | `openRecord({ path, now, evidence })` | the same helper, copied (it takes no way in), first asserting that `@deepbuild/adapters` exports `transcriptReaders`, then `openRecord({ path, now, evidence, readers: transcriptReaders })`. Everything else of `355/helpers.ts` is re-exported by import, so its temp home, cleanup and seeding are the original's own |
| The adapters import | none | a namespace import, and the options cast, so the folder loads and type-checks at the base, where the export and the option don't exist; the base then fails each test at that assertion |
| `pages.test.ts`'s corpus | `./fixtures/corpus.json` | `../355/fixtures/corpus.json`: the original's fixture, read where it is |
| `pages.test.ts`, `outside.test.ts`, `scope.test.ts` | | otherwise copied as they are, but for their comments (the repo's comment ratchet starts a new file at zero; the originals keep them) |

Every `withRecord` call of the three files goes through the redraft's: the seeding, `outside.test.ts`'s start-slice
reads and its promotions. The hubs and `deep mcp` processes the tests start are the repo's own and pass their readers
themselves; the tests' `deep_search` calls go through them.

Files of the suite that need no redraft, and stay as they are:

- `install.test.ts` opens a record with no evidence store, archives no transcript and reads none.
- `inferred.test.ts` and `propose.test.ts` use `withRecord` and seed one session each, but their claims cite only a
  repo file at a commit: the writer reads it with git, and nothing is read from the archived transcript through the
  suite's record. `propose.test.ts`'s later reads go through the hub. This rests on the criteria and the writer's
  surface in `355/README.md`; if a run after #1894 shows either failing for a missing reader, it needs this same
  redraft and nothing more.
- `fixtures/` is read in place.

The original has no `lane.json`, no `twins.json` and no `twins/`. Its planted wrong programs are seams of the programs
under test (`DEEP_HUB_PLANT=trusts-index`, `openWiki({ plant: 'quote-present-only' })`) and index modules its own
helpers write; the redraft uses them unchanged, by import, and writes none. `tests/acceptance/355/` runs one at a time
by its entry in `scripts/lanes.mjs`; this folder starts the same real hubs and needs the same placement, which this job
does not write.

Run it as the original is run (`355/README.md`, How to run: the built packages, and no file parallelism):

```sh
npx vitest run --root tests/acceptance/355-redraft-1894 --no-file-parallelism
npx tsc -p tests/acceptance/355-redraft-1894/tsconfig.json
```
