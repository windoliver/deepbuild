# #1358 acceptance tests: deep hub start never kickstarts another home's hub job, and the login service carries HOME

Written blind at base `212f16d09`, from issue #1358, the design and the base. The drafting job saw nothing of the
implementing work: it read no other branch, no other worktree and no pull request. The base already holds code for this
issue's behavior, which landed without an acceptance suite, so these tests pass on the base and each is proven on a
planted wrong program instead (`twins/`). Per AGENTS.md the implementing agent doesn't edit these tests. A dispute goes
to a blind redraft by this job.

**Read:** the live body of #1358 (it names no other issue, and has no comments). AGENTS.md. In
`docs/technical-design.md`: How it installs (Setup, The hub, Platforms); How we know version 0 works (Clean test
processes; Criteria to tests, both ways; Closed issues stay proven; Criteria in a checked shape; Wrong programs; The
edit guard; Dogfooding; Tests written first; Where each layer runs); Fail before, pass after; Failing on an assertion.
At the base: `packages/hub/src/service.ts`, `underTemp` and `onPath` in `packages/hub/src/paths.ts`,
`tests/acceptance/2203/` whole (the model for this folder), the file lists of `1359/` and `2201/`, the lines of a few
other suites' files that name Linux or systemd, `scripts/proof-change.mjs` (`criterionId`, `readIssue`), the lines of
`scripts/proof-runs.mjs` on twins, the before lane and failing at an assertion, and the heads of `scripts/lease` and
`scripts/throttle.mjs`.

**Run**, from the checkout's root, so the root `vitest.config.ts` and its setup file apply as in the lanes:

```sh
npm ci                                  # once
npm run build --workspaces              # every test runs packages/cli/dist/main.js
node node_modules/vitest/vitest.mjs run tests/acceptance/1358/
node node_modules/typescript/bin/tsc -p tests/acceptance/1358/tsconfig.json
```

Four tests in two files, a second or two in all: no hub starts and nothing waits for one. `launchd.test.ts` holds the
three that run on macOS; `systemd.test.ts` holds the one that runs on Linux. On either platform the other's tests are
skipped as INCONCLUSIVE (below). The unit lane's vitest run picks both up
from `tests/**`; nothing outside this folder was edited. They need no network, no agent, no cargo and no `deep-hook`.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, computed from the live body on 2026-11-17. Twins are in `twins/`
(its README) and named in `twins.json`.

| Criterion | ID | Test | Wrong program it fails on |
|---|---|---|---|
| With `com.deepbuild.hub` already loaded from another home's plist, `deep hub start` starts nothing, exits 3, and names that plist and the `launchctl bootout` that frees the label. | `#1358.a5dca18a` | `launchd.test.ts`, first: the stand-in says the label is loaded from `<dir>/other/Library/LaunchAgents/com.deepbuild.hub.plist`; `deep hub start` in `<dir>/h` logs no `launchctl kickstart` and no `launchctl start`, exits 3, and its stderr holds that plist's path and a `launchctl bootout` of the label | `as-reported`: the stand-in logs `launchctl kickstart gui/<uid>/com.deepbuild.hub` |
| With it loaded from this home's own plist, `deep hub start` kickstarts it as before. | `#1358.1077c231` | `launchd.test.ts`, second: the stand-in says the label is loaded from `<home>/Library/LaunchAgents/com.deepbuild.hub.plist`; `deep hub start` in that home logs one `launchctl kickstart … gui/<uid>/com.deepbuild.hub` | `every-loaded-job`: no kickstart is logged |
| The login service's definition (plist and systemd unit) carries `HOME`, so the hub it starts reads and writes only the home that set it up. | `#1358.e5fdc397` | Two tests, one per definition. `launchd.test.ts`, third, on macOS: the plist `deep hub start` hands `launchctl bootstrap`, parsed by `plutil`, has `EnvironmentVariables.HOME` equal to the child's home. `systemd.test.ts`, on Linux: the one `*.service` file the command wrote under the empty home has, in `[Service]`, an `Environment=` assignment of `HOME` equal to the child's home | `as-reported`: the definition sets `PATH` alone |

## How the tests reach the code

- **`deep`** is the built CLI, `packages/cli/dist/main.js` of the checkout this folder is in, run as a child process
  under the Node that runs the tests. Nothing imports the code under test.
- **The service manager** is the one boundary stood in for, by shell scripts the test writes into `<dir>/bin`, first
  on the child's PATH. Each appends its name and arguments to a log and loads, starts and stops nothing.
  - `launchctl` answers as launchd does while the label is loaded, as the issue's Proof asks ("a launchctl stand-in
    that names the loaded job's path as `launchctl print` does"). `bootstrap` fails with launchd's words for a label
    already loaded (`Bootstrap failed: 5: Input/output error`, exit 5). `print gui/<uid>/com.deepbuild.hub` writes
    what `launchctl print` writes for a loaded LaunchAgent, with the plist the test named on its `path = ` line, and
    exits 0; for any other target it says the service can't be found and exits 113. Every other call, `kickstart`
    too, is logged and exits 1.
  - `systemctl` logs and exits 1 for every call.
- **A child's environment** is built from nothing: `HOME`, `PATH` (`<bin>:/usr/bin:/bin`), `SHELL=/bin/sh`,
  `XDG_CONFIG_HOME` (`<home>/.config`) and `DEEP_HUB_TEST_CONFIRM` (a file answering `cancelled`). No variable of the
  runner's reaches it, and `DEEP_HUB_LAUNCHER` is never set: the criteria are about what reaches `launchctl`.
- **Where the folders are.** Each test makes one folder, `/private/tmp/dh1358-*` (`/tmp/dh1358-*` on Linux), given by
  its real path. It holds the home `h`, `bin`, the confirmation file and, in the first test, the other home `other`
  with a plist of the label in it. The home and its `launchctl` are both under a temp folder, where the base's rule
  from #2203 (a temp home gets no login service unless its `launchctl` is a test's stand-in under a temp folder) lets
  the home through to `launchctl`. The folders are removed when the file ends.
- **The definitions are read as their service managers read them.** The plist is the last argument of the logged
  `launchctl bootstrap`, parsed by macOS's `/usr/bin/plutil -convert json`. The unit is the one `*.service` file under
  the home, which began empty; its `Environment=` lines in `[Service]` are read by systemd.exec(5)'s rules (items
  split on white space, double or single quotes, a backslash escape inside double quotes, an empty assignment
  resetting the list).
- **Skipped as INCONCLUSIVE, never a pass:** on a platform other than the test's own (below).
- **BLOCKED**, by a thrown error, never a pass or a skip: with no built CLI, or a build that can't load one of its modules; where a child is killed at its 120 s timeout; where
  `plutil` can't be run; and where the command handed over no definition, or more than one, so there is no one file to
  read `HOME` from.

## The other platform's tests

The third criterion names two definitions, and a test can read only the one its platform's `deep hub start` writes: on
macOS the command writes and hands over the plist and never a unit, and no surface the issue or design names makes it
write the other. So the criterion has two tests under its one tag, one per platform, and the first two criteria, which
name `launchctl`, are macOS's alone.

Off its platform a test is skipped through the test's own context, with a note: `INCONCLUSIVE: … read on Linux …; this
is darwin, … this is not a pass` (and `… read on macOS …; this is linux …` for `launchd.test.ts`). That is the base's
convention for a test that needs the other OS (`tests/acceptance/19/authority/`, `236/`, `1492/`, `14/crash.test.ts`
and more), and the lanes have a state for it: `isPlatform` in `scripts/lanes.mjs` reads a skip whose note names the
platform the machine lacks, and doesn't start with BLOCKED, as one no `skips` entry may cover, which leaves the lane
INCONCLUSIVE (platform). The lanes' reporter reports a thrown error as a plain `fail`, which the unit lane would read
as FAIL on this Mac for good, for a test that is not wrong; so the first draft's throw was redrafted to this skip.
Either way the half that wasn't read never passes: the trace lane counts a skipped test as no test, and the before
lane says of it that it proved nothing in this run.

So on macOS, where the lanes run, `systemd.test.ts` is skipped and the three tests of `launchd.test.ts` run. The unit
half of the third criterion is proven only by a run of `systemd.test.ts` on Linux, on the change and on `as-reported`.

## Where the issue is silent, or differs from the base

1. **"Starts nothing"** is pinned as: the stand-in logs no `launchctl kickstart` and no `launchctl start` (the two
   calls that start a loaded job). `launchctl bootstrap`, which the issue says comes first and which fails here, and
   `launchctl print` are free. The issue doesn't say whether the command may itself run `launchctl bootout`; none is
   asserted absent.
2. **"Names that plist"** is the other plist's full path, as the stand-in's `path = ` line gives it, somewhere on
   stderr. The issue doesn't say which stream; stderr is where the base's `deep hub start` says why it failed.
3. **"The `launchctl bootout` that frees the label"** is either form `launchctl` takes for it, somewhere on stderr:
   `launchctl bootout gui/<uid>/com.deepbuild.hub`, or `launchctl bootout gui/<uid> <that plist>`. The rest of the
   wording is free.
4. **"Already loaded"** is what the issue describes: `launchctl bootstrap` fails, and `launchctl print` of the label
   names the plist that loaded it. The other home's plist exists on disk. A job whose plist is gone, as a removed temp
   home's would be, is not tried.
5. **"This home's own plist"** is `<home>/Library/LaunchAgents/com.deepbuild.hub.plist`, where the issue shows a
   home's plist, given by the home's real path. A path that reaches the same file by a link (`/tmp/…` for
   `/private/tmp/…`) is not tried.
6. **"Kickstarts it as before"** is one logged `launchctl kickstart` whose last argument is
   `gui/<uid>/com.deepbuild.hub`, the target the issue writes. Flags before the target are free. The exit code is not
   asserted: the stand-in's kickstart starts nothing and exits 1, so the command exits 3 saying what launchctl said,
   on the base too. A stand-in that exits 0 would only add the hub's 15 s wait to each run.
7. **"Carries `HOME`"** is pinned to the value the criterion's own clause gives, the home that set it up: the child's
   `HOME`. A definition that sets `HOME` to anything else, the account's own home included, fails.
8. **"So the hub it starts reads and writes only the home that set it up"** is not run. It is the criterion's reason,
   and showing it needs a job started by a real launchd or systemd with the login user's environment, which no test
   here may reach. The tests hold what the criterion states of the definition.
9. **Where the unit is.** Neither the issue nor the design names the unit's file. The test takes the one `*.service`
   file under the home after the command, wherever it is, and is BLOCKED with none or several.
10. **A systemd unit loaded from another home** is in no criterion; criteria 1 and 2 name `launchctl` and the plist
    only. The base refuses such a unit too; nothing here tests it.
11. **Setup and the first `deep` command.** The issue's first line says `deep hub start`, "and so setup and the first
    `deep` command", can start another home's hub. Every criterion names `deep hub start`, so only it is run.
12. **The issue's Proof** names `packages/hub/test/onboarding.test.ts` and says the first and third fail on the merge
    base. That file is the implementing agent's; these tests don't edit or run it. The merge base the Proof speaks of
    is gone from this suite's reach, since the base already behaves as the criteria say; `as-reported` is that
    program, planted.
13. **The twins are the base's `service.ts`** with planted lines. A change that adds an export to `service.ts` which
    another module imports stops a twin from building; the lane then reads BLOCKED, and the twin goes to a redraft.

## Machine safety

No child reaches the real service manager: each gets both stand-ins first on PATH, checked before it starts, and a HOME
inside a folder this run made. No test names the account's real home or reads `~/.deepbuild`. No stand-in starts a
program, so no hub runs and nothing is stopped by PID. The suite's own `plutil` call only reads a file in the run's
folder. A run killed midway can leave `/private/tmp/dh1358-*` behind: scripts, logs, a plist no launchd reads and a
`.deepbuild` folder with an empty `logs` in a test home, no process and no secret. The suite never removes one by name,
since another session's run may own it.

## What the drafting job ran, and what it did not

On 2026-11-17, in a fresh clone at the base built with `npm ci` and `npm run build --workspaces`, Node 24.22.0, vitest
5.0.5, macOS 27.2. The Mac was heavily loaded by other sessions throughout (`sysctl -n vm.loadavg` between 250 and 380
at every run); no test timed out. Every run was the plain command above, not under `scripts/throttle.mjs` or
`scripts/lease`: both act in the account's real `~/.deepbuild`, which this job may not reach.

- **The typecheck,** `tsc -p tests/acceptance/1358/tsconfig.json`: exit 0, on the files as they are now.
- **The suite on the base, twice,** before the twins and after the sources were restored, the same both times: exit 0,
  4 tests, 3 pass, 1 skipped. The three in `launchd.test.ts` pass. The one in `systemd.test.ts` is skipped with its
  INCONCLUSIVE note, this being macOS. `BASE-RUN.txt` holds the second run.
- **The same once more through the lanes' reporter** (`--reporter=scripts/proof-vitest-reporter.mjs`): three `pass`
  rows and one `skip` row whose `note` is the test's own, starting `INCONCLUSIVE:` and naming Linux and darwin.
- **Each twin:** its `service.ts` laid over `packages/hub/src/service.ts`, `npm run build -w packages/hub` (exit 0 for
  both, so each builds), the suite, then `git checkout -- packages` and the same build again.
  - `as-reported`: `#1358.a5dca18a` fails at `launchd.test.ts:24`, its first `expect`, an `AssertionError` with
    `launchctl kickstart gui/<uid>/com.deepbuild.hub` in the stand-in's log. `#1358.e5fdc397` (the plist) fails at
    `launchd.test.ts:57`, an `AssertionError`: `EnvironmentVariables` holds `PATH` alone. `#1358.1077c231` passes.
  - `every-loaded-job`: `#1358.1077c231` fails at `launchd.test.ts:40`, an `AssertionError`: the stand-in logged the
    bootstrap and the print, and no kickstart. The other two tests of `launchd.test.ts` pass.
  - On both, `systemd.test.ts` is skipped as on the base.
- **The first draft,** whose off-platform tests threw BLOCKED, was run the same way before the redraft: the same
  passes and the same twin failures at the same expects (one line earlier), with `systemd.test.ts` failing on its
  throw.
- **The unit's reader,** `unitEnvironment`, by a throwaway Node script on four unit texts written by hand (the base's
  quoted form, one with no `HOME`, two bare lines, and a reset followed by single and double quotes with escapes): each
  read as systemd would read it.
- **Left behind:** nothing. After each run no `/private/tmp/dh1358-*` folder was left, and the clone's `git status`
  showed this folder alone.

Did not run: `systemd.test.ts` on Linux, on the base or on `as-reported`, so the unit half of `#1358.e5fdc397` has been
seen neither passing nor failing on a wrong program, and its helpers' Linux paths (the folder under `/tmp`, the search
for the unit) have not run; `atAssertion` over the twins' failures, which were read from vitest's plain output only (each an `AssertionError` whose innermost frame is in `launchd.test.ts`); `spans()` over the
test files; `scripts/proof.mjs` or any lane of it; `scripts/affected.mjs`; the preflight; `cargo`, which nothing here
needs; `packages/hub/test/onboarding.test.ts`.

## Files

- `launchd.test.ts`: the three tests that run on macOS.
- `systemd.test.ts`: the one test that runs on Linux.
- `helpers.ts`: the folders, the homes, the stand-ins, `deep` as a child process, and the two definitions' readers.
- `twins.json`, `twins/`: the planted wrong programs, and `twins/README.md`.
- `tsconfig.json`: for the typecheck above; it leaves `twins/` out, whose files only build in place of the real one.
- `BASE-RUN.txt`: the run at the base, the checkout's path cut out, with the twins' results.
