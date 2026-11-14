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

## End to end, with screenshots

`e2e/`: the guide's two worked examples walked through the real host, as the guide says to (build the folder, install
it, run its conformance, load it, run its check on each spec in its `example.json`), then the guide's drift test. The
script is `e2e/walk-through.test.ts.txt`, a scratch file run as `tests/acceptance/351/zz-e2e-demo.test.ts` with
`node node_modules/vitest/vitest.mjs run --root tests/acceptance/351 zz-e2e-demo --reporter=verbose` and never
committed as a test. It prints what the host returned, then asserts it, so a wrong answer fails after showing it.
Both runs are at 284a5852, #2250's head: this change (2b05d52d) plus #2147's library kit and guide entry, which is
why the drift line counts 16 slots.

| File | What it is | What it shows |
|---|---|---|
| `e2e/mac-e2e.png`, `e2e/mac-e2e.txt` | A Terminal window on the reference Mac (darwin 23.6.0 arm64, Python 3.10.11), taken live, title bar cropped off; and its captured text | 4 of 4 passed. Both examples: conformance passed, loaded with `place: sandbox`, check `passed`/2 on the in-checkout paths and `failed`/3 naming `../secrets.env` and `/etc/hosts`. `PASS guide`. |
| `e2e/linux-e2e.png`, `e2e/linux-e2e.txt` | A rendering of captured text, not a window (Linux arm64, Python 3.12.3). The text has its checkout path replaced by `<checkout>`, and the `$` command line and `exit 1` written around vitest's output | 3 of 4 passed. The TypeScript example and the drift test as on the Mac. The JSON-RPC example **fails conformance**: "its code didn't register in the platform sandbox: the connection closed". |

What the pictures don't show:
- The Mac picture has no command line or exit code; the command is the one above, and the run ends "Tests 4 passed (4)".
- "its process: pid" lists the pids the supervisor recorded (`process.tracked`) for the load's run. That shows the
  supervisor started a separate process for the package; it doesn't name the program or show it confined. Confinement
  is `tests/acceptance/348`'s to prove (AC5, AC6), which pass on the Mac.
- The check compares path strings, so `failed`/3 is the example's own answer through the host, not the sandbox
  refusing a read.
- The commit line sees changes to tracked files only.
- The examples' digests differ between the machines: the build stamps the folder after pointing `main` at the
  machine's interpreter, and the digest counts file modes.

The JSON-RPC example on Linux: #351 AC1 is unproven there. The cause isn't in the picture. From the code, the host
grants a `main`'s interpreter only when its install folder is at least three levels deep (`interpreter()` in
`host.ts`), and this machine's `python3` installs under `/usr`; not tested with another Python. This change
doesn't touch `interpreter()`.

Checked by separate agents, twice. The first check found the script asserted nothing (a failing example still showed
a tick), printed the test's own pid as the hub's, and the Mac pictures lacked the commit and showed a user name; the
script and pictures were redone. The second check found no mismatch between either picture and its text and no
personal data, and asked for the limits listed above to be stated.
