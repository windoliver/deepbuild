# Acceptance tests for #82: judge every stop that did work

Written first, blind, by a job that never saw an implementation of #82 (there is none on the base). Sources:

- **The issue**: its text as of 2026-11-05T06:18:44Z (`updatedAt`): Scope, the 13 checkbox criteria, Proof ("Replays of
  20 recorded stops from Claude Code and Codex, with the claims each made") and Depends on (#322, #323, #325, #29,
  #340, all closed and on the base).
- **The design**, `docs/technical-design.md`:
  - [An agent says it's done], all of it: Every stop is judged (the answer rule, the automatic continue after the
    app's resume prompt, the one send-back for an ask left open with nothing done, honest stops, the PR you asked for
    as delivery with "Part of" in its body and the link in the chat line), Fast and slow lanes, Held time, Slow runs
    start when the turn ends (a completion prompt keeps the agent working), A loop's turn end isn't a hand-back, The
    verdict in the chat, Questions at the stop, A question holds the send-back, Open items, Stalled claims.
  - The done loop (trusted plug-ins on the contract), the Claim primitive, How runs become one of five verdicts
    (pending: runs still to come, or an oracle that is you), and Hooks are evidence, not a state machine.
  - What each agent gives us (prompt origins; the desktop app's resume prompt; Codex goals and heartbeats) and its
    Program status paragraph (OSC 7501: "one more signal, never enough on their own for a claim or a verdict").
- **The base commit**: `5def43f9` (origin/main). The base code read, to learn how to drive it: `packages/hub/src/`
  (`core.ts`: the stop rule `stopRule` and its `counterOf`, the Stop's hold, `laneOf`, `stopHold`, `continueSession`;
  `server.ts`: the `DEEP_HUB_TEST_*` settings; `plant.ts`; `ask-tasks.ts`: `asksForChange` and the handed
  requirement's `expected_ms`), `crates/deep-hook/src/main.rs` (the waiter), the schemas `agent.stop@5`,
  `claim.made@3`, `claim.sent_back@1`, `claim.stalled@1`, `open_item.opened@2`, `verdict.made@1`,
  `session.continued@1`, and `adapters/corpus` (the sessions the Proof's stops are shaped on).
- **Sibling suites, for their conventions**: tests/acceptance/325 (this suite's template: the world, the hub as a
  process, sessions through deep-hook, `failureOf`, the timing reading under load), 322 (the work source, Closes or
  Part of), 303 (the stop rule and its plant `claim-on-tool-calls`), 340/flow (the desktop app's prompts, its quit and
  resume, the Codex session), 85 (the automatic continue, the waiter) and 29.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook and the waiter run
npx vitest run --root tests/acceptance/82 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/82/tsconfig.json
```

- Every test starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
  beside #325's and #322's. The implementer adds it.
- Every test makes its folders under `/tmp/dh82-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port.
- No network, no model, no `claude` or `codex` binary, no `gh` call: the agent's `gh pr create` is allowed or refused
  at PreToolUse, and when allowed the test writes gh's answer (the PR's link) as the call's result. A child never
  inherits this process's billing keys, forge tokens or its `DEEP_*`, `GIT_*`, `XDG_*`, `CLAUDE*` or `CODEX*` settings.
- Hubs run with `DEEP_HUB_TEST_STOP_HOLD_MS=30000`, except `budgets.test.ts` (the shipped 60 s hold) and
  `replay.test.ts` (10 s: a claim is recorded at its stop whatever its checks say).

## The surface under test

The tests reach DeepBuild only through these:

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code and Codex run our hook entries (`deep-hook claude-code
  <event>`, `deep-hook codex <event>`), each session's hooks children of the session's own process
  (`fixtures/agent.mjs`). A Stop's reply is read from deep-hook's stdout (`decision: block` and its `reason`, and
  `systemMessage`, the chat line) or, at exit 2, its stderr. A tool call runs with the input deep-hook's PreToolUse
  reply gives it (`hookSpecificOutput.updatedInput`), as Claude Code runs it; a Stop's block is written into the
  transcript as Claude Code writes it ("Stop hook feedback").
- **DeepBuild's waiter**, `deep-hook claude-code waiter`, started beside a Stop with the Stop's payload, as Claude
  Code's async Stop entry (asyncRewake) runs it, a child of the session's process. Its exit 2, with text on stderr, is
  a wake: the session continues with nothing typed.
- **`deep hub run`** with the base's `DEEP_HUB_PLANT`, `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_STOP_HOLD_MS`,
  `DEEP_HUB_TEST_DRAFTS` and `DEEP_HUB_TEST_WORK`. Nothing new.
- **The socket**, as the cli role with the control token: `events.read`. The kinds read: `user.ask`, `task.created`,
  `definition.locked`, `agent.stop` (its `claim`, the stop rule's reading), `claim.made`, `claim.sent_back`,
  `claim.stalled`, `verdict.made`, `run.started` (its `lane`), `run.finished`, `open_item.opened`, `task.closed`.

### The world

A home, and a git repository with one commit on main: `src/auth.js` (`checkToken`, `rejectsExpired`, a `note` line
each round's edit bumps), `src/net.js`, `src/cart.js` (what the typed question asks about), the spec
`.deepbuild/done.yaml` (the unit check), and drafted checks: `expired-token.sh` (fails until FLAG), `retry.sh` (fails
on every commit) and `checkout-journey.sh` (passes; handed with `expected_ms` 600000, so it never fits a stop's 10 s
fast lane and stays pending at the stop). The test work source holds one item per scenario (`https://work.test/acme/
shop/issues/<n>`), each with its handed definition (#322's way); a session opens its task by typing `Fix <link>`.
Every other prompt a test types has a definition handed for its exact text too, so a kernel that wrongly opened a task
for it would lock one.

### Prompts, as the agents write them

- **Typed**: a transcript entry with `turnOrigin: human`, then UserPromptSubmit.
- **The Claude desktop app** (`CLAUDE_CODE_ENTRYPOINT=claude-desktop`): every prompt with the app's queue pair first. A
  quit is a PreToolUse with no PostToolUse, then SessionEnd `other`; reopened, SessionStart `resume`, the pair, the
  `<synthetic>` assistant "No response requested." and the resume prompt (`promptSource` and `turnOrigin` sdk):
  "The app was quit while you were working. Please continue from where you left off." (2.1.299 desktop-resume).
- **Scheduled, another session, a subagent**: as 2.1.308 loop, 2.1.299 desktop-peer and 2.1.308 subagent have them.
- **Codex**: a rollout with session_meta; each turn a task_started, a turn_context and its user message; a heartbeat
  is a `<heartbeat>` prompt; a goal's continuation turn fires no prompt hook (0.160.0 desktop-heartbeat, 0.166 goal).

### How the criteria are read

- **"Held and sent back"**, **"sent back"**: the Stop's reply blocks and names the requirement (its ID, text or check).
  AC1 also reads the `claim.sent_back`.
- **"Isn't a claim"**: no `claim.made` for the task between the stop and the next prompt; the Proof also reads the
  `agent.stop`'s `claim`.
- **"One automatic continue"** (AC3, AC4) and **"keeps working … without you typing"** (AC6): either route the design
  has, the Stop's own reply keeping the turn going, or the waiter waking the idle session. Nothing is typed.
- **"Never sent back"** (AC5): no `claim.sent_back` for any claim made since the PR call. The reply may still keep the
  agent working, as AC6 needs: a continue isn't a send-back. **"The chat line carries the link"**: the reply's
  `systemMessage`, or a block's first line, holds the PR's link. **"The PR body"**: the `--body` (or `--body-file`) of
  the `gh pr create` that runs, after any `updatedInput`; if the call is refused, the agent sends it once more with the
  refusal's words added to its body, as an agent follows a refusal. R2 must appear after its "Part of".
- **"Unless your ask … says the PR ends the work"** (AC6): the ask says so in its words: "open a pull request and stop
  there: the pull request ends the work."
- **"A completion prompt within one hook"** (AC7): the Stop's own reply blocks, with text. To tell it from a send-back,
  the only requirement is pending (the slow-lane journey), not failing, and a control session's worded stop on the
  same definition goes through. **"Becomes a stalled claim"**: a `claim.stalled` on the session's claim after the
  fourth stop, none before it, and the fourth stop let through.
- **Program status** (AC8): the base has no reader for OSC 7501 and the design names no route for one, so the record
  `ESC ] 7501 ; done BEL` reaches DeepBuild where a terminal's output reaches an agent's hooks: in a file a call reads,
  in a Bash call's output and in the agent's final words. The test holds on a gate that ignores it, as the base does;
  it fails a gate that takes "done" for a claim (an answer would make one) or for a pass (a failing claim would pass).
- **"Pending … its open item names the runs or the answer still needed"** (AC12): `open_item.opened` events for the
  task after the stop, one naming R1 or its check (the run still to come), one naming R2 or its text, or "answer"
  (your answer still needed).
- **Budgets** (AC13): see below.

## Load

Two readings depend on the machine, not the hub's rules, and are INCONCLUSIVE (a skip naming the 1-minute load),
never a pass or a fail (`helpers.ts`, `unreached` and `heldOut`):

- any hook deep-hook couldn't hand to the hub within its budget ("spooled …, but its sync didn't finish within the
  hook's 50 ms"): its reply is deep-hook's own, and its event reaches the record later, out of the turn's order (a
  PostToolUse spooled past its Stop makes a working turn read as one with no work), so no reading of that session
  says what the hub decides. This holds at any load; a hub too slow for deep-hook's budget on an idle machine is a
  failure of the hook protocol's own budget, not of these criteria;
- a stop let through while a fast-lane run of a claim made at it hadn't finished, while the 1-minute load is past the
  core count: the hold ran out before the checks it waits for, so whether the stop would be sent back is unknown.

The base runs, at loads of 5 to 56 on 12 cores, met both (BASE-FAILURE.txt).

## Plants

| Plant (`DEEP_HUB_PLANT`) | On the base | Criterion | The wrong program | What the test requires |
|---|---|---|---|---|
| `claim-on-tool-calls` | listed (#303) | AC9 | the stop rule reads every stop with tool calls as a claim | AC9's answer check fails, its message naming stop B's `agent.stop` ID |
| `no-work-never-sent-back` | **new** | AC10 | a stop with no work since its turn began never gets a send-back, so the one send-back a no-work stop leaving an ask open gets is dropped | AC10's check on stop E fails, naming E's `agent.stop` ID |
| `skips-prompt-turns` | **new** | AC11 | every turn begun by a prompt is read as an answer and not judged, whatever it did and whoever sent the prompt | AC11's check fails on stop B (the edit), naming its `agent.stop` ID |

A plant the hub doesn't list stops `deep hub run` ("names no planted program"); the test then fails with `BLOCKED:
plant <name> not listed …`. The implementer adds the two new ones to `packages/hub/src/plant.ts`.

## Budgets

"On the reference Mac in the local preflight, compared with the merge base" can't be built in a blind suite, so
`budgets.test.ts` reads both on the hub as it stands, with the shipped 60 s hold:

- **Fast checks finish inside the 60-second hold**: the stop after the fix is answered within 60 s and every run of its
  claim recorded with `lane: fast` has finished before the reply.
- **Judging a stop that needs no new checks adds under 10 ms**: five scheduled-task turns (judged: a claim, and no run
  started, since nothing changed) interleaved with five typed questions (answers: not judged), each reading one file
  and stopping; the median Stop hook time of the first less that of the second must be under 10 ms.
- A reading over its budget while the 1-minute load is past the core count is INCONCLUSIVE (a skip naming the load),
  never a pass or a fail. A planted reading (a judge adding 15 ms) shows the harness fails.

## Criteria to tests

| Criterion | File (tests) | What it drives |
|---|---|---|
| AC1 `#82.7c6a9250` | `honest.test.ts` (1) | item 11: R1 unmet, the stop "… Want me to open the PR?" is blocked, a `claim.sent_back`, naming R1 |
| AC2 `#82.429cda18` | `honest.test.ts` (1) | items 12 and 13: "Done." and a "Not verified:" list each make a claim, get the same verdict, both sent back naming R1 |
| AC3 `#82.3f863987` | `nowork.test.ts` (1) | item 21: your ask, a no-tool stop: no claim, one send-back naming R1, the next let through; item 22 (desktop): edit, quit mid-call, resume prompt, a no-tool stop: no claim, continued (reply or waiter), by the third let through |
| AC4 `#82.731c9e54` | `restart.test.ts` (1) | items 31-40: ten desktop sessions edit and are quit mid-call; after the restart each gets the resume prompt and its no-tool stop, no claim, is continued with nothing typed |
| AC5 `#82.fbbdd208` | `pr.test.ts` (1) | item 51 (you asked for a PR), R2 failing: the PR stop has no `claim.sent_back`, its chat line holds the link, the PR body lists R2 under "Part of" |
| AC6 `#82.7f8929f5` | `pr.test.ts` (1) | item 51: kept going on R2 in the same PR, nothing typed; item 52, whose ask says the PR ends the work: let through, nothing wakes it |
| AC7 `#82.443b3a5a` | `completion.test.ts` (1) | item 61, R1 pending: three stops on "No response requested." each get a completion prompt, no stall before the fourth, the fourth a `claim.stalled` and let through; item 62's worded stop goes through (control) |
| AC8 `#82.b6297cd7` | `status.test.ts` (1) | item 71: an answer whose read and words carry OSC 7501 "done" makes no claim or verdict; a judged turn whose test output says "done" is still FAIL and sent back on R1 |
| AC9 `#82.0fcced84` | `answers.test.ts` (2) | item 81: the typed cart question that reads two files is allowed, no `claim.made`, no `claim.sent_back`, the task open; the next stop that edits is sent back naming R1; plant `claim-on-tool-calls` |
| AC10 `#82.6e3bad75` | `answers.test.ts` (2) | item 81: the same question with no tool call: no send-back; the no-work stop after a send-back gets one naming R1; plant `no-work-never-sent-back` |
| AC11 `#82.c17a5871` | `judged.test.ts` (2) | item 91: the typed question with one edit, a scheduled task's turn and another session's message's turn each make a claim and are sent back naming R1; plant `skips-prompt-turns` |
| AC12 `#82.be677619` | `pending.test.ts` (1) | item 95: R1's run still to come, R2 your answer: the stop goes through, no PASS, the task open, open items naming R1's run and R2's answer |
| AC13 `#82.94380d25` | `budgets.test.ts` (2) | item 99: fast-lane runs end before the reply inside 60 s; judged no-new-check stops add under 10 ms over answers; the harness on planted readings |
| Proof | `replay.test.ts` (1) | `fixtures/stops.json`: 10 Claude Code and 10 Codex stops shaped on adapters/corpus sessions, each with the claim the stop rule gives it |

## What this suite could not encode

- **"Compared with the merge base"** and **"the reference Mac"** (AC13): read on this machine and this hub, as above.
- **The Proof's "recorded" stops** are the corpus's recorded session shapes retargeted to this repository, not the
  corpus files byte for byte: the corpus sessions ran in throwaway folders with no task open, so they make no claim
  anywhere. Each fixture stop names the corpus session it is shaped on.
- **"Counts as one more signal"** (AC8): no reading of the status is named, so only "never … on its own" is asserted.
- **"Then the ask's row says the session is idle with it open"** (Every stop is judged): the row isn't read.
- **AC3's "one" for the resume**: after the continue, the design also gives a no-work stop leaving an ask open one
  send-back, so the test requires only that the session is let through by its third no-work stop.

## Files

- `helpers.ts`: worlds, the hub as a process, `events.read` and its readers, Claude Code sessions (terminal and
  desktop: prompts of each origin, the quit and the resume prompt, tool calls run with `updatedInput`, stops), the
  waiter, the Codex session, `startOnItem`, `prBody`, and `verdict`, `failureOf`, `Inconclusive`.
- `fixtures/agent.mjs`: each session's agent stand-in, the parent of that session's deep-hook runs and its waiter.
- `fixtures/stops.json`: the Proof's 20 stops.
- `honest.test.ts` (AC1, AC2), `nowork.test.ts` (AC3), `restart.test.ts` (AC4), `pr.test.ts` (AC5, AC6),
  `completion.test.ts` (AC7), `status.test.ts` (AC8), `answers.test.ts` (AC9, AC10), `judged.test.ts` (AC11),
  `pending.test.ts` (AC12), `budgets.test.ts` (AC13), `replay.test.ts` (Proof).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.

[An agent says it's done]: ../../../docs/technical-design.md
