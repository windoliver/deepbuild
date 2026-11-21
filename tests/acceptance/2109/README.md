# Acceptance tests for #2109: #83 AC11's goldens predate #669's test count

Written first, blind, from issue #2109 (its body as of November 20, 2026: the problem, Cause, Fix and three acceptance
criteria), the bodies of the issues it names (#83's AC11, #669, and #1460's Scope line that moves #83's golden line
through a blind redraft), the design sections below, `AGENTS.md`, and base commit `cb29c46ba8a1454eb4a4f7c3d0f29734444a7bf9`
(main `197e759a9` as it reads without the issue's work), by a job that never saw an implementation; none is in the base.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

A test on main that names a criterion's ID holds that criterion for the closed-issue sweep: `redraft.test.ts` names all
three.

## What was read

- The issue body (no comments), and the bodies of #83, #669 and #1460 (no comments, no pull requests).
- `docs/technical-design.md`: How runs become one of five verdicts (Fail before, pass after; Failing on an assertion);
  The verdict in the chat; How we know version 0 works (Dogfooding, Tests written first, Wrong programs).
- At the base, for surfaces only, never for expected values: `tests/acceptance/83/` (README's criteria table,
  `helpers.ts`'s `AC11`, `redraft-1460/` with its README, goldens, goldens test and BASE-FAILURE.txt, `twins.json`);
  `packages/verdicts/src/line.ts` (the twin's source); `scripts/lanes.mjs` (`alone`, `byHand`, `listed`, the unit lane);
  `scripts/proof-runs.mjs` (`prepareRuns`, `before`), `scripts/proof-guard.mjs` and `scripts/proof-approvals.mjs` (how an
  edit of a tagged test is approved); `scripts/proof-change.mjs` and `scripts/closed-sweep.mjs` (`criterionId`);
  `vitest.config.ts` and `tests/vitest-setup.ts` (the root config the lanes run with);
  `tests/acceptance/2516/unedited-418.test.ts` (a suite's file run through vitest in a child process); the messages a
  golden's world fails with (`crates/deep-hook/src/main.rs`, `packages/hub/src/mcp.ts`).

The criterion IDs, recomputed from the issue body as `criterionId` does (SHA-256 of the checkbox text, trimmed, white
space collapsed): AC1 `#2109.37a6aeb4`, AC2 `#2109.875b4f4e`, AC3 `#2109.dcf2b9e6`; #83's AC11 is `#83.15ee3b42`.

## How to run

With the workspaces built (`npm run build --workspaces`) and `target/debug/deep-hook` built
(`cargo build --locked -p deep-hook`), as #83's goldens need, from the repository root:

```sh
nice -n 10 npx vitest run tests/acceptance/2109 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2109/tsconfig.json
```

- One file, three tests and one shared run: the first test that needs #83's AC11 goldens starts one child vitest over
  every file they're in, and the others read its report. Each golden starts a real `deep hub run` under a fresh
  `/tmp/dh83-*` home with #83's Claude Code stand-in and stops only what it started (#83's README); nothing here reaches
  the network or a model.
- Time: at the base the file took 56 s at load 173 to 217 on 18 cores, 51 s of it the shared run of
  `redraft-1460/goldens.test.ts`'s eight tests; with the twin laid over the base, 94 s at load 203 to 224
  (BASE-FAILURE.txt). On the change the shared run is the redraft's goldens; #1460's redraft recorded 7 s for its eight
  at load about 100.
- The child run's limit is 15 minutes, inside the proof lanes' 20; past it the child is stopped by its PID (SIGTERM, then
  SIGKILL a minute later) and the tests waiting on it read INCONCLUSIVE.

## The surface under test

Named by the issue or the base, used as they define them:

- `tests/acceptance/83/redraft-669/`, its `README.md` and `BASE-FAILURE.txt`; `tests/acceptance/83/redraft-1460/goldens.test.ts`.
- #83 AC11's tests and their names: `AC11 #83.15ee3b42 <name>: <state>…`, one per golden, and the goldens file's last
  test, `AC11 #83.15ee3b42 (wrong program) …` (`tests/acceptance/83/helpers.ts`, `redraft-1460/goldens.test.ts`). The six
  names are the issue's: `PASS`, `BLOCKED`, `sent back`, `checks running`, `long cause`, `says done`.
- `scripts/lanes.mjs`: `alone` (the unit lane runs `tests/acceptance/83/` one file at a time, from the repository root
  with the root `vitest.config.ts`), `byHand` (files no lane runs) and `listed`, read through the module itself.
- vitest's JSON reporter: each test's file, title, status and failure messages.

Defined here, where the issue and the design leave a surface open:

- *(chosen)* **The redraft's test files**: every `*.test.ts` under `tests/acceptance/83/redraft-669/`, at any depth, less
  `twins/`, `fixtures/` and `node_modules/`.
- *(chosen)* **The AC11 files main runs**: the test files under `tests/acceptance/83/` whose source names `AC11` or
  `#83.15ee3b42`, less those `listed(byHand, file)` holds. At the base that is `redraft-1460/goldens.test.ts` alone.
- *(chosen)* **The shared run**: `node node_modules/vitest/vitest.mjs run <both sets of files> --no-file-parallelism
  --reporter=json --outputFile <temp file>` from the repository root, with this run's environment less every `VITEST*`
  and `GIT_*` variable, `NODE_ENV`, `TEST` and `FORCE_COLOR`, and with `NO_COLOR=1`. It prints each AC11 test's status
  and time, the load at its start and end, and each failure's first line.
- *(chosen)* **A golden, by name**: a test whose title starts `AC11 #83.15ee3b42 <name>:`; **the wrong-program check**: a
  test whose title starts `AC11 #83.15ee3b42 (wrong program)`.
- *(chosen)* **"The dispute"**: a Markdown heading line (`#` to `######`) whose text starts `The dispute`.
- *(chosen)* **Failed by its world** (Readings, 7): a failure whose first line starts `BLOCKED` or `INCONCLUSIVE` (after an
  optional `…Error: `), or whose message holds `hub is unreachable`, `sync didn't finish within the hook's` (deep-hook's
  Stop spooled with no reply in its 50 ms, so no line was shown) or `Test timed out in` / `Hook timed out in`.

## Criteria to tests

All three tests are in `redraft.test.ts`.

| ID | Criterion (short) | Test | Fails at the base, and on |
|---|---|---|---|
| AC1 `#2109.37a6aeb4` | `tests/acceptance/83/redraft-669/` holds the blind redraft, with a README that has "The dispute" and a BASE-FAILURE.txt | The folder is there; its `README.md` has a heading "The dispute"; its `BASE-FAILURE.txt` isn't empty; it holds a test file; in the shared run, that file's tests are named under AC11's ID for each of the six goldens and the wrong-program check | the base: no folder. No twin (Wrong programs) |
| AC2 `#2109.875b4f4e` | On main with #1460, all six AC11 goldens pass, and so does the wrong-program check | The redraft's six golden tests and its wrong-program test are each `passed` in the shared run; one missing, skipped or failed on its own assertion fails the test, naming it | the base: no redraft test file; twin `count-dropped` |
| AC3 `#2109.dcf2b9e6` | With the owner's approval the redraft replaces `redraft-1460/goldens.test.ts`, so no AC11 golden fails on main | `redraft-1460/goldens.test.ts` isn't among the AC11 files main runs (removed, or kept by hand); the AC11 tests main runs hold the six goldens and the wrong-program check from `redraft-669/`; every test under AC11's ID that main runs passed. The owner's approval isn't asserted here (Readings, 6) | the base: `redraft-1460/goldens.test.ts` still runs, its goldens that read a finished run fail on their lines, and none comes from `redraft-669/`; twin `count-dropped` |

## Wrong programs

- **`count-dropped`** (`twins/count-dropped/packages/verdicts/src/line.ts`; AC2 and AC3 in `twins.json`): the base's
  `packages/verdicts/src/line.ts` with one line changed, so #669's test count is never shown and the line reads as #83's
  goldens and their #1460 redraft were written for. A redraft for #669's count fails on it: on the change, its goldens
  that carry the count fail on their lines, so AC2 and AC3 fail at their assertion. Its header names the plant. A twin
  is a whole file: if main's `line.ts` changes, the twin is the base's copy and may need the same one-line change laid
  on the new file (a dispute for a redraft of this job, never an edit of it).
- **AC1 has none.** Its wrong program is a folder, README or BASE-FAILURE.txt missing or short, all under the test paths,
  which a twin may not replace; and the proof lanes' before lane lays the change's test paths over the merge base, so
  the folder is there on both. AC1 fails only where the folder is absent, as at this base (BASE-FAILURE.txt); on a
  change that adds the folder the before lane can't prove it, and that base run is its proof.
- The redraft's own wrong-program check, and #83's AC11 twins (`keeps-whole-cause`, `dot-dropped` in
  `tests/acceptance/83/twins.json`), stay #83's; this suite reads the first and doesn't run the others.

## Readings where the issue leaves a choice

1. **"Holds the blind redraft"** (AC1): a folder whose test files hold #83 AC11's tests, named under its ID for each of
   the six goldens and the wrong-program check, as #83's and #1460's goldens files name theirs. The redraft's expected
   values are its blind job's; this suite asserts none of them. Of the Fix's "keeps each golden's id, title and steps,
   and moves only what the count changes" it asserts the ID and each golden's name; that the goldens move with the
   count is what the twin checks, since a redraft for the count fails on a line without it. Blindness can't be seen in
   a checkout.
2. **"The wrong-program check"** (AC2): the goldens file's own `AC11 #83.15ee3b42 (wrong program) …` test (the last in
   #83's goldens file and in #1460's redraft), which must pass. Not the proof lanes' run of #83's AC11 twins.
3. **"All six AC11 goldens pass"** (AC2): the redraft's six golden tests, each `passed` in vitest's report of one run from
   the repository root with the root config, one file at a time, as main's unit lane runs `tests/acceptance/83/`.
   "On main with #1460" is the checkout the suite runs on; nothing about #1460 is asserted beyond the goldens passing.
4. **"Replaces `redraft-1460/goldens.test.ts`"** (AC3): main no longer runs that file: it is removed, as #1460's swap
   removed `tests/acceptance/83/goldens.test.ts`, or kept as written and run by hand only, listed in `byHand` in
   `scripts/lanes.mjs`, as the lanes keep other replaced first drafts. And the AC11 goldens main runs come from
   `redraft-669/`. Editing it in place would edit an existing acceptance test, which the issue rules out.
5. **"No AC11 golden fails on main"** (AC3): every test named under AC11's ID in the AC11 files main runs passes (the
   goldens, the wrong-program check and any other), and the six goldens are among them, so an AC11 with no goldens
   doesn't pass by having none to fail.
6. **"The owner's approval"** (AC3): a signed tag under `refs/tags/deep/approved/` on the commit that removes or retires
   `redraft-1460/goldens.test.ts`, naming it (`Approves: tests/acceptance/83/redraft-1460/goldens.test.ts`), which the
   proof lanes' guard (`scripts/proof-guard.mjs`) checks on the change, as it checks any edit of a tagged test or of
   `scripts/lanes.mjs`. A test can't see it: the tag lives on the change's commits, the lanes run tests in copies with
   no `.git`, and a README saying the owner approved is an agent's word, never evidence (invariant 1). This suite
   doesn't assert it; the guard lane holds that leg.
7. **A golden that failed by its world judged nothing.** Under this Mac's load a golden can fail before its line is read:
   #83's helpers throw `BLOCKED: deep_claim must answer with the claim's handle: … The DeepBuild hub is unreachable …`,
   or the Stop hook spools and prints no line (`deep-hook: spooled <id>, but its sync didn't finish within the hook's
   50 ms`, a budget no test sets), or a test outlasts its timeout. Such a failure is neither PASS nor FAIL: when every
   other test a criterion reads passed and some failed only so, the criterion reads INCONCLUSIVE, naming them, thrown as
   a plain `Error` so the before lane never takes it for a failure at an assertion. A test that failed on its own
   assertion fails the criterion even beside them; a skipped or missing one is a failure, never a pass.

## Legs that read BLOCKED or INCONCLUSIVE

- The shared run writes no report (vitest missing, or crashed before any test): every test that reads it is BLOCKED,
  naming the child's exit and the end of its stderr.
- The shared run outlasts 15 minutes: stopped by its PID; every test that reads it is INCONCLUSIVE.
- Goldens that failed by their world, with nothing else wrong: AC2 or AC3 reads INCONCLUSIVE (Readings, 7).
- Not asserted here: the owner's approval (Readings, 6), held by the guard lane on the change.

## What the implementer adds outside this folder

- `'tests/acceptance/2109/'` in `alone` in `scripts/lanes.mjs`: this file runs #83's hub-starting goldens in a child
  vitest, so it runs one file at a time, as `tests/acceptance/83/` does.

The redraft, the swap and the owner's approval of it are the issue's work, not this suite's.

## Files

- `redraft.test.ts`: AC1, AC2 and AC3, and the shared run they read.
- `twins.json`, `twins/count-dropped/packages/verdicts/src/line.ts`: the planted wrong program for AC2 and AC3.
- `tsconfig.json`: the type-check (twins left out: a twin's imports resolve only where it is laid).
- `BASE-FAILURE.txt`: the run at the base and the run with the twin laid over it, each test's first failing assertion,
  the times and the load.
