# #3179 acceptance suite: the guard on PR #3177's branch

Written blind: from issue #3179, `docs/technical-design.md`, `docs/parallel-proof.md`, `AGENTS.md` and the code of
the base commit `ab84620ff34d` (PR #3177's head) only. The suite's layout follows #3163's guard suite as it stood
in that commit's history. No branch, PR diff or implementation of the fix was read.

| test | criterion |
|---|---|
| `#3179.381b8671 …` | the guard finishes in under 60 s wall, load at start and end recorded, and starts no more than 200 `git` processes |
| `#3179.2db877e7 …` | the guard prints the issue's 7 `PASS guard` lines (ignoring `proof: wall time`) and exits 0, as before the change |

The IDs are `#3179.` plus the first 8 hex of the sha256 of each `- [ ] ` line's text, trimmed, whitespace
collapsed, checked against the live issue.

## Run

```sh
source ~/.nvm/nvm.sh; nvm use 24
node --test tests/acceptance/3179/guard.test.mjs
```

It takes 10 to 20 minutes on the base: the clone (about 850 MB), `npm ci`, then the guard (about 4 minutes on the
base). Run it where a 10-minute command limit won't kill it, such as a Terminal tab.

**Program under test.** `scripts/` and `package.json` of this checkout, or of the folder `DEEP_3179_SCRIPTS`
names (a checkout root holding `scripts/proof.mjs` and `package.json`). They are copied into a temporary folder
beside the judged clone, with its `node_modules` linked in, so running them changes nothing in the judged clone.
**On the base**: the base is this checkout's own commit `ab84620ff34d`, so run it from a checkout of that commit,
or point `DEEP_3179_SCRIPTS` at one: `DEEP_3179_SCRIPTS=/path/to/base-checkout node --test tests/acceptance/3179/guard.test.mjs`.

## What it does

1. Records the load average at suite start.
2. Clones `https://github.com/windoliver/deepbuild.git` fresh into a temporary folder, fetches `pull/3177/head`,
   checks it is `ab84620ff34d` and checks it out detached. Pins `refs/remotes/origin/main` to `83b82f94ad44` and
   checks the merge base of HEAD and `origin/main` is that commit. Runs `npm ci --ignore-scripts` and checks the
   clone is clean.
3. Runs `node <program>/scripts/proof.mjs guard` **once** in the clone, in its own process group, with the preload
   `count-git.cjs` (through `NODE_OPTIONS=--require`) appending one line per `git` process started through
   `child_process` (`spawnSync`, `execFileSync` and the rest) to a count file. The run is not stopped at 60 s or 200
   processes, so criterion 2 has a verdict to compare; it is killed (by its process group's PID) only at the suite's
   own 20-minute cap, which no criterion sets.
4. Prints wall, git count (with the most frequent git subcommands), exit code, stdout, stderr and the load at
   the guard's start and end, then judges both criteria from that one run. Records the load at suite end.

The guard's environment drops every `GIT_*` variable and the ones the base's proof scripts read that could change
its verdict or how it runs: `NODE_TEST_CONTEXT`, `NODE_OPTIONS` (replaced by the preload), `DEEP_PROOF_ISSUES` (so the
issue is read live with `gh`), `DEEP_GATES` (so the default `~/.deepbuild/gates` is used, as in the issue's run),
`DEEP_THROTTLE`, `DEEP_PREFLIGHT`, `DEEP_OPEN_ISSUES`, `DEEP_APPROVERS`, `DEEP_PERF_LOCK`, `DEEP_BIN_DIR`,
`CARGO_TARGET_DIR`, `DEEP_PROOF_VITEST_REPORT`.

Criterion 2's verdict lines are stdout lines starting with a state word (`PASS`, `FAIL`, `BLOCKED`, `INVALID`,
`INCONCLUSIVE`) or `  Fix:`, without the `proof: wall time` line, compared in order to the issue's 7 lines.

## Needs

- Network: GitHub over HTTPS (clone, `pull/3177/head`), the npm registry (`npm ci`), and `gh` signed in (the guard
  reads the change's issue with `gh issue view`).
- Disk: about 2 GB in the temporary folder, removed at the end.
- Node 24 and `/usr/bin/git`. The Mac (the issue's "Runs on").

## On the base

`BASE-FAILURE.txt` is this suite's output on the base. Criterion 1 fails at its assertion because the guard
takes minutes and starts well over 200 git processes; criterion 2 is expected to pass on the base, since the
issue's "before" lines are the base's own output.
