# Acceptance tests for #2492: extension-host's environment-runtime and environment-timeout tests fail on main from faults in the tests

Written first, blind, from issue #2492 (its report and two acceptance criteria) as the brief quoted it, the design and
base commit `eb027b613` ("Merge pull request #2928 …"), by a job that saw no implementation diff, plan, other branch,
worktree, pull request or stash, nor the live issue, and used no network. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file, three
tests, no fixture, no mock.

| AC | ID | File (tests) |
|---|---|---|
| AC1 Both tests pass on main with no change to the host | `#2492.406745f0` | `environment-tests.test.ts` (1): both files in one run of the repo's vitest |
| AC2 Each still fails on a host that skips the cleanup it covers | `#2492.eac47520` | `environment-tests.test.ts` (2): `environment-timeout.test.ts` alone (the late handle's down), `environment-runtime.test.ts` alone (the active handle's stop on disable) |

The IDs are `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text after `- [ ] `, whitespace collapsed, first
8 hex) over the criterion's text as the brief gave it; the live issue body wasn't read, so they aren't checked against
it. Each test's name starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md`, How we know version 0 works (Dogfooding).
- At the base: `packages/extension-host/test/environment-runtime.test.ts`, `environment-timeout.test.ts`, `package.ts`
  and `packages/extension-host/package.json`; their history (`git log` on the two files); `vitest.config.ts` and
  `scripts/lanes.mjs` (`testGlobs`); `scripts/proof-change.mjs` (`criterionId`) and `scripts/proof-runs.mjs`
  (`runVitest`, `atAssertion`). Suites `2564/` and `1841/` for shape, `1434/ac5-unchanged.test.ts` (running another
  suite through vitest's JSON report) and `2218/README.md` (a criterion that passes on the base, proven by a twin).

## What each test does

Each test runs the named file(s), unchanged, with the repo's vitest (`node_modules/vitest/vitest.mjs run`, the root
config, the one the unit lane uses) in a child process, reads vitest's JSON report and asserts, per file: at least one
test ran, and every test in it passed (none failed, skipped or todo; a file that failed outside its tests counts as a
failed test). Every judgement is a vitest `expect` in this file, so a host on which a covered file fails makes the
`expect` here fail: an assertion failure under the test paths, as `atAssertion` reads it. A run that writes no report
throws `BLOCKED:`, never passes.

## Readings where the issue leaves a choice

- **"Both tests"**: the two files the issue names, `environment-runtime.test.ts` and `environment-timeout.test.ts`,
  every test in each, not their tests' names (a fix may rename them).
- **"pass on main"**: pass in one run of the repo's vitest from the checkout's root, the two files together (AC1).
  The proof lanes run this suite on the change's checkout; this job can't run "main" after the change.
- **"with no change to the host"**: not asserted by a test. Within one checkout a test can't tell a changed host from
  an unchanged one without naming a base; it is a property of the diff (`packages/extension-host/src`, `kit`,
  `runtime` untouched), for the review and the proof lanes' base/change comparison.
- **"Each still fails on a host that skips the cleanup it covers"** (AC2): read as two tests, one per file, each
  running its file alone and asserting it passes. On the right host they pass; on a host that skips the late handle's
  down, the timeout file's test fails, and on one that skips the active handle's stop on disable, the runtime file's
  does, so the `expect` here fails at its assertion. Those wrong hosts are planted twins (`twins.json`), which this job
  was told not to write: the host's files the cleanups live in are the implementer's to name. Which file covers which
  cleanup is taken from the issue's order ("the late handle's down, and the active handle's stop on disable") matched
  to each file's own header comment at the base.

## Run them

With the repo's Node (`.node-version`, 24.22.0), on macOS or Linux:

```sh
npm ci                                  # once, if node_modules is missing
npm run build --workspaces              # the host's tests load the conformance kit's build (packages/conformance/dist)
node node_modules/vitest/vitest.mjs run tests/acceptance/2492
node node_modules/typescript/bin/tsc -p tests/acceptance/2492/tsconfig.json
```

About 40 s under heavy load (each test starts a vitest of its own). No network, sign-in or model call; the host's tests
make and remove their own temp folders and stop the processes their environments start.

## Base results

`BASE-FAILURE.txt` is the run at the base, whole, with the checkout's path replaced by `<repo>`, on macOS (arm64) at a
1-minute load near 190-206: **all three tests pass, and tsc is clean.** The base already holds `d2942beb1` and
`ba6391e0c` ("extension-host tests: … (#2492)"), which changed both test files as the issue describes (the kit's real
`cleanFills` loaded at the first `up`; the timeout test appending its stops and taking only its own). So on this base
the merge base is not the wrong program for either criterion; AC2's tests need the planted twins above for the before
lane.

## Not run, and limits

- Not run against a host that skips either cleanup (no twin was written here), nor against the issue's pre-fix test
  files (putting them back was outside this folder and was refused). That each AC2 test fails on such a host is argued
  from the two files' assertions, not shown.
- "No change to the host" is left to diff review (above).
