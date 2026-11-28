# #62 sweep (#2047) blind redraft, after #1894: the record is opened with the shipped agents' transcript readers

The suite's one test opens its own record over an evidence store, archives two Claude Code transcripts in it and
appends learned changes that quote their messages (`session:<id>#m1` and the like). #1894 moves each agent's transcript
reader to its adapter: `openRecord` takes `readers`, and "with no readers the record reads no turn from any archived
transcript", so a quote at a session message is "not at its handle". `@deepbuild/adapters` exports `transcriptReaders`,
and "whoever opens a record over an evidence store passes them". No criterion, expected value, generator, seed, fixture
or plant of the suite is touched: only how the test opens its record.

Written from issue #1894 as the brief quoted it, the design (The learned layer, Reading by reference, What each agent
gives us, Dogfooding), `tests/acceptance/62-sweep-2047/` and base `e87cefc44`. The job never saw an implementation of
#1894 and could run nothing: the base checkout has no `node_modules`.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `62-sweep-2047/rebuild.test.ts` › `#62.190a469d the layer rebuilt from its events equals the incremental projection byte for byte` | `#62.190a469d` | It opens `openRecord({ path, now, evidence })` with no readers, so on a program meeting #1894 every quote at `session:<S1>#m1`, `#m2`, `#m3`, `#r1` and `session:<S2>#n1` is not at its handle. See the doubt below: this empties what the test says it draws from, but it is not shown to fail it |

**Doubt, stated plainly.** The test compares the layer as the appends built it with the layer rebuilt from the log, and
then asserts each outcome in `reached` was produced at least once. A record with no readers still builds and rebuilds
the same layer, so the comparison holds. The outcomes can each still be reached without a session quote, by reading
`packages/record/src/learned.ts` at the base: a fitting change that cites only the kept `ev:` file or a `doc:` change is
applied; a step that loosens (`+ mode: bypassPermissions`) is held; refusals, `learn_check.made`, rollbacks, citations
and `supersedes` need no transcript. Whether all 150 runs at seed `62190469` still reach every one (wiki claims and
superseded claims rest on applied `wiki:` changes, which then need both quotes drawn from `ev`/`doc`) could not be
run. So the original may well still pass on a program meeting #1894, with every session quote refused: it would pass
while no longer drawing "quotes that are at their handle and quotes that aren't (session messages, outside content)"
as its README says it does. The redraft keeps that reading by giving the record its readers. If the original passes
unchanged on the work, there is no dispute for this suite and this folder is not needed.

What changed, and nothing else:

| | In the suite | In the redraft |
|---|---|---|
| Opening the record (`rebuild.test.ts`, in `run`) | `openRecord({ path, now: clock, evidence: store })` | `openRecord(withReaders({ path, now: clock, evidence: store }))`: the same options with `readers` set to `@deepbuild/adapters`' `transcriptReaders` |
| Opening it again for the rebuild | `openRecord({ path, now: clock })` | `openRecord(withReaders({ path, now: clock }))`: still no evidence store, as a rebuild needs no bytes; the readers are given because each record the suite opens is |
| `withReaders` (new, in the test file) | | asserts `'transcriptReaders' in adapters` with `expect`, then adds the export as `readers`. The adapters module is imported as a namespace, so the base, which has no such export, fails at this assertion and not at link time. It is generic over the options and reads the export through a cast, so the file type-checks at the base and after #1894 |
| `rebuild.test.ts` | | otherwise copied as it is, but for its comments, which this file replaces (a new suite file starts the comment ratchet at zero) |

The assertion sits inside the property's run. fast-check hands the thrown error back as `details.errorInstance`, no
mismatch is set, and the test's own `throw details.errorInstance` raises that same `AssertionError`, whose first frame
is `withReaders` in this file.

## Files of the suite that need no redraft

`rebuild.test.ts` is the suite's only test file, and it has no helpers file. `README.md`, `BASE-FAILURE.txt` and
`twins/README.md` are text. The suite has no `lane.json`, and `scripts/lanes-lists.mjs` names `62-sweep-2047` in none
of its lists (`alone`, `slow`, timed, live), so it runs in the shared lane; this folder has no `lane.json` either. Nothing
in the suite reads a transcript another way: it starts no hub, runs no CLI command and no benchmark script.

## The planted wrong programs

`62-sweep-2047/twins.json` names two twins for `#62.190a469d`, each a whole file of an older base (`61aa8eb06`):
`layer-reads-clock` (`packages/record/src/projections.ts`) and `refusal-kept-outside-the-log`
(`packages/record/src/index.ts`). The original test passes on its merge base, so the before lane proves it by laying
each twin's files whole over a copy of the change and running the test there.

This folder holds no `twins.json` and no `twins/`, and copies no twin tree. The before lane looks for twins only in a
test's own acceptance folder (`twinsOf` in `scripts/proof-runs.mjs` reads `tests/acceptance/<folder>/twins.json`, and a
twin's files are `<folder>/twins/<name>/`), so the original's twins are never laid for this folder's test. Its proof in
the before lane is the merge base failing at the `transcriptReaders` assertion; the lane lays twins only for a test the
merge base did not fail at its assertion, so none would be laid here even if named. That proves the redraft's one
change and nothing of `#62.190a469d` itself: the criterion's own proof stays the original suite's twins.

Those twins are in doubt under #1894. `refusal-kept-outside-the-log` is `packages/record/src/index.ts` whole, the file
#1894 gives `readers` to. Laid over the change it replaces the record's entry with one that knows no `readers` and calls
the learned layer as it was before #1894, and before the base's own later changes (it already differs from the base's
file by some 270 lines, and lacks its `recordSize` and `Replaying` exports). A twin has no `lines.json` here, so the
lane cannot call it stale: it is laid whole and either breaks at load, which is no failure at an assertion, or runs
with no readers. Making it hold is "a blind redraft of its suite's twin" as line edits (`lines.json`, #1832), which is
not this redraft's change. `layer-reads-clock` replaces `projections.ts`, which #1894's surface does not name, with
the same age.

## Running it

`npx vitest run --root tests/acceptance/62-sweep-2047-redraft-1894` (about 40 to 100 s on a loaded Mac, as the
original).
