# Acceptance tests for #313: the conformance runner, broken fakes, one source per code family, a closure on every enum

Written first, from issue #313 (its text as of October 20), the design sections it links and those around them
(the Extension API block with `deep.registerAdapter`; Socket roles and contract versions, with Contracts that
can't drift, the code families and the `deep` exit-code table, and What a minor may change; Hooks are evidence,
not a state machine, with the adapter rules; How we know version 0 works, with Conformance tests, Kit hygiene,
Generated edges and exact issues, Criteria to tests both ways, Criteria in a checked shape, Wrong programs and
Dogfooding; the MCP-tools row of the interfaces table for `deep://codes/<code>`, all in `docs/technical-design.md`;
Closed enums and Registries and closed lists in `docs/canvas-primitives.md`), the issue it depends on (#312, with
`tests/acceptance/312/`) and base commit `c8837ea` (origin/main), by a job that never saw an implementation. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them with the repo's Node (`.node-version`, 24.22.0; the repo's `vitest.config.ts` also takes
`tests/**/*.test.ts`, so the unit lane runs them too):

```sh
npm ci                                    # once, if node_modules is missing
npx vitest run --root tests/acceptance/313
```

With `--root` here, Vitest writes its cache to `tests/acceptance/313/node_modules/.vite/`; delete that folder
before committing (it is not in `.gitignore`). `packaging.test.ts` runs `npm run build --workspaces` first (a
second run is incremental, about a second) and then the built `deep` CLI and the conformance bin; the Rust
consumer test in `generator.test.ts` runs `cargo build --locked -q -p deep-contracts --bin deep-contracts`, as
`packages/contracts/test/rust-checks.test.ts` does. Nothing here needs the network.

The tests import `packages/contracts/src/index.ts`, `packages/adapters/src/index.ts` and
`packages/conformance/src/index.ts` with their `.ts` extensions; `tsconfig.json` here extends the root one with
`noEmit` and `allowImportingTsExtensions`:

```sh
node node_modules/typescript/bin/tsc -p tests/acceptance/313/tsconfig.json
```

They type-check with no errors against a declaration-only copy of the surface below, kept outside the repo and
placed at `packages/conformance/src/index.ts` only for that check (BASE-FAILURE.txt, header).

## The surface under test

The issue names a runner, fakes, kits, code families, pages and a generator, but almost no code API, so these
tests define the smallest one they need. It is the public entry of a new workspace package,
`@deepbuild/conformance`, at `packages/conformance/src/index.ts` (AC8), plus annotations on the published
schemas of `@deepbuild/contracts`, read only through `getSchema`, `listSchemas`, `lintSchemas`, `validate` and
`registry` of its public entry, one `deep` command, and one lint-lane script. The tests import nothing else from
any package and read only the files named here. `@deepbuild/adapters` is used as #312 published it.

```ts
// @deepbuild/conformance — packages/conformance/src/index.ts
import type { JsonValue, Schema, SchemaEntry } from '@deepbuild/contracts';
import type { Adapter, AdapterCaps, AdapterEvent, HookRequestLine, Mapped } from '@deepbuild/adapters';

export type Verdict = 'PASS' | 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE';
export type Flag = keyof AdapterCaps;
export type Operation = 'startTurn' | 'steer' | 'followUp' | 'interrupt' | 'respond' | 'history';
/** A driven operation's typed outcome: ok with the events it made, or unsupported naming the operation and surface. */
export type Driven = { outcome: 'ok'; events: AdapterEvent[] } | { outcome: 'unsupported'; operation: Operation; surface: string };
/** Where an answer went and the transcript's sign of its delivery, null for none. */
export interface Delivery { session: string; sign: string | null }

/** What a kit runs: an adapter plus the driven surface. Plain data and closures: a test may spread it (Readings). */
export interface Fill {
  adapter: Adapter;
  version: string;      // the agent version its facts cover, passed to mapHook
  revision: number;     // the kit revision it declares (Kit.revision)
  surface: string;      // the surface it serves, a key of adapter.unsupported: cli, app-server, desktop …
  drive(operation: Operation, input: JsonValue, session: string): Driven;
  deliver(answer: JsonValue, session: string): Delivery;
}

export interface Declared { flags: Flag[]; operations: Operation[]; kinds: string[] }
export interface Rect { x: number; y: number; w: number; h: number }
/** What a case may do; every probe records what the case reached. */
export interface Harness {
  hook(line: HookRequestLine): Mapped;                                   // through the fill's adapter; reaches the kinds it maps
  drive(operation: Operation, input: JsonValue, session: string): Driven;  // reaches the operation and the flag behind it (startTurn, steer, followUp)
  permission(request: JsonValue, session: string): Delivery;             // a permission request answered through the fill; reaches answerPermission
  bounds(panel: string): Rect;                                           // geometry; a headless harness can't make it: the case is BLOCKED naming `bounds`
  fail(message: string, codes?: string[]): never;                        // the case's own finding
}
export interface Case { id: string; revision: number; declares: Declared; run(h: Harness): void }

/** A broken fake: a fill that mishandles exactly one item (the one key of `breaks`), the message it must fail with, the codes it must raise. */
export interface Fake {
  name: string; message: string; codes: string[];
  breaks: { rule?: string; flag?: Flag; operation?: Operation; kind?: string };
  fill: Fill;
}
export type FamilyName = 'verdict' | 'run' | 'refusal' | 'check' | 'doctor' | 'exit';
/** One planted entry: an input that raises exactly `code` when replayed, its clean twin that raises nothing, and the fix. */
export interface PlantedEntry { family: FamilyName; code: string; codes: string[]; entry: JsonValue; twin: { value: JsonValue; codes: string[] }; fix: string }
/** A kit: plain data, so a test may derive a variant by spreading it. */
export interface Kit { name: string; revision: number; cases: Case[]; fakes: Fake[]; planted: PlantedEntry[] }
export function kits(): Kit[];                 // the shipped kits; one is named adapter@1
export function cleanFill(kit: Kit): Fill;     // the kit's reference fake agent, which passes every case of the kit

export interface CaseResult {
  id: string; outcome: Verdict; message: string; codes: string[];
  declared: Declared; reached: Declared;       // what the case declared, and what its probes really reached
  probes: string[];                            // the probes the harness couldn't make (BLOCKED names them)
  killed: string[]; survived: string[];        // the fakes of its declared items it failed, and those it passed
}
export interface Report { verdict: Verdict; revision: number; cases: CaseResult[] }
/** Runs the cases of the fill's revision or earlier; throws a ContractError when the fill can't load (AC2). */
export function runKit(kit: Kit, fill: Fill, options: { headless: boolean }): Report;
/** Runs the kit on a fake's fill and compares the codes raised with the codes it names; killed only when equal. */
export interface FakeProof { raised: string[]; extra: string[]; missing: string[]; killed: boolean }
export function proveFake(kit: Kit, fake: Fake): FakeProof;
/** The codes a family input raises when the kit replays it (the kit decides each family's input form; Readings). */
export function replay(kit: Kit, family: FamilyName, input: JsonValue): string[];
/** The preflight's kit checks: a rule with no fake, a code no entry raises, a fake, entry or twin naming codes it doesn't raise. */
export interface Problem { check: string; name: string; reason: string }
export function kitProblems(kit: Kit): Problem[];

/** One code family: its source enum (a published schema and the JSON Pointer of the enum node) and its codes. */
export interface CodeFamily { family: FamilyName; schema: string; pointer: string; codes: string[] }
export function codeFamilies(schemas?: readonly SchemaEntry[]): CodeFamily[];       // over the published schemas, or the given ones
export function unmappedCodes(schemas?: readonly SchemaEntry[]): { family: FamilyName; code: string }[];  // enum values with no mapping
export interface Judgement { family: FamilyName; code: string; listed: boolean; verdict: Verdict; message: string }
export function judge(family: FamilyName, code: string): Judgement;   // an unlisted code: INVALID, listed false, message naming it
export function exitCode(verdicts: readonly Verdict[]): 0 | 1 | 3;    // the one exit-code table
export interface CodesPage { uri: string; code: string; family: FamilyName; schema: string; entry: PlantedEntry; markdown: string }
export function codesPage(uri: string): CodesPage;                     // deep://codes/<code>; throws at /code for a code no family lists, at /uri for another scheme

/** The closure beside an enum (x-closure), as the schemas carry it. */
export type Closure = 'open' | { registry: string } | { closed: string; reopens: string; mark: 'exhaustive' | 'extensible' };
export interface Change { schema: string; path: string; reason: string }
/** The contract step: the changes a minor may not make under the same name (a member added to an exhaustive enum among them). */
export function contractStep(before: readonly SchemaEntry[], after: readonly SchemaEntry[]): Change[];
/** What a reader built at `schema` sees of a value from a later minor: a member it doesn't know of an extensible enum reads unknown. */
export function serveAt(schema: Schema, value: JsonValue): JsonValue;

export type MutationKind = 'required_removed' | 'enum_off_list' | 'number_past_range' | 'unknown_field';
export interface Mutation { kind: MutationKind; path: string; code: string; value: JsonValue }   // code: required | enum | range | unlisted_field
export interface Drawn { valid: JsonValue; mutations: Mutation[] }
export const RECORDED_SEED: number;
export function draw(schema: Schema, seed: number, cases: number): Drawn[];   // deterministic from the seed
```

Beside the package:

- **`x-closure` beside every enum.** Every node of a published schema that carries `enum` carries `x-closure`,
  a `Closure` above. `lintSchemas` (the existing contracts lint, which `npm run generate` and the unit lane run)
  flags, at the enum node's path, an enum with no closure, a closure of none of the three forms, a closed one
  without `mark`, and an extensible one whose values lack `unknown`. The adapter caps (`adapter.caps@1`, a
  closed list of boolean flags) carry a closed closure on their root, and the access words (`access@1`, a
  listed set written as a pattern) on their `items` node.
- **`x-rules` on `adapter.facts@1`.** The adapter rules as one list at the schema's root: `[{id, rule}]`, ten
  entries in the design's order, each `rule` text containing the design's phrase (`helpers.ts`, `RULE_PHRASES`),
  each `id` of the form `^[a-z][a-z0-9_-]*$`. A fake's `breaks.rule` names an `id`.
- **`deep run --result <file>`** (`packages/cli/src/main.ts`, built to `packages/cli/dist/main.js`): judges one
  recorded run result, a `run.finished@1` event, printing its verdict and exiting by the table: 0 for `passed`,
  1 for `failed`, 3 for anything not decided, among them an outcome no enum lists (printed as `INVALID` with the
  raw code, never `PASS`). No `--result`, or a file that doesn't exist, is a usage error, exit 2. `deep --help`
  lists `run`.
- **`scripts/conformance-lint.mjs`**, run by the lint lane (`checks` in `scripts/lanes.mjs`): one line per check,
  `PASS|FAIL|INVALID|BLOCKED|INCONCLUSIVE <check>: <message>`, exit 1 on any failure. It runs `kitProblems` on
  the shipped kits and `unmappedCodes` over the published schemas at least; the tests pin no check names.
- **`packages/conformance/package.json`**: `name` `@deepbuild/conformance`, in the root's `packages/*` workspace,
  with `bin.deep-conformance`. The bin: `--help` exits 0 and names `run` and `--fill`; `run --fill <module>`
  loads an ES module whose default export is a `Fill`, runs the adapter kit on it, prints one
  `<OUTCOME> <case>: <message>` line per case and exits by the table; an unknown command or a module that
  doesn't exist exits 2.

### What the tests hold the pieces to

- **The clean fill passes.** `runKit(adapterKit, cleanFill(adapterKit), {headless: true})` reads `PASS` on every
  case; every failure a test looks for is the one fault it planted on that fill.
- **Replies.** A `mapHook` reply whose event fails `adapter.event@1` fails its case with the refusal's code (an
  `error@1` code in `codes`) and the pointer into the reply in the message (`/events/0/kind`); a `drive` reply
  outside the two outcomes fails naming `/outcome`; a reply that isn't a mapping at all fails the same way.
- **Load.** A fill whose adapter has no `doctor`, whose facts have no `versions` (or an empty list), or that
  implements `readUsage` with no facts section naming its case, is refused by `runKit` with a `ContractError` at
  `/adapter/doctor`, `/adapter/facts/versions`, `/adapter/facts/readUsage` or `/adapter/facts/readUsage/conformance`
  (#312's registry refuses the same at `/facts/…`). Facts without `hookTimeouts` are refused naming the section.
- **Both ways.** For each of the six operations and the fill's `surface`: listed in `adapter.unsupported[surface]`,
  `drive` must return `{outcome: 'unsupported', operation, surface}` (the same operation and surface), else a
  FAIL whose message names the operation and the surface; with its flag declared (`startTurn`, `steer`,
  `followUp`), `drive` returning `unsupported` is a FAIL whose message names the flag.
- **Coverage.** Each declared flag, operation or kind a case never reaches makes it `INVALID` with
  `declared <item>, never reached` in the message, once per item. `bounds` on a headless harness makes the case
  `BLOCKED`, `bounds` in `probes` and in the message. A case whose declared items' fakes all survive it is
  `INVALID`, with the fakes in `survived`; a case that kills them lists them in `killed`.
- **Fakes.** `fakes` holds one whose `message` is each of the five: `duplicate event ID`, `event after stop`,
  `answer delivered to another session`, `steer outlived interrupt`, `acknowledged with no transcript sign`; one
  per rule (`breaks.rule`) and one per declared item (`breaks.flag`, `.operation` or `.kind`), every message
  distinct. Running the kit on a fake's fill gives a FAIL whose message contains the fake's `message` and whose
  `codes` contain the fake's. The four hook-rule fakes among the five sit under the rules the design places them:
  the duplicate ID under ordering by `seq` with ties by ID, the late event under the stopped turn, the other
  session under one owner, the missing sign under delivery confirmed from the transcript.
- **Revisions.** `runKit` runs a case only when `case.revision <= fill.revision`; `Report.revision` is the fill's.
- **Families.** `codeFamilies()` names the six; `verdict` is exactly `PASS, FAIL, INVALID, BLOCKED, INCONCLUSIVE`
  (and `verdict@1`'s and `verdict.made@1`'s union tags agree with it); `run` the seven run outcomes of
  `run.finished@1`; `refusal` `error@1`'s `code` enum, equal to `ERROR_CODES`; `exit` the strings `0, 1, 2, 3`;
  `doctor` extensible with `unknown`; `check` non-empty. Codes are unique across families. `judge` maps
  `verdict` to itself, `passed` to `PASS`, `failed` to `FAIL`, exit `0` to `PASS`, `1` to `FAIL`, `3` to one of
  `BLOCKED`, `INVALID`, `INCONCLUSIVE`, and never a refusal, exit `2` or `unknown` to `PASS`. `exitCode`: 1 when
  any `FAIL`, else 0 when all `PASS`, else 3 (an empty list is 3).
- **Planted entries.** Across `kits()`, exactly one entry per code of every family; `codes` is `[code]`, the
  twin's `codes` is `[]`; `replay` of the entry is exactly `[code]`, of the twin `[]`; `fix` non-empty. A
  `run`-family input is a `run.finished@1` event (`fixtures/run-results/flaky-maybe.json` raises `flaky_maybe`,
  not `passed`). `codesPage('deep://codes/<code>')` returns the family, its schema, that entry, and a `markdown`
  that contains the code, the schema name, the fix, and the JSON of the entry and of the twin.
- **Generator.** For every published schema, `draw(schema, RECORDED_SEED, 1000)` yields 1,000 valid instances the
  TypeScript validator and the Rust `deep-contracts check` accept, each with mutations whose `code` is the
  kind's (`required`, `enum`, `range`, `unlisted_field`) and which `validate` refuses with that code at
  `Mutation.path`; every kind the schema affords (a required field, an enum, a bounded number, a closed object
  anywhere in it) appears among its draws; two draws at one seed are equal, and another seed draws differently.

## Readings where the issue and design leave a choice

- **Sixteen criteria.** The issue lists sixteen checkbox criteria; they are numbered AC1 to AC16 here in its order.
- **A fill, not an adapter.** The runner drives more than #312's `Adapter` (driven operations, delivery), so it
  takes a `Fill`: the adapter, the version its facts cover, the kit revision it declares, the one surface it
  serves, `drive` and `deliver`. The design's `deliver(answer, session)` is kept; `install` and `start` are left
  out, since no criterion reaches them. A `Fill` and a `Kit` are plain data whose functions are closures (not
  methods on `this`), so a test can spread one to plant a fault: `{...fill, drive}`, `{...kit, cases}`. That is
  how every broken variant in these tests is built from `cleanFill`, and how two fakes are composed in AC14.
- **Where a refused load lands.** "Fails conformance" for an absent `doctor`, absent versions or an optional
  method without its case is read as a refusal to load the fill at all (`runKit` throws a `ContractError`, path
  rooted at `/adapter`), the way #312's registry refuses it; a fact a case reads (the Stop timeout) is a case FAIL.
- **Messages.** The five fakes' messages are the issue's quoted strings, exactly. "Its own message" is read as
  distinct among the kit's fakes; the case result's `message` contains the fake's. "That rule's message" (AC12)
  is the message of the rule's fake. The coverage message is the issue's `declared answerPermission, never
  reached`, generalized to `declared <item>, never reached` per item.
- **Codes a fake raises.** `codes` are family codes (the check catalog's family is read as the codes a kit's
  cases raise, with the refusal codes beside them when a reply is refused). The runner compares the raised set
  with the named set exactly; "raises its rule's code and one more" is built by composing two fakes' fills.
- **A twin raises nothing.** AC14 says a twin's named set is empty, so `replay(twin)` is `[]` for every family,
  outcome families included: the kit picks, for an outcome family, a twin that leaves nothing to judge (a result
  with no outcome, say). The entry forms are the kit's, except the `run` family's, which is a `run.finished@1`
  event, the natural "run result" AC7 names.
- **The closure's form.** `x-closure` sits on the enum node itself, since the issue says every enum "carries" one
  and the lint names an enum by its path. Its three forms are the issue's words as JSON: a registry
  (`{registry: "name@major"}`), closed (`{closed: <reason>, reopens: <what would reopen it>, mark: exhaustive |
  extensible}`) or `"open"`. The adapter caps and the access words, which the issue names and which are listed
  sets but not `enum` nodes (booleans; a pattern), carry theirs on the list itself. `lintSchemas` is the
  preflight's schema lint already (`generate` and the unit lane), so "the local preflight fails, naming the enum"
  is held through it on an in-memory copy of the schemas with the fault planted; the lane that runs it is
  unchanged.
- **The adapter rules' home.** "One numbered list in `adapter.facts@1`" is read as the schema's root annotation
  `x-rules`, the one source every facts file shares, not a field of each facts instance. Its texts are held to
  the design's ten phrases, its ids are the implementer's.
- **Code families' sources.** Each family's enum is wherever `codeFamilies()` says it is, a published schema and
  a pointer; the tests pin only the members (above) and that the verdict record's union tags agree with it. At
  the base no enum holds the five verdicts alone (`verdict@1` and `verdict.made@1` are unions tagged by
  `outcome`; the requirement enum adds `pending`), no doctor-code or exit-code enum exists, and no check-catalog
  codes are published: each needs a source. The `deep` exit codes are a string enum (`"0"` … `"3"`), since the
  closed node types put `enum` on strings only.
- **"Fails the build" (AC7).** Read as the local preflight's check run: `unmappedCodes` over the schemas with
  the value added names it, and the lint lane's script runs that check. A TypeScript mapping over a generated
  union would fail `tsc` too; the tests don't require that form.
- **The mapping.** "A total mapping to a verdict or an outcome" is held as a verdict per code (`judge`), with the
  run family's codes, themselves outcomes, mapped the obvious way (`passed` → `PASS`, `failed` → `FAIL`); which
  verdict `ran_nothing` or exit `2` takes is the implementer's, short of `PASS`.
- **"Makes no result pass" (AC13).** A new stop cause served at the earlier minor reads `unknown` (`serveAt`),
  and `unknown` in an extensible code family judges below `PASS`; stop causes feed no verdict directly at this base.
- **The contract step.** `contractStep(before, after)` is the "step" the issue names: a member added to an
  extensible enum is no change it reports; one added to an exhaustive enum is, naming the schema and the enum's
  path; the same shape under a new name (`<name>@<major+1>`) beside the unchanged old one reports nothing.
- **Headless.** Tests run headless (`{headless: true}`); `bounds` is the one probe the issue names.
- **The recorded seed** is `RECORDED_SEED`, exported by the package; the tests also draw at `RECORDED_SEED + 1`
  to see the seed matter. The Rust consumer checks 25 draws per schema and their off-list mutations, since one
  process per schema over 1,000 lines is what the budget allows; the TypeScript consumer checks all 1,000.
- **Surface names.** `cli` is the surface AC5 names; `app-server` is the other the tests use.

## Criteria to tests

Each test's name starts with its criterion ID. Where a criterion names a wrong program, a test headed
`(wrong program)` builds that program as a stand-in (`helpers.ts`, last section) and feeds it to the same
assertion the real one gets, expecting the assertion to fail naming what the criterion says; where the stand-in
is a schema twin or a lenient consumer, it is built the same way. Every negative test names the refused field's
JSON Pointer through `error@1` (`expectRefused`, `expectThrown`), and every every/never rule is a 1,000-case
`fast-check` property at seed 313.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 | the runner rejects a sample adapter that returns an invalid reply | `runner.test.ts` AC1 (3): a `mapHook` event with a number for its kind, a `drive` reply outside the outcomes, a null reply; plus the clean-fill PASS (1) |
| AC2 | no `doctor()` or no versions fails; an optional method without its conformance test is refused at load | `runner.test.ts` AC2 (4): `/adapter/doctor`; `/adapter/facts/versions` missing and empty; `readUsage` without its case at the kit and at the registry, and without its section; the doctor shape |
| AC3 | the five fakes each fail with their own message, the five differ; a shape-only runner passes all five and fails this test naming each | `fakes.test.ts` AC3 (8): one per fake (5), distinct messages, none passed (names each passed), the shape-only stand-in passes all five and is named |
| AC4 | the stop-cause closure removed fails the preflight naming the enum; a planted enum with none fails the same way; each passes with a registry, closed with reason and reopens, or `open` | `closures.test.ts` AC4 (8): every enum carries a closure (caps and access words among them), stop cause stripped, planted enum, the three forms (3), ill-formed closures refused while a well-formed one passes, a 1,000-case property over every enum |
| AC5 | `followUp` unsupported for `cli` returning ok fails naming both; returning the typed outcome passes; caps declaring `followUp` but returning unsupported fails naming the flag | `runner.test.ts` AC5 (5): ok fails naming `followUp` and `cli`; typed outcome passes; wrong operation or surface fails; declared flag fails naming it; a 1,000-case property over every operation and surface name |
| AC6 | a case declaring `answerPermission` that returns early reads INVALID "declared answerPermission, never reached"; a headless bounds probe reads BLOCKED naming the probe; a counting runner fails | `runner.test.ts` AC6 (5): the early return, the reaching case, the panel probe, a 1,000-case property over declared subsets, the counting stand-in caught |
| AC7 | adding a value to the verdict, refusal or exit enum without its mapping fails the build naming it; a planted `flaky_maybe` reads INVALID never PASS; `deep run` exits 3 | `codes.test.ts` AC7 (10): six families and their sources, the pinned members, one source (union tags), total mapping, the added value named (3), `flaky_maybe` INVALID through `judge` and `replay`, a 1,000-case property over unlisted strings, the exit table (fixed and 1,000-case). `packaging.test.ts` AC7 (3): `deep run --result` exits 3 printing INVALID and `flaky_maybe`, 0/1/3 on passed/failed/ran_nothing, usage errors exit 2 |
| AC8 | the suite ships as its own package other tools can run | `packaging.test.ts` AC8 (5): the workspace package and bin, `--help` and an unknown command, the clean fill through the bin (exit 0, PASS lines), the duplicate-ID fake (exit 1, FAIL line), a missing module (exit 2) |
| AC9 | facts leaving out the Stop hook's timeout fail naming the field and the rule; a field naming no rule fails the schema; a free-form facts schema passes the first fake and fails this test | `facts.test.ts` AC9 (6): the clean facts carry it, the timeout removed, the section removed, fields naming no rule (readBy empty or missing, unlisted fields), a 1,000-case property over unlisted names, the free-form twin caught |
| AC10 | every declared item has a fake mishandling only it, and the case fails it with its own message; a shallow `answerPermission` case kills none and reads INVALID | `fakes.test.ts` AC10 (4): items declared and one item per fake, one fake per item with distinct messages, each case fails and kills its items' fakes, the shallow case INVALID with the fake surviving |
| AC11 | a kit's requirement set is frozen per revision; a runner that runs every case on every fill fails the installed fill on the new case and fails this test naming case and revisions | `revisions.test.ts` AC11 (5): revisions declared, the new case runs only for the new revision, the earlier fill passes while the every-case stand-in is caught naming case and both revisions, a newer fill, a 1,000-case property over revisions |
| AC12 | the rules are one numbered list in `adapter.facts@1`, each with one fake failing with its message; with the clock-stepped-back fake removed the preflight fails naming the rule | `fakes.test.ts` AC12 (4): the ten rules in order, one fake per rule with distinct messages, the five placed under their rules, `kitProblems` names the rule |
| AC13 | every closed enum says exhaustive or extensible, extensible carries `unknown`; a stop cause added passes as a minor, a verdict outcome added fails unless a new major, naming the enum; an earlier reader reads the new cause as `unknown`; a closure without the mark fails naming the enum | `closures.test.ts` AC13 (7): marks and `unknown`, the unmarked closure, extensible without `unknown`, stop cause as a minor, verdict outcome as a break and under a new major, `serveAt` to `unknown`, a 1,000-case property over added members |
| AC14 | every planted entry, fake and twin names its exact codes, empty for a twin; one more or none fails naming it; a subset runner passes the first and fails this test | `fakes.test.ts` AC14 (6): every fake proven exact, every entry and twin named, the composed fake (one more) names the extra, the clean fill under a fake's name names the missing, a 1,000-case property over named sets, the subset stand-in caught |
| AC15 | a generator draws valid instances every consumer accepts and four mutations each refused with its own code and path, 1,000 cases from a recorded seed; a lenient consumer fails naming schema and seed | `generator.test.ts` AC15 (6): the seed, 1,000 draws per schema through the TypeScript validator, mutation kinds, codes and paths with every afforded kind drawn, the four mutations are what they say, the Rust consumer, the lenient stand-in caught naming schema and seed |
| AC16 | each code is raised alone by one planted entry; `deep://codes/<code>` is generated from the family's schema and that entry with its twin and fix; a planted code no entry raises fails the preflight naming it; replaying a page's entry raises exactly that code | `codes.test.ts` AC16 (6): one entry per code, entry and twin replayed, every page, a page's entry replayed, `kitProblems` names the code (and an entry or twin naming wrong codes), a 1,000-case property over every code |
| wiring | the local preflight runs the conformance lint | `packaging.test.ts` (2): the lint lane's commands include `scripts/conformance-lint.mjs`; it passes on the checkout printing PASS lines |

98 tests in 8 files; every one fails at the base (BASE-FAILURE.txt).

## Wrong programs

Each criterion that names one is held by a stand-in in `helpers.ts`, run inside the suite against the real kit:

- `shapeOnlyRunKit` (AC3) validates one hook reply and six driven replies against the published shapes and runs
  no case: it passes all five fakes, and the test names each.
- `countingRunKit` (AC6) maps INVALID and BLOCKED to PASS over the real runner's report.
- `everyCaseRunKit` (AC11) runs the real runner with the fill's revision raised past every case.
- `subsetProveFake` (AC14) reads a fake as killed when nothing it names is missing, however much more is raised.
- `lenientValidate` (AC15) drops `enum` refusals from the real validator.
- A twin of `adapter.facts@1` with `hookTimeouts` opened to any field and requiring none (AC9), through
  `registry()` of the contracts.

None of these can run at the base, since they wrap the surface; each is proven in the implemented repo by a
test headed `(wrong program)`. The base itself is the wrong program for the whole suite (BASE-FAILURE.txt).

## Fixtures

- `fixtures/planted/closures.json`: the three closure forms, an extensible one, and one with no mark.
- `fixtures/planted/enum-without-closure.json`: a planted enum (`hook.ack@1` `/properties/mood`) and where it goes.
- `fixtures/run-results/*.json`: `run.finished@1` events on made-up ULIDs: `flaky_maybe` (an outcome no enum
  lists), `passed`, `failed`, `ran_nothing`.
- `fixtures/fills/clean.mjs`, `duplicate-id.mjs`: fill modules for the bin, exporting the kit's clean fill and
  its duplicate-ID fake from the built package (`packages/conformance/dist/index.js`).

No fixture holds a secret or personal data; the IDs are made up and no path is a home path.

## Files

- `helpers.ts`: fixture loading, JSON Pointer edits, refusal assertions, the kit and fill accessors, the enum
  walk, child processes, the wrong-program stand-ins.
- `runner.test.ts`, `fakes.test.ts`, `closures.test.ts`, `codes.test.ts`, `generator.test.ts`,
  `revisions.test.ts`, `facts.test.ts`, `packaging.test.ts`: the criteria above.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, where every suite fails because the conformance package
  doesn't exist, with the Node version in its header and the stub run beside it.
