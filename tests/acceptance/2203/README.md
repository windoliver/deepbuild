# #2203 acceptance tests: a deep command in a temp home never loads a hub into the real service manager

Written first and blind at base `1c4d1f0e2`, from issue #2203, the design and the base, before any fix. The drafting job
saw nothing of a fix: it read no other branch, no other worktree and no pull request of this issue. Per AGENTS.md the
implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

**Read:** the live bodies of #2203 and of the issues it names: #1358, #1359, #1002, #667. #2196, which the task listed
with them, is the audit's merged pull request; its body was read the same way and holds nothing of #2203's fix.
AGENTS.md. In `docs/technical-design.md`: the component table's hub, deep-hook and CLI rows; How it installs (Setup, The
hub, Platforms); How we know version 0 works (Clean test processes; Criteria to tests, both ways; Closed issues stay
proven; Criteria in a checked shape; Wrong programs; The edit guard; Dogfooding; Tests written first; Where each layer
runs); Fail before, pass after; Failing on an assertion; and What done means, for a check that must fail on the base at
its assertion. At the base: `packages/hub/src/service.ts`, `setup.ts`, `setup-steps.ts`, `paths.ts`, `hub-command.ts`,
`doctor.ts` to its `hub.service` item, the head of `plant.ts` and of `inbox.ts`'s command, `packages/cli/src/main.ts`,
`contracts/setup-steps.json`, `packages/hub/test/onboarding.test.ts`, `tests/vitest-setup.ts`, `vitest.config.ts`, the
package scripts, `.gitignore`, the ask settings setup drafts (`packages/asks`) and, by search, the lines under
`packages/` that start the hub or run a program by name. For their shape: `tests/acceptance/2201/` (README, twins, the
heads of its test and `BASE-FAILURE.txt`), `1359/` (README, helpers, fixtures, `setup-lines.test.ts`, the head of
`BASE-FAILURE.txt`), `1002/` (README's head, helpers to line 224), the lines of `667/helpers.ts` that make its homes
and environment, the head of `2293/README.md`, and the `tsconfig.json` and `twins.json` of a few more. The lanes:
`scripts/proof-change.mjs`, `proof-runs.mjs` (temporary copies and bays, twins, the before lane, failing at an
assertion), `lanes.mjs` (test paths, the unit lane, its alone, slow, by-hand and timed lists), the heads of
`scripts/lease` and `throttle.mjs`, and the lines of `bays.mjs` that name where a bay is. On the machine, read only:
that `/Users/Shared` exists and takes a new folder.

**Run**, on macOS, from the checkout's root, so the root `vitest.config.ts` and its setup file apply as in the lanes:

```sh
npm ci                                  # once
npm run build --workspaces              # every test runs packages/cli/dist/main.js
cargo build --locked -p deep-hook       # the second test: setup's hook entries name it
node node_modules/vitest/vitest.mjs run tests/acceptance/2203/temp-home.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/2203/tsconfig.json
```

Four tests in one file, about two seconds in all: no hub starts and nothing waits for one. The unit lane's vitest run
picks the file up from `tests/**`; nothing outside this folder was edited. It needs no network, no agent, no cargo on
PATH. On a machine with the throttle, each of the last two lines runs as
`node scripts/throttle.mjs test --wait 600 -- scripts/lease <the line>`.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, computed from the live body on 2026-11-12. Twins are in `twins/`
(its README) and named in `twins.json`.

| Criterion | ID | Test | Wrong program it fails on |
|---|---|---|---|
| A temp home loads nothing. | `#2203.3f4ab016` | `deep hub start` in a home under `/private/tmp`, no launcher named, the `launchctl` stand-in outside every temp folder first on PATH: the stand-in logs no `launchctl bootstrap`, the command exits 3, and stderr names a temp home and the login service | The base: the stand-in logs `launchctl bootstrap gui/<uid> <home>/Library/LaunchAgents/com.deepbuild.hub.plist` |
| The same through setup. | `#2203.ca54c4b1` | `deep inbox` in another such home, empty, so it runs setup: the stand-in logs no bootstrap. First, the same command with the stand-in under a temp folder must log one, or the test is BLOCKED | The base: setup's hub start logs the bootstrap |
| A real home loads as before. | `#2203.e7d67ec1` | `deep hub start` in a home outside every temp folder, the same kind of stand-in: it logs a bootstrap of that home's plist | The twin `every-home`. It passes on the base |
| A test that names a launcher is unchanged. | `#2203.c433bc9f` | `deep hub start` in a temp home that names a launcher, the `launchctl` stand-in outside every temp folder: the launcher is handed that home's plist, once, and the stand-in logs no bootstrap | The twin `launcher-ignored`. It passes on the base |

On the base the first two fail at their first `expect`, lines 18 and 39 of the test file, and the last two pass
(`BASE-FAILURE.txt`). The last two are proven on their twins. Each failure message carries the child's command, exit
code, output and the stand-ins' logs.

## How the tests reach the code

- **`deep`** is the built CLI, `packages/cli/dist/main.js` of the checkout this folder is in, run as a child process
  under the Node that runs the tests. Nothing imports the code under test.
- **The service manager** is the one boundary stood in for. A stand-in is a three-line shell script the test writes: it
  appends its name and arguments to `<file>.log`, loads and starts nothing, and exits 1. `launchctl` and `systemctl`
  stand-ins sit in one `bin` folder, first on the child's PATH. The launcher of the fourth test is the same script,
  named through `DEEP_HUB_LAUNCHER`.
- **A child's environment** is built from nothing: `HOME`, `PATH` (`<bin>:/usr/bin:/bin`), `SHELL=/bin/sh`,
  `XDG_CONFIG_HOME`, `DEEP_HUB_TEST_CONFIRM` (a file answering `cancelled`) and, in the fourth test only,
  `DEEP_HUB_LAUNCHER`. No variable of the runner's reaches it.
- **Where the folders are.** A temp home is `/private/tmp/dh2203-*/h`, where the issue saw the leaked hub's home. A
  folder outside every temp folder is `/Users/Shared/dh2203-*`, made with `mkdtemp`, so only this user reads it. macOS
  has `/Users/Shared` on every Mac and any user may make a folder there. It is under none of the temp folders
  `deep doctor` lists, and under no account's home, so a test can't land in a real `~/.deepbuild`. Its path is short
  (a hub socket there is 49 bytes, under macOS's 104) and holds no user name. It does not depend on the checkout: the
  lanes run tests in copies under the system's temp folder, where a folder inside the checkout would be a temp folder
  too. Both kinds hold only stand-ins, their logs and one home, and are removed when the file ends.
- **BLOCKED**, by a thrown error, never a pass or a skip: off macOS; with no built CLI, or a build that can't load one
  of its modules; with no `deep-hook` built (the second test); where `/Users/Shared/dh2203-*` can't be made or counts
  as a temp folder in this run (`TMPDIR`); where the second test's control logs no bootstrap; and where a child is
  killed at its 120 s timeout.

## Where the issue is silent, or differs from the base

1. **"Outside every temp folder"** is read by the list in `packages/hub/src/doctor.ts` at the base: `os.tmpdir()`,
   `$TMPDIR`, `/tmp`, `/private/tmp`, `/var/folders`, `/private/var/folders`, each as written and by its real path.
   The suite checks its `/Users/Shared` folder against the same list and is BLOCKED if it falls under it.
2. **"A home under a temp folder"** is tried under `/private/tmp` only, given by its real path as the issue's
   `launchctl print` shows it. A home under `/var/folders` or `$TMPDIR` is not tried.
3. **The stand-in refuses.** It exits 1 for every call, as #1359's does. So on the base `deep hub start` logs the
   bootstrap, then a print and a kickstart, and exits 3 saying only `launchctl:`. The exit code alone doesn't tell the
   base from a fix; the bootstrap and the words do, and the bootstrap is asserted first. A stand-in that exits 0 would
   only add the hub's 15 s wait to each run.
4. **"No launcher named"** is `DEEP_HUB_LAUNCHER` unset, the seam in `service.ts`. `DEEP_HUB_TEST_CONFIRM` is set in
   every child: without it setup on a Mac sets up a Secure Enclave key. It names no launcher.
5. **"Saying a temp home gets no login service"** is pinned as: stderr holds `temp` or `temporary` as a word, and
   `login service`, in any case. The rest of the wording is free. A message that names only `/tmp` fails.
6. **"Logs no bootstrap"** counts `launchctl bootstrap` calls only. A fix may ask the stand-in to `print`.
7. **Criterion 2 says nothing of the exit code or the words**, and none is asserted: on the base the first command
   returns 0 from setup once an agent's settings changed, and goes on to its own job. There `deep inbox` then exits 3
   with a line of its own, `BLOCKED: ENOENT … control.token`, said of the hub that isn't running. That word in a
   failure's quoted output is the command's, never this suite's. Its control is the Scope's second
   bullet: a temp home whose `launchctl` is under a temp folder loads as today. A setup that stopped before its hub
   start (a stale `deep-hook`, a step that threw) would log no bootstrap either, and the control tells that from the
   rule. It throws BLOCKED and is no assertion, so a base run that fails there proves nothing. A fix that refuses every
   temp home, wherever its `launchctl` sits, reads BLOCKED here with its own words in the output.
8. **"Logs the bootstrap"** (criterion 3) is at least one `launchctl bootstrap` whose last argument is
   `<home>/Library/LaunchAgents/com.deepbuild.hub.plist`. The domain and the exit code are not asserted.
9. **Criterion 4's own observable, #1359's and #1002's suites passing as they are, is not run from here.** #1002's
   files are on the lanes' slow list, build the app and start real hubs. The change's own run of the two suites,
   unedited, must show them passing; whether `scripts/affected.mjs` picks both for a change to `service.ts` was not
   checked. This suite's test holds what they rely on, a temp home that names a launcher still handing its definition
   to that launcher, and holds it where the rule would bite hardest: with the `launchctl` outside every temp folder,
   where the same home naming no launcher is refused. In those suites the `launchctl` stand-in sits under a temp
   folder. The launcher here refuses, as #1359's `refusing-launcher` does.
10. **Linux** is not tested: the Scope says every home there loads as today, and no criterion names it.
11. **PATH holds no folder of Node's.** The repository's own test homes put Node's folder on PATH; this suite leaves
    it out. So setup finds no agent's program beside Node (`pi`, `paseo`) and no cargo: it runs Claude Code's step
    alone and can't start a build. By reading, nothing on setup's way to the hub start runs `node` by name.
12. **The twins are the base's `service.ts`** with planted lines. A fix that adds an export to `service.ts` which
    another module imports stops a twin from building; the lane then reads BLOCKED, and the twin goes to a redraft.
13. **The issue's Proof** names `packages/hub/test/onboarding.test.ts`. That file is the implementing agent's. These
    are the acceptance tests AGENTS.md asks for, and they don't edit or run it.

## Machine safety

No child reaches the real service manager: each gets the stand-ins first on PATH, checked before it starts, and a HOME
inside a folder this run made. No stand-in starts a program, so no hub runs and nothing is stopped by PID. A run killed
midway can leave `/private/tmp/dh2203-*` and `/Users/Shared/dh2203-*` behind: they hold scripts, logs, a plist no
launchd reads and setup's files in a test home, no process and no secret. The suite never removes one by name, since
another session's run may own it.

## What the drafting job ran, and what it did not

Phase 1, with no `node_modules` and no build in the checkout: nothing was built or run. The IDs were computed from the
live body with `criterionId`'s own expression. Each twin was diffed against the base's `service.ts`: 6 and 3 added
lines, none changed.

Phase 2, on the base built by the caller (`npm ci`, `npm run build --workspaces`, `cargo build --locked -p deep-hook`),
with Node 24.22.2 and vitest 5.0.5 on macOS 27.2, each command under the throttle's test grant and `scripts/lease`,
which found no hub and ran it unleased:

- **The typecheck,** `tsc -p tests/acceptance/2203/tsconfig.json`: exit 0, twice, before and after the one edit below.
- **The suite, four times,** twice plain and twice through the lanes' reporter, once each before and after the one
  edit below, each with the same result: 4 tests, 2 fail, 2 pass; the plain runs took 2.3 s and 1.5 s.
  `#2203.3f4ab016` and `#2203.ca54c4b1` fail at their first `expect` with the bootstrap of the temp home's plist in
  the stand-in's log; `#2203.e7d67ec1` and `#2203.c433bc9f` pass. That is what the issue says of the base.
  `BASE-FAILURE.txt` holds the last plain run.
- **The lanes' rule for a failure at an assertion:** the reporter runs wrote their report through
  `scripts/proof-vitest-reporter.mjs`, read with a throwaway copy of `frames`, `asserted` and `atAssertion` from
  `scripts/proof-runs.mjs`, a plain Node script. Both failures read as at an assertion, their innermost frame in
  `temp-home.test.ts`.
- **`spans()`** from `scripts/proof-change.mjs` over the test file, by a Node one-liner: four tests, each named with
  its tag, none skipped, each registering whenever the file runs. `twins.json`'s keys are two of those tags.
- **One edit after the first two runs,** to a message only: `helpers.ts` ends what a run shows with a line of its own,
  `(end of the run)`. The runner appends what it expected to a message's last line, which was the stand-in's last
  logged call. No assertion, path or test name changed.
- **Left behind:** nothing. After each run no `/private/tmp/dh2203-*` or `/Users/Shared/dh2203-*` folder was left.

Did not run: the twins, laid, built or tested, so the last two tests have not been seen failing on a wrong program;
`scripts/proof.mjs` or any lane of it; `scripts/affected.mjs`; the preflight; #1359's and #1002's suites; anything on
Linux, where every test here would read BLOCKED.

## Files

- `temp-home.test.ts`: the four tests.
- `helpers.ts`: the folders, the home, the stand-ins, and `deep` as a child process.
- `twins.json`, `twins/`: the planted wrong programs, and `twins/README.md`.
- `tsconfig.json`: for the typecheck above; it leaves `twins/` out, whose files only build in place of the real one.
- `BASE-FAILURE.txt`: the run at the base, the checkout's path and the user's launchd domain cut out.
