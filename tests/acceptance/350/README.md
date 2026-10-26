# Acceptance tests for #350: extension calls at run time

Written first, blind, by a job that never saw an implementation of #350. It read:

- issue #350 as of October 24, 2026: its Scope, its 9 checkbox criteria and its Proof
- #349 and #44, for scope only
- `docs/technical-design.md`: Extension API (with "Several handlers, one reply" and "Context is typed"), Building
  blocks (the `capability.refused` paragraph and the blocks table), Composition, Socket roles and contract versions
  (one role per credential, Version skew), and the events table's writer column
- `AGENTS.md`
- the acceptance tests of #348, for their conventions
- the packages #350 builds on: `extension-host` (#348's host, its runtime and entry), `contracts` (`hook.ts`'s
  `joinHookReplies` and `contextBoundFor`, hook.joined@1, extension.manifest@1, tool.before@2, task.created@1,
  `checkManifest`, `d1Digest`), `record` (connections, the writer rule, schema validation per kind), `evidence`,
  `supervisor`
- the base commit `0c2fed1`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

The issue has 9 checkbox criteria, AC1 to AC9, in the body's order.

## How to run

On macOS, with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # if any package's dist is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/350 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/350/tsconfig.json
```

- **`--no-file-parallelism`:** the files start sandboxed processes through the supervisor, time hook deadlines,
  and count this process's handles, so nothing else should run beside them.
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment
  and points `HOME` at a temp folder, so nothing touches the real `~/.deepbuild`. AC4 sets `DH350_FAIL_START` in
  this process for one load and removes it after.
- **Temp folders:** every package, record, evidence store and home is under `/tmp/dh350-*`, a real path, removed
  after its file. Every host a test opens is closed after its file, which stops what it started; nothing is
  stopped by name or port.
- **No network:** the only listeners are the test's own HTTP servers on 127.0.0.1 (AC6, AC7), standing in for a
  host a grant names. The call to a host no grant names (`evil.example`) must be refused before any network.
- **Time:** AC3 runs twelve fresh worlds, each with two timed requests; the suite takes a few minutes.

## The surface under test

The issue names no module. #350 builds on #348's host, so the tests reach it only through
`packages/extension-host/src/index.ts`, plus two contract changes in `@deepbuild/contracts`. Names come from the
issue and the design: hook handler, context template, `tool.before`, deny, deadline, bound, staged activation,
disable, action, target (handle and version), `capability.refused`, grant clause, quota, schema, digest, writer
`ext:<id>`, provide, use.

### `packages/extension-host/src/index.ts` gains

```ts
import type { JoinedHookReply } from '@deepbuild/contracts';
import type { Connection } from '@deepbuild/record';

/** One hook request to every loaded handler of its kind. */
export interface HookRequest {
  kind: 'tool.before';
  data: unknown;        // the event's data, as tool.before@2 has it
  deadline: number;     // ms each handler has to reply; past it, it is recorded as failed
  bound: number;        // the hook's total context bound, in characters (code points), as hook.joined@1 counts it
}
/** The joined reply: hook.joined@1's fields, and the handlers recorded as failed. No other field. */
export interface HookReply extends JoinedHookReply {
  failed: { extension: string; reason: string }[];
}

/** What an action call targets: the providing piece, explicitly, and the version of it the caller means. */
export interface ActionTarget { handle: string /* `ext:<id>` */; version: string }
export interface ActionCall {
  action: string;          // ext.<plugin>.<name>, as the manifest's `actions` lists it
  target: ActionTarget;
  input: unknown;          // checked against the action's input schema before it runs
  caller: Connection;      // who calls, as the hub's socket proved it: headless (`cli`), a panel (`app`), an agent (`mcp:<session>`)
  focus?: string | null;   // the window that has focus when it's called; it never chooses the target
}
export type ActionResult = { status: 'done'; output: unknown } | { status: 'refused'; reason: string };

export interface InstallFrom {
  // ...#348's fields; grant gains the hosts you approved, each with its quota:
  grant?: { record?: string[]; hosts?: { host: string /* "host:port" */; quota: { calls: number; per_ms: number } }[] };
}

export type Plant =
  | 'hub-unless-agent-built' | 'grants-only-in-record-query' | 'first-party-appends-every-kind'  // #348's
  | 'context-as-text'          // AC2: passes a handler's context through as text, its template unchecked
  | 'writer-from-arguments'    // AC6: takes a refusal's writer from the call's arguments
  | 'join-by-id-alone'         // AC8: joins by extension ID alone, with no first-party group
  | 'cut-in-join-order'        // AC8: fills the room in join order, keeping a whole and cutting b
  | 'stop-provider-first';     // AC9: stops B's handlers before it detaches A's use

export interface ExtensionHost {
  // ...#348's methods, and:
  hook(request: HookRequest): Promise<HookReply>;
  callAction(call: ActionCall): Promise<ActionResult>;
  /** Disable (remove) a loaded piece: stop new calls, detach its users' uses, then stop it. `load` enables it again. */
  disable(id: string): Promise<void>;
}
```

`EXTENSION_API` gains these methods (each `needs` as shown):

| Method | Needs | Shape the tests rely on |
|---|---|---|
| `deep.registerAction(name, { declares, input }, fn)` | null | `declares` is `read`, `change` or `send`; `input` the input's JSON Schema; `fn(input, ctx)` with `ctx.target` the call's target. The tests use `read` only. |
| `deep.fetch(request)` | `hosts` | `request` is `{ url, method?, headers?, body? }`; the host makes the call for the package, within its grant and quota, and returns `{ status, ... }` |
| `deep.provide(name@major, kind, schema, fn)` | null | an output; for a `reading`, `fn()` returns its value, which `schema` describes |
| `deep.use(name@major, { optional })` | null | a use of an output interface |
| `deep.read(name@major)` | null | `{ value }` from the use's provider, or `{ missing: true }` when the use has none |

`deep.on('tool.before', handler)` is #348's method; `handler(request)` now returns the reply: for a first-party
package `{ context?: string, deny?: { reason: string } }` or nothing; for any other package
`{ context?: { template, values }, deny?: { template, values } }` or nothing.

### `@deepbuild/contracts` gains

- **extension.manifest@1's `templates`** (the hook context templates its description says arrive later):
  `[{ name, hook: 'tool.before', text, fields: { <field>: { type: 'handle' | 'number' | 'name' } | { type: 'one_of', values: string[] } } }]`.
  `text` names each field as `{field}`. The fixtures use `handle` and `number`.
- **`capability.refused@1`**, an event kind the record accepts from any writer the connection gives: its `data` is
  `{ call: string, broke: 'grant' | 'quota' | 'schema', clause: string, digest: string }`. `clause` is the grant
  clause, the limit or the schema path the call broke, and `digest` is a SHA-256 of the call (64 hex, optionally
  `d1:` or `sha256:` first), never its values.

## Readings

- **What the agent sees (AC1, AC2, AC3, AC8).** A reply's `context` blocks and its `denies`' reasons. The adapter maps
  them to the agent's output later; that mapping isn't #350's.
- **"Can only add context or deny" (AC1).** A reply with any field beyond `context` and `deny` (allowing the call,
  rewriting its input, answering for you) is recorded as failed, and nothing of it, its context included, reaches
  the agent. This follows Version skew: a field the reader doesn't understand fails rather than being ignored. A
  reply of nothing adds nothing and isn't a failure.
- **"Recorded as failed" (AC2, AC3).** The design says "recorded in the reply as failed": the reply's `failed`
  entry, naming the extension, with a reason that names the field for a template refusal. Recording failures in
  the record as events isn't required.
- **"Labelled with the extension's name" (AC2).** The block's `extension` is the package's ID, as hook.joined@1
  carries it. Whether the text also carries the name is left to the host; the tests count the bound on whatever
  text the blocks have.
- **"Every order they registered or finished in" (AC3).** All six load orders, each with both finishing orders of
  the two handlers that meet the deadline; the late one finishes last by definition. A reply is compared on
  `order`, `bound`, `denies`, `context` and who failed; a failure's wording may give times.
- **"Its late reply changes no later request" (AC3).** The second request waits on the late package, whose reply to
  the first request arrives in the meantime; the second reply must hold the late package's reply to the second,
  and nothing failed. The deny's context is kept beside it, as `joinHookReplies` does.
- **"Equal shares of what's left" (AC8).** The room left after z-notes is chosen even and below the length of both
  blocks, so each of a and b gets exactly half and keeps its start. The lengths come from a first request with room
  for everything, so the test doesn't depend on how the host labels a block.
- **"Fails to start" (AC4).** A package's conformance passes and its load then fails. The planted package fails only
  in the hub, when this process has `DH350_FAIL_START=1`; conformance runs it in the sandbox, whose environment has
  no such variable. While it starts (it waits 800 ms after registering), a hook and an action call made then must
  not reach it. A control loads the same bytes without the variable and sees both.
- **"No listener or callback it owned" (AC4).** Read from outside: after each disable its sandboxed process is gone,
  its handler answers no hook and its action no call, and after 20 cycles this process holds no more sockets,
  pipes, servers or child processes than after the first. In the hub, every load's handler moves one counter in
  this process, so a handler a disabled load left behind shows as more than one call per hook.
- **A removed version's late call (AC4).** Two first-party versions of one package in the hub. A call to 1.0.0 waits
  on a file; 2.0.0 is installed and loaded; the file appears; 1.0.0's call then tries to append. Its append must not
  land, its result must not be `done`, and 2.0.0 must have run only the test's own calls. A call still waiting
  15 s after is taken as delivering nothing.
- **"Authenticated scope" (AC5).** A call's caller connection. What the extension does while serving a call, here a
  record append before and after an await, carries that call's actor, scope and session; its writer stays
  `ext:<id>`. Two agent sessions call; the first waits longer, so they finish in reverse order. Both places are
  tested.
- **"Explicit handle and version", "whichever window has focus", "a stale target" (AC5).** An action call names its
  target, the providing piece's `ext:<id>` and the version the caller means; the action is handed that target
  whether the caller is headless or a panel, and whatever `focus` is. A stale target is a version that isn't the
  active one: one never loaded, or the one a replacement took over from. It runs nothing (no append, no call on the
  active version) and returns no `done`.
- **"Calls a host its grant doesn't name" (AC6).** The package has the `hosts` access word and a grant naming only
  the test's own server; it calls `https://evil.example`. `writer: "app"` and `actor: "mallory"` are in its
  arguments, its headers and its body. The token is built inside the package from probe.json's seed (`PLANTED-` and
  the seed reversed), so its bytes are in none of the package's files.
- **"The record, the evidence or the logs" (AC6).** Every file under the world's folder (`ledger.db` and its WAL,
  the evidence store), the package's folder and the temp HOME, as UTF-8 and UTF-16LE bytes, searched once with the
  record open after a sync and once after the host and the record closed; and every event read back. A control finds
  the seed where it is.
- **Quota and schema (AC7).** The quota is a grant's `quota` for a host, `{ calls, per_ms }`: two calls an hour to
  the test's server, the third refused, and the server sees two. The schema is the action's input schema: `count`
  must be an integer. The quota refusal's writer is the package's; the schema refusal's is the caller's (`cli`).
  "Naming the quota" is read as `broke: 'quota'` with a clause naming its host or its count; "naming the schema
  field" as `broke: 'schema'` with a clause naming `count`.
- **"A using B's output" (AC9).** B provides the reading `ext.b.feed@1`; A's manifest uses it at minor 0 with the
  `d1Digest` of its schema, marked optional, so removing B asks nothing. A, first-party in the hub, reads it back
  to back for 3 s; B, sandboxed, is disabled 0.8 s in. Before the use is detached A gets B's value; after, it reads
  missing; a read that fails any other way means B's handlers stopped while A still used it. A read in flight when
  removal starts may get B's value or read missing.
- **Fast-rule and watch-only (Scope).** "A failure takes the hook's existing fast-rule or watch-only policy" has no
  criterion; nothing here tests it, and a PR should say how it proves it. The same goes for the done gate and R2's
  parallel-session notices using hook replies.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID,
`#350.<first 8 hex of the SHA-256 of its text>`, computed on the text trimmed, whitespace collapsed and `- [ ] `
dropped. A test headed `(wrong program)` runs the same scenario against the planted twin the criterion names and
expects that twin to fail the criterion's judge (`judges.ts`) with the problem naming what the criterion says.

| ID | Criterion (short) | Tests | BLOCKED half | At this base |
|---|---|---|---|---|
| AC1 `#350.2f824654` | a tool.before handler can only add context or deny | `replies.test.ts` AC1 (1): seven replies from a first-party package in the hub | none | fails (no `hook`) |
| AC2 `#350.7727c408` | template with handle and count: planted text failed, naming the field; typed values one labelled block; pass-through host fails | `replies.test.ts` AC2 (2): the outside package in the sandbox; wrong program `context-as-text` | none | fails (no `templates` in the manifest contract) |
| AC3 `#350.b88afef3` | context, deny, late: same reply in every order; deny stands; bound; late failed; late reply changes no later request | `join.test.ts` AC3 (3): the same replies in 12 runs; deny, bound and failure; the late reply | none | fails |
| AC4 `#350.43f82359` | fails to start exposes neither; 20 enable/disable cycles leave nothing; removed version's late call | `staged.test.ts` AC4 (4): during and after a failed start, with a control; 20 cycles sandboxed; 20 cycles in the hub; the late call | none | fails |
| AC5 `#350.7c4e7560` | overlapping calls keep their scope; headless and panel get the same explicit target; stale target has no effect | `actions.test.ts` AC5 (3): overlapping calls in the sandbox and in the hub; targets and stale targets | none | fails |
| AC6 `#350.7884cbb1` | ungranted host refused; one capability.refused by `ext:<id>` with clause and digest; token nowhere; writer-from-arguments host fails | `refusals.test.ts` AC6 (3): the refusal; the token on disk and read back; wrong program `writer-from-arguments` | none | fails |
| AC7 `#350.b5c18039` | quota and schema refusals each recorded, naming the quota or the field | `refusals.test.ts` AC7 (1) | none | fails |
| AC8 `#350.170a7bd3` | z-notes whole, a and b equal shares; by-ID host and keep-a-whole host fail, naming the extension | `join.test.ts` AC8 (3): the cut; wrong programs `join-by-id-alone` and `cut-in-join-order` | none | fails |
| AC9 `#350.bff15b51` | removing B detaches A's use before B's handlers stop; stop-B-first host fails, naming the edge | `staged.test.ts` AC9 (2): the removal; wrong program `stop-provider-first` | none | fails |

## Wrong programs

| Twin | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| host `plant: 'context-as-text'` | AC2 | passes a handler's context through as text, its template's types unchecked | the planted string reaches the agent; the judge names `test/tmpl` |
| host `plant: 'writer-from-arguments'` | AC6 | takes a refusal's writer from the call's arguments | `capability.refused`'s writer is `app`; the judge says so |
| host `plant: 'join-by-id-alone'` | AC8 | joins by extension ID with no first-party group | z-notes, sorting last, is cut; the judge names `deepbuild/z-notes` |
| host `plant: 'cut-in-join-order'` | AC8 | fills the room in join order | a is kept whole and b cut; the judge names `acme/a` |
| host `plant: 'stop-provider-first'` | AC9 | stops B's handlers, then detaches A's use | A's reads fail between the two; the judge names the edge `deepbuild/a uses ext.b.feed@1 from test/b` |

The criteria that name no twin (AC1, AC3, AC4, AC5, AC7) fail on the base, which has no `hook`, `callAction`,
`disable`, `deep.registerAction`, `deep.fetch`, `deep.provide`, manifest `templates` or `capability.refused@1`. Past
that, each carries its own discriminating case: AC1's seven replies, AC3's twelve orders and its late reply naming
its call, AC4's control and its counters, AC5's reverse finishing order and the stale target that a redirecting host
would run on the active version, AC7's server count and the action's own run count. The mutation lane is their
wrong program beyond these.

## What depends on other issues

- **#349, extension slots.** `deep.registerAction`'s kit (`action@1`), the read/change/send rules and asks for a
  change action, and the slot declarations are #349's and R2's. The tests use `read` actions only, and need no kit.
- **#351, extension packages.** Conflicts, replacement declarations and the envelope digest are #351's. A new version
  here replaces the old by installing it, as #348's host does.
- **The done gate and R2's parallel-session notices.** The Scope says both use hook replies; neither exists yet, and
  no criterion names them. Nothing here waits on them.
- **Composition beyond one edge.** A required use's ask on removal, type mismatches at install, cycles and contract
  tests along edges are the design's Composition rules; AC9 needs one optional edge only.

No half of a criterion here waits on an unbuilt issue. So a PR for #350 that passes every test here may say
`Closes #350`, after saying how it proves the Scope's fast-rule or watch-only policy for a failed handler.

## Files

- `helpers.ts`: the environment cleanup, temp folders, connections (`YOU`, `HEADLESS`, `PANEL`, `agentCall`), the
  world (record with its evidence store, asks, supervisor, trust), hosts, the fixture copier (`*.fixture` renamed,
  manifest fields and probe settings written, the digest stamped with `packageDigest`), install-check-load, hook
  requests, the probe reader, tracked PIDs, task events and the byte search.
- `judges.ts`: the criteria's assertions that the wrong programs must fail (AC2, AC6, AC8, AC9).
- The test files:
  - `replies.test.ts`: AC1, AC2
  - `join.test.ts`: AC3, AC8
  - `staged.test.ts`: AC4, AC9
  - `actions.test.ts`: AC5
  - `refusals.test.ts`: AC6, AC7
- `fixtures/`: the test packages, their `.ts` code carrying a `.fixture` suffix so this suite and `tsc` skip it:
  - first-party, in the hub: `replies` (AC1), `starts` (AC4), `cyclehub` (AC4), `notes` as `deepbuild/z-notes` (AC8),
    `user` as `deepbuild/a` (AC9), and `acts` as `deepbuild/acts` (AC4, AC5)
  - outside the release, in the sandbox: `templated` (AC2), `hooker` as `test/ctx`, `test/deny`, `test/late` (AC3),
    `cycle` (AC4), `acts` as `test/acts` (AC5, AC7), `caller` (AC6, AC7), `outside` as `acme/a` and `acme/b` (AC8),
    `provider` as `test/b` (AC9)
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run and the type check on the base commit.
