# Manual test: #25's routes in the Claude desktop app

The issue's Proof ends with "a manual desktop-app test, against what #80 recorded for each app". No harness drives
the desktop app, so a person runs this once the live terminal tests (`routes.live.test.ts`) pass, and before the PR
says `Closes #25`. It spends a little plan usage (five short turns of the default model). Nothing here is a pass by
default: a step you couldn't run is INCONCLUSIVE, and the PR lists it as open.

## Before you start

1. Record the machine (`sysctl -n hw.model`, `pmset -g batt | head -1`, `uptime`), the date, the Claude desktop
   app's version (Claude → About) and the Claude Code version it runs (`claude --version` from the app's terminal
   tool, or `version` in a transcript line). If that Claude Code version isn't in `adapters/claude-code.facts.json`'s
   `versions`, DeepBuild treats the session as watch-only: stop here and record INCONCLUSIVE with the version.
2. Build the change: `npm run build --workspaces` and `cargo build --locked -p deep-hook`.
3. The desktop app reads your real `~/.claude/settings.json`, so this test installs into it. Back it up first:
   `cp ~/.claude/settings.json ~/.claude/settings.json.before-25`. Then run `deep setup`, which puts DeepBuild's
   entries beside yours, and start the hub (`deep hub start`). If setup doesn't register the `deep` MCP server,
   register it for the test: `claude mcp add --scope user deep -- node <checkout>/packages/cli/dist/main.js mcp`.
4. Make a scratch folder, `mkdir -p ~/deepbuild-25-manual && git -C ~/deepbuild-25-manual init -q`, and open a new
   desktop session in it. Keep a terminal open beside the app.
5. For every answer below, record the time you gave it: `date +%s%3N; deep inbox answer <ask> b`. Find the ask with
   `deep inbox`; it is the open one from this session.

The ask prompt, typed into the desktop session, with two fresh words for each part:

> Call mcp__deep__deep_ask once, with kind "choice", question "Which code word, manual part N?", and options a
> labelled WORD1 and b labelled WORD2. Whatever it returns, call no other tool and end your turn in one sentence
> without the code words. When my answer to that question reaches you later, reply with only the code word I chose.

The transcript is `~/.claude/projects/<the folder, each non-alphanumeric character as ->/<session>.jsonl`.

## Part 1: a held stop continues with the answer (AC1)

Type the ask prompt. deep_ask comes back after about 40 s and the turn stops; DeepBuild holds that stop for up to
60 s while the ask is open, so the session still shows as working. Within that minute, answer `b`.

Record: whether the session went on by itself and replied with only WORD2; how long from your answer to the reply
appearing; how many transcript lines other than the agent's own carry the ask's ID (it must be one); whether a second,
woken turn followed (it must not: one answer goes by one route).

## Part 2: an idle session wakes (AC2), five times

Type the ask prompt again (part 2a). Let the stop through: wait until the session is idle (the hold ends at most 60 s
after the stop), then 30 s more without typing. Answer `b`. Repeat with fresh words for 2b to 2e.

Record, for each round: whether the session woke with no prompt typed; the delay from your answer to the woken
turn's first transcript line (its `timestamp`); how many turns that one answer started (it must be one); how many
lines other than the agent's carry the ask's ID (one). The design's target is within 2 s at p95; with five rounds,
all five within 2 s reads PASS, all five over by more than 5% or the rounds' spread reads FAIL, anything else
INCONCLUSIVE, and only on a reference Mac (Mac15,7 or Mac15,12) with Low Power Mode off, a nominal thermal state
and a load average at or below its core count; elsewhere the delays are readings.

After round 2e, count the processes running DeepBuild's waiter command (as `deep setup` wrote it in
`~/.claude/settings.json`): `ps -A -o pid,ppid,etime,args | grep -F '<the waiter command>' | grep -v grep`. There
must be at most one for the session, however many stops it made.

## Part 3: when the app doesn't wake (AC9)

If any round of part 2 didn't wake within 10 s, look at what DeepBuild shows for the session at that moment, in the
view the implementation names for a session's state (its row in the app's sessions view or the CLI's): it must say
that the wake didn't happen and that the answer waits for the next prompt. Then type:

> Reply with only the word READY, unless an answer to a question you asked has reached you; then reply with only its code word.

The reply must be WORD2, and the ask's ID must appear in the transcript once.

If every round woke, check this part by taking the wake away: type the ask prompt (part 3), let the stop through and
wait for the session to go idle, stop the waiter process for this session yourself (its PID from the `ps` line above,
`kill <pid>`; Claude Code would stop it the same way at its timeout), then answer `b`, wait 10 s, and type the
prompt above. Record what DeepBuild showed before you typed, and the reply.

## Part 4 (if the app can resume a session): an ended session's answer (AC7)

Type the ask prompt (part 4), let the stop through, and archive the session (#80: archiving fires SessionEnd in the
Claude desktop app). Answer `b`. Open a new session in the same folder and type the READY prompt: it must reply READY,
with no line carrying the ask's ID. Then reopen the archived session, if the app lets you, and type the READY prompt
there: it must reply WORD2. Record whether its transcript shows the answer arriving at its start (before your prompt)
or with your prompt. If the app can't reopen it, record INCONCLUSIVE for this part.

## What #80 recorded, to compare against

From `spikes/80/decision.json` (base `dcfd7b8`; Claude desktop app 2.42304.0 running Claude Code 2.1.299; terminal
Claude Code 2.1.303):

| What | #80 recorded | This test passes when |
|---|---|---|
| Held stop (`#80.373518b6`) | PASS: a held stop with a reason reached the agent in the Claude desktop app (session `4efa4b70…`, invocation `6428335c2568`) | part 1 continues with WORD2, by the hold only |
| Held stop's cost (`#80.119fc62b`) | 7.2 to 10.2 ms beyond the checks in the Claude desktop app, on the reference Mac15,7 (battery readings count) | AC8's budget, under 20 ms; record any delay you can see |
| Idle wake (`#80.6231c088`) | woke in the desktop app with no prompt typed, after 32 s idle; the waiter's exit was followed by a UserPromptSubmit 97 ms later (invocation `bca4518d83bc`); 135 ms in the terminal (`1731676df86e`); the wake arrives as a UserPromptSubmit whose prompt is a task-notification with the waiter's stderr | every round of part 2 wakes, once |
| Earlier waiters (`#80.6231c088` decision, notes) | earlier asyncRewake waiters kept running in the desktop app, so one answer woke the session twice | one turn per answer, at most one waiter process per session (part 2) |
| Hooks' folder (notes) | desktop hooks run with PWD set to the session's environment folder, not its working folder | the parts still find the session's ask and deliver to it |
| Session end (`#80.15c33f50`) | archiving a desktop session fired SessionEnd (reason other) about 1.2 s before the archive finished | part 4's answer waits for the same thread |

## The record to keep

Fill this in and paste it into the PR description (or a comment on #25). Recordings, if you make any, stay outside
the repo, named by their SHA-256, as #80's were.

```
Machine / power / load:            App version / Claude Code version:          Date (UTC):
Part 1  held stop continued with WORD2: yes/no   answer→reply: __ s   ID lines: __   woken as well: yes/no
Part 2  round  woke  answer→wake (ms)  turns  ID lines
        a
        b
        c
        d
        e
        waiter processes after 2e: __
Part 3  wake missed: yes/no/forced   what DeepBuild showed: ________   reply: ________   ID lines: __
Part 4  new session got nothing: yes/no   resumed thread replied WORD2: yes/no   arrived at start/with prompt/can't tell
Verdict per part (PASS / FAIL / INCONCLUSIVE, with why):
```

## Afterwards

Stop the hub (`deep hub stop --root ~/.deepbuild`), remove the `deep` MCP server if you added it (`claude mcp remove --scope user deep`),
and put your settings back: `deep setup --undo` where #19 provides it, otherwise
`cp ~/.claude/settings.json.before-25 ~/.claude/settings.json`.
