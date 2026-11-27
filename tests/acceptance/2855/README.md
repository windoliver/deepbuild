# Acceptance tests for #2855: the MCP revision with no handshake

Drafted blind, before any implementation, from issue #2855 (its report, Scope including the Values bullet that states
`ttlMs: 0` and `cacheScope: "private"`, and the seven acceptance criteria, read with `gh issue view`), the design's
sections the issue links (Five ways in, all onto the same core; What each agent gives us, and the limits we design
around; Threats, and what stops each one; Before each command) and its Dogfooding paragraph, `AGENTS.md`, the public
MCP `2026-07-28` pages on discovery, versioning and caching, and the code at the base commits `345c9ae26` (first
draft) and `a75e1c56f` (this redraft), each origin/main then. No other branch, worktree, pull request or diff was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

**This is the redraft** of the first draft (commit `884442856`, written at base `345c9ae26`), by the same blind job,
at the new base `a75e1c56f` (origin/main). The first draft was right and failed on its base at each assertion for the
expected reason; main has since adopted rules it broke, so it is redrafted with the same tests, assertions, failure
lines and criterion tags:

- **No comments** in the code files (docs/adr/0001, `scripts/comment-ratchet.mjs` judges a new suite from zero). Every
  comment is gone; what a reader needs is in this README (The surface; Notes the code no longer carries) or in names and
  test titles. The criterion tags, which the draft built from an `AC` map in `helpers.ts`, are now written literally
  in each test file's `describe` and `it` titles; the titles as run are unchanged.
- **`lane.json`**: the suite says how it runs (below, Run).
- **Repo rules**: `BASE-FAILURE.txt` writes every home folder as `~`, and the draft's copy of #39's fake codex, whose
  fake API key trips the secrets rule, is gone: `helpers.ts` copies `tests/acceptance/39/fixtures/fake-codex.pl` into
  each scratch home's `bin/codex` at run time, with its `fake-codex.json` beside the copy, so nothing is written into
  #39's folder. The lanes' checkouts are `git archive`s of the whole tree, so the file is there for them too.

The issue's criteria and its Scope (the Values bullet: `ttlMs` 0, `cacheScope` "private") are unchanged since the first
draft, and the sources the suite reaches (`packages/hub/src/mcp.ts`, `mcp-servers.ts`, `holds.ts`,
`codex-settings.ts`, `crates/deep-hook/src/actions.rs`, `packages/reading/src/tools.mts`, `mcp.handshake@1.json`,
`deep-mcp-30d` in `benchmarks/budgets.json`, and #39's fake codex) are the same at `a75e1c56f` as at `345c9ae26`.

At the base I read, for the surfaces: `packages/hub/src/mcp.ts` (`deep mcp`, `deep mcp actions`; the client's name
taken at `initialize`, `answerWaitMs`: 55 s, or Codex's `tool_timeout_sec` for a Codex client),
`crates/deep-hook/src/actions.rs` and `main.rs` (`deep-hook mcp actions`; the hub's address from
`$HOME/.deepbuild/config.json`), `packages/reading/src/tools.mts` (`node tools.mjs <socket>`, HTTP to the reading job's
socket), `packages/hub/src/paths.ts` (`hub.address`), `packages/hub/src/mcp-servers.ts` (the lister: `initialize` at
`2025-06-18`, then `tools/list`, 10 s, a refusal gives no list), `packages/hub/src/holds.ts` (`listed` at each session
start writes `mcp.tools_listed`; `heldTool` runs a tool of a server with no list unheld), `packages/hub/src/core.ts`
(the listing is started from a SessionStart hook), `packages/hub/src/codex-settings.ts` (deep_ask says "still
waiting" at `tool_timeout_sec` less 5 s), `packages/contracts/src/canonical.ts` (the digest is SHA-256 of RFC 8785
text), `packages/contracts/schemas/mcp.handshake@1.json` (the held list, read here as data), `benchmarks/budgets.json`,
and suites `2854/` (the four servers over stdio, house style), `39/` (Codex's wait, its daemon, `deep setup` with a fake
codex) and `321/` (the fake MCP server, Claude Code sessions through deep-hook, held tools).

## Run

```sh
npm ci && npm run build --workspaces                       # deep mcp, deep mcp actions, the hub, the reading tools
node scripts/throttle.mjs build -- cargo build -p deep-hook  # deep-hook's mcp actions and the agents' hooks
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2855 --testTimeout=600000
```

Any machine (the issue's "Runs on"). Every test uses its own temp home under `/tmp/dh2855-*` (short, for Unix socket
paths), with no fixed port: hubs and listeners are Unix sockets in that home, so files may run in parallel. Every
process a test starts is stopped by its own PID when the test ends; nothing is stopped by name or port. A server or
binary that isn't built throws `BLOCKED: <server> isn't built: <command>`. AC4 runs in real time, about two minutes
(the hub's "still waiting" at 115 s); AC5 about a minute; the rest take seconds.

`lane.json` runs the folder alone for `binary`: `ac1` to `ac3` run deep-hook's `mcp actions` from this checkout's
`target/`, and `ac4` to `ac6` start a hub, which runs deep-hook from `target/`, and run each session's hooks through
it, so a sibling's cargo build would rewrite a binary under them. It names `ac6-lists-handshake.test.ts` timed (it
holds a listing to 10 s by the fake server's clock, which load stretches) and `ac4-codex-wait.test.ts` slow (over two
minutes of real time).

## The surface

- **The four servers**, each a fresh process driven over its stdio by raw newline-delimited JSON-RPC lines:
  `node packages/cli/dist/main.js mcp`, `... mcp actions`, `target/{debug,release}/deep-hook mcp actions` (the newer),
  and `node packages/reading/dist/tools.mjs <home>/r.sock`. Each home's `.deepbuild/config.json` names the hub at
  `<home>/h.sock`. The stand-in client sends no `initialize`; each of its requests carries `_meta` with
  `io.modelcontextprotocol/protocolVersion`, `.../clientInfo` and `.../clientCapabilities`. A handshake session of
  the same server (initialize at the newest held revision, `2025-11-25`) is the comparison.
- **A counting listener** (AC3) at the hub's address (for the reading tools, the reading job's socket): it speaks the
  hub's line protocol as far as a call needs (a greeting, the role after hello, a result per `mcp.call`, a refusal of
  `mcp.tools`), or HTTP for the reading tools, and counts the tool calls that reach it.
- **The hub** (`deep hub run`, AC4 to AC6) in a scratch home, its record read back through `events.read`
  (`mcp.tools_listed`, `ask.created`), with `deep setup` (AC4) run against a fake `codex` (#39's
  `tests/acceptance/39/fixtures/fake-codex.pl`, copied into the scratch home's `bin/codex`) and Codex's `config.toml` set to `tool_timeout_sec = 120`.
- **The agent stand-in** (`fixtures/agent.mjs`): one process per session, the parent of that session's
  `deep-hook codex <event>` or `deep-hook claude-code <event>` runs and of its one `deep mcp`, as Codex and Claude Code
  are, so the hub binds the server's calls to the session. It decides nothing.
- **The fake servers** (`fixtures/fake-server.mjs`), third-party stdio servers in Claude Code's user config
  (`~/.claude.json`), logging each request `{pid, method, id, version, tool, at}`: `modern` refuses `initialize`,
  answers `server/discover`, and takes `tools/list` and `tools/call` only with `2026-07-28` in `_meta`; `minus32601`
  is a handshake server answering `server/discover` with -32601; `silent` is a handshake server that never answers it.
- **`benchmarks/budgets.json`** (AC7).

### Notes the code no longer carries

- Every check collects its failures as lines, so a test fails at its one assertion, each line naming what it is
  about; no test imports the code under test.
- Temp homes sit under `/tmp` because a Unix socket path must fit in 104 bytes on macOS. `cleanup` sends SIGTERM to
  each process the test started, SIGKILL after 3 s, closes its listeners and removes its folders. Children never
  inherit `DEEP_*`, `CLAUDE*`, `XDG_*`, `OPENAI_*`, `CODEX_*`, `ANTHROPIC_*`, `GH_*`, `GITHUB_*`, `GIT_*` or
  `NODE_OPTIONS`, so no agent bills an account and no process finds another hub.
- `HELD` is `mcp.handshake@1.json`'s `protocolVersion` enum, read as data (`[]` if unreadable); `SUPPORTED` is
  `2026-07-28` then those. `CLAUDE_COVERED` and `CODEX_COVERED` are the newest versions `adapters/*.facts.json`
  cover, so no session is watch-only.
- The counting listener (AC3) answers `hello` with the role `mcp`, each `mcp.call` with a result, and any other request
  (`mcp.tools` among them) with `unavailable`, so the server lists its own build's tools; for the reading tools it is
  an HTTP server counting each `POST /call`.
- The agent stand-in (`fixtures/agent.mjs`, after #39's `daemon.mjs` and #321's `agent.mjs`) reads one JSON command a
  line and answers by `n`: `{op: "hook", binary, args, payload, cwd, timeoutMs}` runs the hook with the payload on
  stdin and answers `{code, signal, stdout, stderr, ms, ended}`; `{op: "mcp", argv, line, timeoutMs}` starts the MCP
  server at its first such command, writes the line and answers `{reply, pid, ms}`; `{op: "exit"}`, SIGTERM or the end
  of stdin stops its children.
- The fake server (`fixtures/fake-server.mjs`, after #321's `mcp-server.mjs`) is `node fake-server.mjs <mode> <name>
  <tools.json> <log.jsonl>`. `tools.json` (`{version, tools}`) is read again at each request, so a test updates the
  server by rewriting it. `modern` answers a request with no `_meta` version -32600 and another version -32022.
  An allowed call is run on the fake server as each era's client would (`FakeServer.runCall`).
- AC4: the second Codex thread starts 10 s after the first, so the two session starts don't share the hub's first
  second; `deep mcp` connects at its first call and keeps the connection, so each thread opens it with `deep_status`
  calls, a second apart, for up to 90 s, and one that never connects is BLOCKED with the load reading.
- AC5: each listing round waits up to 45 s for `tracker`'s listing and 5 s more for `forge`'s; an ask holding
  `delete_repo` gets 60 s.
- AC6: the lister's process is the only one that starts `refuser` and `mute`, so each log's first process is the
  lister's. The test waits up to 30 s for both listings (the 10 s is judged from the log's own times); the room is
  for the hub's own work under load.
- AC7: `BASE` is `deep-mcp-30d` as it stands at the merge base (`345c9ae26` and `a75e1c56f` alike).

## The tests

| File | Criterion | Tests | What it asserts |
|---|---|---|---|
| `ac1-discover.test.ts` | `#2855.a98dc587` | 4, one per server | `server/discover` (with the stand-in's `_meta`, as a fresh process's first line) is a result whose `supportedVersions` is `2026-07-28` first and then exactly the held revisions; whose `capabilities` has a `tools` object, and a `resources` object when the server's handshake capabilities have one; whose `_meta["io.modelcontextprotocol/serverInfo"]` is the name and version its handshake's `serverInfo` gives. Lines read `<server>: ...` |
| `ac2-no-handshake.test.ts` | `#2855.2b6ba6a3` | 4, one per server | With no initialize: `tools/list`'s result has `resultType: "complete"`, `ttlMs: 0`, `cacheScope: "private"` and the handshake session's tools byte for byte in their order; `tools/call` of the first tool with `{}` has `resultType: "complete"` and otherwise the handshake session's result (hub, or reading job, unreachable); `ping` is -32601; for a server with resources, `resources/read` of `deep://codes/no_such_code_2855` is -32602, and -32002 in the handshake session. Lines name the server and the method |
| `ac3-unheld-version.test.ts` | `#2855.215d37df` | 4, one per server | With the counting listener up: a `tools/call` of the first tool naming `2099-01-01` in `_meta` is -32022, `data.supported` the server's versions (`2026-07-28` and the held ones) and `data.requested` `2099-01-01`; the listener's count stays as it was 1.5 s later; then the same call naming `2026-07-28` raises the count by one, so the count is shown to count. Lines name the server and `2099-01-01` |
| `ac4-codex-wait.test.ts` | `#2855.ed6c227c` | 1 | With `tool_timeout_sec = 120`, two Codex threads at once: a `deep mcp` that was sent `initialize` naming `codex-mcp-client`, and one that never was and gets the name only in the call's `_meta`. After PreToolUse for `mcp__deep__deep_ask`, each deep_ask (a choice no one answers) is answered "still waiting" no sooner than 110 s. Lines name the client and "the wait for deep_ask" |
| `ac5-lists-modern.test.ts` | `#2855.287aa5df` | 1 | `forge` (modern) and `tracker` (handshake, -32601 to the probe) start with `list_issues` and `create_issue`. After a session start, each has an `mcp.tools_listed` with those two tools and their digests in order, and forge's says it took no handshake. Both add `delete_repo`; after a second session start, `mcp__<server>__delete_repo` is not let through by PreToolUse, an authority ask naming the server and `delete_repo` is raised, and the fake server gets no `tools/call` for it. A call let through is run on the fake server, as Claude Code would. Lines name the server, and `delete_repo` for the call |
| `ac6-lists-handshake.test.ts` | `#2855.61e68686` | 1 | `refuser` (-32601 to the probe) and `mute` (never answers it): in each server's log the lister's first request is `server/discover` and an `initialize` follows; `mcp.tools_listed` holds its two tools with their digests; `mute`'s listing takes at most 10 s from its first request to its last `tools/list`. Lines name the server |
| `ac7-budgets.test.ts` | `#2855.afd330b4` | 1 | `deep-mcp-30d` is still in `budgets.json` with the merge base's command (`node benchmarks/mcp.mjs`), a margin no wider than 0.5 and no limit raised |

### Which plant each test catches

The implementer writes the twins (AGENTS.md); these are the plants the criteria name and where they fail:

- **AC1**: the merge base itself: each server answers -32601, failing at "`<server>`'s answer to server/discover",
  the line `<server>: server/discover is answered error -32601 ...`.
- **AC2**: a server that leaves `resultType` off (in `tools/list`'s result or the tool call's) fails at "`<server>`
  served with no handshake", the line `<server>: tools/list's result has resultType undefined, not "complete"` (or
  `tools/call of <tool>'s ...`). The base fails there too, and on `ping` answered `{}` and `resources/read` -32002.
- **AC3**: a server that serves the `2099-01-01` request (the base: it ignores `_meta`, forwards the call, and the
  listener counts it) fails at "`<server>` answers 2099-01-01 without the hub", the lines
  `<server>: a tools/call naming 2099-01-01 is answered result ..., not -32022` and `... reached the hub: its count ...
  went from 0 to 1`.
- **AC4**: a server that reads the client's name only at `initialize` (the base) waits its own 55 s, then answers that
  the hub is unreachable (`unavailable`): fails at "each client's wait for deep_ask", the line
  `a client that names itself codex-mcp-client only in its requests' _meta: the wait for deep_ask ended after 55.x s
  with ... unavailable ..., not the hub's "still waiting" at 115 s`. The initialize-named thread holds on the base.
- **AC5**: the merge base's lister (initialize only; forge refuses it, no list) fails at "forge listed with no
  handshake, and delete_repo held as tracker's is", with `forge: the record holds no mcp.tools_listed for it, ...` and
  `forge: the call to delete_repo ran with nothing held ...` and `forge: the fake server got 1 tools/call request(s)
  for delete_repo`. tracker's lines stay empty on the base, so the comparison holds there.
- **AC6**: a lister that waits its whole 10 s limit on the probe lists `mute` not at all: `mute: the record holds no
  mcp.tools_listed for it` and `mute: after the probe the lister sent no initialize`. A lister that takes -32601 as the
  end does the same for `refuser`. The merge base (no probe) fails with `<server>: the lister's first request is
  "initialize", not the server/discover probe`.
- **AC7**: a `budgets.json` whose `deep-mcp-30d` margin is wider than 0.5, a limit raised, or the command changed
  (as #2854's `budgets-widened`).

## Readings where the issue leaves a choice

- **`ttlMs` and `cacheScope`** are asserted as the issue's Scope now states them, `0` and `"private"`, on
  `tools/list` (AC2 names it). `server/discover`'s, `resources/list`'s and `resources/read`'s are in Scope but no
  criterion names them (Not tested).
- **"Each held handshake revision after it"** (AC1): after `2026-07-28`, exactly the revisions of
  `mcp.handshake@1.json`, in any order. **"Its name and version"**: the `name` and `version` its handshake's
  `serverInfo` gives. **"Resources where it has them"**: where its handshake's capabilities name `resources`.
- **The stand-in's `_meta`** (AC2 to AC4) uses the spec's keys: `io.modelcontextprotocol/protocolVersion`,
  `io.modelcontextprotocol/clientInfo` (`{name, version}`), `io.modelcontextprotocol/clientCapabilities` (`{}`).
- **"A tool call returns its result"** (AC2): no hub listens, so the result is the unreachable one; it must equal the
  handshake session's result once `resultType` is set aside.
- **"A page that doesn't exist"** (AC2): `deep://codes/no_such_code_2855`, a well-formed code page no code has; the
  reading tools have no resources, so their test has no resources check.
- **"The hub's count of calls from that process"** (AC3): the tool calls that process sends to the hub's socket, counted
  by a listener at the address its home's config names (the reading tools: the job socket they are started with). No
  hub-side counter exists at the base, and a real hub would refuse an unbound process's call without counting it. The
  request sent is the one that would reach the hub, a `tools/call`. `data.supported` is compared as a set with
  `2026-07-28` and the held revisions.
- **"Holds a deep_ask until the hub's still waiting"** (AC4): the reply says "still waiting" and comes no sooner than
  110 s (the hub's 115 s less 5 s for timers and load). The ask is a choice with no recommended option: one with a
  recommended option is answered `provisional` at once on main (`mcp-operations.ts`), so it would never wait. Before
  the turn, each thread's `deep mcp` opens its hub connection with `deep_status` calls (carrying `_meta` for the
  `_meta` client), retried for up to 90 s: its connect has one second, which `ps` for the parent's start can use up at
  load 50 to 70, and a call that never connects is BLOCKED rather than read as the wait. The second thread starts
  10 s after the first.
- **"Says it took no handshake"** (AC5): the field isn't named. Read as: beside `tools` and `server`, the event holds
  the value `"2026-07-28"`, or a field whose name has "handshake" set to `false`, or a string saying "no handshake" /
  "without a handshake" / "handshakeless". An implementer who names it otherwise should take it to a redraft.
- **"Waits for your approval as a handshake server's added tool does"** (AC5): `tracker`, a handshake server with the
  same update, is run beside `forge`; for both the call must not be let through, an authority ask naming the server
  and `delete_repo` must exist, and the fake server must get no `tools/call` for it. Whether deep-hook denies at once
  naming the ask or waits is not asserted.
- **"Listed as on the merge base, by tool and digest"** (AC5, AC6): the event's `tools` as `{name, digest}` in the
  fake's order, the digest SHA-256 of the input schema's RFC 8785 text, as `mcp-servers.ts` computes it at the base.
- **"Opens with server/discover first"** (AC6): the criterion's "answers server/discover with -32601" and "never answers
  the probe" presume the probe is sent, and Scope says the lister sends it first, so the lister's first logged request
  must be `server/discover`. This is where the base fails AC6. **"Within 10 s"**: from the fake's first logged request to
  its last `tools/list`, by the fake's own clock. The 2 s probe wait is "(drafted)" and not asserted.

## Open points

- The field by which `mcp.tools_listed` "says it took no handshake" (above). `mcp.tools_listed@1` and `@2` close
  their `data` (`additionalProperties: false`), so recording it is a contract change; a listing the record refuses is
  no listing, and AC5 and AC6 then fail with "the record holds no mcp.tools_listed".
- Whether a `server/discover` result should also carry `resultType`, `ttlMs` and `cacheScope` in AC1 (Scope says yes;
  the criterion doesn't, so it isn't asserted).

## Not tested

- **AC7's measurement.** Instructions and peak memory of `deep-mcp-30d`, and the "at most 50 ms longer" of listing a
  handshake server that answers the probe at once (drafted), are the local preflight's perf lane on the reference Mac,
  against the merge base. `ac7-budgets.test.ts` holds only what a checkout shows, and **passes on the base by its
  nature**; a twin (`budgets.json` with `deep-mcp-30d`'s margin wider than 0.5, or a limit raised) proves it.
- `ttlMs`/`cacheScope` on `server/discover`, `resources/list` and `resources/read`; `resultType` on other methods; a
  request with neither a handshake nor a version (Scope, "answered as today"); a handshake session under the revision
  it settled (#2854's suite holds that). No criterion names them.
- The lister's "revision's own version error" path (a probe answered -32022), and the whole listing's 10 s for a modern
  server; not named by a criterion.

## On the base

`BASE-FAILURE.txt` is the whole suite's run at `a75e1c56f` on 2026-11-27 (macOS 27.2.1 arm64, Mac18,1, 12 cores,
Node 24.22.0; 1-minute load 68 at the start, 81 at the end): 15 fail, 1 passes, in 122 s. Every failure is at its
assertion, for the reason its criterion names:

- AC1 (4): each server answers `server/discover` -32601, the line naming the server.
- AC2 (4): `tools/list` and the tool call have no `resultType` (and no `ttlMs`, `cacheScope`), `ping` is answered `{}`,
  and `resources/read` of the missing page is -32002 for the three servers with resources; each line names the server
  and the method.
- AC3 (4): the `2099-01-01` tools/call is served (result, not -32022) and reaches the listener (count 0 to 1); lines
  name the server and `2099-01-01`.
- AC4 (1): the thread named only in `_meta` is answered `unavailable` ("it did not answer in time") at 55.0 s; the
  thread named at initialize holds until the hub's "still waiting", so only the `_meta` line is there.
- AC5 (1): `forge` has no `mcp.tools_listed`, its `delete_repo` is allowed and the fake server gets one `tools/call`
  for it; `tracker`, the handshake comparison, is listed and its `delete_repo` held, so its lines are empty.
- AC6 (1): both servers' first request from the lister is `initialize`, not the probe; both are listed by tool and
  digest (no digest lines), which confirms the suite's digest matches the hub's at the base.
- AC7 (1) passes (Not tested, above).

Checked outside the checkout, in an APFS clone of it under the session's scratch folder, since deleted:

- **A minimal right lister** (`packages/hub/dist/mcp-servers.js`: `server/discover` first; a result or -32022 lists
  with `_meta`; any other error, or 2 s of silence, sends initialize; `handshake: false|true` on the listing, with that
  field added to the clone's `mcp.tools_listed@1/@2` schemas, which are closed): AC5 and AC6 pass. The same lister
  planted to wait its whole limit on the probe fails AC6 naming `mute` (no initialize, no listing, never reached
  tools/list); planted to take -32601 as the end, it fails AC6 naming `refuser`.
- **A minimal right `deep mcp`** (`packages/hub/dist/mcp.js`: discover, `_meta` version check with -32022, the name
  from `_meta`, `resultType`, `ttlMs: 0`, `cacheScope: "private"`, `ping` -32601, missing page -32602): AC1, AC2 and
  AC3 pass for `deep mcp` and `deep mcp actions` (the two servers it serves; deep-hook's and the reading tools', left
  as on the base, fail as above), and AC4 passes. Planted to leave `resultType` off, AC2 fails for `deep mcp` naming
  `tools/list` and `tools/call of deep_ask`. The AC4 plant (the name read only at initialize) is the base, above.

Nothing ran on Linux.
