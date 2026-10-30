# Acceptance tests for #806: deep_show from a live session, through the hub, drawn in the app, rendered back headless when the app is closed

Written first, blind, from issue #806 (updatedAt 2026-10-30T02:24:15Z: Scope, its four acceptance criteria, Proof and Depends on), the
design sections it links and those they lean on, and base commit `46e622f8` (`origin/main`), by a job that never saw an implementation;
none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

What was read:

- `docs/technical-design.md`: One hub per user, a tiny hook client, and extensions in-process (the deep hub, DeepBuild app, deep CLI and
  `deep mcp` rows); Extension API, with the MCP tools row (`deep_show` "draws any canvas document … on the agent's own claim or ask …
  returns the document's issues, its audit and snapshots … a picture is never proof"); Socket roles and contract versions (the binding of
  a `deep mcp` call to a session, the peer check, "a call that binds to no session … never claims, asks, draws or attaches evidence");
  The canvas core; Render-back; Document check; Numbers version 0 has to hold (deep_show answers within 2 s); How we know version 0
  works and Dogfooding.
- `docs/canvas-primitives.md`: Handles, Writer layer, Patch, Revision, and section 4, The trusted compositor (Writer connection, Document
  session, Admission and latch, Band, Question card, Render-back).
- At the base: the sibling suites this issue builds on, read in full with their helpers, fixtures and BASE-FAILURE files —
  `tests/acceptance/393/` (deep_show for agents, against `deep-show run`), `384/` (point and ask), `26/` (`deep mcp`, its agent
  stand-in, the hub in a temp HOME, `DEEP_HUB_PLANT`), and, for how a suite reads the app and gates live runs, `326/`, `338/`, `42/`
  (`DEEP_OTLP_LIVE`), `48/` (`DEEP_HARNESS_LIVE`), `25/live/` (real Claude Code under a temporary HOME with `CLAUDE_CODE_OAUTH_TOKEN`);
  `crates/deep-show` (the stand-in: `main.rs`, `hub.rs`, `snapshot.rs`, `shared.rs`), `crates/deep-app` (`hub.rs` is the app's hub
  client, `canvas.rs`), `crates/deep-replica`, `packages/hub/src` (`server.ts` roles and methods, `mcp.ts`, `tools.ts`, `core.ts`'s
  `mcpCall`, `bind` and `agentAbove`, `plant.ts`, `paths.ts`), `packages/cli/src/main.ts`, `packages/evidence`, `packages/record`,
  `packages/contracts/schemas` (`doc.patched@1`, `reading.recorded@1`, `session.start@3`), `scripts/agent-harness.mjs`.

What the base has and these tests don't credit: a hub (`deep hub run`) with its roles, `deep mcp` serving `deep_ask`, `deep_wait`,
`deep_open_item`, `deep_status`, `deep_search`, `deep_claim`, `deep_evidence`, `deep_run` and `deep_propose`, the per-call binding of a
`deep mcp` call to its session by its parent process, the peer check for `deep` commands, an app client (`crates/deep-app/src/hub.rs`)
and a headless replica that draws shipped views. It has no `deep_show` tool, no `deep show` command, no canvas side in the hub (documents,
revisions, writer layers, render-back, ask attachments), no canvas panel in the app, and the `deep-show` stand-in for all of it.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js: deep hub run, deep mcp, deep show
npx vitest run --root tests/acceptance/806 --no-file-parallelism
npx tsc -p tests/acceptance/806/tsconfig.json     # type-check: the root's strict options, allowImportingTsExtensions, noEmit
DEEP_SHOW_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=... CODEX_API_KEY=... npx vitest run --root tests/acceptance/806 live.test.ts   # by hand only
```

Node 24.22 first on `PATH`; `git` on the `PATH`; cargo for the `deep-show` stand-in and the app's replica, which every file builds once
(`cargo build --locked --bin deep-show`, and `--bin deep-replica-canvas` on macOS). `scripts/lanes.mjs` needs `tests/acceptance/806/` in its
`alone` list (the one-at-a-time unit-lane line, as #26's, #384's and #393's folders are) and `live.test.ts` kept out of every lane: the
implementer makes that edit; this job writes tests only.

Each test makes its folders under `/tmp/dh806-*` (a socket path must fit in 104 bytes), runs every process with `HOME` there, so the hub's
root is `<home>/.deepbuild`, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. It stops only processes it started, by
PID (`helpers.ts`, `cleanup`). No test uses the network except the live agents' own. A run with `--root tests/acceptance/806` leaves
Vitest's cache in `tests/acceptance/806/node_modules/.vite`; delete it.

**Off macOS.** The app is crates/deep-app (gpui-kit); the replica draws with GPUI's offscreen Metal renderer. Every test that starts the app
fails with a message starting `INCONCLUSIVE:` off macOS; it never passes there. Tests that need no app (the tool list, criterion 3's
refusal, criterion 1's replays of the scenarios that have no user calls) run everywhere: the headless worker renders snapshots with Vello CPU.

**The live tests** (criterion 2) run a real `claude -p` and a real `codex exec`. They spend plan usage, so they never run in CI or by
default: without `DEEP_SHOW_LIVE=1` each fails with a message starting `INCONCLUSIVE:`; with it, a missing credential fails `BLOCKED:`.
The agents run under the temporary `HOME` (the account is `CLAUDE_CODE_OAUTH_TOKEN` for Claude Code, as #25's live suite does, and
`CODEX_API_KEY` for `codex exec`), and reach the test hub as every client does: through the hub's default address under that `HOME`
(`<home>/.deepbuild/hub.sock`; the setting `hub.address` in `<home>/.deepbuild/config.json` is the other way, and is unset here). Claude
Code gets `--settings` hooks that run `deep-hook claude-code <event>` with `HOME` set, and `--mcp-config` registering `deep mcp` with `HOME`
in its `env`; Codex gets the same two in a temporary `CODEX_HOME/config.toml`. **Unverified:** this job could not run either agent (no
plan usage was spent) and wrote Codex's hook configuration from `adapters/codex.facts.json` alone, so the TOML tables in
`live.test.ts` may need the implementer's correction; a live run that fails at "the hub saw the session start" is that, not the issue.
The facts say scripted Claude Code sessions run interactively, never with `-p`, because `-p` ends async hooks at teardown; this issue's
text asks for `claude -p`, and the hooks used here are synchronous, so it is used.

## The surface under test

The issue names `deep_show` through `deep mcp`, `deep show`, the hub's record, evidence by hash, the app's panel and the headless worker,
but no wire. These tests reach the code only through: **`deep mcp`** as an MCP client speaks it (#26's `initialize`, `tools/list`,
`tools/call`), **`deep show`**, **`deep hub run`** and its socket as #16 and #26 define it (`events.read` on a `cli` connection), the
evidence store's files read through `packages/evidence`'s public entry (`openEvidenceStore({root, readOnly: true})`, `read`), and the
app's replica. Every name below that the issue or the design doesn't give is this job's invention, kept as small as the tests need,
and each says so.

### The deep_show tool (name: the issue's; fields: #393's)

`tools/list` holds `deep_show` beside the other `deep_*` tools. A call's input is #393's deep_show call without `session` (the binding's
now) and without `at`: `doc` (the doc ID the hub minted), one of `document` (a whole revision, with no `id`, no `layers`, no item `layer`),
`patch` or `undo` (#96's, used by criterion 1's #384 replays), and `removes`, `t` (time grammar text), `size` (`[w, h]` px) and `include`
(`issues`, `audit`, `timing`, `pixels`); and, **invented here**, `rev` (the revision to render, any it has had; null: the current one),
which is how #384's agent render-back at an earlier revision is made through the one tool. Each field has one JSON type, in every replay: `t` is
text in the time grammar (`"1s"`; `"4.2s"` for #384's 2,963,520,000 flicks, which the replay writes from the scenario's flicks, `replay.ts`
`secondsText`), `rev` a number. The reply is #393's, unchanged, as a tool
result's `structuredContent` (or the JSON in its first text block), **not** an error: a refused document and a call bound to no session
are replies with `outcome: "refused"` (README below, Readings), never `isError`.

```json
{"outcome": "presented" | "refused" | "not_presented", "reason"?: "hidden" | "timeout", "code"?: string, "rev"?: n,
 "issues": [Issue], "truncated"?: {"shown", "total", "by_code"}, "issues_evidence"?: sha256,
 "changed"?: [ID], "unchanged"?: [ID], "created"?: [ID], "removed"?: [ID],
 "snapshots": [{"sha256", "w", "h"}], "result"?: "PASS" | "FAIL" | "BLOCKED" | "INVALID" | "INCONCLUSIVE"}
```

`document` and `patch` are open objects, which #26's strict-schema rule can't type (every property listed, no maps), so the tests send an
object-valued field as its JSON text when the tool's `inputSchema` types it as a string, and as an object when it types it as one
(`helpers.ts`, `showArgs`). A field left out reads as null (#26).

### `deep show`

`deep show --doc <doc ID> --document <file> [--removes id,id] [--t <time>] [--size WxH] [--include issues,pixels] [--check] [--claim <handle>]
--json` prints the reply above as one JSON line and exits with the `deep` commands' exit-code table; `--check` makes the reply carry
`result`, and `--include …pixels` is `--snap`. **Every option name here is invented**; the issue names the command and #393 `--check
--snap`. Run from inside an agent's process tree it acts as that agent (the peer check, #16), anywhere else as you.

### Seams (test-only settings)

Read from the environment of `deep hub run`; only tests set them. An unknown `DEEP_HUB_PLANT` makes the hub refuse to start, so a test
that selects one fails BLOCKED until the implementer adds the name to `packages/hub/src/plant.ts`.

| Variable | What it does |
|---|---|
| `DEEP_HUB_TEST_SHOW=<file>` | *Invented here.* A JSON file the hub reads for what its canvas side knows and a test can't build, read again whenever it changes (as `rules.json` is). Fields, all optional: `names` (the name a session's outline shows, by session ID, or by agent, `claude-code` or `codex`, for any session of it); `panels` (`{panel: {rect: [x, y, w, h], visible?: bool, html?: path}}`: where documents draw, and which panel is hidden); `docs` (`{doc ID: {panel, document?}}`: the documents the hub minted, each with its panel, and the whole document stored at revision 0 to start from); `claims` (`{claim handle: {session, deliverables: [doc ID]}}`); `window` (`[w, h]`) and `card` (the shell's question card and its slot, as #393's scenario gives them); `fault` (`{holds: fallback_pipeline \| rebuild_queue \| asset_decode, ms}`: for `ms` after a call that renders is admitted, its frame can't settle, as #393's fixture). The session's name has no source at the base (`session.start` has none), so it is a seam; panels, minted documents and the fault are what the app and the render worker would report. |
| `DEEP_HUB_TEST_PID_REUSE=<file>` | *Invented here.* A JSON array of PIDs, read at each peer check: a listed PID now belongs to another process, with a start time no session recorded. It stands in for "a process that reuses an ended agent's PID", which a test can't make happen. |
| `DEEP_HUB_PLANT=<name>` | A planted wrong program, below. Tests set it in the environment of `deep hub run` **and** of every `deep mcp` they start, so a plant may live on either side. |
| `DEEP_HUB_TEST_CONFIRM=<file>` | #24's stub for the OS confirmation; set, unused. |

A hub started without `DEEP_HUB_TEST_SHOW` mints no documents: the tests always set it, so what the hub does without it is the
implementer's.

### Read-only hub methods (invented here)

`canvas.revisions {doc}` and `canvas.messages {session}` on a `cli` connection with the control token, answering what the stand-in's
`revisions` and `messages` calls answer (#393's and #384's READMEs): `{"revisions": [{"rev", "base_rev", "writer": {"kind", "id"}, "hash",
"state"}]}` and `{"messages": [Message + {"resolved": [...]}], "context": [doc handle]}`, each with `core` and `set_digest` as the stand-in's replies, and
#393's deep_show replies, carry them. The issue names no tool or command for an agent to
read its session's revisions or messages (and #384's "the agent reads them" has no surface at the base), so criterion 1 reads them from
the hub as `events.read` reads the log. Criteria 2 to 4 don't use them: they read the record and the evidence store.

### The app

The app reaches the hub only over its socket, as the `app` role with the control token. A test sees what it drew through **a new bin target
of `crates/deep-replica`, `deep-replica-canvas`** (name invented here; found at `target/debug/deep-replica-canvas`), the app's canvas panel
opened headless at the reference window on GPUI's offscreen renderer and connected to the hub exactly as the app is: `HOME` the test's home,
so it reads the hub's address and `control.token` the way `crates/deep-app/src/hub.rs` does.

```
deep-replica-canvas --out <dir>
```

- Its first stdout line is `{"ready": true}`, printed once it has said hello as the app and been sent whatever the hub presents. It runs until
  SIGTERM or end of stdin. "The app is closed" is that process gone: the hub then has no app connection.
- For each revision the hub presents to it, after drawing it, it appends one line to `<dir>/drawn.jsonl`:
  `{"doc": doc ID, "rev": n, "layers": [{"layer": id, "owner": {"kind": "agent"\|"you"\|"shell"\|"record"\|"plugin", "id": thread}, "band": "agent"\|…\|"card", "outline": bool, "name": string\|null, "items": [item ID]}]}`:
  every layer on screen in the window, back to front (Band), `owner` the writer (an agent's `id` is its session's `thread`), `outline` and
  `name` the outline the layer is drawn with and the name it shows, `items` the IDs it draws, the question card one row with `band: "card"`.
- On stdin it takes one JSON line per call and answers one line each. `{"call": "sync"}` waits until it has drawn every revision the hub has
  presented so far and answers `{"drawn": {doc ID: rev}}`. The user's calls of `deep-show run` — `screen`, `input`, `ask`, `scope`, `view`,
  `presented` — it answers exactly as `deep-show run` does (#383's, #384's, #393's READMEs; the `at` field is dropped: it draws in call order,
  each call after a `sync`; a call's `session` is the real session ID the hub knows, which the replay puts in for the scenario's); `screen` with `"out": path` also writes the window as an 8-bit RGB or RGBA PNG and answers `{"bands",
  "width", "height", "items": [{"id", "layer", "box"}]}`, as `deep-show screen`'s reply gives it.
- Off macOS it exits 2 (`deep-replica`'s own message); the tests fail INCONCLUSIVE before starting it.

### Planted programs (wrong hubs)

Reachable only through `DEEP_HUB_PLANT`, only to prove a test fails on a wrong program. The implementer adds the names to the plant list.

| Name | What the plant does | Criterion | How the test fails on it |
|---|---|---|---|
| `deep-show-writer-from-payload` | stamps a deep_show document's writer from the payload's top-level `writer` (`agent:<thread>`) instead of the connection, so the figure lands in that session's layer | 2 | the figure is drawn in the other session's layer; the message names the layer (`layer "<id>"`) and the session it was drawn as |
| `deep-show-waits-for-app` | deep_show presents only once an app has drawn the revision, and answers `not_presented` (`timeout`) after 2 s when none is connected, instead of rendering in the headless worker | 4 | with the app closed the call answers `not_presented` after 2 s; the message names `deep_show` |

## Criteria to tests

IDs are the criteria's order in the issue, `AC1` to `AC4`; each test's name starts with its ID.

| ID | Criterion | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | #393's and #384's acceptance scenarios, played against the hub and the app instead of the `deep-show` stand-in, give the same replies field for field, with evidence hashes compared by content | `replay393.test.ts` (10) and `replay384.test.ts` (3): one test for each scenario family of the sibling suites (README: Criterion 1). Each plays the stand-in's own scenario JSON on `deep-show run` and on the hub, with the app where it has the user's calls, and compares every call's reply field for field; `issues_evidence` and snapshots by content; asserts the bounds the scenario names (a late frame waited for at least 1.5 s, a stuck or hidden one answered within 2 s); and shows the comparison fails when any one field of a hub reply is changed. Fails on: a hub whose reply differs from the stand-in's in any field, a different evidence content behind an equal-looking hash, a program that answers the hidden or stuck frame late, and a replay that compares nothing |
| AC2 | A scripted Claude Code session and a scripted Codex session each call `deep_show` through `deep mcp` with a six-item figure on their own claim: presented at revision 1 with a snapshot hash, the app's panel draws the figure in that agent's layer outlined with the session's name, and the record holds the revision by hash; a planted hub that takes the writer from the payload draws the figure as the other session and fails, naming the layer | `sessions.test.ts`: `deep mcp` lists `deep_show` beside the other `deep_*` tools; one test for each agent (Claude Code, Codex), then both on one panel; a payload that names the other session as its writer draws nothing as it; the planted hub fails the same layer check, naming the layer. `live.test.ts`: the same with a real `claude -p` and a real `codex exec` (opt-in). Fails on: the plant `deep-show-writer-from-payload`; a figure in the wrong layer, unoutlined, or outlined with another name; a reply that isn't presented at revision 1; a record without the revision's hash or an evidence store without its canonical document |
| AC3 | A `deep_show` call from a `deep mcp` process bound to no session is refused and draws nothing, and the record gains no revision | `unbound.test.ts`: a `deep mcp` started by hand beside two established sessions: refused `no_session`, no snapshot, no revision, no event about the document, the evidence store unchanged; the same figure from a session's own `deep mcp` works; the app draws nothing for it. Fails on: a hub that binds a parentless process to a session (the figure is presented, or recorded) or that draws before it refuses |
| AC4 | With the app closed, `deep_show` of the same figure still returns presented with a snapshot from the headless worker, equal by pixel hash to the snapshot taken with the app open; a hub that waits for the app instead returns not presented after 2 s and fails, naming the call | `closed.test.ts`: the figure shown with the app open (snapshot S1), the app stopped by PID, the figure shown again on another document of the same session (S2): presented within 2 s, S2 equal to S1 by decoded pixel hash; the same flow on the planted hub fails, naming `deep_show`. Fails on: the plant `deep-show-waits-for-app`; a snapshot that differs from the app-open one; an answer after 2 s |

## Criterion 1: how a scenario is played

The sibling suites' scenarios are `deep-show run` scenarios: a JSON world (sessions, the OS process table, panels, minted documents, the
record's objects, claims, the window and the card, a fault) and a list of calls. `scenarios.ts` builds them from #393's and #384's helpers
and fixtures (imported, not copied), with the calls of the sibling tests, in their order; one test for each of #393's families (writer
layers and the peer check, bindings, revisions, the read cap, proof, hidden, each hold's settle, the question card) and #384's (selection,
the caption, the injected caption, the screenshot, the HTML page, the detached handle with render-back). `replay.ts` plays each:

- **Sessions** are real agent stand-ins (`fixtures/agent.mjs`, #26's with one more op): a scenario session whose name starts `Codex` is a
  Codex session (Codex's hook payloads), any other a Claude Code session; each is established through its hooks under a session ID derived
  from the scenario's, so the hub sees real processes. A scenario's `thread` (`thread-alpha`) is replaced by the session's real thread (a fresh
  session's thread is its own ID) in what is sent, and back in what comes back.
- **A `deep_show` call** goes through the session's own `deep mcp` (`session: null`: a `deep mcp` started by hand, bound to none).
  `render_back` is a `deep_show` with `doc`, `t`, `rev`, `size` and `include: ["pixels"]`; a `patch` is a `deep_show` with `patch`.
- **A `deep show` call** is run by the agent stand-in as the tool shell's child, inside its process tree, when the scenario's peer chain, read
  through the scenario's process table, meets that session's process; by the test itself, under no agent, when it meets none (**you**); and
  a peer chain that meets a session's PID with another start time (the reused PID) runs under that agent with the PID listed in
  `DEEP_HUB_TEST_PID_REUSE`.
- **The record** (asks, readings) is seeded through the record before the hub starts, by the scenario's handles, each for the session it
  belongs to; **claims** are filed through the session's own `deep_claim` and their handles replaced, and their deliverables written to the
  world file; **assets** are put into the hub's evidence store before it starts.
- **The user's calls** (`screen`, `input`, `ask`, …) go to the app's replica, each after a `sync`; `revisions` and `messages` to the hub's
  read methods above.

**Compared field for field.** Every field of every call's reply equals the stand-in's; the hub's reply may carry no field the stand-in's
lacks (a render-back's reply need hold only the stand-in's `{rev, snapshots, core, set_digest}`, since the tool's reply is #393's whole one; its
`t`, read below). Evidence hashes
are compared by content: `issues_evidence` by the issue list read from each side's evidence store (the hub's, with its thread names put back);
each snapshot's `sha256` by the SHA-256 of its decoded pixels. **Not by hash, and why:** a revision's `hash` covers the canonical document,
which names the writer's real thread on the hub and `thread-alpha` on the stand-in, so two correct programs can't share it; revisions
compare by which of them share a hash (the first distinct hash is `hash#1`, and so on), and by the stand-in's other fields (`rev`,
`base_rev`, `writer`, `state`); that the hub's hash is the SHA-256 of the canonical document in its evidence store is criterion 2's test.
Layer IDs and ask-task handles compare by first appearance for the same reason. Times: `at` and `clock` are not sent; the replay waits for
what the hub has presented where a call needs it. Names that are the scenario's own and no real one are mapped on the way out and back: a
thread (`thread-alpha`) and a claim handle in every call and reply, a session ID (`sess-alpha`) to the real one in the app's `ask` and the
hub's `messages`; the ask-task's handle (`task:sess-alpha-6`) is the stand-in's own and is never sent, so it compares by first appearance.

**What the #384 replays compare differently, and why** (`scenarios.ts`, `compare384`; #393's replays have none of this). #384's scenarios
run on the stand-in's virtual display clock (`clock`, each call's `at`); the hub runs on real time and is never given either.

- The stand-in's replies **mean what #384 says only with that clock**. Played without it (the same calls, no `clock`, no `at`), a patch
  never becomes current at a latch, so the ask's `doc_rev` is 0, not 14, and the deleted caption's handle still resolves `live`, not
  `detached`. So the stand-in keeps its clock, and the hub gets the same meaning from call order: the replay plays the patches, then the
  app is `sync`ed before each of the user's calls, so the revision the panel shows is the last one presented (14), and the delete is
  current when the session reads (15). `doc_rev`, `state: detached`, `removed.rev` and the playhead's `t` (`attachment.t`, 2,963,520,000)
  are compared exactly.
- A patch reply's **`arrived`, `checked` and `current`** are readings of that virtual clock and exist only because the scenario has one;
  no two correct programs on different clocks can equal them. They are **left out of the comparison, and only these three**: a hub may
  leave them off (as the stand-in does without a clock) or carry real-clock readings, but if it carries any it must carry all three with
  `arrived` ≤ `checked` ≤ `current`; otherwise its reply gets a `clock_order` field the stand-in's lacks, and the comparison fails naming it.
- A render-back's **`t`** echoes the request, is not in #393's reply, and which `t` was drawn is already in the snapshot's pixels (the
  frame at 4.2 s differs from the one at 0 s: #384's AC3). The hub's reply **may leave it out**; when it carries it, as flicks or as the
  grammar's text (`"4.2s"`), it must equal the stand-in's. This is the one field the criterion's "field for field" covers that the replay
  doesn't require of the hub.
- A doc handle's doc ID compares **case-folded** (a ULID is case-insensitive, as #384's `sameHandle` reads it); the item ID after `#` exact.
- `cost_delta`, `core`, `set_digest`, `undo`, `achieved`, `serial`, `state`, `commits`, the message's `words`, `task.state` and `task.open`,
  the `resolved` rows and `context` compare exactly: the same core on both sides gives the same values.

**The comparison can fail.** After each scenario, one field at a time of the hub's replies (`outcome`, `rev`, `issues_evidence`,
`snapshots`, `result`, `changed`, `revisions`, `messages`, `bands`, `state`: each the first reply that has it) is changed, and the
comparison must report it naming the call and the field. The #384 scenarios also change, one at a time, the nested fields they are about
(`compare384`'s `mutants`: the message's `attachment.doc_rev`, `.t`, `.handles`, `.precision`, `.quote`, `.region`, its `task.open`, a
handle's `resolved` `state`, `name`, `removed.rev` and `removed.writer.id`, `context`, and a render-back's `rev`, `t` and
`snapshots[0].sha256`, which is the frame's pixel hash), each must be reported naming the call and the top-level field that holds it, and
every listed path must exist in the stand-in's replies, so a mutant that can't be made fails too. Where the hub may leave a field out (`t`),
the mutant puts it in, wrong. A copy of the hub's replies whose clock readings are out of order must be reported as `clock_order`.

## Readings where the issue and design leave a choice

- **The session's name** is what the outline shows ("outlined with the session's name"); the base records none, so the world file gives it
  (Seams). The tests name the Claude Code session `Claude Code: login fix` and the Codex session `Codex: release notes`.
- **"The record holds the revision by hash"** is an event of the hub's record whose data names the document (`doc`, as `doc:<id>` or the
  bare ID), `rev` 1 and a `hash` of 64 hex digits, whose `writer` is the session's connection (`mcp:<session>`) and whose `session` is the
  session's, and under that hash in the evidence store the revision's canonical document, a JSON object whose `items` are exactly the figure's
  six and whose `layers` hold one layer written by `agent:<thread>`, every item in it. The event's kind is the implementer's (`doc.patched@1`
  has no `hash`; a new version of it fits). The issue's "issues and snapshots as evidence by hash" is read in the replies' `issues_evidence`
  and `snapshots`.
- **"On their own claim"**: each session first files a claim through its own `deep_claim` (the existing tool), then shows the figure. The tool
  takes no claim field (#393's fields don't include one), so the link between claim and document is not tested beyond the claim existing
  under the same session; `deep show --check --claim` and criterion 1's proof scenario read the claim's deliverables.
- **"Six-item figure"**: `helpers.ts`, `FIGURE`: a backdrop, three bars, a title and a caption, each named, no error.
- **"The app's panel draws the figure in that agent's layer"**: the figure's six items are in exactly one layer on the panel, owned by
  `{kind: agent, id: thread}`, in the `agent` band, outlined, with the session's name. "As the other session" (the plant) is the same
  check failing: the layer is the other session's.
- **"A planted hub that takes the writer from the payload"**: the payload is a deep_show whose document has a top-level `writer:
  "agent:<other thread>"`. The real hub is not asked to draw it as the other session (#393 AC6 has it refused naming `writer`, and criterion 1
  replays that); the test asserts only that nothing is drawn in the other session's layer.
- **Unbound calls are replies**: criterion 1 has them equal to the stand-in's (`outcome: refused`, `code: no_session`, no snapshot), so the
  tool answers them as a reply, not as #26's `unbound` error. "Refuses and draws nothing, and the record gains no revision" is read as: no
  event about the document, no event with both a revision and a hash, no file in the evidence store.
- **"With the app closed"** is no app connected: the replica's process is stopped by its PID and the next call comes 500 ms later. The two
  snapshots are of two documents of one session holding the same figure at `t: "0s"`, `size: [320, 200]`, so the second is not a re-send;
  "equal by pixel hash" is the SHA-256 of the decoded pixels (#384's `pixelHash`). "Returns presented … from the headless worker" is read as
  the reply, the snapshot and the 2 s bound (Numbers version 0 has to hold), since nothing but the headless worker can render it.
- **"Not presented after 2 s"**: the planted hub's reply comes no earlier than 1.9 s after the call and its `outcome` is `not_presented`.
- **Within 2 s** is the reply's time measured by the test, plus 750 ms for scheduling (#393's slack), as #393 measures it.
- **#393's and #384's `at` and virtual clock**: the hub runs on real time, so what the scenarios say at a virtual time they say in call
  order here (and what the clock's readings can't carry across, `Compare`, above). #384's board is stored at revision 0 by the world file (`docs[…].document`), its agent patches are `deep_show` calls with
  `patch`, and its user calls (`input`, `ask`) are the app's.
- **The question card (#393 AC8)** is replayed in the app's window: the world's `card` is what the shell would show; the test asserts #393's
  check on the replica's PNG (the card's interior equals its isolated render, the flood drawing beside it). The planted compositor of
  #393's suite is the stand-in's and is not replayed.

## Not tested, because no criterion asks

The audit, timing and `degraded` fields of the reply; the visible-items table's cap; carried issues; leases and quotas; two apps at once;
what the app does when it reconnects; `deep show --check`'s steps (click, hover, type); the budgets of the hub's canvas side; `deep_drive`;
that a document is minted for a claim (the world file does it); and the live agents' choices (the live prompts script the call).

## Files

- `helpers.ts`: temporary homes, the hub with its seams, the world file, the agent stand-ins (a Claude Code and a Codex session), `deep_show`
  through `deep mcp`, `deep show`, the record and the evidence store, the six-item figure, the app's replica, and the checks the planted
  programs must fail (`layerFailures`, `closedFailures`).
- `fixtures/agent.mjs`: #26's agent stand-in with an `exec` op (a command as the tool shell's child, so `deep show` sits in the tree).
- `scenarios.ts`, `replay.ts`, `ac1.ts`: criterion 1's scenarios, the replay and its comparison, and what every replay test asserts.
- `replay393.test.ts`, `replay384.test.ts` (AC1); `sessions.test.ts` (AC2, fast); `live.test.ts` (AC2, live); `unbound.test.ts` (AC3);
  `closed.test.ts` (AC4); `figure.ts` (the world of criteria 2 to 4).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
- `REDRAFT.md`: the blind redraft of the #384 replays of criterion 1: what changed, and why.
