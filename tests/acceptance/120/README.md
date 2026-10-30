# Acceptance tests for #120: long waits shown in the chat, and promised checks that wake up

Written first, blind, from issue #120 (its body as of October 28, 2026: the three Scope bullets, the nine acceptance
criteria, the Proof line and Depends on), the design sections it leans on (Before each command: the "Commands end"
paragraph; Record rules; the asks shape; the adapter table's Claude Code and Codex rows; Numbers: the hot path and
idle CPU budgets and the timing relations; Criteria to tests and Criteria in a checked shape; Dogfooding), the #80
spike's record (`spikes/80/decision.json` and `spikes/80/hooks/hook.mjs`: the FileChanged route and its payload),
`AGENTS.md`, the conventions of the acceptance suites of #25 (routes), #83, #315, #18 and #44, the public entries the
surfaces build on (`packages/hub/src/index.ts`, `server.ts`, `core.ts`; `packages/adapters/src/types.ts` and
`shipped.ts`; `adapters/*.facts.json`; `packages/contracts`; `packages/cli`; `crates/deep-hook`) and base commit
`5a6d09a4` (main, "Merge pull request #785"), by a job that never saw an implementation; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

At the base the hub answers a PreToolUse, a PostToolUse or a FileChanged with nothing (no line, no deadline, no
`watchPaths`), records no expected time, overrun or wake-up, `deep setup` writes no FileChanged entry, Claude Code's
`wakeIdle` flag is false, and the hub knows no plant named `line-at-stop`. So every test fails there, at its
criterion's assertion (BASE-FAILURE.txt).

## How to run

With the workspaces built (`npm run build --workspaces`) and `target/debug/deep-hook` built:

```sh
npx vitest run --root tests/acceptance/120 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/120/tsconfig.json
```

- `--no-file-parallelism`: each file starts hubs and stand-in sessions, and `budgets.test.ts` times them.
- Every test makes its folders under `/tmp/dh120-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. It stops only
  processes it started, by PID, and the process groups its stand-in started for hook entries, by group ID. No child
  inherits a billing key, a `CLAUDE*` variable or a `DEEP_*` setting of the runner's. No test runs a live agent or
  reaches the network.
- `<tmp>/bin` is first on `PATH`: stand-ins for `launchctl`, `systemctl`, `claude` and `codex` (each logs its call
  and exits 0) and a `deep` that runs the built CLI, so `deep setup` can't register a login service on this Mac.
- The whole suite takes about four minutes on the base; the longest single test (AC3) about a minute. The only real
  waits are the issue's own: AC1 waits up to 12 s for the notification, AC2 3 s for no early wake, AC3 5 s for no
  further wake, the idle-CPU budget five times 3 s. Everything in minutes is the hub's test clock (Time, below).
- With `--root` here, Vitest writes its cache to `tests/acceptance/120/node_modules/.vite/`; delete it before committing.
- `budgets.test.ts` builds the merge base at `/tmp/dh120-base-<sha12>` when this checkout's code isn't the base's
  (kept between runs); remove it to reclaim the space.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub**: `deep hub run` with `HOME` the temporary home; its ready line; the socket's line protocol; a `cli`
  connection with the control token; `events.read`, `inbox.read`, `status.read` (the rows `deep status` prints,
  #19). `DEEP_HUB_PLANT=<name>` selects a planted program, and a name the hub doesn't know makes it exit at start
  (#16); `DEEP_HUB_TEST_CLOCK` starts the hub's clock at a given time (#16); `DEEP_HUB_TEST_CONFIRM` stubs the OS
  confirmation (#24).
- **`deep setup`** (#18): writes DeepBuild's entries into `~/.claude/settings.json`, among them the waiter, its one
  entry with `asyncRewake: true`. DeepBuild's entries are those whose command runs deep-hook or the deep CLI.
- **deep-hook** (#315, the hook protocol): `deep-hook <agent> <event>` with the hook's JSON on stdin, any event the
  agent fires; the hub's reply printed on stdout with its exit code. `deep-hook claude-code waiter` is the waiter,
  which asks the hub `session.wait` and exits 2 with what it was handed (#25).
- **The hook request line** (hook.request@3): `{v, agent, event, seq, id, pid, ppid, matched, payload}`, as
  deep-hook sends it; the hub's acknowledgement `{ack, hold_until_ms}` and reply `{exit, stdout, stderr}`.
  `budgets.test.ts` sends these itself over the socket, so the line's cost is read without a process start around it.
- **The record** (#14): `events.read`; `tool.before` and `tool.after` (each with `call`, the agent's ID for the
  call), `agent.stop`, `user.ask`, `ask.created`, `session.attention`; every event's `ts` is the hub's clock.
- **The adapter's flags**: adapter.caps@1 (`wakeIdle`, `startTurn`, `rewrite`, `editInput`, ...) through the
  adapters package's public entry, `shipped()` from `@deepbuild/adapters`, by the agent's registered name.
- **Claude Code's hook output** (its hooks reference, #80, #83): a reply's `systemMessage` is shown in the chat (the
  desktop app saves it as a `hook_system_message` attachment); `hookSpecificOutput.additionalContext` is read by the
  agent; a PreToolUse's `hookSpecificOutput.permissionDecision` decides the call and `hookSpecificOutput.updatedInput`
  changes it; a SessionStart reply's `hookSpecificOutput.watchPaths` are watched, and a change fires `FileChanged`
  with `{file_path, event: "change"}` whose reply's `systemMessage` shows as a notification in the terminal
  (spikes/80: the one route while a call still runs; none in the desktop app, Codex CLI or Codex Desktop). Codex
  reads the same output shapes from `~/.codex/hooks.json` entries.

### Defined here, where the issue and the design leave a surface open

1. **The Claude Code stand-in** (`fixtures/claude.mjs`, #83's and #25's joined) is Claude Code's side of the hook
   contract, the boundary these tests don't own. One process per session; it runs each entry of the user settings
   file with `/bin/sh -c`, the payload on stdin, each in its own process group; a synchronous entry is waited for, an
   `asyncRewake` one runs in the background, and when it exits 2 the idle session wakes with a turn whose
   UserPromptSubmit prompt is a task-notification carrying the entry's stderr (#80). It saves each `systemMessage` as a
   `hook_system_message` attachment and writes the hook log. For #120 it adds only #80's route: every path a reply
   names in `watchPaths` is watched (polled every 100 ms), and a change fires `FileChanged` with the spike's payload
   (`session_id`, `transcript_path`, `cwd`, the running turn's `prompt_id`, `file_path`, `event: "change"`), reported
   as `{fileChanged: {path, at, fired}}`. Codex's hooks are run directly, `deep-hook codex <event>` with a
   Codex-shaped payload (`turn_id`, `model`, `permission_mode`), as the entry Codex runs.
2. **Time.** Nothing waits minutes. The hub's clock is `DEEP_HUB_TEST_CLOCK`, set only at start (#16), so "20 minutes
   on" is the hub stopped and started again on the same record with its clock 20 minutes ahead (`moveOn`), as #25's
   AC6 did; the waiter Claude Code started keeps waiting across the restart (its life is its session's) and asks the
   new hub again. Durations in the record are therefore differences of event `ts`, the hub's clock, never of
   deep-hook's `seq` (wall ns), which doesn't move. An implementation that measures a call's run or a turn's age from
   `seq`, or from in-process timers alone, fails these tests on the base-like path; that is a dispute for a blind
   redraft, not an edit, since the design's record rules make projections functions of events alone.
3. **Expected time.** Comes from the command's history, the same command's earlier runs in the same session (design:
   "from its kind and from how long the same command took before"). AC1 gives `npm run build` three runs of about one
   second of wall time (the stand-in waits a second between PreToolUse and PostToolUse) and reads the fourth's
   expected time as at most about a second: the notification must come within 12 s of its start (10 s past the
   expected time, plus the second, plus a second for polling). AC6 gives `npm run e2e` two runs of 90 s of hub time
   (Time, above) so the third is expected to take over a minute. A kind's default that puts a one-second command's
   expected time past 2 s fails AC1 here, and goes to a redraft.
4. **Where the line shows.** In Claude Code's chat, a line you can read is the reply's `systemMessage`; while a call
   still runs, it is a FileChanged reply's `systemMessage` (the terminal's notification). What the agent hears is the
   reply's `hookSpecificOutput.additionalContext` (or a block's reason). In Codex, the same shapes from its entry's
   reply. Tests read these at the agent's side only, never from the hub.
5. **The line's words** are matched loosely, by what the issue says the line carries: what it waits on (the command's
   text, or its tool name), a duration (`12 s`, `3m`, `2 min`, `1h 5m`, `0:45`, ...), and for the 10-minute line the
   ask (words of the typed prompt), the step (the running command), the time so far and the time left (the word
   `left` or `remaining`). A due time is a clock time (`09:40`, an ISO stamp) or a duration (`in 20 min`).
6. **The promise** is the agent's last words, "I'll check the deploy again in 20 minutes." (Claude Code: the
   transcript's assistant entry and the Stop payload's `last_assistant_message`; Codex: the Stop payload), a relative
   time so its due time is the stop's `ts` plus 20 minutes, within 2 minutes. "In the morning", the issue's example,
   needs a reading of when morning is; the tests don't use it.
7. **The wake-up record.** The issue names the fields' meanings, not their names, and the record's kind for it isn't
   fixed either. A test reads the wake-up as the session's event whose data carries the quote, leaving out the kinds
   that echo the agent's words (`agent.*`, `tool.*`, `user.*`, `session.*`, `claim.*`, `verdict.*`, `turn.*`). In its
   data: the due time is a value (ms or seconds since the epoch, or an ISO string) about 20 minutes after the stop;
   how many times it has been set is a number under a key naming `set`, `times`, `count` or `attempt`, 1 at first;
   the end is a time under a key naming `end` (the issue's own word), after the due time. A record that spells these
   otherwise fails AC3 naming the event, and is a dispute for a redraft.
8. **BLOCKED with a named owner** (AC3): an event of the session whose data says `BLOCKED` and names the deploy
   check, with the word `service` or `you`; "at most one ask" is the inbox (`inbox.read`) holding at most one ask
   about the deploy; "no further wake-up fires" is no wake of the session within 5 s of the next due time passing.
9. **Set again** is the agent making the same promise in the woken turn and stopping; "past its end" is the wake
   coming after the record's `end` (the clock moved past it) and the agent promising again in that turn.
10. **The session's row** (AC4) is `status.read`'s row for the session (what `deep status` prints: `id`, `state`,
    `agent`, `why`): its JSON says `due` and carries a time. "Starts nothing" is no `user.ask`, `tool.before` or
    working `session.attention` for the Codex session between its due time and its next prompt.
11. **Permission modes** (AC5): "can ask you about commands" is the hook payload's `permission_mode: "default"`;
    "bypasses approvals" is `"bypassPermissions"`, for Claude Code and (as #83's suite spelled it) for Codex. "Asked
    about exactly as it would be without DeepBuild" is the PreToolUse reply carrying none of `decision`,
    `continue: false`, `hookSpecificOutput.permissionDecision`, `permissionDecisionReason`, `decision`,
    `updatedPermissions` and no `updatedInput`, and Claude Code's PermissionRequest for the call carrying no decision.
    "Its deadline attached" is `hookSpecificOutput.updatedInput.command` that still runs the original and differs from
    it; the wrapper's words aren't asserted.
12. **The overrun recorded** (AC5): an event of the session whose kind or data says `overrun` and names the call's ID
    or its command. "An overrun reaches the agent at its next hook" (AC8): the `additionalContext` of the call's
    PostToolUse reply or, failing that, of the PreToolUse right after it, naming the command and a duration. "Never
    you": no `ask.created` or `user.ask` about the command and nothing about it in the inbox.
13. **Budgets** (AC9, modeled on #83's): the line's cost is the median round trip of a PostToolUse line whose reply
    carries the overrun line (its call opened 30 minutes of hub time earlier) minus the median of one whose reply
    carries none, 150 of each, interleaved, after a warm-up; five runs judged against under 1 ms by the design's rule
    (PASS when all under; FAIL when all over by more than the larger of 5% and the runs' spread; else INCONCLUSIVE).
    The instrument comes first: at least 135 of the 150 "with" replies must carry a line (a `systemMessage` or
    `additionalContext` with a duration), else the measurement fails naming it, so a hub that says nothing can't pass
    by costing nothing. The merge base is measured by the same driver on its own build; its "without" median is the
    reading this checkout's must not regress from (more than 50% above and more than 1 ms). Idle CPU: a session that
    promised the check (the wake-up recorded, the instrument) and stopped; `ps` cputime of the waiter's process group
    and of the hub before and after 3 s, five times: the waiter's delta at most 0.01 s (`ps` counts hundredths), the
    hub's at most 0.5% of a core plus a hundredth. Readings count only on a reference Mac (Mac15,7 with an M3 Pro and
    36 GB, or Mac15,12 with an M3 and 16 GB), Low Power Mode off, thermal state nominal, not loaded past its core
    count; anywhere else the test skips as INCONCLUSIVE with the readings, never PASS. "In the local preflight": some
    check lane in `scripts/lanes.mjs` runs `budgets.test.ts` with `--no-file-parallelism`, not excluded.

### Open interfaces (the implementation's to choose; recorded so a dispute can be judged)

- **`DEEP_HUB_PLANT=line-at-stop`**: the planted wrong program AC7 names, a hub whose line waits for the turn's stop,
  listed in `packages/hub/src/wire.ts`'s plants and mapped in `twins.json` (`#120.557a037b`). On the base the hub exits
  on the unknown name, so the plant test fails there with the hub's BLOCKED, not with the planted failure.
- **The FileChanged entry**: `deep setup` must write a FileChanged entry of DeepBuild's into Claude Code's settings
  and answer SessionStart with `watchPaths`; which path is watched, and how the hub finds it again after a restart,
  is the implementation's.
- **The route from the flags** (AC4): a wrong program that routes by the agent's name is behaviorally the same as a
  right one while the two shipped agents' names and flags agree, so no planted twin distinguishes them; the test
  asserts the flags themselves (Codex `wakeIdle` and `startTurn` false, Claude Code `wakeIdle` true) and that Codex's
  behavior matches them. A Codex deadline is asserted only if its `rewrite` flag says it can change a command.
- **Which hook is "the call's next hook"** for the overrun (AC8): the PostToolUse of the call, or the PreToolUse after
  it; both are accepted.

## Criteria to tests

Each test's name starts with its criterion's number and ID, `#120.<first 8 hex of SHA-256 of the criterion's text,
trimmed, whitespace collapsed>`, as `scripts/proof-change.mjs` computes it.

| ID | Criterion (verbatim) | Surface | Test | Fails at the base, and on |
|---|---|---|---|---|
| AC1 `#120.7edb0b65` | In the Claude Code terminal, through the route #80 found (a FileChanged notification), a command running past its expected time shows a line on screen within 10 s while it still runs | SessionStart reply `watchPaths`; FileChanged hook input and reply `systemMessage`; the transcript's `hook_system_message` | `overrun.test.ts`: three runs of `npm run build` of about a second, then a fourth left running: a FileChanged reply's `systemMessage` within 12 s of its start, while no `tool.after` for it exists, naming the command and a duration | the base: no `watchPaths`, no FileChanged entry, no notification ("within 12000 ms ... carried a systemMessage") |
| AC2 `#120.4c1ac190` | A promised later check wakes an idle Claude Code session at its time without you typing | the waiter (`deep-hook claude-code waiter`, exit 2) and the turn it starts at Claude Code's side; the record's wake-up | `wakeup.test.ts`: the session says the quote and stops; the wake-up is recorded with a due time about 20 minutes on; nothing wakes it for 3 s; the clock moved 21 minutes on, the waiter wakes it within 30 s with a task-notification naming the deploy check | the base: no wake-up recorded ("the promise ... is recorded as a wake-up") |
| AC3 `#120.5f22a00c` | A promise set again a fourth time, or past its end, becomes BLOCKED with a named owner (the service or you) and at most one ask, and no further wake-up fires | the record (the wake-up's times set, `end`, BLOCKED with owner); `inbox.read`; the waiter | `wakeup.test.ts`: (1) set once, then re-promised in three woken turns: BLOCKED naming `service` or `you`, at most one ask, no wake 5 s after the next due; (2) the clock moved past the record's `end`, the agent re-promises in the late wake's turn: BLOCKED, at most one ask, no further wake | the base: no wake-up recorded |
| AC4 `#120.5568c5c4` | Where the adapter can't wake an idle session, as in Codex, whose hooks never start a turn, a wake-up that comes due starts nothing: the session's row shows it due from its time, and the session's next prompt or stop carries the promised check with its quote and due time; the route comes from the adapter's flags, never the agent's name | `deep-hook codex` hooks and their replies; `status.read` rows; adapter.caps@1 through `shipped()` | `codex.test.ts`: a Codex session promises and stops; 21 minutes on no prompt, call or working state; its row says `due` with a time; the next UserPromptSubmit's `additionalContext` carries the quote and a time. The flags: Codex `wakeIdle` and `startTurn` false, Claude Code `wakeIdle` true | the base: no wake-up recorded; Claude Code's `wakeIdle` is false |
| AC5 `#120.4494c783` | In a Claude Code or Codex session that can ask you about commands, a `tail -f` call is asked about exactly as it would be without DeepBuild, with no deadline attached and its overrun recorded; in a session that bypasses approvals, the same call gets its deadline, and a Claude Code rewrite carries no permission decision | PreToolUse and PermissionRequest replies (Claude Code, Codex); the record | `deadline.test.ts`: default mode: no decision keys, no `updatedInput`, PermissionRequest undecided, overrun recorded 30 minutes on (both agents); bypass: Claude Code's `updatedInput.command` wraps `tail -f` with no decision key; Codex's deadline only if its `rewrite` flag is true | the base: no overrun recorded (default); no `updatedInput` (bypass) |
| AC6 `#120.67021934` | A wait expected to take over a minute shows what it waits on and its expected time in the chat when it starts | PreToolUse reply `systemMessage`; the transcript | `start.test.ts`: `ls` with no history shows nothing; two runs of `npm run e2e` of 90 s of hub time; the third's PreToolUse reply carries a `systemMessage` naming `e2e` and a duration, in the transcript | the base: no line ("the PreToolUse reply ... carries the line") |
| AC7 `#120.557a037b` | A turn or wait that runs 10 minutes without a line you can read gets one at its next hook after each 10 minutes: the ask, the step, the time so far and the time left; in the Claude Code terminal, through the route #80 found, it also gets one every 10 minutes while a single call still runs. A planted line that waits for the turn's stop shows none during a 25-minute turn of short calls and fails this test | PreToolUse reply `systemMessage`; FileChanged reply `systemMessage`; `DEEP_HUB_PLANT=line-at-stop` | `tenminutes.test.ts`: (1) a turn of short calls at 0, 10.5, 21 and 25 minutes: lines at the 10.5- and 21-minute hooks (ask, step, duration, `left`/`remaining`), none at 25; (2) a single call: a FileChanged notification after the clock moves 10.5 minutes, and another after 21; (3) the plant fails (1) at the 10.5-minute hook | the base: no line at 10.5 minutes; no notification; the plant name unknown (BLOCKED) |
| AC8 `#120.af5921ee` | A command that never ends on its own gets its deadline attached where the adapter can change it, and an overrun reaches the agent at its next hook, never you | PreToolUse reply `updatedInput`; PostToolUse / PreToolUse reply `additionalContext`; the record's asks; `inbox.read` | `overrun.test.ts`: bypass session: `tail -f` rewritten with no decision key; 30 minutes on, the PostToolUse (or next PreToolUse) reply's `additionalContext` names `tail -f` and a duration; no `ask.created`/`user.ask` or inbox ask about it | the base: no `updatedInput` |
| AC9 `#120.a3880a7d` | Budgets, on the reference Mac in the local preflight, compared with the merge base: the line costs under 1 ms in the hook path, and an idle session costs no CPU while it waits | `scripts/lanes.mjs`; hook request lines over the socket and their replies; `ps` over the waiter's group and the hub | `budgets.test.ts`: (1) a lane runs the file one at a time; (2) the instrument (the "with" replies carry a line), then median with minus without under 1 ms over five runs, no regression of the "without" median from the merge base; (3) the wake-up recorded (instrument), then five 3 s idle samples with no CPU | the base: no lane (1); no reply carries a line (2); no wake-up recorded (3) |

Every test fails on the base at the assertion named, not at load (BASE-FAILURE.txt). The on-screen part of AC1, AC2
and AC7 (the notification in the terminal, the session waking with nobody typing) is proven by the issue's Proof line,
recordings of real sessions, as #25 and #80 did; here the automated part is the reply the terminal acts on and the
turn the stand-in starts for a waiter's exit.

## Files

- `helpers.ts`: temp homes and stand-in tools, `deep setup`, the hub as a process, its clock (`moveOn`) and socket,
  the record and the session rows, sessions and transcripts, the stand-in's client (hooks, wakes, FileChanged), Codex's
  hooks, decisions in a reply, raw hook request lines, the reference-Mac gate and the merge base.
- `fixtures/claude.mjs` (the Claude Code stand-in), `fixtures/stub-bin.sh` (launchctl, systemctl, claude, codex).
- `overrun.test.ts` (AC1, AC8), `wakeup.test.ts` (AC2, AC3), `codex.test.ts` (AC4), `deadline.test.ts` (AC5),
  `start.test.ts` (AC6), `tenminutes.test.ts` (AC7), `budgets.test.ts` (AC9).
- `twins.json`: the criterion the planted wrong program `line-at-stop` is named by.
- `BASE-FAILURE.txt`: the run on the base commit and why each test fails there.
