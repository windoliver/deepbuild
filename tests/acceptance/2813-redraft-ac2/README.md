# Acceptance test for #2813, criterion 2: #1831's fast node files on PR #2802's branch

Drafted blind from issue #2813, `docs/technical-design.md`, `docs/parallel-proof.md`, AGENTS.md and the base commit
`254bdc87c`. At the base I also read `scripts/proof.mjs`, `scripts/proof-runs.mjs`, `scripts/proof-change.mjs`,
`scripts/bays.mjs`, `scripts/throttle.mjs`, `scripts/lanes.mjs` and `tests/acceptance/2813/` (the pattern), and
PR #2802's branch at its head (`3d2115ea6`) for #1831's test files. The helpers are written here, never imported from
another suite. Per AGENTS.md the implementing agent doesn't edit this test; a dispute goes to a blind redraft by this
job. It replaces the "checked by hand, not by a test" note for this criterion in `tests/acceptance/2813/README.md`.

```sh
node --test tests/acceptance/2813-redraft-ac2/branch.test.mjs
```

**It runs by hand, never in a lane:** it builds the branch's binaries and workspaces on both sides, and #1831's
`canvas.test.mjs` and `deep-show.test.mjs` build deep-show (a release build too) and, on macOS, deep-gpu. It takes
an hour or more; the test allows the proof five hours. It needs this checkout's `node_modules` (`npm ci` once:
`scripts/proof.mjs` imports `typescript`), and `git fetch` from origin only for the commits this repository lacks.
The proof run itself installs each side's packages (`npm ci`) and builds crates, so it reads the npm registry and
cargo's registry, or their caches, as any proof run does.

## Criterion 2: `#2813.60c058b2` (branch.test.mjs)

"On #1831's branch (PR #2802), `node scripts/proof.mjs before trace` no longer reports `spine.test.mjs` or #1831's
other fast node files as `the run was stopped after 20 minutes`."

The test makes a scratch repository in the temporary folder: its objects are read from this repository
(never written there), and what it lacks is fetched from origin into the scratch repository alone. In it:

- HEAD is PR #2802's head `3d2115ea6936d36617ac9bbd4a2ef933dbc172ed` (`refs/pull/2802/head`), on a branch of its own;
  `origin/main` is the branch's base then, `d4cef00fbd02632188a161c94c19a9660a3ee6ba`; origin's URL is this
  checkout's, so the commits' `Part of #1831` names this repository's issue.
- `scripts/` is this checkout's (what git lists there, uncommitted edits and new files included), in place of the
  branch's, uncommitted: the proof tooling under test is today's. Main now holds the branch's own edits under
  `scripts/` (`spine.mjs`'s #13 row, `agent-harness.mjs` and `benchmark.mjs`'s shared list), so #1831's tests see
  the code they were written for.
- `DEEP_PROOF_ISSUES` is `issues/` here, holding #1831's body as `gh` gave it on Nov 27, 2026; its two criteria are
  `#1831.13f43b1f` and `#1831.2e170a8b`, the tags the branch's `helpers.mjs` carries. No `gh` sign-in is needed.
- The proof uses the machine's own HOME, throttle table and bays, as any proof run on the machine does; it removes
  `NODE_TEST_CONTEXT`, `DEEP_BIN_DIR`, `CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`, `DEEP_PREFLIGHT`,
  `DEEP_OPEN_ISSUES`, `DEEP_PERF_LOCK`, `DEEP_THROTTLE_TABLE` and `DEEP_THROTTLE_READINGS` from its environment.
  The trace lane writes its record under `~/.deepbuild/lanes/` for the scratch tree, as it does for any tree.

It runs `node scripts/proof.mjs before trace` there and keeps the whole output in `<scratch dir>.log`, beside the
scratch dir in the temporary folder, printing its path; that log is the PR's evidence. The scratch dir is removed.

#1831's node test files, from its README and code: `spine.test.mjs` ("no build, a few seconds") and
`harness.test.mjs` ("no build, under a minute"; off macOS it fails at once) are the fast ones. `canvas.test.mjs` and
`deep-show.test.mjs` build binaries; a run of their own may be stopped at its own 20-minute cap and read so, as the
issue keeps for the stopped file. `tests/harness-low-power.test.mjs` and `tests/reference-macs.test.mjs` carry no
#1831 tag, so the lanes don't run them.

It asserts, on the printed lane lines:

- the proof finished within five hours (`proof: wall time` printed);
- no line names `spine.test.mjs` or `harness.test.mjs` with `the run was stopped after 20 minutes`;
- `spine.test.mjs`'s tagged test `#1831.2e170a8b` reads `PASS before:` or `FAIL before:`, a verdict of its own, not
  `BLOCKED` with a neighbour's cause. (Expected: `PASS before: … failed on the merge base at its assertion`, as the
  base's `spine.mjs` pins #13 at 7222b169.)

It prints #1831's lane lines, and whether `canvas.test.mjs` or `deep-show.test.mjs` reached its own cap in this run.

## What a wrong program does

At the base of #2813, before and trace ran every node file of a side in one `node --test` call under one 20-minute
`TIMEOUT`. On this branch `canvas.test.mjs`'s cold release deep-show build blows that cap, and every node file in the
call reads `BLOCKED before: … cannot run on the change: the run was stopped after 20 minutes` (and the base side's
`… cannot run on the merge base: …` the same), `spine.test.mjs`, which takes under a second, included. This test
then fails at its second assertion, or at its third when the call instead ended with no report
(`node --test did not run`).

The test tells the two apart only in a run where a building file really reaches the cap: with warm builds, where
`canvas.test.mjs` ends in under 20 minutes, the single-call program blocks nothing either. The printed line on
whether a file reached its cap says which run this was; keep a run where one did as the proof.
