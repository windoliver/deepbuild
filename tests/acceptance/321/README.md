# Acceptance tests for #321: authority at PreToolUse

No "proceed" covers a push, merge, dispatch, send or delete, and new or changed MCP tools wait for your approval.

Written first, blind, by a job that never saw an implementation of #321. Sources:

- **The issue**: its text as of 2026-10-28T04:55:55Z (`updatedAt`): Scope, the 5 checkbox criteria, Proof and
  Depends on.
- **The design**, `docs/technical-design.md`:
  - [An ask, and your answer getting back], all of it. That covers Questions at the stop with "A 'proceed' never
    covers a call that needs authority", A question holds the send-back, Every ask ends, and Where they reach you.
  - [Decided]: "Requests that name an action", "Answers from the terminal", "Ask deadlines and defaults" and "MCP
    calls and the guards".
  - [Before each command]: the guard engine, MCP tool classes, and the hints that only raise a class.
  - The threats row "MCP tools the guards can't see".
  - Hook protocol (deep-hook and the hub): acknowledgement, `hold_until_ms`, late calls spooled.
  - Socket roles, and the Agents page paragraph (a server's recorded tool list, one ask per server update).
- **Other issues, for context only**: #318 (asks core, done), #304 (guard engine, done), #84 (sorting questions,
  open), #18 (Claude Code adapter, done), #22 (parent), #319 and #320, and #148 (MCP servers synced to each agent,
  open).
- **The base commit**: `debda22` (origin/main). The base code read:
  - `packages/hub/src/`: `server.ts` (`hook`, `holdFor`, `reply`, the test clock), `core.ts` (`answer`, `inbox`,
    the asks core's tick), `mcp-servers.ts` (`countMcp`, `sourceOf`, the `DEEP_HUB_TEST_MCP_TOOLS` stand-in),
    `guards.ts`, `plant.ts`, `session-facts.ts` (`loadsOf`), `hookmap.ts`, `inbox.ts`, `confirm.ts`,
    `claude-settings.ts` and `setup.ts`.
  - `packages/asks` (`sources.json`: `effect.push`, `effect.merge`, `mcp.tool_changed`; the drafted deadlines).
  - The ask schemas `ask.created@3` and `ask.defaulted@1`.
  - `adapters/mcp-servers.facts.json`, `adapters/claude-code.facts.json` (`hookTimeouts`, `continuation`) and
    `crates/deep-hook` (`main.rs`, `matcher.rs`, `default-rules.json`).
- **Sibling suites, for their conventions**: tests/acceptance/304, 318, 320, 24, 667, 25/routes, 18/mapping and
  18/session.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/321 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/321/tsconfig.json
```

- Each test starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
  beside #304's and #18's. The implementer adds it.
- Every test makes its folders under `/tmp/dh321-*`, because a Unix socket path must fit in 104 bytes on macOS. It
  sets `HOME` to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or
  `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`, `stopHub`), never by name or port.
- No network, no model, no `claude` binary. A child never inherits this process's billing keys or its `DEEP_*`,
  `GIT_*`, `XDG_*` or `CLAUDE*` settings.
- Time: each test takes 1 to 4 minutes on a correct hub. AC5 takes longest: it waits for every hold to end, then
  for its deadlines to pass on the restarted hub's clock. The timeouts are 15 to 20 minutes, for a loaded machine.

## The surface under test

The tests reach DeepBuild only through these:

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry: `deep-hook claude-code <event>`,
  the hook's JSON on stdin, `HOME` the test's. Payloads and transcripts are shaped like the corpus's
  (`adapters/corpus/claude-code/2.1.304`). Every transcript entry carries the newest version the facts cover, so no
  session is watch-only.
- **`deep hub run`** with its test settings: `DEEP_HUB_PLANT`, `DEEP_HUB_TEST_CLOCK`, `DEEP_HUB_TEST_CONFIRM` and
  `DEEP_HUB_TEST_SORTER` (new, below).
- **The socket**, as the cli role with the control token: `events.read`.
- **`deep inbox answer <ask> <option>`** (#24): your answer on the trusted path. The OS confirmation is stubbed
  `confirmed` (`DEEP_HUB_TEST_CONFIRM`), as #24's, #667's and #25's suites stub it.
- **Files** under `HOME`:
  - `~/.deepbuild/rules.json`, seeded with `crates/deep-hook/default-rules.json` as #304's suite seeds it.
  - `~/.deepbuild/config.json` with your ask settings: setup's drafts with no `batch`, so every ask shows at once.
    The authority deadline is `1d`.
  - `~/.claude.json`, where the fake MCP servers are declared.
- **Fake MCP servers** (`fixtures/mcp-server.mjs`): a boundary DeepBuild doesn't own, and the suite's only stand-in.

### Playing Claude Code

The test is Claude Code. It fires each hook through deep-hook, as a child of that session's own process,
`fixtures/agent.mjs` (Redraft). It runs a call only when deep-hook's PreToolUse
allows it, as Claude Code does: exit 0 with no deny. A deny is exit 2, or a `permissionDecision` or `decision` of
`deny` or `block` (#316's reading, `helpers.ts`, `decision`).

For an allowed MCP call, the test starts the fake server from its config, initializes it and sends `tools/call`,
as Claude Code would. So "the fake server receives no request" is exactly "the call never ran".

### Held at PreToolUse, waiting for your answer

The issue says a call is "held at PreToolUse with an authority ask naming it, which waits for your answer". The
design adds that "the call it names stays held until you answer". The facts add that "a hold waits no longer than
the agent lets a hook run" (`hookTimeouts`, 60 s for PreToolUse). A 1-day ask can't be one hook's hold, so the tests
accept either way of holding a call and read only what both share (`helpers.ts`, `expectHeld`, `stillHeld`,
`approve`, `expectRuns`):

- **Held.** After the call starts, an ask raised since the update or the stop names it within 90 s. That is an
  `ask.created` whose `question` holds the call's words:
  - the command text for a shell call (`git push origin main`, `gh pr merge 12`);
  - the server's and the tool's names for an MCP call (`forge` and `delete_repo`).
- **An authority ask.** The ask's `kind` is `authority`.
- **Not let through.** The ask may have been raised before the call: an update's one ask may come at the session
  start that records the update. Until you answer, deep-hook never ends the call allowed. Its PreToolUse may:
  - still be waiting on a hold the hub acknowledged, or
  - have denied the call. Whether the denial names the ask isn't asserted.

  For an MCP call, the fake server has received no `tools/call` for the tool. A PreToolUse still running 150 s
  after it started fails, because Claude Code would have ended it at its timeout and run the call.
- **Waits.** 3 to 5 s later, with no answer given, still none of the call's runs has gone through, and the ask is
  still open.
- **Your yes.** The ask's option whose `decision` is `allow`, sent with `deep inbox answer`, which must exit 0.
- **Then it runs.** Either a run of the call still waiting at your answer ends allowed, or, when every run was
  denied while held, the same call sent again (a new `tool_use_id`) is allowed with no new ask naming it. For an
  MCP call, the fake server then receives the `tools/call`.
- **Runs with no ask** (`expectFree`). The call is allowed, it reaches the fake server, and no ask raised since
  names it, 2 s after it ran.
- **One ask per server update.** AC2 calls `delete_repo` twice before answering. Exactly one ask names it.
- **Approved once.** After your yes, `delete_repo` runs with no ask, again in the same session and in a new session
  whose start records the same list.

### The planted sorter

No sorter exists: #84, which sorts questions at the stop, is open. The issue's "planted sorter" is a test-only seam
the hub reads as it reads its other `DEEP_HUB_TEST_*` settings:

- **`DEEP_HUB_TEST_SORTER=<file>`**, a JSON file `{"rule": "<rule name>", "proceed": ["<question>", …]}`.
- **What it does.** At a Claude Code Stop, when the turn's last assistant message is one of the listed questions,
  this sorter sorts it and answers "proceed", by the rule `rule`. The message is the payload's
  `last_assistant_message` and the transcript's last assistant text; the test makes both the question itself. The
  tests use `want me to push to main?` and `want me to run the tests?`, and a rule `planted-proceed-<random hex>`
  that nothing else could name.
- **Recorded with its rule.** The record holds the proceed: an event, of any kind not starting with `ask.`, whose
  data names both the question and the rule, after the stop.
- **Not an ask.** No `ask.created` asks that question.
- **One reply.** "A 'proceed' also rides in the stop's one reply". The stop's reply sends the agent on: a Stop block
  (exit 2, or `decision: block`) whose text says `proceed`. The calls the session makes after it, until its next
  Stop, are the turn the proceed starts.

Why this surface:

- It keeps to the design. The sorter only answers questions. Each proceed is recorded with the question and the rule
  that sorted it, and is never an ask. "whichever sorter answered", the core classifies the turn's calls by the
  guard engine's effect classes, never by the question's words.
- It is deliberately a wrong sorter. It sorts by the question's words, and it answers an authority question
  ("push to main?") with proceed, so the test shows the core holding the push whatever the sorter said.
- A file the hub reads is the smallest seam, beside `DEEP_HUB_TEST_MCP_TOOLS` and `DEEP_HUB_TEST_CONFIRM`.
  Production never sets it. #84's real sorter later takes the same place in the stop.

The design's "proceed" covers questions "in scope and can be undone"; the planted sorter ignores that, which is its
point.

### MCP servers, synced and yours, and how the record learns a tool list

Each fake server is a stdio JSON-RPC server, `node fixtures/mcp-server.mjs <name> <tools.json> <requests.jsonl>`,
declared in `~/.claude.json` with `{"type": "stdio", "command": <node>, "args": [...], "env": {}}`. Two kinds:

- **Synced by DeepBuild**, as `forge`: in the user-scope `mcpServers`. The design says the servers DeepBuild syncs
  are "written at user level", and #148, which syncs them, is open. So the test writes the entry DeepBuild's sync
  would write.
- **Added by you, never synced**, as `tracker` in AC4: at local scope, `projects[<repo>].mcpServers`, where
  `claude mcp add` writes a server by default.

The server's installed code is its `tools.json`, `{"version", "tools": [<tool as tools/list gives it>]}`, read again
at each `initialize` and `tools/list`. **A server update** rewrites it with a new tool list and version.

**How the record learns the list.** The design says "nothing proxies the server", and Claude Code's hooks carry no
tool list. So the hub learns each server's list by speaking MCP to it at each session start: `initialize`,
`notifications/initialized`, `tools/list`, starting it from its config the way Claude Code does. That covers every
server the session loads, synced or not, from the same configs `loadsOf` reads.

The server logs every request it receives, the hub's included. The tests count only `tools/call`. The hub reading
the server's tool list is how the list is recorded, not a call.

The tests don't fix the event kind or shape. `expectToolList` requires that, within 30 s of each session start,
events after it name the server and, together, each tool on its current list. Tool calls, asks and prompts don't
count. Because the scope says each server's list is recorded at each session start, the whole list must be
recorded, not only what changed.

**The first list is the baseline.** The first list the record holds for a server is its install. The issue speaks of
"a server update", and AC2 says the server's read-only tools "keep working". So no tool on that first list is held
for being new. A tool is new or changed against the list recorded before; one not on that list is new, so a call
that arrives before the new list is recorded is held too.

**Read-only tools.** `list_issues`, `get_issue` and `list_tickets` carry `readOnlyHint: true`, and still count as
change, because hints never lower a class. They keep working because they are unchanged, not because the hint says
read. "Tools counted as read pass" isn't exercised separately: no fake server has a facts entry.

### The virtual clock (AC5)

The hub's clock is set only at its start (`DEEP_HUB_TEST_CLOCK`; it moves with real time from there). AC5:

1. Waits for every held run to end, none allowed. A hook waiting on a hub that stops falls back to the hub-away
   decision, and would let the call through.
2. Stops the hub by PID.
3. Starts it again with its clock 20 s before the earliest ask's deadline.
4. Reads only `events.read` until the hub's clock, bounded from below by its ready line, is 15 s past the last
   deadline. Nothing that could close an overdue ask on the way is read.

Each ask's deadline must be its `ts` plus 1 day (±60 s). Each must close with an `ask.defaulted` whose `decision` is
`deny`, at or after its deadline.

"The call never runs" covers both the held call and the same call the agent sends again in that turn after the no.
No stop came between them: none of them may be allowed, and the fake server receives no `tools/call` for
`delete_repo` or `post_update`.

### INCONCLUSIVE

On a loaded machine, deep-hook can miss the hub's acknowledgement (50 ms from the hook's start). It then lets a call
through as with the hub away, spooled marked `late`. When a call that should be held was let through, the test reads
its `tool.before`. If it is marked `late`, the hub never decided the call, and the test is skipped as INCONCLUSIVE
with the load reading, never passed (`helpers.ts`, `Inconclusive`, `verdict`). A Stop whose reply missed the
acknowledgement isn't told apart: its failure message carries the run's time and the load.

## Wrong programs

Each is code the implementer writes, selected with `DEEP_HUB_PLANT=<name>` on `deep hub run`. A plant the base
doesn't list stops the hub from starting (`plantOf` throws), so its test fails BLOCKED, never passes.

Each wrong-program test runs its criterion's whole scenario on the planted hub and requires it to fail with a
message naming what the issue says it names. `failureOf` rethrows BLOCKED and INCONCLUSIVE, so neither counts as the
plant's failure.

| Name | Criterion | What the plant does | How the test fails on it |
|---|---|---|---|
| `proceed-covers-turn` | AC1 | the core lets a proceed cover every call of the turn it starts: in that turn no push, merge, dispatch, send or delete is held | `` AC1 #321.69952336 [effect.push] `git push origin main` ran before you answered: deep-hook allowed it… ``; the test requires the message to name `git push origin main` |
| `trusts-hints` | AC3 | #304's existing plant, extended to the tool lists the record now holds: the classifier counts a tool as read when its server marks it `readOnlyHint` (or its name starts with `get_` or `list_`) | `AC3 … the fake server forge received 1 tools/call request(s) for post_update before you answered…`; the test requires that request count for post_update |
| `holds-synced-only` | AC4 | the guard holds new or changed tools only for servers in Claude Code's user-scope config, where DeepBuild's sync writes the servers it syncs; a server at local scope is never held | forge's delete_repo is held, then `AC4 … [tracker, …] the fake server tracker received 1 tools/call request(s) for delete_repo…`; the test requires the message to name `fake server tracker` |
| `hold-as-choice` | AC5 | each hold is filed as a choice ask whose recommended option, and so its default, approves | `AC5 … [effect.push] the hold of `git push origin main` must be an authority ask: ask:… was filed as choice…`; the test requires a source (`effect.push`, `effect.merge` or `mcp.tool_changed`) |

**"Naming the source" in AC5.** The source is the `ask.sources@1` row the hold comes from: `effect.push`,
`effect.merge`, or `mcp.tool_changed` for both new tools. Every AC5 assertion starts with the source of the hold it
judges, so a wrong program fails naming it.

The issue names no wrong program for AC2. The base, which holds nothing, is its wrong program (`BASE-FAILURE.txt`).
AC2 also fails a hub that holds every change-class tool, whose `list_issues` wouldn't keep working, and one that
raises an ask per call rather than per update.

`trusts-hints` exists at the base, where it reaches only `DEEP_HUB_TEST_MCP_TOOLS`. The implementer extends it, so
#304's suite must keep passing with it.

## Criteria to tests

Each `describe` names its criterion's ID, `#321.<first 8 hex of SHA-256 of the criterion's text>`: trimmed,
whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it. Each test's name starts with the
criterion's number. Every failure message starts with `AC<n> <ID>`.

| ID | Criterion (short) | Test file | What the test does |
|---|---|---|---|
| AC1 `#321.69952336` | a planted sorter's proceed is recorded with its rule; `git push origin main` in its turn is held with an authority ask naming it until your answer; after its proceed for the tests, `npm test` runs with no ask; a core whose proceed covers the turn fails, naming the call | `proceed.test.ts` (2) | sorter seam, Stop through deep-hook, PreToolUse push held, your yes, then `npm test` free; the wrong program `proceed-covers-turn` |
| AC2 `#321.d75b4c41` | an update adding `delete_repo` holds it until you approve it once; read-only tools keep working | `delete-repo.test.ts` (1) | `forge` (user scope); two session starts around the update; delete_repo twice under one ask; list_issues and get_issue free; your yes; free again and in a new session |
| AC3 `#321.876b8dcb` | `post_update` with `readOnlyHint: true`, no facts entry, counts as change: first call held with the update's one ask, the fake server gets no request until you answer; a classifier trusting the hint fails on the request count | `read-only-hint.test.ts` (2) | `forge`; post_update held, its `tools/call` count 0 until your yes; the wrong program `trusts-hints` |
| AC4 `#321.ed0f414b` | a server you added yourself, never synced, adding `delete_repo` at the next session start, held the same way; a guard holding only synced servers' tools fails, naming the server | `yours.test.ts` (2) | `tracker` (local scope) beside `forge` (user scope, the control); both held until your yes; the wrong program `holds-synced-only` |
| AC5 `#321.e6090cff` | on the virtual clock, the held push, merge, `delete_repo` and `post_update` each take no at the 1-day authority deadline and never run; a hold filed as an approving choice fails, naming the source | `deadline.test.ts` (2) | four holds in one proceed turn, the hub restarted on `DEEP_HUB_TEST_CLOCK`, `ask.defaulted` deny, the calls sent again denied; the wrong program `hold-as-choice` |

## What this suite could not encode

- **Recording a tool list at install and update.** That happens when DeepBuild syncs or updates a server, the
  Agents page's (#148, R2), and is not in the base. Only "at each session start" is encoded. A synced server's update
  is noticed at the next session start, like yours.
- **Schema digests, hints and saved decisions in the record.** The record must name each tool. Its input schema
  digest and hints aren't read. "A saved decision about a tool lapses when its schema changes" is Scope with no
  criterion, and is not tested. Nor is the card showing hints "as the server's own claims".
- **Dispatch, send, delete and spend in a proceed turn.** Only the push (AC1, AC5) and the merge (AC5) are encoded,
  the calls the criteria name. So are Codex sessions and `request_user_input` cards.
- **Other server kinds.** Project-scope `.mcp.json` servers, HTTP servers, and a server you added yourself at user
  scope aren't tested. The planted guard's notion of synced is user scope.
- **The second question's turn.** The proceed for "want me to run the tests?" comes at the stop of a new typed turn
  ("Carry on."), not at a stop continued by the first proceed (`stop_hook_active: true`). Either is a stop ending
  on a question.
- **The push sent again after AC5's default** comes after the hub restarted, which the virtual clock needs. It
  relies on the record, not the hub's memory, knowing that the turn the proceed started is still running (no stop
  came).
- **"The fake server receives no request"** is read as no `tools/call`. The `initialize` and `tools/list` the hub
  sends to read the server's tool list are how the list is recorded (above).
- **A late Stop.** A Stop whose acknowledgement came late isn't told apart, and fails with its time and the load
  reading.
- **#304's `DEEP_HUB_TEST_MCP_TOOLS`** stands in for recorded lists in #304's suite. Once the record holds them, the
  implementer keeps that suite passing; this suite never sets it.

## Redraft

**2026-10-28: your yes came from inside the sessions' process tree.** The coordinator raised a dispute: every test
that reaches your yes (AC1, AC2, AC3 and AC4) failed at `approve()` with this message, and its exit code 3:

> ask:… stays open: this deep command runs inside agent session …'s process tree, so it acts as that session, and
> no agent answers an ask.

**The cause was this suite's harness.** The hub binds each session to its hook's parent process, by PID and start
time. In the first draft, the vitest process ran deep-hook directly, so every session was bound to vitest. The same
vitest process ran `deep inbox answer`, so the answer came from inside an agent's process tree, and the hub refused
it, as #24 designs and the base already does. A real person's terminal is never a descendant of Claude Code.

**What changed: the harness only.** Each session now has its own long-lived Claude Code stand-in,
`fixtures/agent.mjs`, after `tests/acceptance/25/routes/fixtures/claude.mjs`'s convention. `newSession` starts it,
and it runs every one of that session's deep-hook runs as its own child:

- `helpers.ts`, `fire` sends the hook through it.
- The payload, arguments, working folder, `HOME` and timeout are as before.
- The hub now binds each session to that process.
- `deep inbox answer` (`approve`) is still run by the test process, a sibling of every session's process, never a
  descendant: your terminal.
- The CLI, the hub, `deep inbox answer` with the OS confirmation stubbed, and every surface above are unchanged.

**What did not change.** Every criterion's expected values, every judgement (`expectHeld`, `stillHeld`, `approve`,
`expectRuns`, `expectFree`, `expectProceed`, `expectToolList`), the plants and what each must name, and the test
files. `cleanup` stops each session's process by PID, which stops its running hooks.

**Proof the fix works on the base.** A throwaway probe was run against a temporary `git worktree` of the base at
`/tmp/dh321-basewt`, with no change of this checkout. `deep off` goes through the same peer check
(`agentAbove`) as an answer:

- With the hooks run by the session's own process, `deep off` from the test process exits 0.
- With deep-hook as the test runner's own child, the first draft's arrangement, it is refused, "runs inside agent
  session …'s process tree".

`BASE-FAILURE.txt` has the run.

## Files

- `helpers.ts`:
  - temp worlds (a home and a git repository), the hub as a process, and `events.read`;
  - sessions, payloads and transcripts, deep-hook runs and their decisions;
  - the fake servers in `~/.claude.json`, and calls run as Claude Code runs them;
  - `deep inbox answer`, and the judgements: `expectToolList`, `startRecorded`, `expectProceed`, `expectHeld`,
    `againHeld`, `stillHeld`, `approve`, `expectRuns`, `expectFree`;
  - `verdict`, `failureOf`, `Inconclusive`.
- `fixtures/mcp-server.mjs`: the fake MCP server.
- `fixtures/agent.mjs`: each session's Claude Code stand-in, the parent of that session's deep-hook runs (Redraft).
- `proceed.test.ts` (AC1), `delete-repo.test.ts` (AC2), `read-only-hint.test.ts` (AC3), `yours.test.ts` (AC4),
  `deadline.test.ts` (AC5).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.

[An ask, and your answer getting back]: ../../../docs/technical-design.md
[Decided]: ../../../docs/technical-design.md
[Before each command]: ../../../docs/technical-design.md
