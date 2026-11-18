# Acceptance tests for #2312: a JSON-RPC package's main in the macOS sandbox on /usr/bin/python3 and on a framework Python

Written first and blind, at base commit `212f16d096d0b2efd65497933abb4afb16742178` (origin/main, 2026-11-17), by a job
that saw no implementation of #2312, no other checkout, branch, pull request or session. It read:

- issue #2312: its description, Scope, 3 checkbox criteria and Proof
- `AGENTS.md`
- `docs/technical-design.md`: "Blocks for plug-ins that do real work", "Blocks for plug-ins that host something
  live", and Dogfooding
- the repo at the base: `tests/acceptance/351` (criterion 1 names its `guide.test.ts`; its README, helpers and
  twins for conventions), `tests/acceptance/2118`'s README, the guide's JSON-RPC example
  (`docs/extension-guide/json-rpc`), `packages/extension-host` through its public entry, the supervisor's public
  shapes (`StartSpec`, `Grant`), and the base's `interpreter()` in `packages/extension-host/src/host.ts`, which the
  issue quotes

The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## Result on the base

| AC | ID | Criterion (short) | File | On the base |
|---|---|---|---|---|
| AC1 | `#2312.0690cb81` | with `/usr/bin/python3` first on `PATH`, #351's `guide.test.ts` passes all 6 cases | `apple-python.test.ts` (1), which runs `tests/acceptance/351/guide.test.ts` unchanged | fails: the JSON-RPC case, `its code didn't register in the platform sandbox: the connection closed`; and the drift-test case, for a reason outside this issue (below) |
| AC2 | `#2312.0c8eab61` | a `main` on a framework Python's `Python.app` binary is let read `Versions/<v>` and starts in the sandbox | `framework-python.test.ts` (1) | fails: the run's read list has `.../Resources/Python.app/Contents`, not `Versions/<v>`; then `its code didn't register in the platform sandbox: the connection closed` |
| AC3 | `#2312.06d4f1d2` | an interpreter under your home or the package folder still gets no install grant | `no-grant.test.ts` (2) | **both pass on the base**: they guard behavior the base has |

Each ID is `#2312.` and the first 8 hex digits of the SHA-256 of the criterion's checkbox text, trimmed, white space
collapsed, as `scripts/proof-change.mjs` reads it. Each test file binds its own ID in a string constant.
`BASE-FAILURE.txt` holds the runs, with `uptime` beside each.

### AC3 passes on the base, and the wrong program it fails on

The criterion says "still": the base refuses these, and the fix must keep refusing them. So the two tests can't fail
on the base. The wrong program they are written for is the fix without its refusal: **an `interpreter()` that takes
`Versions/<v>` as the install root of any path inside a `.framework/Versions/<v>/` tree and grants it without
checking that it holds neither `homedir()` nor the package folder.** On that program the first test's run is let
read your home itself, and the second's is let read a folder holding its own package folder (the host's whole
home); each test's last assertion then fails, naming the path.

No twin is planted. A twin in this repo's convention (`twins.json`, `twins/<name>/packages/...`) is a copy of the
changed source file with the fault in it, and this job has no changed source to copy: writing one would be writing
the fix. The implementer, or the mutation lane, supplies it; reverting only the refusal in the fixed `interpreter()`
is that twin.

Each AC3 test first shows that the same tree, where it holds neither your home nor the package, does get an install
grant (the base grants its `Contents`, the fix its `Versions/<v>`), so a host that grants nothing, or a fixture the
rule never reaches, doesn't pass by silence.

## Run them

On macOS, with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the sandboxed runner and scripts/guide.mjs read the built packages
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2312 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2312/tsconfig.json
```

- **`--no-file-parallelism`:** each file opens hosts that start sandboxed packages through the real supervisor.
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment
  and points `HOME` at a temp folder. A test that needs python3 on the hub's PATH to be a given interpreter sets
  `PATH` (and, for one test, `HOME`) for its body and puts them back.
- **Temp folders:** everything is under `/tmp/dh2312-*`, real paths, removed after its file. Every host a test opens
  is closed after its file, which stops what it started; nothing is stopped by name or port. No network.
- **Prerequisites are never a pass.** Not macOS, no `/usr/bin/python3`, no `/Library/Developer/CommandLineTools`, or
  no framework Python that runs: the test fails with an error starting `BLOCKED:` that says what is missing. Nothing
  is skipped.
- **Time:** AC1's test runs #351's file in a child Vitest (about 30 s on the base; its drift-test cases allow up to
  300 s each). The sandboxed tests allow 240 s each; a first-test timeout under heavy load is the machine, so rerun
  that file alone before judging.

## What was reused

- **AC1 is `tests/acceptance/351/guide.test.ts` itself**, as the criterion says: not copied, not edited. Running it
  as #351's README does, with `/usr/bin` first on `PATH`, is the criterion's proof. `apple-python.test.ts` adds only
  the criterion's condition, which nothing else pins: it runs that one file in a child Vitest with
  `PATH=/usr/bin:<this Node's folder>:/bin:/usr/sbin:/sbin` and requires its six cases, by name, all `passed`.
  #351's file takes the python3 it finds first on `PATH`, so on another `PATH` it proves nothing about Apple's stub.
- **The package under test in AC2 and AC3 is the guide's JSON-RPC example** (`docs/extension-guide/json-rpc`, #351),
  built as #351's tests build it, with its `#!` line pointed at the interpreter the test names. Its `example.json`
  runs are what "starts" is checked with.
- The world, the host and the temp-folder conventions follow #351's `helpers.ts`. This folder has its own small
  `helpers.ts` rather than importing a sibling's.

## The surface under test

Only what the issue and the design name, through `@deepbuild/extension-host`'s public entry:

- `host.install`, `host.check`, `host.load`, `host.checks`, `host.runCheck` on a package whose out-of-process `main`
  has a `#!` line: whether it registers in the platform sandbox (conformance passes; `load` answers
  `{ status: 'loaded', place: 'sandbox' }`; its check kind answers).
- **What the host asks the supervisor to let the run read**: the `grant.read` of each `start` the host asks its
  supervisor for. The host is given its supervisor (`ExtensionHostOptions.supervisor`); the tests give it the real
  one behind a pass-through that writes each `main` start's `cwd` and `grant.read` down and changes nothing, so
  every run still starts in real Seatbelt. No function of the fix is named or called; the tests don't know how it
  is written.

## Readings

- **A framework Python (AC2).** Found at run time: the first of `/Library/Frameworks` (python.org),
  `/opt/homebrew/Frameworks` and `/usr/local/Frameworks` (Homebrew) with a
  `Python.framework/Versions/<v>/Resources/Python.app/Contents/MacOS/Python` whose real path still has the
  criterion's shape and which runs outside the sandbox. `Versions/<v>` is that real path's. Apple's own
  `Python3.framework` under the Command Line Tools is left to AC1.
- **On the hub's PATH (AC2, AC3).** The base grants only an interpreter the hub itself would run by a known name,
  and the issue changes nothing there. A framework install's `bin/python3` isn't its `Python.app` binary, so each
  test puts a temp folder first on `PATH` holding `python3`, a link to the binary the `#!` line names.
- **"Receives read access to `Versions/<v>`" (AC2)** is: every start of the main the host asks for lists exactly
  that directory in `grant.read`. A grant of a folder above it would let the run read it too, but the Scope says
  the install root is `Versions/<v>`, so that is what is asserted.
- **"Starts in the sandbox" (AC2)** is #351's reading of an example's run: conformance passes, it loads with
  `place: 'sandbox'`, its check kind is in use, and both runs in its `example.json` (one passing, one failing) are
  answered as declared. This Mac's framework Python does start in Seatbelt once `Versions/<v>` is readable and not
  with `Contents` alone (checked directly against the Seatbelt backend before the base run).
- **"Under the user's home folder or the package folder itself" (AC3)** is read with the Scope's sentence, "still
  refusing any path holding `homedir()` or the package folder": the refusal is of an install root that holds
  either. The first test's tree is `HOME` itself (`Versions/3.99` is your home, so the interpreter is under your
  home and its install root holds it). The second's `Versions/3.99` holds the host's home, where the host puts
  every run's package folder. Both trees are stand-ins in `/tmp` whose program runs nothing: these tests read what
  the host asks for, and conformance failing afterwards is expected and unasserted.
- **"No install grant" (AC3)** is asserted as the Scope's guarantee: nothing in the run's read list holds your home
  (first test) or the run's package folder (second). The stronger sentence, that nothing at all is granted for such
  an interpreter, isn't asserted: on the base the first tree's `Contents` is granted, and the issue doesn't say
  whether the fix refuses it outright or falls back.

## What the issue leaves open

This job refused to guess these; each is for the issue's author.

1. **AC1's sixth case fails on the base for a reason outside this issue.** With `/usr/bin` first on `PATH`,
   #351's file has two failing cases at `212f16d09`, not one: the JSON-RPC example (this issue), and "the guide is
   generated from the published contract...", whose drift test says `FAIL guide: deep.registerPort: the contract
   publishes it, and the guide has no entry for it` (and `deep.source.ask`). The base's `docs/extension-guide.md` is
   behind its contract; Python and the sandbox have no part in it. The criterion says "passes all 6 cases", so
   AC1's test requires all six and stays red until the guide is regenerated, by this change or another. Nothing was
   weakened to hide it.
2. **An interpreter under your home whose install root doesn't hold your home** (a pyenv or a
   `~/Library/Frameworks` install: `~/x/Python.framework/Versions/<v>/...`). The criterion's words ("an interpreter
   path under the user's home folder ... still receives no install grant") would refuse it; the Scope's words
   ("refusing any path holding `homedir()`") wouldn't, and the base doesn't: it grants such an install today, so
   "still" isn't true of it. No test here decides it.
3. **An interpreter inside the package folder itself.** A run's package folder is a snapshot the host makes at
   start, under a name no test can know before the `#!` line is written and stamped, so that literal case can't be
   built through the public entry. The second AC3 test covers the Scope's wording (an install root holding the
   package folder) instead.
4. **The Scope's first line as a grant.** That a `/usr/bin/python3` main's run is let read
   `/Library/Developer/CommandLineTools` has no checkbox of its own; AC1 proves its effect (the example registers).
   Likewise "`SYSTEM_PROGRAMS` is unchanged" is Scope with no criterion: nothing here tests it, and a PR should say
   how it shows it (the diff does). The Proof's "unit coverage for both paths" is the implementer's.

## Files

- `helpers.ts`: the environment cleanup, temp folders, the world, the host with its starts written down, the
  JSON-RPC package, PATH and HOME for a test's body, a framework Python found here, and a framework-shaped tree.
- `apple-python.test.ts` (AC1), `framework-python.test.ts` (AC2), `no-grant.test.ts` (AC3).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the runs on the base commit, home path redacted.
