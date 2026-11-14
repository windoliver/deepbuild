# Acceptance tests for #2417: spine judge on a task it can't read

Written first, blind, from the live issue #2417 ("spine judge crashes on a task it can't read: reopen() reads
j.reopen.criterion when reopen is null"), the design and base commit `e5aa3923a` ("Merge pull request #2394 …"), by a
job that never saw an implementation; none existed, and no other branch, worktree or pull request was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per criterion.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2417.47b7983a` | `unreadable.test.mjs` (1): `judge --issue 44` signed out prints #44's JSON line, `BLOCKED` with a why, no TypeError |
| AC2 | `#2417.a410064f` | `unreadable.test.mjs` (1): `judge --issue 44 --issue 47` signed out prints both lines, in order, and exits 1 |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text after `- [ ] `, computed by `readIssue`
from the live issue's body. Each test's name starts with its ID and carries its `AC<i>`.

## What was read

- The issue; `AGENTS.md`; `docs/technical-design.md`: Dogfooding and "Tests written first".
- At the base: `scripts/spine.mjs` (whole), `scripts/proof-change.mjs` (`criterionId`, `readIssue`), `scripts/lanes.mjs`
  and `scripts/affected.mjs` (how a node suite under `tests/acceptance/` is selected), and `tests/acceptance/2144/` for
  the house format.

## How the tests run the CLI

Each test runs the real `node scripts/spine.mjs judge --issue <n>…` in the checkout, with `PATH` set to a temporary
folder holding a `gh` stub, then `/usr/bin:/bin` (for git) and nothing else. The stub exits 1 for every call and
appends its argv to a log. So no test can write to GitHub: no other `gh` is on the child's `PATH`, the harness checks
that `gh` there is the stub before it starts the CLI, and `GH_TOKEN`, `GITHUB_TOKEN` and `DEEP_PROOF_ISSUES` are
unset for the child. With the issue unreadable `judge()` returns before any checkout or build, so each test takes
about 0.2 s (timeout: 120 s). Issues 44 and 47 are neighbours in `node scripts/spine.mjs list`; 44 is the issue's own
reproduction.

## Readings where the issue leaves a choice

- **"its JSON line"**: one line of stdout that parses as JSON with `issue` equal to the task's number; AC1 judges one
  task and expects exactly one line. Other fields (`commit`, `criteria`, `reopen`) aren't read.
- **"with its why"**: `why` is a non-empty string. Its wording isn't read.
- **"never stops with a TypeError"**: stderr holds no `TypeError` and no stack-trace line, and no signal ended the run.
  Other stderr text is allowed (a "wasn't reopened" note, say).
- **Reopening**: the Scope leaves open whether the CLI tries to reopen a task it couldn't read. The tests accept
  either: the stub fails the call and logs it, and the log is asserted only to hold at least one call (the read that
  made the issue unreadable), a harness check.
- **"exits non-zero"**: exactly 1, the CLI's own "exit 0 when every task is PASS, 1 otherwise" (its header). Node also
  exits 1 on an uncaught error, so the status counts only beside the no-crash check and both lines printed.
- **"the next one"**: the next `--issue` named, in `list` order; its line must follow the first's. Under the same
  failing `gh` it is unreadable too, so it also reads `BLOCKED` with a why.

## Run them

```sh
node --test tests/acceptance/2417/unreadable.test.mjs
```

Node built-ins only; no build, no network. Name the file: on node 24 `node --test tests/acceptance/2417/` reads the
folder as a module and fails before any test. `node scripts/affected.mjs --list scripts/spine.mjs` already selects
this file ("parallel node"), since it names `scripts/spine.mjs` by path, so no edit to `scripts/lanes.mjs` or
`scripts/affected.mjs` is needed. The preflight's unit lane doesn't run node suites under `tests/acceptance/` (they run
by hand, as its comment says); making it run this one would be an edit to `scripts/lanes.mjs`, not made here.

## Base results

`BASE-FAILURE.txt` is the one run at the base: 2 tests, both fail, nothing BLOCKED. Each fails on its first assertion,
"the run stopped with a TypeError": stderr is the issue's `TypeError: Cannot read properties of null (reading
'criterion')` at `reopen` (`scripts/spine.mjs:141`), stdout is empty, exit 1, and the stub saw one call
(`issue view 44`).

Since both tests stop at the same assertion on the base, the later assertions were tried on scratch copies of
`scripts/` with one line of the judge loop changed (`BASE-FAILURE.txt`, last section): both shapes of fix the Scope
names pass both tests; a loop that prints the line and stops fails AC2 only, as does one that skips the task and exits
0; one that prints no line, or prints `INVALID` with no why, fails both.

## Not tested, because no criterion reaches it here

The issue's other path to `reopen: null`, a readable issue with no criteria and no `### Parts` lines (`INVALID`): both
criteria name the unreadable issue. Whether a task that does name a criterion is still reopened with its comment
(#33 AC8, `tests/acceptance/33/`). `judge` with no `--issue` (all 25 tasks; the same loop). A `gh` that is missing
from `PATH` rather than failing.
