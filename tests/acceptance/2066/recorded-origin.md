# #2066 acceptance: a rule line is saved only from a prompt a person typed

Drafted blind from `issue.json`, `AGENTS.md`, the design (The learned layer; Threats; Dogfooding) and BASE `bfe8c8a5`
test infrastructure only. No production code was read; nothing has been run yet.

Run: `npx vitest run tests/acceptance/2066/recorded-origin.test.ts` (it needs the built CLI, `packages/cli/dist/main.js`, as `packages/hub/test/hub.ts` does).

## What it drives

The real CLI hub (`withHub`) on a temp home. Every write goes through hook requests over the hub socket (`hookLine` + `reply`,
which waits for the hub's completed response rather than its acknowledgement). Each session has its own live process (its
`ppid`) and a Claude Code transcript under the temp home holding fixture text only. Each prompt's transcript entry carries
the fields that `adapters/claude-code.facts.json` maps to an origin (`turnOrigin` human/scheduled/peer, `origin.handback`,
the quit-app prompt, and none of these for unknown), joined by `prompt_id` ↔ `promptId`. The record is read from
`ledger.db` with `node:sqlite` read-only, and guards from the real `rules.json`. Processes the test started are stopped by
PID and awaited before the home is removed.

## Criteria → tests

| Criterion | Test |
|---|---|
| 1. scheduled: no `learn.applied`, second open session gets no rule; failure names the target | `it.each` row `scheduled` |
| 2. session, subagent, continuation, unknown save nothing; failure names the origin | `it.each` rows (the test title and message name the origin) |
| 3. typed twin saved once, reaches a second open session at its next prompt | every `it.each` row, plus the no-origin test |
| 4. `rejected:` in a scheduled prompt: no decision, no guard; typed: both | `rejected:` test |
| Scope: once-only note naming the origin | `it.each` sends two rule lines of that origin and expects exactly one note |
| Scope: origin read from the prompt's own event; none recorded → nothing | prompt-specific test (a later entry of the other origin is written before the hook); no-origin test (no transcript entry; no `prompt_id`) |
| Scope: #344 unchanged | a rule you typed still reaches a second session's scheduled prompt |

The typed twin is sent last in the same session and waited for; since the hub completes each reply before the next is
sent, a missing save on an automatic prompt can't be load. A non-person failure lists the actual `learn.applied`
target(s) first (`expect.soft`, so the other checks stay visible).

## Assumptions and limits (disclose on dispute)

- `learn.applied` events are matched by a unique token in their stored text; the target is read from any `target` field.
- Decisions are found as event kinds `decision%` naming the rejected word; the guard as `word:<x>` in `rules.json`, as
  `packages/hub/test/memory.test.ts` shows for #111.
- The "not saved" note is any session event other than the prompt (`user.ask`) whose text says not saved and names the
  origin. Its exact kind and wording aren't in the issue, so this match is loose.
- A continuation prompt is the quit-app line followed by the rule line. If the facts' `prompt` rule needs an exact match,
  that prompt reads as `unknown`. It still must save nothing, but the note naming `continuation` would fail. That is a
  fixture limit, not a reason to weaken the test.
- `ulid` is imported from `packages/hub/src/wire.js`, as the hub's own tests do; it only makes request IDs.
- A real two-prompt race (a scheduled and a typed hook in flight at the same moment) can't be ordered exactly through
  public hooks. The prompt-specific test gets close: it writes a later entry of the other origin before the earlier
  prompt's hook arrives.
- A missing `UserPromptSubmit` origin event can only be produced as "no transcript entry" or "no `prompt_id`". No public
  hook writes a prompt event with its origin removed.
