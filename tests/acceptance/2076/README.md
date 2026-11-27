# Acceptance tests for #2076: a rule line an agent deletes stays held, even when its proposal can't be raised

Written first, blind, by a job that never saw an implementation of #2076 (none exists at the base). It read:

- issue #2076: its Scope, 3 checkbox criteria, Proof and Depends on (#344, #111)
- `docs/technical-design.md`: "Threats, and what stops each one" (the row "Agents switching off what watches them": an agent's edit that removes a rule line leaves the rule in force and becomes a proposal to you), and the Dogfooding bullet
- `AGENTS.md`
- the suites of #344 (`tests/acceptance/344/`, above all `proposal.test.ts`, AC4), #111 (`revive.test.ts`, AC2: a revival refused, citing the decision), #303 (world, hub, sessions through deep-hook), #26 (the agent stand-in and its `deep mcp`) and #2066 (only a person's prompt saves a rejection)
- base code through public entries only: `packages/hub/src/session-memory.ts` (`ruleHook`, `holdRemoved`, `startSet`), `rules.ts` (a held rule's `held` field on the page), `mcp-operations.ts` (`propose`), `memory.ts` (`captureRejected`, `revives`), `plant.ts` (`DEEP_HUB_PLANT` names)
- the base commit `2eaaeb0e6`

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

```sh
npm ci; npm run build --workspaces
cargo build --locked -q -p deep-hook                     # the sessions' hooks are target/debug/deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2076 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2076/tsconfig.json
```

Every test starts a real hub, so the folder is on the unit lane's one-at-a-time list in `scripts/lanes.mjs`, beside 344's. Folders are #303's temp folders, HOME is a temp folder for every child, no network and no model call, and processes are stopped by PID only (#303's and #26's `cleanup`). `helpers.ts` imports #344's world, hub, `Session`, `deep rules sync` and page reader, and #111's `startAgent`, `inboxText` and `callTool`; nothing is copied.

## The fixture (the issue's)

#344's fixture repo with only a root `AGENTS.md`: `never use moment` and `Run the linter before every commit`. Where a criterion needs it, you type `We keep our own date helpers. rejected: \`moment\`. Sound good?` in a Claude Code session (a person's prompt, #2066), which #111 saves as one `decision.created` whose answer is ``rejected: `moment` `` for the repo.

## Surfaces the issue names, used as they are

The hooks of a Claude Code session through deep-hook (SessionStart and its reply, the start set; UserPromptSubmit; the Edit's PreToolUse and PostToolUse), `deep rules sync` and the rules page `<home>/.deepbuild/wiki/rules.md` (#344's invented surfaces 1, 2 and 12, now on main; a held rule's line carries `held`, its proposal's handle `doc:<id>`), the record's `learn.proposed` and `ask.created`, `deep inbox`, `session.reading`, `deep_propose` from #26's agent stand-in with the refusal #111 gives (a tool error whose value cites `decision:<id>`, no ask), and ``rejected: `moment`.`` saved as #111 has it.

## Surfaces this job invented (the implementer builds to these; a reasonable other reading is a redraft request)

The base names no planted fault for criterion 2 (`grep "plant ===" packages/hub/src` finds none for a raise), so:

1. **`DEEP_HUB_PLANT=hold-raise-fails`**: the hub's raise of the proposal for a held rule line throws an error whose message holds `hold-raise-fails`; nothing else changes. At the base the hub refuses to start with a plant it doesn't list, so `hubFor` (helpers.ts) fails at an assertion naming the plant, never at an import or a BLOCKED error.
2. **The failure's reading** is one `session.reading` of the editing session (the session whose Edit removed the line) whose `reading` holds the rule's text word for word and the error's message.
3. **Raised again at the next rules sync** (Scope) is read as: a hub started again without the plant, then `deep rules sync`, records the held line's one proposal and one ask.

## Criteria to tests

| ID | Criterion (short) | Test | The wrong program, and how it fails |
|---|---|---|---|
| AC1 `#2076.c016c716` | with ``rejected: `moment`.`` saved, an agent's Edit deleting `never use moment` leaves it held on the rules page and in the next start set, one proposal in the inbox naming the line | `held.test.ts` | **the base**: `holdRemoved` holds a line only if `propose` returned, and `propose` refuses a change naming `moment`, so the page shows no rule and no proposal: fails at "`never use moment` stays on the rules page, held", naming the rule. Also: a held rule without its proposal (`held` missing), two proposals (at the edit and the sync), a proposal that never reaches `deep inbox`, a start set without the held rule |
| AC2 `#2076.ed415a3c` | with the ask's raise planted to fail, the line is still held, the session's record names the failure | `raise-fails.test.ts` | the base (no plant: fails at the hub start naming `hold-raise-fails`); a hub that holds only after a raise works (no rule on the page); one that swallows the error (no reading) or says it at every sync (two readings); Scope: one that never raises it again (no proposal after the next sync) |
| AC3 `#2076.8efd8683` | the twin: an agent's own `deep_propose` naming a rejected direction is still refused | `twin.test.ts` | **passes on the base**. Fails a fix that drops the revival check from `propose` for every caller (the agent's proposal goes through, no `decision:` cited, `zircon` in the inbox); its control (`dayjs` reaches the inbox) fails a hub that refuses every proposal |
| Proof | the deleted line gone from the page on the merge base, held with its proposal after the change | `BASE-FAILURE.txt` (AC1's failure at the base); the after run is the implementer's | |

## Not covered, and why

- **A planted twin for AC3** (`twins/`, as #2066 has): the wrong program is named above; planting a copy of `mcp-operations.ts` without the check is the implementer's or the proof job's, since this job writes no product code.
- **Which writer records the hub's own proposal.** The Scope says it is the hub's own; the tests assert only what you see (one proposal, applied by no one, targeting the rule, one ask), not its connection.
- **An agent's Write that drops the line, or a rule file other than the root `AGENTS.md`.** #344's tests cover the paths; this issue's criteria name the Edit and `AGENTS.md`.
- **No criterion test has passed on a fixed program.** The first implementer to find one unpassable for a reason the base can't show reports it as a redraft request and doesn't edit the tests.

## Files

`helpers.ts`, `held.test.ts` (AC1), `raise-fails.test.ts` (AC2 and the Scope's re-raise), `twin.test.ts` (AC3), `tsconfig.json`, `BASE-FAILURE.txt`.
