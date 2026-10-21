# The fixture corpus

Recorded hook payloads and transcripts from real Claude Code and Codex sessions, one set per agent version (#47). Each payload is stored with the events its adapter must map it to. Those events are written from the agent's documentation or schema and from the design's event shapes below, and reviewed as test code. They are never produced by the adapter under test.

```
adapters/corpus/<agent>/<version>/<session>/
  session.json       {"schema": "corpus.session@1", "agent", "version", "surface": "terminal" | "desktop", "recorded", "scenario"}
  events.jsonl       one recorded hook call per line: {"payload", "expect": [{"kind", "data"}], "source", "reviewed", "tag"?}
  transcript.jsonl   the session's transcript (Claude Code) or rollout (Codex), redacted
```

- `node scripts/corpus.mjs replay` maps every payload through its adapter as a live event of its set's version and compares the events with `expect`, field by field, both ways.
- `node scripts/corpus.mjs check` is the preflight's corpus lane: each version a facts file covers has a set holding every event the facts list for it, each set replays clean, and the corpus stays under 200 MB.
- `node scripts/corpus.mjs record --agent claude-code|codex --out <dir>` records a fresh set into `<dir>`, with no `expect`, for a new version. It joins the corpus only through a diff you approve, after its expected events are written and reviewed.

## Recording and redaction

Sessions are scripted (`record`'s scenarios) in a pseudo-terminal for Claude Code, through `codex exec` for Codex, and in Codex's terminal UI for a goal, with a hook on every event the adapter handles that keeps each payload byte for byte. Claude Code sessions use `--setting-sources project --strict-mcp-config`, Codex sessions `--ignore-user-config` where they can, and hooks come from the session's own settings, so your own hooks, MCP servers and instructions stay out. Codex's hooks run under `--dangerously-bypass-hook-trust`, so recording never writes trust into your Codex config; the goal session runs in a folder your config already trusts, named by `DEEP_CORPUS_CODEX_TRUSTED`.

Redaction replaces your home folder with `~`, your user name with `user` and every email address with `user@example.com`. It leaves out whole transcript entries that carry your instructions, memory, account or a system prompt: Claude Code's attachments and prompt snapshots, and Codex's developer messages and `AGENTS.md` blocks, and the instruction fields of `session_meta` and `turn_context`. `record` runs gitleaks with the repo's rules over each fresh set, and a finding keeps it out.

Desktop sessions come from the #80 spike's throwaway sessions in the Claude desktop app, whose hooks logged each payload; their transcripts are redacted the same way.

## Expected events

Each event is reduced to the fields an adapter decides, `kind` and `data`. The hub's fields (`id`, `log_pos`, `ts`, `writer`, `actor`, `scope`) aren't stored. Every `data` holds `session`, the payload's `session_id`, and `subagent`, the payload's `agent_id`, when a subagent made the call ("Who is calling", in the design's "Hooks are evidence, not a state machine").

| Hook | Events, in order |
|---|---|
| SessionStart | `session.start` {session, source} |
| UserPromptSubmit | `user.ask` {session, from, text}: `text` is the prompt; `from` is its origin below |
| PreToolUse | `tool.before` {session, call, tool, kind, …}: `call` is `tool_use_id`; `kind` is the tool call's kind; a `shell` call adds `command`; a `read`, `edit` or `write` call adds `paths`, absolute; an `mcp` call adds `server` and `name` |
| PermissionRequest | `permission.request` {session, kind: "tool", tool, …}, with the same `command` or `paths` as the call |
| PostToolUse | `tool.after` {session, call, tool, outcome: "ok"} |
| PostToolUseFailure | `tool.after` {session, call, tool, outcome: "failed"} |
| Stop | `agent.stop` {session, outcome: "finished", continued, cause, usage}: `continued` is `stop_hook_active`; `cause` and `usage` as below |
| StopFailure | `agent.stop` {session, outcome: "failed", cause, usage}: `cause` and `usage` as below |
| SessionEnd | `session.end` {session, reason} |
| SubagentStop | `agent.stop` {session, subagent, outcome: "finished", continued, cause, usage}: a child's stop is a stop of its own, named by `subagent`; it ran in the child's own transcript, which the set doesn't hold, so its cause is the payload's alone and its usage `null` |
| TaskCompleted | `task.completed` {session, agent_task, title}: `agent_task` is `task_id`, `title` is `task_subject`; the agent's word, never a closed task |

A Codex turn that no prompt started, such as a goal's continuation, opens with a `user.ask` {session, from, turn} before the first event of its first hook, `turn` being the payload's `turn_id`, since Codex fires no prompt hook for it.

**Tool kinds** (the design's shared shapes: shell, read, edit, write, search, fetch, mcp, or unknown, which guards treat as change). Claude Code: Bash shell; Read read; Edit, MultiEdit and NotebookEdit edit; Write write; Glob and Grep search; WebFetch and WebSearch fetch; `mcp__<server>__<tool>` mcp; anything else unknown. Codex: Bash shell, unless its command runs `apply_patch` or `applypatch`, which makes it an edit carrying `paths` and no `command`; apply_patch edit; `mcp__<server>__<tool>` mcp; anything else unknown. A Codex patch's `paths` are every `*** Add File`, `*** Update File`, `*** Delete File` and `*** Move to` line, indented or not, resolved against the payload's `cwd` (or the folder a leading `cd <dir> &&` names), sorted.

**Prompt origins** (`from`; the design's ask rule): `person` for what you typed, `scheduled` for a `/loop` or cron prompt, `subagent` for a background subagent's report, `session` for another session's message, `continuation` for a goal's continuation, a heartbeat or the desktop app's resume prompt, `app` for what DeepBuild's app sent, and `unknown` when nothing says. Two prompts are marked only by the text the agent's own app writes, and that text decides first: the Claude desktop app's resume prompt opens with "The app was quit while you were working.", and a Codex heartbeat's prompt opens with `<heartbeat>`; both are `continuation`. Otherwise Claude Code marks each prompt's origin on its transcript entry (the user entry whose `promptId` is the payload's `prompt_id`), and the first match decides: a subagent's hand-back (`origin.handback` true) is `subagent`, though its `turnOrigin` is `peer`; `turnOrigin` `task_notification` is `subagent`; `peer`, another session's message, is `session`; `scheduled` is `scheduled`; `human` is `person`; anything else, such as `sdk` with no origin, is `unknown`. A Stop hold's feedback in the desktop app also arrives as `task_notification`, so it would read `subagent`; the corpus holds none, and the adapter issue (#18) has to tell the two apart. Codex marks a goal's continuation in its rollout as a user message that opens with `<codex_internal_context source="goal">`.

**Stop causes** (the closed set of #312's stop causes, as slugs): `sign_in_required`, `token_refresh_failed`, `plan_window_spent`, `rate_limited`, `refusal`, `max_turns`, `context_overflow`, `tool_schema_rejected`, `agent_crashed`, `timed_out`, `unknown`. Every stop names one (#603), from its facts' `stop.cause`: the hook payload's error, then the turn's transcript error records, then its last rate-limit record, never the agent's text; a stop nothing names a cause for, a finished one included, is `unknown`. Claude Code's StopFailure `error` (its hooks reference lists the values), and the `error` of a turn's API error entry, map `rate_limit` and `overloaded` to `rate_limited`, and `authentication_failed` and `oauth_org_not_allowed` to `sign_in_required`; any other value, such as `model_not_found`, is `unknown`. Codex's error events map by `codex_error_info`, and a turn whose last `token_count` has a limit reached is `plan_window_spent` with `plan_resets` when its spent window resets, `rate_limited` without one.

**Stop usage** (agent.stop@2's `usage`, from the facts' `stop.usage`): `{covers, model, input, cached, output, context_fill, cost}`, each count `{value, exact}` or null when its records don't carry it, and `null` when no record of the turn does, as after an API error, whose synthetic entry carries zeros. Claude Code covers the turn: its assistant entries' usage, once per message. Codex covers the session so far: its last `token_count` up to the turn's end. No recorded payload or transcript carries a price, so the cost is unpriced.

## Sessions

| Session | What it holds |
|---|---|
| claude-code `tools` | a shell call, a Write and an Edit each through a permission request, a failed call, and a resume of the same session |
| claude-code `subagent` | a background subagent's calls under its `agent_id` and its hand-back report |
| claude-code `loop` | a `/loop` and one of its iterations |
| claude-code `compact` | `/compact` mid-session: SessionStart from `compact` and the summary turn |
| claude-code `stop-failure` | a turn that ends on an API error (`model_not_found`) |
| claude-code `crash` | the agent killed in the middle of a tool call: a PreToolUse with no PostToolUse or Stop |
| claude-code 2.1.304 `child-gates` | a task created and marked completed (TaskCompleted), and a background subagent that runs, stops (SubagentStop) and reports back |
| claude-code 2.1.299 `desktop-peer` | the desktop app: a session another session started, and messages from that session |
| codex `tools` | shell calls, an `apply_patch` add, and a failing command, which Codex reports through PostToolUse |
| codex `patches` | a patch through the shell tool, then a resume with a patch whose markers are indented |
| codex `permission` | a permission request from the terminal UI: a write in a read-only sandbox under `-a on-request` |
| codex `goal` | a goal and its two continuation turns, which fire no prompt hook |
| codex `crash` | the agent killed in the middle of a tool call |
| claude-code 2.1.299 `desktop-resume` | the desktop app quit mid-call and reopened: SessionEnd, SessionStart from `resume`, and its resume prompt; also another session's message |
| codex 0.160.0 `desktop-heartbeat` | Codex Desktop (the ChatGPT app's Codex, 0.160.0): a heartbeat set up on a thread, its run as a `<heartbeat>` prompt, and its removal |

The subagent, resume, compact and crash sessions are also the usage-counting fixtures: their transcripts carry each turn's usage as the agent wrote it.

Codex versions: 0.144.0 is the CLI on PATH, 0.160.0 the Codex in the ChatGPT desktop app (whose app-server ran the heartbeat), and 0.163.0-alpha.10.2 the Codex in Codex.app; each covered version has its own full set. Desktop sessions record the hooks of their folder's own config: `.claude/settings.json` in a scratch folder for Claude, and `.codex/hooks.json` in the trusted `/private/tmp` for Codex, trusted once in the app and removed after.

## Tags

| tag | where |
|---|---|
| `loop-iteration` | a Claude Code `/loop` iteration's UserPromptSubmit |
| `subagent-report` | a background subagent's report as a UserPromptSubmit |
| `other-session-message` | another session's message as a UserPromptSubmit |
| `desktop-resume-prompt` | the Claude desktop app's resume prompt as a UserPromptSubmit |
| `goal-continuation` | the first hook of a Codex goal's continuation turn |
| `heartbeat` | a Codex heartbeat's prompt, a UserPromptSubmit opening with `<heartbeat>` |
| `patch-indented-markers` | a Codex patch whose marker lines are indented |
| `patch-via-shell` | a Codex patch sent through the shell tool |
