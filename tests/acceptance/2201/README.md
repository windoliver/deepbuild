# #2201 acceptance tests: tests/agent-eval.test.mjs passes on main

Written first and blind at base `331b68be1`, from issue #2201, the design and the base, before any fix. The drafting job
saw nothing of the fix: it read no other branch, no other worktree's source and no pull request. Per AGENTS.md the
implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

**Read:** AGENTS.md. In `docs/technical-design.md`: How we know version 0 works (Skill and schema hygiene; Criteria to
tests, both ways; Criteria in a checked shape; Wrong programs; The edit guard) and Failing on an assertion. At the base:
`tests/agent-eval.test.mjs`, `scripts/agent-eval.mjs`, `scripts/skill.mjs`, `skills/deepbuild/SKILL.md`,
`packages/hub/tools.json`, `packages/hub/package.json`, `tests/skill.test.mjs`, #26's recorded run
(`tests/acceptance/26/fixtures/eval/run.json`), the head of its `scorer.test.ts` and the scorer lines of its README,
who reads `tools.json` (`packages/hub/src/tools.ts`, `packages/pi/tools.mjs`), the proof lanes (`scripts/proof.mjs`,
`proof-runs.mjs`, `proof-change.mjs`, `proof-reporter.mjs`, the test paths and the unit lane in `lanes.mjs`, the heads
of `repo-rules.mjs` and `known-failures.json`) and, for their shape, `tests/acceptance/2256/`, `2028/README.md` and
`1113/`.

**Run:**

```sh
node --test tests/acceptance/2201/agent-eval.test.mjs
```

Plain `node:test` and Node built-ins, as `tests/acceptance/2256/`: no install, no build, no network. Three tests, about
three seconds. The unit lane's `tests/*.test.mjs` doesn't pick the file up. It runs from any working folder and finds
the checkout from its own place. It writes only to a temporary folder, which it removes.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`. Twins are in `twins/` (its README).

| Criterion | ID | Test | Wrong programs it fails on |
|---|---|---|---|
| `node --test tests/agent-eval.test.mjs` passes on main. Today it fails with six reasons. | `#2201.85a64726` | The issue's command, run in the checkout, exits 0 with a test that ran and passed and none skipped | The base: exit 1 with the tool mismatches. The twin `tools-by-hand` |
| A skill pinned to another version still fails it, naming both versions, as the test's second half asserts. | `#2201.e1d48ffc` | The recorded run with its skill pinned to another version, scored by `node scripts/agent-eval.mjs score`, exits 1 with one reason, `skill_version_mismatch`, whose detail names that version and the installed one. Then the real test, run on a scorer that ignores the pin, fails, and what it expected names a pinned version and the installed one | The base: the test stops at its tool mismatches, so its second half asserts nothing. The twin `names-one-version` |
| A tool added to the tool list and the skill needs no edit to this test. | `#2201.e938bd0d` | In a copy, a made-up tool added to the skill alone fails the test, which names it. Added to `packages/hub/tools.json` too, the test passes, its bytes the checkout's | The base: the hand list lacks the tool. The twin `tools-by-hand` |

On the base all three fail at their assertions (`BASE-FAILURE.txt`). Each message carries the child's command, its exit
code and its output. In the `before` lane the merge base holds the change's test files, the fixed test among them, so
all three pass there and are proven on their twins. The two twins cost the lane a copy and a workspace build each.

## How the tests reach the code

- **The test file** is run as the issue runs it: `node --test tests/agent-eval.test.mjs`, a child process, with
  `NODE_TEST_CONTEXT` dropped so it doesn't report to the runner around it. Nothing imports it or the scorer.
- **The scorer** is run by its own command, `node scripts/agent-eval.mjs score <run.json>` (its header; #26's README).
- **The copy** (the second and third tests) holds the six files the test reads, byte for byte: the test, the scorer,
  the skill, `packages/hub/tools.json`, `packages/hub/package.json` and #26's recorded run. A fixed test that reads any
  other file fails there, by assertion, with the child's error in the message.
- **Planted in test code** (the second test): a scorer that ignores the pin. It is the copy's own scorer, wrapped, with
  the `skill_version_mismatch` reason left out. It shows that the test file itself still asserts the pin. No twin can
  show that, since no twin may replace a file under the test paths.

## Where the issue is silent, or differs from the base

1. **Seven reasons, not six.** At `331b68be1` the test fails with seven: `deep_root_plan` joined the skill after the
   issue was written, so the skill names fifteen tools. The first test counts no reasons. The criterion's words decide.
2. **"Passes"** is exit 0 with at least one test that ran and passed, and none skipped or left to do. A file with its
   test skipped or removed exits 0 too, and nothing unrun passes (AGENTS.md, invariant 2).
3. **"Fails it"** in the second criterion is read as failing the score of the test's recorded run, which is what the
   test's second half asserts: one reason, `skill_version_mismatch`, with the detail
   `the skill is pinned to <that version>, not the installed <installed>`. The run is built as the issue's Scope
   builds it: #26's recorded run, the skill as its text, the tools `packages/hub/tools.json` names as its tool list.
   The installed version is read from `packages/hub/package.json` at run time, and the other version is any that
   differs.
4. **"As the test's second half asserts"** is held on the test file: on a scorer that ignores the pin, the test must
   fail and name both versions in what it expected. A fix that drops the second half, or loosens it to the reason's
   code alone, fails here.
5. **"The tool list"** is `packages/hub/tools.json`, an object keyed by tool name, as `scripts/skill.mjs` writes it.
   **"The skill"** is `skills/deepbuild/SKILL.md`. The tool is added to copies of both by hand, in the shape the
   generator writes. The generator and its table in the design are not run.
6. **The Scope's second bullet** is held in the third test: the tool added to the skill alone must fail the test with
   `the skill names <tool>, which the live tool list lacks`, the scorer's words as the issue quotes them. A test that
   takes its run's tools from the skill's own text fails here.
7. **No tool name or count of today's** is in the test file. The made-up tool is `deep_made_up`, lengthened until
   neither file names it; the scorer's pattern reads it as a tool, which the third test's first half shows.
8. **The twins are scorers**, though the Scope says the scorer does not change: a twin is a planted wrong program, not
   a change, and the test file can't be one (`twins/README.md`).
9. `scripts/known-failures.json` and the unit lane are not tested here: no criterion names them. The issue's Proof,
   the test's run on main before and after, is `BASE-FAILURE.txt` for before; after is the change's own run.

## What the drafting job ran, and what it did not

Ran, with Node 24.22.2:

- **At the base, in the checkout:** the Run command. 3 tests, 0 pass, 3 fail, each at an assertion in this file
  (`BASE-FAILURE.txt`). Again from `/` with the file's absolute path: the same. After both, `git status --short` showed
  only `tests/acceptance/2201/`, and no temporary folder was left.
- **On a fix of its own,** in a scratch folder outside the repository: a copy of the six files and this suite, the
  hand list replaced by the names in `packages/hub/tools.json`, one line. 3 pass.
- **Each twin laid over that copy by hand:** `tools-by-hand`, 0 pass, 3 fail; `names-one-version`, 0 pass, 3 fail. The
  first and third tests fail on `tools-by-hand` with `node --test tests/agent-eval.test.mjs does not pass in the
  checkout` and `with deep_made_up added to packages/hub/tools.json and skills/deepbuild/SKILL.md, ... does not pass`.
  The second fails on `names-one-version` with `the recorded run with its skill pinned to 9.9.9, where 0.0.0 is
  installed, should fail for the pin alone, naming both versions`.
- **Four wrong fixes of the test file itself,** which no twin can plant, in the same scratch folder: the run's tools
  taken from the skill's own text (the third test fails, at its first half); the second half deleted (the second test
  fails); the test skipped (all three fail, the first at its counts); the hand list lengthened to today's fifteen (the
  third test fails).
- **The lanes' rule for a failure at an assertion:** a throwaway copy of `frames`, `asserted` and `atAssertion` from
  `scripts/proof-runs.mjs`, over a report written by `scripts/proof-reporter.mjs`. Every failure above read as at an
  assertion, its innermost frame in this file.

Did not run: `scripts/proof.mjs` or any lane of it, `scripts/affected.mjs`, the preflight, `npm ci`, a build, cargo or
any other suite. So no lane has laid, built or run the twins, and `spans()` has not read the test names (the checkout
has no `typescript` installed); they are plain string literals.

## Files

- `agent-eval.test.mjs`: the three tests and their helpers.
- `twins.json`, `twins/`: the planted wrong programs, and `twins/README.md`.
- `BASE-FAILURE.txt`: the run at the base, paths cut out.
