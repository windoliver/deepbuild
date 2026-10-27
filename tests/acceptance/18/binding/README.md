# Redraft of #18 AC9: session binding (`AC9 #18.7f5b2ce8`)

The criterion, as issue #18 states it:

> A `deep_ask` from a session's MCP process is filed under that session, and a call from a process whose parent matches no session can read only what belongs to no session, such as the wiki, and can't ask or claim; a hub that shows it another session's open items fails this test

This is a blind redraft. It was written from the issue, `docs/technical-design.md` at the base commit `b7bccf9` (`origin/main`), and that commit's code and suites. The design sections it uses are Socket roles and contract versions ("One role per credential"), Ask, the deep mcp row, and the threat table's "Callers posing as others" row. It never saw the implementation, any diff or the old draft. The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to another blind redraft.

## Run

From the root of a built checkout, with the suite placed at `tests/acceptance/18/session-redraft/`:

```sh
npm ci && npm run build --workspaces          # the tests run the built CLI: deep hub run, deep mcp
npx vitest run tests/acceptance/18/session-redraft
npx tsc -p tests/acceptance/18/session-redraft
```

The suite builds deep-hook itself with `cargo build --locked -q -p deep-hook`, which is a no-op when `target/debug` is current, as #315's and #355's suites do. Cargo alone is given your real `HOME`, so it can find its toolchain.

You need Node 24.22 or newer, `git` and `cargo` on the `PATH`. No network is used. Folders go under `/tmp/dh18b-*` (a socket path must fit in 104 bytes on macOS). `HOME` is a temp folder for the test process and for every child it starts, so nothing reads or writes the real `~/.deepbuild` or `~/.claude`. Processes are stopped by PID only, and only the ones this suite started (`helpers.ts`, `cleanup`). The suite starts real hubs, so it belongs in the one-at-a-time list in `scripts/lanes.mjs`, beside #26's and #355's suites. This job writes tests only and hasn't added it there.

## Surfaces under test

- **deep-hook** is the real binary, `target/debug/deep-hook claude-code <event>`, with the Claude Code hook JSON on stdin. The agent stand-in runs it as a direct child, the way Claude Code runs a hook command, so the hub sees hooks whose parent is the agent process. The payload fields are the corpus's: `session_id`, `transcript_path` (under `<home>/.claude/projects/`), `cwd`, `hook_event_name`, `permission_mode`, plus `source` and `model` on SessionStart, `prompt` on UserPromptSubmit, and `tool_name`, `tool_input` and `tool_use_id` on PreToolUse.
- **`deep mcp`** is `node packages/cli/dist/main.js mcp`, spoken to as an MCP client speaks it: `initialize`, `notifications/initialized` and `tools/call`. It runs either as the agent stand-in's child or by hand, as a child of the test process.
- **`deep hub run`** runs on the temp home (root `<home>/.deepbuild`). The tests read its log only with `events.read` on a `cli` connection holding `control.token`. They read each event's `kind`, `session`, `verified` and `data`.
- **The record and `@deepbuild/wiki`** (their `src/index.ts`) are used only to seed the wiki before the hub starts. Both open the hub's own `ledger.db` and evidence store.

`fixtures/agent.mjs` is a stand-in for a Claude Code process, adapted from #26's. It runs deep-hook and its one `deep mcp` as its children, and decides nothing.

### Tools and fields relied on

| Tool | Sent | Read |
|---|---|---|
| `deep_ask` | `kind: "taste"`, `question`, `options: [{id: "blue"}, {id: "green"}]`, `recommended: "blue"` | `ask.created` with `data.question`, and its `session`. From an unbound process: the tool result's `isError`. |
| `deep_claim` | `task_ref: "task:<tag>X"`, `attempt: 1`, `commit: "abab…"` (40 hex), `scope: "session"` | `claim.made` with `data.task_ref`, and its `session`. From an unbound process: `isError`. |
| `deep_open_item` | `text` | `open_item.opened` with `data.text`, and its `session` |
| `deep_search` | `query: "kestrel ledger"` | `hits[].source` and `hits[].quote`, and the whole value as text |
| `deep_status` | `{}` | `session`, and the whole value as text |

A tool's value is its result's `structuredContent`, or else the JSON in its first text block.

Every deep_* call from session A is preceded by the PreToolUse that Claude Code fires for it: `tool_name: "mcp__deep__<tool>"`, with the call's arguments as `tool_input`, sent through deep-hook. That is how a real Claude Code session calls a server named `deep`.

## Seeded values

| What | Value | Where |
|---|---|---|
| A decision of yours | `decision.created` from the core: `scope: "all"`, `answer: "The kestrel ledger is rebuilt every Sunday night"`, `key` the SHA-256 of `decision <id>`, and an `ask` handle with no ask behind it | the hub's `ledger.db`, before the hub starts |
| The wiki's claim | `wiki:setup#kestrel-ledger`, text "The kestrel ledger is rebuilt every Sunday night", scope `all`, resting on that decision (known `decision`) | learned by `@deepbuild/wiki`'s `learn()` into the learned layer, which feeds the `wiki_claims` and `wiki_text` projections that `deep_search` reads; page `<home>/.deepbuild/wiki/setup.md` |
| Worktrees A and C | fresh git repos with one commit, holding `README.md` and `.deepbuild/done.yaml` (check `unit` runs `false`; the asks block as #26's suite declares it) | `<tmp>/a`, `<tmp>/c` |
| Session A | a random UUID; transcript `<home>/.claude/projects/<cwd with non-alphanumerics as ->/<id>.jsonl` holding one user line | established by SessionStart, UserPromptSubmit and PreToolUse (`Bash`, `ls`), each run through deep-hook by agent A |
| A's open item | `kestrel ledger retry budget for <tag> is still open` (`<tag>` is `q` plus 12 random hex digits) | `deep_open_item` from A's deep mcp |
| A's claim | `task:<tag>A` | `deep_claim` from A's deep mcp |
| A's ask | `Which colour for the <tag> header?` | `deep_ask` from A's deep mcp. It waits, and nobody answers. |
| A's unspent stamp | a PreToolUse for `deep_ask` with arguments `Ship the <tag> release tonight?` | from A's deep-hook, sent just before the hand-started process sends those exact arguments |
| Unbound probes | hand-started: ask `Ship the <tag> release tonight?`, claim `task:<tag>H`; agent C: ask `Which font for the <tag> footer?`, claim `task:<tag>C` | |

The wiki was seeded and checked at the base without a hub: `learn()` writes the claim, its row in `wiki_claims` reads `scope: all`, `state: in force`, and `wiki_text MATCH '"kestrel" "ledger"'` returns it. At the base, `deep_search` serves a call bound to no session from exactly those rows, for claims whose scope is `all` or `repo:*`.

## The tests

Both test names start with `AC9 #18.7f5b2ce8`. Both run `scenario()` and judge it with `problems()`, which lists every violation as a sentence. `holds()` throws them all at once.

**Scenario.**
1. The wiki is seeded and the hub starts.
2. Agent A starts and its `deep mcp` initializes (Claude Code starts its MCP servers at launch). Then its three hooks run through deep-hook. The test is BLOCKED unless a verified `session.start` for A is recorded.
3. A records its open item, its claim, a `deep_search` and its `deep_ask`. Each call is stamped first.
4. A `deep mcp` started by hand in A's own worktree runs the probes, racing A's unspent stamp for its ask's exact arguments.
5. The `deep mcp` of agent C, a process that ran no hooks, runs the same probes.
6. The probes are `deep_search` and `deep_status`, then `deep_ask` and `deep_claim`.

**What must hold** (each item is a `problems()` entry, which names its values):
- A's open item and claim are recorded once each, under A. A's own `deep_search` finds its open item. This is the control: it shows that a leak could be seen.
- A's `deep_ask` is filed exactly once, under A.
- Each unbound process gets a successful `deep_search` holding the hit `wiki:setup#kestrel-ledger`, and a `deep_status` whose `session` is null.
- Neither process's `deep_search` or `deep_status` value contains A's open item text, A's claim `task_ref` or A's session ID.
- Each unbound process's `deep_ask` and `deep_claim` is a tool error, and no `ask.created` with its question or `claim.made` with its `task_ref` is in the log, under any session.

A program that returns nothing fails. With no hits, the wiki hit is missing and A's own search doesn't find its item. With no records, the ask, open item and claim checks fail. If nothing is refused, the ask and claim checks fail.

### The wrong program

| Name | What the plant does | How the test fails on it |
|---|---|---|
| `unbound-reads-all` | Read from `DEEP_HUB_PLANT`. A call bound to no session is served as if it were bound to every session: `deep_search` reads every session's open items and verdicts, and every claim whatever its scope. | `problems()` reports that each unbound process "was shown session A's (`<id>`) open item "kestrel ledger retry budget for `<tag>` is still open" by deep_search". The wrong-program test asserts that the failure contains `open item "<that text>"`. |

The tests set the plant in the environment of `deep hub run`, of both agent stand-ins (so of their hooks and `deep mcp`) and of the hand-started `deep mcp`, so the plant may live on either side. A hub that doesn't know the name refuses to start, and the test fails BLOCKED. The base already lists `unbound-reads-all` (#26) with this meaning, in `packages/hub/src/wire.ts` and `core.ts` (`find`).

## On the base

Not run. The tests need the built CLI and the deep-hook binary, and this job may not build the checkout. `tsc -p` of the suite against the base's sources reports no error in these files. The only errors it reports are base packages that resolve `@deepbuild/asks` to its unbuilt `dist`. The wiki seeding was run at the base, as above. The agent stand-in was run with a fake hook binary and a fake MCP server, and both were its children, with `ppid` equal to its PID.

**I expect both tests to pass at the base, not fail.** At `b7bccf9`, #26's hub already does each thing this criterion needs:
- It binds a `deep mcp` at its hello to the one live session whose checked hooks came from its parent, by PID and start time (`Core.mcpHello`).
- It binds a call with no such session through an unspent PreToolUse stamp only when the stamp's session has that same parent (`Core.bind`).
- It serves `deep_search` and `deep_status` to a call bound to no session from the wiki at scope `all`/`repo:*`, decisions and the spec only (`Core.find`, `search.ts`).
- It refuses every other tool unbound.
- It already has the `unbound-reads-all` plant.

So at the base this suite is regression protection for #18's adapter, which carries real Claude Code hooks through deep-hook. It can't be shown failing for a reason at the base. If it does fail at the base, the failure is a finding about the base or this suite, not proof of #18. The wrong-program test is the proof that the check can fail.

## Readings where the criterion leaves a choice

- **"A process whose parent matches no session"** is tested twice: by hand, under a parent that is the test process, and as the child of a real agent process that ran no hooks. The hand-started one runs in A's own worktree, so a hub that binds by folder fails. It also calls while A holds an unspent PreToolUse stamped for its exact arguments, so a hub that binds a stamp without checking the caller's parent fails. A parent with a reused PID but a different start time can't be produced reliably on a test machine, so it isn't tested (see below).
- **"Can read only what belongs to no session, such as the wiki"** is read as both of these:
  - The wiki's claim at scope `all` is found.
  - No `deep_search` or `deep_status` value contains anything of session A's: its open item, its claim or its session ID.

  Decisions and the project's spec also belong to no session (design: "such as the wiki, decisions and the project's spec"). They aren't asserted present, only not forbidden.
- **"Can't ask or claim"** is held as a refused tool result plus nothing filed. `deep_wait`, `deep_open_item`, `deep_evidence` and `deep_run` are outside the criterion's words and aren't probed.
- **"Filed under that session"** is the `session` of the `ask.created` event that `events.read` returns.
- **The order of start-up** follows a real Claude Code launch: the session's `deep mcp` is initialized before its SessionStart hook. A hub that fixes a `deep mcp`'s binding before its session's hooks arrive must still file A's calls under A. A's calls are each stamped, as Claude Code stamps every MCP call.

## What couldn't be tested as written

- **The parent's start time** ("checked by the parent's start time", from the issue's scope) needs a process whose PID matches a session's parent but whose start time doesn't. Forcing PID reuse on a shared machine isn't reliable, and a hand-written `mcp` hello that lies about its parent is the socket's peer-check question, not this criterion's. So it's untested here.
- **A real Claude Code process** isn't used. The agent is a stand-in that carries Claude Code's hook payloads through the real deep-hook. The issue's Proof (a recorded interactive session via #48's harness) is out of this job's scope.

## Files

- `binding.test.ts`: the two tests, the scenario and `problems()`.
- `helpers.ts`: temp homes and cleanup by PID, the deep-hook build, worktrees, `seedWiki`, the hub, `events.read`, the MCP client, `McpProcess` and `Agent`.
- `fixtures/agent.mjs`: the agent stand-in.
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
