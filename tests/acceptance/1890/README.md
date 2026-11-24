# Acceptance tests for #1890: the hub's background-job test passes on main, and is listed until it does

These tests were written blind at base `81a5a9b2f` ("Merge pull request #2349 …"), from the issue, the design and the
base alone, before any fix. The drafting job read no other branch, no other worktree and no pull request. Per AGENTS.md,
the implementing agent doesn't edit these files. A dispute goes to a blind redraft by this job.

## What was read

- Issue #1890 as the brief quoted it: body, Scope, AC1, AC2, Proof, Depends on, and the owner's comment of Nov 10.
- AGENTS.md. In `docs/technical-design.md`: "One hub per user, a tiny hook client, and extensions in-process", Fail
  before, pass after, Failing on an assertion, Known failures are waivers, Criteria to tests, Wrong programs, and The
  edit guard (the known failures' rules).
- At the base, to learn the surface:
  - The hub: `packages/hub/test/background.test.ts`; `packages/hub/src/core.ts` (`every()`, `run()`, the `asks` job,
    `testJob`, `test.clock`); `server.ts` (`plantOf(DEEP_HUB_PLANT)`, `DEEP_HUB_TEST_*`); `plant.ts`; `vfs.ts`;
    `hub-readings.ts` (`jobs` in `hub.health`); `paths.ts` (`deepHook()`).
  - The asks: `packages/asks/src/index.ts` (`away`, `settle`, `giveNotice`, `moveDeadline`) and `showing.ts` (#908's
    rules).
  - The scripts: `scripts/known-failures.json`, `known-failures-check.mjs`, `affected.mjs` (`classify`), `lanes.mjs`
    (`reportResults`, the test paths), `proof-runs.mjs` (the `before` lane, `twinsOf`, `childEnv`), `proof-change.mjs`
    (`criterionId`, `underTestPaths`) and `proof-vitest-reporter.mjs`.
  - Other suites: `tests/acceptance/909/` and `908/` (README and tests), `2201/` (its twins for a fix that edits a
    test), and the plant twins of `1156/`, `65/` and `668/`.

## The surface under test

- **The test file** `packages/hub/test/background.test.ts`, run by itself and unchanged, as `npx vitest run <file>` runs
  it from the checkout's root. Its run is reported through the proof lanes' own reporter
  (`scripts/proof-vitest-reporter.mjs`) and read with their own reader (`reportResults` in `scripts/lanes.mjs`), so a
  test's ID is `packages/hub/test/background.test.ts › <its name>`, as `affected.mjs` and `known-failures.json` name it.
- **The planted hub** `DEEP_HUB_PLANT=drops-job-failure` (Surface choices, below).
- **The list** `scripts/known-failures.json` (`failures`), and `classify` from `scripts/affected.mjs`, which sorts a
  failure as new or already failing on main.

## Surface choices

The issue leaves these open. The tests use them exactly, so the implementation must match them.

1. **The planted hub is `drops-job-failure`.** The fix adds `'drops-job-failure'` to `Plant` and `PLANTS` in
   `packages/hub/src/plant.ts`. A hub with that plant keeps no background job's failure: every job in `hub.health`'s
   `jobs` reads `failing: null` however its runs end. Everything else stays as in the fixed hub. The plant is read from
   the hub's options (`options.plant === 'drops-job-failure'`), which `plantOf` sets as it does for every plant. The fix
   adds no new export to `plant.ts`, so the twin, which keeps exactly the base's exports, still builds.
2. **How the planted hub reaches the hub the test starts: through the build, not the environment.** The background test
   starts its hub as `node packages/cli/dist/main.js hub run`, a path it takes from its own file's place, with an
   environment of its own (`PATH`, `HOME`, `DEEP_HUB_TEST_VFS`). So `DEEP_HUB_PLANT` set around vitest never reaches
   that hub, and the test needn't pass it on.
   - **In this suite:** `copyOfCheckout()` (in `helpers.ts`) makes a temporary copy of the checkout. `packages/hub` and
     `packages/cli` are copied, their built `dist` and the test file included. Every other path links to the
     checkout's, and `node_modules` is laid out as the proof lanes lay a copy's, so `@deepbuild/hub` and
     `@deepbuild/cli` resolve to the copies. For the planted run, the copy's `packages/hub/dist/plant.js` becomes the
     checkout's own module (renamed `plant.checkout.js`) behind a module that re-exports it and answers
     `drops-job-failure` from `plantOf` and `activePlant`. The test file run in the copy starts the copy's CLI, whose hub
     is planted. The copy holds the checkout's test file, byte for byte. A run in the same copy without the plant must
     pass first, which shows that the copy itself runs the test as the checkout does.
   - **In the proof lanes:** the twin `twins/drops-job-failure` replaces `packages/hub/src/plant.ts` with one whose
     `plantOf` and `activePlant` answer `drops-job-failure` whatever the environment says, and the lane builds it.
     Every hub of that build is planted, including the one in the checkout itself (`twins/README.md`).
3. **The test file stays `packages/hub/test/background.test.ts`**, runnable alone from the checkout's root. Its test
   names, and how it holds with #908's moved deadline, are the fix's choice (the Scope names an ask that had shown before
   the hub stopped). The fix reaches it through an approved proposal, as the issue says.
4. **The list's entry**, while the test fails, is in `known-failures.json`'s `failures`, keyed by the failing test's
   ID. Its note ends `(#1890, added <YYYY-MM-DD>)`, the shape `known-failures-check.mjs` reads.
5. **deep-hook is built** under `target/` (`cargo build -p deep-hook`). Without it, every hub this file starts stops at
   once ("no deep-hook is built under …"), and every run fails for that reason.

## Readings

- **Criterion IDs** are `criterionId` (`scripts/proof-change.mjs`) over each criterion's `- [ ]` line text in the live
  issue body, which has no `AC1:` or `AC2:` prefix. AC1 is `#1890.e77cd011` and AC2 is `#1890.75952fb4`. The
  coordinator supplied them, because the brief's copy of the criteria added the prefix. This job did not read the live
  issue body itself.
- **"Passes"** means vitest exits 0, its report is whole (the reporter's end row), at least one test of the file
  passed, and none failed or skipped. A file whose test is skipped or deleted doesn't pass (invariant 2).
- **"Three runs in a row"** means three runs one after another, each passing. The first that doesn't pass fails the
  test, and nothing is retried.
- **"A loaded machine"** means a one-minute load average above the core count (`os.availableParallelism()`) as each run
  starts. This is the line `classify` in `scripts/affected.mjs` draws, and the one the design uses to set a timing
  failure apart "as loaded". At or below that line, the test starts two busy processes a core (`node -e 'for (;;);'`)
  and waits up to 240 s for the load to rise above it. The processes run through the three runs and are then stopped by
  their PIDs. So an idle machine is loaded by the suite, never skipped. If the load still doesn't rise, the test fails
  with a message starting `INCONCLUSIVE`, which the lanes read as INCONCLUSIVE. Each run's load at its start and end is
  printed.
- **"Fails on a planted hub"** means at least one test of the file reports a failure (state FAIL) when the file runs in
  the planted copy.
- **AC2's "until then"**: the list must agree with the test as it runs on the checkout under test.
  - While any test of the file fails, each failing test is listed with #1890, and `classify` reads its failure as
    already failing on main, not new.
  - Once the file passes, the list names none of its tests. The design says the fix takes a failure off the list, and
    the lint lane fails an entry that passes on main's head or names a closed issue.

  The 14-day lapse and the issue's state are `known-failures-check.mjs`'s to check. That check calls GitHub, so this
  suite doesn't run it.
- **The owner's comment** leaves two ways open: an ask that had shown before the hub stopped, or removing the unit
  test. These tests take AC1 as written: the test must exist and pass. A removed file fails both tests (no run passes),
  so a removal needs the criteria changed by an approved proposal first. Neither test repeats #909's blind suite: they
  run the hub's own test file, which is what the issue fixes.
- **The issue's commit and this base differ** (6a6d6b4f against 81a5a9b2f). The failure reproduces at the base, with
  the issue's own message (`BASE-FAILURE.txt`).

## The tests

All in `runs.test.ts`, with helpers in `helpers.ts`. Each test's name starts with its criterion's ID.

| Criterion | Test | Wrong programs it fails on |
|---|---|---|
| AC1 `#1890.e77cd011` | **AC1 … passes in three runs in a row on a loaded machine, and fails on a planted hub that drops a job's failure.** First, three runs in a row of the file in the checkout, each started on a loaded machine and each passing. Then two runs in a copy of the checkout: one as built, which must pass, and one with the hub planted (`drops-job-failure`), where a test of the file must fail. | The base (run 1 fails). The twin `drops-job-failure` (run 1 fails). A merge base that holds the fixed test but lacks the plant (the planted run passes) |
| AC2 `#1890.75952fb4` | **AC2 until … passes, scripts/known-failures.json lists it with #1890, so affected.mjs sets it apart.** One run of the file in the checkout. If a test of it fails, that test is listed with `(#1890, added <date>)` and `classify` reads it as known. If every test passes, no test of the file is listed. | The base (fails, unlisted). The twin `drops-job-failure` (fails, unlisted). The twin `listed-after-fix` (passes, still listed) |

On a fix, the suite took about a minute at a load of 70 on 18 cores: three runs of 6 to 10 s, the copy's two runs of 9 s
and 21 s (the planted run waits out the test's own 15 s), and AC2's run.

## On the base

Run once at `81a5a9b2f` (`BASE-FAILURE.txt`), at a load of 50 to 67 on 18 cores. Both tests fail, each at an assertion
in `runs.test.ts`:

- **AC1** fails at line 19, on run 1 of 3. The base's test fails with `timed out after 15000 ms waiting for the asks job
  to read failing while its default cannot be appended`, the failure the issue quotes. The test stops there, so the copy
  and the planted run aren't reached.
- **AC2** fails at line 48. The same test fails, and `known-failures.json` doesn't list it
  (`expected '(not listed)' to match /\(#1890, added …\)$/`).

In the `before` lane, the merge base holds the change's test files, the fixed background test among them. If the fix to
the test alone makes it pass there, AC1's planted run still passes on that base, since the base's hub has no
`drops-job-failure`. So AC1 fails there at line 33, at its assertion. AC2 passes on that base (the test passes and isn't
listed), so the lane proves it on its twins, `twins.json` and `twins/README.md`.

## What the drafting job ran, and what it did not

All runs were on this Mac (18 cores) with Node 24.

- **The base's background test alone**, once: it fails as the issue says, in 17 s.
- **A throwaway fix of its own, in this worktree.** The ask had shown before the hub stopped (an `ask.batched` before
  the start), its deadline lay ahead, and `test.clock` stepped past it once writes were refused. With it went the plant
  in `plant.ts` and `core.ts`'s `run()`, and a hub rebuild. Afterwards everything was reverted with git and the base's
  hub build restored from a saved copy. On it:
  - The suite: 2 of 2 passed, in 57 s.
  - AC1 alone, with `--silent=false`: runs 1 to 3 passed in 9.8, 6.5 and 6.2 s at loads from 68.4 to 75.1. The copy as
    built passed in 8.6 s. The planted copy failed in 20.7 s.
  - The twin `drops-job-failure` laid over `plant.ts` and the hub rebuilt with tsc, as the lane would. The build type-
    checked, and both tests failed at their assertions: AC1 on run 1, AC2 at "lists it".
  - The twin `listed-after-fix` laid over `known-failures.json`: AC2 failed at "lists none of its tests".
  - `classify`, called directly on the twin's list and the base's: the listed failure reads as known, and the unlisted
    one as new.
- **The suite once at the base**, for `BASE-FAILURE.txt`.

Did not run:

- `scripts/proof.mjs` or any of its lanes, `scripts/affected.mjs` as a command, `known-failures-check.mjs`, the
  preflight, or any other suite.
- The path where the suite adds its own load. The load was 50 to 92 on 18 cores throughout, so `loaded()` never
  started a busy process, and that branch is untested.
- Once during the session, `target/` was removed from under the worktree, probably by this machine's cleanup of idle
  `target` folders. A hub run then fails with "no deep-hook is built". deep-hook was built again before the runs above.

## Running them

```sh
npm ci && npm run build --workspaces
cargo build -p deep-hook        # the hub the test starts refuses to run without it
npx vitest run tests/acceptance/1890 --testTimeout=600000
```

Add `--silent=false` to see each run's line, with its load, when the tests pass. vitest prints a passing test's output
only then. Failing tests print it anyway. The suite starts real hubs through the test file, and through the copy it
makes under the system's temporary folder. Each child vitest runs in its own process group, which is stopped by its PID
if a run overruns 300 s. The busy processes, when any are started, are stopped by their PIDs. Nothing is killed by name
or port.
