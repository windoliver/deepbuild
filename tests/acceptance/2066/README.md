# #2066 acceptance: a `rule:` line in a prompt nobody typed saves nothing

Drafted blind from ../issue.json, AGENTS.md and docs/technical-design.md (The learned layer, Threats, Dogfooding) at
base 1c4d1f0e. Real hub, real `deep-hook` binary, record read over the hub socket (`events.read`), all via
`tests/acceptance/303/helpers.ts` (makeWorld, startHub, Session). No fakes, no seams.

Run: `npx vitest run tests/acceptance/2066` (needs `packages/cli/dist` and `target/debug/deep-hook` built, as #303).

| Requirement | Test (origin.test.ts) |
|---|---|
| AC1: `scheduled` prompt with `rule:` appends no `learn.applied`; a second open session's next prompt has no such rule; failure names the rule's target | `AC1/AC2 … origin scheduled` |
| AC2: `session`, `subagent`, `continuation`, `unknown` save nothing; a hub excluding only `<task-notification>` fails naming the origin | `AC1/AC2 … origin session/subagent/continuation/unknown` (one test per origin; title and messages name it) |
| Scope: session record says **once** that the rule line was not saved, naming the origin | same tests: exactly one non-prompt event on that session naming the origin and a rule |
| Scope: origin read from the prompt's own recorded event; no recorded origin saves nothing | each test first asserts the `user.ask`'s `from` (BLOCKED otherwise); `unknown` sends a prompt with no transcript entry |
| AC3: typed twin saved once and reaches a second open session (#344) | `AC3 …` |
| AC4: `rejected:` in a scheduled prompt saves no `decision.created` and no `rules.json` guard entry; typed twin saves both | `AC4 …` |

## Gaps / assumptions
- The refusal reading's event kind and wording aren't named by the issue; the test accepts any session-scoped event
  (other than `user.ask`/`learn.applied`) whose data names the origin and mentions "rule", and requires exactly one.
- `continuation` is sent as a prompt starting with the app's resume words plus the rule line. If the adapter matches
  those words exactly, the prompt records `unknown` and the test stops as BLOCKED rather than proving the continuation
  case. That would be a test-driver limit, not a pass.
- "Nothing else about #344's typed rules changes" is covered only by AC3 here; #344's own suite stays the guard.
- Not run here (drafting job); base failure output not captured.
