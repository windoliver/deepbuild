# Acceptance tests for #18, mapping: what the adapter makes of each hook

Written first, blind, by a job that never saw an implementation of #18. On October 26, 2026 it read:

- issue #18 as of that day: Scope, its 24 checkbox criteria (AC1 to AC24 in the body's order), Proof, References,
  Depends on, "Added Oct 9" and Done when
- `docs/technical-design.md`: What each agent gives us, and the limits we design around; Hooks are evidence, not a
  state machine; Before each command; Socket roles and contract versions; One hub per user…; One event log, with
  tables built from it; An ask, and your answer getting back; What done means, fixed at the start (when a prompt
  opens an ask); A loop's turn end isn't a hand-back; How we know version 0 works
- #29's criteria on loops (for what the loop facts feed)
- the base commit `14561af` (origin/main): `packages/hub` (`hookmap.ts`, `server.ts`, `core.ts`, `wire.ts`'s
  `DEEP_HUB_PLANT`), `crates/deep-hook` as a hook command, `adapters/index.mjs` and `claude-code.facts.json`,
  `adapters/corpus/claude-code/2.1.304` (the `tools`, `loop`, `subagent`, `child-gates` and `stop-failure` sessions,
  and the `/loop` skill text in the loop transcript), `packages/record`'s projections, `scripts/agent-harness.mjs`
- the acceptance suites of #349, #315, #316, #47, #48 and #666, for their conventions
- Cursor's hooks docs (cursor.com/docs/agent/third-party-hooks and /docs/reference/third-party-hooks) and xAI's
  Grok Build hooks docs (docs.x.ai/build/features/hooks), for what those tools give a hook they run

This folder covers AC1, AC2, AC4, AC6, AC7, AC11, AC12, AC13, AC21, AC23 and AC24. Three sibling folders
(`session/`, `install/`, `kit/`) cover the others. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job.

## How to run

With the repo's Node (24.22.0) and Rust toolchain:

```sh
npm ci && npm run build --workspaces      # the tests run the built CLI, packages/cli/dist/main.js
npx vitest run --root tests/acceptance/18/mapping --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/18/mapping/tsconfig.json
DEEP_HARNESS_LIVE=1 npx vitest run --root tests/acceptance/18/mapping record.live.test.ts   # by hand, on your plan
```

- Each file builds deep-hook once (`cargo build --locked -q -p deep-hook`, target/debug) and starts its own
  `deep hub run` per test, with `HOME` a fresh folder under `/tmp/dh18m-*` (a Unix socket path must fit in 104
  bytes). Nothing touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. Every process a test starts is
  stopped by PID after its file; nothing is stopped by name or port. A child never inherits this process's agent
  markers (`CLAUDE*`, `CURSOR*`, `GROK*`, `AI_AGENT`), billing keys, `GIT_*` or `DEEP_*` settings.
- Long tests: AC21's quiet turns are read every 2 s for up to 120 s; AC11's npm test call takes 4 s and the test
  waits 8 s after it.
- `record.live.test.ts` starts a real Claude Code session through the agent test harness (#48). Without
  `DEEP_HARNESS_LIVE=1` it fails with BLOCKED in its message, as #48's and #666's live files do; nothing skips.

## The surface under test

Every test reaches the adapter the way Claude Code does: a hook payload on deep-hook's stdin, `deep-hook claude-code
<Event>` run with the environment Claude Code gives its hooks (`CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT=cli`,
`CLAUDE_PROJECT_DIR`), into `deep hub run`; and reads the record back through the hub's socket with the control
token: `events.read`, `sessions.read`, `inbox.read`. Payloads and transcript entries are shaped like the corpus's
recorded 2.1.304 sessions (`helpers.ts`, `Session`); each transcript sits where Claude Code keeps it,
`<home>/.claude/projects/<cwd with each non-alphanumeric character as ->/<session>.jsonl`.

The issue and the design leave the record's field names open. These are the smallest additions the tests read,
named after the design's own words:

| Event | Field | What it holds | Criteria |
|---|---|---|---|
| `tool.before`, `tool.after` | `call` | the call's `tool_use_id`, so a call's two events can be found | AC1, AC2, AC11 |
| `tool.after` | `outcome` | `ok` (PostToolUse) or `failed` (PostToolUseFailure), as the corpus's adapter events already say | AC1, AC2, AC11 |
| `tool.after`, failed | `exit_code` | the exit code a failed Bash call reports (`Exit code 1` in the payload's `error`), or null | AC11 |
| `tool.after`, failed | `signature`, `cause`, `owner` | the error signature (a string that is the same for the same failure in any session and names no session or call), its cause and its owner | AC2 |
| `agent.stop` | `outcome`, `cause` | `finished` or `failed`, and the cause from the closed set (#603), as the adapter already maps them | AC2, AC7, AC11 |
| `agent.stop`, blocked | `signature`, `owner` | a stop that is a block (a sign-in error) carries its error signature and its owner, `you` for a sign-in | AC2 |
| `agent.stop` | `loop` | `{ state: 'looping', due }`, `due` the next prompt's time in ms since the epoch or null while it waits on a background subagent's report; `{ state: 'none_left' }` for a loop turn that ended with nothing scheduled or running | AC24 |
| `tool.before`, mcp | `server`, `tool` | the server and the tool (`merge_pull_request`; the full `mcp__…` name is accepted too) | AC6, AC12 |
| `tool.before`, mcp | `counts`, `effect` | the count class (`read`, `change`, `send` or `destructive`) and the effect class (`push`, `merge`, `dispatch`, `send` or `delete`) where it has one | AC6, AC12 |
| `user.ask` | `from`, `tasks` | the prompt's origin; `tasks` names the ask the prompt opens, `[]` when it opens none | AC23, AC24, AC21 |
| `commit.*` | `sha` | a commit made in the session, under the session, its full 40-hex SHA (the `commits` projection's `sha, session_id, worktree`); the tests accept any kind starting `commit.` | AC1, AC13 |
| any event | `agent` (the event's) | the adapter's agent for the event: `claude-code` for Claude Code, never for Cursor or Grok | AC21, AC1 |
| `sessions.read` row | `worktree`; `attention` or `status` | the registry by session ID and worktree; the session's attention (or a `session.attention` event's `state`) | AC1, AC21 |

### Planted wrong programs

The criteria that name a wrong program get one each, selected with `DEEP_HUB_PLANT` as the hub's other plants are
(`packages/hub/src/wire.ts`'s `PLANTS`; only tests set it). Each wrong-program test runs the criterion's own
scenario against the plant and expects the criterion's own assertion to fail, naming what the criterion says.

| Plant | Criterion | What it does | The test fails on it naming |
|---|---|---|---|
| `adapter-decides` | AC4 | answers each PermissionRequest with a decision (`hookSpecificOutput.decision.behavior: allow`) | the hook, `PermissionRequest` |
| `unknown-tool-read` | AC6 | counts an MCP tool missing from the facts file as `read` | the tool, `mcp__github__frobnicate_widgets` |
| `unplaced-is-person` | AC23 | reads a prompt it can't place as `person` (and so opens an ask for it) | the prompt's text |
| `loop-from-origins` | AC24 | reads loop state from prompt origins alone: a stop is looping when its turn's prompt came with an automatic origin | the turn, `turn 3` |

`tests/acceptance/18/twins.json` (the issue folder's, shared with the sibling jobs) is outside this folder; if the
before lane is to run twin checkouts for these criteria, the implementer names them there.

## Readings

- **"A real session" (AC1).** Proven twice: the live file runs a real session through the harness; the fast test
  replays a session shaped like the corpus's recorded ones, in a real git repo, whose Bash call runs the real
  `git commit` between its hooks.
- **Commits made in a session (AC1, AC13).** A commit made in the session's worktree between two of its hooks is
  the session's, whatever ran `git commit`: the agent's Bash call (fast test) or a hook of yours after its Edit (the
  live test, since the harness's only editing scenario has no Bash). The record names it once, by full SHA.
- **No trailer (AC13).** The commit's message is exactly the agent's; `git log --format=%(trailers)` is empty;
  nothing reads like attribution; the PreToolUse reply left the command as written; and no git hook, hooks path,
  commit template or trailer setting is in the repo or the home. The commit must also be in the record, so the test
  watches a commit DeepBuild saw.
- **Signature, cause, owner (AC2).** The issue names them and no shape. The tests ask only that the signature is
  the same for the same failure in two sessions and differs for another failure, that cause and owner are named,
  and that a sign-in block's owner is `you` (the design: only you can act on it).
- **"With no transcript read" (AC11).** The rate-limited session's transcript doesn't exist, so the cause can only
  come from the StopFailure payload's `error`.
- **"Never recorded as an overrun" (AC11).** No event of the session names an overrun after the call ended at its
  PostToolUseFailure, 8 s on and through a later turn.
- **Watch-only (AC4).** The decision fields are exit 2 and, in Claude Code's hook output, `decision`, `continue:
  false`, `stopReason`, and `hookSpecificOutput`'s `permissionDecision`, `decision`, `updatedInput` and
  `updatedPermissions`. Context is not a decision. No guard entry is installed: guard replies are #316's and #304's.
- **Well-known `github` (AC6, AC12).** GitHub's official remote server (`https://api.githubcopilot.com/mcp/`) in your
  user-scope MCP config (`~/.claude.json` `mcpServers.github`). The facts file of well-known servers counts its
  `merge_pull_request` as effect `merge` and lists its `get_pull_request` as `read`; AC12's test checks the latter
  first, as the control that makes "even where the facts file lists a github tool as read" bite. A repo's
  `.mcp.json` server named `github` (approved for the repo in `~/.claude.json` `projects`) is unknown.
- **Opens an ask (AC23).** The design: a prompt counts as an ask only when a person typed it, and each such prompt
  opens a task. Read on the prompt's `user.ask`: `tasks` non-empty for the typed prompt, `[]` for the unplaced one.
  The unplaced prompt carries a `prompt_id` that no transcript entry carries, and no origin field the facts name.
- **Loop facts (AC24).** The corpus has a fixed-interval `/loop` (CronCreate) but no dynamic one. The fixture
  follows the `/loop` skill text the recorded transcript holds (ScheduleWakeup with `delaySeconds`, `reason`,
  `prompt`, `noop`), and gives each wake-up's prompt a transcript entry like the recorded cron fire's (`turnOrigin:
  scheduled`, `isMeta`, `promptSource: system`). The background subagent is the corpus's (`Agent` with
  `run_in_background`, a PostToolUse with `isAsync` and `async_launched`), its report a hand-back entry
  (`origin.handback`). The Stop payloads carry no `background_tasks` or `session_crons`: the issue reads loop facts
  from the session's own tool calls. The stop's time is its event's `ts`; "due 60 s after its stop" is held within 5 s.
- **Who is calling (AC21).** Each tool's hooks reach deep-hook as `deep-hook claude-code <Event>`, the command in
  Claude Code's settings. Cursor's input carries its base fields (`conversation_id`, `generation_id`,
  `cursor_version`, `workspace_roots`, `user_email`) beside Claude Code's, its transcript is under `~/.cursor`, and
  its hooks see `CURSOR_VERSION`, `CURSOR_PROJECT_DIR` and `CLAUDE_PROJECT_DIR`, not `CLAUDECODE`. Grok's input is
  Claude-shaped with its transcript under `~/.grok`, and its hooks see `GROK_HOOK_EVENT`, `GROK_HOOK_NAME`,
  `GROK_SESSION_ID` and `GROK_WORKSPACE_ROOT`. "Recorded" means at least one event of the session is in the log;
  none of them, and not the registry row, names `claude-code`; no claim, no prompt that opens an ask, nothing in the
  inbox.
- **A turn left waiting (AC21).** A picker or a trust prompt fires no hook, so the hub sees a turn whose hooks went
  quiet: the model-picker turn after its prompt, the trust-prompt turn after a call's PreToolUse. The issue gives no
  quiet time; the test reads the registry every 2 s for 120 s and asks that attention reaches `unknown` and never
  reads `finished`.

## Disputes

- **Recorded shapes the corpus lacks.** No dynamic `/loop`, Cursor or Grok session, model picker or trust prompt
  has been recorded (#47). The fixtures above are this job's reading of each tool's documentation and of the
  recorded 2.1.304 sessions. If a live recording shows a different shape (a ScheduleWakeup prompt's entry with
  another `turnOrigin`, Cursor input without its base fields), that is a dispute for a blind redraft, not an edit.
- **The live session's transcript.** Claude Code keeps the real HOME for its sign-in, so the live transcript is
  outside the test home the hub runs in, and the hub can't verify the session against it. The live test reads the
  session as Claude Code's and doesn't ask that its events be verified.
- **AC4 at the base.** The base hub already answers every hook with an empty reply, so the watch-only test passes
  there; it is kept as the criterion's proof and as regression protection, and the criterion's wrong program is
  its planted twin (`adapter-decides`).

## Criteria to tests

Each test's name starts with `ACn #18.<id>`, the criterion's ID as `scripts/proof-change.mjs` computes it.

| Criterion | File | Tests |
|---|---|---|
| AC1 `#18.0bbec18d` | `record.test.ts`, `record.live.test.ts` | a recorded-shape session's Write and Bash calls and its commit, under the session; live: a real session's Read and Edit and the commit made during it |
| AC2 `#18.ed825eb3` | `failures.test.ts` | a failed command's signature, cause and owner; a sign-in block's signature and owner |
| AC4 `#18.1c162666` | `replies.test.ts` | nine hooks, every reply watch-only and each recorded; wrong program `adapter-decides` |
| AC6 `#18.32aa52f2` | `mcp.test.ts` | merge_pull_request counted as merge, an unknown tool as change; wrong program `unknown-tool-read` |
| AC7 `#18.689bca3f` | `failures.test.ts` | "usage limit reached" in the agent's words reads unknown |
| AC11 `#18.a39d3074` | `failures.test.ts` | npm test exit 1 at PostToolUseFailure, never an overrun; StopFailure rate_limit with no transcript |
| AC12 `#18.5a2a67f9` | `mcp.test.ts` | the official server's get_pull_request read; a repo .mcp.json github's tools change |
| AC13 `#18.52387a5c` | `record.test.ts` | a recorded commit with the agent's message only |
| AC21 `#18.e660707f` | `callers.test.ts` | Cursor and Grok sessions not Claude Code's; model-picker and trust-prompt turns read unknown |
| AC23 `#18.158d0b97` | `prompts.test.ts` | typed prompt person with an ask, unplaced prompt unknown with none; wrong program `unplaced-is-person` |
| AC24 `#18.93b29039` | `loops.test.ts` | the dynamic /loop session's loop readings and origins; wrong program `loop-from-origins` |

A PR that passes every test here proves these eleven criteria as this folder reads them; the live test must have
run, on your plan, for AC1's "real session".

## Files

- `helpers.ts`: temp homes, processes, deep-hook's build, the hub, the socket client, record reads, git repos, and
  `Session` (made-up Claude Code sessions: transcript entries and hooks through deep-hook).
- The test files above. `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
