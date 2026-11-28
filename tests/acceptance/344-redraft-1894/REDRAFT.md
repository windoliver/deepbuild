# #344 blind redraft, after #1894: the record that seeds the start slice is given the shipped transcript readers

#344's suite seeds learned start-slice entries itself, while no hub runs: `344/helpers.ts`'s `seedSlice` archives a
Claude Code transcript through #355's helpers (`withRecord`, `seedSession`) and appends one `learn.applied` change per
entry, each quoting that session's message `session:<id>#m1`. #1894 takes the transcript formats out of the record: "an
adapter owns its transcript reader; the record takes turns in one shape and names no agent". `openRecord` takes
`readers?: readonly TranscriptReader[]`, and with none "a `session:<id>#<message>` handle resolves to nothing, a quote
at one is 'not at its handle'". `@deepbuild/adapters` exports the shipped agents' readers as `transcriptReaders`, and
whoever opens a record over an evidence store passes them. No criterion, expected value, fixture or plant of #344 is
touched: only that the record the suite opens itself, to seed and roll back the slice, is opened as #1894 says.

Written from issue #1894 and the surface its owner decided, the design, `tests/acceptance/344/`,
`tests/acceptance/355-redraft-1894/` (a sibling job's folder, read and imported, not edited) and base `e87cefc44`. The
job never saw an implementation of #1894. It ran this folder at the base: both tests fail at the `transcriptReaders`
assertion in `fixtureWorld` (below). No side after #1894 has been run.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `344/sets.test.ts` › AC8 | `#344.e8cceead` | `seedSlice` opens the record through `355/helpers.ts`'s `withRecord`, which passes no readers. The record then reads no turn of the session it has just archived, so each `learn.applied` change, whose evidence quotes `session:<id>#m1`, is refused as not at its handle. No entry is applied, there is no change to roll back, and session 1's start slice holds neither entry: the test stops at the seeding, or at "session 1's start slice holds both entries" |

`344/sets.test.ts`'s other test, AC11 `#344.0a0ed1fb`, seeds no slice and opens no record: every reading in it goes
through the hub and `deep`, and the original still holds as it is after #1894. A swap is by file, so the redraft
carries it over with its name, steps and expected values unchanged. A tagged test in a file a change adds must fail on
the merge base at an assertion (`scripts/proof-runs.mjs`), and the original AC11 passes there. So this folder's
`fixtureWorld`, which makes the world of both tests, first asserts that `@deepbuild/adapters` exports
`transcriptReaders`: the file's worlds are made for a suite whose own record is opened with those readers, and at the
base there are none to open it with. That assertion is the only thing AC11 fails on at the base; it proves nothing
about AC11's own criterion there, and after #1894 it is true and the test is the original's.

What changed, and nothing else:

| | In #344's suite | In the redraft |
|---|---|---|
| `seedSlice`, `rollBack` (`helpers.ts`) | call `withRecord` of `../355/helpers.ts`: `openRecord({ path, now, evidence })` | the same two helpers, copied with the one-line `world355` they share (none of the three takes a way in), calling `withRecord` of `../355-redraft-1894/helpers.ts`: it first asserts that `@deepbuild/adapters` exports `transcriptReaders`, then `openRecord({ path, now, evidence, readers: transcriptReaders })`. Everything else of `344/helpers.ts` is re-exported by import, so the world, the hub, the sessions and the cleanup are the original's own |
| `fixtureWorld` (`helpers.ts`) | makes #303's world with the fixture repo | the original's, by import, behind the assertion that `@deepbuild/adapters` exports `transcriptReaders` (a namespace import, so the folder loads at the base). Both tests of the file make their world through it, so both fail at the base at that assertion |
| `sets.test.ts` | | copied as it is, but for its two opening comment lines (the repo's comment ratchet starts a new file at zero; the original keeps them). It imports `./helpers.ts`, as the original does |

`rollBack` reads no transcript; it goes through the same `withRecord` so that every record this folder opens over an
evidence store is opened one way. The namespace import of the adapters and the cast on the options are in
`355-redraft-1894/helpers.ts`, which asserts the export again where the record is opened; this folder loads and
type-checks at the base through it. This folder therefore needs `tests/acceptance/355-redraft-1894/` beside it.

Files of the suite that need no redraft, and stay as they are:

- `deliver.test.ts`, `proposal.test.ts` and `rules-page.test.ts` open no record: their sessions are fired through the
  real deep-hook at a hub the test starts, and everything they read comes back through the hub's socket, `deep` or the
  rules page. The hub and the CLI pass their readers themselves.
- `lessons.test.ts` and `reach.test.ts` use `seedSessions`, which opens a record with no evidence store, appends
  `session.start` and `tool.before` events, archives no transcript and reads none. Their later reads go through the hub
  and `deep`.
- `taste.test.ts` takes only `REPO` from the helpers.
- `README.md`, `TASTE.json`, `BASE-FAILURE.txt` are read in place.

Nothing else in the suite appends a learned change quoting a session, and nothing reads turns through a record the
suite opens: `seedSlice` and `rollBack` are used by `sets.test.ts` alone.

The original has no `lane.json`, no `twins.json` and no `twins/`. Its planted wrong programs are seams of the programs
under test (`DEEP_HUB_PLANT`, `DEEP_HUB_TEST_EVAL`) and guard files its own helpers write; the redraft uses them
unchanged, by import. `scripts/lanes-lists.mjs` lists `tests/acceptance/344/` in `alone`, and `scripts/lanes.mjs`'s
`aloneReasons` gives it the reason `binary`. This folder starts the same real hubs and deep-hook and needs the same
placement, which this job does not write (no `lane.json` here).

Run it as the original is run (`344/README.md`, How to run: the built packages, `target/debug/deep-hook`, and no file
parallelism):

```sh
npx vitest run --root tests/acceptance/344-redraft-1894 --no-file-parallelism
npx tsc -p tests/acceptance/344-redraft-1894/tsconfig.json --noEmit
```
