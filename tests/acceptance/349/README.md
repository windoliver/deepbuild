# Acceptance tests for #349: extension slots, flags and one owner per session

Written first, blind, by a job that never saw an implementation of #349. On October 24, 2026 it read:

- issue #349: its Scope, its Fields, its 8 checkbox criteria, its Proof and what it depends on
- #348 (the host these slots sit in), #44 and #350, for scope boundaries only
- `docs/technical-design.md`: Extension API (TypeScript, in-process), with "Adapters declare what they can do" and
  "The contract still defines four kinds of thing"; Building blocks; Composition and its Hub slots table; Socket
  roles and contract versions (frozen `d1:` digests, `name@major`, `since`, stability); the Dogfooding rule
- `AGENTS.md`
- the acceptance tests of #348, #30 and #331, for their conventions
- the packages the surface builds on, through their public entries: `extension-host` (#348's host, `EXTENSION_API`,
  the `plant` convention), `conformance` (`slot-types`, `slots/kits`, `slots/check-kind` with its `fail-elsewhere`
  fixture and `crashed-suite` planted fill, `slot-runner`'s `runSlotKit` and `slotKitProblems`, the adapter@1
  kit), `adapters` (`AdapterCaps`, `Adapter`, `registry`), `asks` (the kinds, `Delivery`, the `deliver` callback,
  `decision.applied`), `record` (`decision.created@1`, the `decisions` projection), `contracts` (the schemas,
  `digests.json`, `d1Digest`, `frozenDigests`, `checkManifest`), `hub` (`core.ts`, `server.ts`), and
  `scripts/lanes.mjs` and `scripts/conformance-lint.mjs` for how the local preflight prints `PASS`/`FAIL <check>: ...`
- the base commit `0c2fed1` (origin/main)

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

On macOS, with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the test packages in the hub import packages/conformance/dist
node node_modules/vitest/vitest.mjs run --root tests/acceptance/349 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/349/tsconfig.json   # needs the surface below
```

- **`--no-file-parallelism`:** the files open hosts whose packages run check suites and the supervisor.
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment
  and points `HOME` at a temp folder, so nothing touches the real `~/.deepbuild`.
- **Temp folders:** every package, world, record, checkout, repo and home is under `/tmp/dh349-*`, a real path,
  removed after its file. Every host a test opens is closed after its file, which stops what it started; nothing
  is stopped by name or port. No network. Nothing is skipped: at this base every test fails.

## The surface under test

The issue names no module. This job defines the smallest surface, extending the entries that already exist and
using names the issue and the design already use: the hub-slot table, the published extension API contract, a
slot's kit and its planted wrong fill, the local preflight, `deep.registerResolver`, `deep.registerAdapter`,
`adapter.caps`, a decision of the ask's kind and scope, the adapter that gates a session. The tests reach it only
through these entries.

### `packages/contracts/src/index.ts`: the published contract

Two data files published beside the schemas, each read by one function, so the preflight can be run on a copy:

```ts
/** packages/contracts/extension-api.json: the published extension API contract, one entry per `deep.*` method. */
export interface ApiEntry {
  method: string;                      // `deep.registerSource`
  variants: string[] | null;           // the variants the method's shape names, one slot each: registerSource names 'stream', 'polled', 'mcp'
  since: string;                       // the release it arrived in, 'R1'…
  stability: 'stable' | 'preview';
  digest: string;                      // the method's frozen `d1:` digest
}
export function extensionApi(): ApiEntry[];

/** packages/contracts/hub-slots.json: the hub-slot table, one row per `deep.register*` method and per variant. */
export interface HubSlot {
  method: string;                      // the `deep.register*` method
  variant: string | null;              // one of the method's variants, or null when its shape names none
  interface: string;                   // `name@major`, a contract entry with a frozen digest (`check.kind@1`, `resolver@1`, `adapter@1`, …)
  digest: string;                      // that entry's frozen `d1:` digest: frozenDigests()[interface]
  fills: string;                       // how many may fill it: 'one' | 'many' | 'one per kind' | …, the design table's words
  kit: string | null;                  // the kit in the conformance package: a slot kit's `slot` or the adapter kit's `name`
  planted: string[];                   // the planted wrong fills that kit must fail, by name
  since: string;
}
export function hubSlots(): HubSlot[];
```

The API entries must list every `deep.register*` method `EXTENSION_API` has, and `deep.registerSource`'s variants
must include `stream`, `polled` and `mcp`.

### `packages/conformance/src/index.ts`: the slot check

```ts
export interface SlotProblem { method: string; variant: string | null; slot: string; fill: string | null; reason: string }
/**
 * The preflight's slot check. The slot list comes from `api`: one slot per `deep.register*` entry and per variant
 * its shape names, never from the table. Each slot needs exactly one row in `table`; the row needs an interface
 * `name@major` whose frozen digest is the row's, a kit among `kits` that lists each planted fill the row names (at
 * least one), and that kit must pass `slotKitProblems` / `kitProblems` (so a kit that admits its planted fill is a
 * problem naming that fill in `fill`). Every problem names the method and the variant.
 */
export function slotProblems(api: readonly ApiEntry[], table: readonly HubSlot[], kits: readonly (SlotKit | Kit)[]): SlotProblem[];
```

Plus the kits the table's R1 rows need and the conformance package doesn't ship yet (`resolver@1` at least: its
one planted fill is the design table's "a resolver that answers an authority ask without naming an active decision
of its kind and scope"); which others depends on the rows the implementer declares for the methods
`EXTENSION_API` has (`registerView`, `registerAdapter`, `registerRoute`…). The tests don't call those kits
directly; the slot check does.

### `scripts/slots-check.mjs`: the preflight's check

Runs `slotProblems(extensionApi(), hubSlots(), [...slotKits(), ...kits()])` over the built packages and prints, as
conformance-lint does, one `PASS slots: …` line or one `FAIL slots: <method>[, <variant>]: <reason>` line per
problem; exits 0 on PASS, 1 on any FAIL. `--api <file>` and `--table <file>` read the contract from other files,
which is how the tests put a planted declaration in front of the real check without editing the repo. The lint
lane of `scripts/lanes.mjs` runs it (the test checks the lane's text names the script).

### `packages/asks/src/index.ts`: resolvers, decisions and the core's gate

```ts
/** A resolver's answer: the option it chooses and what covers the ask, a decision handle (`decision:<ULID>`), or null for nothing. */
export interface ResolverAnswer { answer: string; because: string | null }
export type Resolver = (ask: Card & { session: string }) => ResolverAnswer | undefined | Promise<ResolverAnswer | undefined>;
/** One refusal the core made of a resolver's answer. */
export interface Refusal { ask: string; resolver: string; decision: string | null; reason: string }
/** The planted wrong core the criteria name; tests only. */
export type AsksPlant = 'decision-exists-only';

export interface AsksOptions { /* as today, plus */ plant?: AsksPlant }
export interface Asks {
  /* as today, plus */
  /** The core consults each resolver on every ask raised, before the ask reaches you; returns how to drop it. */
  registerResolver(name: string, resolver: Resolver): () => void;
  /** Your answer to a closed ask, saved as a decision at a scope, on the trusted path (writer `app`): its handle. */
  saveDecision(connection: Connection, ask: string, scope: 'session' | 'repo' | 'all'): Promise<string>;
  /** Revokes a decision on the trusted path: a `decision.revoked` event naming it; it covers nothing from then on. */
  revokeDecision(connection: Connection, decision: string): Promise<void>;
  /** The refusals the core made of resolvers' answers for an ask, in order. */
  refusals(ask: string): Promise<Refusal[]>;
}
```

The gate, in the core (never in a resolver): a resolver's answer to an authority ask is applied only when its
`because` names a decision that is active (saved, not revoked), of the ask's kind and scope: saved from an ask
with the same `key` (the question class, which carries the kind), at a scope that covers this ask's session:
`session:<this session>`, `repo:<this session's repo>` or `all`. Applied means one `decision.applied` event, writer
`core`, data `{ decision, ask }`, the ask's inbox row `outcome: 'decided_for_you'`, and the answer handed to the
agent through `deliver` with the decision's option. Anything else is refused: no `decision.applied`, one
`Refusal` naming the resolver and the decision it named, the ask open in the inbox (`outcome: 'unanswered'`),
nothing delivered. `decision.revoked@1` is a new core-only event kind, data `{ decision: 'decision:<ULID>' }`, and the
`decisions` projection's `state` reads `revoked` after it. The planted core `'decision-exists-only'` applies any
answer naming a decision that exists.

### `packages/extension-host/src/index.ts`: slots in the host

```ts
import type { HookRequestLine, AdapterCaps } from '@deepbuild/adapters';
import type { Asks, Delivery } from '@deepbuild/asks';

export type Plant = /* #348's three, plus */ 'both-adapters-deliver' | 'first-to-bind-owns';
export interface ExtensionHostOptions { /* as today, plus */ asks?: Asks }   // needed for resolvers and adapters

/** A kit the install ran on what the package registers: the slot, the fill (a check kind's name), its verdict. */
export interface KitRun { slot: string; fill: string; verdict: 'PASS' | 'FAIL' | 'BLOCKED' | 'INVALID' | 'INCONCLUSIVE' }
export interface Installed { /* as today, plus */ kits: KitRun[] }

export type Route = 'steer' | 'hold' | 'wake' | 'prompt';
export type Delivered =
  | { status: 'delivered'; session: string; adapter: string; route: Route }
  | { status: 'held'; session: string; adapter: string };     // waiting for the route the flags allow

export interface ExtensionHost {
  /* as today, plus */
  /** A hook line, mapped through the adapter `line.agent` names; binds and gates the session it carries. */
  hook(line: HookRequestLine): Promise<{ adapter: string; events: { kind: string }[] }>;
  /** The adapters loaded extensions registered. */
  adapters(): Promise<{ name: string; extension: string; caps: AdapterCaps }[]>;
  /** The adapter that owns the session: the one that gates it; null before any adapter bound it. */
  owner(session: string): Promise<{ adapter: string } | null>;
  /** An answer for a session: the owning adapter delivers it by a route its flags allow now, or it waits. */
  deliverAnswer(answer: Delivery): Promise<Delivered>;
}
```

The `deep` object gains two wired methods (both already in `EXTENSION_API`):

- `deep.registerResolver(resolver)`: forwarded to `asks.registerResolver(<extension id>, resolver)`; the refusal's
  `resolver` names the extension (`deepbuild/test-resolver` in these tests).
- `deep.registerAdapter(name, adapter)`: `adapter` is `@deepbuild/adapters`' `Adapter` (`facts`, `caps`,
  `unsupported`, `doctor`, `mapHook`) plus `deliver(answer: Delivery, session: string, route: Route)`. It is held
  to the adapter contract at registration (`adapter.caps@1`, every flag). In the hub its functions stay in the
  package; how a sandboxed package's are reached is the host's (these tests' adapters run in the hub).

And the install runs each slot's kit on what the package registers (AC4): a `deep.registerCheck(kind, runner)`
is a `check.kind@1` fill, run through `runSlotKit(checkKindKit(), …)`'s fixed part at least; a FAIL refuses the
install, the error naming the first failing case (`fail-elsewhere` for the planted runner), and leaves what was
installed and running as it was. `Installed.kits` carries each kit's verdict.

### A package

As #348: `deepbuild.json` (extension.manifest@1) and an `index.ts` whose default export takes `deep`. A check kind
with a bare name (`journey`) passes the manifest only when the package declares `replaces: ["journey"]`, the
manifest contract's rule for a shipped piece's name; the test journeys do.

## Readings

Where the issue is silent, this job read:

- **Results (AC1).** "Its results" are what a passed run rests on: the tests it counted. A result that says passed
  with `testsRun: 0` is a passed run without its results; the core returns a result whose outcome is not `passed`,
  with one failure whose message names the check kind. A complete passed run (tests counted, files read) goes
  through unchanged. A result missing check.kind@1's fields is already no result at this base (#348), so it isn't
  tested here.
- **Routes (AC2).** Delivery chooses a route from the adapter's declared flags, as `adapter.caps` gives them, never
  from its name: `steer` lets an answer into a running turn (`route: 'steer'`); without it the answer waits, and
  goes through the stop hold when `holdStop` is set (`'hold'`, delivered as the session's `agent.stop` arrives),
  else at the session's next prompt (`'prompt'`, as its next `user.ask` arrives); `wakeIdle` gives `'wake'`, which
  no test needs. The turn state comes from the events the session's hooks map: a `user.ask` or `tool.before` opens
  a turn, an `agent.stop` ends it. The design's rule that a flag counts only once the hook was seen firing is met
  either way: every test feeds the session's own `Stop` or `UserPromptSubmit` through the adapter before expecting
  that route. The first adapter is registered as `claude-code`, an agent whose shipped adapter can steer, so a host
  that routed by name would steer it and fail.
- **Hook lines.** `host.hook` takes a hook.request@2 line as deep-hook sends it; the session is `payload.session_id`,
  as the hub reads it. The test adapters' `mapHook` maps `payload.hook_event_name` to one event with the published
  fixture's data (`session.start@2`, `user.ask@1`, `tool.before@2`, `tool.after@1`, `agent.stop@2`,
  `session.end@1`). Whether the host appends them to the record, with `agent` the adapter's name, is the issue's
  Scope and not tested; nothing here reads them back.
- **Binding, gating and owning (AC6).** An adapter binds a session ID the first time a hook line it maps names
  that session. An adapter gates a session when it maps one of the session's gates, a hook deep-hook holds for the
  hub's reply: `tool.before` (PreToolUse) or `agent.stop` (Stop). The adapter that gates the session owns it,
  whichever bound first: it delivers every answer, once, and the session's asks are its; an adapter that only maps
  observations (`session.start`, `tool.after`, `session.end`) relays and never delivers. "Files the session's asks"
  is read as: the session's answered asks are delivered by the owner, which the delivery test shows.
- **What covers an ask (AC3, AC7).** A decision is `decision.created@1`: `key`, `scope`, `answer`, `ask`. Its kind
  is its ask's; two asks are of one kind and question class when their `key` is one. Its scope covers an ask when it
  is `all`, `session:<the ask's session>` or `repo:<the repo of the ask's session>`, the repo being the worktree
  the session's `session.start` names (`repo:` ids are the core's to derive, so the tests never read them: they
  start sessions in one worktree or another and watch what applies). Active means saved and not revoked. A decision
  is saved only from your answer on the trusted path (`saveDecision` with writer `app`), as project trust is.
- **"The ask reaches you".** The ask stays open: its inbox row's outcome is `unanswered` and its status `queued`,
  `shown` or `held`; nothing was delivered for it. With no batches declared in the test home's config, an open ask
  shows at once, but the tests don't depend on `needsYou()`.
- **"Logged as decided for you".** One `decision.applied` event, writer `core`, naming the decision and the ask,
  and the ask's inbox row `outcome: 'decided_for_you'` (the record's projection already does this).
- **The kit at install (AC4).** A first-party package's install-time kit runs in the hub, where the package will
  run: check.kind@1's fixtures spawn `node --test` in a checkout the sandbox can't reach, and the test journeys'
  runner is the conformance package's reference fill, imported from `packages/conformance/dist` lazily (inside the
  runner, so registering needs no import and conformance's sandbox run still passes). A second implementation of
  `journey` is another package declaring `replaces: ["journey"]`; whether it loads in place of the first is #351's
  (what a package replaces), so AC4's second test asserts its install, with the kit passed, not its load. "Keeps
  running" is `host.runCheck('journey', …)` on the kit's known-pass suite still answering `passed` with 2 tests
  through the first package after the planted one was refused.
- **The planted runner (AC4).** The issue's words are the kit's `crashed-suite` fill: a suite that crashed before
  its first assertion (`fail-elsewhere`), reported passed with 12 tests. The test journey bends the reference fill
  the same way, so the kit's first refusal is on `fail-elsewhere`, which the install's error must name.
- **The slot list (AC5, AC8).** The published contract is data (`extension-api.json`), the table is data
  (`hub-slots.json`), and the check derives the slot list from the former; the tests copy both files, plant a
  declaration (`deep.registerFoo`; a `deep.registerSource` table without its `mcp` row) and run the real script on
  the copies. "Named" means the `FAIL slots:` line carries the method (and the variant) and, for a kit or a planted
  fill missing, the word `kit` or `planted`. A kit that admits its planted fill is a kit the test derives by
  spreading the shipped check.kind@1 kit (its reference fill in place of `crashed-suite`), put in front of the
  check's function form, since kits are code; the problem it raises carries `fill: 'crashed-suite'`.
- **The preflight's digests.** Each row's `digest` must be `frozenDigests()[row.interface]`: hub slots are
  contract entries with frozen digests (design: Socket roles). So the interfaces the table names (`check.kind@1`,
  `resolver@1`, `adapter@1`, `source@1`, `reading.source@1`, `environment@1`, `panel@1`…) need published schemas or
  digest entries; the check names a row whose interface has none.
- **Scope the tests leave alone.** `registerView`'s panel runtime (tested in #35), the `agent` field on every
  event, revoking through a card, driven sessions, `wakeIdle`, and the seeded part of kits at install are in the
  issue's Scope or Fields with no checkbox criterion; nothing here tests them, and a PR should say how it proves
  what it claims of them.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID,
`#349.<first 8 hex of the SHA-256 of its text>`, computed on the text trimmed, whitespace collapsed and `- [ ] `
dropped (as `scripts/proof-change.mjs` does). A test headed `(wrong program)` runs the same scenario against the
planted twin the criterion names and expects that twin to fail the criterion's assertion, naming what the
criterion says it names. The twin's scenario must itself run.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#349.68572cba` | no passed run without its results | `results.test.ts` (1): passed with no test counted is no pass, names the kind; the complete run goes through | fails (returns passed) |
| AC2 `#349.009ae072` | steer false: stop hold or next prompt, never mid-turn | `delivery.test.ts` (3): holdStop true → `hold`; holdStop false → `prompt`; steer true → `steer` mid-turn | fails (registerAdapter not wired) |
| AC3 `#349.27abd805` | a resolver naming no active decision of the kind and scope is refused, the ask reaches you; naming one, applied and logged | `resolver.test.ts` (3): names nothing; names another kind's decision; names one of the kind and scope | fails (no saveDecision/refusals) |
| AC4 `#349.e98531fc` | a second journey installs only after check.kind@1's fixtures pass; the planted runner refused naming fail-elsewhere; the kind in use keeps running | `install-kit.test.ts` (2): first installs with the kit passed and runs, planted refused, first keeps running; a sound second installs | fails (no kit at install) |
| AC5 `#349.2eb6c029` | deep.registerFoo without a kit or a planted fill fails the preflight naming the slot; a kit admitting its planted fill fails it naming the fill | `slot-table.test.ts` (4): the real contract passes and the lane runs the script; no kit; no planted fill; wrong program: admitting kit | fails (no contract files, no script) |
| AC6 `#349.77853dd0` | second to bind gates and owns; both-deliver and first-binder-owns hosts fail naming the session | `owner.test.ts` (3): the owner rule; wrong program `both-adapters-deliver`; wrong program `first-to-bind-owns` | fails (registerAdapter not wired) |
| AC7 `#349.70f6262e` | a revoked decision, or another repo's, is refused and the ask reaches you; an exists-only core applies both and fails naming the decision | `decisions.test.ts` (3): revoked; other repo (and its own repo applies); wrong program `decision-exists-only` | fails (no saveDecision) |
| AC8 `#349.b8d8858e` | slots from the published contract, per method and variant; a missing MCP row fails naming method and variant; a table-only check fails this test | `slot-list.test.ts` (3): the contract and the table; the MCP row removed; wrong program `slotsFromTable` | fails (no extensionApi) |

## Wrong programs

| Twin | Criterion | Where | What it does | How the test fails on it |
|---|---|---|---|---|
| `admittingKit` | AC5 | `wrong.ts` | the shipped check.kind@1 kit with its reference fill in place of the planted `crashed-suite` | `slotProblems` names `crashed-suite` as a fill the kit admits |
| host `plant: 'both-adapters-deliver'` | AC6 | the host | lets every adapter that saw the session deliver | the relaying adapter delivers too; the assertion names the session |
| host `plant: 'first-to-bind-owns'` | AC6 | the host | gives the session to the first adapter to bind it | the answer goes through `relay`, which doesn't gate; the assertion names the session |
| asks `plant: 'decision-exists-only'` | AC7 | the asks core | applies any answer naming a decision that exists | the revoked decision and the other repo's are applied; the assertion names each decision |
| `slotsFromTable` | AC8 | `wrong.ts` | holds each table row to the row rules, never reading the API | the table without its `mcp` row raises nothing; the assertion names `deep.registerSource` |

The criteria that name no twin (AC1, AC2, AC3, AC4) fail on the base, which has none of the surface. Past that,
the mutation lane is their wrong program.

## What depends on other issues

- **#351, extension packages.** Whether a second `journey` loads in place of the first (`replaces`) is #351's;
  AC4 asserts the install and the kit, and that the first keeps running.
- **#350, extension calls at run time.** Refusals on record are #350's; the resolver refusals here are read back
  through `Asks.refusals`, not from `capability.refused` events.
- **#35, the panel runtime.** `registerView`'s rules are tested there, as the issue says.

No half of a criterion here waits on an unbuilt issue, so a PR for #349 that passes every test here may say
`Closes #349`, after a review of the Scope items noted under "Scope the tests leave alone".

## Files

- `helpers.ts`: the environment cleanup, temp folders, the world (record, asks with its deliveries kept, supervisor,
  trust), hosts, the fixture copier (`*.fixture` renamed, manifest fields written, the digest stamped), check runs on
  the kit's known-pass suite, hook lines, asks and approvals, sessions in a worktree, and the seen files.
- `adapting.ts`: the test adapter packages and an answer for a session (AC2, AC6).
- `resolving.ts`: the resolver scenarios and the two shared assertions (AC3, AC7).
- `slotting.ts`: the contract files, their temp copies and the preflight script run on them (AC5, AC8).
- `wrong.ts`: the admitting kit and the table-only check.
- The test files: `results.test.ts` (AC1), `delivery.test.ts` (AC2), `resolver.test.ts` (AC3), `install-kit.test.ts`
  (AC4), `slot-table.test.ts` (AC5), `owner.test.ts` (AC6), `decisions.test.ts` (AC7), `slot-list.test.ts` (AC8).
- `fixtures/`: the first-party test packages, each loaded in the hub: `runner` (a check runner answering with a
  file's contents), `adapter` (an adapter shaped by `adapter.json`, writing what it delivers), `resolver` (a resolver
  playing what a file says), `journey` (the reference check.kind@1 fill, planted or not). Their `index.ts` files
  carry a `.fixture` suffix, so this suite and `tsc` skip them.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
