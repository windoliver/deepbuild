# Manual test: #27 in the Claude desktop app (AC3)

AC3 `#27.f8331d25`: "The desktop app wakes too, or the fallback is recorded as a known limit." No harness drives the
desktop app, so a person runs this once the live terminal tests (`session.live.test.ts`) and the fast tests pass, and
before the PR says `Closes #27`. It spends a little plan usage (four short turns of the default model). Nothing here
passes by default: a part you couldn't run is INCONCLUSIVE, and the PR lists it as open.

The automated half is `desktop.test.ts`: when an app doesn't wake, the answer reads stalled, a reading on the session
says so, the next prompt carries the answer once, and the session's later answers go straight to its next prompt.
This manual test decides which branch of AC3 holds for the app as it is today.

## Before you start

1. Record the machine (`sysctl -n hw.model`, `pmset -g batt | head -1`, `uptime`), the date, the Claude desktop app's
   version (Claude → About) and the Claude Code version it runs. If that Claude Code version isn't in
   `adapters/claude-code.facts.json`'s `versions`, DeepBuild treats the session as watch-only: stop and record
   INCONCLUSIVE with the version.
2. Build the change: `npm run build --workspaces` and `cargo build --locked -p deep-hook`.
3. The desktop app reads your real `~/.claude/settings.json`, so this installs into it. Back it up first:
   `cp ~/.claude/settings.json ~/.claude/settings.json.before-27`. Run `deep setup` and `deep hub start`. If setup
   doesn't register the `deep` MCP server, register it for the test:
   `claude mcp add --scope user deep -- node <checkout>/packages/cli/dist/main.js mcp`.
4. Make a scratch repo: `mkdir -p ~/deepbuild-27-manual && git -C ~/deepbuild-27-manual init -q && git -C
   ~/deepbuild-27-manual commit -q --allow-empty -m start`, and open a new desktop session in it. Keep a terminal open.
5. For every answer, record when you gave it: `date +%s%3N; deep inbox answer <ask> b`. Find the ask with `deep inbox`.

The ask prompt, typed into the desktop session, with two fresh words and a fresh requirement ID for each part:

> Call mcp__deep__deep_ask once, with kind "choice", question "Which code word, manual part N?", options a labelled
> WORD1 and b labelled WORD2, recommended "a", and subject {"point": "req:M27N"}. Whatever it returns, call no other
> tool and end your turn in one sentence without the code words. When my answer to that question reaches you later,
> reply with only the code word I chose.

The transcript is `~/.claude/projects/<the folder, each non-alphanumeric character as ->/<session>.jsonl`.

## Part 1: the idle session wakes (AC1 in the app), three times

Type the ask prompt (part 1a). Let the stop through: wait until the session is idle (the hold ends at most 60 s after
the stop), then 30 s more without typing. Answer `b`. Repeat with fresh words for 1b and 1c.

Record for each round: whether the session woke with no prompt typed; the delay from your answer to the woken turn's
first transcript line (its `timestamp`); whether its reply was WORD2 alone; and `deep inbox`'s line for the ask.

## Part 2: when it doesn't wake (the fallback)

If any round of part 1 didn't wake within 10 s, look at what DeepBuild recorded for the session
(`deep status`, and `deep inbox`): it must say the wake didn't happen and that the answer waits for the next prompt.
Then type:

> Reply with only the word READY, unless an answer to a question you asked has reached you; then reply with only its code word.

The reply must be WORD2, and the ask's ID must appear in the transcript once. Then type the ask prompt again (part 2),
let it go idle, answer, wait 10 s, and type the READY prompt: the answer must come with it, and no waiter must have
exited with it (`ps -A -o pid,etime,args | grep -F '<the waiter command from ~/.claude/settings.json>' | grep -v grep`
shows one waiter at most, still waiting).

## Part 3: the repeat (AC2 in the app)

Open a second desktop session in the same folder and type part 1a's ask prompt word for word, the same words and
requirement ID. It must reply WORD2 without you answering anything, and `deep inbox` must list its ask under "decided
for you".

## Which branch holds, and where it is recorded

- **The app wakes** (all of part 1 woke): AC3 holds by its first branch. Record the delays; the design's 2 s at p95
  is a reading here (three rounds can't judge it; AC5 judges it on the stand-in).
- **The app doesn't wake** (any round of part 1 didn't): AC3 holds by its second branch only when part 2 passes and
  the PR records the limit where the design keeps known limits: the Claude Code row's "Known limits" cell in
  `docs/technical-design.md`, which today says "Waking from the desktop app is untested", is replaced by what you saw,
  with the app's version. Until then AC3 is open.

## The record to keep

Paste this into the PR description (or a comment on #27). Recordings stay outside the repo.

```
Machine / power / load:            App version / Claude Code version:          Date (UTC):
Part 1  round  woke  answer→wake (ms)  reply WORD2  deep inbox line
        a
        b
        c
Part 2  wake missed: yes/no   what DeepBuild showed: ________   reply: ________   ID lines: __   second answer by prompt: yes/no
Part 3  replied WORD2 unasked: yes/no   listed under decided for you: yes/no
Branch: wakes / known limit (where recorded: ________)   Verdict (PASS / FAIL / INCONCLUSIVE, with why):
```

## Afterwards

Stop the hub (`deep hub stop`), remove the `deep` MCP server if you added it (`claude mcp remove --scope user deep`),
and put your settings back with `deep setup --undo`, or `cp ~/.claude/settings.json.before-27 ~/.claude/settings.json`.
