# #1098 blind redraft, after #1894: the suite's record is opened with the shipped agents' transcript readers

#1098's suite opens its own record over an evidence store (`tests/acceptance/1098/helpers.ts`, `openWorld`:
`openRecord({ path, now, evidence })`), keeps each session's Claude Code transcript in it as the archive does, and
then needs what the record reads from that transcript: the asks core places a plan's targets from
`record.transcript(session)`, and the suite's `readIn` resolves the card's `session:<id>#<message>` handle with
`record.resolve`. #1894 moves each agent's transcript reader out of the record and into its adapter: `openRecord`
takes `readers`, and "with no readers the record reads no turn from any archived transcript". Whoever opens a record
over an evidence store passes `transcriptReaders` from `@deepbuild/adapters`. No criterion, expected value, fixture
or plant of #1098 is touched: only how the suite's own record is opened.

Written from issue #1894, the design, `tests/acceptance/1098/` and base `e87cefc44`. It never saw an implementation
of #1894. It could not be run where it was written (the base checkout had no `node_modules`).

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `1098/criteria.test.ts` › AC1 | `#1098.23c3f8ea` | the record was given no readers, so `record.transcript` of the session is empty: audit@evil.example, which is only in the WebFetch result, is placed `unknown`, and the scenario stops at `readIn`: "the card shows it as `unknown`, not `read`" |
| `1098/criteria.test.ts` › AC2 | `#1098.cfbd489a` | the same: boss@corp.example, only in the CRM tool's result, is placed `unknown`, not `read` |
| `1098/criteria.test.ts` › AC3 | `#1098.7e22fb1f` | the same: the README's URL, only in the Read result, is placed `unknown`, not `read` |
| `1098/criteria.test.ts` › AC4 | `#1098.c09c4e38` | it plays AC3's session first, and stops where AC3 does |
| `1098/plants.test.ts` › `wider-scope-offered` | `#1098.c09c4e38` | it plays AC3's session first, which stops at `readIn` naming the URL; the plant test needs a failure naming the option ("for this repo" or "always") |

`1098/plants.test.ts`'s four other tests (`origin-from-agent-message`, `first-recipient-origin`,
`rule-by-recipient-kind`, `push-target-as-repo`) need only a `CriterionFailed` naming the address or the URL. With
no readers each scenario fails naming that same target with or without its plant (the target is `unknown`, not
`read`), so they can still pass, but no longer because of the wrong program they name. A swap is by file, so the
redraft carries them over, and with the readers they again fail only under their plants.

What changed, and nothing else:

| | In #1098's suite | In the redraft |
|---|---|---|
| The world (`helpers.ts`, `openWorld`) | `openRecord({ path, now, evidence })` | first asserts that `@deepbuild/adapters` (`packages/adapters/src/index.ts`, imported as a namespace) exports `transcriptReaders`, then `openRecord({ path, now, evidence, readers: transcriptReaders })`. The options are cast, so the folder type-checks at the base (no export, no `readers` option) and after #1894 |
| `helpers.ts`, the rest | | `openWorld` and `inWorld` (which calls it) are copied from `1098/helpers.ts` with that one change; `who`, which `1098/helpers.ts` doesn't export, is restated. Everything else is `1098/helpers.ts`'s own, by `export *` |
| `scenarios.ts` | | not copied: both test files import `../1098/scenarios.ts`, whose scenarios take the world they are given |
| `criteria.test.ts`, `plants.test.ts` | | otherwise copied as they are, but for their opening comments, and with every test name and criterion tag as it was |

On the base each redrafted test fails at an assertion: the base's `@deepbuild/adapters` has no `transcriptReaders`,
so `openWorld` stops at "@deepbuild/adapters exports transcriptReaders (#1894)". The four criterion tests fail on
that; the five plant tests catch it and fail at their own "under the plant … the criterion's test must fail"
(it is not a `CriterionFailed`).

## Files of the suite that need no redraft here

- `1098/budgets.test.ts` was redrafted for #1830 (`tests/acceptance/1098-redraft-1830/`, `scripts/lanes-lists.mjs`
  `redrafted`) and is not this redraft's.
- `1098/helpers.ts` and `1098/scenarios.ts` hold no test. `1098/README.md` and `1098/BASE-FAILURE.txt` stand as the
  first draft's record.

The suite has no `lane.json`, no `twins.json` and no `twins/`: its wrong programs are plants of the asks core
(`AsksPlant`, the `plant` option of `openAsks`), which the redraft passes on as the original does. Nothing here reads
a transcript through a hub, a CLI command or a benchmark script; `1098/budgets.test.ts`'s first test runs the perf
lane's `target-origins` command, which opens its own record.

## Run

With Node 24.22 first on `PATH`, from the checkout's root, after `npm ci` and `npm run build --workspaces`:

```sh
npx vitest run --root tests/acceptance/1098-redraft-1894
node node_modules/typescript/bin/tsc -p tests/acceptance/1098-redraft-1894/tsconfig.json
```

As the original, it needs `git`, makes each world under `/tmp/dh1098-*` and removes it, and takes about 2 s.
