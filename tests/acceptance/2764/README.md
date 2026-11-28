# Acceptance tests for #2764: a Codex subagent's prompt ends no turn a proceed started

Written blind by a job that saw only the issue, the design and the base commit, and nothing of any work on #2764. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

This is a reissue of that suite with no fixed waits, as the wait ratchet (#1604, #3139) judges a new blind suite's files
from zero: each wait is now for the event it needs, and a timer only bounds one. The criterion, the test names, the
criterion tag, the expected values and the judges are unchanged, and so is each test's failure at the base (What the
base does). `BASE-FAILURE.txt` is the run recorded on the first issue; its line numbers are that issue's.

What was read:

- Issue #2764: its problem, Scope, the one acceptance criterion (`#2764.d93a7447`), Proof and Depends on (#321, #1836).
- `docs/technical-design.md`: An ask, and your answer getting back (`node scripts/design-section.mjs --issue 2764`);
  Dogfooding.
- At the base (`58b4a8cb2`), to learn the surfaces: `packages/hub/src/holds.ts` (`proceeding()`, `gate`,
  `heldEffect`, `namedDefaults`), `packages/hub/src/core.ts` (the Codex subagent's prompt recorded as `user.ask` with
  `from: 'subagent'`), `packages/hub/src/hub-shared.ts` (`childPrompt`), `packages/hub/src/stop-judging.ts` (the
  turn boundary that leaves that row out), `packages/hub/src/stop-reply.ts` (the planted sorter at a stop),
  `packages/hub/src/server.ts` (when a Codex stop is held), `packages/hub/src/plant.ts`, `packages/hub/src/named.ts`,
  `crates/deep-hook/default-rules.json`, `crates/deep-hook/src/matcher.rs` (which calls are `effect:delete`),
  `packages/adapters/src/codex-hooks.generated.ts` (Codex's hook inputs: `UserPromptSubmit` with `agent_id` and
  `agent_type`, `SubagentStart`), `adapters/corpus/codex/0.166.0-alpha.5.1/tools` (payload and rollout shapes), and
  the suites `tests/acceptance/1836` (harness, copied), `tests/acceptance/321`, `tests/acceptance/39` and
  `packages/hub/test/codex-hub.test.ts` (how a Codex subagent's prompt and hooks are driven).

## Run

```sh
npm ci                                                                   # once
npm run build --workspaces                                               # `deep hub run` from packages/cli/dist
env -u CARGO_TARGET_DIR cargo build --locked -q -p deep-hook --target-dir target   # target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2764 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2764/tsconfig.json
```

About 5 s on a correct hub; a failing one waits up to 90 s for an ask. No network, no model, no `codex` binary. Each
test's folders are under `/tmp/dh2764-*`, with `HOME` set to `<tmp>/h` for every process it starts; every process is
stopped by its PID (`helpers.ts`, `cleanup`, `stopHub`), never by name or port. Each test starts its own hub, so the
folder runs one file at a time.

On a loaded machine deep-hook can give up on the hub's acknowledgement (its 50 ms) and spool the hook. A delete let
through that way (`tool.before` marked `late`), or the proceed's stop let go unheld that way (its stderr says deep-hook
spooled it), is INCONCLUSIVE, a skip, never a pass or a fail.

## Waits

Every wait is for an event. The hub's record is followed on one more cli connection, `stream.subscribe` from log_pos 0:
each frame wakes the test, which then reads `events.read` again for the row it waits on (the proceed's
`question.proceeded`, the subagent's `user.ask`, a call's `tool.before`, the ask naming the delete). A wait on a
deep-hook run also wakes when that run ends; processes are waited on by their exit. Timers only bound these waits, each
marked `// deadline:`, so a hang fails instead of hanging: the hub's start (120 s), a socket call's reply (30 s), the
proceed and the subagent's prompt reaching the record (30 s each), a call's `tool.before` (10 s), the ask holding the
delete (90 s), the hub's stop (30 s) and the processes' exit at cleanup (3 s); the stand-in agent kills a deep-hook run
past its timeout (150 s).


- **deep-hook** (`target/debug/deep-hook`), run as Codex runs our hook entry, `deep-hook codex <event>` with the
  payload on stdin, as a child of one long-lived stand-in process per session (`fixtures/agent.mjs`, copied from
  #1836's). Payloads carry `session_id`, `turn_id`, `transcript_path`, `cwd`, `hook_event_name`, `model` and
  `permission_mode` as the Codex corpus has them; the rollout opens with its `session_meta` naming the newest Codex
  version `adapters/codex.facts.json` covers.
- **`deep hub run`** with `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_SORTER` (#321's planted sorter: a file naming its rule
  and the questions it answers "proceed") and `DEEP_HUB_PLANT`.
- **The socket**, as the cli role with the control token: `events.read`. The test reads `question.proceeded`,
  `user.ask` (its `text` and `from`), `tool.before` (its `late`) and `ask.created` (its `kind` and `question`).
- **Files** under `HOME`: `~/.deepbuild/rules.json`, the shipped default guards exactly as shipped;
  `~/.deepbuild/config.json`, #321's ask settings.

## The session replayed

One Codex thread. You type "Fix the login bug in src/login.ts." (a `UserPromptSubmit` with no `agent_id`); the agent
adds `src/fix1.ts` with `apply_patch` (PreToolUse allowed, PostToolUse) and ends its turn on "want me to clean up the
old releases?" (Codex's `Stop`, its `last_assistant_message`), which the planted sorter answers "proceed": the record
holds `question.proceeded`, and the stop's reply is a block that says proceed. In the turn that proceed starts (the same
`turn_id`, as a Stop block continues a Codex turn), a Codex subagent starts: its `SubagentStart` (`agent_id`,
`agent_type: worker`), then its own prompt, a `UserPromptSubmit` under the root's `session_id` with that `agent_id`,
`agent_type` and a `turn_id` of its own. The record must hold that prompt as the session's `user.ask` with
`from: 'subagent'`, or the test is BLOCKED. Then the root calls Bash `gh release delete v1.2.0 --yes`.

The criterion, as asserted:

1. The delete is not let through at PreToolUse, and within 90 s an ask raised after the subagent's prompt names
   `gh release delete v1.2.0 --yes`.
2. That ask is `kind: authority`, and its question names the proceed: it says "proceed" and quotes the proceed's
   question, "want me to clean up the old releases?".
3. "One authority ask": the agent calls the delete again before you answer; once deep-hook has the hub's reply to both
   calls, neither run has gone through, and exactly one ask names the delete. Waiting for both replies proves the hub
   has decided the second call, and raised whatever ask it raises for it, before the asks are counted, since the hub
   raises an ask before the deny that names it. It doesn't see an ask the hub would raise for the call only after
   replying to it; the first issue's 5 s wait saw such an ask only if it came within those 5 s.

## The delete call chosen, and why

`gh release delete v1.2.0 --yes`. deep-hook's matcher gives `effect:delete` to `gh repo delete`, `gh release delete`
and `gh issue delete` only (`crates/deep-hook/src/matcher.rs`, the `"delete"` arm; its tests name
`gh release -R acme/shop delete v1`), so a release delete is a delete on a remote service, the forge. The shipped
guard for it is `authority-delete` (watch mode), whose reason is the proceed hold itself: "in the turn a proceed starts
it is held with an authority ask". No default guard settles it first: the request defaults (#84, `namedDefaults` in
`holds.ts`) cover only push, PR and merge (`Named` in `named.ts`), and no block-mode entry matches it (the delete
guards in block mode are `effect:unknown-reach-delete` and `effect:unrestorable-delete`, which read local deletes:
`rm`, `find`, `git clean` and the like). So, unlike #1836's merge, the home keeps every default guard as shipped, and
`heldEffect`'s proceed hold is all that stands between the proceed's turn and the delete. A release is chosen over a
repository so the call reads as ordinary cleanup work in the proceed's turn.

## The plant (a new surface the work must add)

Name: **`proceed-ends-at-subagent-prompt`**, a new `DEEP_HUB_PLANT` value in `Plant` and `PLANTS` in
`packages/hub/src/plant.ts`. The wrong program: the hub's proceed-turn query (`proceeding()` in `holds.ts`) counts a
Codex subagent's prompt (a `user.ask` with `from: 'subagent'`) as ending the turn, as the base does. So after the
subagent's prompt no proceed turn is found and the delete runs with no ask. Nothing else changes.

The plant test runs the same session on a hub started with `DEEP_HUB_PLANT=proceed-ends-at-subagent-prompt`. It passes
only when the main test's checks fail there, with a failure message naming `gh release delete v1.2.0 --yes`. A hub
that refuses the name (the base) is BLOCKED, so the plant test fails.

## How the issue was read

- **"Holds the call with one authority ask naming the proceed"** is the ask `heldEffect` raises for a proceed's turn.
  At the base its question reads ``Run `<call>`? It deletes, in the turn a "proceed" started for "<question>" (rule
  <rule>); ...``. The test reads only that the question says "proceed" and holds the proceed's question, not the rest
  of the wording.
- **"A Codex subagent's prompt"** is the `UserPromptSubmit` Codex sends under the root's `session_id` with an
  `agent_id` (the issue, and `childPrompt` in `hub-shared.ts`). Its `SubagentStart` is sent before it, as Codex starts a
  subagent; the subagent's own tool calls and its `SubagentStop` are not: the criterion names the prompt, and a Codex
  subagent runs beside the root, so the root's delete can come while the subagent still works. (A child's stop is
  #1836's, and the base already leaves it out of the proceed's turn.)
- **The issue's "dispatch, send or delete"**: the criterion names a call that deletes on a remote service, so only the
  delete is encoded.
- **Proof "on the branch and the merge base"**: the base run is recorded here. The branch run is the implementer's.

## What the base does

Both tests fail; `BASE-FAILURE.txt` has the run.

- Main test: `gh release delete v1.2.0 --yes` is allowed at PreToolUse (exit 0, nothing held) after the Codex
  subagent's prompt, with no ask. This is the issue's bug.
- Plant test: BLOCKED, because `DEEP_HUB_PLANT=proceed-ends-at-subagent-prompt names no planted program`.

Checked at the base, with no product source changed:

| Program | Main test |
| --- | --- |
| The base, same session with the subagent's prompt left out (a scratch copy of the test outside this folder) | passes: the proceed's ask holds the delete, and a retry raises no second ask |
| The base, with the ignored `packages/hub/dist/holds.js` query also skipping a Codex `user.ask` whose `from` is `subagent` (a stand-in for the fix, restored after) | passes |
| The base as it is (it behaves like the plant) | fails, naming `gh release delete v1.2.0 --yes` |

## Not covered

- Push, merge, dispatch and send after a Codex subagent's prompt: the criterion names a delete.
- A Codex subagent's own tool calls (under its `agent_id`) and its `SubagentStop` inside the proceed's turn.
- A Claude Code session: the issue names Codex's subagent prompt.
- Your answer to the held delete, and its deadline: #321's suite covers those for a proceed's hold.
