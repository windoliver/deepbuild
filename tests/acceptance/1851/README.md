# Acceptance tests for #1851: deep-hook's waiter waits for its session's answers without the control token

Written blind, from issue #1851 (its text as of November 15, 2026: the body, Scope, the three acceptance criteria, Proof and Depends on), `docs/technical-design.md` and the base commit `c740dede7`. The implementing agent doesn't edit these files; a dispute goes to this job's blind redraft (design: Dogfooding; AGENTS.md, Proof).

What this job read: in the design, One hub per user, a tiny hook client, and extensions in-process (deep-hook's row: it "never holds the control token"), Socket roles and contract versions (One role per credential), the Claude Code row of What each agent gives us (the `asyncRewake` waiter, exit 2 wakes the session, one live waiter per session, the newest) and the trusted path (`~/.deepbuild/control.token`); `AGENTS.md`; the suites `tests/acceptance/25/routes` (its helpers, the Claude Code stand-in `fixtures/claude.mjs`, imported here), `26` and `2070` (as models); and at the base, `crates/deep-hook/src/main.rs` (`waiter`, `wait_once`, `agent_pid`), `packages/hub/src/server.ts` (the hello and `session.wait`'s roles), `answer-delivery.ts` (`waitAnswer`), `inbox.ts` and `paths.ts` (where `deep` finds the token and the hub).

## Run

```sh
npm ci && npm run build --workspaces                       # the tests run the built CLI: deep hub run, deep setup, deep inbox answer, deep mcp
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook --features env-plants   # the waiter setup's entries name
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1851 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1851/tsconfig.json
```

Node 24.22 or newer, Linux or macOS (where the OS reports the process at the other end of a Unix socket), `ps` on the `PATH`. No network, no model, no account. Each test starts its own hub with `../25/routes/helpers.ts`'s `makeHome` and `startHub` (`noAskWait`, `shortHold`: a stop held with nothing answered goes through after 5 s): folders `/tmp/dh25r-*`, `HOME` `<tmp>/h` for every process, so the hub's root is `<tmp>/h/.deepbuild` and the real `~/.deepbuild` and `~/.claude` are never touched. `deep setup` writes the real entries into `<tmp>/h/.claude/settings.json`, and `ensureBinaries` builds `target/debug/deep-hook` with `env-plants` when an entry names it. Processes are stopped by PID, and the process groups this suite and the stand-ins started by group ID (`kill(-pgid)` from Node), never by name or port (`../25/routes/helpers.ts` `cleanup`, and `stopGroups` here). The file starts real hubs, so the implementer adds `tests/acceptance/1851/` to the unit lane's one-at-a-time list in `scripts/lanes.mjs` (not done here: this job writes tests only). With `--root` here Vitest writes `node_modules/.vite` in this folder; delete it before committing.

## The processes

| Process | Started by | What it is |
|---|---|---|
| A session's Claude Code | this test (`../25/routes/helpers.ts` `Claude`, `fixtures/claude.mjs`) | The session's agent process, one per session. It runs each of DeepBuild's entries from the settings file with `/bin/sh -c`, its child, in a process group of its own, and its own `deep mcp`, as Claude Code does. An `asyncRewake` entry that exits 2 wakes the session, with its stderr (#25's suite). |
| The session's waiter | its Claude Code, at the session's Stop | `deep-hook claude-code waiter`, the command `deep setup` wrote under Stop, with the Stop's JSON on stdin. |
| A's waiter asking for B (AC2) | session A's Claude Code | The same entry, run by A's Claude Code (a child of A's agent process, through `/bin/sh -c`) with a Stop payload naming session B: through the real binary, the only way a waiter of A's asks to wait on B is to be handed B's `session_id` while its process is A's agent's child. A settings file holding only the waiter's entry is used for that one Stop, so no other DeepBuild entry runs for the payload. |
| The outsider (AC3) | this test process | The same command, started by this test itself (`/bin/sh -c 'exec <command>'`, so the waiter is that very process and its parent is this test's process, in no agent's process tree), with session A's own Stop payload on stdin: a process that isn't a child of the session's agent, saying hello as that session's waiter. |
| You | this test | `deep inbox answer <ask> <option>`, run from a home of your own (`<tmp>/y`) holding the control token this test read when the hub started and your settings' `hub.address` naming the hub's socket. So you still answer, and the test still reads the record (`events.read` on a cli connection holding that token in memory), while the session's home has no `control.token` (AC1). |

## The surface

The tests reach the code only through these; none is invented.

- **The waiter**: the real `deep-hook claude-code waiter`, as `deep setup` writes it (`waiterEntries` of #25's suite), its Stop-hook JSON on stdin. Exit 2 with the answer on stderr wakes the session (design, Claude Code row). The wire of its new hello is the fix's to choose and isn't read here.
- **The hub**: `deep hub run`; its output (stdout and stderr); `events.read`.
- **Asks**: an idle asking session (`../25/routes/helpers.ts` `beginAsk`/`idleSessions`: a `deep_ask` of a choice, two options, filed under the session; its Stop went through with nothing answered, so its waiter waits). **Your answer**: `deep inbox answer` (#24's confirmation stub).
- **`control.token`**: `<home>/.deepbuild/control.token`, which the hub writes at launch; AC1 removes it.

## Readings where the issue leaves a choice

- **"Removed after the hub starts"** (AC1): after the hub's ready line, `deep setup` and the session's ask, and before the session's Stop, so the session's waiter starts with no token to read and waits 3 s before you answer.
- **"Within 2 s"** (AC1): from `deep inbox answer`'s exit (your answer accepted) to the waiter's exit 2, read at the stand-in. A waiter that doesn't exit 2 within 30 s fails, naming the ask. Over 2 s on a machine whose 1-minute load is over its core count is INCONCLUSIVE (the test is skipped saying so), never PASS; otherwise FAIL.
- **"B's answer never reaches A"** (AC2): for 15 s after you answer B's ask, the waiter under A's agent neither exits 2 nor carries B's answer on stderr, and A's Claude Code is never woken with it. As a control, B's answer wakes B through B's own waiter in that time: the hub keeps one live waiter per session, the newest, and a refused waiter isn't one.
- **AC3's "never reaches"**: the same, for the outsider and session A's answer; A's own waiter wakes A.
- **Where a refusal is read** (AC2, AC3). Neither the issue nor the design pins down where a refused waiter's refusal shows. These tests accept it in any of: the waiter's own stderr (Claude Code shows a hook's stderr), the hub's output written since the waiter started, or an event appended to the record since then. **"Naming the binding"** (AC2) is: one of these names session A's ID or A's agent process PID, as a whole token; a record event must also name B, so an ordinary event of A's isn't taken for it. **"Naming the process"** (AC3) is: one of these names the outsider's PID (the process that said hello), as a whole token.

## Criteria

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). All three tests are in `waiter.test.ts`; each name starts with its ID.

| # | ID | Criterion | The test | Wrong program it fails on |
|---|---|---|---|---|
| AC1 | `#1851.94c55f89` | With `control.token` removed after the hub starts, an answer to an idle Claude Code session is still delivered by the waiter within 2 s; the merge base's waiter can't connect and fails, naming the ask | One idle asking session; the token removed before its Stop; you answer; its waiter exits 2 with the answer within 2 s | a waiter that reads `control.token` to say hello (the base, `wait_once`): it never connects; the message names the ask |
| AC2 | `#1851.57086353` | A waiter started for session A that asks to wait on B is refused, naming the binding, and B's answer never reaches A | Idle sessions A and B; A's Claude Code runs the waiter with B's Stop payload; you answer B; the waiter under A never gets it, B's own waiter wakes B, and a refusal names A or A's agent PID | a waiter whose wait binds nothing (the base: as `cli` it waits on any session, and as the newest it replaces B's own); the message names A, A's agent PID and the waiter's exit 2 |
| AC3 | `#1851.c180d03e` | A process that isn't a child of the session's agent, saying hello as that session's waiter, is refused, naming the process | Idle session A; this test process runs the waiter with A's Stop payload; you answer A; the outsider never gets it, A's own waiter wakes A, and a refusal names the outsider's PID | a hub that doesn't check the waiter's process (the base: the token alone admits it); the message names the outsider's PID |

The issue's Proof also names `crates/deep-hook/tests/cli.rs` and the Claude Code delivery suite: those are the implementer's to extend; this suite runs the same real binary through #25's delivery suite's stand-in. `BASE-FAILURE.txt` holds the run on the base.

## How far these tests were checked

Type-checked with this folder's tsconfig, and run on the base four times on a heavily loaded machine (`BASE-FAILURE.txt`). Each criterion failed at its own assertion in at least one run: AC1 with no waiter exiting 2, naming the ask; AC2 and AC3 with the wrong waiter exiting 2 with the answer. Under the load, #25's `deep_ask` step sometimes read the hub as unreachable and the test was BLOCKED before its criterion; no run had all three reach their assertion. One earlier AC3 failure was this suite's own fault (`exec exec`), fixed. No fix exists, so the passing side of each test, AC1's 2 s bound, the own-waiter controls and AC2's and AC3's refusal assertions are unverified until one does.
