# #3460 blind redraft, after #1894: the record the scope test opens itself is given the shipped transcript readers

#3460's `scope.test.ts` seeds the hub's ledger itself, through #355's helpers: `355/helpers.ts`'s `withRecord` opens
`@deepbuild/record` over the evidence store, `seedSession` archives a Claude Code transcript there, and the wiki's
writer, handed that record, checks the quote of the claim's one source, `session:<A>#said`, through it. #1894 takes the
transcript formats out of the record: "an adapter owns its transcript reader; the record takes turns in one shape and
names no agent". `openRecord` takes `readers?: readonly TranscriptReader[]`, and with none "a `session:<id>#<message>`
handle resolves to nothing". `@deepbuild/adapters` exports the shipped agents' readers as `transcriptReaders`, and
whoever opens a record over an evidence store passes them. No criterion, expected value, fixture or plant of #3460 is
touched: only that the record the test opens itself is opened as #1894 says.

Written from issue #1894 and the surface its owner decided, the design, `tests/acceptance/3460/`,
`tests/acceptance/355/` and base `e87cefc44`. The job never saw an implementation of #1894. It ran this folder once at
the base (below); no run after #1894 has been seen by it.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `3460/scope.test.ts` › AC3, its one test | `#3460.8dffa8bf` | `withRecord` opens the record with no readers, so `session:<A>#said` resolves to nothing. The wiki drops the claim `wiki:repos/web#preview-ports` as not at its handle, and the test stops at "the wiki writes wiki:repos/web#preview-ports at the scope of session A", before any hub is started or `deep_search` called |

What changed, and nothing else:

| | In #3460's suite | In the redraft |
|---|---|---|
| `withRecord` (`scope.test.ts`'s import) | `../355/helpers.ts`'s: `openRecord({ path, now, evidence })` | `../355-redraft-1894/helpers.ts`'s, by import: the same helper as #355's blind redraft for #1894 copies it, first asserting with `expect` that `@deepbuild/adapters` exports `transcriptReaders`, then `openRecord({ path, now, evidence, readers: transcriptReaders })`. This folder copies no helper |
| Every other helper | `../355/helpers.ts`, `../26/helpers.ts`, `./helpers.ts` | the originals, by import: `../355/helpers.ts`, `../26/helpers.ts`, `../3460/helpers.ts` (the tags in `AC`, `learn`, `search`, the notes word for word) |
| `scope.test.ts` | | otherwise copied as it is, but for its comments (the repo's comment ratchet starts a new file at zero; the original keeps them) |

The test's one `withRecord` call is its only record; `learn`, `trustProject`, `seedSession` and `openWiki` are handed
it. The hub and the agent stand-in's `deep mcp` are the repo's own and pass their readers themselves; both
`deep_search` calls go through them.

At the base `@deepbuild/adapters` has no `transcriptReaders`, so the test fails at that assertion, where its world is
made: `@deepbuild/adapters exports transcriptReaders (#1894): expected false to be true`. The base is no wrong program
of `#3460.8dffa8bf` itself here; the criterion's wrong program stays its twin (below).

Files of the suite that need no redraft, and stay as they are:

- `note.test.ts`, `find.test.ts`, `order.test.ts`, `reading.test.ts` use `withRecord`, but seed no session's
  transcript: `learn` (`3460/helpers.ts`) rests each claim on a decision of yours (`seedDecision`), which the record
  resolves with no reader, and `order.test.ts` appends a `session.start`, an ask and a decision and archives nothing.
  Their searches go through the hub (`deep mcp`), `deep find` (the built CLI) and `scripts/search-reading.mjs`.
- `hits.test.ts`: #884's test is built the same way (decisions, no transcript). #26's test seeds through
  `26/helpers.ts`'s `agentWorld`, whose record has no evidence store, and the merge base's sets it expects hold no
  transcript hit. #1515's test builds its 500 sessions with `1515/helpers.ts`'s `makeWorld`, which opens a record over
  an evidence store with no readers, but only to write: every read is `deep_search` from a Codex session through the
  hub, or `deep find` through the CLI, which open their own records. Nothing is read from a transcript through a
  record the suite opened.
- `helpers.ts`, `fixtures/` and `twins/` are used or left in place.

Twins. `3460/twins.json` gives `#3460.8dffa8bf` one twin, `note-counts-every-scope`, kept as wrong lines of a product
file (`3460/twins/note-counts-every-scope/lines.json`); it changes nothing under `tests/`. The redraft keeps the tag,
the assertions and their messages, so that twin fails the redrafted test where `3460/twins/README.md` says ("session
B's note counts wiki:repos/web#preview-ports … as holding \"ports\""). The redraft copies no twin and writes no
`twins.json`: `scripts/proof-runs.mjs` reads a folder's own `twins.json`, so whoever places this folder in the lanes
gives it the one entry `{ "#3460.8dffa8bf": ["note-counts-every-scope"] }` with that twin's `lines.json`, if the twin
is to run against the redraft. The suite's six other twins belong to files not redrafted.

Lanes. Neither `scripts/lanes.mjs` nor `scripts/lanes-lists.mjs` names `tests/acceptance/3460/` or any file of it: no
`alone` entry, no reason in `aloneReasons`, no timed or slow file. The folder places itself by its own `lane.json`:

```json
{ "alone": true, "why": "binary: five of its six files start real hubs (deep hub run, with this checkout's deep-hook), as tests/acceptance/26, 355, 884 and 1515 do on the one-at-a-time list; hits.test.ts builds #1515's 500-session record" }
```

It names no timed and no slow file. The redraft mirrors it for the one file it holds, which starts a real hub: this
folder's `lane.json` is `alone`, reason `binary`, with no timed or slow file. Sending `3460/scope.test.ts` by hand and
naming this folder as its redraft is `scripts/lanes-lists.mjs`'s to say, which this job does not write.

Run it as the original is run (`3460/README.md`: the built packages, and no file parallelism):

```sh
npx vitest run --root tests/acceptance/3460-redraft-1894 --no-file-parallelism
npx tsc -p tests/acceptance/3460-redraft-1894/tsconfig.json --noEmit
```
