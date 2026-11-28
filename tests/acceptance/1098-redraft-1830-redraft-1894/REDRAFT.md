# #1098 budgets (AC5) blind redraft, after #1894: the timed record is opened with the shipped agents' transcript readers

`tests/acceptance/1098-redraft-1830/budgets.test.ts` (itself #1830's redraft of `tests/acceptance/1098/budgets.test.ts`)
times AC5 `#1098.4e407b8b`: "placing every target of one plan, over a session with 5,000 recorded tool results, adds
under 20 ms". It takes its world from `tests/acceptance/1098/helpers.ts`, whose `openWorld` opens the record itself over
an evidence store, `openRecord({ path, now, evidence })`, and archives each session's Claude Code transcript of 5,000
tool results in it. The asks core places a plan's targets from `record.transcript(session)`
(`packages/asks/src/index.ts`). #1894 moves each agent's transcript reader out of the record and into its adapter:
`openRecord` takes `readers`, and "with no readers the record reads no turn from any archived transcript". Whoever
opens a record over an evidence store passes `transcriptReaders` from `@deepbuild/adapters`. No criterion, expected
value, limit, fixture or run count of the test is touched: only how its record is opened.

Written from issue #1894, the design, `tests/acceptance/1098/`, `tests/acceptance/1098-redraft-1830/`,
`tests/acceptance/1098-redraft-1894/` (a sibling redraft from the same brief) and base `e87cefc44`. It never saw an
implementation of #1894.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it as its criterion names |
|---|---|---|
| `1098-redraft-1830/budgets.test.ts` › AC5 placing every target of one plan, over a session with 5,000 recorded tool results, adds under 20 ms | `#1098.4e407b8b` | the record was given no readers, so `record.transcript` of each big session is empty: the timed card still shows eight targets (the test counts them, it doesn't read their origins), but they are placed over no tool result. The test can still pass, and then it times placing over nothing, not "over a session with 5,000 recorded tool results": a program whose placing is slow over 5,000 results would pass it. It proves its criterion on no program meeting #1894 |
| `1098-redraft-1830/budgets.test.ts` › AC5 the perf lane has the task target-origins, a #1098 first measurement, valid against the merge base's budgets, and it runs | `#1098.4e407b8b` | it can still pass: it opens no record of its own, and its command (`node benchmarks/asks.mjs target-origins`) opens its own, with the readers once #1894 is met ("the repo's benchmarks pass them themselves"). A swap is by file, so the redraft carries it over |

So this is not the brief's dispute exactly: neither test is made to fail by #1894; the timing is made empty by it.

What changed, and nothing else:

| | In `1098-redraft-1830` | In the redraft |
|---|---|---|
| The world | `openWorld` of `../1098/helpers.ts`: `openRecord({ path, now, evidence })` | `openWorld` of `../1098-redraft-1894/helpers.ts`, by import: that file is `1098/helpers.ts` by `export *`, with `openWorld` copied with one change: it first asserts that `@deepbuild/adapters` (`packages/adapters/src/index.ts`, imported as a namespace) exports `transcriptReaders`, then `openRecord({ path, now, evidence, readers: transcriptReaders })`. `core`, `DAY`, `repoWithOrigin`, `sha256`, `stepTo`, `tool`, `Transcript` and `World` come through the same import and are `1098/helpers.ts`'s own |
| The perf-lane test | starts with `validateBudgets` | first asserts, in the same words, that `@deepbuild/adapters` exports `transcriptReaders`. A new tagged test that passes on the merge base is refused (`scripts/proof-runs.mjs`, "passed on the merge base"), and the task whose command it runs times the same placing over an archived transcript, which is that only where the readers exist. After #1894 the assertion always holds and the test is the original's |
| `budgets.test.ts`, the rest | | copied as it is, but for its comments, with both test names and the criterion tag as they were. The `//` left in it is inside a fixture's text (a tool result's line), not a comment |
| `lane.json` | `scripts/lanes-lists.mjs` puts `tests/acceptance/1098-redraft-1830/` in `alone` and its `budgets.test.ts` in `timed`; the folder has no `lane.json` | the same placement, said here: `alone`, why, and `timed: ["budgets.test.ts"]` |

On the base each of the two tests fails at an assertion, "@deepbuild/adapters exports transcriptReaders (#1894)": the
first at its own first line, the second in `openWorld`, before any session is built or timed.

## Files of the suite that need no redraft here

- `1098-redraft-1830/` holds one test file, `budgets.test.ts`; its `README.md` stands as that redraft's record
  (what each test proves, the verdicts, its base run).
- `1098/criteria.test.ts` and `1098/plants.test.ts` are redrafted in `tests/acceptance/1098-redraft-1894/`, which this
  folder imports and doesn't edit. `1098/budgets.test.ts` was retired by #1830's redraft.

The suite has no `twins.json` and no `twins/`. The one transcript read another way is the perf lane's: the first test
runs `benchmarks/asks.mjs target-origins`, a benchmark script that opens its own record from the packages' `dist`
(at the base, `openRecord({ path, now, evidence })`).

## Run

With Node 24.22 first on `PATH`, from the checkout's root, after `npm ci` and `npm run build --workspaces`:

```sh
npx vitest run --root tests/acceptance/1098-redraft-1830-redraft-1894
npx tsc -p tests/acceptance/1098-redraft-1830-redraft-1894/tsconfig.json --noEmit
```

As the original: it needs `git`, makes each world under `/tmp/dh1098-*` and removes it, runs alone, and its verdict is
`judgeLimit`'s (PASS passes, FAIL fails, anything else prints the readings and skips as INCONCLUSIVE; a skip is never
a pass).
