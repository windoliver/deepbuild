# The fixture corpus

Recorded hook payloads and transcripts from real Claude Code and Codex sessions, one set per agent version (#47). Each payload is stored with the events its adapter must map it to. Those events are written from the agent's documentation or schema and from the design's event shapes below, and reviewed as test code. They are never produced by the adapter under test.

```
adapters/corpus/<agent>/<version>/<session>/
  session.json       {"schema": "corpus.session@1", "agent", "version", "surface": "terminal" | "desktop", "recorded", "scenario"}
  events.jsonl       one recorded hook call per line: {"payload", "expect": [{"kind", "data"}], "source", "reviewed", "tag"?}
  transcript.jsonl   the session's transcript (Claude Code) or rollout (Codex), redacted
```

- `node scripts/corpus.mjs replay` maps every payload through its adapter as a live event of its set's version and compares the events with `expect`, field by field, both ways.
- `node scripts/corpus.mjs check` is the preflight's corpus lane: each version a facts file that lists hook events (`events.versions`) covers has a set holding every event the facts list for it, each set replays clean, and the corpus stays under 200 MB.
- `node scripts/corpus.mjs record --agent claude-code|codex|pi|paseo --out <dir>` records a fresh set into `<dir>`, with no `expect`, for a new version. It joins the corpus only through a diff you approve, after its expected events are written and reviewed.

## Recording and redaction

pi's sets (#40) are real pi in RPC mode with the package and a real hub, only the model scripted: a tee on the hub's socket keeps each payload the package sends, and the transcript is pi's session file. pi's hook names are its own (`input`, `tool_call`, `agent_before_settle`); `agent_start`, `agent_end` and `agent_settled` are `session.activity`, and only `agent_before_settle` is `agent.stop`.

paseo's set (#3136) is a real paseo daemon at the version its facts pin, with DeepBuild's plugin (`packages/paseo`) and a stand-in provider (`scripts/corpus-paseo-provider`) for the agent and its model, as #55's real-paseo tests run it: the plugin's hook requests are kept where it finds the hub, and none is answered, so the stand-in's permission request is allowed in paseo itself, by `paseo permit allow`. The transcript is paseo's own record of the agent (`paseo inspect`). paseo's hook names are the plugin's (`agent.turn.before`, `agent.turn.after`, `agent.permission.before`, `agent.permission.after`), each carrying the session ID paseo reads for the agent: `agent.turn.before` is `session.activity` {session, activity: "turn_start"}, `agent.turn.after` is `agent.stop` {session, outcome}, `agent.permission.before` is `permission.request` {session, kind, tool} from its `permission_kind` and `tool_name`, and `agent.permission.after`, an answer given in paseo's own app, is no event: an answer counts for DeepBuild only through the trusted path (#55).

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
| Interrupt | `turn.interrupted` {session, turn}: `turn` is `turn_id`; Codex fires it instead of Stop for a turn you interrupt, so it adds no `agent.stop` |
| SubagentStart | `subagent.start` {session, subagent, type}: Codex fires it for a `spawn_agent` child before the child's first prompt; `type` is `agent_type`. A reading that a child started, never a stop |
| PreCompact | `session.compact` {session, phase: "before", trigger}: `trigger` is `manual` or `auto` |
| PostCompact | `session.compact` {session, phase: "after", trigger} |
| SubagentStop | `agent.stop` {session, subagent, outcome: "finished", continued, cause, usage}: a child's stop is a stop of its own, named by `subagent`; it ran in the child's own transcript, apart from the session's, so its cause is the payload's alone and its usage `null` |
| TaskCompleted | `task.completed` {session, agent_task, title}: `agent_task` is `task_id`, `title` is `task_subject`; the agent's word, never a closed task |
| Notification | `session.attention` {session, state} by `notification_type`: `permission_prompt`, `elicitation_dialog`, `elicitation_url_dialog` and `agent_needs_input` are `waiting`, `idle_prompt` is `finished`, `elicitation_complete` and `elicitation_response` are `working`; any other type maps to no event. A session-state signal, never an ask and never evidence |
| Elicitation | `session.attention` {session, state: "waiting"} |
| ElicitationResult | `session.attention` {session, state: "working"} |
| FileChanged | none: a watched file's change is the route a line takes into the terminal while a call still runs (#120), never evidence |

A Codex turn that no prompt started, such as a goal's continuation, opens with a `user.ask` {session, from, turn} before the first event of its first hook, `turn` being the payload's `turn_id`, since Codex fires no prompt hook for it. A spawned child's turn is started by its prompt, though its SubagentStart comes first.

**Tool kinds** (the design's shared shapes: shell, read, edit, write, search, fetch, mcp, or unknown, which guards treat as change). Claude Code: Bash shell; Read read; Edit, MultiEdit and NotebookEdit edit; Write write; Glob and Grep search; WebFetch and WebSearch fetch; `mcp__<server>__<tool>` mcp; anything else unknown. Codex: Bash shell, unless its command runs `apply_patch` or `applypatch`, which makes it an edit carrying `paths` and no `command`; apply_patch edit; `mcp__<server>__<tool>` mcp; anything else unknown. A Codex patch's `paths` are every `*** Add File`, `*** Update File`, `*** Delete File` and `*** Move to` line, indented or not, resolved against the payload's `cwd` (or the folder a leading `cd <dir> &&` names), sorted.

**Prompt origins** (`from`; the design's ask rule): `person` for what you typed, `scheduled` for a `/loop` or cron prompt, `subagent` for a background subagent's report, or a Codex subagent's own prompt (its payload names `agent_id`), which its parent wrote and the core records as `subagent` (#39), `session` for another session's message, `continuation` for a goal's continuation, a heartbeat or the desktop app's resume prompt, `app` for what DeepBuild's app sent, and `unknown` when nothing says. Two prompts are marked only by the text the agent's own app writes, and that text decides first: the Claude desktop app's resume prompt opens with "The app was quit while you were working.", and a Codex heartbeat's prompt opens with `<heartbeat>`; both are `continuation`. Otherwise Claude Code marks each prompt's origin on its transcript entry (the user entry whose `promptId` is the payload's `prompt_id`), and the first match decides: a subagent's hand-back (`origin.handback` true) is `subagent`, though its `turnOrigin` is `peer`; `turnOrigin` `task_notification` is `subagent`; `peer`, another session's message, is `session`; `scheduled` is `scheduled`; `human` is `person`; anything else, such as `sdk` with no origin, is `unknown`. A Stop hold's feedback in the desktop app also arrives as `task_notification`, so it would read `subagent`; the corpus holds none, and the adapter issue (#18) has to tell the two apart. A monitor's event, `turnOrigin` `task_notification`, is `subagent` like any task notice; the hub, which knows the watches a session armed, reads one whose `<task-id>` names one of them as its monitor's, which ends no background work (#997). Codex marks a goal's continuation in its rollout as a user message that opens with `<codex_internal_context source="goal">`.

**Stop causes** (the closed set of #312's stop causes, as slugs): `sign_in_required`, `token_refresh_failed`, `plan_window_spent`, `rate_limited`, `refusal`, `max_turns`, `context_overflow`, `tool_schema_rejected`, `agent_crashed`, `timed_out`, `unknown`. Every stop names one (#603), from its facts' `stop.cause`: the hook payload's error, then the turn's transcript error records, then its last rate-limit record, never the agent's text; a stop nothing names a cause for, a finished one included, is `unknown`. Claude Code's StopFailure `error` (its hooks reference lists the values), and the `error` of a turn's API error entry, map `rate_limit` and `overloaded` to `rate_limited`, and `authentication_failed` and `oauth_org_not_allowed` to `sign_in_required`; any other value, such as `model_not_found`, is `unknown`. Codex's error events map by `codex_error_info`, and a turn whose last `token_count` has a limit reached is `plan_window_spent` with `plan_resets` when its spent window resets, `rate_limited` without one.

**Stop usage** (agent.stop@2's `usage`, from the facts' `stop.usage`): `{covers, model, input, cached, output, context_fill, cost}`, each count `{value, exact}` or null when its records don't carry it, and `null` when no record of the turn does, as after an API error, whose synthetic entry carries zeros. Claude Code covers the turn: its assistant entries' usage, once per message. Codex covers the session so far: its last `token_count` up to the turn's end. No recorded payload or transcript carries a price, so the cost is unpriced.

## Sessions

| Session | What it holds |
|---|---|
| claude-code `tools` | a shell call, a Write and an Edit each through a permission request, a failed call, and a resume of the same session |
| claude-code `subagent` | a background subagent's calls under its `agent_id` and its hand-back report |
| claude-code `loop` | a `/loop` and one of its iterations |
| claude-code 2.1.308 `monitor` | a Monitor armed on a command, three of its events each waking the session as a `<task-notification>` prompt naming the watch, and a TaskStop of the watch in the third's turn (#997); recorded on Linux |
| claude-code `compact` | `/compact` mid-session: SessionStart from `compact` and the summary turn |
| claude-code 2.1.304 `clear` | `/clear` mid-session (SessionEnd from `clear`, then SessionStart from `clear` under a new ID in the same process), then `--fork-session` of the second session: a new process and ID, SessionStart from `fork`, and a transcript that starts with copies of the forked session's entries carrying the fork's first prompt ID |
| claude-code `stop-failure` | a turn that ends on an API error (`model_not_found`) |
| claude-code `crash` | the agent killed in the middle of a tool call: a PreToolUse with no PostToolUse or Stop |
| claude-code 2.1.304 `child-gates` | a task created and marked completed (TaskCompleted), and a background subagent that runs, stops (SubagentStop) and reports back |
| claude-code 2.1.299 `desktop-peer` | the desktop app: a session another session started, and messages from that session |
| claude-code 2.1.308 `permission-answered` | a Write through a permission request you answer, an internal agent's SubagentStop, then the idle prompt's Notification |
| claude-code 2.1.308 `permission-denied-esc` | a Write's permission request dismissed with Esc, and the permission prompt's Notification; no PostToolUse or Stop |
| claude-code 2.1.308 `permission-terminal-closed` | the terminal closed while a Bash call's permission request shows: a PermissionRequest with no answer, PostToolUse, Stop or SessionEnd |
| claude-code 2.1.308 `elicitation-answered` | an MCP tool's form elicitation accepted: Elicitation, its dialog's Notification, ElicitationResult and the response Notification |
| claude-code 2.1.308 `elicitation-cancelled` | an MCP tool's form elicitation cancelled: Elicitation, ElicitationResult and the response Notification |
| claude-code `deepbuild-tools` | DeepBuild's two servers as `deep setup` names them (#2897), with no hub in their home: `deep_status`, marked `anthropic/alwaysLoad`, called with no search that loads it, and `deep_search` called only after a ToolSearch loads it (before `deep_status` on 2.1.308, after it on 2.1.299 and 2.1.304); both calls answer that the hub is unreachable |
| claude-code `file-changed` | a file the session's FileChanged matcher names, in its folder, appended to by a shell call: FileChanged with `event` `change` (#3136) |
| paseo 0.15.0 `permission-allowed` | one stand-in turn whose shell call asks for permission, allowed in paseo by `paseo permit allow`: the turn's start, the request, the turn's end and the answer from paseo's app (#3136) |
| codex `tools` | shell calls, an `apply_patch` add, and a failing command, which Codex reports through PostToolUse |
| codex `patches` | a patch through the shell tool, then a resume with a patch whose markers are indented |
| codex `permission` | a permission request from the terminal UI: a write in a read-only sandbox under `-a on-request` |
| codex `goal` | a goal and its two continuation turns, which fire no prompt hook |
| codex `crash` | the agent killed in the middle of a tool call |
| codex `subagent` | a `spawn_agent` child and a `wait_agent` on it, on a scripted model: SubagentStart, the child's prompt, and SubagentStop in place of the child's Stop (#3136) |
| codex `compact` | a shell call whose reply puts the context past `model_auto_compact_token_limit`, on a scripted model: PreCompact and PostCompact (trigger `auto`) mid-turn, then the turn's end (#3136) |
| codex `interrupt` | a SIGINT to `codex exec` while a shell call runs, on a scripted model: Interrupt in place of Stop (#3136) |
| claude-code 2.1.299 `desktop-resume` | the desktop app quit mid-call and reopened: SessionEnd, SessionStart from `resume`, and its resume prompt; also another session's message |
| codex 0.160.0 `desktop-heartbeat` | Codex Desktop (the ChatGPT app's Codex, 0.160.0): a heartbeat set up on a thread, its run as a `<heartbeat>` prompt, and its removal |

The subagent, resume, compact and crash sessions are also the usage-counting fixtures: their transcripts carry each turn's usage as the agent wrote it.

Claude Code versions: the `file-changed` sets ran each version from its npm package (`@anthropic-ai/claude-code@<version>`) installed in a scratch folder and first on PATH. 2.1.308 is the Claude Code the Claude desktop app bundles, recorded in the terminal from the app's copy (`~/Library/Application Support/Claude/claude-code/2.1.308`) first on PATH. Its SubagentStop also fires for Claude Code's internal agents (an empty `agent_type`), and a subagent that hands back through `SubagentHandback`, or an internal agent, may send no `last_assistant_message`, so for 2.1.308 that field is optional.

Codex versions: the `subagent`, `compact` and `interrupt` sets (#3136) ran each version from its npm package (`@openai/codex@<version>`) on a scripted model (`scripts/corpus-codex-model.mjs`, `-m gpt-5.4` through a loopback provider) in a Codex home of their own: Codex, its hooks and its rollout are real, and only the model's replies are scripted, as pi's are, so they need no sign-in. 0.144.0 is the CLI on PATH, 0.160.0 the Codex in the ChatGPT desktop app (whose app-server ran the heartbeat), and 0.163.0-alpha.10.2 the Codex in Codex.app; each covered version has its own full set. Desktop sessions record the hooks of their folder's own config: `.claude/settings.json` in a scratch folder for Claude, and `.codex/hooks.json` in the trusted `/private/tmp` for Codex, trusted once in the app and removed after.

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
| `permission-answered` | a Claude Code PermissionRequest you answered |
| `permission-denied-esc` | a Claude Code PermissionRequest dismissed with Esc |
| `permission-terminal-closed` | a Claude Code PermissionRequest left open when the terminal closed |
| `notification-permission-prompt` | a Claude Code Notification of type `permission_prompt` |
| `notification-idle-prompt` | a Claude Code Notification of type `idle_prompt` |
| `notification-elicitation-dialog` | a Claude Code Notification of type `elicitation_dialog` |
| `elicitation-answered` | a Claude Code Elicitation the person answered |
| `elicitation-cancelled` | a Claude Code Elicitation the person cancelled |
