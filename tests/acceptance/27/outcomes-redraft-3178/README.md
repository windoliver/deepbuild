# Blind redraft (#3178) of #27 AC4's Oct 9 cases: the four delivery outcomes, a waiter that outlives its session, a held stop

AC4 `#27.e6116d56`: "Fixtures show each ask, hold, check run and agent command reaching a recorded outcome by its
deadline", with the issue's "Added Oct 9" line: "Also cover: the four delivery outcomes in scripted sessions, a waiter
that outlives its session, and a stop held while a Claude subagent is still running. Done when: each case reports the
right outcome and none reads as finished." A fresh run of the blind acceptance-test job (AGENTS.md, Proof; design,
Dogfooding) for those cases only. It saw the issue's body, `docs/technical-design.md` and the base commit, and nothing
of any other session, branch or PR. It stands on its own as the full coverage of the Oct 9 cases: all four delivery
outcomes are here (the earlier `../outcomes-redraft/` left delivered and stalled to other files). The ask, hold,
check-run and agent-command cases of AC4 are not this folder's.

## What it read

- Issue #27's body: the five criteria, Proof ("Transcripts and the record for each step"), Added Oct 9, Done when.
- `docs/technical-design.md`: An ask, and your answer getting back (Every ask ends; Work goes on while you decide;
  Where they reach you; the delivery paragraph: "Each delivery ends in one of four outcomes: delivered and
  acknowledged, when the agent's next prompt or turn shows it ...; stalled; timed out; or the session was replaced. A
  timeout doesn't prove nothing arrived, so a retry reads the session first"); An agent says it's done (A question
  holds the send-back); the Claude Code row of What each agent gives us ("A Stop hold returns `decision: block` with
  the answer", "A background `asyncRewake` waiter exits with code 2", "UserPromptSubmit and SessionStart add context as
  a fallback", "A waiter can outlive a headless session, so it watches its parent process", "Subagents fire the same
  hooks with an `agent_id`"); Hooks are evidence, not a state machine (Who is calling; Unknown, not finished; Threads,
  not IDs); States people see (`finished`: "a session whose turn stopped with no claim to judge"); the Ask primitive;
  How we know version 0 works (Hook edge cases, Every wait ends, Wrong programs, Criteria to tests).
- AGENTS.md; at the base `37dd3c0c` (origin/main): `../helpers.ts`, `../outcomes-redraft/` (its stand-in, copied),
  `../twins.json`, `../twins/`, `packages/hub/src/{plant,mcp-operations,answer-delivery,core,claude-settings}.ts`,
  `crates/deep-hook/src/main.rs` (the waiter), `scripts/proof-runs.mjs` (how twins run).

## Why this redraft: the ask must wait on you

`../outcomes-redraft/` asks a choice with a recommended option. The design says such a choice doesn't wait: "A taste
call or a choice between options proceeds on the recommended option at once, marked as undoable" (Work goes on while
you decide), and the base does that (`deep_ask` answers `provisional` at once). A provisional ask's answer is no wait
on you, so its idle-session, waiter and held-stop steps describe a scenario the design says never happens.

Every case here asks a **choice with no recommended option** (`recommended: null`): nothing to go on with, so it
"leaves the agent waiting on you" (A question holds the send-back: "a taste call or choice that isn't provisional").
`asks()` in `standin.ts` makes that a precondition: an ask filed provisional is `BLOCKED`, never a pass.

## How to run

Node 24 first on `PATH`, macOS, a built checkout (`npm ci`, `npm run build --workspaces`, `cargo build --locked -p
deep-hook`; the waiter's planted program needs deep-hook built with `--features env-plants`):

```sh
npx vitest run tests/acceptance/27/outcomes-redraft-3178/outcomes.test.ts --reporter=verbose
DEEP_HUB_PLANT=<plant> npx vitest run tests/acceptance/27/outcomes-redraft-3178/outcomes.test.ts --reporter=verbose
npx tsc --noEmit -p tests/acceptance/27/outcomes-redraft-3178
```

Six tests, no model, no network, about 2-4 minutes. Temp folders are `/tmp/dh27-*` (from `../helpers.ts`), HOME a temp
home, only processes the tests started are stopped, by PID or by the process groups the stand-in made. `setupHere`
runs `deep setup` but never builds deep-hook (unlike `../helpers.ts`'s `setup`): a missing binary is `BLOCKED`. Run
the file alone; other suites lease the same hub ports. On a loaded Mac a hook can miss the hub: the subagent case
then says `BLOCKED`; rerun the file once alone before reading a first-test timeout as a result.

## The surface, and what the implementation must provide

- `deep setup` writes Claude Code's user settings: a Stop hold, the `asyncRewake` waiter, prompt and start context.
- `deep mcp`'s `deep_ask` files a choice with no recommendation as an open, non-provisional ask (`ask.created`).
- `deep inbox answer <ask> <option>` answers it.
- The hub's socket (`events.read`): one `delivery.outcome` event per outcome (`data.outcome` one of `delivered`,
  `stalled`, `timed_out`, `replaced`; `data.via`), and `session.attention` events whose newest `data.state` is the
  session's state word.
- deep-hook's replies as Claude Code reads them: a Stop's `decision: block` reason, a prompt's or start's
  `additionalContext`, the waiter's exit 2 with the answer on stderr; `user.ask` events with the prompt's text.

## The fixture

`fixtures/claude.mjs` is a byte copy (header aside) of `../outcomes-redraft/fixtures/claude.mjs`: a stand-in for
Claude Code's side of the hook contract (a boundary DeepBuild doesn't own). It runs the settings' entries as Claude
Code does, writes a hook's added context and a held stop's feedback into the transcript, starts a wake turn when the
waiter exits 2 (or, configured `wake:false`, starts none, as an app that doesn't wake), and can be SIGKILLed with no
SessionEnd. `standin.ts` is its client (copied from `../helpers.ts`'s `Claude`), the waiting choice and the asking
session. A real Claude Code can't be made to stall, time out or be replaced on cue, so these are scripted sessions,
as the Oct 9 line says.

## Criteria to tests

All six tests carry `#27.e6116d56`. Failure is any assertion below not holding within its bound; a precondition that
can't be set up is `BLOCKED`.

| Case | The scenario (design) | Passes when | Wrong program run (`DEEP_HUB_PLANT`, = `../twins/<name>`) |
|---|---|---|---|
| delivered | idle headless session; the waiter takes your answer, exits 2, Claude Code wakes it | the wake prompt carries the answer; `delivered` within 30 s, once, after the wake turn's `user.ask` in the record; nothing else | `wake-assumed` (delivered before any turn); `waiter-never-wakes` |
| stalled | the waiter took it, no turn started, transcript readable and showing none | `stalled` within 60 s, nothing else, session not `finished`; the next prompt carries it; then `delivered` once, after the stall | `wake-assumed` |
| timed out | the waiter took it, the transcript can't be read, so nothing proves it arrived | `timed_out` within 60 s, nothing else, not `finished`; once readable the next prompt carries it, `delivered` once, never `stalled` | `wake-assumed` |
| replaced | the waiter took it, `/clear` (SessionEnd `clear`, SessionStart `clear`, new ID) before any turn | `replaced` within 30 s, nothing else, old ID not `finished`; the new session's start carries it, its next prompt doesn't; `delivered` once after | `wake-assumed` |
| waiter outlives | idle headless session's Claude Code SIGKILLed, no SessionEnd | the waiter's process group gone within 10 s; a later answer not `delivered` for 30 s; not `finished` | `waiter-outlives-session` (deep-hook's waiter stops watching its parent) |
| held stop, subagent running | the lead starts a background subagent (Agent, `run_in_background`), asks, stops; the subagent's hooks carry its `agent_id` | stop still held at 3 s and after subagent hooks; not `finished`; your answer is the held stop's block reason; no subagent hook reply carries it; the continued Stop isn't blocked with it again; no wake; outcomes exactly `delivered via stop_hold` | `answer-skips-held-stop` |

`../twins.json` already maps `#27.e6116d56` to `wake-assumed`, `waiter-outlives-session` and `answer-skips-held-stop`
(and `skip-default-at-deadline`, not this folder's). `waiter-never-wakes` is mapped only to AC1; this job can't edit
`../twins.json`, so it ran that plant by `DEEP_HUB_PLANT` only. See `BASE-RESULTS.txt` for each run.

## Readings and assumptions

1. **A choice with no recommendation waits on you** (above). A taste call would too, but needs a screen and element;
   an unblock task needs a check in the repo's `done.yaml`; the choice needs neither.
2. **Delivered** means "acknowledged, when the agent's next prompt or turn shows it": the test requires the
   `delivered` event after the wake turn's prompt event in the log, so a hub that records it when the waiter takes
   the answer fails.
3. **Stalled** is the waiter's hand-off that no turn shows while the transcript can be read (the desktop app may not
   wake: the design's known limit). **Timed out** is one whose session can't be read (transcript mode 000): "a timeout
   doesn't prove nothing arrived, so a retry reads the session first", which the test then checks by the next prompt.
4. **Replaced** follows Threads, not IDs: the cleared thread's new session gets the answer at SessionStart, once.
5. **"None reads as finished"**: in every case the session's newest `session.attention` state is never `finished`
   while its answer is open or undelivered (idle with the ask open, stalled, timed out, replaced, process gone, stop
   held). After a delivery and a turn that ended, `finished` is allowed and not read.
6. The subagent case is the design's hook edge case "a stop held while a Claude subagent still runs" with the lead
   asking. A `deep_ask` from the child itself ("a lead's stop stays held while a child waits on you") needs the
   child's agent ID carried on its MCP call; this job found no surface naming how, so it is not covered here.
7. Every bound (3, 10, 30, 60 s) is the test's own; the design names none for these.

## Files

- `outcomes.test.ts`: the six cases.
- `standin.ts`: the stand-in's client, `setupHere`, the waiting choice and the asking session.
- `fixtures/claude.mjs`: the Claude Code stand-in.
- `BASE-RESULTS.txt`: the runs at the base and on each wrong program, with the load.
- `tsconfig.json`: the root options with `noEmit`.
