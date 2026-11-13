# Acceptance tests for #2070: a deep mcp connection binds to a session only on what the hub checked

Written blind, from issue #2070 (its text as of November 12, 2026: the body, Scope, the four acceptance criteria, Proof and Depends on), `docs/technical-design.md` and the base commit `1c4d1f0e2`. The implementing agent doesn't edit these files; a dispute goes to this job's blind redraft (design: Dogfooding; AGENTS.md, Proof).

What this job read: in the design, Socket roles and contract versions (One role per credential), the Threats table (Callers posing as others), the Hook protocol and Dogfooding; `AGENTS.md`; the suites `tests/acceptance/26` (its helpers and agent stand-in, imported here), `16` (unverified events and the `mcp` hello) and `55` (the paseo plugin's surface); and at the base, `packages/hub/src/server.ts` (the hello, paseo's lines), `session-state.ts` (`verify`, `mcpHello`), `answer-delivery.ts` (`paseoOwner`), `mcp-operations.ts` (per-call binding, `unbound`), `hookmap.ts` (a paseo line's fields), `mcp.ts` (`deep mcp`'s hello), `log-reads.ts` (`verified` in `events.read`), `packages/paseo/server/plugin.ts` and `hub.ts`, and `adapters/paseo.facts.json`.

## Run

```sh
npm ci && npm run build --workspaces                       # the tests run the built CLI: deep hub run, deep mcp, deep inbox answer
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook   # the hub won't start without it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2070 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2070/tsconfig.json
```

Node 24.22 or newer, macOS (where the OS reports the process at the other end of a Unix socket), `git` and `ps` on the `PATH`. No network, no model, no account. Each test starts its own hub with `../26/helpers.ts`'s `makeHome` and `startHub`: folders `/tmp/dh26-*` (a socket path must fit in 104 bytes), `HOME` there for every process, so the hub's root is `<tmp>/h/.deepbuild` and the real `~/.deepbuild` is never touched. Processes are stopped by PID only (`../26/helpers.ts`, `cleanup`), never by name or port. The file starts real hubs, so the implementer adds `tests/acceptance/2070/` to the unit lane's one-at-a-time list in `scripts/lanes.mjs` (not done here: this job writes tests only). With `--root` here Vitest writes `node_modules/.vite` in this folder; delete it before committing.

## The processes

Every process is real and stands where the criterion puts it. No line or hello names a process falsely, except the hello AC2 forges on purpose: deep-hook's lines name their own PID and their agent's, and the plugin's lines name the daemon they come from as both, as the plugin does, which makes the daemon the agent process of its sessions.

| Process | Started by | What it is |
|---|---|---|
| The Claude Code agent | this test (`../26/helpers.ts` `Agent`, `../26/fixtures/agent.mjs`) | A session's agent process. Its hooks are its children, each sending one hook line with its own `pid` and the agent's PID as `ppid`, as deep-hook's do (`establish`: SessionStart, UserPromptSubmit, PreToolUse). Its own `deep mcp` (`node packages/cli/dist/main.js mcp`) is its child: AC4's first twin. |
| paseo's daemon | this test (`fixtures/proc.mjs`) | The process paseo's plugin runs in. It sends the plugin's lines from its own process, `pid` and `ppid` both its PID, as `packages/paseo/server/hub.ts` does, so it is the agent process of every session it runs. Its agent's MCP server is `deep mcp` with `DEEP_PASEO_BIND=<token>`, started by `proc.mjs provider` (the agent's CLI), which is the daemon's child: the server is the daemon's grandchild, and its parent is not the session's agent process, so it binds by its token alone. AC4's second twin, and AC3's server. |
| The outsider | this test (`fixtures/proc.mjs`) | A sibling of the agents, in no agent's process tree. It sends a line of the plugin's shape from its own process (AC1), and says hello as `mcp` on a connection of its own with `deep mcp`'s fields: `parent` its own real parent by PID and `ps -o lstart=` start time, and `cwd` (AC1 adds `paseo: <its token>`; AC2 replaces `parent` with the Claude Code agent's PID and start). |

## The surface

The tests reach the code only through these. Each is the base's own form, kept; none is invented beyond the readings marked below.

- **The plugin's line** (`packages/paseo/server/plugin.ts` and `hub.ts`): `{v: 1, agent: 'paseo', event: 'agent.turn.before', seq, id, pid, ppid, matched: [], payload: {hook_event_name, session_id, cwd, provider, paseo_agent, bind, turn_id}}`, with `provider: 'copilot'`, a provider `adapters/paseo.facts.json` covers, so the session is the plugin's own and never watch-only. `agent.turn.before` maps to `session.activity` by the facts. The line's `id` is the ID of the event it is recorded as.
- **The hello** (`packages/hub/src/mcp.ts`): `{v: 1, hello: 'mcp', parent: {pid, start}, cwd, paseo?}` after the hub's own first line. **Its reply** is `{role: 'mcp'}` for a connection bound to none and `{role: 'mcp:<session>'}` for one bound to a session. *Relied on here as the base writes it.*
- **`mcp.call`** `{tool: 'deep_claim', arguments}` on that connection; a refused call's `error.code` is `unbound` (`packages/hub/src/codes.ts`).
- **`deep mcp`** spoken to as an MCP client speaks it (`initialize`, `tools/call` of `deep_claim` and `deep_ask`), through `../26/helpers.ts`.
- **The record**, through `events.read` on a `cli` connection holding the control token: a claim's `claim.made` and an ask's `ask.created` name the session they were filed under (`session`); an event recorded as unverified reads `verified: false`. **"The record holds the line as unverified"** is read as: at least one event has the line's `id`, and every such event reads `verified: false`.
- **"Naming both sessions"** (AC3) is read as: at least one event appended after the line (its `log_pos` past the newest one read just before it was sent) whose JSON, its `session` and `data` included, holds both session IDs, such as a reading for one session naming the other, or the unverified event's data naming the session the token stays with. *Reading chosen here.*
- **`deep inbox answer <ask> <option>`** (#24) with #24's confirmation stub, as `../26/helpers.ts` starts the hub.
- **Your ask settings**, the `asks` block of `<home>/.deepbuild/config.json`, written before the hub starts (AC4).

## Criteria

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). All four tests are in `binding.test.ts`; each name starts with its ID.

| # | ID | Criterion | The test | Wrong program it fails on | On the base |
|---|---|---|---|---|---|
| AC1 | `#2070.e45923ea` | A token named only by a line the hub couldn't check binds no connection | paseo's daemon establishes session S with its own line. The outsider sends a line naming S with a token of its own, says hello as `mcp` with that token, and calls `deep_claim` on the connection. The reply's role is `mcp`, the call is refused `unbound`, no claim is filed, and the line's events read `verified: false` | a hub that maps a token from an unchecked line (the base, `paseoOwner`): the hello binds as `mcp:<S>` and the claim is filed under S; the message names S | FAIL, naming S |
| AC2 | `#2070.b951fb7f` | A process outside every agent's process tree, naming a live session's agent process as its parent, binds to none | A Claude Code session S, established by its agent's hooks. The outsider says hello as `mcp` naming the agent's PID and its true start time as its parent, and calls `deep_claim`. The role is `mcp`, the call is refused `unbound`, no claim is filed | a hub that takes the parent from the hello (the base, `mcpHello`): it binds as `mcp:<S>` and files the claim under S; the message names S | FAIL, naming S |
| AC3 | `#2070.f489755d` | A token bound to one session and named again by a line for another session stays with the first | One daemon runs sessions A and B, each established by its own line with its own token. A later line from the daemon for B names A's token. The server paseo's plugin started for A's agent with A's token files a `deep_claim`: under A. The later line reads `verified: false`, and an event after it names both A and B | a hub that rebinds the token (the base, `paseoOwner` overwriting it): the claim is filed under B; the message names A and B | FAIL, naming A and B |
| AC4 | `#2070.21673a03` | The twins still bind, and their `deep_ask` works as before | A Claude Code session's own `deep mcp` (the agent's child), and a paseo session's `deep mcp` started with its token after the session's own checked line carried it. Each one's `deep_ask`, a question recommending nothing, is filed under its own session while it waits and returns `{ask, status: 'answered', answer: 'green'}` once you answer with `deep inbox answer` | a fix that binds neither twin, or breaks the ask | PASS (the twins hold on the base too) |

The issue's Proof asks for each of the three wrong bindings made on the merge base, naming the session, and refused after the change, with both twins still bound: the base is the wrong program of AC1 to AC3, and `BASE-FAILURE.txt` holds its run. No plant is added.

## Readings where the issue leaves a choice

- **AC1's session** is one paseo's plugin owns (a Copilot agent), established by its daemon's line, so the only thing about the outsider's line the hub can't check is its process: its `ppid` is the outsider's, not the session's agent process. A session deep-hook owns would also do on the base, but there the base only relays a plugin line, recording nothing (#55), which would test #55's relay rule as well as this one.
- **AC1's hello** comes from the outsider itself, the process that sent the line, with its own true parent beside the token, as a `deep mcp` it started would send. So neither the token nor the parent can bind it.
- **AC2's hello** names the agent's real start time, read with `ps -o lstart=` as the hub reads it, so only the claim to be its child is false. No PreToolUse is stamped for its `deep_claim`, so the call can bind only through the hello.
- **AC3's binding** is read through the server paseo's plugin started for A's agent, a grandchild of the daemon, not through a raw hello: the Scope says a process outside a session's own agent process tree can't act as that session, so a raw hello from outside the daemon's tree could bind to none on a correct hub for its process alone. The later line comes from the daemon itself about B, already established, so its process checks out and only the token conflicts.
- **"Their deep_ask calls work as before"** (AC4) is #26's `deep_ask`: filed under the bound session while it waits, and returning your answer when it arrives. The question recommends nothing (`recommended: null`), since on the base a taste question with a recommendation goes on with it at once, provisionally, and never waits for an answer. AC4 writes your ask settings first (`<home>/.deepbuild/config.json`, the asks block of #26's done.yaml): paseo's plugin sends no session start, so the hub knows no worktree for a paseo session, and without your settings its `deep_ask` is refused on the base with `BLOCKED: no deadline for taste asks is declared in your settings or the repo's done.yaml`.
- **"Recorded as unverified"** is the record's own mark (`verified: false` in `events.read`) on the event the line became, found by the line's `id`.

## How far these tests were checked

Type-checked with this folder's tsconfig. Run on the base (`BASE-FAILURE.txt`, which also says why two earlier runs don't count: no deep-hook built, then two faults in this suite's AC4): AC1, AC2 and AC3 fail at their binding assertion, each message naming the session (both for AC3); AC4 passes. No fix exists, so the passing side of AC1 to AC3, and their assertions after the first (the `unbound` refusal, the unverified line, the event naming both sessions), are unverified until one does. No processes or temp folders were left after the run.
