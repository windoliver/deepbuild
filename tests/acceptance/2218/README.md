# Acceptance tests for #2218: a spec check's runs, accept and min_tests are read, and a key the hub doesn't read is BLOCKED

Written first and blind, at base commit `b9131dbd9857aefc4dcc39dd0d534d007b1ef671`, from issue #2218 as handed to this
job (`updatedAt` 2026-11-14T21:03:06Z: its account of the bug, Scope, five acceptance criteria and Proof), the design
and the base, before any implementation. The drafting job saw no fix, diff, plan, other branch, other worktree or pull
request, and used no network. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). There is no taste criterion, so no `TASTE.json`.

## What was read

- **The issue**: #2218 (`issue.json`).
- **The design**, `docs/technical-design.md`: How runs become one of five verdicts (the table and its precedence; "a
  check with runs still to come, and nothing it needs missing, is pending until they end"; the run counts, "n =
  ceil(ln(0.05) / ln(1 − p)), p = 10% → 29 clean runs", "a pass and a fail → INCONCLUSIVE"; Check health, "Each run
  records how many tests actually ran"; Pinned to a commit, "each PASS says how many clean runs confirm it"; Whose
  checks count; Protection); What done means, fixed at the start; An agent says it's done; First-party extensions that
  ship on by default (the done-gate row, the `.deepbuild/done.yaml` example with `min_tests`, `runs` and `accept`, and
  "A value nobody declared makes whatever depends on it BLOCKED, and the reason names the value"); and, in How we know
  version 0 works, Dogfooding, Tests written first and Wrong programs.
- **The base code, to learn how to drive it**: `packages/hub/src/mcp-operations.ts` (`checksOf`, which the issue places
  in `core.ts`), `packages/hub/src/stop-judging.ts` (`runClaim`, `specChecks`, `judged`, `outsideOf`),
  `packages/hub/src/gate-runner.ts` (`stop`, `runOwn`, `onBase`, `verdictOf`), `packages/verdicts/src/engine.ts` and
  `runs.ts`, `packages/checks-command/src/` (the runner, its controls and what it calls traced), the schemas
  `verdict.made@2`, `run.started@4` and `run.finished@3`, and `scripts/proof-change.mjs`, `scripts/proof-runs.mjs`,
  `scripts/affected.mjs` and `scripts/lanes.mjs` for the conventions.
- **Sibling suites, for their conventions and helpers**: tests/acceptance/322 (the world, project trust, the hub as a
  process, the session through deep-hook, the record's readers: reused here), 2064 and 2078 (reuse of another suite's
  helpers; `expect` for judgements), 1018 (a check that needs several clean runs) and 2203 (planted wrong programs).

## The surface under test

- **`deep hub run`** (`packages/cli/dist/main.js`) on a temporary HOME, with `DEEP_HUB_TEST_CONFIRM`,
  `DEEP_HUB_TEST_DRAFTS`, `DEEP_HUB_TEST_WORK` and `DEEP_HUB_TEST_GITHUB` as #322 sets them, no plant, and the shipped
  60 s hold.
- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entries, each a child of the session's own
  process (#322's `Session` and `fixtures/agent.mjs`): SessionStart, UserPromptSubmit, PreToolUse and PostToolUse for
  Read and Edit, and Stop.
- **Project trust**, the decision as #348 records it (#322's `trustRepo`).
- **The fixture repo's `.deepbuild/done.yaml`**, the file the issue is about.
- **The record**, through the hub's socket method `events.read`: `claim.made`, `run.started`, `run.finished`,
  `verdict.made` and `ask.created`. A claim's verdict is its last `verdict.made` that isn't pending; its words are that
  event's `reasons` and the `text` of each entry of `why`.

No source file of the code under test is imported or read by a test. Nothing stands in for DeepBuild.

## The scenario

Every test uses #322's shop: a git repo with `src/auth.js`, whose `checkToken` accepts an expired token until the
session's fix. Added here (`helpers.ts`, `shop`): the spec under test, the suite the spec's check runs
(`tests/suite.js`, three node:test tests that pass before and after the fix) and a handed definition of done with one
requirement, R1 "A token that has not expired is accepted", `on_base: passes`, judged by the drafted check
`.deepbuild/checks/valid-token.sh`. The repo is trusted by your decision.

One session types "make the auth middleware reject expired tokens", Reads `src/auth.js`, makes the fix once the
definition has locked, and stops. The stop makes one claim. R1 passes, so the claim's verdict turns on the spec alone:
at the base commit every fixture below is judged PASS, which is what the issue says a hub that drops the key does. The
test waits until the claim has a verdict and no run going, and then until its expected verdict has come or nothing more
has come for it for 45 s (`helpers.ts`, `settled`).

A hub that can't start, a definition that never locks, or a fixture that didn't behave (a suite run that didn't count 3
tests, a turnstile whose first run didn't pass, a run of the always-passing suite that didn't pass) throws an error
starting `BLOCKED`. It is never read as the criterion's failure, and never as a pass.

## Criteria to tests

Each `describe` and test name starts with its criterion's tag, `#2218.` and the first 8 hex of the SHA-256 of the
criterion's text as `scripts/proof-change.mjs` computes it. Every judgement is a vitest `expect`, so a failure is the
framework's own assertion failure, thrown in a file under the test paths.

| Criterion | Test | Fixture spec | What it asserts, in order |
|---|---|---|---|
| AC1 `#2218.21b6bc5c` `runs: 3`, a pass then a fail | `runs.test.ts` (1) | `fixtures/runs.yaml`: `turnstile`, `node --test tests/turnstile.js`, `runs: 3` | the check ran on the claim; the claim's verdict is INCONCLUSIVE; the record holds a run of `turnstile` that passed and one that failed, both on the commit the verdict names; the verdict's words that name `turnstile` say both pass and fail |
| AC2 `#2218.fbc757ce` `accept: 10%` is given 29 runs | `accept.test.ts` (1) | `fixtures/accept.yaml`: `suite`, `accept: 10%` | the check ran on the claim; the record holds exactly 29 runs of `suite` for the claim, every one passed; then the Scope's "the verdict rules count its clean runs against them": no PASS was made on the claim before its 29th clean run ended |
| AC3 `#2218.a145523d` `min_tests: 5` on 3 tests is INVALID, `min_tests: 3` passes | `min-tests.test.ts` (1) | `fixtures/min-tests-3.yaml`, then `fixtures/min-tests-5.yaml` | with 3: the suite's run passed and the claim's verdict is PASS; with 5: the claim's verdict is INVALID, its words name `suite`, and the ones that do name both 3 and 5. In both, each run of the suite counted 3 tests (`run.finished`, `tests_run`), else BLOCKED |
| AC4 `#2218.1a2df3f9` `dedline: 30m` on a check, and a top-level `chekcs:` | `unread.test.ts` (2) | `fixtures/dedline.yaml` (the key on line 12), `fixtures/chekcs.yaml` (the block on line 15) | the claim's verdict is BLOCKED; its words name the key; the ones that do name its line; then the Scope's "with you as owner" |
| AC5 `#2218.cb279bf8` the twin | `twin.test.ts` (1) | this checkout's `.deepbuild/done.yaml`, read when the test runs | every check `claims.done.checks` names ran on the claim and passed; each program the `outside` build names ran; the claim's verdict is PASS |

Scope to tests:

| Scope line | Where |
|---|---|
| `runs` and `accept` reach the claim's check, and the verdict rules count its clean runs against them | AC1, AC2 (its last assertion) |
| `min_tests` is read: fewer tests than it names is INVALID, naming both counts | AC3 |
| A key the hub doesn't read, at the top or on a check, is BLOCKED, naming the key and its line, with you as owner; never ignored | AC4, both tests |
| Not in this task: a version key | nothing asserts one |

### The fixtures

- **The turnstile** (AC1, `fixtures/turnstile.js`). The first run on the fixed tree makes a folder under the world's
  temp folder and passes; a run that finds the folder fails at its assertion. The folder lies outside every checkout,
  so the count holds whichever checkout a run gets and whether runs start one after another or side by side. A
  sandboxed run can write only its checkout and its own temp folder, so the spec lists `turnstile` under `outside` with
  the build `true` (#33's key, which this repo's own spec uses). On a tree that still accepts an expired token, as the
  merge base does, the turnstile is unarmed and passes, so a run on the merge base neither turns it nor reads as an
  inherited failure.
- **The twin's repo** (AC5). The spec's bytes are this repo's. Its commands enter the fixture's own programs:
  `node_modules/typescript/bin/tsc` (`fixtures/tsc.js`, exits 0 for `--noEmit`), `node_modules/vitest/vitest.mjs`
  (`fixtures/vitest.mjs`, loads the node:test files under the folder it is given) and `packages/token/token.mjs` (two
  tests). `npm` and `cargo`, which the `outside` build names, are programs first on the hub's PATH that note their
  arguments and exit 0 (`helpers.ts`, `standIns`). These are tools the repo doesn't own. The hub's reading of the file,
  its runs and its verdict are real.
- **No file a spec check runs is named `*.test.*`.** See Unrelated findings.

## On the base commit

For a fix, the merge base is the wrong program (design: Wrong programs). `BASE-FAILURE.txt` holds the run. On
`b9131dbd` every fixture claim is judged PASS with one run of the spec's check, so:

- AC1 fails at `expected 'PASS' to be 'INCONCLUSIVE'`: "the hub ran turnstile once (passed) and judged the claim PASS".
- AC2 fails at `expected 1 to be 29`: "the hub gave it 1, not 29".
- AC3 fails at `expected 'PASS' to be 'INVALID'`, after its `min_tests: 3` half held.
- AC4 fails twice at `expected 'PASS' to be 'BLOCKED'`: "the hub ignored dedline", "the hub ignored chekcs".
- AC5 passes: no key is refused yet.

Harness-correction rounds: two, neither changing an expected value. The first whole run failed the same five criteria
at the same judgements and passed the twin. After it: the judgements became vitest `expect`s (the first run used
#322's `must`, a plain Error, which the proof lanes don't read as an assertion failure); the fixture's test files
lost their `.test.js` names (Unrelated findings); and AC3's passing half, a test of its own in the first run, where it
passed, became the first half of AC3's one test, as the issue words it ("passes both and fails this test"). After the
second run, which read as the one kept here: AC1's wait ends early only once a run of the turnstile has failed, so an
INCONCLUSIVE made between two runs is not read as the last word; helpers nothing imports lost their exports.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -p deep-hook        # target/debug/deep-hook, which every hook runs
node scripts/throttle.mjs test --wait 120 -- node node_modules/vitest/vitest.mjs run tests/acceptance/2218 --no-file-parallelism --reporter=verbose
node scripts/throttle.mjs test --wait 60 -- node node_modules/typescript/bin/tsc -p tests/acceptance/2218/tsconfig.json
node scripts/affected.mjs tests/acceptance/2218/accept.test.ts tests/acceptance/2218/min-tests.test.ts tests/acceptance/2218/runs.test.ts tests/acceptance/2218/twin.test.ts tests/acceptance/2218/unread.test.ts
```

- Each file starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`), beside
  #322's. The implementer adds it; this job edits nothing outside this folder. Until then `affected.mjs` runs the five
  files in its parallel block.
- Every test makes its folders under `/tmp/dh322-*` (#322's `tempDir`), sets `HOME` to `<tmp>/h` for every process it
  starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. It stops only processes it started, by
  PID (#322's `cleanup`).
- No network, no model, no `claude` binary, no `gh` call.
- On the base each failing test takes about a minute, 45 s of it the wait for anything more to come (AC3, with two
  worlds, about 70 s); the twin takes about 12 s. On a hub that gives the suite 29 runs, AC2 lasts as long as those
  runs do.

## Gaps / assumptions

1. **Who starts the runs a check needs (AC1, AC2).** The tests read the issue and the design as: the hub starts them
   for the claim. The issue says a hub that drops `runs` "runs it once", and the design that "a check with runs still
   to come ... is pending until they end". So AC1 needs the second run on the one claim of one session, and AC2 counts
   29 runs in the record for that claim. At the base a definition's check with `runs` gets one run per claim, and its
   clean runs add up only across claims on one key (#1018's README, note 4; read from `gate-runner.ts`, not run here).
   A fix that carried `runs` and `accept` to the claim's check and started no further run would, by that reading of
   the code, give AC1's claim INCONCLUSIVE for too few clean runs, with no second run, and fail AC1 and AC2. That
   reading was not taken, because no claim would then show "passes on its first run and fails on its second".
2. **"Is given 29 runs" (AC2)** is read as exactly 29 runs of the check in the record for the claim, each passed. Not
   read from any field or wording that states the count a check needs.
3. **"Naming the check as passed and failed" (AC1)** is read as: among the verdict's words (`reasons`, `why[].text`),
   those that name `turnstile` say both "pass" and "fail", in any form and any case. That the pass and the fail are
   real runs of the commit is read from the record, not from the words.
4. **"Naming 3 and 5" (AC3)** is read as: one of the verdict's words that names `suite` holds both numbers as numbers
   of their own (not digits of a longer number, a version or a handle). No wording is asserted.
5. **"Its line" (AC4)** is the 1-based line of the key in the fixture file, read from the fixture's text. Accepted
   forms: `line 12`, `L12`, `done.yaml:12`, `:12:5`, `(12:5)`. The check's key is written in block style so its line
   is its own, not its check's. A column is not asserted.
6. **"With you as owner" (Scope)** has no field in `verdict.made`. It is read as any of: the verdict's data or the
   record of a run of the claim saying the owner is you ("owner you", `"owner":"you"`, "you own", "yours"; the base's
   BLOCKED rows say "owner you"), or an `ask.created` after the stop that names the key. It comes last in each AC4
   test, after the criterion's own assertions.
7. **A claim must exist (AC4).** "Makes the claim BLOCKED" is read as a claim with a BLOCKED verdict in the record. The
   AC4 tests go on to the stop even if the definition hasn't locked within 180 s, since a hub may hold the lock on a
   spec it refuses. A hub that refused the spec with no claim at all would fail them.
8. **"It passes" (AC3)** is read as the suite's run passed and the claim's verdict is PASS.
9. **"Read whole" (AC5)** is read through what a claim shows: the checks the file names run and pass, the `outside`
   build runs, the claim passes. `deadline` and `min_tests: 1` have no reading of their own here (a 30-minute deadline
   can't be shown to bind, and the fixture's `test` check counts 2 tests). The test follows the file: if this repo's
   spec later names a command the fixture repo doesn't hold, the twin needs a redraft.
10. **The definition is handed** (`DEEP_HUB_TEST_DRAFTS`), with one requirement that must not change. The drafting job
    itself is not under test.
11. **Not covered**: a spec check's `runs` or `accept` with a bad value; `runs` and `accept` together; a `min_tests`
    met by some runs and not others; an unread key inside `claims`, `outside`, `environment`, `asks` or `rules`; two
    unread keys in one file; the stop's reply and the verdict line in the chat; the receipt. The issue's criteria name
    none of them.

## Proof limits

- **Not run against a fix.** Only the base was run. That each failing test passes on a correct hub is argued from the
  issue and the design, not shown.
- **AC5 passes on the base by its nature**, so the merge base is not its wrong program. Its wrong program is a hub that
  refuses a key this repo's spec writes: a mutant of the fix's own lines (the mutation lane makes those), or a planted
  twin. This job supplies no `twins.json`: a twin replaces whole product files, and the files the fix changes are not
  known to a blind draft. If the mutation lane reports that AC5's test kills no mutant, a blind redraft adds the twin.
- **`affected.mjs`** was run once on the base, before the last harness correction (`BASE-FAILURE.txt`, second part).
  It chose the five files for its parallel block and printed no WIDE, INCONCLUSIVE or BLOCKED line: five NEW FAIL
  lines for AC1 to AC4, the twin passed. Its other NEW FAIL lines are lint findings on files outside this folder.
- **Machine**: run on a shared Mac at a 1-minute load above 150 on 18 cores. No test here times anything; the waits
  are generous.
- **The turnstile's later runs** were seen on the base only in a throwaway diagnostic, not in this suite: a second
  claim of the same session on a changed tree ran it again, and that run ended `failed` at the turnstile's assertion,
  with its run on the merge base `passed`.

## Unrelated findings

- **Controls can move under a run that shares its checkout (base).** A run plants a control in every `*.test.*` file
  of its checkout and takes it out as it ends. Two checks of one claim run in one checkout at once. In the diagnostic
  above, with the turnstile then named `tests/turnstile.test.js`, one run ended `uncounted`: "the report can't record a
  failure: its control deepbuild control … failed at tests/turnstile.test.js:26, not at tests/turnstile.test.js:28",
  and its claim read INVALID, "turnstile: can't fail". The other run's control had been planted above it and taken out
  before the file was read. Seen once; not chased further. The fixture's files are named `tests/suite.js`,
  `tests/turnstile.js` and `packages/token/token.mjs` so no run plants a control in them.
- **At the base a definition's check with `runs: n` gets one run per claim** (`gate-runner.ts`, `runOwn`), so a lone
  session's claim on it reads "1 of n clean runs" and no further run starts. See Gaps 1.

## Files

- `helpers.ts`: the fixture repo (`shop`), stand-in programs for the twin's build (`standIns`), the hub start with a
  PATH prefix (`startHub`), the session's one turn and the claim read back (`claimed`), and the readers of a verdict's
  words (`wordsOf`, `names`, `counts`, `namesLine`, `lineOf`, `ownerIsYou`). It imports ../322/helpers.ts.
- `runs.test.ts` (AC1), `accept.test.ts` (AC2), `min-tests.test.ts` (AC3), `unread.test.ts` (AC4), `twin.test.ts`
  (AC5).
- `fixtures/`: the specs (`runs.yaml`, `accept.yaml`, `min-tests-3.yaml`, `min-tests-5.yaml`, `dedline.yaml`,
  `chekcs.yaml`), the fixture repo's files (`suite.js`, `turnstile.js`, `valid-token.sh`) and the twin's (`tsc.js`,
  `vitest.mjs`, `token.mjs`). None is a test of this repo's: none is named `*.test.*`.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
