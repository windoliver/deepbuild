# #3243, second criterion: a provisional ask still goes on at once (blind redraft)

A blind redraft of the test for issue #3243's second criterion, written from the issue, the design (An ask, and your
answer getting back; Asks stay current; A question holds the send-back) and the base tree only. It replaces an earlier
draft that also required the ask's row in `inbox.read` to read `entry: 'needs_you', waits_on: 'you'` at once. Neither
the criterion nor the design asks for that (below, What it doesn't require), so this draft doesn't.

| Criterion | Test | Twin (wrong program) | How the test fails on it |
|---|---|---|---|
| `#3243.48cf467d` A provisional ask still goes on at once | `provisional.test.ts`: `#3243.48cf467d a choice with a recommendation, in a session no work run started, comes back from deep_ask provisional with the recommended option, at once, and the ask stays open` | `never-provisional` (`twins/never-provisional/lines.json`): the hub's `deep_ask` sets `provisional = false` for every ask, so a choice with a recommendation waits on you | deep_ask replies "still waiting" (the hub runs with a 30 s MCP tool timeout, so it says so at once), and the test fails at `deep_ask returns provisional with the recommended option`, the reply's `{status, answer}` not `{status: 'provisional', answer: <sqlite id>}` |

The twin is kept as its wrong lines (tests/acceptance/1832, The line form) and named in `twins.json`.

## What the test runs

All real components, from the built tree, through `../25/routes/helpers.ts` (imported, not copied):

1. A temporary home with stand-ins for `launchctl`, `systemctl` and `claude` on PATH (the only boundaries mocked:
   the OS service managers and the Claude Code binary, which this repo doesn't own).
2. `deep hub run` in that home, started with `noAskWait` (`MCP_TOOL_TIMEOUT=30000`), then `deep setup` into it,
   which writes DeepBuild's entries into the home's `~/.claude/settings.json`; a missing `target/debug/deep-hook` is
   built with cargo.
3. #25's Claude Code stand-in for one session: SessionStart and UserPromptSubmit run DeepBuild's hook entries as
   Claude Code does, so the hub knows the session from hooks alone. No `deep work` ran, and the test checks that the
   record holds no `work.run` event (BLOCKED otherwise).
4. The agent's `deep_ask` through the session's own `deep mcp`: `{kind: 'choice', question, options: [redis, sqlite],
   recommended: sqlite}`, after its PreToolUse. The recommended option is the second, so a hub that goes on with the
   first option or a default is caught.

## How the test decides

- **It replies.** deep_ask must reply within 90 s at most (otherwise it waits on you: FAIL), and its reply is no error.
- **Provisional with the recommended option.** The reply's `{status, answer}` is `{status: 'provisional', answer:
  <sqlite's id>}` (#84), and its `ask` is an `ask:<ULID>` handle.
- **The ask stays open.** In the record (`events.read`), the `ask.created` event with that handle's ID is this
  session's, with this question, `provisional: true` and `recommended: <sqlite's id>`, and no closing event
  (`ask.answered`, `ask.defaulted`, `ask.escalated`, `ask.cancelled`, `ask.superseded`, `ask.moot`,
  `ask.unanswerable`) names it. `inbox.read` lists it among its asks with `closed_at: null`.
- **At once.** The reply came within 20 s of the `tools/call`. A reply that is right but late is INCONCLUSIVE (a skip
  that says so, with the load) on a machine loaded past its core count, and a FAIL on one that isn't. This timing
  check comes last, so a wrong reply always fails at its own assertion first.

## What it reads

deep_ask's JSON-RPC reply (structured content, else the first text block's JSON); `events.read` and `inbox.read`
over the hub's socket with the control token; the machine's 1-minute load. Nothing the agent says counts.

## What it doesn't require

- **Needs you at once.** The design shows asks "in batches, a few visits a day", at once only when a deadline would
  pass before the next batch (Every ask ends). A provisional ask lets work go on while you decide, so nothing in the
  criterion or the design makes it skip the batch: on this base `inbox.read` lists it `queued`, `outcome:
  'unanswered'`, `closed_at: null`, with no Needs-you row yet. The test requires only that it is open (`closed_at:
  null`, no closing event), not its queue state or a row's `entry` / `waits_on`.
- **A held stop.** The design says a provisional choice holds no send-back; that is #3243's first criterion's ground,
  not this one's.

## Running it

With the workspaces built (`npm run build --workspaces`) and cargo on PATH:

```
npx vitest run --root tests/acceptance/3243-redraft provisional.test.ts
```

The before lane applies `twins/never-provisional/lines.json` to `packages/hub/src/mcp-operations.ts` and runs the
same file; it must fail at the status assertion.
