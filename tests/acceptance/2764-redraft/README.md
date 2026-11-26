# Acceptance tests for #2764 (blind redraft): a Codex subagent's prompt ends no turn a proceed started

A blind job wrote these. It saw only the issue, the design sections the issue links and the base commit (`914bd5f29`),
and nothing of any work on #2764. The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to
another blind redraft (design: Dogfooding).

## What was read

- Issue #2764: its problem, Scope, its one acceptance criterion, Proof ("a replayed Codex session with a subagent,
  through the real hub, on the branch and the merge base") and Depends on (#321, #1836).
- `docs/technical-design.md`: "An ask, and your answer getting back", as the issue links it.
- At the base, to learn the surfaces: `packages/hub/src/holds.ts` (`proceeding()`, `heldEffect`, `gate`),
  `packages/hub/src/core.ts` (the user.ask a Codex subagent's prompt becomes, `from: 'subagent'`),
  `packages/hub/src/hub-shared.ts` (`childPrompt`), `packages/hub/src/stop-judging.ts` (its Codex-subagent exclusion),
  `packages/hub/src/stop-reply.ts` and `server.ts` (the planted sorter's proceed, Codex's stop hold),
  `packages/hub/src/plant.ts`, `crates/deep-hook/default-rules.json` (`authority-delete`, `effect:delete`),
  `crates/deep-hook/src/matcher.rs` and `matcher_tests.rs` (the `gh release … delete` class),
  `adapters/corpus/codex/0.166.0-alpha.5.1/{subagent,tools}`, and the suites `tests/acceptance/1836` (harness,
  plant convention), `321`, `84/sort` and `39` (Codex sessions through deep-hook).

## The criterion and its ID

`#2764.f88db370`: "In a turn a proceed started, a Codex subagent's prompt followed by a call that deletes on a remote
service holds the call with one authority ask naming the proceed. A planted query that counts a subagent's prompt lets
the call run and fails, naming the call"

Checked here, not just copied. The ID is computed the way `scripts/proof-change.mjs` `criterionId` does it: the
criterion line from the issue file, trimmed, white space collapsed, SHA-256, first 8 hex. Node gave `f88db370`. Every
test name carries `#2764.f88db370`.

## Run

```sh
npm ci                                                                   # once
npm run build --workspaces                                               # `deep hub run` from packages/cli/dist
env -u CARGO_TARGET_DIR cargo build --locked -q -p deep-hook --target-dir target   # target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2764-redraft --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2764-redraft/tsconfig.json
```

There's no network, no model and no `codex` binary. Each test makes its folders under `/tmp/dh2764-*` with `HOME` set to
`<tmp>/h` for every process it starts. It never touches the real `~/.deepbuild` or `~/.codex`. Every process is stopped
by its PID (1836's `cleanup` and `stopHub`), never by name or port. Each test starts its own hub, so the folder runs one
file at a time.

**Unrun.** This job didn't run the suite or the type-check: the checkout has no build and the machine was loaded. So
there is no `BASE-FAILURE.txt`, and nothing here has been seen to pass or fail yet. The first run at the base and on the
branch is still to come.

## The surface used

- **deep-hook** (`target/debug/deep-hook`), run as Codex runs DeepBuild's hook entry: `deep-hook codex <event>` with the
  payload on stdin. It runs as a child of one long-lived stand-in process per session, `tests/acceptance/1836/fixtures/agent.mjs`.
  Payloads and rollout lines follow the shape of the corpus at 0.166.0-alpha.5.1. The session's `cli_version` is the
  newest version `adapters/codex.facts.json` covers, so the session isn't watch-only.
- **`deep hub run`** with `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_SORTER` (#321's planted sorter: a file naming its
  rule and the questions it answers "proceed") and `DEEP_HUB_PLANT`. The hub comes from 1836's `startHub`.
- **The socket**, as the cli role with the control token, using `events.read`. The test reads `question.proceeded`,
  `user.ask` (its `from` and `text`), `tool.before` (its `late`) and `ask.created` (its `kind` and `question`).
- **Files** under `HOME`: `~/.deepbuild/rules.json` holds the shipped default guards, unchanged. `~/.deepbuild/config.json`
  holds #321's ask settings, with no batch, so every ask shows as soon as it's raised.

## The session replayed

1. Codex `SessionStart`, then you type "Tidy up the shop's releases: point src/release.ts at v2." (`UserPromptSubmit`).
2. The agent runs `apply_patch` on `src/release.ts`. It's allowed, and its `PostToolUse` follows, so the stop is held.
3. The agent's `Stop` ends on "want me to delete the stale v1 release?". The planted sorter answers it "proceed". The
   record must hold `question.proceeded` with the sorter's rule, and the stop's reply must block saying proceed.
   Otherwise the test is BLOCKED.
4. In the turn that proceed starts, the agent calls `spawn_agent` (allowed) and gets its result, and the child's
   `SubagentStart` arrives. Then the child's prompt arrives as `UserPromptSubmit`. It carries the root's `session_id`
   with the child's `agent_id`, `agent_type: default`, the child's `turn_id` and the child's rollout as
   `transcript_path`, as the corpus's `subagent` scenario has it. The record must hold it as the session's `user.ask`
   with `from: 'subagent'`, or the test is BLOCKED. No `SubagentStop` is sent, so the subagent is still running.
5. The root agent calls Bash `gh release -R acme/shop delete v1`. deep-hook classes this as `effect:delete`, a delete
   on a remote service (the shipped `authority-delete`, in watch mode).

## How the criterion is judged

`codex-subagent-prompt.test.ts` asserts with vitest's `expect`:

1. **The call isn't let through.** No run of `gh release -R acme/shop delete v1` is allowed at PreToolUse as decided
   by the hub.
2. **It's held.** Within 90 s, an ask raised after the subagent's prompt names the call.
3. **The ask is an authority ask naming the proceed.** It's `kind: authority`, its question says "proceed", and it
   quotes the proceed's question, "want me to delete the stale v1 release?". The test reads only those two things,
   not the rest of the wording.
4. **There's one authority ask.** The agent calls the delete again before you answer. Five seconds later neither run
   has gone through, and exactly one ask names the call.

deep-hook can let a run through because the hub's acknowledgement came late (`tool.before` marked `late`). The hub
never decided that call, so the result is INCONCLUSIVE (a skip), never a pass or a fail. The same goes for a hook
deep-hook couldn't hand over in its budget. A setup step that doesn't happen is a thrown `BLOCKED:`, so the test
fails. Nothing missing passes.

What the base should do, as read from the code and not run: `proceeding()` takes the subagent's `user.ask` as the
session's newest prompt, so it finds no proceed turn and the delete is allowed with no ask. Check 1 then fails in the
test file, with a message naming the call.

## The plant

This is a new surface the work must add. Its name is **`proceed-ends-at-child-prompt`**: a new `DEEP_HUB_PLANT` value
in `Plant` and `PLANTS` in `packages/hub/src/plant.ts`, named after 1836's `proceed-ends-at-child-stop`.

The wrong program is the proceed-turn query (`proceeding()` in `holds.ts`) counting a subagent's prompt as ending the
turn, as the base does. That prompt is a `user.ask` with `from: 'subagent'`, which a Codex subagent's
`UserPromptSubmit` becomes. Nothing else changes.

`plant.test.ts` replays the same session on a hub started with `DEEP_HUB_PLANT=proceed-ends-at-child-prompt`. It
passes only when that hub lets `gh release -R acme/shop delete v1` run at PreToolUse and the criterion's judgement
(`breaches` in `helpers.ts`, the same checks the main test asserts) fails, with its first failure naming the call.

A hub that refuses the name exits at start with "names no planted program", as the base does. 1836's `startHub` then
throws `BLOCKED`, so the plant test fails. It never passes.

## How the issue was read

- **"A Codex subagent's prompt followed by a call"**: the call comes straight after the child's prompt, while the
  subagent still runs. No `SubagentStop` comes in between. That stop is #1836's case, and the issue doesn't name it.
  Codex's `spawn_agent` runs the child without waiting, so this order is what a real session does.
- **"A call that deletes on a remote service"** is the shipped `authority-delete` reason, word for word, and
  `effect:delete` is its class. `gh release … delete` is one of the commands deep-hook's matcher gives that class. No
  named default settles a delete before the proceed's hold, so the shipped guards stay as they are.
- **"Naming the proceed"** is the base's proceed-turn ask: ``Run `<call>`? It deletes, in the turn a "proceed"
  started for "<question>" (rule …); …``.
- **Proof "on the branch and the merge base"**: both runs are still to come (Unrun, above).

## Not covered

- A Codex subagent's prompt followed by its own `SubagentStop` and then the call.
- Push, merge, dispatch and send after a subagent's prompt. The criterion names a delete.
- The subagent's own tool calls. The criterion names the root's call.
