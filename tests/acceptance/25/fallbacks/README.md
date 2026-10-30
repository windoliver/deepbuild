# Acceptance tests for #25: the fallback routes

Written first, blind, from issue #25 (its body as of October 27, 2026), the design sections it links and those around
them (An ask, and your answer getting back; What each agent gives us, the Claude Code row and the bullets after it;
Hooks are evidence: Unknown not finished, Threads not IDs; Hook protocol; Extension API; States people see; Numbers:
Timing relations, the Stop continuations row; Dogfooding), the #80 spike's record (`spikes/80/decision.json` and its
logs), Claude Code's facts (`adapters/claude-code.facts.json`) and base commit `0350cf0`, by a job that never saw an
implementation of #25. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

**Redrafted blind for the Oct 29 amendment** (issue #25's scope and the design's Claude Code row and Waiter
guardrail, amended for #85): setup writes the waiter's entry under Stop and under StopFailure, with the same command
and timeout. The only change here is the setup precondition below, which now expects that pair; no test, name or
expected value changed. These tests fire no StopFailure, so the stand-in is unchanged.

The issue has 12 checkbox criteria, AC1 to AC12 in the body's order. **This folder covers AC5, AC7, AC9 and AC10.**
Two other blind jobs cover the rest in `../routes/` (AC1–AC4, AC6, AC11, AC12) and `../live/` (AC8 and the live runs).

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm run build --workspaces`) and `target/debug/deep-hook` built:

```sh
npx vitest run --root tests/acceptance/25/fallbacks --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/25/fallbacks/tsconfig.json
DEEP_HUB_PLANT=no-stop-count npx vitest run --root tests/acceptance/25/fallbacks --no-file-parallelism cap.test.ts   # a wrong program
```

- `--no-file-parallelism`: each file starts a hub. The suite takes several minutes: a stop held for an open ask waits
  out the hub's 60 s hold, and a `deep_ask` call ends "still waiting" after the hub's 40 s.
- Every test makes its folders under `/tmp/dh25f-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. It stops only
  processes it started, by PID. No child inherits a billing key, a `CLAUDE*` variable or a `DEEP_*` setting of the
  runner's, except `DEEP_HUB_PLANT`, which reaches the hub, `deep setup`, the stand-in and so deep-hook and `deep mcp`.
- `<tmp>/bin` is first on `PATH`: stand-ins for `launchctl`, `systemctl` and `claude` (each logs its call and exits
  0; `claude --version` answers the newest version the facts cover) and a `deep` that runs the built CLI.
- No live Claude Code runs here and nothing spends plan usage. With `--root` here, Vitest writes its cache to
  `node_modules/.vite/` in this folder; delete it before committing.
- Machine load: deep-hook gives up on a hub that hasn't acknowledged within 50 ms (#315), so on a badly loaded Mac a
  hook can miss the hub. A test that then fails on one hook's reply should be rerun, with the run's machine state kept.
  A missed Stop acknowledgement lets the stop through while the hub still holds it, so AC5 and AC9 answer an idle
  session only once 61 s have passed since its stop's hook started (`pastHold`), past any hold. AC10 answers during
  holds and has no such guard: a missed acknowledgement there fails a continuation, and the run is rerun.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub**: `deep hub run` with `HOME` the temporary home; its socket's line protocol on a `cli` connection with the
  control token; `events.read`, `sessions.read` (a session's row, #34) and `inbox.read`; `DEEP_HUB_PLANT=<name>` selects
  a planted program (#16); `DEEP_HUB_TEST_CONFIRM` stands for the OS confirming you (#24).
- **`deep setup`** writes DeepBuild's hook entries into `~/.claude/settings.json`, among them one foreground Stop entry
  (the stop hold) and the waiter's `asyncRewake` entry, once under Stop and once under StopFailure with the same
  command and timeout (#18; amended Oct 29), and nowhere else; anything else is BLOCKED. Its timeouts are as setup
  writes them.
- **deep-hook** as those entries run it, and the hook protocol's reply: a held Stop answers `decision: block` with a
  reason; a prompt or a session start gets `additionalContext` (#18, #315).
- **`deep mcp`**, bound to the session whose hooks came from its parent process: `deep_ask` files an ask under it and
  ends "still waiting" past the hub's wait; `deep_claim` records a claim with its `task_ref` (#26).
- **`deep inbox answer <ask> <option>`** (#24) is your answer.
- **`delivery.outcome@1`** events (`delivery`, `via`, `outcome`), read only to see that nothing delivered an answer
  that must still wait (AC7) and in failure messages.

### Defined here, where the issue and the design leave a surface open

1. **The Claude Code stand-in** (`fixtures/claude.mjs`, copied from `../../18/install/fixtures/claude.mjs` and
   extended) is Claude Code's side of the hook contract, modelled on the facts and the #80 record only. One process is
   one Claude Code process. Beyond the #18 copy:
   - A Stop whose DeepBuild entry blocks (exit 2, or `decision: "block"`) continues the turn: the reason is written to
     the transcript as a user entry `Stop hook feedback:\n<reason>` (the #80 desktop transcript's shape), and the next
     Stop says `stop_hook_active: true` (the facts' continuation field).
   - **Claude Code's cap**: 8 blocks in a row, as #80 recorded ("continued 8 send-backs in a row and overrode the 9th";
     "the count resets at a tool call"). The block that would be the 9th is overridden: the turn ends and its reason
     reaches neither the model nor the transcript. A PreToolUse (a tool call) and a typed prompt reset the count.
   - **A wake**: an `asyncRewake` entry that exits 2 while the session is idle makes the stand-in write the
     task-notification #80 recorded (a `queue-operation` enqueue and a user entry, `Stop hook blocking error from command
     "Stop": <stderr>`) and fire UserPromptSubmit with it as the prompt; the Stop after it says `stop_hook_active: true`,
     as #80 recorded. An exit 2 during a turn is queued until the turn ends.
   - **A desktop app that doesn't wake** (`wakes: false`): the exit 2 is noted and nothing else happens. Its transcript
     entries say `entrypoint: "claude-desktop"`.
   - **The waiter's hook disabled for one session** (`skip: ['asyncRewake']`): that session's Claude Code runs no
     `asyncRewake` entry, under Stop or under StopFailure; every other session's does.
   - A reply's `additionalContext` is written to the transcript as a `hook_additional_context` attachment.
2. **A held-stop answer** is a Stop the hub holds while the session's ask is open, answered with `deep inbox answer`
   during the hold; "goes back through the Stop hook" is DeepBuild's Stop reply blocking with it and the stand-in
   continuing the turn.
3. **A planted send-back** is the test-only hub method `test.send_back` (Additions, 1).
4. **"By the next prompt"** is DeepBuild's reply to the session's next UserPromptSubmit carrying it, exit 0 and not
   blocking. For AC10's ninth, a wake's prompt that carries it also counts, so long as it reaches the session once.
5. **The view, and a session's row** (AC9, AC10): what a person is shown about the session or the ask: its row in
   `sessions.read`, the inbox rows, and every event that isn't a hook's own (`session.start`, `user.ask`,
   `tool.before`, `tool.after`, `permission.request`, `agent.stop`, `session.end`, `task.completed`) and is about the
   session (its `session`) or names the ask's handle, each read as JSON text. Only text new since the moment in
   question counts. AC9's text says the session wasn't woken (`wak`/`woke`) and `next prompt`; AC10's names the cap
   (`8` or `eight`), the continuations (`continu`, `in a row`, `consecutive` or `cap`) and `next prompt`.
6. **Threads** (AC7): a resume is a new Claude Code process run as `claude --resume <id>` (the stand-in carries those
   words on its command line), with the same session ID and transcript, its SessionStart `source: "resume"`
   (Claude Code reuses the ID unless `--fork-session`). `/clear` is SessionEnd `reason: "clear"` then SessionStart
   `source: "clear"` with a new ID in the same process; `/compact` is SessionStart `source: "compact"` with a new ID in
   the same process, as the design says both rotate the ID.
7. **Working a task** (AC7) is claiming it with `deep_claim`'s `task_ref`, the one surface a session names its task
   by. "Reads it" is any DeepBuild reply to that session's hooks, or a `deep_*` result, carrying the answer after the
   claim; "gets nothing" is none carrying it.
8. **An ended session** (AC7) asked, then you pressed Esc while it waited (no Stop fires, so no hold and no waiter) and
   quit, cleared or compacted.

### Additions the implementation must make

1. **`test.send_back`**, a hub method on a `cli` connection, served only when the hub runs with
   `DEEP_HUB_TEST_SEND_BACK=1` (otherwise refused as `unknown_method`, like `test.load` outside the test VFS). Params
   `{ "session": "<session ID>", "reason": "<text>" }`; any result. It plants one send-back for that session's next
   Stop: the hub answers that stop as it answers a send-back, `decision: block` with the reason, counted in the
   per-turn count like any send-back, and past the cap it goes by the next prompt instead. Each planted send-back is
   delivered once. The suite starts every hub with `DEEP_HUB_TEST_SEND_BACK=1`.
2. Six planted hubs, selected with `DEEP_HUB_PLANT` and listed in `packages/hub/src/wire.ts`'s plants:

   | Name | What the plant does wrong | Criterion | How the test fails on it |
   |---|---|---|---|
   | `routes-from-settings` | counts a route by the entries your settings declare, not by what the session has shown: takes session A's waiter route as present and leaves A's idle answer for that waiter, so A's next prompt doesn't carry it | AC5 | `flags.test.ts`: "session … showed no waiter, so the waiter route is absent for it and your answer to ask:… must arrive through the next route, DeepBuild's reply to its next prompt" |
   | `routes-kept-across-sessions` | keeps what a session has shown past its end, for the next session in the same worktree: B's waiter route reads absent and B's waiter never gets the answer | AC5 | `flags.test.ts`: "session … is a new session: it starts again from its declared flags … its waiter must wake it with your answer to ask:… within 15 s" |
   | `ended-answer-to-worktree` | gives an ended session's answer to the next session that starts in its worktree | AC7 | `ended.test.ts` (both tests): "session … is a new session on other work in the same worktree: it gets none of the answers" (or "gets nothing of the answer") |
   | `wake-assumed` | takes the waiter's exit 2 as the wake: records the answer delivered and never looks for the woken turn | AC9 | `desktop.test.ts`: "the desktop app didn't wake, so the view must say so …" |
   | `stop-count-never-resets` | keeps the per-turn count but never resets it at a tool call | AC10 | `cap.test.ts`: "turn 2 (prompt_id …) of session …: continuation 9, the answer to ask:…, must go back through the Stop hook" |
   | `no-stop-count` | no count: blocks every stop it has something for | AC10 | `cap.test.ts`: "turn 1 (prompt_id …) of session …: DeepBuild blocked the 9th stop in a row … Claude Code overrode it (cap 8), so the send-back … was lost" |

   `tests/acceptance/25/twins.json` (outside this folder) should map `#25.c5d6abef` to `routes-from-settings` and
   `routes-kept-across-sessions`, `#25.3010b97e` to `ended-answer-to-worktree`, `#25.14a7bfb8` to `wake-assumed`, and
   `#25.3d50cff2` to `stop-count-never-resets` and `no-stop-count`, each with its twin folder under
   `tests/acceptance/25/twins/` as `scripts/proof-runs.mjs` reads them.

## Criteria to tests

Each test's name starts with its criterion's number and ID, `#25.<first 8 hex of SHA-256 of the criterion's text,
trimmed, whitespace collapsed>`, as `scripts/proof-change.mjs` computes it.

| ID | Criterion (short) | Test | Wrong program it fails on |
|---|---|---|---|
| AC5 `#25.c5d6abef` | waiter's hook disabled for one session: its answers by the next route; a new session starts again from its declared flags | `flags.test.ts`: A runs no waiter; its stop is held and let go; you answer while it's idle; A's next prompt carries the answer, once. B, new, same worktree, waiter on: its waiter wakes it with your answer within 15 s | `routes-from-settings`, `routes-kept-across-sessions` (above). The base passes it: it has no route flags, so every route is always tried |
| AC7 `#25.3010b97e` | an ended session's answer reaches only the same thread at SessionStart; otherwise it waits on its task, the next session working the task reads it, a new session on other work in the worktree gets nothing | `ended.test.ts` (two): three sessions ask and end (quit, `/clear`, `/compact` then quit); you answer; a new session in the worktree gets none; C2 at its `clear` SessionStart, R resumed and K2 resumed each read their own answer and no other, once. A works `task:T…`, asks and ends; you answer; D (other task, same worktree) gets nothing; nothing has delivered it; C claims `task:T…` and reads it once | the base (SessionStart gives only its briefing); `ended-answer-to-worktree` |
| AC9 `#25.14a7bfb8` | desktop app doesn't wake: the view says so, the answer falls back to the next prompt | `desktop.test.ts`: in a desktop app that doesn't wake, the waiter exits 2 with your answer; within 60 s the view says the session wasn't woken and the answer goes at the next prompt; your next prompt carries it, once | the base (marks it delivered at the waiter's exit, says nothing, and the next prompt is empty); `wake-assumed` |
| AC10 `#25.3d50cff2` | cap 8: eight continuations through the Stop hook, the ninth by the next prompt with the row saying why; a tool call after the fourth lets all nine through; never-reset and no-counter fail naming the turn | `cap.test.ts`: turn 1: four asks, then answer/send-back ×4 through the Stop hook, the 9th (a send-back) not blocked, the row naming the cap of 8 and the next prompt, turn 2's prompt carrying it once; turn 2: five asks, four stops, `ls -a`, five stops, all nine through the Stop hook | `stop-count-never-resets`, `no-stop-count` (above); the base, which serves no `test.send_back` and keeps no count |

## Disputes

1. **AC5 on the base.** The base tries every route every time, so it already delivers an idle answer at the next
   prompt and lets every waiter wake its session; the behaviour the criterion names holds there, and only the planted
   programs show the tests catching route flags read wrongly. What else the flags change (what the view says while an
   answer waits, holds) isn't in the criterion, so it isn't tested here.
2. **"In its decision"** (AC7). An answer is saved as a decision only when you choose to (#318's `saveDecision`), and
   "its task's line" names no read surface the base has. The tests read both through their effect: the answer stays
   undelivered until the next session that works the task, which reads it, and no other session gets it.
3. **AC7's /clear gap.** In Claude Code `/clear`'s SessionEnd and SessionStart come milliseconds apart; the test
   answers between them, and a new session starts in the worktree, so the gap is long. The process, and the waiter
   it may have left running, are those of the real case.
4. **AC10's ninth and the waiter.** Design and issue say the ninth "goes by the next prompt". A waiter's wake arrives as
   a prompt too, but #80 recorded the Stop after a wake with `stop_hook_active: true`, so Claude Code may count it as a
   stop-hook continuation. The test accepts either, once, and leaves wakes during held stops to AC4 and AC12 in
   `../routes/`.
5. **Planting send-backs.** Send-backs come from checks and claims' verdicts, which the base doesn't send back yet,
   and the criterion asks for planted ones; `test.send_back` is the least surface that plants one without a check.

## Files

- `helpers.ts`: temp homes and stand-in tools, `deep setup`, the hub and its socket, your answers, the view, the
  stand-in's client, asks.
- `fixtures/claude.mjs` (the Claude Code stand-in), `fixtures/stub-bin.sh` (launchctl, systemctl, claude).
- `flags.test.ts` (AC5), `ended.test.ts` (AC7), `desktop.test.ts` (AC9), `cap.test.ts` (AC10).
- `BASE-FAILURE.txt`: the run on the base commit and why each test fails, or passes, there.
