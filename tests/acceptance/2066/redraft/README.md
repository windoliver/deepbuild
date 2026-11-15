# Acceptance tests for #2066 (blind redraft): a `rule:` line in a prompt nobody typed is saved as your own rule

I wrote this redraft blind, from scratch, in one pass. I did not run it. Inputs: `../issue.json` (issue #2066), `AGENTS.md`, `docs/technical-design.md` (the record, The learned layer, Threats, Dogfooding) and base `bfe8c8a5`. At that base I read these public surfaces and test infrastructure: `packages/hub/test/hub.ts`, `packages/hub/test/memory.test.ts`, `tests/acceptance/303/helpers.ts` (Claude Code transcript shapes), `adapters/claude-code.facts.json` (the UserPromptSubmit origin mapping) and `adapters/index.mjs` (how the mapping is read). I also read the base hub source, only to learn what each surface returns and when a reply is complete. I did not read any earlier draft, implementation, diff, failure output, transcript or dispute. The implementing agent does not edit this file (AGENTS.md, Proof).

## How it runs

```sh
npm run build --workspaces      # the hub runs from packages/cli/dist/main.js
npx vitest run tests/acceptance/2066/redraft/recorded-origin.test.ts
```

- Each test starts a real `deep hub run` through `withHub`. That gives a temp HOME under `/tmp/hub-315-*`, and the real HOME is never read.
- Each test starts one stand-in agent process (`node -e setInterval`). Every session's hooks name it as their parent, so the hub verifies them. The test stops it by PID.
- Every write goes through the hub's hook socket (`hookLine` and `reply`): SessionStart, then UserPromptSubmit. Before each prompt, the test appends that prompt's transcript entry to the session's Claude Code transcript under the temp HOME.
- The record is read read-only from `ledger.db`. `rules.json` is read as a file.
- The test calls no private core method and mocks nothing the repo owns. It reaches no network and calls no model.
- Every prompt is a question or a rule line, so none opens a task, and no drafting job starts.

**Barriers before absence claims.** A hook's `reply` resolves only after the hub has built the prompt's whole reply. In that reply path the hub saves the typed rule (`promptRules`), saves the rejection and syncs its guard. Each absence claim is also paired with a person-origin control in the same hub, which must show up first: its `learn.applied`, the observer session hearing its rule, and its decision plus `word:` guard entry. Before any origin is asserted, the test polls until the prompt's `user.ask` event is in the record.

**Origins.** The test produces each origin with the transcript fields the facts map:

| Origin | Transcript fields used |
|---|---|
| person | `turnOrigin: human` |
| scheduled | `turnOrigin: scheduled` |
| session | `turnOrigin: peer`, `hostInjected` |
| subagent | `origin.handback: true` |
| continuation | prompt text starting with "The app was quit while you were working." |
| unknown | an entry that matches no rule |
| no recorded origin | a UserPromptSubmit with no `prompt_id`, so no entry is joined |

Every prompt's recorded `user.ask.from` is asserted explicitly.

## Criteria to tests

The blind job cited AC1–AC4 without hashes. After the owner approved adoption in PR #2519, the implementing job added the four tags computed from the issue's complete checkbox sentences: `#2066.be686212`, `#2066.0f5e890b`, `#2066.6caf3df8`, and `#2066.99a5e19f`. Only test-name metadata changed; all assertions and expected values remain this blind draft's.

| Requirement | Test | What a wrong hub shows |
|---|---|---|
| AC1: a `scheduled` prompt with a `rule:` line appends no `learn.applied`, and a second open session's next prompt carries no such rule | test 1, origin `scheduled` | the message names the origin and the target(s) appended; the observer's reply carries the line |
| AC2: the same text from `session`, `subagent`, `continuation` or `unknown` saves nothing | test 1, the loop over `NON_PERSON` | a hub that leaves out only `<task-notification>` prompts saves each one; the message names the origin and its target(s) |
| AC3: the same line typed by you is saved once, and reaches a second open session at its next prompt | test 1 control (`CONTROL`, observer); test 2 (the scheduled line typed twice: one target; heard by `typedNext`) | 0 or 2 targets; the rule is not heard |
| AC4: `rejected:` in a scheduled prompt saves no decision and writes no guard entry; typed by you, it saves both | test 1 (`leftpad` scheduled, against the `rightpad` person control); test 2 (`leftpad` typed: a decision and a `word:leftpad` entry) | the scheduled prompt's decision or `rejected-*` entry is listed |
| Scope: the origin is the prompt's own recorded event, not the session's latest state | each non-person prompt follows a person prompt in the same session (test 1); the person prompt follows a scheduled one (test 2) | a hub that reads the session's last origin fails one way or the other |
| Scope: no recorded origin saves nothing | test 1 `loose` session | a target for "unplaced" |
| Scope: the session's record says once that a rule line was not saved, naming the origin | test 1: two identical non-person prompts per session must leave exactly one such `session.reading` | 0 readings (the base), or 2 (repeated) |
| Scope: nothing else about #344 changes, here meaning that your existing rules still reach a session at an automatic prompt | test 2 `autoNext`: its next prompt is scheduled and still carries your rule | a fix that drops rule delivery at non-person prompts |

All facts are checked with `expect.soft`, so a failure the base is expected to have does not hide the others.

## Readings and disclosures

- **The record's words for the once-only refusal are not given by the issue.** I read it as a `session.reading` on that session, appended after the rule-line prompt, that mentions "rule", names the origin as a whole word, and says it was not saved (not / nothing / never / no / n't). An implementation that writes the refusal some other way, for example as another event kind, fails this assertion. That would be a redraft request, not an edit.
- **No recorded origin.** I read this as a Claude Code prompt that joins no transcript entry. The test asserts only that it is not recorded as `person` and that it saves nothing. The base records it as `unknown`. A prompt whose `user.ask` never lands in the record could not be produced through public hooks without a fault seam, so it is not covered.
- **Not covered:** Codex subagent prompts and `<task-notification>` prompts. Both are already excluded at the base, so they add no regression coverage for this issue.
- **The Proof's "each origin saving on the merge base".** I expect the base to fail test 1's AC1/AC2/AC4 assertions and its refusal-reading assertions, and to pass test 2 and the controls. This was **not run**, so it is not confirmed.
- **Timing.** At the base, the 15 s positive barrier on refusal readings is waited out once per origin. That is why each test has a 180 s timeout.

## Files

- `recorded-origin.test.ts`: the two tests.
- `README.md`: this file.
