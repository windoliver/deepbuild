# Blind redraft of #39 AC16, the SubagentStop half

Written blind: from the criterion, docs/technical-design.md and the hub's public surfaces, without reading tests/acceptance/39's tests. It uses tests/acceptance/39/helpers.ts, the suite's approved tooling. The Interrupt half of AC16 stays with the original test.

## Criterion

AC16, #39.3f1db111: "A turn you interrupt records an Interrupt event and reads as interrupted, never as a stop or a claim, and a subagent's SubagentStop never holds or judges the parent's stop."

## Surface

The real hub process and `deep setup` in a temporary home, and `deep-hook codex <event>` run as Codex runs a hook entry. One Codex thread starts a turn, then a subagent's SubagentStart, PreToolUse and SubagentStop arrive with the root session's ID and the child's `agent_id` and `agent_type`, as Codex's published hook schemas name them (tests/acceptance/39/fixtures/schemas). The test then reads the hub's events over `events.read`.

It asserts:

- SubagentStop's hook exits 0, replies in under 10 s and carries no `decision`: the child's stop is never held or sent back.
- Exactly one `agent.stop` is recorded under the root session, and its `data.child` is the child's `agent_id`. Per agent.stop@5, a stop that names a child is no turn end of the session.
- No `claim.made` for the session: the child's stop is never judged.
- Still one `session.start`: the subagent is no new session.

## Assumed

- The design's Codex row: a subagent's hooks carry the root session's ID with an `agent_id`, and its stop fires SubagentStop.
- packages/contracts/schemas/agent.stop@5.json's `child` field marks a child's stop.
- "Never holds" is read as a reply well under the stop hold, 10 s here.

## Run

`npx vitest run tests/acceptance/39-redraft-ac16` after building (dist and target/debug/deep-hook). Type-check: `npx tsc --noEmit -p tests/acceptance/39-redraft-ac16/tsconfig.json`.

## Twin

twins.json maps #39.3f1db111 to `stop-not-the-childs`: packages/hub/src/hookmap.ts with one change, a Codex SubagentStop's agent.stop data without `child`, so the stop reads as the session's own. TWIN-FAILURE.txt holds its failing assertion.
