# Acceptance tests for #2584: supervisor's listening() reads lsof's mount warnings as a failure, so a free port reads as taken

Written first, blind, from issue #2584 (its cause, effect, "Not reproduced" note and two acceptance criteria) as the
brief quoted it, the design and base commit `eb027b613` ("Merge pull request #2928 …"), by a job that never saw an
implementation; none existed, and no other branch, worktree, pull request or stash was read, nor the live issue. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one file, five tests, modeled on #2564's suite.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2584.ae5eab8b` | `listening.test.ts` (2): a free port with the mount warning answers `{ pids: [], empty: true }`; a listening port with the warning still yields its PID |
| AC2 | `#2584.6f1bcc3c` | `listening.test.ts` (3): exit 1 with a real error (and the warning); lsof missing; lsof killed by a signal with only the warning on stderr |

The IDs are `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text, first 8 hex) over each criterion's text as
the brief gave it, after `- [ ] `; the live issue body wasn't read, so they aren't checked against it. Each test's name
starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md` (Dogfooding).
- At the base: `packages/supervisor/src/procs.ts` (`listening`: lsof by absolute path, no `-w`, rejects on any error
  unless exit 1 with empty stdout and stderr), `packages/supervisor/src/index.ts` (exports `listening`),
  `packages/supervisor/package.json`, `scripts/proof-change.mjs` (`criterionId`), suite `2564/` (README, tsconfig,
  BASE-FAILURE), `packages/leases/test/liveness.test.ts` (its `vi.mock('node:child_process')` stand-in for `ps`,
  copied here), `tests/acceptance/1495/app-download.test.ts` (imports the supervisor's source entry).

## Readings where the issue leaves a choice

- **`listening`**: the supervisor's public entry, imported from source (`packages/supervisor/src/index.ts`) as
  `1495/` does, so no build is needed and a source fix is judged directly.
- **The lsof stand-in**: lsof is the OS's, a boundary the repo doesn't own, and `listening` runs it by absolute path
  (`/usr/sbin/lsof` on darwin, `/usr/bin/lsof` otherwise), so a stand-in on `PATH` can't reach it. The suite mocks
  `node:child_process`'s `execFile`, and only for a file ending `/lsof` while a test arms it; every other call passes
  through to the real one. Armed, it runs the **real lsof** with the same arguments and adds the warning a machine with
  a mount lsof can't stat makes lsof print, unless `-w` is among the arguments (real lsof's `-w` suppresses warnings).
  So a fix that passes `-w` and a fix that tolerates the warning are both judged against what real lsof does; neither
  is assumed. The warning is lsof's form (`lsof: WARNING: can't stat() tracefs file system …` and its
  `Output information may be incomplete.` line), the tracefs case the issue names.
- **"a port nothing listens on"**: one the OS just handed out on 127.0.0.1 and took back. A precondition checks that
  real lsof, unarmed, answers it as empty first.
- **"fails for another reason"**: three ways. (a) exit 1 with a real error: the stand-in gives the real lsof the same
  arguments plus a name that doesn't exist (`/nonexistent-2584`), so real lsof prints `status error on …` and its usage
  and exits 1; the mount warning is prepended unless `-w` (modeled: that lsof prints both on such a machine is assumed,
  not seen). The test wants a rejection naming that error. (b) lsof missing: the stand-in runs a path that doesn't
  exist (ENOENT). (c) lsof killed by a signal (`SIGKILL`, exit code null) after printing only the warning, empty
  stdout: guards a fix that drops warning lines but no longer looks at how lsof ended.
- **Optional, under AC1**: a port this test process listens on, with the warning present, still yields
  `{ pids: [process.pid], empty: false }` (lsof exits 0 there, so this passes on base too).

## Run them

With the repo's Node (`.node-version`, 24.22.0), on macOS or Linux with lsof installed:

```sh
npm ci                                  # once, if node_modules is missing
node node_modules/vitest/vitest.mjs run tests/acceptance/2584
node node_modules/typescript/bin/tsc -p tests/acceptance/2584/tsconfig.json
```

About 1 s. Binds only ephemeral ports on 127.0.0.1, closed after each test; starts no process beyond lsof. No
network, sign-in or model call.

## Base results

`BASE-FAILURE.txt` is the run at the base, whole, with the checkout's path replaced by `<repo>`, on macOS (arm64):
1 failed, 4 passed. AC1's free-port test fails for the issue's reason: `listening` rejects with
"lsof can't list port N's listeners: lsof: WARNING: can't stat() tracefs file system …". The other four pass on base,
as expected: the listening-port test because lsof exits 0 there, and AC2's three because the base already rejects them;
they guard against a fix that swallows every lsof failure.

No fix was tried against the suite.

## Not tested, because no criterion reaches it here

The callers (`packages/env-local/src/stack.ts`'s `unlisted` and others) reading the answer; lsof's behavior on a
machine that really has such a mount (none here, as the issue's "Not reproduced" says).
