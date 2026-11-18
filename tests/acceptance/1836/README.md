# Acceptance tests for #1836: a subagent's stop ends no turn a proceed started

Written blind by a job that saw only the issue, the design and the base commit, and nothing of any work on #1836. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

What was read:

- Issue #1836: its problem, Scope, the one acceptance criterion (`#1836.76416703`), Proof and Depends on (#321, #1014).
- `docs/technical-design.md`: An ask, and your answer getting back (Questions at the stop, with "A 'proceed' never
  covers a call that needs authority"); Dogfooding.
- At the base (`c740dede7`), to learn the surfaces: `packages/hub/src/{holds,plant,server,hookmap}.ts`,
  `packages/contracts/schemas/agent.stop@5.json`, `crates/deep-hook/default-rules.json`,
  `adapters/corpus/claude-code/2.1.308/subagent` (the Agent call, the SubagentStop payload and the subagent transcript
  path), and the suites `tests/acceptance/321` (harness, planted sorter, held calls), `tests/acceptance/1014` (the
  SubagentStop under the parent's `session_id`, a named plant) and `tests/acceptance/1156` for conventions.

## Run

```sh
npm ci                                                                   # once
npm run build --workspaces                                               # `deep hub run` from packages/cli/dist
env -u CARGO_TARGET_DIR cargo build --locked -q -p deep-hook --target-dir target   # target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1836 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1836/tsconfig.json
```

About 10 s on a correct hub; a failing one waits up to 90 s for an ask. No network, no model, no `claude` binary. Each
test's folders are under `/tmp/dh1836-*`, with `HOME` set to `<tmp>/h` for every process it starts; every process is
stopped by its PID (`helpers.ts`, `cleanup`, `stopHub`), never by name or port. Each test starts its own hub, so the
folder runs one file at a time.

## The surface used

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry, `deep-hook claude-code <event>`
  with the payload on stdin, as a child of one long-lived stand-in process per session (`fixtures/agent.mjs`, copied
  from #321's). Payloads and transcripts are shaped like the 2.1.308 corpus.
- **`deep hub run`** with `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_SORTER` (#321's planted sorter: a file naming its rule
  and the questions it answers "proceed") and `DEEP_HUB_PLANT`.
- **The socket**, as the cli role with the control token: `events.read`. The test reads `question.proceeded`,
  `agent.stop` (its `data.child`), `tool.before` (its `late`) and `ask.created` (its `kind` and `question`).
- **Files** under `HOME`: `~/.deepbuild/rules.json`, the shipped default guards with `merge-needs-ask` and
  `merge-names-head` in watch mode (below); `~/.deepbuild/config.json`, #321's ask settings.

## The session replayed

You type "Fix the login bug in src/login.ts."; the agent writes a file and ends its turn on "want me to run the
tests?", which the planted sorter answers "proceed" (the record holds `question.proceeded`, and the stop's reply says
proceed). In the turn that proceed starts, the agent runs a foreground subagent: the Agent call's PreToolUse (allowed),
the subagent's `SubagentStop` under the parent's `session_id` with `agent_id`, `agent_type`, `agent_transcript_path`,
`stop_hook_active` and `last_assistant_message` (the record must hold it as the session's `agent.stop` naming the
child, or the test is BLOCKED), and the Agent call's PostToolUse. Then the agent calls Bash `gh pr merge 12`.

The criterion, as asserted:

1. The merge is not let through at PreToolUse, and within 90 s an ask raised after the subagent's stop names
   `gh pr merge 12`.
2. That ask is `kind: authority`, and its question names the proceed: it says "proceed" and quotes the proceed's
   question, "want me to run the tests?".
3. "One authority ask": the agent calls the merge again before you answer; 5 s later neither run has gone through,
   and exactly one ask names the merge.

A run deep-hook let through because the hub's acknowledgement came late (`tool.before` marked `late`) is INCONCLUSIVE,
never a pass or a fail.

## The plant (a new surface the work must add)

Name: **`proceed-ends-at-child-stop`**, a new `DEEP_HUB_PLANT` value in `Plant` and `PLANTS` in
`packages/hub/src/plant.ts`. The wrong program: the hub's proceed-turn query (`proceeding()` in `holds.ts`) counts an
`agent.stop` that names a `child` as ending the turn, as the base does. So after a subagent's stop no proceed turn is
found and the merge runs with no ask. Nothing else changes.

The plant test runs the same session on a hub started with `DEEP_HUB_PLANT=proceed-ends-at-child-stop`. It passes only
when the main test's checks fail there, with a failure message naming `gh pr merge 12`. A hub that refuses the name (the
base) is BLOCKED, so the plant test fails.

## How the issue was read

- **"Holds the merge with one authority ask naming the proceed"** is the ask `holds.ts` raises for a proceed's turn.
  At the base its question reads ``Run `<call>`? It merges, in the turn a "proceed" started for "<question>" (rule
  <rule>); ...``. The test reads only that the question says "proceed" and holds the proceed's question, not the rest
  of the wording.
- **The merge's request defaults are in watch mode.** With the shipped `merge-needs-ask` in block mode, the hub settles
  a merge first, by whether a request in the thread names it. That raises its own authority ask ("no request in this
  thread names that") and takes `merge` out of the proceed hold's classes ("What the defaults settled needs no proceed's
  hold"). Measured at the base: under the full default guards, `gh pr merge 12` is held by that ask with or without
  the subagent. The proceed's ask never shows, so nothing about #1836 could be seen. Every other guard is as shipped,
  `authority-merge` included. The hub counts `merge-needs-ask` and `merge-names-head` only in block mode, and you may
  set them to watch, so the home holds them in watch mode. Then, as the issue says, the proceed hold is all that stands
  between a proceed's turn and the merge.
- **The subagent runs in the foreground**: its SubagentStop comes before the Agent call's PostToolUse, inside the turn.
  The subagent's own tool calls aren't sent, because the issue doesn't name them.
- **Proof "on the branch and the merge base"**: the base run is recorded here. The branch run is the implementer's.

## What the base does

Both tests fail; `BASE-FAILURE.txt` has the run.

- Main test: `gh pr merge 12` is allowed at PreToolUse (exit 0, nothing held) after the subagent's stop, with no ask.
  This is the issue's bug.
- Plant test: BLOCKED, because `DEEP_HUB_PLANT=proceed-ends-at-child-stop names no planted program`.

Checked at the base, with no product source changed:

| Program | Main test |
| --- | --- |
| The base, same session with the subagent step left out (scratch edit, reverted) | passes: the proceed's ask holds the merge, and a retry raises no second ask |
| The base, with the ignored `packages/hub/dist/holds.js` query skipping an `agent.stop` that names a child (a stand-in for the fix, restored after) | passes |
| The base as it is (it behaves like the plant) | fails, naming `gh pr merge 12` |

## Not covered

- A background subagent whose stop comes after the session's own stop or in a later turn.
- Codex's SubagentStop: the issue's Proof names a Claude Code session.
- Push, dispatch, send and delete after a subagent's stop: the criterion names the merge.
