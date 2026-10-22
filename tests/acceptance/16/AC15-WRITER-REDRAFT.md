# AC15 blind redraft, the writer clause: a payload's `writer: app` is stored as `hook`

Test: `writer-redraft.test.ts`, one `describe` ("AC15 #16.ffcc7e73 a hook request whose payload sets writer: app
is stored with writer hook (redraft)") with two `it`s: the real hub passes, and the `(wrong program)` run on
`DEEP_HUB_PLANT=writer-from-payload` fails at the same assertion, naming the event's ID.

The clause, from AC15 of #16: "a hook request whose payload sets `writer: app` is stored with writer `hook`. A hub
that takes `writer` from the payload fails, naming the event". The rest of AC15 (the role table, the hook
connection's three refusals) isn't redrafted here.

## What I read

The brief calls the base `4f6dec5`; this checkout's HEAD is `c9891b3` (main after #650), and everything below was
read and run there.

- Issue #16 (`gh issue view 16 --repo windoliver/deepbuild --comments`): Scope, the criteria, "Added Oct 9" ("One
  role per credential"), Done when, and the comment.
- `docs/technical-design.md` in this checkout: "Socket roles and contract versions" ("Every event's writer comes from
  this credential, never from a field the caller fills in"), "Hook protocol (deep-hook and the hub)" (the request
  shape; `id` is "the event's identity from then on"), "One event log, with tables built from it" (`writer TEXT NOT
  NULL -- hook | mcp:<session> | app | cli | ext:<id>, from the connection, never the payload`), and in "How we know
  version 0 works": Criteria to tests, Wrong programs and Dogfooding.
- `packages/record/src/index.ts`: `Connection` (the writer the socket proved), `prepare` (it drops any `writer` in
  the input and stamps `connection.writer`, then validates the event against its kind's schema), `read`, `toJson`.
- `packages/contracts/schemas/session.start@1.json`, `tool.before@1.json`, `hook.request@1.json`: both hook kinds
  fix `writer` as `{"const": "hook"}`; `hook.request@1` requires `pid` and `ppid` and keeps `payload` opaque.
- `adapters/claude-code.facts.json`: SessionStart maps to `session.start`, PreToolUse to `tool.before`;
  `packages/adapters/src`.
- The read-only inputs: `README.md` (the surface under test, the roles table, the plant `writer-from-payload`),
  `helpers.ts`, `tsconfig.json`, `fixtures/`. Copied here unchanged.
- `tests/acceptance/14/AC6-REDRAFT.md` for the form of this file.

Nothing under `packages/hub`, no other worktree, branch or PR, and nothing else in the scratchpad.

## A probe of the base record

A throwaway script in my scratchpad appended `session.start@1` and `tool.before@1` fixtures through
`@deepbuild/record` (built from this checkout) under a connection with writer `app`, then `hook`:

```
session.start@1 app refused schema /writer const at /writer: Send the value the schema fixes.
session.start@1 hook appended {"log_pos":1,"existing":false}
tool.before@1 app refused schema /writer const at /writer: Send the value the schema fixes.
tool.before@1 hook appended {"log_pos":2,"existing":false}
```

So a hub that takes the payload's `writer` and hands it to the record as the connection's writer has the append
refused: the event is never stored with writer `app`, it isn't stored at all. A test that waits to read writer `app`
back would never see it, and one that requires an acknowledgement or a stored event before its assertion would fail
in setup on the plant. The test is built so neither happens.

## The scenario

1. A fresh temp home; `deep hub run` (the installed root, `<home>/.deepbuild`), with `DEEP_HUB_PLANT` for the wrong
   program only. A plant that doesn't start fails the test (`startHub` throws BLOCKED), never passes it.
2. A Claude Code session (`newSession`) and the agent stand-in (`fixtures/agent.mjs`) in its working folder. Two hook
   requests, SessionStart then PreToolUse, each built with `hookRequest(session, event, { writer: 'app' })`, so the
   agent's payload carries `"writer": "app"`, sent by the agent's own child (`agent.hook`), which fills in its true
   `pid` and `ppid`. Nothing about the hook's answer is required: an ack, an error line or a closed connection all
   let the scenario go on.
3. The observation: the log as the hub serves it, `events.read` on a CLI connection, paged from `log_pos` 0, keeping
   the events whose `id` is one of the two requests' IDs, polled for up to 5 s until both are there. If the hub can't
   be read at all (it died), it is stopped by PID if still alive and the same lookup is made in `<root>/ledger.db`
   through `@deepbuild/record`'s `openRecord` and `read`, so a hub that crashes on the refused append still fails at
   the assertion, not in setup.

## Assertions, the sentence each comes from, and the wrong program each catches

| # | Assertion | Source sentence | Wrong program it catches |
|---|---|---|---|
| 1 | For each request (SessionStart, PreToolUse), the log holds an event with the request's ID, and its `writer` is `hook`. The message names the event's ID, the hook event, and either the writer it was stored with or that it is missing from the log (and whether the hook was acknowledged or refused) | AC15: "a hook request whose payload sets `writer: app` is stored with writer `hook`"; design: "Every event's writer comes from this credential, never from a field the caller fills in"; the `writer` column "from the connection, never the payload"; Hook protocol: `id` is the event's identity | A hub that takes `writer` from the payload: at this base the record refuses `app` for a hook kind, so the event isn't in the log and the check fails naming its ID; a hub (or a later record) that does store it as `app` fails the same check naming the ID and writer `app`. Also a hub that drops the request because its payload has an unexpected field, or acknowledges it without appending it |
| 2 | (wrong program) Running 1 against `deep hub run` with `DEEP_HUB_PLANT=writer-from-payload` throws, and the message contains `event <the SessionStart request's ID>` | AC15: "A hub that takes `writer` from the payload fails, naming the event"; design, Wrong programs: "a test proves a criterion only if it fails on a wrong program that compiles and runs" | A test that can't fail: one that reads the writer from somewhere the plant doesn't change, or checks only that a hook was answered |

## Readings where the issue left a choice

- **Where `writer: app` goes.** In the request's `payload`, the agent's hook JSON: the clause says "whose payload
  sets". A top-level `writer` would be a request field the hub doesn't know, refused by `hook.request@1`'s closed
  shape, which is a different criterion.
- **"Stored" is read from the log**, by the event's ID, which is the request's ULID. The test doesn't require the
  hook to be acknowledged or answered: that is other criteria's, and requiring it would make the wrong-program run
  fail in setup.
- **"Naming the event"** is the event's ID, as the README's plant row says; the message also names the hook event.
- **Two kinds, not one.** SessionStart (`session.start`) and PreToolUse (`tool.before`) both fix `writer` const
  `hook`; checking both costs little and the plant's failure names the first.
- **The hook comes from a real agent's child**, so the event is an ordinary, checkable one: the clause is about the
  writer, and an unverified event (AC9) would muddy what the plant changes.
- **The ledger fallback** reads `ledger.db` only once the hub's process is gone, so no second writer opens the record
  while the hub holds it.

## What I left out, and why

- A control hook without `writer` in its payload on the plant. What the plant does then isn't specified, and if it
  stamped nothing the control would fail in setup, not at the assertion.
- Reading the event again after a restart, and `mcp:<session>`, `app` or `cli` writers: other clauses (AC9, AC20,
  the role table).

## Type check

`node node_modules/typescript/bin/tsc -p tests/acceptance/16/tsconfig.json`, after `npm ci` and `npm run build
--workspaces` (before the build it can't resolve `@deepbuild/evidence` from `packages/record/src`): no errors.

## Run on the base

Node v24.22.0, `npm ci`, `npm run build --workspaces`, then
`node node_modules/vitest/vitest.mjs run --root tests/acceptance/16 writer-redraft` (exit 1). Both tests fail in
`startHub` because the base CLI has no `hub` command, which is the expected reason:

```
 RUN  v5.0.5 ~/dev/claude-worktrees/github-issue-16-acaf52/agent-a8eb485b7f0a6ff71/tests/acceptance/16

 ❯ writer-redraft.test.ts (2 tests | 2 failed) 137ms
   ❯ AC15 #16.ffcc7e73 a hook request whose payload sets writer: app is stored with writer hook (redraft) (2)
     × AC15 each hook request carrying writer "app" in its payload is in the log under its ID with writer hook 80ms
     × AC15 (wrong program) a hub that takes writer from the payload fails, naming the event 54ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  writer-redraft.test.ts > AC15 #16.ffcc7e73 a hook request whose payload sets writer: app is stored with writer hook (redraft) > AC15 each hook request carrying writer "app" in its payload is in the log under its ID with writer hook
Error: BLOCKED: the hub didn't start (deep hub run): exit {"code":2,"signal":null}; stderr: Unsupported command. Run deep --help for available commands.

 ❯ startHub helpers.ts:249:11

 ❯ scenario writer-redraft.test.ts:23:15
 ❯ writer-redraft.test.ts:81:28

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  writer-redraft.test.ts > AC15 #16.ffcc7e73 a hook request whose payload sets writer: app is stored with writer hook (redraft) > AC15 (wrong program) a hub that takes writer from the payload fails, naming the event
Error: BLOCKED: the hub didn't start (deep hub run): exit {"code":2,"signal":null}; stderr: Unsupported command. Run deep --help for available commands.

 ❯ startHub helpers.ts:249:11

 ❯ scenario writer-redraft.test.ts:23:15
 ❯ writer-redraft.test.ts:86:28

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed (2)
   Start at  14:08:52
   Duration  445ms (tests 38%, transform 38%, import 24%, worker 1%)
```

Not run: either test against a hub (none exists at this base), so neither the passing run nor the plant's failure
message has been seen live.
