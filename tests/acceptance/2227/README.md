# Acceptance tests for #2227: the hub and the CLI type-check, so the workspace build reaches deep-confirm

Written first and blind, at base commit `bf5e3decc4f3a7e41f881d1ca35691e364a56480` (main as of 2026-11-19 with the
issue's bug present: `RecordedRun.exit.cause` in `packages/gate/src/claim.ts` without `'limit'`), from the issue, the
design and the base, before any implementation. The drafting job saw no fix, diff, other branch, other worktree or pull
request. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding). There is no taste criterion, so no `TASTE.json`.

## Sources

- **The issue**, #2227, its body as saved on 2026-11-19: the account of the bug (the three tsc errors, and why
  `CommandRun` no longer extends `RecordedRun`), Scope, the three criteria, Proof and Depends on.
- **#1409's body**, the issue #2227 names: a limit stop, and its AC3 "A check whose run stopped at a limit reads
  INCONCLUSIVE".
- **The design**, `docs/technical-design.md`: How runs become one of five verdicts (a run the supervisor stops at a
  limit is `stopped` and makes its check INCONCLUSIVE; Failing on an assertion); in How we know version 0 works,
  Dogfooding, Tests written first, Criteria to tests, Criteria in a checked shape and Wrong programs.
- **AGENTS.md.**
- **The base, for surfaces only**: the root and workspace `package.json` files and `tsconfig.json`s,
  `packages/hub/native/build.mjs`, `packages/gate/src/claim.ts`, `packages/checks-command/src/index.ts`,
  `packages/conformance/src/families.ts` (`judge`), the two files AC3 names and #1409's README and helpers,
  `scripts/proof-change.mjs` and `scripts/closed-sweep.mjs` (`criterionId`), `scripts/proof-runs.mjs` (how the before
  lane runs a test on the merge base and on a twin), `scripts/lanes.mjs`, `tests/vitest-setup.ts`, and the suites
  `tests/acceptance/2742` (a test that runs another suite unchanged) and `tests/acceptance/2699` (its twins).

## Run

From the repository root, on macOS with Node 24.22:

```sh
npm ci
npm run build --workspaces      # once; at the base it exits non-zero (the issue's bug), and tsc still emits dist/
npx vitest run tests/acceptance/2227 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2227/tsconfig.json
```

- Each test sets its own bound, which overrides `--testTimeout`: AC1 30 minutes, AC2 50, AC3 30. On the base, one
  file at a time under `nice -n 10` at a load of 150 to 290 on 18 cores, AC1 took 41 s, AC2 485 s (the copy 24 s, its
  build 453 s) and AC3 19 s; the whole run 554 s (BASE-FAILURE.txt).
- AC2 copies the checkout (about 19,400 files, each a copy-on-write clone where the disk can make one) into a
  `dh2227-*` folder under the OS temp folder and builds there; AC3 writes its child run's report to another. Each is
  removed when its test ends.
- No network, no model call, no hub. Nothing is stopped by name or port: a command past its bound is killed by its
  PID, and `tests/vitest-setup.ts` ends what a file left running.

## The surface under test

The issue names its surfaces: two type-check commands, the workspace build and the file it must reach, and two test
files. What it leaves open is how to run and observe them; each choice is marked *(chosen)*.

- **AC1**: `tsc -p tsconfig.json --noEmit`, as written, in `packages/hub` and in `packages/cli`, run by the Node that
  runs the suite with `node_modules/typescript/bin/tsc`, the TypeScript the packages' own builds run *(chosen)*; the
  two at once *(chosen)*; each bounded at 25 minutes *(chosen)*. The observable is each exit code. `--noEmit` writes
  nothing, so it runs in the checkout itself.
- **AC2**: `npm run build --workspaces`, as written, run with the `npm` on `PATH` in a copy of the checkout
  *(chosen)*, never in the checkout: the build rewrites every package's `dist/`, which many other suites' helpers run
  (`packages/cli/dist/main.js`, for one) while the unit lane runs files side by side. The copy:
  - holds the files `git ls-files --cached --others --exclude-standard` lists in the checkout, less what the worktree
    deleted, each cloned where the disk can *(chosen)*; no `.git`;
  - has a `node_modules` folder whose entries link to the checkout's, with each relative link (the workspace
    packages', `@deepbuild/<name>` to `../../packages/<name>`) made anew so it reaches the copy's own package, and
    each tool cache folder empty and its own *(chosen; the proof lanes lay out their copies the same way)*;
  - has, in place of `packages/hub/native/build.mjs`, a probe that appends its working folder to
    `packages/hub/native/reached.jsonl` beside it and builds nothing *(chosen)*. The hub's build script, every
    `tsconfig.json` and every source are the checkout's own.

  The observable: the folders the probe ran from. The build reaches `packages/hub/native/build.mjs` when it ran from
  `packages/hub` *(chosen)*. The build is bounded at 45 minutes *(chosen)*. The test first asserts the checkout holds
  `packages/hub/native/build.mjs`, so a checkout that lost the file can't pass on the probe.
- **AC3**: the two files, run as they stand by a child Vitest from the checkout's root with the root config, as the
  unit lane runs them: `node node_modules/vitest/vitest.mjs run --no-file-parallelism --reporter=json
  --outputFile=<tmp>/report.json tests/acceptance/1409/check.test.ts packages/gate/test/claim.test.ts` *(chosen;
  `--no-file-parallelism` as #1409's README asks)*, bounded at 25 minutes *(chosen)*. "Pass" is read from the JSON
  report *(chosen)*: each file ran, ran at least one test, and every test in it passed (none failed, skipped or todo);
  no other file ran; the child exited 0. "Unchanged" is read from git *(chosen, as #2742's suite reads it)*:
  `git diff --name-only $(git merge-base HEAD origin/main) -- <the two files>` lists nothing, so neither file differs
  from the merge base with origin/main, in a commit or in the working tree.

No test imports the code under test; each runs a command the issue names.

## Criteria to tests

Each ID is `#2227.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs` and `scripts/closed-sweep.mjs`), checked against the saved body.

| Criterion | ID | Test | What it asserts | Wrong program it fails on | On the base |
|---|---|---|---|---|---|
| AC1 | `#2227.0f03b34b` | `ac1-typecheck.test.ts` `AC1 #2227.0f03b34b …` | the exit codes of `tsc -p tsconfig.json --noEmit` are `{ hub: 0, cli: 0 }`; the message quotes each package's error lines | the base; the twin `cause-without-limit` | **fails**: `{ hub: 2, cli: 2 }`, each with the issue's three errors at `packages/hub/src/core.ts(564,…)` |
| AC2 | `#2227.5d05bdca` | `ac2-native-build.test.ts` `AC2 #2227.5d05bdca …` | the checkout holds `packages/hub/native/build.mjs`; in the copy's `npm run build --workspaces`, the probe in its place ran from `packages/hub` | the base; the twin `cause-without-limit` | **fails**: the probe never ran; the build's errors are the hub's and the CLI's type-checks |
| AC3 | `#2227.de8c9b23` | `ac3-unchanged.test.ts` `AC3 #2227.de8c9b23 …` | the two files are unchanged from the merge base with origin/main; run as they stand, both ran, every test in them passed, none skipped, nothing else ran, the child Vitest exited 0 | the twin `limit-stop-fails` | passes: the criterion keeps what works at the base |

## The wrong programs

- **AC1 and AC2: the base.** At `bf5e3dec` the gate's `RecordedRun.exit.cause` allows only `'exit' | 'deadline' |
  'stop'` while `CommandRun.exit.cause` also holds `'limit'`, so the hub's type-check and the CLI's (which reads the
  hub's sources) exit 2, and the hub's build stops at `&&` before `node native/build.mjs`. Both tests fail there at
  their assertion (BASE-FAILURE.txt).
- **AC1 and AC2: the twin `cause-without-limit`**, for the proof lane, where the merge base can't serve (Legs that
  read BLOCKED or INCONCLUSIVE, below): `twins/cause-without-limit/packages/gate/src/claim.ts` is the base's file
  (the bug, its line marked). The proof lane builds a twin's checkout with `npm run build --workspaces` before it runs a test there, and
  a build that fails leaves the twin unrunnable; so the twin also carries the hub's and the CLI's `package.json` with
  their build scripts' exit status masked, `tsc -p tsconfig.json && node native/build.mjs || true` and
  `tsc -p tsconfig.json || true`. The masks change no exit code AC1 reads (it runs tsc itself), and keep the `&&`
  before `node native/build.mjs`, so the hub's build still never reaches it. At the base, the hub and the CLI are the
  only workspaces whose build fails, so with the masks the twin's build exits 0. Laid over the base's files for the
  record (BASE-FAILURE.txt), the twin failed AC1 at its assertion (`{ hub: 2, cli: 2 }`) and AC2 at its assertion,
  the copy's `npm run build --workspaces` exiting 0 and the probe never running.
- **AC3: the twin `limit-stop-fails`**: `twins/limit-stop-fails/packages/checks-command/src/index.ts` is the base's
  command check kind with a run stopped at a limit ended `failed`, a product failure, in both places it ends one
  `stopped` (marked). Its type is unchanged, so it builds on the base and on a change. #1409's `check.test.ts` then
  fails at its first assertion (the closed outcome is `failed`, not `stopped`), and AC3's test fails at its assertion
  on the child run's failures (BASE-FAILURE.txt, laid over the base's file for the record).

`twins.json` maps each criterion's ID to its twin. Each twin file is a whole copy of the base's file; laid over a
later main by the proof lane, a twin replaces what main changed in that file since, so a twin may need a blind redraft
when main moves those files.

## Readings where the issue leaves a choice

- **AC1's "Today each exits 2 with the lines above"** describes the base, not the work: the test asserts only exit 0.
  BASE-FAILURE.txt shows the base's 2s and lines, at line 564 of `core.ts` here (913 in the issue, on an older main).
- **AC1 reads the exit code alone.** A silencing directive at the hub's call would also make tsc exit 0; the design
  leaves that to the gate's rule on added directives, not to this test.
- **AC2's "reaches"** is that `node native/build.mjs` runs from the hub's build, read from a probe in the file's place.
  deep-confirm itself isn't built in the copy (`swiftc` doesn't run there), so a `swiftc` failure can't fail AC2, and
  nothing here proves deep-confirm builds. The build's exit status isn't asserted: the criterion asks that the build
  reach the file, not that every workspace pass.
- **AC3's "unchanged"** covers the two files the criterion names, not their helpers or fixtures, nor the code they
  test. A checkout with no `origin/main` can't name a merge base, so it reads INCONCLUSIVE.
- **What AC3's two files can't see.** Both see a stopped run through its closed outcome: #1409's `check.test.ts`
  judges it with conformance's run mapping, not the gate, and `claim.test.ts`'s stopped run has the cause `'stop'`. A
  gate that read `exit.cause` and judged only `'limit'` differently would pass both. The criterion names these files
  as its proof, so the test holds them as written; that gap is the criterion's.

## Legs that read BLOCKED or INCONCLUSIVE

- **In these tests**, a leg the checkout can't run fails the test with a plain error starting `INCONCLUSIVE:`, never a
  pass, and never an assertion failure, so it never counts as a wrong program's failure: `node_modules`, its
  TypeScript or its Vitest missing; a command that can't start or overruns its bound; git that can't list the
  checkout's files (AC2) or name a merge base with origin/main (AC3); and AC3 off macOS, where #1409's suite doesn't
  run.
- **In the proof lane** (`scripts/proof-runs.mjs`), the merge base can't prove AC1 or AC2 either way. When it already
  holds the fix, all three tests pass there. When it lacks the fix, the lane's own `npm run build --workspaces` of the
  merge base fails (the issue's bug), so that checkout is BLOCKED and no test runs there. Either way the criteria are
  proved on their twins, each built and run in a checkout of its own; that is why AC1's and AC2's twin carries the
  masks. Each run of the tagged files is capped at 20 minutes. Here the three files took 554 s together on the base,
  and AC1 with AC2 380 s on their twin, so a run under much heavier load may be stopped there and read BLOCKED.

## What the implementer adds outside this folder

- The issue's Scope: `RecordedRun.exit.cause` in `packages/gate/src/claim.ts` gains `'limit'`.
- In `scripts/lanes.mjs`, with a comment line on why: `alone.push('tests/acceptance/2227/');` (AC2 runs the whole
  workspace build in a copy of the checkout, AC1 the hub's and the CLI's type-checks, AC3 a child Vitest of #1409's
  limit stop), and `slow.push('tests/acceptance/2227/ac2-native-build.test.ts');`, the one file whose run here took
  over two minutes (485 s; AC1 41 s, AC3 19 s).
- The issue's Proof (the two type-checks on main, before and after; the two test files after) is the implementer's
  report.

## Files

- `ac1-typecheck.test.ts` AC1, `ac2-native-build.test.ts` AC2, `ac3-unchanged.test.ts` AC3.
- `helpers.ts`: the checkout's root; a child's environment with the caller's `GIT_*`, `npm_*` and Vitest variables
  cleared; a command run to its end within a bound; git in the checkout; INCONCLUSIVE; and what a failure message
  quotes of an output, with every stack-frame line left out, since the proof lane places a failure by the first frame
  in its stack, message included. All three files use it.
- `twins.json`, `twins/cause-without-limit/` (AC1, AC2) and `twins/limit-stop-fails/` (AC3): the planted wrong programs.
- `tsconfig.json`: type-checks the suite, twins left out.
- `BASE-FAILURE.txt`: the run on the base, then each twin laid over the base's files with the files mapped to it.
