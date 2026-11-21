# Acceptance tests for #2484: lsof's mount warnings and the environment kit

These tests were drafted blind from issue #2484 (its text as given to this job), `docs/technical-design.md`
(Dogfooding), AGENTS.md and the base commit `0329cec8e`, which has no fix. At the base I also read
`packages/conformance/src/slots/environment.ts` and its `environment.test.ts`, `packages/conformance/src/index.ts`,
`dispatch.ts`'s exports, `slot-runner.ts` (the kit checks), `slot-check.ts`, `scripts/slots-check.mjs`,
`scripts/proof-change.mjs` (`criterionId`) and `tests/acceptance/364/` (the tsconfig and import style). Per
AGENTS.md the implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

## The surface

- **The kit through the conformance package's public entry** (`packages/conformance/src/index.ts`):
  `kitProblems(kit)` is what `scripts/slots-check.mjs` runs for each kit (via `slotProblems`), and
  `runKit(kit, fill, { parts: ['fixed'] })` is the kit runner. The kit is `slotKits()`'s `environment@1`; the
  planted fill is its `leaves-grandchild`, the clean fill `cleanFills(kit)[0]`.
- **lsof is a boundary this repo doesn't own**, so it is the only thing stood in for. The kit runs `lsof` by name
  from `PATH`; each test puts a stand-in `lsof` (a `/bin/sh` script) first on `PATH` and restores `PATH` after.

## Readings where the issue leaves a choice

- **"A machine with a mount lsof can't stat"** is the warning stand-in: it runs the real lsof (`/usr/sbin/lsof`
  on macOS, `/usr/bin/lsof` on Linux) with the kit's arguments, keeps its output and exit status, and adds the
  issue's warning lines (tracefs and nsfs mounts, each with `Output information may be incomplete.`) to stderr
  on every call, unless the call asks lsof to suppress warnings with `-w` (alone or among bundled single-letter
  flags such as `-nPw`), as the issue says the real lsof does. So the answers are real lsof's, and a fix that
  passes `-w` and a fix that reads past the warning lines both pass.
- **"Read the table as unreadable"** is the kit's `listeners_unknown` or `folders_unknown` finding (BLOCKED,
  "lsof failed"). AC1 holds when, under the warning, the kit's findings are the ones real lsof's answer gives:
  the planted `leaves-grandchild` fill is refused with its own message and code (`left its process running after
  down`, `process_left`), the slot check's kit checks name no problem, and an environment that listens on nothing
  is refused for that (`unleased_port`, "it listens on nothing").
- **"Fails for another reason"** is, each in its own test: lsof ending with 1, no output, the warning and a real
  error line beside it (`lsof: can't read the open files table: Permission denied`); the same error only on the
  working-folder call (`-d cwd`) with real lsof answering the rest; lsof missing from `PATH` (a `PATH` holding
  only `ps`); and lsof killed by SIGKILL after printing only the warning. Each must read BLOCKED with
  `listeners_unknown` (or `folders_unknown` for the cwd case), never PASS, and on the listens-on-nothing
  environment never the "listens on nothing" refusal. The error line starts with `lsof:` like the warnings, so a
  fix that drops every `lsof:` line or every exit 1 fails here.
- **"Listens on nothing" environment.** A fill of the test's own: the handle names an idle process carrying the
  run token that listens on nothing, while a server outside the environment (no run token, not under the
  handle's process) answers health on the leased port. Real lsof then ends with 1 and no output for the
  environment's pids, the exact answer the issue's warning turns into "unreadable".

## Criteria, IDs and tests

IDs are `criterionId` from `scripts/proof-change.mjs` over the criterion text; every test name starts with its ID.

| AC | Criterion | ID | Tests (`lsof-warnings.test.ts`) | Base |
|----|-----------|----|---------------------------------|------|
| 1 | A warning lsof prints about a mount it can't stat doesn't make the environment kit read the table as unreadable | `#2484.43cad8f7` | the slot check's kit checks pass the environment kit on a machine whose lsof warns about a mount it can't stat | FAIL (the issue's line) |
| | | | the planted leaves-grandchild fill is refused with its own fault, not as an unreadable table, when lsof warns | FAIL (BLOCKED `listeners_unknown`) |
| | | | an environment that listens on nothing is refused for it, not read as unreadable, when lsof warns | FAIL (BLOCKED `listeners_unknown`) |
| 2 | An lsof that fails for another reason still reads `BLOCKED`, never as "nothing listens" | `#2484.c9d8cf75` | an lsof that ends with 1 and a real error beside the warning reads BLOCKED, never PASS or "listens on nothing" | pass |
| | | | an lsof whose working-folder reading fails with a real error reads BLOCKED, not PASS | pass |
| | | | lsof missing from PATH reads BLOCKED, never PASS or "listens on nothing" | pass |
| | | | an lsof killed by a signal after printing only the warning reads BLOCKED, never PASS or "listens on nothing" | pass |

AC2's tests pass at the base, which already reads every such failure as BLOCKED; they guard against a fix that
widens what it accepts. Each was run against planted wrong programs (patches to `listeners`/`folders` in a scratch
copy of `packages/conformance`, never committed):

| Program | Result |
|---------|--------|
| base | AC1's 3 fail, AC2's 4 pass |
| fix A: `-w` on both lsof calls | all 7 pass |
| fix B: drop the `can't stat()` warning lines (and their `Output information` line) before the stderr check | all 7 pass |
| wrong: exit 1 is "nothing" whatever stderr says | AC2 real-error and cwd tests fail |
| wrong: only a spawn error is unreadable (status and signal ignored) | AC2 real-error, cwd and killed tests fail |
| wrong: lsof missing (ENOENT) reads as nothing | AC1's 3 fail (warning unfixed), AC2 missing test fails |
| wrong: drop every `lsof:` line before the stderr check | AC2 real-error and cwd tests fail |

## Run

```sh
npm ci                                                   # once, if node_modules is missing
node node_modules/typescript/bin/tsc -p tests/acceptance/2484/tsconfig.json
node node_modules/vitest/vitest.mjs run tests/acceptance/2484
```

From the repo root, under Node 24. The seven take about 10 s. `BASE-FAILURE.txt` is that run at the base, with
the checkout path replaced by `<repo>` (load average about 67 then; vitest lists only the failing file's failed
tests, the other four passed).

## Not tested

- macOS's own lsof warnings, and whether `-w` silences every warning lsof can print (the issue's "Not checked").
  The warning here is the issue's Linux text, added by the stand-in; the base run was on macOS.
- The working-folder call under the warning with lsof ending 1: with real lsof that call reads live members,
  which always have a cwd, so it ends 0 and the warning beside a 0 is already accepted at the base. Only the
  listeners call reaches lsof's exit 1 through real fills; the cwd call is covered for AC2 by its own failing stand-in.
- `node scripts/slots-check.mjs` and the lint lane themselves: the first test runs the kit checks the script runs
  for this kit, without the built `dist/`.
