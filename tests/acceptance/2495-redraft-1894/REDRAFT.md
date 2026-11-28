# #2495 blind redraft, after #1894: the record is given the shipped agents' transcript readers

#2495's closure check opens a record of its own over the evidence store an eval run wrote to, archives a session's
transcript in Claude Code's format (through #112's `startSession`) and cites your words in it by handle
(`session:<id>#m1`). #1894 moves each agent's transcript reader out of the record and into its adapter:
`openRecord(options)` takes `readers?: readonly TranscriptReader[]`, and with no readers the record reads no turn from
any archived transcript, so a quote at a `session:<id>#<message>` handle is "not at its handle". `@deepbuild/adapters`
exports the shipped agents' readers as `transcriptReaders`, and whoever opens a record over an evidence store passes
them. No criterion, expected value, fixture or plant of #2495 is touched: only how the file's own record is opened.

Written from issue #1894, the design (The learned layer, Reading by reference, What each agent gives us, Dogfooding),
`tests/acceptance/2495/`, `tests/acceptance/112-redraft-3245/` and base `e87cefc44`, by a blind job. It never saw an
implementation of #1894. It ran the original and this folder at the base: the original's two tests pass there, and
both tests here fail at the `transcriptReaders` assertion.

`report-handle.test.ts` here replaces `tests/acceptance/2495/closure/report-handle.test.ts`.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `2495/closure/report-handle.test.ts` › AC2 an INCONCLUSIVE report is refused naming it; the same report adopting passes | `#2495.9f9da789` | The test opens its record itself, `openRecord({ path, now, evidence })`, with no readers. Its first step, `learned`, archives a session through `../../112/helpers.ts`'s `startSession` and appends a `learn.applied` whose only evidence is a quote at `session:<id>#m1`. With no readers that quote is not at its handle, the change is refused, and the test stops at "slice:seed-first applies to the session it came from" (`state` is `refused`, not `applied`), before either widening is judged |

`2495/closure/report-handle.test.ts` › AC1 (`#2495.f43599c5`) opens no record and reads no transcript: it holds as it
is under #1894. A swap is by file, so the redraft carries it over.

What changed, and nothing else:

| | In #2495's closure check | In the redraft |
|---|---|---|
| The record AC2 opens | `openRecord({ path, now, evidence: r.store })` | the same options, with `readers: transcriptReaders`. `@deepbuild/adapters` is imported as a namespace, as the file imports `@deepbuild/record` and `@deepbuild/evidence`, and the option is added to the options object after it is typed, so the folder loads and type-checks at the base and after #1894 |
| `afterRun`, which both tests call first | starts the run and reads the store | first asserts that `@deepbuild/adapters` exports `transcriptReaders`. The base has no such export, so each test of the file fails there, at an assertion, before the eval is run: AC1 too, which passes on the base otherwise, and a new tagged test that passes on the merge base is failed by the proof lanes |
| Paths | `../../1108/helpers.ts`, `../../112/helpers.ts`, the repo four folders up | `../1108/helpers.ts`, `../112/helpers.ts`, the repo three folders up: the file is at this folder's top level |
| Comments | | dropped; one empty `catch` that held only a comment now holds `continue`, which does the same |

Both helper files are imported unchanged. `1108/helpers.ts`'s `world` opens no record (its `archivedTasksOf` does, and
this file doesn't call it). `112/helpers.ts`'s `startSession`, `learn`, `layerRow`, `handleOf` and `said` take the
world they are given, and the test gives them its own record, so `112-redraft-1894/helpers.ts`'s `openWorld` is not
needed here. Criterion tags are computed by the file's `idOf`, as in the original, and read the same.

Files of the suite that need no redraft here:

- `2495/report.test.ts` is already sent by hand in `scripts/lanes-lists.mjs` for an older reason, and is not
  redrafted. It does need the readers too: its two AC2 tests open their record through `../112/helpers.ts`'s
  `openWorld` (no readers) and stop at "the change applies to the session it came from" under #1894. Its AC1 test
  opens no record. Run by hand after #1894 it needs `112-redraft-1894/helpers.ts`'s `openWorld` in place of #112's.
- `2495/helpers.ts` starts a hub, runs the script and opens the hub's evidence store read-only. It opens no record.

The original folder has a `tsconfig.json` (copied; the paths are the same from here) and no `lane.json`, `twins.json`
or `twins/`, so the redraft writes none. `2495/closure/README.md` says no planted twin is supplied: the base is the
wrong program.

Run it (as the original: `npm ci && npm run build --workspaces` first, since it uses `@deepbuild/*` dist and
`packages/cli/dist/main.js`):

```sh
npx vitest run --root tests/acceptance/2495-redraft-1894
node node_modules/typescript/bin/tsc -p tests/acceptance/2495-redraft-1894/tsconfig.json --noEmit
```
