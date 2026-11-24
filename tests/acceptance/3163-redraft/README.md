# Acceptance tests for #3163: the guard on PR #3093's branch in under 60 s and 200 git processes, with the same verdict

Drafted blind (a redraft) from issue #3163, `docs/technical-design.md`, `docs/parallel-proof.md`, AGENTS.md and the
base commit `83b82f94a`. At the base I also read `scripts/proof.mjs`, `scripts/proof-guard.mjs`,
`scripts/proof-change.mjs`, `scripts/proof-approvals.mjs`, the top of `scripts/lanes.mjs`, and `tests/acceptance/2813/`
(the pattern). I did not read the earlier draft in `tests/acceptance/3163/`. The helpers are written here, never
imported from another suite. Per AGENTS.md the implementing agent doesn't edit these tests; a dispute goes to a blind
redraft by this job.

```sh
source ~/.nvm/nvm.sh; nvm use 24
node --test tests/acceptance/3163-redraft/guard.test.mjs
```

It needs the network (a full clone of github.com/windoliver/deepbuild, about 850 MB, `npm ci`, and the guard's own
`gh issue view` of #2327), and about 2 GB of free disk under the temp folder, which it removes afterwards. With the fix
it takes the clone's time plus a minute; on the base it takes the clone's time plus 5 minutes (below).

The program under test is the `scripts/` folder beside this suite, or the one `DEEP_3163_SCRIPTS` names. To run it on
the base, export the base's `scripts/` and `package.json` and point the suite there:

```sh
mkdir -p <tmp>/base && git archive 83b82f94a scripts package.json | tar -x -C <tmp>/base
DEEP_3163_SCRIPTS=<tmp>/base/scripts node --test tests/acceptance/3163-redraft/guard.test.mjs
```

## The judged clone and the one guard run (shared by both tests)

- `/usr/bin/git clone` of `https://github.com/windoliver/deepbuild.git`, a fresh full clone (no `--filter`, no
  `--shared`, nothing from a local copy), then `git fetch origin pull/3093/head`. The setup refuses unless that head
  is `d00a54048…`, checks it out as a branch, and sets `origin/main` to `11eb8c6fd`: PR #3093 has landed, so today's
  main holds its commits, and the change the issue names is that head against that merge base. It refuses unless
  `git merge-base HEAD origin/main` is `11eb8c6fd…` and the change has 2 commits.
- `npm ci --ignore-scripts`, then it refuses unless `git status --porcelain` is empty. Deviation: the criterion says
  `npm ci`; install scripts are skipped because the guard loads only `typescript` from `node_modules`, and the native
  builds they run add minutes and nothing the guard reads.
- The program under test is copied to `<tmp>/program/scripts` (with the `package.json` beside it and a
  `node_modules` link to the clone's install) and run as `node <tmp>/program/scripts/proof.mjs guard` with the clone
  as its working folder, which is the repository `proof.mjs` judges. It sits outside the clone because the guard reads
  an uncommitted change as one more commit of the change: copying the fixed `scripts/` into the clone would make the
  guard judge a third commit, not PR #3093.
- `count-git.mjs` is the `spawnSync`/`execFileSync` preload, loaded through `NODE_OPTIONS=--import=…`. It appends one
  line per `git` process started through `node:child_process` (`spawnSync`, `execFileSync`, `spawn`, `execFile` by
  file name; `execSync`, `exec` by command line) before it starts, so a run stopped at a limit still leaves its count.
- The load (1, 5 and 15 minute averages and the core count) is printed when the guard starts and when it ends, and
  each assertion message carries both. The suite never waits for a quiet machine.
- The guard is started once. It is stopped (its own process group, by PID) after 300 s.

## Criterion 1: `#3163.9c395067` (guard.test.mjs)

> On PR #3093's branch (head `d00a54048`, merge base `11eb8c6fd`), checked out as a fresh GitHub clone with `npm ci`,
> `node scripts/proof.mjs guard` finishes in under 60 s wall on the Mac, with the load at start and end recorded. It
> starts no more than 200 `git` processes, counted by a `spawnSync`/`execFileSync` preload. Today it takes 3,401 s and
> starts 38,044.

The test waits for the guard's exit, at most 60 s from its start. It then fails naming each limit exceeded: the 60 s
wall (the run had not finished, or took 60 s or more, measured from spawn to exit) and the 200 git processes (the
preload's count, so far if still running). It prints both loads. It doesn't wait out the base's hour: at 60 s the
wall limit is already exceeded, and the count so far is a lower bound on the run's.

## Criterion 2: `#3163.d0eabe65` (guard.test.mjs)

> On that same clone and commit, `node scripts/proof.mjs guard` prints the same verdict lines before and after the
> change, ignoring the `proof: wall time` line. Today that is `PASS guard: 2 commits checked: no guarded edit lacks
> its own approved proposal`. It also exits with the same code.

"Before" is taken from the issue, not re-run: the base's guard takes about an hour there. So the test asserts that the
same guard run's stdout, without empty lines and without the `proof: wall time` line, is exactly
`PASS guard: 2 commits checked: no guarded edit lacks its own approved proposal`, and that it exits 0. The criterion
states no time limit, but nothing unrun passes, so the test waits at most 300 s (five times criterion 1's limit) and a
run stopped there fails as having printed no verdict.

## On the base

`BASE-FAILURE.txt` holds the base run's output (paths replaced with `<checkout>` and `<tmp>`; 380 s in all, load
42.7 at the guard's start on 8 cores). Criterion 1 fails at its assertion, naming both limits exceeded: not finished
after 60 s, and 1,948 git processes started in those 60 s. Criterion 2 fails because the base's guard is still running
at 300 s (11,533 git processes by then) and is stopped, so it printed no verdict; that is the cost criterion 1
measures, not a changed verdict, which the base can't show inside this suite's wait.

Before saving that, I checked that the suite can pass: against a scratch copy of the base's `scripts/` whose `show`
answers a missing path from one `git ls-tree -r` per revision and reads each blob once (a planted fix, not kept), both
tests passed: the guard finished in 17.1 s at load 26 with 81 git processes, printing exactly the issue's PASS line and
exiting 0.
