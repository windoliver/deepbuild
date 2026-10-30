# Acceptance tests for #340: the ask-task flow in the session (AC1-AC5)

Each new ask acknowledged and queued, requirement IDs sent again after a compaction, and continuations kept apart.
AC6 (words the app delivers, `from: app`) is another blind job's, in `tests/acceptance/340/app/`.

Written first, blind, by a job that saw only the issue, the design and the base commit, never an implementation of
#340. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job.

## Sources

- **The issue**, windoliver/deepbuild#340 as of `updatedAt` 2026-10-29T04:23:42Z: Scope, Fields, the six checkbox
  criteria (AC1-AC5 here), Proof ("replays of recorded sessions with mid-turn messages, a compaction and the desktop
  app's resume prompt, each shown failing first") and Depends on (#303, #14, #80, #25).
- **The design**, `docs/technical-design.md`:
  - What done means, fixed at the start: When (each ask opens a task, "the agent acknowledges it in one line, and the
    session's line shows the queue"; automatic continuations, "a Codex goal, a heartbeat or the desktop app's resume
    prompt", open no ask) and Locked ("After a compaction or a resume, SessionStart sends the open asks' requirement IDs
    again, in one short block").
  - An agent says it's done: Every stop is judged, A loop's turn end isn't a hand-back, The verdict in the chat.
  - The contract (kernel): Event (`user.ask` "for each prompt and each message typed while the agent works"), Ask-task.
  - What each agent gives us: Claude Code's row (messages typed while it works "read from the transcript's queue at the
    next hook"; prompt origins `person`, `scheduled`, `subagent`, `session`, `continuation`, `app`), Codex's row (goals
    and heartbeats are automatic continuations).
  - Hook protocol (deep-hook and the hub), and Numbers version 0 has to hold (hook overhead: "Under 10 ms at p95 on top
    of process start, except holds"; every task's budgets: five runs, PASS/FAIL/INCONCLUSIVE with the margin; a
    regression is a p50 more than 50% above the merge base's).
- **The base commit**: `248c9695` (origin/main on 2026-10-28, the merge of #789 over `fe593280`). Read there:
  - `packages/hub/src/core.ts` (`queuedAsks`, `enrich`, `readTranscript`, `verify`, `hookReply`),
    `packages/hub/src/ask-tasks.ts` (`tasksOf`, `brief`), `hookmap.ts` (one draft per hook; `FROM`), `server.ts`
    (`holdFor`, `coreReply`: only SessionStart, UserPromptSubmit and Stop get a reply from the core), `plant.ts`.
  - `adapters/claude-code.facts.json` and `adapters/codex.facts.json` (the origin rules: "The app was quit while you
    were working." and `<heartbeat>` decide first; `turnWithoutPrompt` for a goal's turn), `adapters/index.mjs`
    (`mapHook` emits a goal turn's user.ask, which the hub's `hookmap.ts` drops).
  - The corpus: claude-code 2.1.299 `desktop-resume` and `desktop-peer`, 2.1.308 `loop` and `subagent`; codex
    0.163.0-alpha.10.2 `goal` and 0.160.0 `desktop-heartbeat`; `adapters/corpus/README.md`.
  - `spikes/80/decision.json` (in the desktop app a message typed while a call runs is queued, read at that call's
    PostToolUse, and fires UserPromptSubmit only when dequeued; in the terminal it fires UserPromptSubmit at once).
  - `benchmarks/budgets.json`, `scripts/benchmark.mjs` (`validateBudgets`).
- **Sibling suites, for their conventions**: tests/acceptance/303 (helpers, the agent fixture, the budgets test's
  merge-base build, which this suite copies), 315 (the native no-op floor), 25/live (INCONCLUSIVE on load).

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/340/flow --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/340/flow/tsconfig.json
```

- Each test starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
  beside #303's. The implementer adds it.
- Every test makes its folders under `/tmp/dh340f-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port.
- No network, no model, no `claude` or `codex` binary. A child never inherits this process's billing keys or its
  `DEEP_*`, `GIT_*`, `XDG_*`, `CLAUDE*` or `CODEX*` settings.
- AC5's timing test builds the merge base in a temp folder (`git archive`, read from this checkout only) and takes a
  few minutes; the other tests take seconds each on a correct hub.

## The surface under test

- **deep-hook** (`target/debug/deep-hook`), run as the agent runs our hook entry: `deep-hook claude-code <event>` and
  `deep-hook codex <event>`, the hook's JSON on stdin, `HOME` the test's, as a child of the session's own long-lived
  process (`fixtures/agent.mjs`, copied from #303's with one addition: it can also start the AC5 floor binary).
- **`deep hub run`** with the base's test settings: `DEEP_HUB_TEST_DRAFTS` (#303's handed definitions) and
  `DEEP_HUB_PLANT`. No new test setting.
- **The socket**, as the cli role with the control token: `events.read`.
- **Hook stdout**, what the agent and the person get: `hookSpecificOutput.additionalContext` (the agent's context) and
  `systemMessage` (the message Claude Code shows the person in the chat).
- **The perf lane** (AC5): `benchmarks/budgets.json` and `scripts/benchmark.mjs`'s `validateBudgets`.

### Playing the agent

- **Claude Code in the terminal**: as #303's suite plays it. A typed prompt is a transcript entry with
  `turnOrigin: human`, `origin.kind: human`, then UserPromptSubmit.
- **The Claude desktop app** (`entrypoint: claude-desktop`, `CLAUDE_CODE_ENTRYPOINT=claude-desktop`): every prompt,
  typed, scheduled, another session's or a subagent's report, comes with the app's queue pair first, a
  `queue-operation` `enqueue` of its text and a `dequeue` 5 ms later, then its entry and UserPromptSubmit, as the
  2.1.299 desktop sessions show. The corpus has no typed desktop prompt, so a typed one carries `turnOrigin: human`.
  A message typed while a call runs is an `enqueue` between the call's PreToolUse and PostToolUse, with no dequeue
  until after that PostToolUse (#80). The resume prompt is the 2.1.299 desktop-resume session's: `promptSource` and
  `turnOrigin` `sdk`, text `The app was quit while you were working. Please continue from where you left off.`
- **Scheduled task, another session, a subagent's report**: shaped as 2.1.308 loop, 2.1.299 desktop-peer and 2.1.308
  subagent have them (the report's entry `origin.handback: true`; its UserPromptSubmit `prompt` the `<agent-message …>`
  text the queue holds).
- **Codex**: a rollout under `<home>/.codex/sessions/…/rollout-…-<id>.jsonl` opening with `session_meta`
  (`cli_version` the newest the facts cover); each turn a `task_started` (with `turn_trigger`), a `turn_context` with
  its `turn_id`, and the user message that opens it; every payload carries the turn's `turn_id`. A goal's continuation
  turn opens with `<codex_internal_context source="goal">` and fires no UserPromptSubmit: its first hook is a
  PreToolUse. A heartbeat is a UserPromptSubmit whose prompt opens with `<heartbeat>`, as 0.160.0 desktop-heartbeat.

### The terminal's mid-turn path (`terminal.test.ts`)

Added at the owner's request (open question 8 of the first draft), still blind: the issue, the design and the base
commit only. Claude Code 2.1.303 in a terminal, per `spikes/80/decision.json`: a message typed while a call runs
"fires UserPromptSubmit at once", and the transcript also queues it. The spike's terminal log holds no such message,
so the replay is built from that sentence alone: while a Read runs (between its PreToolUse and PostToolUse) the
message's `queue-operation` enqueue is written and its UserPromptSubmit fires at once, with the message as `prompt`
and a prompt ID of its own that no transcript entry carries yet; then the Read's PostToolUse, a dequeue as Claude
Code takes the message, and the next Read. Two messages, `also return 401 …` and then `also add a test for expired
tokens`, one per Read.

- AC2's window there is the message's own UserPromptSubmit through the next call's PostToolUse ("within one tool
  call"), read with ack.test.ts's "names the message" rule (copied into the file, so ack.test.ts is unchanged). Once
  the second message is in, a reply in its window must show both waiting.
- AC4 there: each message is exactly one `user.ask` with its text, from `person`, never two (its UserPromptSubmit and
  its enqueue), and the session holds three from `person` (your prompt and the two messages).
- No helper changed and no new plant: `queue-shows-newest` and `counts-every-enqueue` fit as they are (under
  `counts-every-enqueue` the enqueue is recorded beside the message's own UserPromptSubmit, so it counts twice).
- If Claude Code writes a `turnOrigin: human` entry for the message at once, the replay lacks it; the expected values
  don't change (open question 9).

### Replays: the orderings the corpus leaves open

- **The resume prompt's pair and the resume's SessionStart** (AC3). The corpus gives the transcript's order (pair,
  the app's "No response requested.", the prompt's entry) and the hooks' (SessionEnd `other`, SessionStart `resume`,
  UserPromptSubmit) but not where SessionStart's transcript read falls. The replay writes the pair before the resume's
  SessionStart, as when Claude Code takes the app's prompt from stdin while its SessionStart hooks run, so the hook
  reads it. An enqueue dequeued at once never waited, so on a hub that counts only messages that waited (AC4) the
  order changes nothing; the base reads it as your message.
- **A subagent's report** (AC4). The 2.1.308 subagent session fires the subagent's SubagentHandback PreToolUse and
  PostToolUse (with its `agent_id`), then the report's UserPromptSubmit; its pair's timestamps fall inside that 18 ms
  call. The replay writes the pair between the call's two hooks.
- **The same session process across the desktop app's quit and resume** (AC3). The hub binds a session to its hook's
  parent process (`verify`); a relaunched app's new process is unverified on the base. The replay keeps one process,
  as #303's resume tests do, so the hub reads the resume's hooks.

### What the tests read

- **A prompt's origin and count** (AC3, AC4): the session's `user.ask` events by exact `text`, each one's `from` and
  `tasks`. "Recorded as an automatic continuation, never as your ask": exactly one `user.ask` with its text,
  `from: continuation` (or `scheduled`, `session`, `subagent` for AC4's), `tasks: []`, none from `person`, and the
  session's thread holds no `task.created` but the typed prompts'. "Counted once": exactly one `user.ask` with its text.
  A typed prompt that asks for a change is one `user.ask` from `person` naming one task, with its `task.created` under
  the thread (the control without which a hub that opens nothing would pass).
- **The Codex goal's turn** (AC3): it fires no prompt hook, so its `user.ask` is found by position: the one `user.ask`
  the session records after your first turn's stop and before the heartbeat's. Its text and any turn field are not
  read.
- **"Within its one hook"** (AC4): the message that waited is in the record, from `person`, within 10 s of its call's
  PostToolUse and before the app dequeues it and any other hook fires.
- **The agent's next context** (AC1): the SessionStart(compact) reply's `additionalContext`. A **block** is a run of
  non-blank lines. The test needs one block naming every open requirement ID as a word, under 500 tokens.
- **Tokens** (AC1): counted conservatively, one per two UTF-8 bytes, rounded up. No tokenizer is named by the issue;
  Claude's and GPT's tokenizers average about 3.5 to 4 bytes per token on English and code and over 2 on hex IDs, so
  this count overstates every real one. The base's brief for three asks and twelve IDs reads 139.
- **The visible acknowledgement and the chat line** (AC2): `systemMessage` in a hook's reply. A message typed while
  call N runs must be named by a line of the `systemMessage` of a hook from call N's PostToolUse through call N+1's
  PostToolUse ("within one tool call"). A line names a message when it holds its task's handle (`session:…#n`, from
  its `user.ask`) or its first 24 characters (whitespace collapsed, any case). Every message is acknowledged, the
  mid-turn question included ("each message typed mid-turn"). "The chat line shows the queue": once the second
  message (`also add a test for expired tokens`) is read, one reply in its window shows both asks typed mid-turn, the
  first and the second, still waiting. No wording is fixed.
- **AC5's timing**: see below.

## The prompts

| Prompt | Kind | Where |
|---|---|---|
| `make the auth middleware reject expired tokens` | typed change (#303's) | AC1, AC2, AC3, AC4, AC5 |
| `Add a rate limit of five login attempts per minute.` | typed change (#303's) | AC1, AC4, AC5 |
| `Send a password reset email when a user asks for one.` | typed change (#303's) | AC1, AC5 |
| `also return 401 with a JSON error body when the token is malformed` | mid-turn change | AC2 |
| `also add a test for expired tokens` | mid-turn change (#303's) | AC2, AC4 |
| `why did you pick bcrypt?` | mid-turn question (#303's) | AC2 |
| `The app was quit while you were working. Please continue from where you left off.` | the desktop app's resume prompt | AC3 |
| `The app was quit while you were working, so please add a retry with three attempts to the cart sync.` | your typed look-alike | AC3 |
| a `<codex_internal_context source="goal">` turn with objective `Add a retry with three attempts to the cart sync.` | Codex goal continuation | AC3 |
| `<heartbeat>…<instructions>Add a dark mode toggle to the settings page.</instructions></heartbeat>` | Codex heartbeat | AC3 |
| `Create a goal: add a retry …` and `Set up a heartbeat check that adds a retry …` | your typed Codex prompts | AC3 |
| `Run the login tests and add a retry to the cart sync if any of them fail.` | desktop scheduled task | AC4 |
| a `<cross-session-message …>Add a dark mode toggle to the settings page.</cross-session-message>` | another session's message | AC4 |
| a subagent's `<agent-message …>` report ending `Add a retry with three attempts to the cart sync.` | background subagent's report | AC4 |

Every automatic prompt asks for a change in its words and has a handed definition, so only its origin keeps it from
opening a task, and a hub that opened one would lock it.

## Wrong programs the implementer adds

Each is selected with `DEEP_HUB_PLANT=<name>` on `deep hub run` and listed in `packages/hub/src/plant.ts` (its `Plant`
type and `PLANTS`). A plant the program doesn't list stops the hub from starting (`plantOf` throws), so its test fails
BLOCKED, never passes. `failureOf` rethrows BLOCKED, so a missing plant never counts as the plant's failure.

| Name | Criterion | What the wrong program does | How its test fails |
|---|---|---|---|
| `brief-full-text` | AC1 | the brief SessionStart sends after a compaction or a resume lists each open ask's requirements with their full `text` (and `refuted_by`), not their IDs alone | the block holding the IDs is over 500 tokens; the test requires the message `… must be under 500 tokens; it is <n> …` |
| `brief-at-startup-only` | AC1 | the open asks' requirement IDs are sent only at a SessionStart whose `source` is `startup`, never after a compaction or a resume | the compacted context holds none of the IDs; the test requires the failure on the missing IDs |
| `queue-shows-newest` | AC2 | the chat line names only the message the hook just read, never the asks still waiting | the reply after the second message names it but not the first; the test requires `must show the queue` and the first message's text |
| `continuation-as-person` | AC3 | every prompt or turn the facts mark as an automatic continuation (the desktop app's resume prompt, a Codex heartbeat, a Codex goal's turn) is recorded `from: person` and opens a task as a typed prompt does | the heartbeat is recorded from person; the test requires `<heartbeat>` and `from: person` in the failure |
| `continuation-by-likeness` | AC3 | a prompt is read as the desktop app's resume prompt by its look: any prompt opening "The app was quit while you were working", whatever follows and whoever typed it (a `turnOrigin: human` entry included), is recorded `from: continuation` | your typed look-alike opens no task; the test requires the look-alike's text in the failure |
| `counts-every-enqueue` | AC4 | every `queue-operation` enqueue in the transcript is recorded as a person's message typed mid-turn, the desktop app's enqueue before each prompt included, besides the prompt's own UserPromptSubmit | your first prompt is counted twice; the test requires `"make the auth middleware reject expired tokens" must be counted once` |
| `slow-brief` | AC5 | the SessionStart reply after a compaction or a resume is sent 25 ms late, on the hook's path, as a brief that re-read the record and the transcript there would be | the instrument must read every run over 10 ms |

The issue names no wrong program. The base fails AC2, AC3 and AC4 on their assertions (`BASE-FAILURE.txt`). AC1's
criterion already holds on the base (#303 sends the brief), so it is proven on its two plants. AC3's heartbeat alone
holds on the base, so it is proven on `continuation-as-person`; the typed look-alike, a control the base may well
meet, is proven on `continuation-by-likeness`. AC4's checks before the subagent's report (your first prompt, the
message that waited, the scheduled task's prompt, the other session's message) hold on the base, so they are proven
on `counts-every-enqueue`.

## AC5: the timing

1. **The perf lane** (`budgets.test.ts`, first test): `benchmarks/budgets.json` must have a task whose reason names
   `#340` and says it times the SessionStart hook after a compaction (`SessionStart` or `compact` in its reason), valid
   against the merge base's budgets by `validateBudgets`, and its command runs and exits 0. The base has none.
2. **The timing** (second test): on this checkout's hub and on the merge base's (built from `git archive` in a temp
   folder, as #303's budgets test builds it), a terminal session opens the three asks of AC1 and locks their
   definitions. Before any number is read, this checkout's compacted reply must name every requirement ID. Then, after
   five warm-up compactions per side, five runs per side, alternating, each of 20 SessionStart(compact) hooks and 20
   floor starts interleaved, each start after a 250 ms pause so the work a start leaves in the hub has ended. The floor,
   "process start", is a native no-op binary (`fn main() {}`, `rustc -C opt-level=3`), started by the same session
   process the same way as the hook (#315's floor). The same deep-hook binary, this checkout's debug build, runs both
   sides. A run's overhead is its hooks' p95 less its floor's p95.
   - PASS: every run under 10 ms, and no regression.
   - FAIL: every run over 10 ms by more than the margin (the larger of 5% and the runs' spread), or every run's p50
     hook time more than 50% above the merge base's and over it by more than 1 ms.
   - INCONCLUSIVE otherwise, and always when the machine isn't a reference Mac (Mac15,7 M3 Pro 36 GiB, Mac15,12 M3
     16 GiB) or its 1-minute load is past its core count, or the merge base can't be built: skipped with the readings,
     never passed. Mains power, Low Power Mode and the thermal state are not read.
3. **The instrument** (third test, any machine): with `slow-brief`, every run reads over 10 ms.

## Criteria to tests

Each `describe` and test name starts with its criterion's number and ID, `#340.<first 8 hex of SHA-256 of the
criterion's text>` (trimmed, whitespace collapsed, as `scripts/proof-change.mjs` computes it); every failure message
starts with them too.

| ID | Criterion (short) | Test file | Tests | On the base |
|---|---|---|---|---|
| AC1 `#340.e5f83881` | after `/compact`, the open asks' IDs in one block under 500 tokens | `compact.test.ts` | three asks, twelve IDs, SessionStart(compact); plants `brief-full-text`, `brief-at-startup-only` | passes; plants BLOCKED |
| AC2 `#340.2dc7b69b` | each mid-turn message acknowledged within one tool call; the chat line shows the queue | `ack.test.ts` | three messages typed during Reads in the desktop app; plant `queue-shows-newest` | fails: no `systemMessage` in any window |
| AC3 `#340.ff3d5215` | Codex goal continuations, heartbeats and the desktop resume prompt are `from: continuation`, never your asks | `continuations.test.ts` | desktop resume replay with a typed look-alike; Codex goal turn, heartbeat and typed prompts; plants `continuation-as-person`, `continuation-by-likeness` | fails: the resume prompt recorded from person with a task; no user.ask for the goal's turn |
| AC4 `#340.0abe1257` | mid-turn messages counted from messages that waited, not the app's enqueue of every prompt | `queue.test.ts` | desktop replay: typed prompts, a message that waited, scheduled, peer and a subagent's report, each with the pair; plant `counts-every-enqueue` | fails: the subagent's report recorded twice from person |
| AC2 `#340.2dc7b69b` (terminal) | the same, where the message fires UserPromptSubmit at once | `terminal.test.ts` | two messages typed during Reads in the terminal, each with its enqueue and an immediate UserPromptSubmit; plant `queue-shows-newest` | fails: no `systemMessage` from the message's own UserPromptSubmit through the next PostToolUse |
| AC4 `#340.0abe1257` (terminal) | the same message counted once, not from both its UserPromptSubmit and its enqueue | `terminal.test.ts` | the same replay; plant `counts-every-enqueue` | fails: the message is one user.ask but `from: unknown` |
| AC5 `#340.ba97030c` | SessionStart after a compaction under 10 ms at p95 over process start, against the merge base | `budgets.test.ts` | the perf lane's #340 task; the timing; plant `slow-brief` | perf lane fails; timing read FAIL once, INCONCLUSIVE once (load ~10); plant BLOCKED |

## Open questions for the owner

1. **Who writes the acknowledgement** (AC2). Scope says "the agent acknowledges each new ask in one line"; AC2 says
   "a visible acknowledgement within one tool call". Without a model the test can only read what DeepBuild shows, so
   it reads Claude Code's `systemMessage`, the message the person sees. If the acknowledgement is meant to be the
   model's own line, prompted by context, AC2's first half needs a redraft (and a live check).
2. **"The chat line" and "the session's line"**. The design's session's line is the app's canvas line (R2); AC2 names
   "the chat line". The tests read the chat (the hook reply's `systemMessage`) only. Which asks the queue lists is not
   stated; the test needs the two asks typed mid-turn that are still open, and asks nothing of the first prompt's.
3. **A person typing the resume prompt's exact text**. The facts and the corpus README say the app's text decides
   first, so typed word for word it would be `continuation`. The suite's look-alike differs by a comma; whether the
   exact text typed by you (`turnOrigin: human`) counts as yours is left open.
4. **Where the resume's SessionStart reads the transcript** (Replays, above): the replay puts the pair before it.
5. **Is SessionStart's context hold inside the hook overhead budget?** The design's row says "except holds", and the
   hub holds SessionStart for its context (`CONTEXT_HOLD_MS`). The criterion says the SessionStart hook stays "inside
   the hook overhead budget, under 10 ms at p95 on top of process start", so the test times the whole hook. On the
   base, which already sends the brief, it reads 20-45 ms over process start at load ~10 (FAIL once, INCONCLUSIVE
   once). If the hold is exempt, the criterion is about what the brief adds, and the test should compare against the
   merge base instead of the absolute 10 ms. The deep-hook timed is the debug build every suite uses, not a release
   build.
6. **The goal turn's `user.ask` fields** (its `text`, a `turn` field, which the corpus's expected event carries but
   `user.ask@1` may not) are not read.
7. **Desktop typed prompts' entries**: no recording holds one; the replay marks them `turnOrigin: human`.
8. **The terminal's mid-turn message**, which fires UserPromptSubmit at once (#80): now replayed in
   `terminal.test.ts` (The terminal's mid-turn path, above).
9. **What the terminal writes for that message at once.** The spike says only that UserPromptSubmit fires at once and
   the message is queued. The replay gives the UserPromptSubmit a fresh prompt ID with no transcript entry, so the
   facts' origin rules can't place it and the base records it `unknown`; the enqueue that waited is what shows a
   person typed it. Whether 2.1.303 also writes a `turnOrigin: human` entry, or reuses the running turn's prompt ID,
   is unrecorded; a live recording should settle it.

## Files

- `helpers.ts`: temp worlds, the hub as a process, `events.read`, the record readers (`expectTask`, `expectAutomatic`,
  `expectOnlyTasks`), hook-reply readers (`contextOf`, `visibleOf`), the three open asks (`OPEN_ASKS`, `openAsks`),
  Claude Code sessions (terminal and desktop, with the queue pair) and Codex sessions.
- `fixtures/agent.mjs`: each session's agent stand-in, the parent of that session's deep-hook runs and of AC5's floor.
- `compact.test.ts` (AC1), `ack.test.ts` (AC2), `continuations.test.ts` (AC3), `queue.test.ts` (AC4), `terminal.test.ts` (AC2 and AC4 in the terminal),
  `budgets.test.ts` (AC5).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.
