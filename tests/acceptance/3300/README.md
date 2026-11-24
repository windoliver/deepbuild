# Acceptance tests for #3300: #896's and #854's made-up readings carry their loads

Written blind at base `3637dea3f` from issue #3300, `docs/technical-design.md` (How we know version 0 works, Dogfooding),
AGENTS.md, `tests/acceptance/854/` and `896/`, `benchmarks/canvas.mjs` (`judge`, `judgeEfficiency`),
`benchmarks/canvas-judge.mjs` (`loadsOf`, `shownWindow`), `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`,
`references`), `scripts/loads-lint.mjs`, `scripts/lanes-lists.mjs`, `scripts/proof-runs.mjs` (twins) and
`scripts/proof-change.mjs` (`criterionId`). The implementer doesn't edit these files; a dispute goes to a blind redraft.

The same job wrote the blind redrafts the issue's scope asks for, `tests/acceptance/854/redraft-3300/` and
`tests/acceptance/896/redraft-3300/` (each with its README), and their `redrafted`, `byHand` and `timed` entries at the
end of `scripts/lanes-lists.mjs`, a pure addition. What is left to the implementer is the lint (criterion 3).

## Run

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/3300/judge-only.test.ts tests/acceptance/3300/loaded-run.test.ts tests/acceptance/3300/lint.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/3300/tsconfig.json
```

These run on any Mac in a few minutes: no build, no GPU, no timing. `judge-only` starts vitest on single tests of the
two suites, each a judge of a made-up reading. `fit-mac.long.test.ts` is criterion 4's hand run (below); it is in
`byHand` and `timed`, so no lane runs it.

## Surfaces

- `scripts/lanes.mjs`'s `redrafted`, `byHand` and `timed` (from `scripts/lanes-lists.mjs`): a first draft whose
  redraft has landed runs by hand only, and the redraft runs in its place.
- vitest on one file and a test name: `vitest run --root <folder> <file> -t <name> --reporter=json`, each test by full
  name and status, as `helpers.ts` `vitestRun` runs it.
- `node benchmarks/canvas.mjs judge`, `{ current, base: null }` on stdin, its verdict the last stdout line, through
  #854's `judged`.
- The loads lint, `node scripts/loads-lint.mjs [--root <checkout>]` (#1830), which reads `tests/acceptance`. It prints
  one line per finding, `FAIL loads: <path>:<line>: <why>` with the path relative to the root, and exits 1, or prints
  `PASS loads` and exits 0. The tests read `<path>:<line>` from each FAIL line (`/^FAIL loads: (.+?:\d+):/`) and don't
  read `<why>`, so the new finding may say what it likes after the line. The issue allows "#1830's lint, or a new one
  beside it"; these tests call #1830's, as the simplest surface. A new script beside it would be a dispute.

## Criteria, tests and wrong programs

| ID | Criterion | Test | Fails on |
|---|---|---|---|
| `#3300.a6ff96a8` | 1: each test of 896/ and 854/ that judges a made-up reading passes on any Mac; on the merge base the same tests fail, naming the load | `judge-only`, one row per test the issue lists (`896/settled #3` … `854/replica-redraft #3`): `redrafted` sends the first draft's file to a folder inside its suite's folder that exists; the first draft is `byHand`; the redraft is timed where the first draft was and isn't by hand; the redraft's file of the same name carries every test of the first draft's, by full name; the first draft's test fails naming "the load at each run's start and end can't be read"; the redraft's same test passes | The merge base (its lanes have no such entry: each row fails at its first assertion). A redraft that drops or renames a test, gives a made-up run no loads, or an idle run no window; lanes entries that leave the first draft in the unit lane or the redraft out of `timed` |
| `#3300.b2574093` | 2: a redrafted made-up reading whose run 3 starts above the core count reads INCONCLUSIVE, naming the load | `loaded-run`, one row per reading of the issue's table, made by the redrafts' helpers: at rest it reads PASS; with run 3's `loadStart` at 4096 it reads INCONCLUSIVE, its reason matching `load 4096 … cores` | Passes on the merge base (the redrafts are test files, so the base runs them too), so it has a twin: `twins/judge-ignores-loads` (`lines.json` over `benchmarks/canvas-judge.mjs`, `loadsOf` giving every run load 0), on which every row reads PASS where it wants INCONCLUSIVE |
| `#3300.6776e60e` | 3: a lint over tests/acceptance fails a made-up reading handed to `canvas.mjs judge` whose runs give no loads, naming file and line; it lists none once the redraft lands | `lint`, two tests. (a) A scratch checkout with `fixtures/no-loads.test.ts.txt` and `fixtures/with-loads.test.ts.txt` laid as `tests/acceptance/9300/*.test.ts`: the lint lists exactly the line marked `// finding` and exits 1, with no PASS line. (b) Over a scratch checkout holding copies of 854/ and 896/ without `redraft-3300/`, the lint lists each suite at least once, every line a line of the named file, and exits 1; over this checkout it lists nothing under 854/ or 896/ | The merge base's lint (it looks for `judgeLimit` only, so it prints `PASS loads` on both scratch checkouts). A lint that lists the plant that gives the loads, names no line, or doesn't skip a first draft whose redraft has landed |
| `#3300.06b864b2` | 4: on a fit reference Mac both suites pass on main once the redraft lands, each test's line recorded | `fit-mac.long`, by hand (below) | A hand run: the before and trace lanes can't run it, so this criterion stays open in trace until the owner's run is recorded; the PR says `Part of #3300` until then |

The line the lint must name in (a) is the one the made-up reading is written on, which is also the line it is handed to
the judge on (`judged({ …, runs: [...] })`, one line), so a lint that names the reading's run literal and one that names
the judge call agree. In (b) the tests take any line of the suite's files: where the first draft's readings are made
(`synthetic`, `settledReading`, `dirtyReading` in each `helpers.ts`) and where they are judged (the test files) are both
the made-up reading the criterion names.

## Criterion 4, by hand

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3300 fit-mac.long.test.ts
```

On a reference Mac (`scripts/benchmark.mjs` `references`) on mains power, with Low Power Mode off, thermal state
nominal and the one-minute load under the core count, read by `fingerprint()` and `os.loadavg()` before and after each
suite, it runs `tests/acceptance/896/` and then `tests/acceptance/854/` as the lanes run them: the folder with
`--no-file-parallelism`, the first drafts the lanes run by hand only left out (`--exclude`), so the redrafts run in their
place. It prints one line per test (`#3300.06b864b2 <file>: <full name>: <status> <ms> ms`) and a summary. A failed test
fails it; a skipped one ran nothing on this machine, so it is INCONCLUSIVE, never a pass; an unfit machine skips it as
INCONCLUSIVE, naming what is off. It builds release binaries and holds idle windows on screen for minutes: hours in all,
with the Mac to itself. Not run by this job.

## Readings where the issue leaves a choice

1. **Where the redrafts sit.** Criteria 1 and 4 speak of tests "in `tests/acceptance/896/` and `tests/acceptance/854/`",
   so each redraft is a folder inside its suite's folder (`redraft-3300/`), as `311/redraft-ac12/` is, not a sibling
   `854-redraft-3300/`. The lanes' `alone` entries for 854/ and 896/ already cover them.
2. **Which tests "judge a made-up reading".** The issue's list: `settled.test.ts` and `dirty.test.ts`'s two judge tests;
   #854's `patch`, `scene-read`, `idle`, `replica` and `release` judge tests and `replica-redraft.test.ts`'s two
   (`:89–103`). The third of those, `replica-redraft #3`, reads FAIL on its pipelines whatever the loads, so its first
   draft passes at the base too; its row holds the redraft and its lanes entry, not a failure of the first draft.
3. **`release.test.ts`.** After its judging it builds `deep-show` (`cargo build --locked --bin deep-show`), so its row in
   `judge-only` doesn't run the redraft (that is the suite's own lane, and criterion 4's run): it holds the lanes entry,
   the redraft's test names, and the first draft's failure, which comes before the build.
4. **"every made-up idle run a shown window".** `window: { state: 'shown', shown_ms: 60010 }`, the shape #1551's lane test
   makes up; only #854's idle runs, since no other task reads a window.
5. **"the load above the core count".** 4096, as #2870's suite uses: `judgeLimit` reads the cores of the machine that
   judges, so any smaller number could be under some machine's count. The at-rest load is 1, never above any count.
6. **"it lists none once the redraft lands".** Two other suites also hand `canvas.mjs judge` made-up readings whose runs
   give no loads: `tests/acceptance/1492/helpers.ts` (`idleReport`) and `tests/acceptance/1551/lane.test.ts`
   (`shownReading`). On the owner's ruling they are redrafted in this PR the same way, in
   `tests/acceptance/1492/redraft-3300/` and `tests/acceptance/1551/redraft-3300/`, with their `redrafted` and `byHand`
   lines in `scripts/lanes-lists.mjs`. Their originals don't fail on the base: their tests read the energy and the window
   entries, which the loads don't change. The redrafts are there only so that criterion 3's lint lists nothing. This
   suite's lint test still checks "lists nothing" for `854/` and `896/` only (`BASE-FAILURE.txt`, section 6).
7. **#2700's criterion 4.** `tests/acceptance/2700/budgets.long.test.mjs` runs each of the two folders whole, which
   includes the frozen first drafts; it will keep seeing them fail unless it leaves out the files `byHand` holds, as
   `fit-mac.long` does. Noted for #2700, not changed here.

## Files

- `helpers.ts`: tags, `vitestRun`, `lint`, `plant`, `copyFolder`, `lanes`.
- `judge-only.test.ts`, `loaded-run.test.ts`, `lint.test.ts`, `fit-mac.long.test.ts`: the criteria, as above.
- `fixtures/*.test.ts.txt`: the lint's plants, stored as `.txt` so no lane, typecheck or the lint reads them in place.
- `twins.json`, `twins/judge-ignores-loads/lines.json`: criterion 2's planted judge.
- `BASE-FAILURE.txt`: the runs on the base, the twin's run, and the change's run as this job left it.
