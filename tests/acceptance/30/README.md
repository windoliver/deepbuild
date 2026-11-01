# Acceptance tests for #30: command checks, hermetic runs and tests-run counts

Written first, blind, by a job that never saw an implementation of #30. It read:

- issue #30 as of October 22, 2026: its Scope and its 19 checkbox criteria
- the issues #30 names (#13, #28, #29, #87, #236, #348, #349), for scope only
- `docs/technical-design.md`
- `AGENTS.md`
- the acceptance tests of #236 and #314, for their conventions
- the base commit `2ccdfd6`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

A blind redraft of this job (2026-11-01, base `c9225aa3`, REDRAFT.md) wrote the halves that had waited on the gate
runner (#29), the extension host (#348) and the extension slots (#349), once those landed: the claim halves in
`claims.test.ts` and AC5's slot half in `replaces.test.ts`, against the surface in The claim's surface below. It read
the same inputs at that base, plus the public entries those packages publish.

The issue has 19 checkbox criteria, AC1 to AC19 in the body's order.

## How to run

On macOS, with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # AC12's bench may run built code
node node_modules/vitest/vitest.mjs run --root tests/acceptance/30 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/30/tsconfig.json   # needs packages/checks-command
```

- **`--no-file-parallelism`:** the files start real check runs through the supervisor, and AC12's number only
  means something with nothing else running.
- **AC12 is slow.** Each `--pairs 300` bench run times at least 300 counted and plain pairs, about 3 to 4 minutes
  at a plain run of about 320 ms. One test runs it once; the number runs it six times (a warm-up and five
  readings), about 20 to 25 minutes, so give that file the machine alone. The default run, the perf lane's, is
  short. To run only the number:
  `node node_modules/vitest/vitest.mjs run --root tests/acceptance/30 budgets.test.ts -t "on the reference Mac"`.
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's
  environment, so the child Vitest uses its usual reporter. It sets `DH30_SHELL_FLAG=on`, the shell variable of
  AC1, and points `HOME` at a temp folder, so no run can touch the real `~/.deepbuild`.
- **Temp folders:** every fixture checkout is copied into `/tmp/dh30-*`, a real path. Each one is removed after
  its file.
- **No network:** every host a check might reach is a listener the test runs on 127.0.0.1.
- **Missing tools fail, never skip.** The AC3 and AC16 tests that need Jest, pytest or a working `go` fail
  `BLOCKED: <tool>` where the tool is missing. This Mac has no Jest, pytest or pnpm, and its Go 1.10 segfaults when
  compiling.

## The surface under test

Checks start, signal and wait only through host@1, which is the supervisor's `Host` (#236). The design names the
first-party extension that runs commands `checks-command`. The issue names no module, so this job defines the
smallest surface, in `packages/checks-command/src/index.ts`, using names the issue and the design already use.

### `packages/checks-command/src/index.ts`

```ts
import type { CheckResult, CheckRunnerFill, CheckSpec } from '@deepbuild/conformance';
import type { Host } from '@deepbuild/supervisor';
import type { NumericContract } from '@deepbuild/verdicts';

/** Planted twins the criteria name, selected per check. */
export type Plant = 'exit-code-only' | 'last-attempt-only' | 'no-do-not-track';

export interface CommandCheck {
  host: Host;                          // every start, signal and wait goes through it
  run: string;                         // the run handle, a ULID
  spec: CheckSpec;                     // kind 'command'; spec.runner is the command line; spec.inputs the declared paths
  checkout: string;                    // the folder the command runs in
  deadline: number;                    // ms from the start; past it the run is stopped and ends overran
  env?: Record<string, string>;        // variables passed in for this run (NODE_ENV, a leased PORT, ...)
  secrets?: Record<string, string>;    // credentials env-local loaded for this check; scrubbed from output by value
  hosts?: string[];                    // network hosts the run's grant names ("127.0.0.1:<port>")
  contract?: NumericContract;          // a numeric contract (#28), whose counts come from the tool's report
  stop?: AbortSignal;                  // the hub going down: the run is stopped and ends stopped
  plant?: Plant;
}
export interface Attempt { test: string; outcome: 'passed' | 'failed' }
export interface Seeded { name: string; by: string; standIn: boolean }       // a table the setup writes, and the file that does
export interface ContractCount { output: string; size: number; compared: number | null; largest_error: number | null }

/** A closed run outcome, check.kind@1's CheckResult plus the run record's fields. Never a verdict. */
export interface CommandRun extends CheckResult {
  run: string;
  exit: { code: number | null; signal: NodeJS.Signals | null; cause: 'exit' | 'deadline' | 'stop' } | null;
  output: { stdout: string; stderr: string; sha256: { stdout: string; stderr: string } };  // scrubbed, then digested
  env: string[];                       // names of every variable the process got, never values
  attempts: Attempt[];                 // every attempt the tool's report lists
  retries: string | null;              // the flag that turned the tool's own retries off, when its report can't list attempts
  seeded: Seeded[];
  contract: ContractCount[] | null;    // null without a contract
  clock: number;                       // ms the run's clock was moved ahead (0 for a normal run)
}

export function runCommandCheck(check: CommandCheck): Promise<CommandRun>;
/** Five runs of the full suite on today's clock, then one with the clock 28 to 31 days ahead. */
export function runAddedTests(check: CommandCheck, tests: string[]): Promise<CommandRun[]>;
/** The check.kind@1 fill (#13, kit from #314) for the kind `command`. */
export function commandCheckKind(host: Host): CheckRunnerFill;
```

From `CheckResult` (#314), the tests read these fields:

- `outcome`: a `RunOutcome` (`passed`, `failed`, `ran_nothing`, `missing`, `overran`, `stopped`, `uncounted`); `stopped` is a run cut short by `stop`
- `testsRun`
- `failures`: each with `test`, `file`, `line`, `stack`, `assertion` (true only for an assertion failure) and `message`
- `mask`: the mask the runner found in the command, or `null`
- `read`

### Report conventions the tests rely on

- **Counts, places and attempts** come from the report file the runner asked the tool for (Vitest `--reporter=json
  --outputFile`, the Jest JSON report, pytest's JUnit XML, `go test -json`, node:test's reporter). They never come
  from printed output.
- **The numeric contract's counts (AC19)** come from Vitest's own report. Each test reports, in its `task.meta`,
  `contract: { <output>: { compared, largest_error } }`, and Vitest's JSON report carries `meta` per test. When an
  output has no entry, its `compared` and `largest_error` are `null`: missing, never complete.
- **Scrubbing** follows the design's Privacy rule. Each `secrets` value is removed raw, in base64 at all three
  offsets in both alphabets, and URL-encoded. The mask is matched case-insensitively as `[redacted]`. Short plain
  values passed in `env` (`test`, `3000`) are kept.
- **The supervisor's events.** The tests read `sandbox.denied` and `process.tracked` (#236) from the record.

## The claim's surface

The claim halves of AC2, AC7, AC8, AC9, AC10, AC14, AC17 and AC19 end in a claim's verdict, which the gate (#29)
makes from its checks' runs with the verdict engine (#28, `@deepbuild/verdicts`'s `verdict`). The hub today runs an
approved check's script through its own `launch` and records its outcome from the exit code alone, never through the
command check kind and never through `verdict`, so a claim judged on command runs has no surface at this base. The
redraft defines the smallest one, in `@deepbuild/gate`'s public entry (`packages/gate/src/index.ts`, the core's gate
runner), using the names the issue and the design use: a claim's checks with their runs in, a `Verdict` out. The
tests make every run for real through `@deepbuild/checks-command` first, as the run halves do, and hand those run
records to it; nothing here fabricates a run.

<!-- SURFACE-CLAIMS:BEGIN -->
```ts
// packages/gate/src/index.ts, added
import type { Depth, NumericContract, Proof, Requirement, RunOutcome, Source, Verdict } from '@deepbuild/verdicts';

/** One failed test as check.kind@1 reports it (conformance's Failure, field for field). */
export interface RecordedFailure { test: string; file: string; line: number; stack: string | null; assertion: boolean; message: string }
/**
 * A closed run as the command check kind records it (#30's CommandRun, by its fields: a CommandRun is one): a run
 * outcome and the record's fields the claim reads, never a verdict. The gate can't import the extension, so the
 * shape is stated here.
 */
export interface RecordedRun {
  run: string;
  outcome: RunOutcome;
  testsRun: number;
  failures: RecordedFailure[];
  evidence: string[];
  read: string[];
  mask: string | null;
  exit: { code: number | null; signal: NodeJS.Signals | null; cause: 'exit' | 'deadline' | 'stop' } | null;
  output: { stdout: string; stderr: string; sha256: { stdout: string; stderr: string } };
  attempts: { test: string; outcome: 'passed' | 'failed' }[];
  seeded: { name: string; by: string; standIn: boolean }[];
  contract: { output: string; size: number; compared: number | null; largest_error: number | null }[] | null;
}
/** A check of the claim, as the definition locks it, with every run of it on the claim's commit, in order. */
export interface ClaimedCheck {
  check: string;
  /** The command line as locked; the core's masked-exit rule (`maskIn`, #29) reads it. */
  command: string;
  source: Source;
  covers: string[];
  depth?: Depth;            // unit when absent
  proof?: Proof;            // test_run when absent
  inputs?: string[];
  deadline?: string;
  contract?: NumericContract;
  runs: RecordedRun[];
}
/** The definition's requirement, and whether it is about what real users get (AC8). */
export interface ClaimRequirement extends Requirement { real_users?: boolean }
export interface ClaimedRuns { claim: string; agent: string; repo: string; task: string; commit: string; requirements: ClaimRequirement[]; checks: ClaimedCheck[]; now: number }
/** The planted twin AC10 names: a gate that judges only the exit code; tests only. */
export type VerdictPlant = 'exit-code-only';
/** The claim's verdict from its checks' runs: the gate's records of them, judged by the verdict engine. */
export function claimVerdict(claim: ClaimedRuns, options?: { plant?: VerdictPlant }): Verdict;
```
<!-- SURFACE-CLAIMS:END -->

What `claimVerdict` holds to, and what the tests read of the `Verdict` (`@deepbuild/verdicts`'s type):

- **Each run becomes one run record of the engine's** (`Run`): its `outcome` and `tests_run` as recorded; `reads`
  from `read`; each failure with the frame `file:line` from the report; its output kept as evidence, the `stdout`
  and `stderr` slots captured with the run's own digests, so a requirement's `evidence` lists them (AC9); the
  attempts and the stand-ins (below). Nothing is read from the run's output text.
- **The core's masked-exit rule.** `maskIn(command)` on the locked command: a mask makes the check `cant_fail`
  "exit status masked by `<mask>`", so the claim is INVALID and a reason reads "can't fail: exit status masked by
  `|| true`" (AC10); the run of a masked command is uncounted either way. Under `plant: 'exit-code-only'` the rule
  isn't applied and a run's outcome is taken from its exit alone, so the planted run (`plant: 'exit-code-only'` on
  the kind) passes the claim; the test fails on it naming the phrase.
- **Zero tests** (AC2): a `ran_nothing` run, or a passed run of 0 tests, is the engine's INVALID "ran nothing";
  the reason names the check.
- **Endings** (AC7): an `overran` run is a failed run, so a check with no passing run is FAIL and a reason names
  the overrun; a `stopped` run makes it INCONCLUSIVE, never PASS or FAIL; a crash of what the check runs ended
  `failed` and is FAIL.
- **Where a FAIL points** (AC14): the verdict's `points_to.frames` holds `src/cart.test.ts:30`, read from the
  failure's place in the record, and the requirement's `points_to` names it; `smallest` names the test.
- **Attempts** (AC17): a run whose `attempts` list a test both failed and passed is a pass and a fail on the
  commit: the check is INCONCLUSIVE, with a reason naming the test. This is a row the engine gains:
  `Run.attempts?: { test, outcome }[]` in `@deepbuild/verdicts`, and the row "INCONCLUSIVE: `<test>` failed and
  passed on its attempts within `<run>`". A run with the tool's retries turned off (`retries` names the flag)
  failed on the test, and the claim is FAIL naming it; the test accepts either reading, as retries.test.ts does.
- **Six runs** (AC9): the runs `runAddedTests` made are the check's runs on the commit. A failure among passes is
  the engine's INCONCLUSIVE "passed and failed on real runs of one commit", whose reason also names the tests that
  failed (a wording the engine gains, so the claim names the test as the criterion says); every run is counted and
  the failing run's output digest is in the requirement's evidence. Six failures are FAIL, and `smallest` names the
  test. Which tests a claim adds or changes stays the gate's to say; these tests hand it the six runs.
- **Stand-ins** (AC8): a requirement with `real_users: true` is about what real users get. A counted run of a
  covering check whose `seeded` lists a stand-in (`standIn: true`) leaves that requirement INCONCLUSIVE, with a
  reason naming the table and the file that seeds it ("`policies` from `scripts/seed.ts` as a stand-in"); a run with
  no stand-in, or a requirement that isn't about real users, is unchanged. This is a row the engine gains:
  `Requirement.real_users?: boolean` and `Run.stand_ins?: { table, by }[]` in `@deepbuild/verdicts`, and the row
  "INCONCLUSIVE: `<req>` is about what real users get, and `<check>`'s run seeded `<table>` from `<by>` as a stand-in".
- **Contracts** (AC19): a check with a `contract` gets, from each run's recorded counts, the engine's contract
  report per output: a `compared` below the output's `size` reads "output out: 40960 of 4096000 elements compared"
  and a `compared` the report didn't give reads "output out: no count in the report", each INVALID naming the
  output (the engine's own `output <name>:` wording, `packages/verdicts/src/contract.ts`); every output compared in
  full counts, and a requirement with `numbers: true` passes on it.

### AC5's slot half: `replaces` and host@1

A test check kind installed with `replaces: ["command"]` (`fixtures/command-kind`, a release package the host runs
in the hub as tests/acceptance/349's journeys are) registers `command` and runs each check with the command check
kind's own runner, imported from its built entry `packages/checks-command/dist/index.js` (`npm run build
--workspaces`). It starts the check's process only through host@1, which the hub hands it with each run: the surface
is one field on the context a kind in the hub gets, from `ExtensionHost.runCheck` and from check.kind@1's kit at
install alike:

```ts
// @deepbuild/extension-host: what a check kind that runs in the hub gets with each run, beside checkout and deadline
import type { CheckContext } from '@deepbuild/conformance';
import type { Host } from '@deepbuild/supervisor';
interface HubCheckContext extends CheckContext { host: Host }   // host@1, the supervisor's: every start, signal and wait goes through it
```

The supervisor sandboxes what it starts (#236), so the check reaches neither the hub's socket nor a path outside its
folders, and `sandbox.denied` names the path; the kind, the slot and its kit build no sandbox, which the twin on a
supervisor planted `'sandbox-left-to-caller'` shows: the same kind's check reaches both.

### Readings

- **The criterion count.** The issue has 19 checkbox criteria; the request that started this job said 18.
- **"A check that only passes because of a variable in your shell" (AC1).** Read as follows:
  - a variable the test process has is never in the run's environment
  - each run gets a fresh `HOME` of its own
  - each run has its own process, started through host@1
  - the same check passes when the variable is passed in `env`
- **AC2, AC7, AC8, AC9, AC10, AC14, AC17 and AC19 have two halves.** These criteria end in a claim's verdict:
  INVALID, FAIL, INCONCLUSIVE, or "counts". That verdict is the gate runner's (#29). The run half is tested for
  real in the file named beside each: the outcome, the counts, the places, the stand-in mark and the six runs. The
  claim half is tested in `claims.test.ts` on the same real runs, through `claimVerdict` (The claim's surface).
- **"A hub restart" (AC7, the claim's half).** The run a hub restart cuts short is made as ending.test.ts makes it:
  the hub signals `stop` as it goes down, and the run ends `stopped`. The claim on it is INCONCLUSIVE. Restarting
  a built hub mid-run (the hub's `recoverRuns`) isn't driven here: no check runs in the hub through the command
  check kind at this base, and the criterion's verdict is the same whichever way the run was stopped.
- **"About what real users get" (AC8, the claim's half).** Read as a field of the requirement, `real_users: true`,
  which the definition of done states; the fixture's one requirement is such a requirement.
- **"Declared paths" (AC5).** Read as the run's own folders: its checkout and its temp folder.
- **"A test check kind installed with `replaces`" (AC5).** A release package in the hub (`fixtures/command-kind`)
  that registers `command` and declares `replaces: ["command"]`, so check.kind@1's kit runs on it at install
  (#349 AC4) and `host.checks()` names it as the kind's holder. Its runner is the command runner itself, reached
  through the package's settings file, so the kit passes it; what the test adds is that its process starts only
  through the host@1 the hub hands it.
- **"A sandbox built inside the command check kind fails this test" (AC5).** On a supervisor planted
  `'sandbox-left-to-caller'`, the same check must reach both the hub's socket and the outside path. If the kind
  wrapped its own sandbox, one of them would be refused and the test fails.
- **"Usual concurrency" and "a month ahead" (AC9).** The six runs are each the full suite run with the check's own
  command. "A month ahead" is any clock 28 to 31 days ahead of the real one. The run shows it by printing
  `Date.now()`.
- **`pnpm` (AC10).** pnpm is missing on this Mac, so the pnpm form fails BLOCKED. The same scenario runs for real
  with `npm test || true` and bare `npm test`.
- **Mask names (AC10).** The masked run's `mask` names `|| true`, and its outcome is never `passed`. The phrase "exit
  status masked by `|| true`" is the claim's, and waits on #29.
- **AC12's comparison.** The merge-base comparison is the perf lane's, as in #236's AC8:
  - `benchmarks/budgets.json` gets a task `command-check-count` with the command
    `["node", "benchmarks/command-check.mjs"]`, and an `initialReason` naming #30
  - the task must be valid under `validateBudgets` against the merge base's file
  - the bench takes one optional argument, `--pairs <n>`, the number of timed pairs. Run as the task names it,
    with no argument, it is the perf lane's run, which `runTasks` times 42 times per preflight (a warm-up round and
    20 rounds a side) and compares by p50 with the merge base's: it must exit 0 within the lane's 300 s per run
    (`measureOnce`), and should stay short, a few pairs, so its p50 holds steady across preflights. With
    `--pairs 300` it times at least 300 pairs, for AC12's number only. The test checks the default run's limit
    and line, and the `--pairs 300` run's count
  - either way the bench exits 0 and its last line of output is one JSON line, `{"checkMs": [...], "plainMs":
    [...]}`: two arrays of equal length, at least 1 by default and at least `n` with `--pairs n`, of positive wall
    times in ms. `checkMs[i]` is one command check run that
    counts its tests and `plainMs[i]` the same run with counting left out, timed back to back, alternating which
    of the two goes first from pair to pair. The bench may warm up first; only timed pairs are printed
  - one `--pairs 300` run is one reading: the median of `checkMs[i] - plainMs[i]` as a percentage of the median of
    `plainMs`. The test computes it from the pairs; the bench prints no summary of its own that the test trusts
  - the under-1% judgment is made on five readings after a warm-up `--pairs 300` run, on the reference Mac only, by the
    design's timing rule: PASS when all five are at most 1, FAIL when all five are over 1 by more than the margin,
    otherwise INCONCLUSIVE. The margin is the larger of 5% and the five readings' spread (largest minus smallest),
    both as fractions of the limit, as the perf lane's `judgeLimit` takes them. So readings 3.4, 2.6, 3.1, 2.9,
    3.3 have a margin of 80%, and FAIL since all are over 1.8. `helpers.ts`'s `judgeTiming` divides the spread by
    the smallest run instead, which suits a time but not an overhead that can read near zero, so AC12 doesn't use it
- **`hosts` (AC18).** The telemetry listener must be reachable, or the silence proves nothing. So the check names
  it in `hosts`, and a control run (with `TELEMETRY_FORCE=1`) must reach it first.
- **`seeded` (AC8).** `seeded` lists the seeded table whether or not it is a stand-in. The twin's entry for
  `policies` has `standIn: false`.
- **Retries (AC17).** Either reading of the criterion passes:
  - the tool's report lists both attempts of the retried test
  - or the run turned the tool's retries off by a flag named in `retries`, and the test fails the run
- **The fail-elsewhere suite's place (AC4).** The kit's own place check decides it. The test accepts the call site
  in either the test file or the module that throws.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID,
`#30.<first 8 hex of the SHA-256 of its text>`, computed on the text trimmed, whitespace collapsed and `- [ ] `
dropped. A test headed `(wrong program)` runs the same scenario against the planted twin the criterion names, and
expects that twin to fail the criterion's assertion. The twin's scenario must itself run.

| ID | Criterion (short) | Tests (real) | BLOCKED half | At this base |
|---|---|---|---|---|
| AC1 `#30.fc577857` | a check passing only on a shell variable fails here | `hermetic.test.ts` AC1 (3): fails without it; passes with it passed in; own home and own process through host@1 | none | fails (no package) |
| AC2 `#30.5f9be4a0` | zero tests run is INVALID | `record.test.ts` AC2 (1): all-skipped suite, exit 0, `ran_nothing`, 0 tests; `claims.test.ts` AC2 (1): the claim is INVALID naming the check and "ran nothing" | none | fails |
| AC3 `#30.9a95469b` | exit code, output, test count recorded | `record.test.ts` AC3 (4): Vitest for real; Jest, pytest, go | Jest, pytest, go fail BLOCKED on the missing tools | fails |
| AC4 `#30.e698983f` | passes check.kind@1; its four planted runners fail it | `kind.test.ts` AC4 (5): `runKit` with the seed and fixed cases; known-pass/fail at `spec/cart.test.mjs:10`; fail-elsewhere; ran-nothing, masked, past-deadline; the four bends | none | fails |
| AC5 `#30.47dbce22` | still sandboxed with the kind replaced via `replaces`; no own sandbox | `sandbox.test.ts` AC5 (2): denied socket and outside write, `sandbox.denied`; on `'sandbox-left-to-caller'` the kind reaches both; `replaces.test.ts` AC5 (2): the test kind installed with `replaces` (kit PASS, holder of `command`) runs the escape check denied both, `sandbox.denied`; on `'sandbox-left-to-caller'` it reaches both | none | fails |
| AC6 `#30.12fb4acb` | credential replaced in raw and base64 forms | `privacy.test.ts` AC6 (1) | none | fails |
| AC7 `#30.b213a878` | deadline, hub restart, own crash keep output, cause, count | `ending.test.ts` AC7 (3): overran with cause `deadline`, 2 tests, worker gone; stopped with cause `stop`; crash is failed; `claims.test.ts` AC7 (2): the overran run's claim is FAIL naming the overrun and the crash's is FAIL; the stopped run's is INCONCLUSIVE | none | fails |
| AC8 `#30.626ffab8` | a setup-only seeded table makes a stand-in | `standin.test.ts` AC8 (3): stand-in; twin not; wrong program; `claims.test.ts` AC8 (3): the real-users requirement stays INCONCLUSIVE naming `policies` and `scripts/seed.ts`; the twin's passes; wrong program | none | fails |
| AC9 `#30.506a2ee0` | added tests run five times plus a month ahead | `added.test.ts` AC9 (2): six runs, only the month-ahead fails naming the test; the always-failing test fails all six; `claims.test.ts` AC9 (2): the claim is INCONCLUSIVE naming the test, counting six runs, the failing run's output in its evidence; the always-failing one is FAIL naming the test | none | fails |
| AC10 `#30.9c363cec` | `\|\| true` masked, never passes; bare fails | `mask.test.ts` AC10 (6): for pnpm (BLOCKED, no pnpm) and npm each, masked names the mask, bare fails with 2 tests, and the wrong program; `claims.test.ts` AC10 (6): for each tool, the masked claim is INVALID naming "exit status masked by `\|\| true`", the bare one FAIL naming the test, and the planted gate passes the masked claim | none (pnpm: BLOCKED, no pnpm) | fails |
| AC11 `#30.ec919953` | read set lists prices.json, not unused.json | `reads.test.ts` AC11 (3): the run; two wrong programs | none | fails |
| AC12 `#30.542330be` | counting adds under 1% vs the merge base | `budgets.test.ts` AC12 (4): budgets task valid against the merge base; default run within the lane's 300 s; `--pairs 300` prints 300+ pairs; the number on five paired readings, margin as a fraction of the limit | the number fails BLOCKED off the reference Mac or INCONCLUSIVE when unfit | fails (no task, no bench) |
| AC13 `#30.e9d732fa` | record shows allowed variables | `hermetic.test.ts` AC13 (1): names only; every variable the process saw is listed | none | fails |
| AC14 `#30.4df04268` | short plain values unscrubbed; place kept | `privacy.test.ts` AC14 (2): `src/cart.test.ts:30:5` and `localhost:3000` kept, 3 tests, failure at line 30; wrong program; `claims.test.ts` AC14 (2): the FAIL points to `src/cart.test.ts:30` and names the test; the scrubbed record's points to `src/cart.[redacted].ts:30` and fails naming the line | none | fails |
| AC15 `#30.c91cfcd8` | printed "12 passed" while 3 run records 3 | `record.test.ts` AC15 (1) | none | fails |
| AC16 `#30.160d61f9` | assertion at line 30, TypeError at 41; pytest likewise | `places.test.ts` AC16 (3): Vitest for real; wrong program; pytest | pytest fails BLOCKED (no pytest) | fails |
| AC17 `#30.a06dc35a` | retries counted attempt by attempt | `retries.test.ts` AC17 (2): the run; wrong program; `claims.test.ts` AC17 (2): the claim is INCONCLUSIVE naming "settles the order" (FAIL naming it with the tool's retries off); the last-attempt runner's claim passes and fails naming it | none | fails |
| AC18 `#30.69c42fdf` | DO_NOT_TRACK=1 set, listed; no telemetry post | `hermetic.test.ts` AC18 (3): seen and listed; the tool posts nothing after the control reached the listener; wrong program | none | fails |
| AC19 `#30.aebc2446` | report counts per output; silent is missing | `contract.test.ts` AC19 (5): sample 40,960; full 4,096,000; silent null; two wrong programs; `claims.test.ts` AC19 (5): the sample claim INVALID naming `output out`, the full one counts, the silent one INVALID naming it; two wrong programs | the unflushed repeat (#87) | fails |

## Wrong programs

| Twin | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `bent(fill, 'crashed-suite')` (`wrong.ts`) | AC4 | reads "0 failed" from a suite that crashed before running, returns passed with 12 tests | `runKit` fails it with its own message |
| `bent(fill, 'past-deadline')` | AC4 | reports passed after its deadline | `runKit` fails it with its own message |
| `bent(fill, 'dropped-output')` | AC4 | drops a crashed run's output | `runKit` fails it with its own message |
| `bent(fill, 'type-error-as-assertion')` | AC4 | reports a `TypeError` thrown before the first assertion as an assertion failure | `runKit` fails it with its own message |
| supervisor `plant: 'sandbox-left-to-caller'` (#236) | AC5 | leaves sandboxing to the caller | the kind builds no sandbox, so the check reaches the socket and the outside path. A kind with its own sandbox would fail here |
| `everySeededTableAStandIn` | AC8 | marks every seeded table a stand-in | the twin is marked; the failure names `policies`; the twin's claim stays INCONCLUSIVE and fails naming `policies` |
| `plant: 'exit-code-only'` | AC10 | judges only the exit code | the masked check passes; the failure names the mask |
| `claimVerdict(…, { plant: 'exit-code-only' })` | AC10 (claim) | a gate that judges only the exit code: no masked-exit rule | the masked claim is PASS; the failure names "exit status masked" |
| supervisor `plant: 'sandbox-left-to-caller'` (#236) | AC5 (slot) | leaves sandboxing to the caller | the replacing kind's check reaches the socket and the outside path, so the confinement was the supervisor's; a sandbox built inside the kind, the slot or its kit would fail here |
| `readsDeclaredOnly` | AC11 | records only the declared paths as read | fails on `fixtures/prices.json` |
| `readsEveryFile` | AC11 | lists every file in the checkout | fails on `fixtures/unused.json` |
| `scrubsEveryPassedValue` | AC14 | scrubs every passed value, short ones too, from the output and each failure's place | output reads `src/cart.[redacted].ts`, `localhost:[redacted]`; fails naming `src/cart.test.ts:30:5`; the claim's FAIL points to `src/cart.[redacted].ts:30` and fails naming `src/cart.test.ts:30` |
| `everyTestFileFailureAnAssertion` | AC16 | marks every failure in a test file an assertion | fails on line 41 |
| `plant: 'last-attempt-only'` | AC17 | reads only each test's last attempt | passes the retried test; fails naming "settles the order"; its claim passes and fails naming the test |
| `plant: 'no-do-not-track'` | AC18 | clears the environment without setting DO_NOT_TRACK | the tool posts; the failure names it |
| `countsFromPrintedOutput` | AC19 | takes counts from the printed line | records 4,096,000 for the sample; fails naming `out`; the sample's claim counts and fails naming `output out` |
| `silentReportAsComplete` | AC19 | takes a silent report as complete | fails naming `out`; the silent claim counts and fails naming `output out` |

The functions in `wrong.ts` derive the twin's record from a real run's record, changing only what that wrong
program would change. The `plant:` twins are selected through the surface above.

The criteria that name no twin (AC1, AC2, AC3, AC6, AC7, AC9, AC12, AC13, AC15) fail on the base, which has no
`checks-command` package. Past that, the mutation lane is their wrong program.

## What depends on other issues

- **#29, the gate runner; #348, the extension host; #349, the extension slots.** Landed. The claim halves of AC2,
  AC7, AC8, AC9, AC10, AC14, AC17 and AC19 are in `claims.test.ts` and AC5's `replaces` half in `replaces.test.ts`,
  written by a blind redraft against The claim's surface above (REDRAFT.md). They fail at this base on the names
  that surface adds (`claimVerdict`, `ctx.host`), and pass once the hub judges a claim's command runs through it.
- **#87, the timing check.** AC19's unflushed repeat fails BLOCKED in `blocked.test.ts`, the one half left there.
- **The reference Mac.** AC12's number counts only there, in a fit state. Elsewhere it fails BLOCKED, or
  INCONCLUSIVE when the machine isn't fit.
- **AC12's dispute redraft (2026-10-24).** On the reference Mac (Mac15,12, fit), the first draft's bench, printing
  the medians of 10 interleaved runs a side, gave readings of 3.774, -0.564, 2.928, 4.077 and 2.077: INCONCLUSIVE
  with an 823% margin. Two faults made it unable to judge:
  - one reading's noise (a standard deviation near 1.9 points) was larger than the 1-point limit;
  - the margin divided the spread by the smallest reading, so a reading near zero made it unbounded and FAIL
    unreachable.

  The redraft keeps the issue's value (under 1%, counted against the same run with counting left out), the
  budgets.json task and its validity against the merge base, the bench test and the reference-Mac gate. What
  changed:
  - the bench prints every pair instead of two medians, and AC12's number runs it as `--pairs 300`, while the
    task's default run stays short for the perf lane (AC12's comparison, above). A first version of this redraft
    put the 300 pairs in the default run; a second dispute the same day showed that breaks the frozen task (a 3 to 4
    minute run near `measureOnce`'s 300 s limit, 42 runs a preflight, and a p50 far over the base's by its 0.5
    margin), so the pair count moved to the argument;
  - a reading is the median paired difference over the median plain run, computed by the test;
  - the margin's spread is taken as a fraction of the limit, as the design's rule reads ("over it by more than
    the margin") and as the perf lane's `judgeLimit` already computes it.

  On the three readings the dispute reported, the new rule gives INCONCLUSIVE (margin 464%), FAIL for 3.83, 2.98,
  2.84, 3.55, 3.54 (margin 99%, all over 1.99), and INCONCLUSIVE for 10.57, 3.43, 3.33, 4.17, 4.08. Scaling the
  noisiest run's spread to 300 pairs gives a reading's standard deviation near 0.34 points, an estimate that
  assumes independent pairs. At that noise, a simulated program adding 0.2% passed in about 95% of 100,000 trials
  and was never FAIL, and one adding 3% failed in about 95% and never passed; the rest were INCONCLUSIVE. If the
  real noise on the reference Mac is wider, the number reads INCONCLUSIVE more often; a 3% program passes only if all five readings land two points low.
- **Tools this Mac lacks.** Each of these fails BLOCKED naming the tool:
  - Jest: AC3
  - pytest: AC3 and AC16
  - pnpm: AC10
  - a `go` that compiles: AC3. Go 1.10 amd64 segfaults here. A dispute redraft (2026-10-23) made the go probe and
    `fixtures/go-counts` modules with a `go.mod` (`go 1.16`): without one, `go test` needs GOPATH mode, off by
    default since Go 1.16, the first darwin/arm64 Go, so the test was BLOCKED even under a working Go 1.27.3 arm64.

So a PR for #30 that passes everything else says `Part of #30`, and lists AC19's timing half as open until #87
lands and a blind redraft of this job tests it.

## Files

- `helpers.ts`: the environment cleanup, temp folders and fixture copies (`*.fixture` renamed, `node_modules`
  cloned), the check builder, the world (record, asks, supervisor), the recording host, listeners, tool gates, the
  reference-Mac gate with the timing judge, an extension host on a world with a test package (`pkg`, `openHostOn`),
  and the claim a verdict is made from (`claimOf`, `policiesCheck`).
- `wrong.ts`: the derived wrong programs and the kit bends.
- The test files:
  - `hermetic.test.ts`: AC1, AC13, AC18
  - `record.test.ts`: AC2, AC3, AC15
  - `kind.test.ts`: AC4
  - `sandbox.test.ts`: AC5
  - `privacy.test.ts`: AC6, AC14
  - `ending.test.ts`: AC7
  - `standin.test.ts`: AC8
  - `added.test.ts`: AC9
  - `mask.test.ts`: AC10
  - `reads.test.ts`: AC11
  - `budgets.test.ts`: AC12
  - `places.test.ts`: AC16
  - `retries.test.ts`: AC17
  - `contract.test.ts`: AC19
  - `claims.test.ts`: the claim halves of AC2, AC7, AC8, AC9, AC10, AC14, AC17 and AC19
  - `replaces.test.ts`: AC5's slot half
  - `blocked.test.ts`: AC19's timing half (#87)
- `fixtures/`: one small project per scenario, and `command-kind`, the test check kind package of AC5's slot half.
  Their `.ts`, `.mjs` and `.js` files carry a `.fixture` suffix, so this suite and `tsc` skip them.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit; `BASE-FAILURE-claims.txt`: the redraft's new files run on its base.
- `REDRAFT.md`: what the redraft changed and why.
