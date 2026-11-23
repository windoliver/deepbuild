# Acceptance tests for #2256: benchmarks/canvas.mjs parses, and its judge prints a judged line

Written blind at base commit `e2bdc8ae0ba5edab340b85a54d676a3a6e22b049` (main `e575a47af` as of 2026-11-20 with the
issue's bug present), from the issue, the design and that base. By the brief, #2256's fix is on main, and #2047's
closed-issue sweep reopened the issue because no test on main names its criterion's ID. This folder is that suite's
blind redraft (design: Dogfooding), drafted from the same inputs, and its tests name the ID. The drafting job saw no fix, no earlier suite for
the issue and no test of the fix; it read no other commit, branch, worktree or pull request, and nothing on GitHub. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job. There is
no taste criterion.

## Sources

- **The issue**, #2256, its body as the brief gave it: the title, the account of the bug (the SyntaxError, the lost
  `  }` and `};`, the two lines to restore), the one criterion and Depends on; and the sweep's comment naming
  `#2256.6bb42fca`.
- **The design**, `docs/technical-design.md`: in How we know version 0 works, Criteria to tests, both ways; Closed
  issues stay proven; Criteria in a checked shape; Wrong programs; Dogfooding; Tests written first. The five verdicts
  come from How runs become one of five verdicts.
- **AGENTS.md.**
- **The base, for surfaces only**: `benchmarks/canvas.mjs` (its dispatch, `judge`, `EFFICIENCY`, `CLASS_LIMITS` and
  `judgeEfficiency`), `benchmarks/budgets.json` (the tasks that run the bench, and `canvas-look-frames`),
  `benchmarks/physics.mjs` and `benchmarks/archive-growth.mjs` (their judges), `scripts/benchmark.mjs` (`judgeTargets`,
  `judgeLimit`), `scripts/perf.mjs` and `scripts/budget-window.mjs` (how each reads a judged line),
  `scripts/proof-change.mjs` (`criterionId`, the test paths, tags), `scripts/closed-sweep.mjs`, `scripts/proof.mjs`,
  `scripts/proof-runs.mjs` and `scripts/proof-reporter.mjs` (the before lane, twins, a failure at its assertion),
  `scripts/proof-binaries.mjs`, `scripts/lanes.mjs` (`alone`, `slow`, `timed`, the unit lane), `scripts/affected.mjs`,
  and the lints a new file meets (`size-ratchet.mjs`, `wait-ratchet.mjs`, `repo-rules.mjs`, `public-text.mjs`). For
  the house format: `tests/acceptance/2227/`, `2047/` and `1874/`; for how other suites read a judged line,
  `tests/acceptance/1492/helpers.ts` and `1551/lane.test.ts`. Glanced at for context only: `docs/evidence/1874/README.md`
  (its note on #2256), `scripts/budget-table.mjs` and `benchmarks/windows/numbers.md` (where `canvas-look-frames` is
  named), `tests/acceptance/417/`, `417-redraft-1830/`, `1831/` and `2870/` (how they run the bench), and the root
  `tsconfig.json` and `package.json`.

## Run

```sh
node --test tests/acceptance/2256-redraft-2047/ac1-canvas.test.mjs
```

Node 24 and the checkout, Node built-ins only: no `npm ci`, no build, no binary, no network. Two tests, each running one
short `node` process from the checkout's root. On the base, at a one-minute load of 345 to 365 on this shared Mac, each
test took 1 to 2 s and the file about 4 s (BASE-FAILURE.txt). Each command is bounded at 2 minutes: one that can't start,
overruns or is killed by a signal fails its test with a plain error starting `INCONCLUSIVE:`, never at an assertion, so
it never counts as a wrong program's failure. The tests write nothing and leave the checkout as it was.

## The surface

The criterion names two commands, run from the repository's root, and what each must give. What it leaves open is
marked *(chosen)*.

- **`node --check benchmarks/canvas.mjs`**, as written, by the Node that runs the suite (`process.execPath`)
  *(chosen)*, from the root of the checkout the test file sits in. The observable: its exit code.
- **`echo '<report>' | node benchmarks/canvas.mjs judge`**: the same `node`, with the report exactly as the criterion
  writes it on stdin, then a newline, as `echo` writes it, given through the child's stdin rather than a shell
  *(chosen)*. The observable: its exit code and its stdout.
- **A judged line** *(chosen, from the base's own readers of a judge)*: the judge exits 0 and its last non-empty stdout
  line is a JSON object whose `status` is one of the five verdicts, PASS, FAIL, BLOCKED, INVALID or INCONCLUSIVE. That
  is the line the perf lane and the budget window read: `judgeTargets` in `scripts/benchmark.mjs` pipes
  `{"current": <report>, "base": null}` into `<bench> judge`, reads an exit other than 0 as BLOCKED ("the judge
  exited …") and otherwise takes the last stdout line as the verdict, whose `status` `scripts/perf.mjs` and
  `scripts/budget-window.mjs` read. Every judge at the base (`canvas.mjs`'s for classes and for efficiency tasks,
  `physics.mjs`'s, `archive-growth.mjs`'s) prints one such line.
- **"Instead of a SyntaxError"**: a file that doesn't parse runs nothing, so it prints no judged line. Each failure
  message quotes the command's stderr, so a SyntaxError shows there.
- The children get the suite's environment less `NODE_OPTIONS` and `NODE_TEST_CONTEXT` *(chosen)*. Messages print the
  checkout's path as `<checkout>` and leave out every line of a quoted output that reads as a stack frame, since the
  proof lane places a failure by the first frame in its stack, message included.

No test imports the bench; each runs it by the commands the criterion names.

## Criteria to tests

The ID is `#2256.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs` and `scripts/closed-sweep.mjs`), computed here from the body as given; it
matches the sweep's comment. The criterion has two parts, one test each; both carry the ID.

| ID | Criterion | Test (`ac1-canvas.test.mjs`) | What it asserts | Wrong program it fails on | On the base |
|---|---|---|---|---|---|
| `#2256.6bb42fca` | AC1, first part: `node --check benchmarks/canvas.mjs` exits 0 on main | `AC1 #2256.6bb42fca node --check benchmarks/canvas.mjs exits 0` | the exit code is 0 | the base; the twin `unparsed` | **fails**: exit 1, `SyntaxError: Unexpected reserved word` at `await workloads[task]();`, line 2069 |
| `#2256.6bb42fca` | AC1, second part: the issue's report piped to `node benchmarks/canvas.mjs judge` prints a judged line instead of a SyntaxError | `AC1 #2256.6bb42fca the issue's canvas-look-frames report piped to node benchmarks/canvas.mjs judge prints a judged line instead of a SyntaxError` | an exit of 0, and the last stdout line a JSON object whose `status` is a verdict | the base; the twins `unparsed` and `judge-throws` | **fails**: exit 1, nothing on stdout, the same SyntaxError |

## The wrong programs

- **The base.** At `e2bdc8ae0`, `benchmarks/canvas.mjs` has lost the `  }` and `};` that end
  `workloads['many-lamps']`, just before the `// #501: 32 looping voices` comment. Everything after it, the closing
  dispatch included, sits inside that arrow function, so the top-level `await workloads[task]();` at line 2069 lands
  inside a function that isn't async. Both tests fail there at their assertion (BASE-FAILURE.txt).
- **The twin `unparsed`**, for the proof lane, where main is the merge base and holds the criterion:
  `twins/unparsed/benchmarks/canvas.mjs` is a 27-line bench with the issue's defect. Its first workload lost its two
  closing lines (marked), so its dispatch's `await` lands inside a function that isn't async, and Node stops on the
  same `SyntaxError: Unexpected reserved word`. With the two lines put back it parses and its judge prints a judged
  line. Both tests fail on it at their assertion.
- **The twin `judge-throws`**: `twins/judge-throws/benchmarks/canvas.mjs` parses, so the first test passes on it, but
  its judge prints no judged line for the issue's report. Like the base's judge, it holds to targets only the tasks its
  `EFFICIENCY` names and reads any other report as a budget class's; its `EFFICIENCY` names no `canvas-look-frames`
  and the report names no class, so it throws `Unknown class undefined`, exits 1 and prints nothing. The second test
  fails on it at its assertion. It shows that test holds the judged line, not only the parse.

`twins.json` maps the ID to both. Each twin replaces only `benchmarks/canvas.mjs`, whole, and imports nothing from the
checkout, so laid over a later main it is still the same wrong program.

## Readings where the issue leaves a choice

- **"On main"**: the tests judge the checkout they run in. On main that is main.
- **The issue's line numbers and workload.** `benchmarks/canvas.mjs:1305` and `workloads.occlusion` (line 1275 at
  `6ab0ed376`) are an older main's. At the base the error is at line 2069 and the lost lines end
  `workloads['many-lamps']`. The tests read neither; they read the exit code and the judged line.
- **Which verdict.** The report has no runs, so nothing was measured, and by the design's second invariant that can't
  read PASS; the criterion names no verdict, so the test asserts only that the line holds one. Nor does it hold which
  task or class the line names.
- **What the judge does with this report is not set by the issue.** At the base, `canvas.mjs`'s `EFFICIENCY` has no
  entry for `canvas-look-frames`, so its judge sends this report to the class path, which throws `Unknown class
  undefined` on a report that names no class; the twin `judge-throws` is that judge. A checkout whose bench parses but
  keeps that judge fails the second test: the criterion asks for a judged line.
- **The 34 tasks.** At the base, 62 tasks of `benchmarks/budgets.json` run the bench. The criterion asks that the file
  parse and that its judge print a judged line, not that those tasks run, so no test runs them.

## Lanes

No `scripts/lanes.mjs` entry is needed. `alone` lists Vitest files the unit lane runs one at a time; this suite is
`node:test`, and node suites under `tests/acceptance/` run by hand, through `scripts/affected.mjs` (the test file names
`benchmarks/canvas.mjs`, so a change to the bench selects it) and in the proof lanes. It isn't `slow`: the file runs in
seconds, against a bar of two minutes. It isn't `timed`: its verdict reads neither the load nor a clock, the report it
pipes has no runs, and the test holds only that a verdict line comes, not which one.

## Files

- `ac1-canvas.test.mjs`: the two tests.
- `twins.json`, `twins/unparsed/` and `twins/judge-throws/`: the planted wrong programs.
- `BASE-FAILURE.txt`: the run on the base, then each twin laid over the base's bench, then a stand-in that parses.
