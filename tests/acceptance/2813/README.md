# Acceptance tests for #2813: one node test file's run no longer blocks its neighbours in the before lane

Drafted blind from issue #2813, `docs/technical-design.md`, `docs/parallel-proof.md`, AGENTS.md and the base commit
`336a0a92b`. At the base I also read `scripts/proof-runs.mjs`, `scripts/proof.mjs` and `tests/acceptance/1113/`
(the pattern). The helpers are written here, never imported from another suite. Per AGENTS.md the implementing agent
doesn't edit these tests; a dispute goes to a blind redraft by this job.

```sh
node --test tests/acceptance/2813/before.test.mjs
```

It needs the checkout's `node_modules` (`scripts/proof-change.mjs` imports `typescript`); run `npm ci` once if it is
missing. It is offline and takes about 17 s.

## Criterion 1: `#2813.9c532f47` (before.test.mjs)

The test runs this checkout's `node scripts/proof.mjs before` in a scratch git repository. `origin/main` holds
`src/value.mjs` returning 1. The change makes it return 2, says `Part of #9813` (a planted issue given through
`DEEP_PROOF_ISSUES`, with two criteria whose tags are worked out at runtime) and adds two node test files:

- `tests/acceptance/9813/lost.test.mjs`: **its `node --test` run ends with no report.** It finds the
  `--test-reporter-destination` on the command line of the runner above it (its own process or an ancestor's, read
  with `ps`), waits for that file to appear and removes it. The runner keeps writing to the removed file, so its run
  ends with no report file wherever this file falls among its neighbours, in one run or in parallel, on the base and
  the change alike. This is the criterion's "ends with no report". Being stopped at the 20-minute cap is not tested:
  a test that waits 20 minutes isn't acceptable, and both causes reach the same "every file in the call" path.
- `tests/acceptance/9813/value.test.mjs`: asserts the value is 2, so it passes on the change and fails at its
  assertion on the base.

The test reads only the before lane's printed lines:

- some line `BLOCKED before: … lost.test.mjs … cannot run on the change` exists;
- no other file reads `BLOCKED before: … cannot run on the change`;
- no `BLOCKED` line names `value.test.mjs` or its tag;
- a `PASS before:` line names `value.test.mjs`'s tagged test (proven by the before lane).

On the base it fails at its second assertion: `value.test.mjs` reads
`BLOCKED before: …/value.test.mjs: cannot run on the change: node --test did not run:` beside `lost.test.mjs`
(`BASE-FAILURE.txt`). Before saving that, I checked that it can pass: against a scratch copy of the base's
`scripts/` where `runTests` gives each node file its own `runNode` call (a planted fix, not kept), it passed.

## Criterion 2: `#2813.60c058b2` (checked by hand, not by a test)

"On #1831's branch (PR #2802), `node scripts/proof.mjs before trace` no longer reports `spine.test.mjs` or #1831's
other fast node files as `the run was stopped after 20 minutes`." This depends on PR #2802's branch and a real
20-minute build there, so it is checked by hand: run the before and trace lanes on that branch with the fix and keep
the output as the PR's proof. No test here covers it.
