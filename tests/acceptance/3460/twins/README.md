# Twins for the 3460 tests

No implementation existed when these tests were drafted, so no twin folder is here yet. Each twin is the merged
implementation with exactly one rule broken as below, and nothing else changed. A twin changes product files only, never
a file under `tests/`, and is kept as its wrong lines in `twins/<name>/lines.json` (the line form,
`tests/acceptance/1832/README.md`). "Replaces" names the files as the base has them; the implementer names the real ones.

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3460.74f4978c` | `note-names-held-word` | `packages/hub/src/search.ts` | The note asks only whether a source holds every word: with no hit, it names every word read as held by nothing | `note.test.ts` AC2: `the note names "port" as missing, though wiki:repos/api#port … holds it` |
| `#3460.8dffa8bf` | `note-counts-every-scope` | `packages/hub/src/search.ts` | The note's reads leave out the caller's scope: a word a claim of another session holds counts as held | `scope.test.ts`: `session B's note counts wiki:repos/web#preview-ports …, a claim scoped to session A that this call may not read, as holding "ports"` |
| `#3460.c0d74b68` | `note-beside-hits` | `packages/hub/src/search.ts` | A reply that has hits carries a note too | `note.test.ts` AC5: `deep_search "api port" has hits, so its reply carries no note` |
| `#3460.deebb776` | `find-sentence-for-one-word` | `packages/reading/src/index.ts` | The new sentence is printed for a query of one word too | `find.test.ts`, second test, its last assertion: `deep find ports finds nothing and prints today's sentence, byte for byte` |
| `#3460.7cd4a1ff` | `reading-counts-any-hit` | `scripts/search-reading.mjs` | A query counts as found when its reply holds any hit, whichever claim it holds | `reading.test.ts`: `the reading counts "web preview port" as found by deep_search: its reply holds ["wiki:repos/web#preview-port"] and not wiki:repos/web#previews …` |
| `#3460.e44187b3` | `hits-hold-any-word` | `packages/hub/src/search.ts` | A hit may hold any word of the query, not every one | `hits.test.ts`, #884's test (`缓存 billing` gains `wiki:notes/cache#zh1` and `wiki:notes/billing#en1`) and #1515's (the error string gains messages) |
| `#3460.e44187b3` | `decisions-first-drops-own` | `packages/hub/src/search.ts` | Putting your decisions first leaves out the session's own open items and verdicts | `hits.test.ts`, #26's test: the term from the session loses `item` and `verdict` |

The merge base is the wrong program of `#3460.67d53f5f`, `#3460.fd277010`, `#3460.6ad8cdef`, of AC6's first test and,
with no note at all, of `#3460.74f4978c` and `#3460.8dffa8bf` too (`../BASE-FAILURE.txt`); the twins of those two are
the wrong programs their criteria name. `#3460.e5ebcbe5` (the budgets) has no test and no twin (`../README.md`).
`reading-counts-any-hit` was stood in for once by a throwaway script (`../BASE-FAILURE.txt`); the others were not run.
