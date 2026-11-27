# Acceptance tests for #3405: a session's message names its sender, and a channel's event isn't one

Claude Code's `peer` turns told apart by their origin's kind; the sender of another session's message found from the
inbox address it reported; the loop rule holding both sessions of a pair; a channel's event counted on its own.

Written first, blind, by a job that saw only the issue, the design and the base commit, and never an implementation of
#3405. Sources:

- **The issue**: its body (Scope, the eight criteria AC1 to AC8 in body order, Proof: "The three recordings, the
  replay failing on the merge base and passing after, and the two-session loop on the fake agent", Depends on #47)
  and the owner's one comment (the address and `CLAUDE_CODE_MESSAGING_SOCKET` are one path, `uds:` before it in
  `origin.from`; `task_notification` subkinds are out of scope).
- **The design**, `docs/technical-design.md`: What each agent gives us, and the limits we design around (prompt
  origins, `unknown` opens no ask, billing keys reported as set and never their values), Sessions that know about each
  other, An agent says it's done (A loop's turn end isn't a hand-back), Hook protocol (deep-hook and the hub: the
  request line, the spool kept byte for byte), What a minor may change (closures, extensible sets, a reader at an
  earlier minor reads a member added since as `unknown`) and How we know version 0 works (recorded hook payloads,
  planted wrong programs). And `AGENTS.md`.
- **The base commit**: `d303e2b64` (origin/main). Its code was read for surfaces only, never for expected values:
  `packages/hub/src/core.ts` (`loopHeld`: the sender read only from `origin.from` as `local_<id>`),
  `packages/hub/src/siblings.ts` (the loop rule, its ask and the pair it holds), `packages/hub/src/hub-shared.ts`
  (`AUTOMATIC_QUEUED`), `packages/hub/src/plant.ts` (DEEP_HUB_PLANT), `adapters/claude-code.facts.json` (UserPromptSubmit's
  origin rules: `turnOrigin: peer` is `session`), `adapters/index.mjs` (`mapHook`), `crates/deep-hook/src/main.rs`
  (the SessionStart report's `billing`, the spool, the `env-plants` feature reading DEEP_HUB_PLANT),
  `packages/contracts` (`getSchema`, `validate`, `registry`, `user.ask@2.json`, `digests.json`),
  `packages/extension-host/src/compose.ts` (`servedAt`), `scripts/corpus.mjs` and `adapters/corpus/README.md`.
- **Sibling suites, for their conventions**: `tests/acceptance/352` (this suite's helpers and agent stand-in are cut
  down from its), `47` (corpus replay through `scripts/corpus.mjs replay --corpus`), `3406` and
  `docs/spikes/3406/logs/2.1.308-terminal-manual-target-sibling.jsonl` (the shape Claude Code 2.1.308 writes for a
  sibling's message in the terminal), `3390` (BASE-FAILURE, tsconfig, lane.json), `1101` (an `env-plants` build).

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease cargo build --locked -p deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3405 --testTimeout=600000 --hookTimeout=180000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/3405/tsconfig.json
```

- `lane.json` puts the folder on the one-at-a-time list: every file but AC1's and AC8's starts real hubs and runs 20 to
  45 turns through deep-hook.
- AC7's planted test builds deep-hook once more, with `--features env-plants`, through `scripts/lease` into
  `target/acceptance-3405-plants`, so the plain `target/debug/deep-hook` stays as it is.
- Every test makes its folders under `/tmp/dl3405-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild` or `~/.claude`. It stops only
  processes it started, by PID, and closes the inbox sockets it opened.
- No network, no model, no `claude` binary, no `gh` call. A child never inherits this process's billing keys, forge
  tokens or its `DEEP_*`, `GIT_*`, `XDG_*`, `CLAUDE*` or `OTEL_*` settings.
- **BLOCKED.** Until the three recordings exist (AC1), every other test skips with `BLOCKED: AC1's recordings are
  missing (…)`, never a pass, as the issue says. A setup that can't go on throws `BLOCKED: …` and fails.
- **Load.** deep-hook waits 50 ms for the hub's acknowledgement; past it, it spools the event and lets the prompt go
  with an empty reply. A hold that should have come but came back that way reads `INCONCLUSIVE`, never a pass
  (`heldMust`). A run of a loop's turns that takes past 10 minutes is `INCONCLUSIVE` too.

## The surface under test

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry (`deep-hook claude-code <event>`),
  the hook's JSON on stdin, each a child of its session's own agent process (`fixtures/agent.mjs`), with the variables
  that process exports to every hook laid over its environment: `CLAUDE_CODE_MESSAGING_SOCKET`, the session's inbox,
  and `CLAUDE_CODE_MESSAGING_TOKEN`, a random 32-hex value.
- **The spool**, `~/.deepbuild/spool/spool.jsonl`: with no hub listening, deep-hook's request, byte for byte (AC7).
- **`deep hub run`** with the base's test settings `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS` and
  `DEEP_HUB_TEST_STOP_HOLD_MS`, and `DEEP_HUB_PLANT` for a planted wrong program.
- **The record** through `events.read` on the socket: `user.ask` (its `from`, its `tasks`), `ask.created`,
  `session.start`, and any event that names a `user.ask`'s ID.
- **Your terminal**: `deep inbox answer ask:<id> <option>`.
- **The adapter and facts**: `mapHook` from `adapters/index.mjs` with `adapters/claude-code.facts.json`, and
  `node scripts/corpus.mjs replay --corpus <copy>` over a copy of the three recordings (AC1).
- **The contracts**: `getSchema`, `validate` and `registry` from `packages/contracts/src/index.ts`, and the hub's reader at
  a use's minor, `servedAt` from `packages/extension-host/src/compose.ts` (AC8). That function isn't on the package's
  public entry; it is the one place the base serves a value at an earlier minor, so the test reaches it by its file.

### Surfaces (where the issue and the design name none, the least binding one; each *(chosen)*)

```
SURFACE (#3405, written blind against d303e2b64)

1. The three recordings (chosen names), in the corpus's existing layout (session.json, events.jsonl,
   transcript.jsonl), under adapters/corpus/claude-code/<newest version the facts cover>/:
     peer-message-terminal   a message between two sessions on one machine, in the terminal (surface terminal)
     peer-message-desktop    the same in the Claude desktop app (surface desktop)
     channel-event           a channel's event from a server of our own behind Claude Code's development flag
   Each events.jsonl line is the corpus's {payload, expect, source, reviewed, tag?}, and may add:
     env: {"CLAUDE_CODE_MESSAGING_SOCKET": "<path as the hook saw it>"}   (chosen)
   on a SessionStart line: the inbox address that session's hooks were given. Every session's SessionStart line in the
   two message recordings carries it. No line ever records CLAUDE_CODE_MESSAGING_TOKEN.
   Tags: other-session-message (the corpus's own) on a message's UserPromptSubmit; channel-event (chosen) on a
   channel's. A message's entry has turnOrigin peer and origin.kind peer with origin.from its address; a channel's
   has turnOrigin peer and origin.kind channel, and its origin gives the server's name in a string field named
   server, source or name (or its only string field besides kind).
   The terminal recording's join: a tagged message's origin.from is uds:<path> of a path a recorded SessionStart
   reported (/private/tmp and /tmp read alike). The desktop recording is held to whatever its own lines show.

2. A prompt's sender in the record: the prompt's user.ask, its text left out, and every other event that names that
   user.ask's ID, name the sender's session ID (whole, or its letters as in session:<letters>). "No sender": they
   name no session. The channel's server's name: the same places hold its name as a string.

3. "Opens no ask": the prompt's user.ask has tasks [] and no ask.created names its ID.

4. The loop rule's ask: an ask.created after the turns began that names the receiver and says "go on" (#352's ask; the
   issue's "your go on"). For a channel, an ask.created that names the server. Its sender's being "no session
   DeepBuild knows" (AC4): its words say no / not a / unknown … session or sender, or that the sender is unknown, not
   known or not one DeepBuild knows (ac4-unknown.test.ts, UNKNOWN_SENDER).

5. "Held": the UserPromptSubmit reply blocks (exit 2, or decision block/deny). "Your go on": deep inbox answer with
   the ask's option whose id or label says go on.

6. The planted wrong programs (chosen names; the implementer adds each):
     loop-holds-receiver-alone                     DEEP_HUB_PLANT on the hub (AC3)
     names-other-session-for-unreported-address    DEEP_HUB_PLANT on the hub (AC4)
     channel-without-count                         DEEP_HUB_PLANT on the hub (AC6)
     session-start-reports-token                   DEEP_HUB_PLANT in deep-hook's environment, read by its
                                                   env-plants build (AC7)
   The hub refuses a DEEP_HUB_PLANT it doesn't list, so on the base each hub plant's test fails BLOCKED (the hub did
   not start); deep-hook ignores one it doesn't know, so AC7's fails on the missing address, not naming a field.

7. The earlier minor of user.ask@2 (AC8): the base's user.ask@2.json, kept byte for byte as
   fixtures/user.ask@2.earlier.json.
```

### Playing the agents

Each session has its own long-lived agent process, `fixtures/agent.mjs`, the parent of every deep-hook run of that
session, so the hub binds each to the session. A scripted session with an inbox listens on `<tmp>/cc-socks/<pid>.sock`,
`<pid>` its agent process, as Claude Code names its own `/tmp/cc-socks/<pid>.sock`. A scripted message is written as
Claude Code 2.1.308 writes one in the terminal (the #3406 spike's log): a queue-operation enqueue and dequeue, then a
user entry with `isMeta`, `promptSource: system`, `turnOrigin: peer` and `origin: {kind: peer, from: uds:<sender's
path>, verifiedPeerPid: <sender's pid>, msg_id, name, fromMode, body}`; the prompt is the
`<cross-session-message from=… from-name=… from-mode=…>` wrapped body. A prompt "shaped as a recorded one" (AC2, AC5,
AC6) is the recorded entry and prompt under a new prompt ID.

### Replaying a recording

`prepare` gives each recorded session its own worktree, agent process and transcript; `replay` fires every recorded
hook in order through deep-hook, as a child of its session's agent process, the payload's `transcript_path` and `cwd`
pointed at the world's, and the line's `env` laid over its session's. Each session's recorded transcript entries are
written ahead of its hooks up to the next prompt not yet submitted, so a prompt's entry is there when its hook reads
it. SessionEnd lines are not replayed, so both sessions stay live for what the test does next.

## Criteria to tests

Each `describe` and test name starts with its criterion's number and ID, `#3405.<first 8 hex of SHA-256 of the
criterion's text>` (trimmed, whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it).

| ID | Criterion (short) | File | What the test does | A wrong program fails naming |
|---|---|---|---|---|
| AC1 `#3405.3974b666` | the corpus holds the three recordings for the newest covered version; the facts change only to what they show | `ac1-recordings.test.ts` | the three folders, their sessions, addresses, tags and entries (Surfaces 1); each line replays clean through `scripts/corpus.mjs replay`; a message stored as `session`, a channel's event as `channel`. `mapHook` on a peer entry: kind peer is `session`, channel is `channel`, coordinator, observer, observer-activity, slack-ping and a made-up kind are `unknown` | the missing folder, line or kind |
| AC2 `#3405.b702681c` | replayed, a session's message is recorded `from: session` with its sender, and the loop ask names both | `ac2-sender.test.ts` | each message recording replayed into a hub; each tagged turn's user.ask is `session` and names the session that reported its address (none if none did); then the receiver's turns shaped as the recorded one until the loop rule holds one: one ask naming receiver and sender | the merge base: the turn and the address it didn't read |
| AC3 `#3405.6a385342` | two sessions keep each other going 21 times in 10 minutes: both held at their next such prompt, your go on lets both go | `ac3-pair.test.ts` | A's turns from B's messages 21 times, B's from A's 19; A's 21st and B's 20th (within B's own count) held; one ask naming both; go on; both next turns go | plant `loop-holds-receiver-alone`: the sender's next turn |
| AC4 `#3405.d215a9a6` | a message from an address no live session reported: `from: session`, no sender; the ask says its sender is no session DeepBuild knows | `ac4-unknown.test.ts` | 21 messages to A from a socket no session reported (their words give live B's address); each `session` naming no sender; the 21st held; one ask, not naming B, saying the sender is unknown | plant `names-other-session-for-unreported-address`: the other session |
| AC5 `#3405.ef7df801` | replayed, the channel's event is `from: channel` with its server's name, opens no ask, adds nothing to another session's count | `ac5-channel.test.ts` | the channel recording replayed; its event `channel`, naming the server its entry gives, tasks [] and no ask; then 3 more such events and 20 messages from a live sibling: none held, no ask | the merge base: the event (its line and prompt ID) |
| AC6 `#3405.ff99b700` | 21 channel events in 10 minutes raise one ask naming the server; the next is held | `ac6-channel-loop.test.ts` | one typed prompt, then events shaped as the recorded one: 1 to 20 go, the 21st may be held, the 22nd is held; exactly one ask naming the server | plant `channel-without-count`: the turn it started (its prompt and session) |
| AC7 `#3405.329d0b1a` | deep-hook's SessionStart report holds the inbox address and nothing of the token | `ac7-report.test.ts` | SessionStart with the socket and token set and no hub: the spooled request holds the address outside the payload and no form of the token (its value, first or last 12 characters, SHA-256, base64); a hub replays it: the token is in no event, no file under `~/.deepbuild` and not in the hub's output | plant `session-start-reports-token`: the field |
| AC8 `#3405.5893703f` | a reader at the earlier minor of `user.ask@2` reads `channel` as `unknown` | `ac8-minor.test.ts` | user.ask@2's `from` lists channel, still extensible with unknown; an event from channel validates; `servedAt` at the base's user.ask@2 reads `unknown`, valid at that minor | the schema's members, or what the reader reads |

The issue's Proof is these: the three recordings (AC1), the replay failing on the merge base and passing after (AC2,
AC5: on the merge base the terminal message's sender isn't found, and the channel's event reads `session`), and the
two-session loop on the fake agent (AC3, AC4, AC6).

## What this suite could not encode

- **`AUTOMATIC_QUEUED` and a hook that fires before its entry is written** (Scope, #1263): no criterion names it, and
  no test fires a channel's prompt hook ahead of its entry.
- **The session map keeping the address** (Scope): seen only through what the hub does with it (AC2, AC3, AC4); no
  test reads the map, and AC7 doesn't require the record's `session.start` to hold the address.
- **The desktop app's join**: the issue says the desktop app writes `local_<id>` naming no transcript, and nothing at the
  base says what that session's hooks get as `CLAUDE_CODE_MESSAGING_SOCKET`. AC1 requires the address on each
  SessionStart line, and AC2 holds the desktop replay to what its lines show: a sender where its address joins one
  reported, none where it doesn't. Its loop-ask part runs only when a desktop message joins.
- **"Recorded … with its server's name"** is read as a string the user.ask or an event naming it holds; the issue names
  no field.
- **Digests of the two minors** (design: each minor has its own frozen digest): no criterion names them; AC8 reads the
  schema and the reader only.

## Files

- `helpers.ts`: the recordings and the BLOCKED gate, the world, worktrees, trust, inbox sockets, the hub as a process,
  `events.read`, the agent processes, Claude Code sessions (typed prompts, messages, recorded-shaped prompts, stops),
  the replay, the record's sender and ask readers, `deep inbox answer`, and the token's forms.
- `fixtures/agent.mjs`: each session's agent stand-in (352's, cut to hook commands).
- `fixtures/user.ask@2.earlier.json`: the base's `packages/contracts/schemas/user.ask@2.json`, byte for byte.
- `ac1-recordings.test.ts` … `ac8-minor.test.ts`: one file per criterion.
- `tsconfig.json`: #352's. `lane.json`: alone. `BASE-FAILURE.txt`: the run on the base commit.
