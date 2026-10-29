# Acceptance tests for #83: the verdict in the chat, and status answered from the record

Written first, blind, from issue #83 (its body as of October 28, 2026: the Scope bullets, the twelve acceptance
criteria and the Proof line), the design sections it links and those they lean on (An agent says it's done: Every
stop is judged, Fast and slow lanes, Latest snapshot wins, Stale results stay stale, The verdict in the chat; The done
loop; the Verdict primitive; What each agent gives us, the Claude Code and Codex rows with the prompt origins and
"A Stop hold becomes the next prompt"; States people see; One event log; the Hook protocol) and base commit `7b39aa0d`
(origin/main, "Merge pull request #778"), by a job that never saw an implementation; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

At the base the hub answers a Stop with nothing unless a question is open or a send-back is planted, answers a
UserPromptSubmit only with answers on their way back, holds no Codex stop, serves no `test.verdict`, and `deep setup`
writes Claude Code's settings only. So every criterion fails there (BASE-FAILURE.txt).

## How to run

With the workspaces built (`npm run build --workspaces`) and `target/debug/deep-hook` built:

```sh
npx vitest run --root tests/acceptance/83 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/83/tsconfig.json
```

- `--no-file-parallelism`: each file starts hubs and stand-in sessions, and `budgets.test.ts` times them.
- Every test makes its folders under `/tmp/dh83-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h` for
  every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. It stops only
  processes it started, by PID, and the process groups its stand-in started for hook entries, by group ID. No child
  inherits a billing key, a forge token, a `CLAUDE*` variable or a `DEEP_*` setting of the runner's. No test runs a
  live agent or reaches the network: the forge is a stand-in on 127.0.0.1.
- `<tmp>/bin` is first on `PATH`: stand-ins for `launchctl`, `systemctl`, `claude` and `codex` (each logs its call and
  exits 0) and a `deep` that runs the built CLI, so `deep setup` can't register a login service on this Mac.
- With `--root` here, Vitest writes its cache to `tests/acceptance/83/node_modules/.vite/`; delete it before committing.
- `budgets.test.ts` builds the merge base at `/tmp/dh83-base-<sha12>` when this checkout's code isn't the base's (kept
  between runs); remove it to reclaim the space.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub**: `deep hub run` with `HOME` the temporary home; its ready line; the socket's line protocol; a `cli`
  connection with the control token; `events.read`, `inbox.read`, `changes.read`. `DEEP_HUB_PLANT=<name>` selects a
  planted program (#16); `DEEP_HUB_TEST_CONFIRM` stubs the OS confirmation (#24); `DEEP_HUB_TEST_FORGE=<url>` names
  the forge API the hub reads instead of `https://api.github.com` (the base's archive option).
- **`deep setup`** (#18): writes DeepBuild's entries into `~/.claude/settings.json`; the Stop entry and the
  UserPromptSubmit entry run `deep-hook claude-code <event>`.
- **deep-hook** (the hook protocol): `deep-hook <agent> <event>` with the hook's JSON on stdin; the hub's reply mapped
  to the agent's own output, printed on stdout with its exit code. A reply that blocks is `{"decision":"block",
  "reason":…}` (exit 0); context is `{"hookSpecificOutput":{"hookEventName":…,"additionalContext":…}}`.
- **`deep mcp`** started by the session's process; **`deep_claim`** (#26, #28) filing `claim.made` for the session, its
  handle `claim:<event id>`; **`deep_ask`** filing an ask, which waits in your inbox (the Needs-you count).
- **The record** (#14, #28): `claim.made`, `verdict.made` (writer core, the engine's shape: `outcome`, `requirements`
  with each one's `outcome`, `check`, `smallest`, `points_to`), `run.started` and `run.finished` (each with its
  `check` and `outcome`), `user.ask` with its `from` (the prompt's origin), `session.attention` and the `sessions`,
  `claims`, `verdicts`, `runs`, `asks` and `session_files` projections.
- **Prompt origins** (#18, adapters/claude-code.facts.json): a prompt's origin is read from the transcript entry its
  `prompt_id` joins to: `turnOrigin: human` is `person`; `scheduled` is `scheduled`; `task_notification` or
  `origin.handback` is `subagent`; `peer` is `session`; a prompt with no entry is `unknown`. Codex prompts are
  `person` unless a heartbeat.
- **Claude Code's hook output** (the hooks reference, and #80's record): a Stop entry's `{"decision":"block",
  "reason"}` continues the turn with the reason; a UserPromptSubmit entry's `{"decision":"block","reason"}` keeps the
  prompt from being processed, and the reason is shown to the person; a reply's `systemMessage` is shown in the chat,
  which the desktop app saves as a `hook_system_message` attachment. Codex reads the same output shapes from
  `~/.codex/hooks.json` entries (design: "The same events").

### Defined here, where the issue and the design leave a surface open

1. **The Claude Code stand-in** (`fixtures/claude.mjs`, copied from #25's and extended) is Claude Code's side of the
   hook contract, the boundary these tests don't own. One process per session; it runs each entry of the user settings
   file with `/bin/sh -c`, the payload on stdin, each in its own process group, and starts its own `deep mcp`. What it
   adds for #83 is only what the hooks reference and #80 recorded: a Stop entry's block continues the turn ("Stop hook
   feedback" in the transcript); a UserPromptSubmit entry's block keeps the prompt from the model and shows the
   reason (saved as a `hook_blocked_prompt` attachment); a reply's `systemMessage` is saved as a `hook_system_message`
   attachment; and **the hook log** at `<tmp>/hooks.jsonl`, one line per hook run (`{at, agent, session, event, phase:
   start | reply, invocation, prompt?, reply, exit, ms}`) and one `{phase: "model", session, prompt}` line whenever a
   prompt reaches the model (a UserPromptSubmit no entry blocked). The issue's proof, "the hook log showing no model
   call for a status question", is this log holding no `model` line for that prompt. Codex's hooks are run directly,
   `deep-hook codex <event>` with a Codex-shaped payload (`turn_id`, `model`, `permission_mode`), as the entry Codex
   runs; their replies go to the same log.
2. **A judged stop** (design: Every stop is judged) is the Stop of a turn that began with a prompt a person typed and
   made an Edit through its hooks (`edits`), or in Codex ran a command. Two stops with no new work still count. The
   agent's last message is never read.
3. **Where the line shows.** In Claude Code's chat, the line is the Stop reply's `systemMessage`; when the stop is sent
   back it is also the first line of the block's `reason`. In Codex's chat it is the Stop reply's `systemMessage` or,
   for a block, the first line of its reason; a verdict that lands after Codex's hold is delivered as the next
   UserPromptSubmit reply's `additionalContext` (or a block's reason), carrying the line. Tests read the line at the
   agent's side only, never from the hub.
4. **The line.** Parts in the issue's order, joined by ` · `, each left out when empty, at most 80 columns:
   1. `not verified: <requirements>`, when the verdict has a requirement whose outcome is BLOCKED, INVALID or
      INCONCLUSIVE: each named by the part of its handle after `#` (`R2`), joined by `, `;
   2. the outcome and its count: `PASS <passed>/<total>`, `BLOCKED <passed>/<total>`, `INVALID …`, `INCONCLUSIVE …`
      over the verdict's requirements; `sent back <round>/3` for FAIL (the round of the stalled-claim rule's three);
      with no verdict yet, `says done` with `<passed>/<total>` when any requirement already passed, then `<n> checks
      running` and `about <time>` (the longest expected time, in minutes rounded, or seconds under a minute);
   3. the one cause, `: <smallest>` after the count, then ` · <file>:<line>` from `points_to`, for FAIL and BLOCKED;
   4. the next step's owner, `next: agent` (FAIL, INVALID), `next: you` (PASS, BLOCKED), `next: DeepBuild`
      (INCONCLUSIVE, and while checks run);
   5. `receipt`.
   A line that would pass 80 columns shortens the cause first, from its end, marked `…`; "not verified" and the outcome
   with its count are never dropped. The design's words for states (States people see) are the only words that name
   one. `goldens/*.json` hold the record state and the line for says done, checks running, sent back, PASS and
   BLOCKED, and the long-cause fixture's parts.
5. **The second line** (`second` on the receipt; not asserted by any criterion here beyond its presence on the receipt)
   carries the checks run, the PR or MR state and links, what the ask produced and the next unblocked issue.
6. **A status question** is one of "still going?", "all done?", "what's next?", "anything for me?", the issue's four,
   typed by a person (origin `person`). **Answered from the record with no model call** is the UserPromptSubmit reply
   blocking the prompt with the answer as its `reason`, and the hook log holding no `model` line for it. The answer
   holds the session's state (one of the design's words), how long it has been in it (a duration such as `3m`, `45s`,
   `2 min`), the next step (the word `next`), and the Needs-you count, written as `needs you` beside the number (the
   open asks in your inbox, `inbox.read`). A prompt with any other origin, `unknown` included, isn't blocked and
   reaches the model (a `model` line). For "what's next?" the answer also names where the work is (the session's
   worktree path), the session that holds it (its ID, at least its first 8 characters), how to resume it (a line
   holding `resume` and the session's ID) and its link (a URL, `<scheme>://…`).
7. **The receipt** is `changes.read {id: <claim id>}` for the claim, whose `change` the implementation extends with:
   `line` (the line the chat showed), `second` (the second line), `checks: [{check, outcome}]` (every run of the
   claim's checks, from `run.finished`), `asks: [{ask, pr: {state, url} | null}]` (the claim's ask and its queue, each
   with its PR), `produced: {pr: url | null, files: [paths], pages: [urls]}` and `next_issue: {number, url} | null`.
   A PR's `state` is `checks running` (its head's check runs or commit status pending on the forge), `open`, `merged`,
   or `released` (a release on the forge whose target is the merge commit). The receipt reads the forge when read.
8. **The ask's PR** is the one the session opened with `gh pr create` through its hooks: the Bash call's result holds
   the PR's URL. Its issue is the PR body's `Closes #n`. **The files it wrote** are the paths of the session's Edit and
   Write calls (the `session_files` projection), absolute or relative to the worktree.
9. **The next unblocked issue in its epic** (AC9): the issue's epic is its body's `**Epic:** #n`; its dependencies the
   `### Depends on` list (this repo's own issue shape). Once the ask passes, the next issue is the lowest-numbered open
   issue of the same epic, other than the PR's, whose every dependency is closed or is the issue that just passed;
   none when there is none. Before a PASS the receipt names none.
10. **The forge stand-in** (`startForge`): a GitHub-shaped API on 127.0.0.1 serving `/repos/{o}/{r}/pulls/{n}`,
    `/pulls`, `/commits/{sha}/check-runs`, `/commits/{sha}/status`, `/issues/{n}`, `/issues?state=…` and `/releases`,
    named to the hub with `DEEP_HUB_TEST_FORGE` and a dummy `GH_TOKEN`. The session's worktree is a repo whose `origin`
    is `https://github.com/acme/widgets.git`; nothing reaches the network.
11. **Budgets** (AC12, modeled on #25's live suite): one measurement is twenty sessions on one hub, each begun, edited,
    stopped and asked "still going?"; a sample is how long DeepBuild's UserPromptSubmit entry ran, from Claude Code
    starting it to its exit (the hook's wall time at the agent's side, deep-hook and the hub's answer included). A
    prompt not answered from the record, or that reached the model, fails the measurement naming the session, unless
    the machine was loaded past its cores (INCONCLUSIVE). A warm-up, the merge base measured by the same driver on its
    own build, then five runs; the five p95s are judged against under 100 ms (PASS when all are under; FAIL when all are
    over by more than the larger of 5% and the runs' spread; else INCONCLUSIVE); a reading regresses when this
    checkout's median is more than 50% above the base's and more than 2 ms from it. A merge base that doesn't answer
    has no reading, printed as such, and nothing regresses. Readings count only on a reference Mac (Mac15,7 with an M3
    Pro and 36 GB, or Mac15,12 with an M3 and 16 GB), Low Power Mode off, thermal state nominal, not loaded past its
    core count; anywhere else the test skips as INCONCLUSIVE with the readings, never PASS. "In the local preflight":
    some check lane in `scripts/lanes.mjs` runs `budgets.test.ts` with `--no-file-parallelism`, not excluded.

### Additions the implementation must make

1. **`test.verdict`**, a hub method on a `cli` connection, served only when the hub runs with `DEEP_HUB_TEST_VERDICT=1`
   (otherwise refused as `unknown_method`, like `test.send_back` without its flag). It plants a record state on a
   session's claim by appending the events the design names, as the core would, so the line and the receipt are read
   from the record alone. Params:

   ```json
   { "session": "<session ID>", "claim": "claim:<id>",
     "outcome": "PASS" | "FAIL" | "BLOCKED" | "INVALID" | "INCONCLUSIVE" | null,
     "requirements": [{ "req": "req:<definition>#R<n>", "outcome": "PASS" | "FAIL" | "BLOCKED" | "INVALID" | "INCONCLUSIVE" | "pending",
                        "check": "<check id>", "smallest": "<text>" | null, "points_to": "<file>:<line>" | null }],
     "round": <send-back round, for FAIL>,
     "running": [{ "check": "<check id>", "about_s": <expected seconds> }],
     "ran": [{ "check": "<check id>", "outcome": "passed" | "failed" }] }
   ```

   With an `outcome`, it appends one `verdict.made` (writer core, subject the claim) with that outcome and those
   requirement outcomes; with `null`, no verdict. Each `ran` entry appends a `run.started` and `run.finished` for the
   claim's check with that outcome; each `running` entry a `run.started` with no finish, its expected time kept where
   the line reads it. Every hub in this suite starts with `DEEP_HUB_TEST_VERDICT=1`.
2. The **Codex side**: a judged Codex stop records a claim (`claim.made`) the verdict lands on, its Stop reply carries
   the line, and a verdict that lands after the hold is delivered on the next prompt (the issue's third Scope bullet).
3. The **receipt** fields, the **forge** reads and the **status answer** of Defined here 6 to 10.

## Criteria to tests

Each test's name starts with its criterion's number and ID, `#83.<first 8 hex of SHA-256 of the criterion's text,
trimmed, whitespace collapsed>`, as `scripts/proof-change.mjs` computes it.

| ID | Criterion (short) | Test | Fails at the base, and on |
|---|---|---|---|
| AC1 `#83.8a03aacc` | the line in both chats at every judged stop | `line.test.ts`: Claude Code's judged stop (an Edit, then Stop) replies with a line ≤ 80 columns naming a state, shown in the transcript, and so does a second stop with no new work; Codex's judged stop (a command, then Stop) replies with the line, and a PASS planted after it reaches the next prompt's reply as `PASS 2/2` | the base: an empty Stop reply (Claude Code), an empty Codex Stop reply and no claim |
| AC2 `#83.5bcede40` | a status question returns state, time, next step, Needs-you count, no model call | `status.test.ts`: with one ask open in your inbox, each of the four questions typed after a judged stop is blocked with an answer naming a state word, a duration, `next` and `needs you` with the inbox count, and leaves no model line; a work prompt reaches the model | the base: no block, a model line |
| AC3 `#83.fd11082e` | never PASS without a verdict | `line.test.ts`: a judged stop with a claim and no `verdict.made` never says PASS; with checks running and no verdict it says `2 checks running`, not PASS; after a planted PASS it says `PASS 2/2`; a last message saying "PASS 4/4" changes nothing | the base: no line at all; a wrong program that reads the agent's words |
| AC4 `#83.4b0836ba` | only a person's prompt is answered from the record | `status.test.ts`: "still going?" from scheduled, subagent, session and unplaced origins isn't blocked and reaches the model; typed, it is answered; `unplaced-is-person` fails the unplaced check naming the prompt | the base (the typed one isn't answered); `unplaced-is-person` |
| AC5 `#83.87a5093c` | the owner on the line; the checks on the receipt | `line.test.ts`: a send-back names `next: agent`, BLOCKED and PASS name `next: you`; the receipt lists `unit` and `journey:checkout` with their outcomes and the same line | the base: no line, no `test.verdict` |
| AC6 `#83.eb2dc033` | where the work is, who holds it, how to resume, its link | `status.test.ts`: "what's next?" is answered with the worktree path, the session ID, a resume line naming it and a URL, with no model call | the base: no block |
| AC7 `#83.28c3309c` | each ask's PR state and link | `receipt.test.ts`: the ask's PR reads `checks running`, then `open`, `merged` and `released` as the forge moves, each with its link | the base: `changes.read` has no `asks` |
| AC8 `#83.89bfa3a4` | the receipt links the PR, the files, the pages | `receipt.test.ts`: `produced.pr` is the PR's URL, `produced.files` holds `total.ts`, `produced.pages` is a list | the base: no `produced` |
| AC9 `#83.e8038389` | the next unblocked issue in the epic | `receipt.test.ts`: none before a PASS; after it, #42 (depends on #41, passed), not #43 (blocked by #99) nor #99 (another epic); with #42 also depending on #43, none | the base: no `next_issue`; a lowest-open-issue reading (the second test) |
| AC10 `#83.09932b63` | "not verified" first, before any PASS count | `line.test.ts`: INCONCLUSIVE with R2 never run: the line starts with `not verified`, names R2, any count and outcome word after it; all PASS starts with `PASS 3/3`; a count-first line fails | the base: no line |
| AC11 `#83.15ee3b42` | goldens fit the width; the long cause shortens first | `goldens.test.ts`: each golden's planted state gives its line exactly, ≤ 80 columns; the long-cause line keeps `not verified: R2`, `sent back 2/3`, `total.ts:42`, `next: agent`, `receipt`, cuts the cause from its end with `…` | the base: no line; a line that drops "not verified" or keeps the whole cause |
| AC12 `#83.b4c17e65` | answered under 100 ms, no model call, vs the merge base, on the reference Mac | `budgets.test.ts`: (1) a lane runs the file one at a time; (2) warm-up, the merge base, five runs of twenty, p95 under 100 ms, no model call, no regression; (3) the instrument: a work prompt shows as a model call | the base: no lane (1); every session unanswered (2) |

## Open questions (left to the implementer; not asserted beyond what the table says)

- **The line's exact words.** The issue gives three examples and an order; the parts' spellings in Defined here 4
  (`not verified:`, `next: <owner>`, `says done`, `receipt`, the count shapes) are this job's reading. The goldens
  compare exactly, as AC11 asks, so a different spelling is a dispute for a blind redraft, not an edit.
- **The receipt's "pages or deploys the record saw"** (AC8): no record event at the base names a page or a deploy, and
  the issue says what the record saw, so the test only asserts the receipt has the list. A record event for pages and
  deploys, and the receipt linking them, is open.
- **"Released once a release is recorded"** (AC7): read from the forge's releases whose target is the merge commit;
  whether a release is also a record event is open.
- **The status answer's link** (AC6): the facts name no link that opens a session in the agent's app at the base; any
  URL is accepted.
- **Codex's prompt block.** Whether Codex keeps a blocked prompt from its model as Claude Code does isn't in its
  facts; AC2, AC4 and AC12 are read at Claude Code's side only, and the Codex side of AC1 reads the Stop and the
  next prompt's context.
- **The Needs-you count** is read as your inbox's open asks; a per-session count would be a dispute.
- **"Its queue included"** (AC7): the receipt's `asks` list is asserted to hold the claim's ask with its PR; a second
  queued ask isn't made.

## Files

- `helpers.ts`: temp homes and stand-in tools, `deep setup`, the hub as a process and its socket, sessions and
  transcripts with their origins, the Claude Code stand-in's client, Codex's hooks, the claim, `test.verdict`, the
  receipt, the forge stand-in, the reference-Mac gate and the merge base.
- `fixtures/claude.mjs` (the Claude Code stand-in), `fixtures/stub-bin.sh` (launchctl, systemctl, claude, codex).
- `goldens/*.json` (AC11's record states and lines).
- `line.test.ts` (AC1, AC3, AC5, AC10), `status.test.ts` (AC2, AC4, AC6), `receipt.test.ts` (AC7, AC8, AC9),
  `goldens.test.ts` (AC11), `budgets.test.ts` (AC12).
- `BASE-FAILURE.txt`: the run on the base commit and why each test fails there.
