# Acceptance tests for #363: plug-in store and actions

Written first, blind, by a job that never saw an implementation of #363. It read:

- issue #363 as of October 30, 2026: its Scope, its Fields (Access), its 8 checkbox criteria and its Proof; the oracle
  note it links (`doneright/oracles/issues/363.md`: no upstream test for any criterion)
- #6 and #102, for scope only
- `docs/technical-design.md`: Blocks for plug-ins that do real work (Store, Action, Send), Extension API (the
  `deep.store`, `deep.registerAction` and `deep.record.query` rows), Building blocks (the Action and Send rows, the MCP
  tools row), Composition (What a minor may change: `ext.<plugin>.<name>`), Event (the writer rule), Access, the
  "Where plug-in actions are served" row, safe retries, and Dogfooding
- `docs/canvas-primitives.md`: the event catalogue's `action.entered` and `action.reported` row
- `AGENTS.md`
- the acceptance tests of #350, #348 and #26, for their conventions
- the packages #363 builds on, at the base commit `6ba47cd`: `extension-host` (#348/#350's host: `registerAction`,
  `callAction`, grants, `deep.record.query`, plants, the runtime's `deep`), `hub` (`deep mcp`, `tools.ts`, the install
  path, session binding), `contracts` (`checkManifest` and its own-name rule, `action.entered@1`, `action.reported@1`,
  `extension.manifest@1`'s `stores` and `actions`), `record` (text fields, writers), `supervisor`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

The issue has 8 checkbox criteria, AC1 to AC8, in the body's order.

## How to run

On macOS, with the repo's Node (24):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub-level tests run the built CLI, packages/cli/dist/main.js
node node_modules/vitest/vitest.mjs run --root tests/acceptance/363 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/363/tsconfig.json
```

- **`--no-file-parallelism`:** the files start sandboxed plug-ins through the supervisor and real hubs, so nothing
  else should run beside them. The implementer adds `tests/acceptance/363/` to the one-at-a-time list (`alone`) in
  `scripts/lanes.mjs`, as #26's and #350's suites are (not done here: this job writes tests only).
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment and
  points `HOME` at a temp folder; every hub, `deep` command and agent stand-in runs with `HOME` in its own temp folder,
  so nothing touches the real `~/.deepbuild`.
- **Temp folders:** every plug-in, record, evidence store, hub home and worktree is under `/tmp/dh363-*`, a real path,
  removed after its file. Every host a test opens is closed after its file; every process a hub-level test started
  (the hub, `deep` commands, the agent stand-in and its servers) is stopped by its PID. Nothing is stopped by name or
  port.
- **No network:** none, beyond the hub's own Unix socket.

## The surface under test

Names come from the issue and the design: store, store kind, forward migration, action, read/change/send, `changes`,
`deep-actions`, one tool that finds actions and returns their schemas, one that calls an action by name with a request
ID, `verified` (`true`, `false`, `unverified`), `checked`, `action.entered`, `action.reported`, `changed`, record grant,
content-free fields, text, a declared use. Where they leave a name open, this job picked one; each is marked *picked
here* and listed under Readings.

### `packages/extension-host/src/index.ts` gains

```ts
import type { Connection } from '@deepbuild/record';

export interface ActionCall {
  // ...#350's fields: action, target ({ handle: `ext:<id>`, version }), input, caller, focus; and:
  /** The call's request ID. An identical retry has no second effect; the same ID with other input is refused before
   *  anything is written or run. */
  request: string;
}

export interface InstallFrom {
  // ...#348's and #350's fields; the grant gains `text`:
  grant?: {
    /** The event kinds it may read, from the core's and its own; '*' is every one of those (picked here). */
    record?: string[];
    /** true: the record's text fields too (a prompt's text, a command). Absent or false: content-free fields only. */
    text?: boolean;
    hosts?: HostGrant[];
  };
}

/** An action a loaded plug-in registered, as the host offers it to agents (picked here). */
export interface ActionListing {
  action: string;                       // ext.<plugin>.<name>
  extension: string;                    // owner/name
  version: string;
  declares: 'read' | 'change' | 'send';
  input: Record<string, unknown>;       // its input's JSON Schema, as declared
  exposed: boolean;                     // false: left out at install
  reason: string | null;                // why it was left out, naming the schema keyword a model API rejects
}

export type Plant = /* #348's, #350's and later issues' */
  | 'record-by-grant-words'     // AC3: filters a record read by the grant's words only
  | 'copies-report-changed'     // AC8: copies the handler's report's `changed` into action.reported's
  | 'keeps-malformed-verified'; // AC8: keeps a report's `verified` as the handler gave it

export interface ExtensionHost {
  // ...and:
  /** Every action the loaded plug-ins registered, exposed or left out (picked here). */
  actions(): Promise<ActionListing[]>;
}
```

`callAction` stays the hub's own entry: the hub's `deep-actions` calls it once its gate let an agent's call through,
and a panel calls it directly (README, Readings: the gate). For a change or send action it records, writer `core` with
the caller's actor, scope and session, `action.entered@1` (`{ call, plugin, action, request, input }`) before the
handler starts and `action.reported@1` (`{ call, changed, verified, checked, error }`) when it ends, as the contracts
already define them. `changed` holds one entry for each store item the hub wrote for that call, taken from the record;
an entry names the item by its key or by its store event's ID (*picked here*: either). `verified` is the string
`"true"`, `"false"` or `"unverified"`; a missing or malformed report is `"unverified"`.

### `EXTENSION_API` gains

| Method | Needs | Shape the tests rely on |
|---|---|---|
| `deep.store(kind, { generation, schema, migrates? }, migrate?)` | null | The design's `deep.store(kind, schema)`. `kind` is one of the manifest's `stores`; `schema` the JSON Schema of its items at `generation` (a positive integer); `migrates` the lower generations `migrate(from, value) → value` moves an item from. When a version with a higher generation loads, its migration rewrites the store's items forward. A `migrates` entry not below `generation` is a migration backward. |
| `deep.store.put(kind, key, value)` | null | Puts the item: an event of `kind` in the record, written `ext:<id>` with the calling action's actor, scope and session. |
| `deep.store.get(kind, key)` | null | The item's value, or null. |
| `deep.store.list(kind)` | null | `[{ key, value }]`, each value as the store holds it now. |
| `deep.registerAction(name, declared, fn)` | null | #350's, and `declared` gains `output` (the output's JSON Schema), `changes` (the store kinds a change action changes) and `reads` (the store kinds a read action lets an agent read). `fn(input, ctx)` returns a read's output; a change or send returns `{ output, report }`, the report `{ verified: true \| false \| 'unverified', checked: string }`. |
| `deep.record.query(filter)` | `record` | #348's, `filter` `{ kinds }`. The hub filters by the grant before anything crosses into the sandbox. A query naming another plug-in's store or event kind rejects with an error whose message names the kind, the plug-in that declares it and the use to declare instead (the manifest's `uses`). |

The method names `deep.store.put`, `deep.store.get` and `deep.store.list`, and `declared`'s `output` and `reads`, are
picked here.

### Install refusals

"At install" is the install a person runs: `install`, then conformance (`check`), then `load` (README, Readings). A
refusal at any of the three is the install's, its reason the error's message, the conformance reasons or the load's
reason. The tests read each refusal's text:

| Rule | The refusal names |
|---|---|
| a change action changes a store kind no action or reading lets an agent read | the kind (`ext.rules.alert`), the action (`ext.rules.set_alert`), and reading (`read`) |
| one field name has two types across the plug-in's schemas | the field (`above`) and both types (`number`, `string`) |
| an action's output is only a success flag and a message | the action (`ext.rules.set_alert`), and `flag`, `message` or `success` |
| a store migration backward (AC4, when refused) | the store kind (`ext.stocks.alert`) |

### `deep-actions`, the second server entry

- **Its command:** `deep mcp actions` (*picked here*), an MCP server on stdio like `deep mcp`, reaching the hub the
  same way. An agent's config names it `deep-actions` beside `deep`.
- **Its tools:** exactly two (*names picked here*): `find_actions` and `call_action`.
- **`find_actions`**, arguments `{ query: string | null }` (null: every action): its value is
  `{ actions: [{ action, extension, declares, input }] }`, the exposed actions only, `input` the declared input schema.
- **`call_action`**, arguments `{ action, request, input }`: `request` the request ID; `input` one string holding the
  input's JSON text (the strict tool schemas take no free-form object, as `deep_show`'s `document` is a string). A
  read runs: its value is `{ status: 'done', output, ... }`. A change with no standing rule raises an ask, filed as
  `ask.created` under the agent's session, and its handler doesn't run while the ask is open; a send always asks. Input
  its schema refuses, an action left out at install, and an error the handler raises are each a tool result with
  `isError: true`, never a JSON-RPC error and never a done result; input its schema refuses is answered without
  waiting on an ask.
- **The `deep` server** keeps listing the core `deep_*` tools only.

## Readings

- **`set-alert` (AC8).** The manifest's own-name rule (`checkManifest`, extension.manifest@1) takes
  `ext.<plugin>.[a-z][a-z0-9_]*`, so a hyphen isn't allowed: the stocks plug-in's `set-alert` is
  `ext.stocks.set_alert`, and likewise `list_alerts` and `send_digest`.
- **The gate.** Reads run, changes need a standing rule or an ask, sends always ask: this is `deep-actions`', in the
  hub, before it calls the host's `callAction` (it holds the asks core and the decisions). `callAction` runs the call
  it is given, for the caller it names. So the host-level tests call change actions as a panel (`writer: app`) or as
  an agent's call the gate let through (`writer: mcp:<session>`), and AC5 tests the gate through a real hub.
- **"Left out at install with the reason" (AC1).** The plug-in installs and loads; the action is listed by
  `actions()` with `exposed: false` and a reason naming the keyword; `find_actions` never lists it and `call_action`
  refuses it. The keywords: `minimum` (a range, which Anthropic's strict tool schemas reject) and `oneOf` (a union,
  which OpenAI's strict function schemas reject). Whether a panel may still call a left-out action is left open.
- **"Every session still lists `deep_ask` and `deep_claim`" (AC1).** A session's `deep` server, with the plug-in
  installed, lists both; `deep-actions` is a separate entry, so its plug-in schemas can't hide them.
- **Transcript text and content-free fields (AC2).** The text the record keeps of a session: a prompt's text
  (`user.ask`'s `text`) and a command (`tool.before`'s `command`), the record's own text fields. Granted those kinds
  without `text`, the plug-in gets both events and neither text. A control grants `text: true` and finds the text.
- **"Granted the record for every event kind" (AC3).** `grant.record: ['*']`: every kind of the core's and its own.
  "The use to declare" is read as the refusal naming a use (`use` or `uses`). A control reads a core kind
  (`task.created`) under the same grant.
- **Rolling back (AC4).** 1.0.0 declares generation 1, `{ symbol, above }`, a schema that doesn't close its objects;
  2.0.0 declares generation 2, adding `note`, migrating forward from 1 (`note: null`). Loading 2.0.0 rewrites the item
  in the record. Installing 1.0.0's bytes again is a rollback of the code: it installs, since its schema accepts the
  items the store holds now, and it reads them as generation 2 left them, with nothing written back. "A generation that
  can't read the current schema can't be installed" (the design) has no criterion and isn't tested.
- **"Data migrations only move forward" (AC4).** A version declaring a migration from generation 2 to 1 is refused
  naming the store kind, or, if installed, never runs it: the items stay as generation 2 left them and no store item is
  written. Either passes.
- **"Typed from its schema" (AC5).** `find_actions` returns each action's declared input schema, and `call_action`
  refuses input that schema refuses, as an error, before any ask.
- **"Raises an ask" (AC5).** An `ask.created` under the agent's session appears within 20 s of the call, while the
  call waits or after it returned; the handler hasn't run (the plug-in's `runs` read action says 0, and the store holds
  nothing). The ask isn't answered. "A send always asks": the send raises an ask in the same fresh hub; that it asks
  even under a standing rule isn't tested, since no standing rule for actions can be set yet.
- **"The `deep` server lists only the core tools" (AC5).** Its list with two plug-ins installed equals its list on a
  hub with none, every name `deep_*`, neither of deep-actions' tools nor any action among them.
- **"An error the action raises reaches the agent as an error" (AC6).** Through `deep-actions`: a tool result with
  `isError: true`, not a JSON-RPC error and not a done result. Whether a sandboxed plug-in's own words reach the agent
  is left open.
- **"Refused before any write or cursor move" (AC7).** Nothing is appended to the record (its newest log position
  doesn't move: no store item, no `action.entered`, no event at all) and the handler doesn't run. An identical retry is
  answered `done`, enters no second call, writes no second item and doesn't run the handler again.
- **Target and authority (AC7).** The target is the one the call names: a call naming none is refused and runs
  nothing, whatever window has focus; the focused window (`focus`) never redirects a call. The authority is the call's
  own caller: after agent B's call, agent A's call writes its store item and its `action.entered` with A's session.
  "The current folder" isn't encoded: a host-level call has no folder, and the hub binds `deep-actions` to its session
  by its process, not its folder; the PR should say how it proves that part.
- **"What changed comes from the record" (AC8).** `changed` lists what the hub wrote for the call. The control: the
  first `set_alert` for NVDA at 200 writes one store item, between its `action.entered` and its `action.reported`, and
  its `changed` holds one entry naming that item; the second, while the alert exists, writes nothing and holds `[]`.
  "An agent's call" reaches the host as `deep-actions` makes it, with the agent's connection (the gate, above).
- **Malformed reports (AC8).** No report, a string, and `verified: "yes"` each record `verified: "unverified"`. A
  twin that keeps `"yes"` may fail to append at all, since `action.reported@1` takes three values only; the judge fails
  it either way, naming the call.
- **No PreToolUse for deep-actions' calls.** As #26's suite does for one session, the stand-in's servers act for its
  session through their process; it sends no PreToolUse stamp before a `deep-actions` call.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID,
`#363.<first 8 hex of the SHA-256 of its text>`, computed on the text trimmed, whitespace collapsed and `- [ ] `
dropped. A test headed `(wrong program)` runs the same scenario against the planted twin the criterion names and
expects that twin to fail the criterion's judge (`judges.ts`) with the problem naming what the criterion says.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#363.126cded2` | an action whose schema a model API rejects is left out with the reason; sessions list deep_ask, deep_claim | `actions.test.ts` (2): the reason at install, on the host; what a session lists through a real hub | fails (no `actions()`, no `deep mcp actions`) |
| AC2 `#363.2d03fd41` | content-free grant: no transcript text from deep.record.query | `reads.test.ts` (1): both events without their text, and the control with `text` | fails (the text crosses into the sandbox) |
| AC3 `#363.41b82a9b` | every-kind grant, another plug-in's store kind: refused naming kind, plug-in and use, no rows; grant-words twin fails | `reads.test.ts` (2): the refusal; wrong program `record-by-grant-words` | fails (no `deep.store`) |
| AC4 `#363.b6b1737b` | rollback keeps the store readable; migrations only forward | `store.test.ts` (2): the rollback; a backward migration | fails (no `deep.store`) |
| AC5 `#363.f25b4886` | through deep-actions, typed: a read runs, a change asks, a send asks; deep lists only core tools | `actions.test.ts` (2): the gate and the types; deep's list | fails (no `deep.store`, no `deep mcp actions`) |
| AC6 `#363.18d8b91c` | three install refusals naming the rule; fixed, it installs; an action's error reaches the agent as an error | `install.test.ts` (4): one per rule with its fix; the error through deep-actions | fails (no `deep.store`) |
| AC7 `#363.4e75de68` | identical retry once; same ID other input refused before any write; target and authority never ambient | `retries.test.ts` (2) | fails (no `deep.store`) |
| AC8 `#363.33062d5b` | one entered then one reported with changed []; planted handlers; two twins fail naming the call | `changed.test.ts` (7): the no-op and its control; claims-changed; three malformed reports; wrong programs `copies-report-changed` and `keeps-malformed-verified` | fails (no `deep.store`) |

22 tests in all. No half of a criterion here waits on an unbuilt issue, but AC7's "current folder" isn't encoded (Readings).

## Wrong programs

| Twin | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| host `plant: 'record-by-grant-words'` | AC3 | filters a record read by the grant's words only, so `'*'` matches `ext.stocks.alert` | the reader gets the alert's rows; the judge names `ext.stocks.alert` |
| host `plant: 'copies-report-changed'` | AC8 | copies the report's `changed` into `action.reported` | a call that wrote nothing says changed; the judge names the call |
| host `plant: 'keeps-malformed-verified'` | AC8 | keeps `verified: "yes"` as given | `action.reported` isn't `unverified`, or isn't recorded; the judge names the call |

The criteria that name no twin (AC1, AC2, AC4 to AC7) carry their own discriminating cases: AC1's good action beside
the two left out; AC2's control with `text`; AC4's item read back with its generation-2 field and the store's event
count; AC5's handler run counts and the store; AC6's fixed twin beside each refused one; AC7's log position and run
count; AC8's control call that does write.

## Fixtures

The plug-ins' code carries a `.fixture` suffix so this suite's Vitest and `tsc` skip it; `pkg()` copies a fixture,
renames it, writes `probe.json` and manifest fields per test, and stamps the digest with the host's `packageDigest`.

- `stocks` (`test/stocks`): store kind `ext.stocks.alert`; actions `set_alert` (change, changes the alert),
  `list_alerts` (read, reads it), `send_digest` (send) and `runs` (read: how often set_alert and send_digest ran).
  `probe.json`: `generation` (1 or 2), `backward`, and `plant` for set_alert's planted handlers (`claims-changed`,
  `no-report`, `string-report`, `yes-report`).
- `reader` (`test/reader`, the `record` access word): `query`, a read action returning what `deep.record.query` handed
  it, or the refusal's message.
- `picky` (`test/picky`): `ok`, and `min` and `union`, whose schemas use `minimum` and `oneOf`.
- `rules` (`test/rules`): store kind `ext.rules.alert`, `set_alert`, `list_alerts` and `boom` (raises an error);
  `probe.json`'s `case` breaks one install rule (`unread-change`, `two-types`, `flag-message`) or none (`fixed`).
- `agent.mjs`: the agent stand-in, after #26's, with one child process per server entry (`deep`, `deep-actions`).

## Files

- `helpers.ts`: the environment cleanup, temp folders, connections, the world (record, evidence, asks, supervisor,
  trust), hosts, the fixture copier, installs that may be refused, action calls, seeding and the record read back.
- `hub.ts`: a real hub in a temp home, `deep install`, the agent stand-in and its two servers, `events.read`.
- `judges.ts`: AC3's and AC8's assertions, which the wrong programs must fail.
- The test files: `actions.test.ts` (AC1, AC5), `reads.test.ts` (AC2, AC3), `store.test.ts` (AC4),
  `install.test.ts` (AC6), `retries.test.ts` (AC7), `changed.test.ts` (AC8).
- `fixtures/`: the plug-ins and the agent stand-in, above.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run and the type check on the base commit.

## Not covered: Scope with no criterion

The repos or workspaces a record grant names; notices and sends in `changed`; a send whose answer never came (unknown,
never retried); a call that fails after its handler started keeping what the hub made for it, as unverified;
`action.reported` written before the output an agent gets is cut short; removing a plug-in asking once before its data
goes; extensions inside the signed release keeping full access. The PR should say how it proves each it claims.
