# Acceptance tests for #2205: a spec check the gate can't run stands on the claim as BLOCKED

Written first and blind, at base commit `b9131dbd9857aefc4dcc39dd0d534d007b1ef671` ("Merge pull request #2519 from
windoliver/fix/2066-person-only-rules"), from issue #2205 as handed to this job (`issue.json`, `updatedAt`
2026-11-14T21:02:51Z: its account of the bug, Scope, four acceptance criteria and Proof), the design and the base,
before any implementation. The job saw no fix, diff, other branch, other worktree or pull request.

Two runs of this blind job made the folder, both at this base and with the same inputs. An earlier run drafted
`helpers.ts`, `spec-checks.test.ts` and `tsconfig.json`, typechecked them and stopped. This run read the issue, the
design and the base again, kept those three files byte for byte, ran the suite once on the unchanged base
(`BASE-FAILURE.txt`), typechecked it (exit 0) and wrote this README.

The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

By this run; the earlier run had the same inputs.

- The issue, and nothing it links but the design.
- `AGENTS.md` and `docs/technical-design.md`: What done means, fixed at the start (Who drafts it, Proven on the base,
  Timing and cost, At the claim); How runs become one of five verdicts (the table, precedence and pending, how a run
  ends, Fail before, pass after, Failing on an assertion, Check health); the `.deepbuild/done.yaml` example under
  First-party extensions; An agent says it's done (the diagram, Every stop is judged, Fast and slow lanes); and, in
  How we know version 0 works, Dogfooding, Criteria to tests, Criteria in a checked shape, Wrong programs and The
  edit guard.
- The base's code, to learn how to drive it and what it does today: `packages/hub/src/stop-judging.ts` (`runClaim`,
  `specChecks`), `packages/hub/src/mcp-operations.ts` (`checksOf`), `packages/hub/src/core.ts` (`doneSpec`),
  `packages/hub/src/hub-canvas.ts` and `doc-checks.ts` (`docChecksOf`, `docCheckOf`: a document check, the one entry
  with no `run` line that `specChecks` takes at this base), and `packages/verdicts/src/engine.ts` (how a BLOCKED row
  is worded). The issue names `specChecks` and `checksOf` in `core.ts`; at this base they are in the first two files.
- The base's proof scripts: `scripts/affected.mjs`, `lanes.mjs`, `proof-guard.mjs`, `proof-change.mjs` (criterion
  IDs, tags, how a test's name is read), the lines of `proof-runs.mjs` that name `twins.json`, and what
  `docs/parallel-proof.md` says of the `alone` block.
- Sibling suites: `tests/acceptance/322/helpers.ts` (the world, the hub and the session, imported here), and
  `2078/` and `1723/` for the form of a README and a `BASE-FAILURE.txt`.

## The surface

The tests reach DeepBuild only through these, all by #322's helpers (`../322/helpers.ts`), nothing copied or mocked:

- `.deepbuild/done.yaml` in a fixture repo, the file the issue is about, written as each criterion writes it.
- `deep hub run` (`packages/cli/dist/main.js`) on a temporary home, with its shipped hold, the handed definition
  (`DEEP_HUB_TEST_DRAFTS`; #322's `startHub` also sets its confirmation stub and an empty work source and GitHub
  recording) and the project trusted by #348's decision (`trustRepo`, which appends your answer through the public
  entries of `packages/record` and `packages/extension-host`, as #322's suite does).
- deep-hook (`target/debug/deep-hook`), run as Claude Code runs our hook entries, each a child of the session's own
  process: SessionStart, UserPromptSubmit, PreToolUse and PostToolUse of a Read and of an Edit, and Stop.
- The record, through the hub's socket method `events.read`: `user.ask`, `definition.locked`, `claim.made`,
  `run.started`, `run.finished` and `verdict.made`.

This folder's two TypeScript files import nothing of DeepBuild but `../322/helpers.ts`.

## The scenario

Each test is one world: #322's repo (`src/auth.js`, `tests/unit.test.js`, one commit on `main`) with the spec under
test, `tests/types.test.js` for `typecheck`, and the definition's drafted check. The handed definition has one
requirement, R1 "A token whose exp has passed is rejected", judged by `.deepbuild/checks/expired-rejected.sh`
(`node --test`, `on_base: fails`, asserting line 5 of its test file). The session types #322's prompt, Reads
`src/auth.js`, the definition locks, it Edits the file (#322's `FIX`: `checkToken` rejects a token whose exp has
passed) and stops saying "Done.". That stop's claim is read from the record once judged: its `verdict.made` events and
its runs. After the fix `unit`, `typecheck` and R1's check all pass, and R1's check fails on the merge base, so what
keeps the claim from PASS is the spec check the gate can't run.

A PASS or a FAIL is read at once. Any other verdict is made while runs may still come, so it is read once every run
started for the claim has ended, each check the test waits for has a finished run, and the claim's record has stood
still for 30 s (at most 900 s).

| Spec (`helpers.ts`) | `.deepbuild/done.yaml` | Test |
|---|---|---|
| `MISSPELLED` | `claims: {done: {checks: [unit, typechek]}}`; `checks` defines `unit` and `typecheck`, each with a run line | AC1 |
| `JOURNEY` | `claims: {done: {checks: [unit, checkout]}}`; `checks` defines `unit` and `checkout: {type: journey, file: .deepbuild/journeys/checkout.yaml}`; the journey file is in the repo | AC2 |
| `UNCLOSED` | 12 lines: three comment lines, `checks:` with `unit` and `typecheck`, then `claims:`, `done:` and, last, `    checks: [` with no line break after it | AC3 |
| `DEFINED` | `claims: {done: {checks: [unit, typecheck]}}`, both defined with run lines | AC4, first |
| none | no `.deepbuild/done.yaml` | AC4, second |
| `NO_CLAIMS` | no `claims` block; `checks` defines `unit` and `checkout` as in `JOURNEY`; the journey file is in the repo | Scope, first |
| `NO_RUN` | `claims: {done: {checks: [unit, typecheck]}}`; `unit` with a run line, `typecheck: { type: command }` | Scope, second |
| `NO_CHECKS` | `claims: {done: {checks: [typecheck]}}` and nothing else | Scope, third |

`unit` is `{ type: command, run: "node --test tests/unit.test.js", min_tests: 1 }` wherever it is written, with
`min_tests` as the design's example and this repo's own spec write it. `typecheck`, where it has a run line, is
`{ type: command, run: "node --test tests/types.test.js" }`. No entry is a document check (#1723's `kind` and `doc`).

## Criteria to tests

All in `spec-checks.test.ts`, in this order; each criterion's test carries its ID in its name. "On the base" is the
one run in `BASE-FAILURE.txt`.

| Criterion | Test | What it asserts, in order | On the base |
|---|---|---|---|
| AC1 `#2205.a7438bd1` | `… [unit, typechek] …` | 1. a run of `unit` on the claim ended `passed`; 2. the claim's verdict is BLOCKED; 3. what the verdict says names `typechek` as a word of its own | fails at 2 (line 28): PASS on `unit` and R1's check, nothing naming `typechek` |
| AC2 `#2205.df00835d` | `… checks.checkout … {type: journey, file: …} …` | 1. the verdict is BLOCKED; 2. what it says names `checkout`, never only inside the journey file's path | fails at 1 (line 37): PASS on `unit` and R1's check, nothing naming `checkout` |
| AC3 `#2205.e7406ea9` | `… ends inside an open checks: [ on its line 12 …` | 1. the verdict is BLOCKED; 2. no verdict on the claim is PASS; 3. what it says names `.deepbuild/done.yaml`; 4. a saying that names the file names line 12 | fails at 1 (line 46): PASS on R1's check alone, no run of `unit` |
| AC4 `#2205.98714b31` | `… [unit, typecheck], both defined with run lines …` | 1. `unit` and `typecheck` each have a run on the claim that ended `passed`; 2. the verdict is PASS | passes |
| AC4 `#2205.98714b31` | `… no done.yaml …` | 1. R1's check has a run that ended `passed`; 2. no run on the claim is of any other check; 3. the verdict is not BLOCKED | passes |

### Scope tests, not criteria

Three more tests are tagged `Scope #2205`, which is not a criterion ID (`#<issue>.<h8>`), so their runs name no
criterion. They hold the Scope's first sentence ("A name in a claim's `checks` list that `checks` doesn't define, and
an entry the gate can't turn into a run (no `run` line and no check kind that takes it), each stand on the claim as a
check missing something outside the code: BLOCKED, naming the check and the cause, with you as owner. Neither is left
out") on shapes no criterion's fixture has, and they hold its owner, which no criterion states.

| Shape | What it asserts, in order | On the base |
|---|---|---|
| No `claims` block (`NO_CLAIMS`): the claim takes every check | 1. a run of `unit` ended `passed`; 2. the verdict is BLOCKED; 3. what it says names `checkout`; 4. a saying that names it gives you as owner | fails at 2 (line 80): PASS on `unit` and R1's check |
| A command entry with no run line (`NO_RUN`) | 1. the verdict is BLOCKED; 2. what it says names `typecheck`; 3. a saying that names it gives you as owner | fails at 1 (line 89): PASS on `unit` and R1's check |
| No `checks` block (`NO_CHECKS`) | 1. the verdict is BLOCKED; 2. what it says names `typecheck`; 3. a saying that names it gives you as owner | fails at 1 (line 98): PASS on R1's check alone |

## The wrong program

For a fix, the merge base is the wrong program (design: Wrong programs). On `b9131dbd9` each of the three specs is
judged with no such check in the record, as the issue's Proof says: `specChecks` returns nothing for a name `checksOf`
doesn't hold (`stop-judging.ts:1156`), `checksOf` leaves out an entry whose `run` isn't a string
(`mcp-operations.ts:390`), and `doneSpec` turns the parser's error into no spec (`core.ts:133`). AC1's, AC2's and AC3's
tests and the three Scope tests each fail there on their own BLOCKED assertion (`AssertionError`, innermost frame in
`spec-checks.test.ts`, the base's PASS in the message). AC4's two tests pass there, as tests of behavior that must
not change do. No criterion names a planted twin, so there is no `twins.json`, and this job planted no program; by
the design's Wrong programs, what must fail AC4's tests is then a mutant of the lines the change adds.

The one run, `DEEP_SHARDS=1 node scripts/affected.mjs tests/acceptance/2205/spec-checks.test.ts`, is in
`BASE-FAILURE.txt`: 6 failed, 2 passed, none skipped, with no WIDE and no INCONCLUSIVE line. Its summary also counts
152 new and 42 known lint findings of the whole repository; none names a file of this folder.

## Scope shapes left untested

- **A claim other than `done`**, such as the design's `no-visible-change`. The base judges a stop against the `done`
  claim's list only, and neither the issue nor the base names a way to make another claim.
- **`claims.done.checks` that isn't a list, or a `claims` block with no `done`.** The base then takes every check; the
  issue doesn't say what such a spec means, so no test guesses.
- **A `run` that is there but isn't text** (a number, a list, an empty string), and **an entry that isn't a map.** The
  Scope says "no `run` line"; whether these count as none is left open. On the base they take the same path as an
  entry with no `run` line.
- **A name written as the design's example writes it**, `journey:checkout`. The criterion writes `checkout`.
- **Other files that don't parse** (a tab indent, a duplicate key, a file that can't be read), and **files that parse
  to no map** (empty, a bare string, a list). AC3's fixture is the one the issue names; each other failure has its own
  place where the parser stops, and a file that parses to no map does parse, which the issue doesn't speak of.
- **An untrusted repo.** Its spec checks never run and its claims are watch-only on the base; the criteria say
  "a trusted fixture repo".
- **A claim that opens a PR**, whose release checks are #2067's, **a spec changed after approval** (#1864) and
  **document checks** (#1723): the issue leaves them out. `min_tests`, a key the gate doesn't read, is on `unit` in
  every spec, and AC4's first test must still pass with it.

## Readings where the issue leaves a choice

- **The claim's verdict** is its newest `verdict.made`, read as described under The scenario.
- **"Naming the check"** is the check's name as a word of its own in something that verdict says: a string anywhere
  in its `data`, or a map in it read as one line of its own text and number fields (`key: value, …`), so a sentence
  and a row of fields are read alike. `checks.checkout` names `checkout`; a longer name or a file's path doesn't.
- **"With you as owner"** (Scope tests only) is a saying that names the check and reads `owner you`, `owner: you` or
  `owned by you`: the design writes a BLOCKED "(cause, owner, since)", and the base words a check missing something
  outside the code `<check>: missing <cause>, owner <owner>`. An owner given only where the check isn't named is not
  read.
- **"Where the parser stopped"** is the line: 12, where the file ends inside the open `checks: [`. It is read as
  `line 12`, `line: 12`, `12:<column>` or `:12` in a saying that names the file. The base's own parser (`yaml`) stops
  there, at line 12, column 14; the column is not read. An implementation that gives only a byte offset fails this
  test and should dispute it.
- **"A claim whose unit check passes"** is a run of `unit` on the claim that ended `passed`. AC1's test asserts it
  first, so a hub that blocks the claim and never runs `unit` fails there.
- **"Never read as a repo with no spec"** is no PASS among the claim's verdicts, at any time.
- **"Judged as today"** is PASS, with `unit` and `typecheck` each run and passed.
- **"No spec check"** is no `run.started` on the claim but of the definition's own check, and **"no BLOCKED from this
  rule"** is a verdict other than BLOCKED, since nothing else in the scenario blocks.
- **An entry with no run line in a spec with no `claims` block** stands on the claim too. This is a reading of the
  Scope's first sentence with the base's rule that such a spec gives the claim every check (`specChecks`), and of
  "Neither is left out". An implementer who reads the Scope as the names a claim lists and no more should dispute
  the first Scope test.

## How to run

With Node 24.22.0 (`.node-version`) and the pinned 1.99.1 toolchain's `cargo` on `PATH`:

```sh
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
node scripts/affected.mjs tests/acceptance/2205/spec-checks.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/2205/tsconfig.json
```

- The tests build nothing: a missing build is BLOCKED (thrown), naming the command.
- Every test starts a hub of its own, and the file's tests run one at a time. Each makes its folders under
  `/tmp/dh322-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME` there for every process it starts,
  and never touches the real `~/.deepbuild` or `~/.claude`. It stops only processes it started, by PID (#322's
  `cleanup`). No network, no model. Fixtures use synthetic identities only.
- **Time.** 102 s for the file on the base, at a 1-minute load of 193 on 18 cores; `affected.mjs` took 115 s with its
  lint jobs. On a hub that reads BLOCKED each of the six tests waits at least 30 s more, as The scenario says.
- **Load.** A definition that didn't lock within 180 s, a stop that made no claim and a claim with no verdict 900 s
  after its stop are INCONCLUSIVE (a skip, never a pass) when the 1-minute load is past the core count, and BLOCKED
  otherwise. In the run above nothing was skipped.

### Lanes and the guard at this base

What `scripts/lanes.mjs` and `scripts/proof-guard.mjs` do with this folder, and no more:

- `lanes.mjs` names the folder on none of its lists (`alone`, `exclusive`, `slow`, `timed`, `byHand`, `ownLane`). So
  `affected.mjs` runs the file in its parallel block (the run's selection line reads `parallel vitest: …`), and the
  unit lane's first vitest run, which leaves out only what `alone`, `ownLane` and `byHand` name, takes it beside every
  other file. `alone` is the list of files the unit lane runs one at a time after that; the folders of #322, #1723 and
  #2078 are on it.
- `alone` is written in `lanes.mjs` itself, and neither script reads a lane file from a suite's folder.
  `proof-guard.mjs` holds `lanes.mjs` as the proof lanes' own code: a commit that changes it is `FAIL guard` unless it
  is its own approved proposal, a commit that touches only the files its approval names, approved by a signed tag
  under `deep/approved/`.
- In the commit that adds them, the guard reads these files only for a module one of them might shadow: an added
  file removes nothing, and none is lane code, a runner's config, a package under `node_modules` or the approvers
  list. Once they are in a commit's parent it guards them by the `#2205.<h8>` tags they hold. It can't read these
  tests' names from the source, since each is a template around a constant imported from `helpers.ts`, so it takes
  every test of the file, the Scope ones too, as carrying each tag the file and its imports hold. A commit that then
  removes or changes a line of the test file, inserts one inside a test, or changes `helpers.ts` is refused unless it
  is its own approved proposal.

This job changed no lane.

## What this suite could not encode

- **The cause's words.** "As not defined" (AC1), "that nothing can run it" (AC2) and the Scope's "naming … the cause"
  are wording the issue leaves open, so the tests assert the verdict, the check or file named, the line and the owner,
  and not what the cause says. A hub that blocks on `typechek` and names another cause passes AC1's test. Under the
  design this goes to the early question.
- **The owner outside the Scope tests.** No criterion states it, so AC1's and AC2's tests don't assert it on their
  fixtures, and the Scope gives no owner for a file that doesn't parse. The BLOCKED's "since" is not read either.
- **The stop's reply, the unblock ask and the open item.** What the chat line says and whether an ask reaches you are
  not read.
- **After the fix.** No implementation existed, so only the base's side of each test was run. On the base every
  failing test stops at its BLOCKED assertion, so the assertions after it (the check named, the file and its line, the
  owner) and the wait for a verdict that is neither PASS nor FAIL ran on no program. This run tried the three readers
  (`naming`, `namesLine`, `ownedByYou`) by hand on sentences in the base's wording of a BLOCKED row; that is not kept
  as a test.

## Files

- `helpers.ts`: the criterion IDs, the specs, the handed definition, the scenario (`claimOn`) and the readers of a
  claim's verdict and runs. It imports #322's world, hub and session; nothing in it stands in for DeepBuild.
- `spec-checks.test.ts`: the eight tests, five for the four criteria and three for the Scope.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, machine paths replaced by placeholders.
