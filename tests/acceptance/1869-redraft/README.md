# Acceptance tests for #1869, blind redraft: a failed or stuck git read of what a claim changed

Written blind from issue #1869 (its account, Scope, two checkbox criteria and Proof), `docs/technical-design.md` (How
runs become one of five verdicts, with Whose checks count; Dogfooding; Criteria to tests; Wrong programs), `AGENTS.md`
and base commit `b87494f02` (origin/main). The job that wrote them never saw an implementation of #1869, nor any other
draft of its tests. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

The base code was read for its surfaces only: `packages/hub/src/gate-runner.ts` (`changesOf`, `stop`, `verdictOf`,
`ownChanged`, `cleanup`), `packages/gate/src/own.ts` (`ownChanges`), `packages/gate/src/checkouts.ts` (the snapshot's
own git calls: `runGit`, `snapshotOf`, `untracked`), and `packages/hub/src/core.ts` (what it gives the gate runner:
`budget_ms: 10_000`, `hold_ms: STOP_HOLD_MS`, 60 s). Sibling suites for conventions and helpers: `tests/acceptance/2118`
and `2647` (the gate-runner bench `bench.ts` follows), `31` (its `helpers.ts` gives the world, repos and temp folders),
`2699`, `33`.

## The surface under test

The hub's own `GateRunner.stop` and `verdictOf`, as the hub drives them at a stop: a claim's snapshot and checkout,
its approved check run in the fast lane, and the verdict the gate reads from the run and from what the claim changed
(`changesOf`, which the gate runs itself in the session's worktree with `git diff`, `git ls-files` and `git show`).

**Real:** the gate runner; the base-commit service (`openCheckouts` through #31's world), so the snapshot and checkout
are git's; the record; the verdict engine; the real git for every call the stub doesn't stand in for; the check's
program, a node script run in the checkout the gate names.

**Stands in:**
- the hub's run service at the gate's `start` and `ended`, as #2118's bench does: `ended` runs the program and records
  and keys the run as `runs.ts` does; the files the run read are its test file and the code it requires.
- git, at the process boundary: a `/bin/sh` script named `git`, first on this process's `PATH`, that execs the real
  git with the same arguments, except in the session's worktree while a mode is armed:
  - `diff-fails`: every `git diff` there exits 128 with a git-style `fatal:` message;
  - `ls-files-hangs`: every listing of tracked files there (`git ls-files` with none of `-o`/`--others`,
    `-i`/`--ignored`, `-v`, `--directory`, and no `GIT_INDEX_FILE`) hangs (it execs a long `sleep`).
  Each stubbed call is logged with its PID. A hang still running when the test ends is stopped by that PID, after
  checking `/proc/<pid>/cmdline` still shows the hang.

## Criteria to tests

IDs are `#1869.` plus the first 8 hex of the SHA-256 of the criterion's text after `- [ ] `, trimmed, white space
collapsed (`scripts/proof-change.mjs`), checked against the live issue body.

| ID | Criterion, in short | Test | On the base |
| --- | --- | --- | --- |
| `#1869.2a6f926a` | git stubbed to fail on `diff`, for a claim that edits an approved check's test file: the claim doesn't read PASS, and the check's line names the failed read; a runner that takes the error as no change passes the claim and fails, naming the check | `diff-fails.test.ts` | fails at `expect(v?.outcome).not.toBe('PASS')`: "the claim read PASS ...: approved check total passed it though the claim edits test/total.check.cjs, its own test file, because the failed read (git ... diff --name-only --no-renames <base>) was taken as no change" |
| `#1869.c671af33` | git stubbed to hang on `ls-files`: the claim gets a verdict other than PASS before its stop hold ends, naming the timed-out read | `ls-files-hangs.test.ts` | fails at `expect(replied).toBe(true)`: "the claim got no verdict before its 60 s stop hold ended: the stop was still waiting on the hung read (git ... ls-files)" |

### `#1869.2a6f926a` (diff-fails.test.ts)

1. **Control** (own bench, git unstubbed): the worktree edits `test/total.check.cjs`, the approved check `total`'s own
   test file, weakening its assertion so it still passes. The claim must read other than PASS with a line naming
   `total` and the file, else `BLOCKED` (the bench couldn't see the edit). On the base it holds.
2. **Stubbed** (fresh bench): the same edit, every `git diff` in the worktree failing. `BLOCKED` if the stub failed
   no diff, or the check never ran to a pass. Then: the stop replied within its hold; the verdict is not PASS, naming
   `total` and the failed read in the message; the verdict is made (not pending); and some line of the verdict names
   both `total` and `diff`.

### `#1869.c671af33` (ls-files-hangs.test.ts)

1. **Control** (own bench, git unstubbed): the worktree edits only the code under test (`src/price.cjs`, same
   behavior), so none of the check's own files changed: the claim must read PASS, else `BLOCKED`. So in the stubbed
   run a non-PASS can come only from the stuck read.
2. **Stubbed** (fresh bench): the same edit, tracked-file listings in the worktree hanging, with the hub's stop hold
   (`STOP_HOLD_MS`, 60 s, imported from the hub). The test waits for the stop to reply, bounded at the hold's end plus
   1 s (a `// deadline:` timer). `BLOCKED` if no `ls-files` was hung. Then: the stop replied before that bound; the
   verdict read at that moment is made (not pending) and not PASS; and some line of it names `ls-files`.

## Where the issue leaves the interface open, and what this suite chose

1. **Which `ls-files` hangs.** The snapshot (`checkouts.ts`) also lists files in the worktree; hanging those would
   stop the snapshot at its own 8 s budget and return before any read of what changed, so no fix could pass. The stub
   hangs only listings of tracked files without `-v` or an index of its own, which the snapshot never makes and
   `changesOf` does (`git ls-files`). A fix that reads the tracked files with `ls-files` in the worktree, with any
   extra options (`-z`, `-c core.fsmonitor=false`), still hangs. The `--others` listing is not hung.
2. **"Names the failed read" / "the timed-out read".** Read as a line of the verdict's `reasons` that names the git
   subcommand: `diff` (word-bounded) together with the check's ID for criterion 1, as "the check's line" says; and
   `ls-files` for criterion 2, in any line (the criterion names the claim, not a check). The wording around it
   (failed, timed out, deadline) is left to the fix.
3. **Not PASS means a made verdict.** Both tests also require the verdict not to be `pending` once the stop has
   replied: a pending claim reads no verdict at all, and criterion 2 asks for one.
4. **"Before its stop hold ends."** The hold is the hub's own (`STOP_HOLD_MS`, as `core.ts` gives `hold_ms`); the
   test allows 1 s past it for the reply to land, then reads the verdict as it stands. The fix's deadline value is
   not tested beyond that.
5. **Git's message on failure** is a stand-in (`fatal: unable to read the index: ...`); only the exit status matters.
6. Scope's other parts (fsmonitor off, at least the snapshot's output cap) are not criteria and have no test here.

## How to run

Node 24.22 (`.node-version`) first on `PATH`, the repo's `node_modules` installed:

```sh
npx vitest run tests/acceptance/1869-redraft --reporter=verbose
npx tsc -p tests/acceptance/1869-redraft/tsconfig.json
```

- No build needed: the tests import the packages' sources. Temp folders are #31's, under `/tmp/dh31-*`, removed after
  each file; HOME is a temp folder. No network, no model, no hub process.
- Processes started: git (through the stub), the stub's `/bin/sh` and its `sleep`, and the check's node script. A
  hung stub call is stopped by its logged PID at the end of the test.
- Time on the base: about 70 s, of which about 61 s is criterion 2 waiting out the stop hold. A fixed program should
  take as long as its read's deadline plus a few seconds.
- `BASE-FAILURE.txt` is this suite's run on `b87494f02`, colors stripped, the repo path shown as `<repo>`.
