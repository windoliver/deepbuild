# Acceptance tests for #68: check kinds for work beyond code

Written first, from issue #68 (its scope, fields, six acceptance criteria and Proof line), the design sections it
links and those around them, all in `docs/technical-design.md`: Checks for work beyond code; How runs become one of
five verdicts, with Check health, Fail before, pass after, Failing on an assertion, Proof depth and Numeric
contracts; the Check primitive; the Extension API block with `deep.registerCheck`; the Hub slots table's
`check.kind@1` row; What done means, fixed at the start (the drafting job and its early question); Every task
carries its own budgets; and How we know version 0 works (Conformance tests, Kit hygiene, Wrong programs,
Dogfooding). The house pattern is `tests/acceptance/685/` and `tests/acceptance/406/`. The base is commit
`83e4159c` (origin/main), where these surfaces were read: `packages/conformance` (the `check.kind@1` kit, its slot
types and its one runner), `packages/contracts/slots/check.kind@1.json`, `packages/proof` (#685's check kind and
its own kit), `packages/verdicts`, `packages/gate` and `packages/extension-host`. The job never saw an
implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

## Environment and running

Node 24.22.0 (the repo's `.node-version`), for `node:sqlite`. Nothing else: no network, no model, no paid call. The
service tests use the Mac's two loopback addresses, `127.0.0.1` and `::1`.

```sh
npx vitest run --root tests/acceptance/68 --testTimeout=600000
npx tsc -p tests/acceptance/68/tsconfig.json
```

## The surface under test

The issue names kinds, a kit, a verdict rule, budgets and the drafter's early question, but no code API, so these
tests define the smallest one they need: one new workspace package, `@deepbuild/checks-work`
(`packages/checks-work/src/index.ts`), holding the four R2 kinds as `check.kind@1` fills with a kit each, run by the
conformance package's one runner as `packages/proof` is, and the drafter's rule for kinds; and three small core
additions. Everything is reached through public entries, and the plug-in and the gate are imported lazily so each
test fails on its own at the base. The core's own surfaces carry what they already can: `runKit` and the slot
types in `@deepbuild/conformance`, `verdict` and its claim shapes in `@deepbuild/verdicts`.

```ts
// @deepbuild/checks-work — packages/checks-work/src/index.ts (new workspace package)
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec, KindBudget, SlotKit } from '@deepbuild/conformance';

/** R2's four kinds of check for work beyond code. */
export type WorkKind = 'service' | 'data' | 'document' | 'message';
export type JsonType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

/** An endpoint answers with the expected shape, within its latency and throughput floor, from where its users are.
 *  The check sends `requests` GET requests to `url`, each leaving from `from`, a local address of this machine where
 *  the endpoint's users are, whatever the URL's host resolves to first. It fails, at its assertion, when an answer's
 *  JSON body lacks a field of `shape` or holds it with another type, when the answers' 95th-percentile time is over
 *  `floor.latency_ms`, or when fewer than `floor.throughput_rps` requests are answered a second; each failure names
 *  what it measured and the floor. */
export interface ServiceSpec extends CheckSpec {
  kind: 'service'; runner: 'http';
  url: string; from: string; shape: Record<string, JsonType>;
  floor: { latency_ms: number; throughput_rps: number };
  requests: number;
}
/** A query returns the rows or totals that must hold. `database` is a SQLite file in the checkout, opened read-only;
 *  the check passes when the query's rows, in order, equal `rows`, column for column, and fails at its assertion
 *  otherwise. A query that errors is a crash: failed, its error kept as a failure that isn't an assertion. */
export interface DataSpec extends CheckSpec {
  kind: 'data'; runner: 'sqlite';
  database: string; query: string; rows: Record<string, string | number | null>[];
}
/** Every claim cites a source, and every number matches its source. `document` is a Markdown file in the checkout.
 *  A claim is a sentence of its body text (headings aren't claims). A citation is a Markdown link to a JSON file in
 *  the checkout with a JSON Pointer fragment, `[source](sources/q3.json#/revenue/west)`. Each claim cites at least
 *  one source, and each number written in a claim (`1,240` reads as 1240) equals the value its next citation points
 *  at. A claim with no citation, or a number that doesn't match, fails at the check's assertion, the failure naming
 *  the number as written, the source as cited, and the document's line. */
export interface DocumentSpec extends CheckSpec { kind: 'document'; runner: 'markdown'; document: string }
/** It was delivered, and acknowledged where the channel can say so. `mailbox` is a Maildir in the checkout (its
 *  `new/`, `cur/` and `tmp/`). Delivered: a file in `new/` or `cur/` whose `Message-ID` header is `message_id`.
 *  A Maildir can say whether a message was acknowledged: its seen flag, `S` in a `cur/` file's `:2,` info. The check
 *  fails at its assertion when the message wasn't delivered, or was delivered and not acknowledged, the failure
 *  saying which ("acknowledged" for the second). */
export interface MessageSpec extends CheckSpec { kind: 'message'; runner: 'maildir'; mailbox: string; message_id: string }
export type WorkSpec = ServiceSpec | DataSpec | DocumentSpec | MessageSpec;

/** A kind as the check.kind@1 fill `deep.registerCheck(kind, fill.run)` registers, with its declared budget. A run
 *  reports a closed run outcome, never a verdict (CheckResult). */
export interface WorkFill extends CheckRunnerFill {
  kind: WorkKind;
  budget: KindBudget;
  run(spec: WorkSpec, ctx: CheckContext): CheckResult | Promise<CheckResult>;
}
export function workFill(kind: WorkKind): WorkFill;
/** The kind's own check.kind@1 kit, run by the conformance package's runKit. Its fixtures' input is
 *  {spec, checkout, deadline} and their expected answer holds `outcome`, a run outcome; its fixed part ships at least
 *  one fixture whose id starts `planted-`, the kind's work with a planted fault, expected `failed`; it has a seeded
 *  part; and its planted runners include `past-deadline` (reports passed after its deadline) and `dropped-output`
 *  (drops a crashed run's output), each failing the kit with its own message. */
export function workKit(kind: WorkKind): SlotKit<WorkFill>;

/** The drafting job's proposal for one requirement: its ID, its text as the source states it, and the check the
 *  job picked for it from the work's domain and the source's criteria, or null where it found none. */
export interface DraftedRequirement { req: string; text: string; check: CheckSpec | null }
/** An early question: the requirement's ID and the question, which quotes the requirement's text. */
export interface EarlyQuestion { req: string; question: string }
export interface Draft { checks: { req: string; spec: CheckSpec }[]; questions: EarlyQuestion[] }
/** Keeps a proposed check only where one of `kinds` serves its kind, in the requirements' order; every other
 *  requirement becomes an early question instead of a guess. */
export function draftChecks(requirements: DraftedRequirement[], kinds: CheckRunnerFill[]): Draft;
```

```ts
// @deepbuild/conformance — packages/conformance/src/slot-types.ts, KindBudget exported from its index
/** A check kind's budget per run: the wall time it may take, in ms, and what it may cost, in US dollars. */
export interface KindBudget { time_ms: number; cost_usd: number }
export interface CheckRunnerFill extends SlotFill { /* as at the base, plus: */ budget?: KindBudget }

// @deepbuild/verdicts — packages/verdicts/src/types.ts
export interface ClaimCheck { /* as at the base, plus: */ oracle?: Oracle }  // the check's oracle, from its spec
// The engine never makes PASS on a check whose oracle is a model: a requirement such a check alone covers isn't PASS.

// @deepbuild/gate — packages/gate/src/index.ts
/** The gate's admission of a check kind: refused, naming the kind, when it declares no budget. */
export function admitKind(fill: CheckRunnerFill): { admitted: boolean; reason: string | null };
```

## What the tests hold the pieces to

- **Real work, no mocks.** Each kind runs on a real piece of work the test builds in a temporary folder, with a
  planted fault or its fix (`piece()` in `helpers.ts`): the service kind on a real HTTP server in a process of its
  own (`fixtures/server.mjs`, so a runner that blocks its own thread still reaches it); the data kind on a SQLite
  file written with `node:sqlite`; the document kind on a Markdown report and its JSON source; the message kind on a
  Maildir.
- **Through the core.** Each run becomes the run record the hub keeps (`runRecord`), on a claim whose one
  requirement one check covers, and the core's `verdict` gives the word: FAIL on the fault, PASS on the fix.
- **AC1** (`planted-failure.test.ts`, per kind): the kit ships a `planted-` fixture expected `failed`; `runKit` on
  the kind passes that case; on a runner that reports passed on any work, that case fails.
- **AC2** (`kit.test.ts`, per kind): `runKit` on the kind reads PASS on every case, fixed and seeded; the planted
  `past-deadline` and `dropped-output` runners are the kind's, and each makes the kit FAIL with a case carrying its
  own message; the two messages differ.
- **AC3** (`document.test.ts`): the report writing `1,250` where its cited source holds 1240 is `failed`, with a
  failure at the check's assertion naming `1,250` (or `1250`) and `sources/q3.json`; FAIL. The fixed report passes;
  PASS.
- **AC4** (`service.test.ts`): the fault endpoint answers requests from IPv4 (its users, `from: 127.0.0.1`) after
  300 ms against a 100 ms floor, and answers `::1`, where `localhost` reaches first, at once. The check is `failed`,
  a failure at its assertion naming the latency; FAIL; and the endpoint saw every request come from `127.0.0.1`. The
  fixed endpoint passes, also seen only from `127.0.0.1`; PASS.
- **AC5** (`model-opinion.test.ts`, per kind): on the fixed work, the check with code as its oracle gets PASS and
  the same check with a model as its oracle (spec and `ClaimCheck.oracle`) never does.
- **AC6** (`budgets.test.ts`, per kind): the kind declares `budget.time_ms` above 0 and `budget.cost_usd` of 0 or
  more; `admitKind` admits it (`{ admitted: true, reason: null }`) and refuses a copy without `budget`, its reason
  naming the kind; the kind's run on its fixed work passes within `time_ms`.
- **Proof** (`proof.test.ts`, `drafting.test.ts`): the data kind fails on east orders totalling 200 where 150 must
  hold, at its assertion, and passes on the fixed table; the message kind fails on a mail delivered and never seen,
  naming the acknowledgement, and passes on the seen mail; each FAIL then PASS. The service and document kinds' are
  AC4's and AC3's. The drafter: four requirements proposed with checks of the four kinds get them, in order, and a
  fifth, "The October invoice total reconciles with the bank statement", proposed as a `money` check that no
  registered kind serves, becomes the one early question, quoting it.

## Readings where the issue leaves a choice

- **The kit is the kind's own.** The core's shipped `check.kind@1` kit runs the `command` kind's suites, which none
  of these runners serves, so each kind brings its own kit for the slot, as #685's proof kind does, and the
  conformance package's one runner runs it. Its planted runners carry the core kit's names for the two faults AC2
  names. The tests use `runKit`, which awaits a fill that answers with a promise; they don't hold `kitProblems`,
  the preflight's synchronous kit check, so whether a kind answers synchronously is the implementer's choice.
- **"From where its users are"** reads as a declared origin, `from`: the local address the check's requests leave
  from. A host elsewhere comes with hosts in R3 (#71). The endpoint answering its users slowly and `::1` fast makes
  a check that ignores `from` meet a fast endpoint, so it can't pass the test.
- **The document format** (Markdown, JSON sources by JSON Pointer) is the smallest that lets "every number matching
  its source" be checked by code with no model; other formats can come later.
- **The data kind** is SQLite only, read-only; other databases come through sources.
- **The message channel** is a Maildir, which can say a message was acknowledged (its seen flag). A channel that
  can't say so (delivered alone suffices there) has no test here: no R2 channel of that kind is named.
- **AC5** is held in the core: the verdict engine reads each check's oracle (the Check primitive's `oracle`, carried
  as `ClaimCheck.oracle`), so no kind, these four or a plug-in's, can turn a model's opinion into PASS. The tests
  say only "never PASS"; which verdict (INCONCLUSIVE, as a reading's, is the natural one) is the implementer's.
- **AC6's gate** is `admitKind` in `@deepbuild/gate`, the gate's admission of a kind. `openCheckouts`, which takes
  the gate runner's kinds, would be the other place, but #31's suite passes test kinds with no budget to it and may
  not be edited, so a refusal there would break it. Where the gate calls `admitKind` (for instance where the hub
  hands kinds to the gate runner) is the implementer's, and any shipped kind it admits (the command kind, the proof
  kind) needs a budget then. "On the reference Mac in the local preflight, compared with the merge base" is a
  reading the preflight's budget window takes (design: Every task carries its own budgets): the merge base has none
  of these kinds, so there is no base side to compare; the test holds that each kind's run keeps to the time it
  declares.
- **The drafter.** The drafting job is a model job that picks kinds from the domain and the source's criteria;
  what code decides is which of its picks a registered kind can run. `draftChecks` holds that, and turns the rest
  into early questions instead of guesses. The test's uncheckable requirement is a money check, which comes with
  bills (#106), so no R2 kind serves it.
- **Registration.** No criterion names `deep.registerCheck`; the plug-in's register function, as `packages/proof`
  has, is the implementer's and untested here.
- **Depth.** The service spec says `integration`, the others `unit`; the claim's requirement takes the spec's depth.

## Wrong programs

Each test fails at the base (BASE-FAILURE.txt) and on these, in the same assertions: a runner that reports passed on
any work (AC1, and the Proof tests' fault halves); the kit's own `past-deadline` and `dropped-output` runners (AC2);
a document runner that reads numbers but names neither the number nor the source (AC3); a service runner that
ignores `from` (it meets the fast `::1` answers) or measures nothing (AC4); the base's verdict engine, which passes a
check whose oracle is a model (AC5); a gate that admits a kind with no budget (AC6); a drafter that keeps the money
check as a guess, or drops it with no question (drafting).

## Files

- `helpers.ts`: lazy imports, the pieces of work, the run record and the core's verdict on one check's run.
- `fixtures/server.mjs`: the order endpoint for the service kind.
- `planted-failure.test.ts` (AC1), `kit.test.ts` (AC2), `document.test.ts` (AC3, Proof for document),
  `service.test.ts` (AC4, Proof for service), `model-opinion.test.ts` (AC5), `budgets.test.ts` (AC6),
  `proof.test.ts` (Proof for data and message), `drafting.test.ts` (Proof's early question).
- `BASE-FAILURE.txt`: the base run and the type check.
