# Acceptance tests for #3163: the proof guard answers "does this revision hold this path" without a git process per probe

Drafted blind from issue #3163, `docs/technical-design.md` (Dogfooding, How we know version 0 works),
`docs/parallel-proof.md` (sections 5 and 10), AGENTS.md and the base commit `83b82f94a`. At the base I also read
`scripts/proof.mjs`, `scripts/proof-guard.mjs` (`namedByConfig`, `guard`), `scripts/proof-change.mjs` (`readChange`,
`readIssue`, `criterionId`, `resolveModule`), `scripts/proof-approvals.mjs` (`show`) and `tests/acceptance/2813/`
(the pattern). Of PR #3093 I read only its metadata (open, two commits, head `d00a54048`). The helpers are written
here, never imported from another suite. Per AGENTS.md the implementing agent doesn't edit these tests; a dispute goes
to a blind redraft by this job.

```sh
source ~/.nvm/nvm.sh && nvm use 24
node --test tests/acceptance/3163/guard.test.mjs
```

It needs the network and about 1 GB of free disk. Its setup makes a fresh full clone of
`https://github.com/windoliver/deepbuild.git` in a temporary folder (about 850 MB; never a shared clone or a worktree of
a local repository), fetches `pull/3093/head`, PR #3093's head `d00a540486292dfe02c5d53d3ff0d6f5d4fb9821` and main
into `origin/main`, checks out that head detached, checks that its merge base with `origin/main` is `11eb8c6fd`, and
runs `npm ci --ignore-scripts` there (the guard reads git and imports only `typescript`; install scripts would only
build packages the guard never reads). A setup step that fails reads `setup:` and is not a criterion's failure. The
clone is removed at the end. With the fix it takes about two minutes; on the base, about six (both runs are capped).

**What runs.** The code under test is this checkout's `scripts/`, not the PR's: the setup copies this checkout's
`scripts/` folder and `package.json` byte for byte into a runner folder beside the clone, links the clone's
`node_modules` there (the proof scripts import `typescript`, and this checkout may have no `node_modules`), and runs
`node <runner>/scripts/proof.mjs guard` with the clone as its working folder. `proof.mjs` reads the repository at its
working folder, so the guard judges PR #3093's two commits against `origin/main` exactly as the issue's run did, while
the program judging them is the one this checkout holds. Putting the checkout's scripts into the clone's tree instead
would be an uncommitted change the guard itself judges, and would change the verdict.

**The git count.** A preload (`--require` through `NODE_OPTIONS`, so node processes the guard starts load it too)
wraps `spawn`, `spawnSync`, `execFile`, `execFileSync`, `exec` and `execSync` of `node:child_process`, and syncs the
builtin's ESM exports, so `import { spawnSync } from 'node:child_process'` gets the wrapper. Each call whose program
is `git` (by name or path; for `exec`/`execSync`, a command starting with `git`) appends one line to a count file;
a call that reaches another wrapped one, as `execFileSync` reaches `spawnSync`, counts once. That is the issue's
"counted by a `spawnSync`/`execFileSync` preload", read as every git process a node process of the run starts.
Processes that `gh` starts itself are not node's and are not counted.

**Load.** Each run prints the 1/5/15-minute load at its start and end, and every assertion message carries them. The
test never waits for a quiet machine.

Not written: a scratch-repository test that plants a lane-config module full of string literals. Criterion 1 names
PR #3093's branch, and the run there fits a bounded test, so a scratch version would be a second test of the same
criterion through a surface the criterion doesn't name.

## Criterion 1: `#3163.9c395067` (guard.test.mjs)

> On PR #3093's branch (head `d00a54048`, merge base `11eb8c6fd`), checked out as a fresh GitHub clone with `npm ci`,
> `node scripts/proof.mjs guard` finishes in under 60 s wall on the Mac, with the load at start and end recorded. It
> starts no more than 200 `git` processes, counted by a `spawnSync`/`execFileSync` preload. ...

The test runs the guard once in the clone and watches it every 100 ms. On the base the guard takes about an hour, so
the test stops it (SIGKILL to the process group it started, by PID) the moment it has started more than 200 git
processes, or once 60 s pass, whichever comes first, and says which. It asserts, in order:

- no more than 200 git processes were started (`the guard started more than 200 git processes`);
- the guard ended on its own, not stopped, and its wall time, from spawn to exit, is under 60 s
  (`the guard did not finish in under 60 s wall`);
- the preload counted at least one git process (`setup:`), so a preload that counts nothing can't pass it.

Both limits are the issue's numbers. Whether the guard's verdict is right is criterion 2's.

## Criterion 2: `#3163.d0eabe65` (guard.test.mjs)

> On that same clone and commit, `node scripts/proof.mjs guard` prints the same verdict lines before and after the
> change, ignoring the `proof: wall time` line. Today that is
> `PASS guard: 2 commits checked: no guarded edit lacks its own approved proposal`. It also exits with the same code.

The "before" is taken from the issue, not re-run: the issue states today's output on this clone and commit as that one
line, and the base's exit code for a PASS-only run is 0 (`proof.mjs` exits 1 only after a non-PASS line). Re-running
the base's guard takes about an hour here, so it is not part of the test; I did not check it by hand either. The test
runs the guard again in the same clone and asserts that its verdict lines, the lines starting with `PASS`, `FAIL`,
`BLOCKED`, `INVALID` or `INCONCLUSIVE` and their `  Fix:` lines, with `proof: wall time` ignored, are exactly that
one line, and that it exits 0. The criterion bounds no time, so the run's only cap is the test's own: 4 minutes,
after which it is stopped and the test fails as `printed no verdict to compare`. That is what it does on the base,
where the guard needs about an hour; with the fix it finishes in seconds, far inside the cap.

## Base run

`BASE-FAILURE.txt` holds the suite's run on the base `83b82f94a`: both tests fail for the expected reason. Criterion
1's run is stopped when it passes 200 git processes (24 s in, at load 70); criterion 2's run is stopped at the 4-minute
cap with no verdict printed.
