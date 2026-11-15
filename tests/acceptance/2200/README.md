# Acceptance tests for #2200: a deep command with arguments it can't read sets nothing up, and a flag is never read as an argument

Written first and blind, at base commit `72fe11a11`, from issue #2200, the design and the base, before any
implementation. The drafting job saw nothing of the work: no other checkout, branch, pull request or commit past the
base. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). There is no taste criterion, so no `TASTE.json`.

## What was read

- **Issue #2200**, its live body read with `gh issue view` on 2026-11-14 at 23:23Z: the revision with `updatedAt`
  2026-11-14T23:10:43Z, no comments. The criterion IDs below are computed from that body. Its linked audit report
  and the issues it names (#2196, #2176, #1812, #326, #1453) were not opened: the body states what this suite needs.
- `docs/technical-design.md`: How it installs (Setup, The hub, Platforms); How we know version 0 works (Criteria to
  tests, Criteria in a checked shape, Wrong programs, The edit guard, Dogfooding); Fail before, pass after, Failing on
  an assertion and Proven on the base. One hub per user was read by its heading and the hub's login service only.
- `AGENTS.md`.
- At the base: the first-run block and the command table in `packages/cli/src/main.ts`; `deep --help`'s output;
  `tests/acceptance/19/doctor/{helpers.ts,contract.test.ts,fixtures/stub-bin.sh}`; `tests/acceptance/326/setup/`
  (`first-command.test.ts`, its twins); the READMEs and layouts of `tests/acceptance/2197` and `tests/acceptance/2201`;
  `scripts/proof-change.mjs` (criterion IDs, test paths) and `scripts/proof-runs.mjs` (the before lane, twins).

## Run

```
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/2200
node node_modules/typescript/bin/tsc -p tests/acceptance/2200/tsconfig.json
```

- **Needs** the built CLI (`packages/cli/dist/main.js`, so `npm run build --workspaces`) and the built `deep-hook`
  that setup copies (`target/debug/deep-hook`), as #19's doctor suite does. Node 24.22 or newer.
- **What it starts and stops.** Each test runs `deep` as a child process, once or twice, each in a temporary folder of
  its own under `/tmp/dh19d-*` (#19's `tempDir`). `HOME` is there, so nothing touches the real `~/.deepbuild`,
  `~/.claude` or the machine's login services. It starts no hub. It stops only what it started, by PID (#19's
  `cleanup`), and removes its folders. No network, no model call, no git command on this checkout.
- **No timing is read.** Nothing asserts how long a command takes.

## The surface

The real `deep` command: the built CLI run as a child process, read by its exit code, the files under its temporary
folder and the stand-ins' `calls.log`, with stdout and stderr only quoted in a failure's message. No CLI or hub module
is imported. `../19/doctor/helpers.ts` is imported unchanged for the home, the stand-ins, the runner, and
`deepEntries`/`readSettings` (DeepBuild's hook entries in Claude Code's user settings).

**The home** (`helpers.ts`, `freshHome`): #19's `makeHome`, then the launcher stand-in replaced by one that refuses.

- `<tmp>/h` is `HOME`. It holds what a signed-in Claude Code and Codex leave (`.claude/`, `.codex/`, `.claude.json`)
  and no `.deepbuild`.
- `<tmp>/bin` is first on `PATH` and holds the stand-ins: `launchctl` and `systemctl` (#19's `stub-bin.sh`: log the
  call, exit 0), so the service manager is stood in for on macOS and on Linux alike, and `launcher`, which
  `DEEP_HUB_LAUNCHER` names (`fixtures/refusing-launcher.sh`: log the call, exit 1). Each call is one line of
  `<tmp>/bin/calls.log`.
- The launcher refuses because the issue's "today" does ("with a launcher stand-in that refuses"), and so that no
  command waits for a hub that will not come.
- **"No new file"** is read over the whole temporary folder, the home and the stand-ins' folder both: every file by
  its bytes' digest, and every folder, so a `.deepbuild` made and left empty counts, and so does a file rewritten.
- **"The stand-ins log no call"** is an empty `calls.log`, the agent stand-ins' calls included.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, computed from the live body; `criteria.json` lists them with their
text. Each test's name starts with its ID.

| # | ID | Criterion | Tests | On the base |
|---|---|---|---|---|
| 1 | `#2200.3594285f` | A usage error sets nothing up: `deep status --typo` | `usage.test.ts`: `deep status --typo in a home with no .deepbuild exits 2, leaves no new file and the stand-ins log no call` | fails at its assertion |
| 2 | `#2200.3e626bd2` | The same for the other eight, and `deep env` with no arguments | `usage.test.ts`: nine tests of the same name, one each for `deep inbox --typo`, `deep secret --typo`, `deep off --typo`, `deep on --typo`, `deep env --typo`, `deep install --typo`, `deep guard --typo`, `deep memory --typo` and `deep env` | each fails at its assertion |
| 3 | `#2200.b9e90749` | The first command still sets up | `first-command.test.ts`: `deep status in a home with no .deepbuild sets up as on the merge base: …` | passes; fails on the twin `never-sets-up` |
| 4 | `#2200.0122400d` | A flag isn't an argument | `flags.test.ts`: four tests, `deep open --typo`, `deep backup --typo`, `deep run follow --typo`, `deep session rules --typo`, each `is a usage error: exit 2` | each fails at its assertion (exit 1, 1, 1, 3) |
| 5 | `#2200.5fb61214` | #19 AC16's contract test passes on main, unchanged | none here: `tests/acceptance/19/doctor/contract.test.ts`, by its own run (below) | fails; see `CONTRACT-BASE.txt` |

## The reading of each criterion

1. **Criteria 1 and 2 are one assertion per command**: `{exit, written, called}` equals `{2, [], []}`. The three
   values are held together so the failure names all three on either platform. On this Linux machine the base already
   exits 2 for these commands, after setting up; the issue's "exits 3" is the reference Mac's reading. Both fail the
   assertion, on the files and the call.
2. **"An unknown flag"** is `--typo`, the issue's own, as the command's only argument.
3. **"The other eight"** are the eight the criterion lists, plus `deep env` with no arguments: nine runs. `deep env
   --root …` and bare `deep` are not in the criterion and are not run. `deep inbox answer` and `deep status x y`,
   which the issue's "What happens today" also names, are in no criterion and are not run here; the contract test
   reaches such forms.
4. **Criterion 3, "setup runs as on the merge base"**, is read by what the base leaves behind when `deep status` is
   the first command in the same home:
   - the home holds the five files the issue's "What happens today" names (`.claude/settings.json`,
     `.claude/skills/deepbuild/SKILL.md`, `.claude.json`, `.deepbuild/config.json`, `.deepbuild/rules.json`), new or
     rewritten;
   - Claude Code's user settings hold DeepBuild's hook entries;
   - the launcher stand-in is called with a login-service file that setup wrote under the home;
   - the exit code is 3: the launcher refused, no hub answers, and `deep status` says so. This is the base's value
     on this machine. The sentence it prints is #1812's and is not read;
   - the set of files written and the stand-ins' calls equal those of `deep setup` in a second fresh home (the design:
     "the first `deep` command does the same without a click"). A copy kept under `.deepbuild/originals/<digest>`
     counts by its folder. This keeps any platform's list of files out of the test.
   The one line setup prints, and the watch-only behaviour after it, are #326's and stay in its suite.
5. **Criterion 3's wrong program** is the twin `never-sets-up` (`twins.json`, `twins/README.md`): the test passes on
   the base, so the before lane needs a planted program it fails on.
6. **Criterion 4 reads the exit code alone**, as the criterion does, in the same fresh home with no hub. That these
   four also write nothing and call nothing is the contract test's, not repeated here. That each still takes a real
   argument (`deep open ask/<id>` and so on) is not tested here: no criterion names it, and the commands' own suites
   hold it.
7. **Criterion 5 has no test in this folder.** Its proof is `tests/acceptance/19/doctor/contract.test.ts` passing,
   unchanged, by its own run:
   `node node_modules/vitest/vitest.mjs run tests/acceptance/19/doctor/contract.test.ts`. That file's tag is #19's, so
   the trace lane finds no test tagged `#2200.5fb61214`; whether that stands is the owner's call, with `deep lease`
   (the issue's Scope). Its result on this base is in `CONTRACT-BASE.txt`: it fails with 26 lines on this Linux
   machine, where the issue counts 38 on the Mac. 16 are a usage error that ran setup, 3 are `deep memory keep`,
   `remove` and `overrule` exiting 3, 5 are a flag read as an argument (the issue's four and `deep host run`, exit 1,
   which the issue does not list), 1 is `deep lease`'s 127 and 1 is `deep kinds`' stack trace. `deep host run` is in
   no criterion's list, so no test here runs it; criterion 5 can't pass while that line stands.

## What the drafting job ran, and what it did not

Ran on a Linux arm64 machine (the reference machine is a Mac), Node 24.22.0, loaded by other runs:

- **At the base, in the checkout:** the Run command. 15 tests, 14 fail, 1 passes (`BASE-FAILURE.txt`, part 1); every
  failure is the test's own `expect`. The type check passes.
- **On the twin `never-sets-up`,** laid by hand over a copy of the base's `packages/cli` in a scratch folder outside
  the repository and built with `tsc -p`: 5 fail, 10 pass (`BASE-FAILURE.txt`, part 2). The criterion 3 test fails at
  its first assertion; the ten tests of criteria 1 and 2 pass, so they can.
- **The contract test at the base,** once: `CONTRACT-BASE.txt`.

Not run:

- **macOS.** Nothing here was run on a Mac. The stand-ins cover `launchctl` as they cover `systemctl`, and the tests
  name no platform's file, but the base's exit code for the usage errors (3 there, 2 here), the nine files the issue
  counts and the plist path were not seen. Criterion 3's comparison with `deep setup` holds on the Linux base; on the
  Mac it is the design's sentence, not a reading.
- **The proof lanes** (`scripts/proof.mjs`'s before and trace lanes) and `scripts/affected.mjs`: they read a change,
  and there is none yet. The twin was not laid by the lane itself.
- **A fix.** Criterion 4's tests were not seen passing; each is one comparison of an exit code with 2.
