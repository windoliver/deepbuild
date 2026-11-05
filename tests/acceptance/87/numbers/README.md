# Acceptance tests for #87, part `numbers`: numbers re-run against their source

Written first, from issue #87 (its scope, fields, acceptance criteria and Proof line) and the design sections it links
and those around them, all in `docs/technical-design.md`: In version 0 (Checks); How runs become one of five
verdicts, with Check health, Failing on an assertion, Numeric contracts, Speed claims name their baseline and the
run outcomes (uncounted, the timing check under load); the Check primitive; What done means, fixed at the start;
Threats, and what stops each one; Numbers version 0 has to hold (Every task carries its own budgets, the reference
Macs); and How we know version 0 works (Conformance tests, Wrong programs, the cheat corpus's "a speedup timed
against a baseline its claim doesn't name, or on warm caches its check doesn't declare"). The house pattern is
`tests/acceptance/68/`. The base is commit `29d29ba5` (origin/main), where these surfaces were read:
`packages/verdicts` (the engine, `runContract`, the run and check shapes), `packages/conformance` (the
`check.kind@1` slot types and `runKit`), `packages/checks-work` (#68's data and document kinds), `packages/gate`
(`runTiming`, the timing check under load) and `packages/checks-command` (a command check's `timing` repeats, each
flushed only where the tool's report says so). The job never saw an implementation. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Four blind jobs share #87's criteria. This one holds the numbers check: the dashboard number three times too high,
`check.kind@1` for the numbers kind, an added term on a read-only sample of real data, the numbers half of the
budgets criterion, the speed claim with every INVALID and INCONCLUSIVE case and both wrong programs, and the Proof
line's numbers check against a seeded wrong total. The review check, model identity and the gate's integration are
the other jobs'.

## Environment and running

Node 24.22.0 (the repo's `.node-version`), for `node:sqlite`, and `git` for the speed claim's checkout. Nothing else:
no network, no model, no paid call.

```sh
npx vitest run --root tests/acceptance/87/numbers --testTimeout=600000
npx tsc -p tests/acceptance/87/numbers/tsconfig.json
```

## The surface under test

The issue names the numbers check, what it re-runs and how it judges a speed, but no code API, so these tests define
the smallest one they need: one new workspace package, `@deepbuild/checks-numbers`
(`packages/checks-numbers/src/index.ts`), holding the numbers kind as a `check.kind@1` fill with its own kit, run by
the conformance package's one runner as #68's kinds are, and the timing check behind a stated speed; and one small
core addition, the run record's timing report, so a speed's INVALID reaches the verdict with its reasons. Everything
is reached through public entries, and the plug-in is imported lazily so each test fails on its own at the base. The
core's own surfaces carry what they already can: `runKit` and the slot types in `@deepbuild/conformance`, `verdict`
and its claim shapes in `@deepbuild/verdicts`.

```ts
// @deepbuild/checks-numbers — packages/checks-numbers/src/index.ts (new workspace package)
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec, KindBudget, SlotKit } from '@deepbuild/conformance';
import type { TimingReport } from '@deepbuild/verdicts';

/** A query: a SQLite file in the checkout, opened read-only, and SQL whose one row's first column is the number. */
export interface Query { database: string; sql: string }
/** One number a claim states, with the query behind it, and an independent recount of the same number where one
 *  exists. `stated` is the number as written: `4,500` reads as 4500, and it holds when the query's value, rounded to
 *  the decimals written, equals it. */
export interface StatedNumber { where: string; stated: string; query: Query; recount?: Query }
/** A scoring term, filter, input or data source the change adds: the query as the change leaves it (`with`) and the
 *  same query without the term (`without`), both run on `sample`, a read-only sample of real data (a SQLite file in
 *  the checkout, opened read-only, never written). */
export interface AddedTerm { kind: 'scoring term' | 'filter' | 'input' | 'data source'; term: string; with: string; without: string; sample: string }
/** The numbers check: it re-runs the query behind each stated number, and its recount where one exists, and runs
 *  each added term on its sample. It passes when every stated number equals its query's value and its recount's,
 *  and every added term changes the result on its sample. Otherwise it fails at its assertion: a number's failure
 *  names where it is stated and shows both values, the stated number and the value it differs from (the query's or
 *  the recount's), with their difference; a term's failure names the term and shows the sample by its file. A query
 *  that errors is a crash: failed, its error kept as a failure that isn't the check's assertion. */
export interface NumbersSpec extends CheckSpec { kind: 'numbers'; runner: 'sqlite'; numbers: StatedNumber[]; added: AddedTerm[] }

/** The numbers kind as the check.kind@1 fill `deep.registerCheck('numbers', fill.run)` registers, with its budget.
 *  A run reports a closed run outcome, never a verdict (CheckResult). */
export interface NumbersFill extends CheckRunnerFill {
  kind: 'numbers';
  budget: KindBudget;
  run(spec: NumbersSpec, ctx: CheckContext): CheckResult | Promise<CheckResult>;
}
export function numbersFill(): NumbersFill;
/** The numbers kind's own check.kind@1 kit, run by the conformance package's runKit, with a seeded part; its planted
 *  runners include `past-deadline` (reports passed after its deadline) and `dropped-output` (drops a crashed run's
 *  output), each failing the kit with its own message. */
export function numbersKit(): SlotKit<NumbersFill>;

/** A toolchain by version: the compiler, the GPU driver and the runtime libraries. */
export interface Toolchain { compiler: string; driver: string; runtime: string }
/** The timing check behind a stated speed. `baseline` is what the speed compares with: a commit of the checkout's
 *  repository (the merge base by default for the repo's own code) or a library at a pinned release; the toolchain
 *  each side must run with; the machine by its environment fingerprint; `warm` only when the check can time warm
 *  caches alone; and the timed repeats a side, five. */
export interface TimingCheck {
  baseline: { commit: string } | { library: string; release?: string };
  toolchain: { baseline: Toolchain; change: Toolchain };
  machine: string;
  warm?: true;
  repeats: number;
}
/** A speed a claim states, as written ('1.8× faster than the merge base': the factor is the number before ×), with
 *  the timing check behind it. */
export interface SpeedClaim { stated: string; timing: TimingCheck }
/** One side's work as the platform runs it, a boundary the check doesn't own: a warm-up that only compiles and
 *  loads; a cache flush that reports whether it flushed; one timed repeat of the work, which the check times with
 *  its own clock; and the toolchain and machine the side actually ran with. */
export interface Side {
  warmUp(): void | Promise<void>;
  flush(): boolean | Promise<boolean>;
  work(): void | Promise<void>;
  toolchain(): Toolchain;
  machine(): string;
}
/** A speed claim's run: the closed run outcome, the timing report the run record carries (`Run.timing`), and each
 *  side's timed repeats in ms, in order. */
export interface SpeedResult extends CheckResult { timing: TimingReport; repeats: { baseline: number[]; change: number[] } }
/** Planted twins the criterion names; tests only. `library-baseline` accepts a baseline named only by its library;
 *  `any-toolchain` counts a side that ran under a toolchain the check doesn't name. */
export type SpeedPlant = 'library-baseline' | 'any-toolchain';
/** Re-runs a stated speed through its timing check: both sides in one run, each warmed up once, then each timed
 *  repeat preceded by a flush, `repeats` a side. A baseline that is missing, or doesn't resolve to a pinned release
 *  or a commit of `ctx.checkout`'s repository, is INVALID naming the missing baseline; a flush that reports it didn't
 *  flush, in a check that doesn't declare warm caches, is INVALID naming the repeat; a side whose toolchain or machine
 *  isn't the one the check names makes the timing a reading (run uncounted). Otherwise the stated factor is judged
 *  as a timing result is, on the five repeats a side: passed when all five reach it within the margin, failed when
 *  all five miss it by more than the margin, uncounted otherwise; the margin is the larger of 5% and the five's
 *  spread. */
export function checkSpeed(claim: SpeedClaim, sides: { baseline: Side; change: Side }, ctx: CheckContext, plant?: SpeedPlant): Promise<SpeedResult>;
```

```ts
// @deepbuild/verdicts — packages/verdicts/src/types.ts
/** A timing check's report of how it ran (#87): INVALID with its reasons (a baseline missing or unresolved, a repeat
 *  not flushed); a reading, naming why (a side off the named toolchain or machine); or counts. `warm` when the check
 *  declares warm caches. */
export interface TimingReport { outcome: 'counts' | 'reading' | 'INVALID'; reasons: string[]; warm: boolean }
export interface Run { /* as at the base, plus: */ timing?: TimingReport }
// The engine reads a run's timing report as it reads a contract's: INVALID makes the check INVALID with its reasons.
```

## What the tests hold the pieces to

- **Real work, no mocks.** The numbers kind runs on SQLite files the test writes with `node:sqlite` in a temporary
  checkout (`helpers.ts`). The speed claim's two sides do real CPU work the check times with its own clock, of
  deterministic cost, the change a twentieth of the base's; their cache flush overwrites a 32 MB buffer and reports
  what the test plants. The toolchain, the machine fingerprint and the flush reports are declared inputs the test
  supplies: the boundary a GPU driver or a cache-flush call would be, which the check doesn't own. The baseline commit
  is a real commit of a git repository the test makes as the checkout.
- **Through the core.** Each run becomes the run record the hub keeps (`runRecord`, with the speed run's `timing`),
  on a claim whose one requirement one check covers, and the core's `verdict` gives the word.
- **Dashboard** (`dashboard.test.ts`): a dashboard states revenue as `4,500` where the query behind it sums to 1500.
  The check is `failed`, a failure at its assertion showing both values (`4,500` or `4500`, and `1,500` or `1500`);
  FAIL. The dashboard stating `1,500` passes; PASS.
- **Kit** (`kit.test.ts`): `runKit` on the numbers kind reads PASS on every case, fixed and seeded; its planted
  `past-deadline` and `dropped-output` runners each make the kit FAIL with a case carrying its own message, and the
  two messages differ.
- **Added term** (`sample.test.ts`): on a read-only sample of 200 orders, none of them a test order, a filter the
  change adds, `status <> 'test'`, changes no result: the check is `failed` at its assertion, naming the term and the
  sample's file; FAIL. The filter `status <> 'refunded'` changes the total there: `passed`; PASS. The sample's bytes
  are unchanged after both runs.
- **Budget** (`budget.test.ts`): on a 300,000-row table, the numbers check's re-run of a dashboard number (no
  recount) takes no more than twice the original query's own time, opening the file and running it with `node:sqlite`:
  the fastest of five interleaved runs each, so a loaded machine slows both sides alike.
- **Speed** (`speed.test.ts`): a claim of "1.8× faster than the merge base", its timing check naming the merge base's
  commit, the compiler, driver and runtime on each side and the machine's fingerprint, passes when the change is
  about twenty times faster: each side warmed up once, then five flushes each followed by one timed repeat; five
  repeats a side; PASS. The same claim where both sides do the same work is never PASS. Against "the library" with
  no release or commit: INVALID, a reason naming the baseline. With the baseline side's flush reporting no flush on
  its third repeat: INVALID, a reason naming repeat 3. With the baseline side run under another driver than the
  check names: the timing report is a reading naming the driver, and the claim INCONCLUSIVE.
- **Proof** (`proof.test.ts`): a daily rollup seeded with a wrong total, 1,850, which the dashboard's query reads and
  the claim states; the independent recount from the raw orders gives 1500. The check is `failed` at its assertion,
  showing both values; FAIL. The rollup holding 1,500 passes; PASS.

## Readings where the issue leaves a choice

- **Where the numbers live.** A stated number cites a SQL query on a SQLite file in the checkout, as #68's data kind
  reads one; other sources come through sources (#364). The number is the query's one row's first column.
- **"A dashboard number three times too high"** reads as the number the dashboard states against the query behind
  it, the re-run's half of the check. The recount's half is the Proof line's: a seeded wrong total in a rollup table
  that the dashboard's own query faithfully reads, which only an independent recount from the raw rows catches.
- **"Both values shown"** reads as the failure's message holding both numbers, written either way (`4,500` or
  `4500`). The difference beside them is the check's to add; no test reads it.
- **An added term** is given to the check with its query with and without it, as the change and its merge base write
  it, and "changes no result" reads as the two queries returning the same rows on the sample. "Showing the sample"
  reads as the failure naming the sample's file. "Read-only" reads as the sample file left byte for byte as it was
  (it is also made read-only on disk).
- **The budget.** "On the reference Mac in the local preflight, compared with the merge base" is the preflight's
  budget window's reading (design: Every task carries its own budgets); the merge base has no numbers kind, so the
  base side is the original query itself, run as the dashboard runs it. The test compares the fastest of five runs a
  side, so the shared machine's load slows both sides alike.
- **The speed claim's sides.** A speed's timing check times code the platform runs: the warm-up, the cache flush and
  the toolchain and machine it ran with are the platform's, so they are a boundary (`Side`) the test supplies. What
  the check owns, and what the test holds, is running both sides in one call, warming each up once, flushing before
  every timed repeat, timing with its own clock and judging the reports. A flush's report is its return value.
- **Which INVALID and INCONCLUSIVE reach the verdict how.** A reading is an uncounted run, which the base engine
  already makes INCONCLUSIVE. An INVALID needs its reasons in the verdict, which no run outcome carries, so the run
  record gets a timing report as it has a contract's report, and the engine reads it the same way.
- **"Within the margin"** and how the five pairs are compared (per repeat or per side) are the implementer's: the
  passing case's change is about twenty times faster than the base against a stated 1.8×, and the twin with equal
  work is about 1×, so any reading of the margin decides both, even on a loaded machine.
- **Wrong programs as switches.** The two the speed criterion names are planted behind `checkSpeed`'s `plant`, as
  `packages/checks-command` plants its twins; the tests run each and show it fails the criterion's assertion.
- **Requirements about numbers.** The claims' requirements don't set `numbers: true`, which the engine reserves for
  checks with a numeric contract (a kernel against its reference at a precision); a re-run number compares equal at
  the precision it is written in, and declares no contract.
- **Warm caches.** No test here declares warm caches; the receipt line's "warm" is outside this slice's criteria.

## Wrong programs

Each test fails at the base (BASE-FAILURE.txt) and on these, in the same assertions: a check that re-runs the query
but doesn't compare it with the stated number, or names only one of the two values (dashboard); one with no recount,
or that compares the stated number with its own query alone (Proof); a kind whose runner reports passed after its
deadline or drops a crashed run's output (kit, its own planted runners); one that never runs an added term on its
sample, or passes a term that changes nothing (added term); a re-run that runs the query more than once, or
copies the database before reading it (budget); and for the speed claim, the two the criterion names, planted as `library-baseline`
(accepts a baseline named only by library: the "the library" claim is no longer INVALID) and `any-toolchain` (counts
a side run under a driver the check doesn't name: the claim is no longer INCONCLUSIVE), plus a check that times only
one side or doesn't time at all (the equal-work twin is never PASS), one that skips the flush before a repeat, and
one that ignores a flush's report.

## Files

- `helpers.ts`: lazy imports, the SQLite pieces of work, the speed claim's sides and checkout, the run record and
  the core's verdict on one check's run.
- `dashboard.test.ts`, `kit.test.ts`, `sample.test.ts`, `budget.test.ts`, `speed.test.ts` (the criterion and its two
  wrong programs), `proof.test.ts`.
- `BASE-FAILURE.txt`: the base run and the type check.
