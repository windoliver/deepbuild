# Acceptance tests for #2581: a `deep` flag is still read as a value in six forms

Written first and blind, at base commit `9e98f86de` (the head of PR #2557 for #2200, which this issue depends on), from
issue #2581, the design and the base, before any implementation. The drafting job saw nothing of the work: no other
checkout, branch, pull request or commit past the base. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). There is no taste criterion, so no
`TASTE.json`.

## What was read

- **Issue #2581**, its live body read with `gh issue view` on 2026-11-20: the revision with `updatedAt`
  2026-11-20T10:03:00Z. The criterion IDs below are computed from that body. #2200 and PR #2557 were not opened beyond
  what the base holds.
- `docs/technical-design.md`: Criteria to tests, Wrong programs, Fail before, pass after, Failing on an assertion,
  Dogfooding.
- `AGENTS.md`.
- At the base: `tests/acceptance/2200/` (the template: README, helpers, tests, twins), `tests/acceptance/19/doctor/helpers.ts`
  and its `fixtures/stub-bin.sh`; the forms the issue's Scope names, `packages/hub/src/hub-command.ts`, `list.ts`,
  `env.ts`, `install.ts`, `secret-command.ts`, `rules.ts` (`rulesCommand`), `hosts.ts` (`changes`), with
  `service.ts` (`startHub`, `stopHub`), `authority.ts` (`useCommand`), `server.ts` (`runHub`'s start), `paths.ts`
  (`rootOf`); the first-run block and dispatch in `packages/cli/src/main.ts`; `scripts/proof-change.mjs` (criterion
  IDs) and `scripts/proof-runs.mjs` (the before lane, twins).

## Run

```
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/2581
node node_modules/typescript/bin/tsc -p tests/acceptance/2581/tsconfig.json
```

- **Needs** the built CLI (`packages/cli/dist/main.js`, so `npm run build --workspaces`) and the built `deep-hook`
  (`target/debug/deep-hook`), which setup copies when a wrong program runs it. Node 24.
- **What it starts and stops.** Each test runs `deep` as a child process, once, in a temporary folder of its own under
  `/tmp/dh19d-*` (#19's `tempDir`). `HOME` is there, so nothing touches the real `~/.deepbuild`, `~/.claude` or the
  machine's login services. It stops only what it started: the child by PID (#19's `own`/`cleanup`), and a dev hub a
  wrong `deep hub start --root --typo` spawned detached (so no PID of the test's) by asking that hub to stop through
  its own socket, `deep hub stop --root <tmp>/e/--typo` with the absolute path. Nothing is stopped by name or port. No
  network, no model call.
- **No timing is read.** A command may take up to 300 s (`RUN_MS`) before it is stopped, a test 480 s, for a loaded
  machine.

## The place

**The home** (`helpers.ts`, `freshPlace`): #19's `makeHome`, then the launcher stand-in replaced by one that refuses
(`fixtures/refusing-launcher.sh`, a copy of #2200's), so a wrong program that runs setup starts no hub and no test
waits for one. `<tmp>/h` is `HOME`, with no `.deepbuild`. `<tmp>/bin` is first on `PATH` with the stand-ins for
`launchctl`, `systemctl` and the launcher; each call is a line of `<tmp>/bin/calls.log`.

**The working folder** is `<tmp>/e`, made empty for each test: the issue's "an empty working directory". (#19's
`<tmp>/w` is a git repo and is not used as the working folder.)

**"Writes nothing" and "nothing set up"** are read over the whole temporary folder, before and after: the working
folder, the home and the stand-ins' folder, every file by its bytes' digest and every folder, so a `--typo/` made and
left empty counts.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, computed from the live body; `criteria.json` lists them with their
text. Each test's name starts with its ID.

| # | ID | Criterion | Tests | On the base |
|---|---|---|---|---|
| 1 | `#2581.df46b19b` | A flag isn't a root | `root.test.ts`: `deep hub start --root --typo in an empty working folder exits 2 and writes nothing`; `deep hub status/stop/use --root --typo exits 2` (three); `deep hub run --root --typo exits 2 and starts no server` | each fails at its assertion: start exit 0 with 61 paths written under `e/--typo/` (the dev hub came up here), status 3, stop 3, use 3, run started a server |
| 2 | `#2581.43938b6c` | A single dash is a flag too | `dash.test.ts`: `deep status -x --why`, `deep env up --root -x`, `deep install -x` (a package folder named `-x` beside it), each `exits 2 with nothing set up` | each fails at its assertion: exit 3 after setup, exit 3 with nothing written, exit 3 after setup |
| 3 | `#2581.995b5ffd` | The other three | `others.test.ts`: `deep secret add --typo x`, `deep rules credit --typo`, `deep host changes --typo`, each `is a usage error: exit 2` | each fails at its assertion: exit 3, 3, 3 |

## The reading of each criterion

1. **`deep hub start --root --typo`** holds the exit code and the written paths in one assertion, `{exit: 2,
   written: []}`: the criterion's "exits 2 and writes nothing". The issue's "today" is exit 3 with five files under
   `--typo/`; on this machine the base's detached dev hub came up within start's wait, so start exited 0 with 61 paths
   written there. Both fail the assertion.
2. **`deep hub status|stop|use --root --typo`** read the exit code alone, as the criterion does ("exit 2 as well").
3. **`deep hub run --root --typo`** holds `{exit, server}` equal to `{2, false}`. "Starts a server" is read as a
   `hub.sock` appearing anywhere under the working folder, or the process still running after 300 s. Either way the
   test stops the child by its PID (SIGTERM, then SIGKILL after 10 s), so a server can't hang the test. On the base the
   socket appeared and the hub was stopped.
4. **Criterion 2** holds `{exit, written, called}` equal to `{2, [], []}` for each form: "exit 2 with nothing set
   up in a fresh home", read as #2200's suite reads "sets nothing up" (no new or changed file, no stand-in call).
5. **`deep install -x` runs with a package folder named `-x` in the working folder** (`manifestAtDashX`: a readable
   `deepbuild.json`). The issue says that today, in an empty folder, the base "exits 2 only because no manifest is at
   `-x`": a test there would pass on the base and prove nothing. With a manifest at `./-x`, a program that still reads
   `-x` as the folder goes on (on the base: setup, then exit 3), and a program that refuses the flag exits 2 with
   nothing set up, whatever is in the folder. The empty-folder form is not run.
6. **Criterion 3 reads the exit code alone**, as the criterion does, in a fresh home and an empty working folder. On
   the base `deep secret add --typo x` also runs setup before exiting 3; that is not asserted here.
7. **"A flag"** is the issue's own: `--typo` for criteria 1 and 3, `-x` for criterion 2. That each form still takes a
   real value (`--root <folder>`, a session, a package folder, a rule, a host) is in no criterion and is not tested here;
   the commands' own suites hold it.

## Twins

None, so no `twins.json`. Every test here covers a criterion and fails on the merge base at its own assertion
(`BASE-FAILURE.txt`), which is what the before lane counts (`scripts/proof-runs.mjs`; design: Fail before, pass after).
A twin is needed only for a tagged test that passes on the base, as #2200's criterion 3 guard did; there is none here.

## What the drafting job ran, and what it did not

Ran on the reference Mac, Node 24, load average 55-80 from other runs:

- **At the base, in the checkout:** the Run command, twice (the second after a wording fix in `served`'s message):
  11 tests, 11 fail, each at its `expect` (`BASE-FAILURE.txt`, the second run). The type check passes. After each run
  no process with the test's temporary folder in its command line was left, and no `/tmp/dh19d-*` folder.

Not run:

- **Linux.** The tests name no platform's file.
- **The proof lanes** (`scripts/proof.mjs`'s before and trace lanes) and `scripts/affected.mjs`: there is no change yet.
- **A fix.** No test was seen passing; each is one comparison of the issue's values.
