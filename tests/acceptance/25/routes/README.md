# Acceptance tests for #25: the routes an answer takes back into Claude Code

Written first, blind, from issue #25 (its body as of October 27, 2026), the design sections it links (An ask, and
your answer getting back; What each agent gives us, and the limits we design around; Hooks are evidence, not a state
machine; Hook protocol; Extension API), the #80 spike's record (`spikes/80/decision.json` and its logs), Claude
Code's facts (`adapters/claude-code.facts.json`) and base commit `0350cf0`, by a job that never saw an implementation
of #25. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job.

The issue has 12 checkbox criteria, AC1 to AC12 in the body's order. **This folder covers AC1, AC2, AC3, AC4, AC6,
AC11 and AC12.** Two sibling blind jobs cover the rest: `../fallbacks/` (AC5, AC7, AC9, AC10) and `../live/` (AC8 and
the harness runs).

## How to run

With the workspaces built (`npm run build --workspaces`) and `target/debug/deep-hook` built:

```sh
npx vitest run --root tests/acceptance/25/routes --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/25/routes/tsconfig.json
```

- `--no-file-parallelism`: each file starts its own hub and many stand-in sessions (AC2 and AC6 run twenty at once).
  A full run takes about 15 minutes; AC6 alone about 5.
- Every test makes its folders under `/tmp/dh25r-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. It stops only
  processes it started, by PID, and the process groups its stand-ins started for hook entries, by group ID. No child
  inherits a billing key, a `CLAUDE*` variable or a `DEEP_*` setting of the runner's. No test runs a live agent.
- `<tmp>/bin` is first on `PATH`: stand-ins for `launchctl`, `systemctl` and `claude` (each logs its call and exits
  0) and a `deep` that runs the built CLI, so `deep setup` can't register a login service on this Mac.
- With `--root` here, Vitest writes its cache to `tests/acceptance/25/routes/node_modules/.vite/`; delete it before
  committing.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub**: `deep hub run` with `HOME` the temporary home; its ready line; the socket's line protocol; a `cli`
  connection with the control token; `events.read`. `DEEP_HUB_PLANT=<name>` selects a planted program, and a name the
  hub doesn't know makes it exit at start (#16); `DEEP_HUB_TEST_CLOCK` starts the hub's clock at a given time (#16);
  `DEEP_HUB_TEST_CONFIRM` names a file holding `confirmed`, the OS confirmation stubbed (#24).
- **`deep setup`** (#18): writes DeepBuild's entries into `~/.claude/settings.json`, among them the waiter, DeepBuild's
  one entry with `asyncRewake: true`, with its `timeout`. DeepBuild's entries are those whose command runs deep-hook or
  the deep CLI (as #18's install suite reads them).
- **`deep mcp`** started by the session's process and `deep_ask` filing an ask under that session (#26); the ask is
  the `ask.created` event of that session with that question, its handle `ask:<event id>`. **`deep inbox answer <ask>
  <option>`** (#24): you answer.
- **`delivery.outcome@1`** in the record, `{delivery, via, outcome}` with `outcome` one of `delivered`, `stalled`,
  `timed_out`, `replaced` (packages/contracts). A delivery is an ask's when `delivery` (or the event's `subject`) is
  its handle or its bare ID. `delivered` is the issue's "delivered and acknowledged".
- **Your settings**: `~/.deepbuild/config.json`'s `asks.deadline` block (#318), where each kind's deadline lives.

### Defined here, where the issue and the design leave a surface open

1. **The Claude Code stand-in** (`fixtures/claude.mjs`, copied from #18's and extended) is Claude Code's side of the
   hook contract, the boundary these tests don't own. One process per session. It runs each command entry of the user
   settings file with `/bin/sh -c`, the payload on stdin, each in its own process group, synchronous entries waited
   for and stopped at their `timeout`, `async`/`asyncRewake` entries in the background, and it starts its own `deep
   mcp`. What it adds is only what the facts and #80 recorded:
   - A synchronous Stop entry's block (exit 0 with `{"decision":"block","reason":…}`, or exit 2 with stderr) continues
     the turn: it writes a user entry `Stop hook feedback:\n<reason>` into the transcript (#80's desktop transcript).
   - An `asyncRewake` entry that exits 2 wakes the session: if no turn is running (the last Stop went through), a turn
     starts at once with a `queue-operation` enqueue and a user entry in the transcript, then a UserPromptSubmit whose
     prompt is `<task-notification>…Stop hook blocking error from command "Stop": <the entry's stderr>…` (#80, Claude
     Code 2.1.303 and the desktop app); if a turn is running, the wake waits until that turn's Stop goes through.
   - A Stop starts the waiter entry again and never stops an earlier one; earlier ones run on until their timeout
     (#80: "Earlier waiters keep running in the desktop app ... the adapter must end the old waiter itself").
   - `configure({wake:false})` is a Claude Code that doesn't start a turn on that exit (the exit is still reported).
   - `end` is a session ending: Claude Code stops its `deep mcp` and exits, and leaves its background entries to end
     on their own; `kill` is its process killed. Either way nothing it started is stopped for DeepBuild.
   - `expire(seconds)` is Claude Code's clock for its background entries moved on: each still running whose timeout
     is at most `seconds` is stopped, as Claude Code stops a hook at its timeout.
2. **An asking session** (`askingSession`): SessionStart; a prompt you typed; the agent's `deep_ask` call (a choice,
   two options, blue recommended), its PreToolUse first, Claude Code waiting for the call as for any tool call until
   deep_ask says it is still waiting, its tool_use and tool_result in the transcript, its PostToolUse; the agent's last
   words. The Stop comes after, as it does in a real turn. You answer green.
3. **"While the stop is held"**: the Stop of a session whose ask is open hasn't ended 2 s after the waiter Claude Code
   started at it is running. **"Idle"**: the session's Stop went through with no decision (its hold ended with no
   answer), so no turn is running and its waiter waits.
4. **Routes, read at Claude Code's side.** The Stop hold delivered when the Stop's reply blocks with a reason carrying
   the answer (the option's label or ID). The waiter delivered when it exits 2 (its stderr carrying the answer), and
   the session woke when the stand-in started a turn for that exit. **"Exits without waking"**: the waiter that was
   alive when you answered has exited, with a code other than 2, within 15 s, and no wake for the session follows.
5. **The answer's ID** is its ask's ID or its `ask.answered` event's ID. **"The transcript shows it once"**: exactly one
   transcript entry carries one of them, leaving out entries holding a tool call or a tool result (the agent's own
   deep_ask call and reply name the ask and aren't a delivery).
6. **A waiter process for a session** (AC3, AC12): a background `asyncRewake` run of DeepBuild's entry started at that
   session's Stop that hasn't exited and still has a live (not zombie) process in its process group. Its size is the
   resident size (`ps` RSS) of every live process in that group; "under 5 MB" is under 5120 KB.
7. **"Outlives its session"** (AC3): any process of the waiter's process group still running 10 s after the session
   ended (SessionEnd then Claude Code's exit) or its Claude Code was killed.
8. **The waiter waits whether or not an ask is open** (AC12). Thirty Stops can't each be held for an answer in a
   test's time, so the thirty turns of AC12 leave no question open; one waiter per session is still the count, since
   the waiter is also how notes and wake-ups reach an idle session (design: the view's note route; Commands end).
9. **Time** (AC6): "20 minutes after a stop" is Claude Code's clock moved on with `expire(1200)` and the hub started
   again with `DEEP_HUB_TEST_CLOCK` 20 minutes on; nothing waits 20 real minutes. The waiter Claude Code started at the
   stop is still the one that must wake the session: it waits across the hub's restart (Disputes, 2).
10. **Timing** (AC2, AC6): twenty samples, one session each, answered one at a time. A sample is the time from `deep
    inbox answer`'s exit (your answer recorded) to the start of the wake's turn at the stand-in; p95 is the 19th of the
    twenty sorted. A session that doesn't wake within 30 s, or wakes with a turn that doesn't carry its answer, fails the test at once, naming it, whatever the load. A p95 over 2 s on a machine
    whose 1-minute load average is over its core count is INCONCLUSIVE (the test is skipped with the samples and the
    load reading), never PASS; on a machine that isn't, it's a FAIL.

### Additions the implementation must make

1. Seven planted programs, selected with `DEEP_HUB_PLANT` and listed in `packages/hub/src/wire.ts`'s plants. The tests set
   the variable on `deep hub run`, on `deep setup`, on `deep inbox answer` and on the stand-in (so on deep-hook, the
   waiter and `deep mcp`), so a plant may live on any side.

   | Name | What the plant does wrong | Criterion | How the test fails on it |
   |---|---|---|---|
   | `answer-skips-held-stop` | an answer that lands while its session's stop is held is not given to the hold: the hold lets the stop go with no decision, and the answer goes by the waiter | AC1 | `held.test.ts`: "AC1 the held stop didn't continue with the answer: Claude Code's Stop got no decision: block for ask:…" |
   | `waiter-never-wakes` | the waiter exits without the answer (exit 0), so an idle session's answer waits for its next prompt | AC2 | `wake.test.ts`: "AC2 idle session … (1 of 2 answered) never woke within 30 s of its answer to ask:…" |
   | `waiter-outlives-session` | the waiter doesn't watch its session's process: it runs on after the session ends, until an answer or its timeout | AC3 | `session-end.test.ts`: "AC3 …'s waiter (pid N) outlived its session: …" |
   | `both-routes` | an answer that lands while the stop is held and the waiter is alive goes back through the Stop hold and the waiter both | AC4 | `one-route.test.ts`: "AC4 ask:… went back by both routes: the Stop hold (decision: block) and the waiter (exit 2 …)" |
   | `waiter-gives-up-at-600s` | the waiter, or the hub's lease on it, ends 600 s (Claude Code's default hook timeout) of hub time after its stop, whatever the entry's timeout; a later answer waits for the next prompt | AC6 | `twenty-minutes.test.ts`: "AC6 idle session … (1 of 2 answered) never woke within 30 s of its answer to ask:…" |
   | `delivered-on-waiter-exit` | records the delivery `delivered` when the waiter exits 2 with the answer, without reading the transcript (the base's behaviour) | AC11 | `stalled.test.ts`: "AC11 ask:… was recorded delivered and acknowledged from the waiter's exit alone, …" |
   | `waiter-per-stop` | never ends an earlier waiter of the session: each Stop's waiter keeps waiting | AC12 | `thirty-stops.test.ts`: "AC12 thirty Stops in one session must leave one waiter process for it; they left 30 (pids …)" |

   The shared `tests/acceptance/25/twins.json` (outside this folder) should map `#25.0215da31` to
   `answer-skips-held-stop`, `#25.ee0f30b0` to `waiter-never-wakes`, `#25.008fdf08` to `waiter-outlives-session`,
   `#25.1eae4ef9` to `both-routes`, `#25.6367a6a9` to `waiter-gives-up-at-600s`, `#25.185becde` to
   `delivered-on-waiter-exit` and `#25.11b719ba` to `waiter-per-stop`.
2. A `delivery.outcome@1` event with `outcome: "stalled"` for an ask whose waiter delivery no turn carried (AC11). The
   schema already has the value; the `via` the implementation records for the waiter route isn't read by these tests.
3. The waiter keeps waiting while the hub restarts (AC6; Disputes, 2), and stays for its session when nothing is open
   (AC12; Defined here, 8).

## Criteria to tests

Each test's name starts with its criterion's number and ID, `#25.<first 8 hex of SHA-256 of the criterion's text,
trimmed, whitespace collapsed>`, as `scripts/proof-change.mjs` computes it.

| ID | Criterion (short) | Test | Wrong program it fails on |
|---|---|---|---|
| AC1 `#25.0215da31` | a held stop continues with the answer | `held.test.ts`: a Stop with no question open isn't held or sent back; a Stop with the session's ask open is held, you answer, and its reply is `decision: block` with the answer, exit 0 before the timeout; the continued turn's Stop isn't held or sent back with it again; the next prompt doesn't bring it again | `answer-skips-held-stop`; the base (its waiter takes the answer first, so the held stop goes through with no decision) |
| AC2 `#25.ee0f30b0` | an idle session wakes within 2 s of an answer at p95 | `wake.test.ts`: 20 idle sessions, answered one at a time, each wakes with a turn carrying its answer; p95 ≤ 2 s (INCONCLUSIVE under load) | `waiter-never-wakes` (never woke) |
| AC3 `#25.008fdf08` | no waiter outlives its session | `session-end.test.ts`: two idle sessions waiting on their asks; one ends (SessionEnd, exit), one's Claude Code is killed; within 10 s no process of either waiter's group is left | `waiter-outlives-session` |
| AC4 `#25.1eae4ef9` | answer while held with the waiter alive: Stop hold only, waiter exits without waking, ID once in the transcript; both routes fails naming them | `one-route.test.ts`: the Stop's reply blocks with the answer; the waiter alive at the answer exits within 15 s with a code other than 2; the continued turn's Stop isn't sent back with it again; no wake follows in 5 s; one transcript entry carries the answer's ID | `both-routes` (names both routes); the base (the waiter takes it and the held stop goes through: "must go back through the Stop hold only; it went by the waiter") |
| AC6 `#25.6367a6a9` | answer 20 minutes after a stop wakes within 2 s at p95; waiter timeout ≥ longest deadline | `twenty-minutes.test.ts`: deadlines at most 30 minutes; setup's waiter ≥ 1800 s and Claude Code runs it so; 20 idle sessions; Claude Code's clock and the hub's moved on 20 minutes; each wakes with its answer, p95 ≤ 2 s; with a 2-hour deadline, setup again gives ≥ 7200 s | `waiter-gives-up-at-600s`; the base (its waiter exits when the hub stops, so none wakes) |
| AC11 `#25.185becde` | waiter exit 2 with no turn carrying the ID: stalled, never delivered, next route once the transcript is read; a delivery from the exit alone fails, naming the ask | `stalled.test.ts`: a Claude Code that doesn't wake; the waiter exits 2 with the answer; 3 s on no `delivered` outcome for the ask; at the next typed prompt DeepBuild's reply carries the answer, and the ask's delivery reads `stalled`, with no `delivered` before it | `delivered-on-waiter-exit`; the base (records `delivered` when the waiter takes the answer) |
| AC12 `#25.11b719ba` | thirty Stops leave one waiter process, under 5 MB; one per Stop leaves thirty, naming the count | `thirty-stops.test.ts`: thirty turns in one session; Claude Code started the waiter at each Stop (control); within 15 s exactly one is left for the session, its process group under 5120 KB resident | `waiter-per-stop` (left 30); the base (left 30, and each waiter is a Node process far over 5 MB) |

## Disputes

1. **The answer's ID.** The issue says the transcript shows "the answer's ID" and that a turn carries it, without naming
   which ID. These tests accept the ask's ID or its `ask.answered` event's, and count only entries that aren't a tool
   call or result. So a delivery whose text names neither ID fails AC4's "once" (it shows zero).
2. **AC6 and the hub's restart.** The hub's test clock only sets its clock at start (#16), so "20 minutes after a stop"
   needs a hub started again 20 minutes on. That makes the waiter started at the stop wait across a hub restart. The
   design makes the waiter "a lease with a time limit and the process it waits on" and the issue says it "watches its
   parent process and exits with the session", so its life is its session's, not the hub connection's; the base's
   waiter, which ends when the hub goes, fails AC6 on that. If the implementer reads the waiter's life as bound to the
   hub, that is this job's redraft.
3. **AC12 with no open ask** (Defined here, 8). A waiter that exits at once when nothing is open would leave zero, which
   this test fails as "left 0", not as the wrong program it names.
4. **AC3's normal end.** Whether Claude Code stops its background hooks when an interactive session exits isn't in the
   facts or the #80 record; the stand-in doesn't, so the test reads what DeepBuild does.
5. **What Claude Code writes.** The block's "Stop hook feedback" entry and the wake's enqueue and user entry are the
   shapes #80 recorded (desktop app transcript; terminal hook log); fields beyond those (`origin`, `turnOrigin`) are
   left out rather than guessed. No entry is written for a UserPromptSubmit's added context.

## Files

- `helpers.ts`: temp homes and stand-in tools, `deep setup`, the settings file and DeepBuild's entries in it, the hub as
  a process and its socket, sessions and transcripts, the stand-in's client, an asking session, `deep inbox answer`,
  delivery outcomes, the process table, idle sessions and their wakes, the p95 judgement.
- `fixtures/claude.mjs` (the Claude Code stand-in), `fixtures/stub-bin.sh` (launchctl, systemctl, claude).
- `held.test.ts` (AC1), `wake.test.ts` (AC2), `session-end.test.ts` (AC3), `one-route.test.ts` (AC4),
  `twenty-minutes.test.ts` (AC6), `stalled.test.ts` (AC11), `thirty-stops.test.ts` (AC12).
- `BASE-FAILURE.txt`: the run on the base commit and why each test fails there.
