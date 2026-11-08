# Acceptance tests for #344: the rules page, and rules that reach every agent's sessions

Written first, blind, by a job that never saw an implementation of #344 (none exists at the base). It read:

- issue #344: Scope, its 16 checkbox criteria, Proof, Overlaps and Depends on (#355, #356, #348, #349, #350, #84 for boundaries only; #304, #111, #112, #352 and #1511 as the issue names them)
- `docs/technical-design.md`: the "Your written rules, enforced" bullet, the `wiki` row of the first-party extensions (the rules page names a guard only while its planted call is denied and its twin allowed in the last install check), The learned layer (the start slice), the Telling the agent notes on notices, and the hook protocol
- `AGENTS.md`
- the suites of #303 (world, hub, sessions through deep-hook), #304 (`deep guard add`, planted calls and twins), #355 (pages, `withRecord`, `seedSession`), #62 (learned changes and rollback), #111 (`deep memory`), #112 (the eval's comparison) and #1174 (the taste-call convention)
- base code through public entries only: `packages/record` (`startSlice`, `rollBack`, `openRecord`), `packages/hub/src/guards.ts` (`addGuards`, `installs-unchecked`), `wiki-build.ts` and `memory.ts` (what the base compiles and lists), `crates/deep-hook/default-rules.json`
- the base commit `ed83819d`

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## Redraft

- **2026-11-07, surface 5's kind name.** The first draft named the event `rules.delivered`, which can't be published: the contracts drift check (`catalogueDrift` in `packages/contracts/src/catalogue.ts`, tested in `packages/contracts/test/events.test.ts` "the drift check") reads every backticked dotted name whose first segment is a catalogued family as an event kind, so a new `rules` family turns each `rules.json` in the docs and in that test into an uncatalogued kind, and the existing test fails. The event is now `session.rules_delivered`, in the existing `session` family, whose first segment the docs don't use for a file. Its data, core writer and subject `session:<id>` are unchanged, and so is every assertion's meaning; only the name changed in `helpers.ts` (`deliveries`), surface 5 below, the messages and comments of `deliver.test.ts` and `sets.test.ts`, and the prose of `BASE-FAILURE.txt`.

## How to run

```sh
fnm exec --using=24 npm ci                              # once, if node_modules is missing
fnm exec --using=24 npm run build --workspaces          # twice after a fresh install; the hub and the CLI run from packages/*/dist
cargo build --locked -q -p deep-hook                    # the sessions' hooks are target/debug/deep-hook
fnm exec --using=24 node node_modules/vitest/vitest.mjs run --root tests/acceptance/344 --no-file-parallelism
fnm exec --using=24 node node_modules/typescript/bin/tsc -p tests/acceptance/344/tsconfig.json
```

Every test starts a real hub, so the folder goes on the unit lane's one-at-a-time list in `scripts/lanes.mjs` (the implementer adds it; not done here). Folders are `/tmp/dh303-*` (#303's `tempDir`), HOME is a temp folder for every child, no network and no model call, and processes are stopped by PID only (#303's `cleanup`). `helpers.ts` imports #303's world, hub, `Session` (a Claude Code session fired through the real deep-hook), #62's `learnEvent`, and #355's `withRecord` and `seedSession`; nothing is copied.

## The fixture (the issue's)

A git repo (#303's world, committed on main) with a root `AGENTS.md` (`never push without asking`, `Run the linter before every commit`), `packages/app/AGENTS.md` (`Keep React components under 200 lines`), `.github/copilot-instructions.md` (`Prefer named exports over default exports`) and `.github/instructions/render.instructions.md` whose `applyTo` is `packages/dev/**/*.ts` (`Never allocate inside the render loop`). Worlds add `~/.codex/AGENTS.md` (`never force-push`, `Always run npm test before opening a PR`) or `.github/instructions/legacy.instructions.md` (`applyTo: "legacy/**"`) where a criterion needs one. Files `packages/dev/src/{a,b}.ts`, `packages/dev/render/r.ts`, `packages/app/src/x.ts`, `web/app.ts`, `legacy/old.ts` exist so a session can read or edit them.

## Surfaces the issue names, used as they are

The hooks of a Claude Code session through deep-hook (SessionStart with its `source`, UserPromptSubmit, PreToolUse, PostToolUse; the reply on stdout is what the agent is told), `deep guard add` and the `installs-unchecked` plant (#304), `deep memory --json`, `keep` and `remove` (#111), `deep inbox`, `events.read`, the record's `learn.proposed`, `learn.applied` and `record.rollBack` (#62), the guard `push-needs-ask` in `default-rules.json` (what stops an unasked push in AC4).

## Surfaces this job invented (the implementer builds to these; a reasonable other reading is a redraft request)

All are loaded lazily, by running the CLI or reading the log, so the suite loads at the base. A test that fails because one is missing fails at an assertion naming it, never at an import.

1. **`deep rules sync`**: reads every rule file of every repo the record has a session in (`AGENTS.md` and `CLAUDE.md` at the root and below it, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.cursor/rules/*.mdc`) and the user-level files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`), and rewrites `<home>/.deepbuild/wiki/rules.md`. Exit 0. Why: the page has to be built at some moment a test can name; `deep setup` and the hub's session start may also build it.
2. **The rules page's lines** are #355's claim lines, `- <text> <!-- deep:claim {...} -->`, one per rule (a bullet of a rule file; a rule typed in a session is a claim with `known: "you"`). The JSON holds #355's `id`, `known`, `proof`, `sources` and four more fields: `file` (the rule file, repo-relative, or `~/.codex/AGENTS.md`), `scope` (`"all"` for a root file, Copilot's `copilot-instructions.md` and a user-level file; the folder glob `packages/app/**` for a nested `AGENTS.md`; the `applyTo` or `globs` value verbatim), `enforcer` (`{"kind": "check" | "guard" | "requirement" | "text", "name"?}`) and `tokens` (a positive integer). Each rule file also has a line `- <file> <!-- deep:rule-file {"file", "tokens"} -->` with its total. A rule's handle is `wiki:rules#<id>`.
3. **A guard names the rule it enforces** by `proofs.<name>.rule`, the rule's line word for word, beside `planted` and `twin` (the shape of #304's `proofs` object; `guard@1` takes no extra field). The page names the guard as the enforcer only while a check run now (or the last install check) denies its planted call and allows its twin; otherwise `{"kind":"text"}`. A guard that was never checked is not an enforcer (invariant 2).
4. **A rule you type** is a prompt `rule: <text>.` (as `remember: <fact>.` is, #356). The hub saves it at once as yours, and delivers it at every other open session's next UserPromptSubmit, and at the typing session's next prompt after a compaction or a resume.
5. **The event `session.rules_delivered`** (core writer, subject `session:<id>`): `data` is `{ "via": "start" | "prompt" | "notice", "pos": <log position the delivered rules and start slice were read at>, "rules": [<claim handles>] }`. One per delivery: the start slice, a prompt that carries a new set (a typed rule, a compaction, a resume), and each scoped notice (via #352's route; its `rules` is the one rule).
6. **A scoped notice** rides the PreToolUse reply of the first call whose resolved paths fall inside a rule's scope, and again at the first such call after a `SessionStart` of source `compact` or `resume`. The notice holds the rule's text.
7. **`deep rules reach --repo <dir> --scope <glob> --json`** prints `{ "sessions": [{ "handle": "session:<id>", "tool_calls": <n> }, ...], "tool_calls": <n> }`: the sessions of that repo with a tool call whose path is inside the scope in the last 30 days of the record, newest first. It reads the record alone: no event, no job.
8. **`deep rules credit <claim handle> --json`** prints `{ "sessions": ["session:<id>", ...] }`: the sessions a judgment of that rule credits, those whose record names its delivery.
9. **`deep session rules <session id> --json`** prints `{ "runs": "earlier" | "current", "set": <pos>, "credited_to": <pos> }`: the log position of the set the session was given, whether a newer set is in force since, and the set a regression in it is credited to.
10. **A removal lesson** (#111's list) carries `why`, a string naming the guard, or the count of sessions (0) and the 60 days. Its kind is `removal`. `deep memory keep <id>` declines it; `deep memory remove <id>` runs the configuration eval first.
11. **`DEEP_HUB_TEST_EVAL=<file>`** (the hub's seam for the eval's boundary, the agents and the judge, which this repo doesn't own): the file holds `{ "outcome": "adopt" | "regresses", "broke": [<task names>] }` and is read at each removal in place of a replay. A `regresses` outcome leaves the file as it was and the command's output names the `broke` tasks.
12. **The proposal for a deleted rule line** is a `learn.proposed` whose `target` is the rule's handle `wiki:rules#<id>` and `applied_by` is null, with one ask in the inbox naming the line. An agent's Edit or Write is told apart from yours by its PreToolUse and PostToolUse; a deletion seen by `deep rules sync` with no such call is yours.
13. **The taste call**: screenshots at `target/acceptance/344/rules-page.png` and `rules-page-text-only.png`, and the owner's call in `tests/acceptance/344/TASTE.json` (same shape as #1174's: `issue`, `criterion`, `verdict`, `who`, `when`, `screenshots` by name with their SHA-256).

## Criteria to tests

| ID | Criterion (short) | Test | The wrong program, and how it fails |
|---|---|---|---|
| AC1 `#344.d84014c1` | a rule typed in one session reaches a second open session at its next prompt | `deliver.test.ts` AC1 | a hub that delivers only at start; one that tells only the typing session; the second session's reply holds nothing, naming session B |
| AC2 `#344.4280c950` | the page shows what enforces each rule; text-only listed as such | `rules-page.test.ts` AC2 | a page with no enforcer; one that names no guard for `never force-push`; one that names a guard for the linter rule |
| AC3 `#344.a8ce0546` | a Codex rule reaches a Claude Code session; the page shows its enforcer | `rules-page.test.ts` AC3 | a reader that skips `~/.codex/AGENTS.md`; a start slice built from Claude files only |
| AC4 `#344.e5587b74` | a deleted "never push without asking" still can't push; one proposal | `proposal.test.ts` AC4 | an edit applied to the page; two proposals (at the edit and at the sync); no proposal; a push that goes through; your own edit treated as an agent's |
| AC5 `#344.edd0e73e` | after a compaction or a resume, the next prompt carries every typed rule | `deliver.test.ts` AC5 | a hub that loses the typed rules at the compaction, or carries only the newest |
| AC6 `#344.bc7c40dc` | a guard that fails its planted call reads text only | `rules-page.test.ts` AC6 | a page that names any guard found in rules.json, naming the rule `never rebase published branches` |
| AC7 `#344.91134104` | the four-file fixture: every rule with its file and scope | `rules-page.test.ts` AC7 | a reader that sees only root files misses three (nested, Copilot, applyTo) and fails, saying so |
| AC8 `#344.e8cceead` | a session started before a rollback runs the earlier set; the regression is credited to it | `sets.test.ts` AC8 | a page that shows the current set for every session; credit to the set after the rollback |
| AC9 `#344.d074b17a` | the scoped notice: web/app.ts never hears it; a third call hears it once, not at the fourth; once more after `/compact` (and a resume); the nested AGENTS.md too | `deliver.test.ts` AC9 | a rule in every start slice; one repeated at every matching call; one lost at the compaction, naming the session |
| AC10 `#344.ba9f0acc` | rescoping `packages/dev/**` to `packages/dev/render/**`: 12 vs 3 of 40 sessions, by handle, before save | `reach.test.ts` AC10 | a preview that counts every session shows 40 and fails, naming the count; one that appends or starts a job |
| AC11 `#344.0a0ed1fb` | judging a scoped rule credits only sessions whose record names its delivery | `sets.test.ts` AC11 | a judge that credits every session in the repo, naming a session the rule never reached |
| AC12 `#344.10e389aa` | screenshots, one taste call, recorded | `taste.test.ts` | **never PASS without the call**: no screenshots, no `TASTE.json`, or a call on other pictures is INCONCLUSIVE (the test fails with `INCONCLUSIVE: ...; this is not a pass`); "looks wrong" fails. No other test reads a picture |
| AC13 `#344.9052e54a` | `never force-push` with a passing guard lists a removal lesson naming it; a failing planted call gives none and text only | `lessons.test.ts` AC13 | a list with no `why` or another guard; a lesson for the failing guard; a typed rule offered; a lesson that raises an ask |
| AC14 `#344.8b8dd0f4` | `legacy/**` untouched in 60 days lists a lesson naming the count; a folder touched last week doesn't | `lessons.test.ts` AC14 | a window of all time (the 90-day-old session would hide the lesson); a lesson for the touched folder; no count |
| AC15 `#344.b9bc3486` | declining doesn't bring it back while the text is unchanged | `lessons.test.ts` AC15 | a list that raises it again after a sync, naming `never force-push` |
| AC16 `#344.0ee7b472` | a removal the eval reads as a regression leaves the file byte-identical and names the tasks | `lessons.test.ts` AC16 | a removal that goes ahead; output without `task-alpha` and `task-beta`; a control (an eval that adopts) that must remove only that line |
| Scope | each rule's size and each file's total in tokens | `rules-page.test.ts` "scope" | a page with no sizes, or a total below its rules' sum |
| Proof | each shown failing first, and the month's replay | the failing runs in `BASE-FAILURE.txt` (AC1, AC3, AC4); the replay is the implementer's (see below) | |

## Not covered, and why

- **A check or a requirement as the enforcer.** The base names no surface that lets a test make one a rule's enforcer; only the guard and text kinds are asserted. Every enforcer kind must be one of the four.
- **Skills synced from the Agents page held like a rule line.** It is in the Scope, not in a checkbox, and no base surface syncs skills.
- **Cursor `.mdc` `globs` and a `CLAUDE.md` below the root.** The Scope lists them; the criteria use `applyTo` and a nested `AGENTS.md`. The suite pins neither (a redraft request if wanted).
- **The Proof's replay of the month's rule reminders** against the rules page needs a real month's record; it's the implementer's to run, with each reminder's enforcer, in the PR.
- **The tokenizer.** Only that sizes are positive whole numbers, vary with the text, and that a file's total is at least its rules' sum; the pinned tokenizer's counts are not asserted.
- **Hub-down behavior** of the push rule (the shipped guard's) is #304's, not repeated here.
- **No criterion test has passed on any program.** Several rest on the invented surfaces above; the first implementer to find one unpassable for a reason the base can't show reports it as a redraft request and doesn't edit the tests.

## Files

`helpers.ts`, `rules-page.test.ts` (AC2, AC3, AC6, AC7, the sizes), `deliver.test.ts` (AC1, AC5, AC9), `proposal.test.ts` (AC4), `reach.test.ts` (AC10), `sets.test.ts` (AC8, AC11), `lessons.test.ts` (AC13 to AC16), `taste.test.ts` (AC12), `tsconfig.json`, `BASE-FAILURE.txt`.
