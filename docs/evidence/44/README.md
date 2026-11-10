# #44 re-judged: evidence for this change

#44 closes on its parts (#348 to #351), each part's line its criterion. `scripts/spine.mjs` re-judged it at its
merged commit 5a6d09a4 as FAIL on #348, #350 and #351. This change fixes what fails on main for reasons outside
those parts' own work. Everything here ran on the Spark (Linux arm64, Node 24.22.0); the parts' suites are written
for macOS, and what only the Mac can show is listed as open.

## What failed, and why

Judged with a local copy of `scripts/spine.mjs` that doesn't reopen issues, prints each part and each non-PASS
test, copies node_modules with `cp -a` (its `cp -cR` is macOS's clone), and points #44's row at the commit judged.

| Part | Failing test on main 6042ef5a | Cause | Here |
|---|---|---|---|
| #349 AC5 | the published contract passes the preflight's slot check | #65's channel@1 kit: fills that answer with promises, and no planted fill for answers-in-shape | fixed: `349-ac5-before.txt`, `349-ac5-after.txt` |
| #350 AC9 | (wrong program) a host that stops B first fails | the plant's process stop unloads B at once through its connection's close, so the twin usually reads missing, not through a stopped B: 3 of 10 runs failed | fixed: `350-ac9-twin-before.txt`, `350-ac9-twin-after.txt` (0 of 10) |
| #351 AC1 | the guide's drift test | #66 published `deep.work.fetch` with no guide entry | fixed on main by #1731 |
| #351 AC1 | the JSON-RPC example passes conformance | Linux only: the Python package's connection closes in bwrap | open: needs the Mac |
| #348 AC4, AC5, AC6 | the Python package loads sandboxed; the sandboxed process is the supervisor's | Linux only: bwrap's pid is tracked, not the child's; the Python connection closes | open: needs the Mac |
| #349 AC5 | environment@1's planted leaves-grandchild | Linux only: lsof can't read the environment's ports here | open: needs the Mac |
| #348 AC8 | the perf lane has an extension-host task, valid against the merge base's budgets | the test runs `git merge-base HEAD origin/main`; the spine's checkout is a `git archive` with no `.git`, so it fails on every machine (it passes in a worktree) | open: a decision (redraft, or the spine judging with git history) |
| #348 AC8 | the timed budget | BLOCKED off a reference Mac, by design | open: needs the reference Mac |

#350 passed whole at main on two of three judge runs here; its only failure was the flaky twin above.

## Regression check

`node scripts/affected.mjs` on the kit change selected about 900 files (conformance is a core package): 503 failures
it called new against `scripts/known-failures.json`, which lags main. Every test file among them, run again on this
branch and on main 6042ef5a side by side: 309 and 311 failures of 729, the same set but for three load flakes that
passed alone on both (`tests/acceptance/1097/warn.test.ts`, `tests/acceptance/1106/ca.test.ts`). The repo-wide
lint lines (secrets, deps, canvas-lint, cards, record reader) name files this change doesn't touch.
`tests/acceptance/65` and `packages/conformance/src` fail the same 29 tests on both (hub start and sandbox on Linux).
`packages/extension-host` fails the same 2 on both.

## The judge on this change

`spine-judge.txt`: #350 PASS; #349 AC5, #351 AC1 and #348 AC4 to AC6 fail only on the Linux-only causes above;
#348 AC8 reads FAIL on its archive-checkout test and BLOCKED on its timed budget.

## On the rewritten main

main's history was rewritten after this change was first judged, so it was replayed onto main d51be2c3 with no
conflicts; the changed lines are the same. On the rewritten main (96b462a6), `tests/acceptance/350/ac9-redraft` passed
10 of 10 runs, and `node scripts/conformance-lint.mjs` passes `slot kit channel@1: 3 rules, each refusing its one
planted fill`. Its two FAIL lines aren't this change's: environment@1's lsof (Linux only, above) and
`doctor service_unpromoted maps to no verdict`, from #1334 on main.

`node scripts/affected.mjs` there: 491 failures it called new, 537 inconclusive or blocked (58 timed and 34 slow files
unrun), 2163 passed, at load 4. Of the new ones, 318 are repo-wide lint lines (deps, secrets, canvas-lint, vendor,
cards, drift, record reader) naming files this change doesn't touch, and the slots line for `deep.registerSource`, a
slot main added with no kit. The 173 test files among them, run on this branch and on main d51be2c3 side by side, fail
alike: the files that differed once (`tests/acceptance/1033`, `30`, `325`, `340/flow`, `344`) failed on both sides,
or on main alone, when run again.
