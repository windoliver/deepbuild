# Acceptance tests for #314: the package manifest and the slot kits

Written first, from issue #314 (its text as of October 21), the design sections it links and those around them
(the Extension API block, with `deep.registerCheck`, `deep.registerIndex`, `deep.registerEnvironment` and
`deep.registerSource`'s three shapes, and A first plug-in and Add anything after it; Composition, with Declared
edges and the Hub slots table; Socket roles and contract versions, with Contracts that can't drift and What a
minor may change, which gives the `ext.<plugin>.<name>` rule and the minor each use names; Access, under The
primitives, defined; the Check primitive; How runs become one of five verdicts, for what a check run reports;
How we know version 0 works, with Conformance tests, Kit hygiene, Generated edges and exact issues, Criteria in a
checked shape, Wrong programs and Dogfooding; Built to be hard to get wrong, all in `docs/technical-design.md`;
What the kernel holds in `docs/canvas-primitives.md`, for the envelope every package shares), the issue it
depends on (#313, with `tests/acceptance/313/` and `packages/conformance/`) and base commit `b8a7ead`
(origin/main), by a job that never saw an implementation. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them with the repo's Node (`.node-version`, 24.22.0; the repo's `vitest.config.ts` also takes
`tests/**/*.test.ts`, so the unit lane runs them too):

```sh
npm ci                                    # once, if node_modules is missing
npx vitest run --root tests/acceptance/314
```

With `--root` here, Vitest writes its cache to `tests/acceptance/314/node_modules/.vite/`; delete that folder
before committing (it is not in `.gitignore`). The kit tests run the shipped kits on their reference and planted
fills, so `check.kind@1`'s fixture suites and `environment@1`'s processes run here; nothing needs the network.

The tests import `packages/contracts/src/index.ts` and `packages/conformance/src/index.ts` with their `.ts`
extensions; `tsconfig.json` here extends the root one with `noEmit` and `allowImportingTsExtensions`:

```sh
node node_modules/typescript/bin/tsc -p tests/acceptance/314/tsconfig.json
```

They type-check with no errors against a declaration-only copy of the surface below, kept outside the repo and
placed at the two package entries only for that check (BASE-FAILURE.txt, header).

## The surface under test

The issue names a manifest schema, an envelope, a kit per slot, planted fills and a seeded part, but almost no
code API, so these tests define the smallest one they need: new exports of `@deepbuild/conformance`
(`packages/conformance/src/index.ts`, #313's package, whose existing exports stay as they are) and two new
published schemas plus one check in `@deepbuild/contracts`, read only through `getSchema`, `listSchemas`,
`lintSchemas`, `validate`, `fixtures`, `registry` and the new `checkManifest` of its public entry. The tests
import nothing else from any package and read only the files named here. No `deep` command and no lint-lane
script is required by this issue's criteria.

```ts
// @deepbuild/contracts — packages/contracts/src/index.ts, beside its existing exports
/** The manifest contract: extension.manifest@1's schema plus the rules its closed node types can't hold (a media
 *  use without its access word; a name without its ext.<plugin>. prefix unless `replaces` lists it), as one
 *  Validation whose issues are error@1 refusals at the JSON Pointer of the refused value, `actual` the value. */
export function checkManifest(value: unknown): Validation;

// @deepbuild/conformance — packages/conformance/src/index.ts, beside #313's exports
import type { JsonValue } from '@deepbuild/contracts';
import type { Fill, Kit, Problem, Report, Verdict } from './types.js';   // #313's, unchanged

export type RunOutcome = 'passed' | 'failed' | 'ran_nothing' | 'missing' | 'overran' | 'stopped' | 'uncounted';
/** A fill for a hub slot other than adapter@1: plain data whose methods are own closures (so a test may spread it). */
export interface SlotFill { slot: string; revision: number; variant?: string; [member: string]: unknown }
export interface CheckSpec { kind: string; runner: string; inputs: string[]; depth: string; oracle: 'code' | 'model' | 'person'; contract: string | null }  // check@1
export interface CheckContext { checkout: string; deadline: number; now(): number }   // the folder, the ms the run may take, the clock
/** One failed test, from the tool's own report: where it failed and whether as the framework's assertion failure. */
export interface Failure { test: string; file: string; line: number; stack: string | null; assertion: boolean; message: string }
/** What a check runner returns: a closed run outcome, never a verdict; the files the run read, relative to the checkout; the mask it found in the command, or null. */
export interface CheckResult { outcome: RunOutcome; testsRun: number; failures: Failure[]; evidence: string[]; read: string[]; mask: string | null }
export interface CheckRunnerFill extends SlotFill { slot: 'check.kind@1'; kind: string; run(spec: CheckSpec, ctx: CheckContext): CheckResult | Promise<CheckResult> }

export interface SlotRule { id: string; rule: string }
/** A shipped fixture of a kit's fixed part: its input and the answer expected. check.kind@1's input is {spec, checkout, deadline}. */
export interface Fixture { id: string; input: JsonValue; expected: JsonValue }
/** A planted wrong fill: it breaks the one rule `breaks` names, fails with `message`, raises `codes`. */
export interface PlantedFill<F extends SlotFill = SlotFill> { name: string; message: string; codes: string[]; breaks: string; fill: F }
/** A kit: plain data, so a test may derive a variant by spreading it. */
export interface SlotKit<F extends SlotFill = SlotFill> { slot: string; fills: 'one' | 'many'; revision: number; rules: SlotRule[]; fixtures: Fixture[]; planted: PlantedFill<F>[] }
export function slotKits(): SlotKit[];                                     // the shipped slot kits; kits() stays #313's
export function cleanFills<F extends SlotFill>(kit: SlotKit<F>): F[];     // the reference fills, one per variant the slot names
export interface SeededCase { id: string; input: JsonValue }
export function seededCases(kit: SlotKit, seed: number): SeededCase[];     // the seeded part's cases, pure: deterministic from the seed

export interface SlotCaseResult { id: string; part: 'fixed' | 'seeded'; outcome: Verdict; message: string; codes: string[]; input: JsonValue | null }
export interface SlotReport { verdict: Verdict; slot: string; revision: number; seed: number; cases: SlotCaseResult[] }
export interface SlotRunOptions { seed?: number; parts?: ('fixed' | 'seeded')[] }   // no seed: draw one and record it; no parts: both
/** The one runner every kit runs on: #313's adapter form, and the slot form. */
export function runKit(kit: Kit, fill: Fill, options: { headless: boolean }): Report;
export function runKit<F extends SlotFill>(kit: SlotKit<F>, fill: F, options?: SlotRunOptions): Promise<SlotReport>;
/** The preflight's kit checks, for either kit: a rule no planted fill isolates, a planted fill the kit admits. */
export function kitProblems(kit: Kit | SlotKit): Problem[];
/** The core's stale rule over a run's read set: the changed paths the run read; non-empty means the PASS reads stale. */
export function stalePaths(result: CheckResult, changed: readonly string[]): string[];
```

Beside the package:

- **`extension.manifest@1`** (`packages/contracts/schemas/`): one closed object holding the envelope's fields at its
  root (`id`, `version`, `digest`, `publisher_key?`) and the manifest's own. The fields the fixture here uses, and
  so the schema must define: `access: { words: string[] }` (access@1's shape and word pattern), `panels: [{ name,
  area, media?: ('sound' | 'microphone' | 'camera')[] }]`, `provides: [{ interface: 'name@major', kind, minor }]`,
  `uses: [{ interface: 'name@major', minor, digest }]` (`minor` required in both), `replaces: string[]`, and the
  six name lists `events`, `stores`, `checks`, `codes`, `notices`, `actions`, each `string[]`. The issue's other
  fields arrive with the issues that bring them; the tests pin nothing about them. It passes `lintSchemas`.
- **`package.envelope@1`**: `{ id, version, digest, publisher_key? }` alone, `id` an `owner/name`, exactly those
  four properties, the first three required.
- **Fixtures**: `fixtures/extension.manifest@1/*.json` (at least one, each accepted by `validate` and
  `checkManifest`, one of them with `microphone` among its access words and with its word) and
  `fixtures/package.envelope@1/*.json` (at least one), read through `fixtures(name)`.
- **The slot kits**: `slotKits()` ships `check.kind@1` (`fills: one`), `index@1` (`one`), `environment@1` (`one`),
  `source@1` (`many`) and `reading.source@1` (`many`). Each kit's `planted` holds, under these names, the fills the
  criteria name: `crashed-suite`, `past-deadline`, `dropped-output`, `type-error-as-assertion` (check.kind@1,
  raising `crashed_before_first_assertion`, `reported_after_deadline`, `output_dropped`, `type_error_as_assertion`
  of check.code@1); `keeps-dropped-source`, `sourceless-hit` (index@1); `ready-before-health`, `unleased-port`
  (environment@1; the table's others may be there too); `skips-first-after-resume` (source@1); `cache-as-of`
  (a `polled` fill) and `stale-mcp-digest` (an `mcp` fill) (reading.source@1). `check.kind@1`'s `fixtures` carry
  ids containing `known-pass`, `known-fail`, `fail-elsewhere`, `ran-nothing`, `masked-exit` and `past-deadline`,
  each `input` a `{spec, checkout, deadline}` whose `checkout` is an existing folder; the known-pass suite's
  folder holds `data/expected.json`, which its `spec.inputs` leave out and which the suite reads.

### What the tests hold the pieces to

- **The reference fills pass.** For every kit, every fill of `cleanFills(kit)` reads `PASS` on every case, fixed
  and seeded, at any seed; so every failure a test looks for is the fault it planted.
- **Planted fills.** Each planted fill's `breaks` is a rule id of its kit, and each rule has exactly one planted
  fill; names and messages are distinct within a kit; `codes` holds at least one code outside `error@1`'s (the
  rule's finding, with any shape refusal beside it). Running the kit on a planted fill gives a FAIL whose
  `message` contains the fill's `message` and whose `codes` contain the fill's, and no FAIL carries another
  planted fill's message.
- **The runner's report.** `SlotReport.slot` is the kit's, `revision` the kit's, `seed` the one given or drawn;
  every case says which part it belongs to; a seeded case carries its generated `input`.
- **`kitProblems` on a slot kit** is empty for every shipped kit; with a planted fill removed it names that
  fill's rule (`name` or `reason`); with a planted fill's `fill` replaced by the reference fill (the kit admits
  it) it names the fill.
- **check.kind@1 results.** On each of the six fixtures, `outcome` is one of the seven run outcomes, never one of
  the five verdicts, and the result has no `verdict` member; `testsRun` is a count; `mask` is null or a non-empty
  string. Known-pass: `passed`, tests counted, no failures, `mask` null. Known-fail: `failed`, each failure with a
  non-empty `file`, a `line` of 1 or more, a `stack` string or null, a boolean `assertion`, and at least one
  assertion failure. Fail-elsewhere: not `passed`, a failure whose `assertion` is false carrying its stack.
  Ran-nothing: `ran_nothing` with `testsRun` 0. Masked-exit: `mask` a non-empty string, not `passed`.
  Past-deadline: `overran`. The `crashed-suite` runner answers `passed` with `testsRun` 12 on the fail-elsewhere
  suite (the issue's words), which the kit refuses.
- **The read set.** The reference runner's `read` on the known-pass suite contains `data/expected.json`;
  `stalePaths(result, ['data/expected.json'])` is `['data/expected.json']` and `stalePaths(result,
  ['README.md'])` is `[]`; `stalePaths` is the intersection of the changed paths with the read set, in any order.
- **Seeds.** With `seed` given, `report.seed` is it; two runs at one seed give the same seeded cases (ids and
  inputs), another seed gives others, and `seededCases(kit, seed)` lists exactly the seeded part's cases; with no
  seed, six runs draw at least two seeds; no generated input equals a shipped fixture's input.

## Readings where the issue and design leave a choice

- **Seven criteria.** The issue lists seven checkbox criteria; they are numbered AC1 to AC7 here in its order.
- **Two schemas, one check.** The envelope is its own published schema, `package.envelope@1`, and the manifest
  carries the envelope's four fields at its root, since the issue says it "sits in" the envelope; so `/id` is the
  field named in both. The rules the closed node types can't write (Contracts that can't drift allows no `if`
  or `dependentRequired`) live in `checkManifest`, exported by the contracts, which runs the schema first and
  then those rules, so one Validation covers "fails its schema" in every criterion; the pure-schema criteria are
  held through `validate` as well. Its refusals use `error@1`'s closed codes (the tests pin none in particular).
- **"Naming the word", "naming the name".** Read as an issue whose `path` is the JSON Pointer of the offending
  value and whose `actual` is the word or name itself: `/access/words/1` with `network`; `/panels/0/media/0`
  with `microphone`; `/events/0` with `stocks.alert`.
- **Access words** are the thirteen of `access@1`'s pattern plus `device:<class>`; `notices`, `schedules` and
  `secrets` are blocks, so each fails as a word. "Uses sound, the microphone or the camera" is read as a panel's
  manifest naming the medium in `panels[].media`; each medium named needs its own word in `access.words`, and
  the word named is the medium missing (sound granted, microphone used: `microphone`).
- **The `ext.<plugin>.` prefix.** `<plugin>` is the name part of the envelope's `owner/name` id (`acme/stocks` →
  `ext.stocks.`), as `access@1`'s device-class pattern takes one segment; a name under another plug-in's prefix
  (`ext.weather.alert`) fails too. The rule covers the six name lists and `provides[].interface`. "Declares that
  it replaces the shipped piece of that name" is the top-level `replaces` list containing that exact name
  (`needs-you@1` for a view that replaces the shipped one); whether the piece exists is the install's business.
- **"A use names no minor"** is `uses[].minor` required (and an integer), refused at `/uses/<i>/minor`;
  `provides[].minor` is required the same way.
- **One runner, two forms.** `runKit` keeps #313's signature for `adapter@1` and takes a `SlotKit` with a
  `SlotFill` for every other slot, returning a Promise (check runs and environments are processes). Slot kits
  are listed by `slotKits()`, not `kits()`, so #313's lint script and tests, which read `fakes` and `planted`
  codes off every kit of `kits()`, stay as they are. A `SlotFill` is a flat plain object: `slot`, `revision`, an
  optional `variant`, and its interface's methods as own closures, so a test spreads it to plant a fault
  (`{...fill, run}`) and a stand-in can wrap every method.
- **Fills per slot.** `fills` is `one` or `many`; the table's "one per kind" and "one per name" read `one`.
  "Many at once" for `reading.source@1` is held as `fills: 'many'` plus two reference fills, `variant` `polled`
  and `mcp`, both passing; the tests run one fill per `runKit` call.
- **Planted fills by name.** The issue quotes no messages for these fills, so each kit's planted fills are found
  by the names above; "its own message" is distinct within the kit and the FAIL's message contains it. "Naming
  the fill" (AC5) is read the same way. The check runners' `codes` are check.code@1's, which the base already
  lists for exactly these four faults.
- **The check runner's shape.** `run(spec, ctx)` with check@1's spec (its `inputs` are the declared paths) and a
  context of the checkout folder, the ms the run may take and a clock; it returns `CheckResult`. "Names the mask"
  is `mask`, a non-empty string on the masked-exit suite and null elsewhere. "The core, never the runner,
  matches a place" is held as: no `verdict` member, and failures carry places only.
- **The stale PASS.** The hub's claim record doesn't exist at this base, so "the claim's PASS reads stale" is
  held through `stalePaths`, the core's rule over the run's read set: a changed path the run read makes it
  stale. The declared-only runner's result has `read` equal to the declared paths, so `stalePaths` finds
  nothing, and the kit's fixed part fails it naming `data/expected.json`. Read-set paths are relative to the
  checkout with `/` separators.
- **The seeded part.** `runKit` takes the seed the install drew (`options.seed`) and records it as
  `report.seed`, drawing one when none is given; `parts` runs one part alone (the memorizer is recorded from the
  fixed part only, and a replay test runs the seeded part alone). "Naming the seed" is a seeded FAIL whose
  message contains `seed <n>`. `seededCases` is the generator, pure and cheap (it writes nothing), so a
  1,000-case property can hold it; "never shipped" is held as no generated input equal to a fixture's input.
- **The memorizing fill** (AC6) is built from the reference fill by recording the fixed part's calls (method,
  arguments as canonical JSON, occurrence) and answering from the record, an unseen input getting the first
  recorded answer of that method; so the fixed part must be fixed: the same calls, in the same order, with the
  same arguments on every run. It is held to "passes the fixed part" on the four kits that observe the fill's
  answers (check.kind@1, index@1, source@1, reading.source@1) and to "fails the seeded part, naming the seed" on
  all five; environment@1's kit watches ports and processes, which no memorized answer can bind.
- **The shape-only kit** (AC3) is read as a runner that keeps only shape findings: it wraps the real runner and
  passes any FAIL whose codes aren't all `error@1` refusals.
- **Which kits exist now.** The five slots whose fixtures and planted fills the core contracts bring (the table:
  check kinds, indexes, environments, stream sources) plus `reading.source@1`, which AC5 names; the later-release
  slots and those whose kit another issue brings are only the runner's business here, and the tests don't look
  for them.
- **Fixture seeds** are `1` for most kit runs, `7`/`8` for replay, `314` for the fixed-part check and `2718` for
  the memorizer; every every/never rule is a 1,000-case `fast-check` property at seed 314.

## Criteria to tests

Each test's name starts with its criterion ID. Where a criterion names a wrong program, a test headed
`(wrong program)` builds that program as a stand-in (`helpers.ts`, last section) and feeds it to the same
assertion the real one gets, expecting the assertion to fail naming what the criterion says; where the stand-in
is a schema twin, it is built through the contracts' own `registry`. Every negative test names the refused
field's JSON Pointer through `error@1` (`expectRefused`, `expectRefusedWord`).

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 | an undefined field or an access word outside the list fails naming it; clipboard, window, agent pass; an envelope id not owner/name fails naming the field; an open schema passes the first fixture and fails this test | `manifest.test.ts` AC1 (9): unknown fields at three depths, five planted words, the listed words and the three alone, blocks as words, a 1,000-case property over words, a 1,000-case property over field names, six bad ids in both schemas and the envelope's fields, a 1,000-case property over id shapes, the open twin caught; plus the shipped contracts (3) |
| AC2 | a media use without its access word fails naming the word; a schema without the microphone word fails on its fixture | `manifest.test.ts` AC2 (7): each medium (3), the missing word named, a 1,000-case property over used and granted media, the schema and fixture name microphone, the microphone-less twin caught |
| AC3 | each slot's kit fails each planted fill with its own message; a shape-only kit passes them and fails this test naming each | `kits.test.ts` (28): the five kits and `fills` (1), reference fills pass (5), planted lists and rules (5), each planted fill fails with its message and codes (5), none passed naming each (1), the shape-only stand-in caught (1), one planted fill per rule and no kit problems (5), a missing and an admitted planted fill named (5). `check-kind.test.ts` AC3 (7): the six suites, closed outcomes never a verdict, known-pass and known-fail places, fail-elsewhere and ran-nothing, the mask and the deadline, the four runners' codes, the crashed-suite runner's 12 tests |
| AC4 | the suite reads `data/expected.json` outside the declared paths; a declared-only runner fails the kit naming the file; a change to that file makes the PASS stale | `check-kind.test.ts` AC4 (5): the file and the spec, the read set and `stalePaths`, the declared-only runner fails naming the file, a 1,000-case property over read and changed sets, the declared-only stand-in caught |
| AC5 | polled and MCP sources fill `reading.source@1`, many at once; the kit refuses the cached as-of and the stale-digest fills, naming each | `reading-source.test.ts` (4): many fills and both variants pass, the cached fill, the stale-digest fill, the two refusals are each the fill's own |
| AC6 | a seeded part from a recorded seed; a fill memorizing the shipped fixtures passes the fixed part and fails the seeded part naming the seed; the same seed replays | `seeded.test.ts` (26): parts and the recorded seed (5), replay and the generator (5), never a shipped fixture (5), a drawn seed, a 1,000-case property over seeds, the memorizer (4 + environment's 1), the memorizer caught (4) |
| AC7 | a name without `ext.<plugin>.` fails naming it unless `replaces` lists it; `ext.stocks.alert` passes, `stocks.alert` fails; a use with no minor fails naming the use | `manifest.test.ts` AC7 (12): the six lists (6), a provided interface, another plug-in's prefix, `replaces`, a 1,000-case property over bare names, the use's minor, a 1,000-case property over uses |

101 tests in 5 files; every one fails at the base (BASE-FAILURE.txt).

## Wrong programs

Each criterion that names one is held by a stand-in in `helpers.ts`, run inside the suite against the real
contracts and kits:

- `openSchemaValidate` (AC1): `extension.manifest@1` with its root opened to any field, through `registry()`.
- `withoutMicrophoneValidate` (AC2): the same schema with `microphone` removed from every enum and pattern
  alternative, through `registry()`.
- `shapeOnlyRunKit` (AC3): the real runner's report with every FAIL passed unless all its codes are `error@1`
  refusals; it passes every planted fill, and the test names each.
- `declaredOnlyRunner` (AC4): the reference check runner with `read` replaced by the spec's declared paths.
- `memorizingFill` (AC6): a fill answering from a record of the fixed part's calls on the reference fill.

None of these can run at the base, since they wrap the surface; each is proven in the implemented repo by a
test headed `(wrong program)`. The base itself is the wrong program for the whole suite (BASE-FAILURE.txt).

## Fixtures

- `fixtures/manifests/stocks.json`: the manifest the tests edit: `acme/stocks` at `1.2.0` with a `d1:` digest,
  access words `files`, `hosts`, `clipboard`, `window`, `agent`, `microphone`, one sidebar panel using the
  microphone, one provided reading, one use at minor 0 with its digest, no `replaces`, and one `ext.stocks.`
  name in each of the six lists.
- `fixtures/envelopes/stocks.json`: the same package's envelope alone.

No fixture holds a secret or personal data; the IDs and digests are made up and no path is a home path.

## Files

- `helpers.ts`: fixture loading, JSON Pointer edits, refusal assertions, the manifest and the word lists, the
  kit and fill accessors, the check.kind@1 fixture reader, the wrong-program stand-ins.
- `manifest.test.ts`, `kits.test.ts`, `check-kind.test.ts`, `reading-source.test.ts`, `seeded.test.ts`: the
  criteria above.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, where every test fails because the surface above doesn't
  exist, with the Node version in its header and the stub check beside it.

## Redraft (2026-10-21)

Five `(wrong program)` assertions (one in `check-kind.test.ts` AC4, one `it.each` body over four slots in
`seeded.test.ts` AC6) matched the thrown AssertionError's message against the file name or the seed; chai's
`objDisplay` renders any array inspecting to 40 or more characters as `[ Array(n) ]` (`config.truncateThreshold`),
so the message never carried the elements and no kit could satisfy them. Each now asserts that the same
`toEqual([])` throws and, separately, that the `notPassing` content fed to it names `data/expected.json` or
`seed 2718`. No other test, helper, fixture or name changed; still 101 tests in 5 files.
