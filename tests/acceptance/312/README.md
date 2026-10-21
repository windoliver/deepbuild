# Acceptance tests for #312: the adapter contract

Written first, from issue #312 (its text as of October 20), the design sections it links and those around them
(Every adapter maps its agent's events onto the same few shapes; the Extension API block with
`deep.registerAdapter`, `adapter.facts@1`, `adapter.caps` and `adapter.unsupported`; Adapters declare what they
can do; Composition and the Hub slots table; Socket roles and contract versions, with What a minor may change;
What each agent gives us; Hooks are evidence, not a state machine, with Facts as data; How we know version 0
works, with Conformance tests and Recorded hook payloads, all in `docs/technical-design.md`; the event
catalogue and Closed enums in `docs/canvas-primitives.md`), the issues it links for context (#13, #311, #47,
#48) and base commit `f346706`, by a job that never saw an implementation. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them with the repo's Node (`.node-version`, 24.22.0; a root with no config of its own uses Vitest's
defaults, and the repo's `vitest.config.ts` also takes `tests/**/*.test.ts`, so the unit lane runs them too):

```sh
npm ci                                    # once, if node_modules is missing
npx vitest run --root tests/acceptance/312
```

With `--root` here, Vitest writes its cache to `tests/acceptance/312/.vite/`; delete it before committing (it is not in `.gitignore`).

The tests import `packages/contracts/src/index.ts` and `packages/adapters/src/index.ts` with their `.ts`
extensions; `tsconfig.json` here extends the root one with `noEmit` and `allowImportingTsExtensions`:

```sh
node node_modules/typescript/bin/tsc -p tests/acceptance/312/tsconfig.json
```

They type-check with no errors against a declaration-only copy of the surface below, kept outside the repo.
Nothing here needs the network: the Codex schemas are checked-in copies (Fixtures).

## The surface under test

The issue names shapes, a registry and behaviors but almost no code API, so these tests define the smallest
one they need. It is the public entry of a new workspace package, `@deepbuild/adapters`, at
`packages/adapters/src/index.ts`, plus new published schemas in the existing `@deepbuild/contracts`
(`packages/contracts/schemas/`, reached only through `getSchema`, `validate`, `fixtures`, `catalogue`,
`listSchemas`, `frozenDigests`, `frozenDrift`, `lintSchemas` and `registry` of its public entry). The tests
import nothing else from either package and read only the files named here. The shipped facts files stay at
`adapters/claude-code.facts.json` and `adapters/codex.facts.json` and are read as data.

```ts
import type { JsonValue, Schema } from '@deepbuild/contracts';
export type JsonObject = { [key: string]: JsonValue };

// deep-hook's request line, a hook.request@1 instance as it crosses the wire: seq is its decimal string.
export interface HookRequestLine { v: 1; agent: string; event: string; seq: string; id: string; pid: number; ppid: number; matched: string[]; payload: JsonValue }

// One event an adapter mapped (adapter.event@1): agent is the registry name the request named, or deep;
// rule is the JSON Pointer of the facts entry that decided it (deep explain).
export interface AdapterEvent { agent: string; kind: string; data: JsonObject; rule: string }
export interface Reading { code: string; field: string; version: string }
export interface Mapped { events: AdapterEvent[]; verified: boolean; readings: Reading[] }

// adapter.caps@1: every flag present, each a boolean.
export interface AdapterCaps {
  holdStop: boolean; wakeIdle: boolean; steer: boolean; followUp: boolean; answerPermission: boolean; nativeTools: boolean;
  mcp: boolean; rewrite: boolean; editInput: boolean; errorTurnHook: boolean; startTurn: boolean;
}
// adapter.unsupported@1: per surface (terminal, app-server, desktop, …), the driven operations it can't do,
// each one of startTurn · steer · followUp · interrupt · respond · history.
export type Unsupported = { [surface: string]: string[] };

export interface DoctorItem { code: string; level: 'ok' | 'warn' | 'fail' | 'skip'; evidence: string; fix: string }

export type StopCause =
  | 'sign_in_required' | 'token_refresh_failed' | 'plan_window_spent' | 'rate_limited' | 'refusal' | 'max_turns'
  | 'context_overflow' | 'tool_schema_rejected' | 'agent_crashed' | 'timed_out' | 'unknown';
export interface StopReading { cause: StopCause; reset?: number }      // reset: ms since the epoch, with plan_window_spent

// The data of a turn.usage@1 event.
export interface TurnUsage {
  turn: string;                                   // the turn it covers (or the last turn of a session reading)
  model: string;                                  // the model that actually answered, never the one asked for
  covers: 'turn' | 'session';                     // per turn, or cumulative for the session so far
  tokens: { input: number; cached: number; output: number; exact: boolean };
  cost: { basis: 'reported'; usd: number } | { basis: 'estimated'; usd: number; rate_card: string } | { basis: 'unpriced' };
  context?: { used: number; window: number };     // absent when not captured; never zero
}
export interface Skill { name: string; source: string }

export interface Adapter {
  facts: JsonValue;                               // adapter.facts@1 data; validated at registration
  caps: AdapterCaps;                              // adapter.caps@1
  unsupported: Unsupported;                       // adapter.unsupported@1
  mapHook(request: HookRequestLine, version: string, transcript?: readonly JsonValue[]): Mapped;
  doctor(): DoctorItem[];
  readUsage?(transcript: readonly JsonValue[]): TurnUsage[];                                 // optional, each only with its conformance case
  classifyStop?(payload: JsonValue, transcript?: readonly JsonValue[]): StopReading;
  skills?(home: string): Skill[];
}
// The parts of an adapter that aren't data; everything else comes from its facts file.
export interface AdapterParts {
  caps: AdapterCaps; unsupported: Unsupported; doctor(): DoctorItem[];
  readUsage?: Adapter['readUsage']; classifyStop?: Adapter['classifyStop']; skills?: Adapter['skills'];
}
export function factsAdapter(facts: JsonValue, parts: AdapterParts): Adapter;   // an adapter driven by its facts: no rule in it reads the agent's name

export interface AdapterRegistry {
  register(name: string, adapter: Adapter): void;   // throws ContractError naming the field: /name, /facts/…, /caps/…, /unsupported/…, /doctor, /facts/<optional op>[/conformance]
  names(): string[];
  get(name: string): Adapter;                       // throws ContractError at /name for a name nobody registered
  mapHook(request: HookRequestLine, version: string, transcript?: readonly JsonValue[]): Mapped;  // by request.agent; stamps agent; throws at /agent for an unregistered one
}
export function registry(): AdapterRegistry;        // empty
export function shipped(): AdapterRegistry;         // claude and codex, each factsAdapter(adapters/<agent>.facts.json, …), named by the facts' agent field

export interface Drift { field: string; reason: string }   // field: the payload field that drifted (hook_event_name for a hook the facts lack)
export function factsDrift(facts: JsonValue, version: string, hook: string, published: Schema): Drift[];
//   the Codex types for one hook of one version (facts.events.versions[version][hook]) against the published schema:
//   a field the schema requires that the facts don't, a field the facts list that the schema lacks, a field the
//   facts require that the schema leaves optional, a type that differs (a `true` schema takes any type), or a hook the facts don't list
```

`register` holds a name to `^[a-z][a-z0-9-]*$`, refuses `deep` (the hub's own events) and a second adapter
under a name already taken, and validates `facts` against `adapter.facts@1`, `caps` against `adapter.caps@1`
and `unsupported` against `adapter.unsupported@1`, throwing a `ContractError` (error@1's six fields) whose
`path` is the pointer into the adapter (`/facts/versions`, `/caps/startTurn`, `/unsupported/terminal/0`). An
adapter that implements `readUsage`, `classifyStop` or `skills` registers only when `facts.<operation>`
exists and names its `conformance` case (`/facts/readUsage`, `/facts/readUsage/conformance` otherwise).

### The schemas the tests name

| Name | What it holds |
|---|---|
| `adapter.facts@1` | `{schema: "adapter.facts@1", agent, versions: [string, ≥ 1], hookTimeouts, continuation, launch, modelFamily, billing, usage, questionTools, transcripts, appLinks, errorTexts, events, mapping, toolKinds, …}`, closed. Every listed section is a required object with `readBy` (the core rule that reads it) and `conformance` (its conformance case), both non-empty strings; `readUsage`, `classifyStop` and `skills` are optional sections of the same form; `events.versions[<version>][<hook>]` holds each covered version's strict payload fields, as the shipped files do today. The section's own fields are the implementer's. |
| `adapter.caps@1` | the eleven flags above, all required booleans, closed. |
| `adapter.unsupported@1` | a map from a surface name to an array of the six driven operations. |
| `adapter.event@1` | `{agent, kind, data, rule}`: `agent` a string of the registry name form with no `enum`; `kind` an event kind; `data` opaque (`x-opaque`); `rule` a JSON Pointer. |
| `permission.answer@1` | `{decision: allow \| deny \| cancel, for: call \| session, input?}`, closed; `input` is the edited input, opaque. |
| `permission.request` (an event kind, catalogued) | `data.kind` one of `tool \| plan \| question \| mode`, with the call's `tool`, `command` or `paths` beside it; at least one fixture. |
| `turn.usage` (an event kind, catalogued) | `data` as `TurnUsage` above: `cost` a union on `basis` (`reported` needs `usd ≥ 0`; `estimated` needs `usd ≥ 0` and a non-empty `rate_card`; `unpriced` carries neither), `tokens` all required (`input`, `cached`, `output` whole numbers ≥ 0, `exact`), `context` optional with `window ≥ 1`, `model` non-empty, `covers` the two values. Fixtures include one per cost basis. |
| `agent.stop@2` (the catalogued kind at version 2) | `data.cause` required, exactly the eleven slugs above; `data.plan_resets` a whole number ≥ 0 (ms since the epoch), required with `plan_window_spent` and refused beside every other cause; `data` closed, so no field holds the agent's text; a published fixture names `plan_window_spent` with its `plan_resets`. As main ships it since #603 (Redraft of AC2, below). |
| `tool.before`, `session.attention`, `error@1`, `hook.request@1` | as #311 published them; unchanged. |

Every new shape is a new name, so no frozen digest moves: `frozenDrift(listSchemas(), frozenDigests())` must
stay empty with the cursor adapter registered (AC7), and `lintSchemas(listSchemas())` empty. The stop's cause
landed on main before this suite did, as the new major `agent.stop@2` (#603), with `cause` required and
`agent.stop@1` frozen at its base shape and digest (`tests/acceptance/603/`). The stop tests therefore name
that version through `catalogue()` (`kindSchema('agent.stop', 2)`) and hold it as main ships it (Redraft of
AC2, below). Their first draft, written at base `f346706`, named the kind without a version and allowed either
a minor of `agent.stop@1` or a new name; that reading is superseded.

### Files the tests read

- `adapters/claude-code.facts.json`, `adapters/codex.facts.json`: the shipped facts, as data (they must gain the
  sections above and validate against `adapter.facts@1`).
- `adapters/corpus/claude-code/2.1.304/{tools,stop-failure}/events.jsonl` and
  `adapters/corpus/codex/0.160.0/{tools,permission}/events.jsonl`: recorded payloads, replayed through
  `shipped().mapHook`. Only `payload` is read; the stored `expect` isn't (see the disagreements).

## Readings where the issue and design leave a choice

- **Where `agent` lives.** The issue puts `agent` "on an event"; the published event kinds (#311) have no such
  field and are closed objects, and the design's Event is `{id, kind, subject, writer, actor, scope, data, ts}`.
  The tests read `agent` as the adapter's stamp on what it maps, `adapter.event@1 = {agent, kind, data, rule}`,
  the shape of `adapters/index.d.mts`'s `MappedEvent` plus `agent`; the hub's fields come later. The registry
  stamps it from the request's `agent`, which must be a registered name; `deep` is reserved for the hub.
- **Registry names** are the facts' `agent` field: `claude` and `codex` (the corpus folders say `claude-code`;
  `hook.request@1`'s fixture in #311 says `claude-code` too, which this job flags, below).
- **The adapter version** is an argument of `mapHook`, since `hook.request@1` carries none and the facts' strict
  payload schemas are per version.
- **A permission answer** is its own shape, `permission.answer@1`, with `decision` (the design: allow or deny
  comes "only from the answer's `decision`") and `for: call | session`, named `for` so it can't be mistaken for
  an event's `scope`. `cancel` is the issue's third decision; `none` (the design's "your words alone") is not an
  answer shape, so it is refused here. The answer carries no rule for the agent's own settings (the design:
  standing rules live only in your decisions).
- **Usage** is an event kind, `turn.usage`, so a reading is appended like any event; `TurnUsage` is its `data`.
  `covers: turn | session` is the issue's "per turn or cumulative"; `exact` is the design's "exact or an
  estimate"; "not captured" is the absence of `context` (and a `window` of 0 is refused), never a zero.
  Claude Code's reading follows its facts: one per `message.id`, `input = input_tokens + cache_creation_input_tokens`,
  `cached = cache_read_input_tokens`, `model` from `message.model` (what answered), never `requestedModel`.
  Codex's follows its facts for the session reading (`total_token_usage`, cached taken back out of input,
  `unpriced`) and reads `last_token_usage` per turn with the turn's `turn_context.model`. The two shipped
  adapters must implement `readUsage`, since AC4's "never stored as zero" and AC5 can only be proven through
  it; the contract still leaves it optional for a third adapter.
- **Cost basis names** are `reported`, `estimated` (with `rate_card`) and `unpriced`, the issue's words as slugs;
  a reported cost may be exactly 0 (a free tier reports it), an unpriced one carries no amount at all.
- **Stop causes** are the corpus README's slugs for the issue's eleven causes; the reset rides beside
  `plan_window_spent` as ms since the epoch, at `data.plan_resets` in `agent.stop@2`. The adapters' mapping of Claude Code's `StopFailure.error`
  (`rate_limit`, `overloaded` → `rate_limited`; `authentication_failed`, `oauth_org_not_allowed` →
  `sign_in_required`; else `unknown`) is the corpus README's, written from Claude Code's hooks reference.
- **Facts sections** are named by this job from the issue's list: `hookTimeouts`, `continuation`, `launch`,
  `modelFamily`, `billing`, `usage`, `questionTools`, `transcripts`, `appLinks`, `errorTexts`, plus the three the
  shipped files already use for mapping (`events`, `mapping`, `toolKinds`). "With a conformance case" is read as
  each section naming its case in `conformance`; the kit that runs them is #313's.
- **"None of which ships without its conformance test"** is read mechanically: an optional operation registers
  only when its facts section names a case.
- **`adapter.unsupported`** is tested as data per surface; the typed `unsupported` outcome of a driven operation
  needs driven sessions (R2) and isn't tested here. `deliver`, `install` and `start` are left out of the surface
  for the same reason.
- **AC6, "generated from, or checked against".** The tests take the second: the Codex types are the facts'
  strict payload fields per version, checked against copies of Codex's published input schemas by
  `factsDrift`. A generated TypeScript type would be checked the same way through whatever reads it; this job
  pins no generator. A hook the published set has and the facts don't is drift named at `hook_event_name`.
- **AC7's test adapter** is `factsAdapter(fixtures/cursor/cursor.facts.json, parts)`: a facts file (Cursor's
  `sessionStart`, `preToolUse`, `postToolUse` and `stop`, the hooks the design's table lists for it) plus
  caps, an unsupported list and a doctor that read "not checked". Its payload fields are made up for the test;
  they are not a recording of Cursor.
- **"A schema whose tool kind is a closed list refuses them."** Tool-call kinds are a closed, extensible set with
  `unknown` (the design's Hub slots and What a minor may change), and the cursor adapter needs no new member:
  its unplaced call is `unknown`. The planted twin is a kind list without `unknown`, which has nowhere to put
  that call and fails, naming `/data/kind`.
- **Path resolution.** The design resolves `..` and symlinks in every path; the tests resolve `..` and a
  relative path against the payload's `cwd` (or the `cd` a shell patch opens with), and leave symlinks alone,
  since no fixture can carry one.

### Where the issue and the design disagree (flagged, not picked)

1. **The MCP call's tool name.** `tool.before@1` (and the design's "names its server and tool") say `tool`;
   the corpus README (#47) and its stored `expect` say `name`. The tests check `server` on the mapped event and
   `tool` in the published shape, and don't read the corpus's `expect` for it.
2. **The mapped event's data and the catalogued data.** The corpus stores `tool.before` data as
   `{session, call, tool, kind, paths, command}`; `tool.before@1`'s data is closed to `{kind, paths, command,
   server?, tool?}`. The tests read `kind`, `paths`, `command`, `server` and `tool` on mapped events and validate
   whole events only through the published fixtures' envelopes, never a mapped event against its kind schema.
3. **`agent.stop`'s data.** `agent.stop@1` gives `{turn, did_work}`; the corpus stores `{session, outcome,
   continued, cause}`; the issue needs `cause` (with its reset). The tests hold the catalogued `agent.stop@2` to
   `cause` and `plan_resets` (as main ships it) and the adapters to recording a cause, and nothing else of the
   two data shapes.
4. **The hook request's `agent`.** #311's request fixture says `claude-code`; the facts files say `claude`. The
   registry name here is the facts'.
5. **A permission request's kinds.** The design's four (`tool, plan, question, mode`) have one source today, the
   `PermissionRequest` hook, which the shipped mapping records as `tool` only; the other three come from
   question tools and mode changes the adapters don't map yet. Only the shape is held to the four.
6. **"Optional readUsage()"** against AC4 and AC5, which can only be proven through it: see Readings.

## Criteria to tests

Each test's name starts with its ID. Where a criterion names a wrong program, a comment at the assertion that
catches it says so. Every negative test names the refused field's JSON Pointer through `error@1`
(`expectRefused`, `expectThrown` in `helpers.ts`), and every every/never rule is a 1,000-case `fast-check`
property.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 | Codex's `apply_patch` and Claude Code's Edit both record as an edit with the same paths | `edits.test.ts` AC1: the two calls on one file; a patch through the shell tool, after a `cd`, indented; every marker line, `..` folded; a relative or dotted Edit path; a 1,000-case property over relative paths; the corpus's recorded calls; the edit fits `tool.before` |
| AC2 | a stop whose cause isn't in the closed set fails its schema | `stop.test.ts` AC2, on `agent.stop@2`: the catalogue lists it; each of the eleven passes; strangers, non-strings and a missing cause fail at `/data/cause` (fixed and a 1,000-case property); `plan_resets` with `plan_window_spent` (required, a whole number of ms, text, negative and fraction refused, fixed and a 1,000-case property), refused beside every other cause; the published fixture; no text field beside the cause. `stop.adapters.test.ts` AC2: the adapters' causes from `StopFailure.error` (fixed, recorded, and a 1,000-case property, with the agent's words ignored); every recorded stop names a cause |
| AC3 | an answer names allow, deny or cancel and this call or this session; anything else fails | `permission.test.ts` AC3: six combinations with and without edited input; `/decision` and `/for` refusals (fixed and a 1,000-case property); no rule-writing field; plus `permission.request` kinds and both agents' recorded requests |
| AC4 | a cost without its basis fails; an unpriced cost is never stored as zero | `usage.test.ts` AC4: the three bases; no basis at `/data/cost/basis`; unpriced with 0 or any amount at `/data/cost/usd` (fixed and a 1,000-case property); reported and estimated needs; the Codex adapter's reading is unpriced with no amount |
| AC5 | each turn records the model that actually answered | `usage.test.ts` AC5: `/data/model` required; Claude Code's second turn on haiku though opus was chosen; Codex's per-turn and session models; published fixtures name a model |
| AC6 | Codex hook types are generated from, or checked against, Codex's published schemas | `codex-schemas.test.ts` AC6: a checked-in copy per covered version with tag and commit; zero drift for every version and hook; four planted drifts each named by field; a published hook the facts lack is drift; the copies are the published files |
| AC7 | a test adapter registered as `cursor`: `agent: cursor`, an unplaced call as `unknown`, no change to the schemas; a closed `agent` or kind list fails, naming the field | `cursor.test.ts` AC7: registration beside the shipped two; every recorded hook's event; `unknown` and `mcp`; `adapter.event@1` passes and no schema or digest moved; `agent` has no enum and any name passes (1,000 cases); the planted closed-agent twin fails at `/agent`; the planted closed-kinds twin fails at `/data/kind`; an unregistered agent is refused at `/agent`; renaming the agent in the facts changes no mapping |
| scope | `doctor()` and `adapter.facts@1` required, each field with `readBy` and a conformance case; optional operations only with a case; caps; `adapter.unsupported` per surface; a registry name; `deep` reserved | `contract.test.ts`: the five shapes published, linted; the three facts files validate; `/versions`, each section and its `readBy`/`conformance` at `validate` and at `register`; caps and unsupported shapes and refusals; `doctor()` shape; `/name` rules (with a 1,000-case property); optional operations gated by their case |
| scope | attention events; a tool call by kind with paths and command; an mcp call's server and tool | `contract.test.ts` (last two groups) and `usage.test.ts` (covers, tokens, context) |

The attention-state tests and the published tool-call shape test in `contract.test.ts` hold shapes #311
already met at the base; they are regression protection for this issue's scope bullets, not proof of #312,
and they fail at the base only because their file imports the surface. Everything else fails on the base's
missing surface and, run against a stub whose every call throws, at that call (BASE-FAILURE.txt's header).

## Fixtures

- `fixtures/codex-schemas/<version>/*.command.input.schema.json`: Codex's published hook input schemas at the
  tag of each version the Codex facts cover (`rust-v0.144.0` at `e0a9ff69…`, `rust-v0.160.0` at `79b1b666…`,
  `rust-v0.163.0-alpha.10.2` at `d9151c94…`), fetched from `openai/codex` on October 20, byte for byte, with
  `provenance.json` naming each file's source URL, tag and commit. Checked here so the test needs no network.
  The Codex facts at the base already agree with them under `factsDrift`'s rules (checked by a throwaway
  script outside the repo while writing the test).
- `fixtures/codex-schemas/planted/`: four twins of a 0.160.0 schema, each with one drift and the field that
  names it: `tool_input` renamed, `turn_id` dropped, `cwd` retyped, a required `prompt_source` added.
- `fixtures/cursor/cursor.facts.json` and `events.jsonl`: the test adapter's facts and its synthetic hook
  payloads, each with the event it must map to (`kind`, `data`), written from the facts and the design's shapes.
- `fixtures/planted/`: the closed-agent twin of `adapter.event@1` and the closed-kinds twin of `tool.before@1`.
- `fixtures/edits/`: a Claude Code Edit, a Codex `apply_patch`, the same patch through the shell tool (after
  `cd`, indented) and a patch with all four marker lines, as hook payloads on made-up sessions, in the shapes
  the corpus recorded.
- `fixtures/transcripts/`: a Claude Code transcript in the corpus's entry shape where the second turn answers on
  another model than the one requested, and one message repeats across two entries; a Codex rollout with two
  turns' `turn_context` and `token_count` records. Both made up; no account, user or instruction fields.

No fixture holds a secret or personal data; the session IDs, ULIDs and paths are made up or are the corpus's
own redacted ones.

## Files

- `helpers.ts`: fixture and corpus loading, JSON Pointer edits, refusal assertions (`expectRefused`,
  `expectThrown`), the hook request line, the cursor adapter's parts, the closed sets as the issue gives them.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, where every suite fails because the adapters package doesn't
  exist, with the Node version in its header.
- `stop.adapters.test.ts`: the adapters' half of AC2, moved as it stood out of `stop.test.ts` by the redraft
  below, so the published-shape half runs where only the contracts exist.

## Redraft of AC2 (2026-10-20, against main at `f037d9a`)

`stop.test.ts` was redrafted blind, per AGENTS.md (Proof), by a job that read only issue #312, the design, this
README, `helpers.ts`, the first draft of `stop.test.ts`, `agent.stop@1.json`, `agent.stop@2.json`, their
fixtures and `digests.json` on main, and never the implementing PR or its branch.

- **Why.** The first draft (base `f346706`) read the catalogued `agent.stop` through `kindSchema('agent.stop')`,
  which returns the catalogue's first entry for the kind, and held that schema to `cause` and `reset` at
  `/data/reset`, with a published fixture under it naming `plan_window_spent` and a numeric `reset`. Main has
  since merged #603, which settled the shape: `agent.stop@2` carries a required `cause`, the reset at
  `/data/plan_resets` and a nullable required `usage`, while `agent.stop@1` stays frozen at its base shape and
  digest and refuses a `cause` (`tests/acceptance/603/ac4-digest-redraft.test.ts`). The first draft could pass
  only by widening `agent.stop@1`, which that frozen test refuses. The owner sent the dispute to this redraft:
  AC2 is held against `agent.stop@2` as main ships it.
- **What changed.** `stop.test.ts`: the published-shape tests now name `agent.stop@2` through
  `kindSchema('agent.stop', 2)`; every member of the closed set is accepted and every non-member, non-string
  and missing cause refused at `/data/cause`; `plan_window_spent` carries its reset at `/data/plan_resets`
  (a whole number of ms since the epoch; text, a numeric string, a negative and a fraction refused; required
  there, refused beside every other cause); the published `agent.stop@2` fixture shows it; and `data` has no
  room for the agent's text. The adapters' readings (an unexplained stop is `unknown`, never a pass; no rule
  reads the agent's words; every recorded stop names a cause) moved unchanged to `stop.adapters.test.ts`,
  since they import `packages/adapters`, which the shape tests don't need and main doesn't have yet.
  `helpers.ts`: `kindSchema` takes an optional version; nothing else in it changed. No schema, fixture, digest
  or implementation changed.
- **Proof it still fails on a wrong program.** On main, `stop.test.ts` passes (29 tests). Against a scratch
  copy of `agent.stop@2.json` with one planted fault at a time, restored after each run, it fails naming the
  fault: the cause set widened with `overloaded` → 1 fails ("cause "overloaded" fails, naming /data/cause");
  `plan_resets` dropped from `plan_window_spent`'s required → 1 fails ("plan_window_spent without its reset:
  should be refused"); `plan_resets` retyped to `number` → 1 fails ("reset as a fraction of a ms"); `plan_resets`
  allowed beside every cause → 1 fails ("cause sign_in_required with a reset"); a `message` field allowed beside
  the cause → 1 fails ("a message beside the cause"). At the first draft's base, `agent.stop@2` isn't catalogued,
  so every test fails at `kindSchema('agent.stop', 2)`.
- **On main**, `stop.adapters.test.ts` fails at its import of `packages/adapters/src/index.ts`, as every other
  suite here does at the base (BASE-FAILURE.txt); that is expected until #312's implementation lands. The
  preflight unit lane runs `tests/**/*.test.ts` (`scripts/lanes.mjs`), so this redraft must land together with
  or after the implementation, never before it on its own.
- **Surface note.** `StopReading.reset` in the surface above is the adapters' TypeScript reading, left as the
  first draft named it; the published field it maps onto is `agent.stop@2`'s `data.plan_resets`. No test here
  reads `StopReading`, so the redraft doesn't rename it.
