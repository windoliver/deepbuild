# Acceptance tests for #47: the fixture corpus

These tests were drafted blind from issue #47 (its text as of October 19), `docs/technical-design.md` (mainly "What each agent gives us", "Hooks are evidence, not a state machine", "Lifecycles", "Event" and "How we know version 0 works") and the base commit `0c5e145`, which has no corpus. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run the fast tests with:

```
node --test tests/acceptance/47/{corpus,replay,explain,lifecycle,preflight}.test.mjs
```

The live tests spend plan usage and run only by hand:

```
DEEP_CORPUS_LIVE=1 node --test --test-concurrency=1 tests/acceptance/47/corpus.live.test.mjs
```

Without `DEEP_CORPUS_LIVE=1`, or without a binary, a sign-in, the hub or a precondition, each live test fails with `BLOCKED` in its message. Nothing skips. The glob `tests/acceptance/47/*.test.mjs` also picks up the live file, whose tests then read BLOCKED. On the base all 26 fast tests and all 4 live tests fail, each for the expected reason, as `BASE-FAILURE.txt` shows. The fast suite takes about 3 s on a small corpus. It needs `gitleaks` on PATH for the secret scan; without it, that test fails as BLOCKED.

## The surface (my choice, since none was named)

The issue names the corpus, a recording script, `deep explain <session>`, the preflight, `adapter.facts@1` and the design's event names (`user.ask`, `from`, `PreToolUse`, `ask.machine@1`). It names no file layout, script, lane, option or output format. I picked the smallest surface next to the existing `scripts/*.mjs` tools and `adapters/*.facts.json`. The tests reach the code under test only through it.

### The corpus: `adapters/corpus/`

```
adapters/corpus/<agent>/<version>/<session>/
  session.json       {"schema": "corpus.session@1", "agent": "<agent>", "version": "<version>",
                      "surface": "terminal" | "desktop" | …, "recorded": "<date>"}
  events.jsonl       one line per recorded hook call, in recorded order:
                     {"payload": {…the agent's hook stdin JSON, unchanged but redacted…},
                      "expect": [{"kind": "…", "data": {…}}, …],
                      "source": "https://… (the agent's documentation or schema the expected events were written from)",
                      "reviewed": "<who reviewed them, and when>",
                      "tag": "<optional, below>"}
  transcript.jsonl   the session's own transcript (Claude Code) or rollout (Codex), redacted
```

- The corpus is data the corpus check reads, not a test, so it sits outside the repo's declared test paths (`testPaths` in `scripts/lanes.mjs`, all of `tests/**` among them), beside the facts files it is checked against. perf reruns the check lanes in a copy without the change's own tests (#583), and a corpus under `tests/` would be missing from that copy.
- `<agent>` is `claude-code` or `codex`, the facts file's base name. `<version>` is the version `claude --version` or `codex --version` prints. One folder of versions is a recorded set. pi joins in R2.
- `session.json`'s version equals its folder's, and so does the version the transcript records: each Claude Code entry's `version`, and Codex's `session_meta` `payload.cli_version`.
- Claude Code sessions use `surface` `terminal` or `desktop` (the desktop app). The desktop app runs its own bundled Claude Code, which updates apart from the one on your PATH, so a desktop session goes in the set of the version it ran. The corpus needs at least one session from each surface, in any Claude Code set, not one of each in every covered version.
- Size is the apparent size of every file under `adapters/corpus/`, as git stores them. "Under 200 MB" means under 200,000,000 bytes.
- `expect` holds the events the payload must map to, in order. Each is an event as the design defines it, reduced to the fields an adapter decides: `kind` and `data`. The fields the hub assigns (`id`, `log_pos`, `ts`, `writer`, `actor`, `scope`) aren't stored. Two kinds are pinned by these tests:
  - a prompt maps to `{"kind": "user.ask", "data": {"from": "<origin>", …}}`, where origin is one of the design's `person`, `scheduled`, `subagent`, `session`, `continuation`, `app` or `unknown`;
  - a Codex patch maps to `{"kind": "tool.before", "data": {"kind": "edit", "paths": ["<absolute path>", …]}}`. `tool.before` is the kind the design's event table lists, and `data.kind` is the tool call's kind from "Every adapter maps".
- `tag` marks the cases the criteria name. Every tag must appear at least once, on a `UserPromptSubmit` unless marked otherwise:

| tag | agent | stored `user.ask` `from` |
|---|---|---|
| `loop-iteration` | claude-code | `scheduled` |
| `subagent-report` | claude-code | `subagent` |
| `other-session-message` | claude-code | `session` |
| `desktop-resume-prompt` | claude-code, in a `desktop` session | `continuation` |
| `goal-continuation` | codex | `continuation` |
| `heartbeat` | codex | `continuation` |
| `patch-indented-markers` | codex, a `PreToolUse` | none; a `tool.before` edit with every path |
| `patch-via-shell` | codex, a `PreToolUse` through the shell tool, not `apply_patch` | none; a `tool.before` edit with every path |

### The facts files: `adapters/<agent>.facts.json`

These stay `adapter.facts@1`, with `versions` as the covered range, as today. Each file gains `events.versions["<version>"]` for every covered version: an object keyed by each hook event the adapter handles for that version. Each value lists the fields that event carries in the corpus, in whatever form the adapter's strict schema needs; the tests read only the keys. Claude Code's lists hold at least SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, Stop, StopFailure and SessionEnd. Codex's hold at least SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse and Stop. These are the design's R1 lists.

### `node scripts/corpus.mjs <command>`

```
node scripts/corpus.mjs replay    [--corpus <dir>] [--facts <dir>]
node scripts/corpus.mjs check     [--corpus <dir>] [--facts <dir>]
node scripts/corpus.mjs lifecycle [--log <events.jsonl>]
node scripts/corpus.mjs record    --agent claude-code|codex --out <dir>      (live: spends plan usage)
```

`--corpus` defaults to `adapters/corpus` and `--facts` to `adapters` (every `*.facts.json` in it). `record` needs `--out`, since a fresh set joins the corpus only through a diff you approve. The tests pass `--corpus` and `--facts` only for planted copies, and the preflight passes neither.

`replay` maps every recorded payload through its agent's adapter, as a live event of its set's version, and prints JSON lines:

```
{"type": "payload", "case": "<agent>/<version>/<session>/events.jsonl:<line>", "agent", "version",
 "session": "<agent>/<version>/<session>", "hook": "<hook_event_name>", "verified": true | false,
 "result": "match" | "mismatch" | "unverified" | "no-expected",
 "diffs": [{"path": "<names the field>", "expected": …, "actual": …}]}
{"type": "session", "session": "<agent>/<version>/<session>", "agent", "version",
 "verified": true | false, "holds": "active" | "watch-only",
 "readings": [{"code": "…", "field": "<the field, such as tool_input or stop_hook_active>", "version": "<version>"}]}
{"type": "summary", "verdict": "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE" | "INVALID", "elapsedMs": <n>}
```

- `result` is `match` only when the adapter's events, reduced to `kind` and `data`, equal `expect` field by field, both ways, and the event is verified. A case without `expect` is `no-expected`, never a match.
- A payload that lacks a field the facts list for its event and version, carries a field of another type, or names an event the facts don't list, reads `verified: false`. Its session reads `verified: false` and `holds: "watch-only"`, with a reading naming the field. A field the facts don't list is at most a reading and changes nothing else.
- The command exits 0 only when the summary is PASS: every payload is a match and every session is verified.

`check` is the preflight's corpus lane. It prints `replay`'s lines and `{"type": "size", "bytes": <n>, "limit": 200000000}`. Then it prints one `FAIL corpus: <text>` line for each problem it finds, each followed by a `  Fix: ` line, and exits 1. Otherwise it prints `PASS corpus (<s> s)` and exits 0. It fails:

- a covered version (in a facts file's `versions`) with no recorded set, naming the version;
- a covered version whose set has no payload for an event its `events.versions` lists, naming the version and the event;
- a covered version whose set doesn't replay clean, naming the version;
- a corpus of 200,000,000 bytes or more, naming the 200 MB limit.

`lifecycle` reads event logs back against the lifecycle tables (`ask.machine@1`, `lease.machine@1`, a claim's and a session binding's). With `--log`, it reads that one log, one event per line in the design's shape `{id, log_pos, kind, subject, writer, actor, scope, data, ts}`. Without it, it reads the events every recorded session in the corpus maps to, and each seeded run of the hub's simulation harness. For each move a table doesn't allow, it prints `FAIL lifecycle: <text naming the event's id and the table>`. It ends with `{"type": "summary", "verdict": …, "sessions": <recorded sessions read>, "simulationRuns": <seeded runs read>, "moves": <moves checked>}` and exits 0 only on PASS. A missing simulation harness is BLOCKED, naming it, never PASS.

### The preflight

`scripts/lanes.mjs`'s `checks` holds one lane whose command is exactly `[node, 'scripts/corpus.mjs', 'check']` (node as `process.execPath` or `node`). The lane name is free. `benchmarks/budgets.json` holds a perf task whose command is `["node", "scripts/corpus.mjs", "replay"]`, with a `p50Ms` or `p95Ms` limit of at most 120000 and a `margin`, so perf judges it on the reference Mac and compares it with the merge base.

### `deep explain <session>`

The CLI entry (`packages/cli/src/main.ts`, the `deep` bin) takes `explain <session> --json`, where `<session>` may be a recorded session's folder. It prints one JSON line for each event each payload maps to, in order:

```
{"line": <events.jsonl line>, "hook": "<hook_event_name>", "kind": "<event kind>",
 "rule": "<a JSON Pointer (RFC 6901) into the facts file, naming the entry that mapped it>",
 "facts": "adapters/<agent>.facts.json", "version": "<the agent version behind the event>"}
```

`deep explain <session ID>` against the record needs the hub and the event log (#14, #16). These tests don't reach that form.

### The live tests' surface

- `record` writes `<out>/<agent>/<installed version>/<session>/…` with no `expect` on any case, and changes nothing under `adapters/`, the corpus and the facts files.
- Criterion 13 reads `deep status --json`: `{"sessions": [{"id", "agent", "version", "holds": "active" | "watch-only", "smokeTest": null | {"state": "waiting-for-you" | "running" | "diff-ready", "version", "diff": "<id or path>", "job": "<the runner's folder, under ~/.deepbuild/jobs/>", "withinReserve": true}}], "standingApprovals": [{"agent": "claude-code", "kind": "smoke-test"}]}`. The sessions are `claude -p` runs with DeepBuild's hooks installed at user level.

### The secret scan

The secret scan is the `gitleaks` binary, `gitleaks detect --no-git` over `adapters/corpus/`, with the repo's vendored rules, `packages/evidence/gitleaks/gitleaks.toml` (v8.30.1, from #15). It was checked with gitleaks 8.18.4. The test plants a key it generates at run time into a scratch copy of a corpus transcript, so no secret is ever written into the repo.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading `- [ ] ` dropped. They were computed with the command in `tests/acceptance/48/README.md`. Each test's name starts with its ID.

| # | ID | Criterion (short) | Tests (file: name) | Wrong program it must fail on | On the base |
|---|---|---|---|---|---|
| 1 | `#47.fc36112e` | every handled event has a fixture per supported version | corpus: *every hook event a facts file lists…*; *Claude Code's corpus holds sessions recorded in the terminal and in the desktop app, each in the set of the version it ran*; *each recorded session is tagged with the agent version…*. replay: *the check passes the recorded corpus, and fails a covered version whose set lacks an event…* | A corpus missing an event or a version, or with no desktop session (or no terminal session) at all. A recorder that tags a session, a desktop one included, with a version other than the one that ran, such as the terminal's or the facts' newest. A check that ignores coverage (a planted set with no PreToolUse) | FAIL: no `adapters/corpus` |
| 2 | `#47.8f0e2354` | secret scan finds nothing | corpus: *a secret scan over the corpus finds nothing, and… finds a key planted…*; *no corpus file holds this machine's home folder or the git user's email* | A corpus with an unredacted key (the planted twin proves the scan sees the corpus's file types). A transcript keeping your home folder or email | FAIL: no `adapters/corpus` |
| 3 | `#47.1597fbec` | a changed shape fails an adapter test | replay: *a changed payload shape fails the adapter's replay, naming the field, for each adapter* | An adapter, or a replay, that maps a PreToolUse with `tool_input` renamed and still passes | FAIL: no `adapters/corpus` (then no `scripts/corpus.mjs`) |
| 4 | `#47.13b96768` | a new version's fixtures pass before the range widens | replay: *the facts range widens only to a version whose recorded set replays clean…*. live: *recording a fresh … set…* | A check that accepts a widened range without replaying the new set (planted broken set). A check that refuses every widening (planted clean set). A recorder that writes expected events, misses an event, leaks a secret or writes into `adapters/corpus/` | FAIL: no `adapters/corpus`; live BLOCKED |
| 5 | `#47.827e6ab1` | `/loop`, subagent report, other session; two Codex patches | corpus: *the corpus holds a Claude Code /loop iteration…*; *…a Codex patch with indented markers and one sent through the shell tool…*. replay: *the recorded /loop iteration… replay clean, and reading any prompt as yours fails…* | An adapter that reads these prompts as `person` (twin: stored `from: person`; the replay compares both ways). An adapter that reads only unindented markers (twin: the indented path left out), or misses a patch run through the shell | FAIL: no `adapters/corpus` |
| 6 | `#47.9e03b1e8` | `deep explain` names the rule and version per event | explain: *deep explain <session> names, for each event, the facts rule… and the agent version…* | No `explain` command. One rule name for every event. A rule that isn't an entry of the facts file. The newest covered or installed version in place of the session's (caught when the facts cover two or more versions) | FAIL: `deep explain` is not a command |
| 7 | `#47.3f704ae4` | under 200 MB, replays in under 2 min, in the preflight, against the merge base | corpus: *the corpus stays under 200 MB*. replay: *the check fails a corpus of 200 MB or more, naming the size*. preflight: *the full replay is a perf task with a limit of 2 minutes…* | A corpus of 200 MB or more. A check that never measures size (planted sparse 200 MB file). No perf task, or one with a looser limit or not the full replay | FAIL: no `adapters/corpus`; no perf task |
| 8 | `#47.fc65f49c` | each payload stored with its events, from docs, compared field by field | corpus: *every recorded payload is stored with the events it must map to…*. replay: *the whole corpus replays…*; *the replay compares… field by field…* | A case with no expected events, no source or no review. A replay that compares only kinds, ignores an added or removed field, ignores a dropped event, or passes a case with no expected events | FAIL: no `adapters/corpus` |
| 9 | `#47.59eef887` | four drifts read unverified and watch-only; an added field changes nothing | replay: *for each adapter, a recorded PreToolUse with a renamed, removed or retyped field or an unknown event name…* | An adapter that reads fields with defaults: the renamed `tool_input` becomes an empty command and a verified event, and the test fails it, naming `tool_input`. An adapter that refuses an added unknown field | FAIL: no `adapters/corpus` |
| 10 | `#47.e19749bc` | preflight fails an uncovered range; Stop without `stop_hook_active` | preflight: *the preflight runs the corpus check as a lane…*. replay: *the check fails a facts range that covers a version with no recorded set…*; *a recorded Stop with stop_hook_active removed…* | A preflight with no corpus lane, or one that checks a test corpus. A check that trusts the facts' range. An adapter that defaults `stop_hook_active`, or that gives more than one reading | FAIL: no lane; no `adapters/corpus` |
| 11 | `#47.d948ef8c` | sessions and simulation runs replay through the lifecycle tables | lifecycle: *a planted log that moves an ask from defaulted to answered fails…*; *every recorded session… and each seeded run of the hub's simulation harness…* | A checker that reads only final states: answered is a final state, so it passes the planted log and fails the test. A checker that refuses every log (the clean twin). One that skips the corpus or the simulation harness | FAIL: no `scripts/corpus.mjs`; no `adapters/corpus` |
| 12 | `#47.8ebea6b5` | goal continuation, heartbeat, desktop resume are `from: continuation` | corpus: *the corpus holds a Codex goal's continuation…*. replay: *…replay as continuations, and an adapter that reads any as yours fails…* | An adapter that maps any of them to `person` (the stored `from: person` twin fails the replay, naming the payload) | FAIL: no `adapters/corpus` |
| 13 | `#47.2ac9ccf2` | uncovered Claude Code: smoke test under the standing approval, one diff, watch-only until approved | live: *without the standing approval…*; *with the standing approval…* | A row that doesn't say the smoke test waits for you. A smoke test that runs outside the runner or the plan reserve. A runner that widens the range on its own run: the second session is then gated, and the test fails, naming the version. One smoke test per session instead of per version | BLOCKED: live opt-in; then the hub, the runner and `deep status --json` |

### What depends on parts the base commit lacks

The base has no corpus, no `scripts/corpus.mjs`, no per-version event lists in the facts files, no Claude Code or Codex adapter mapping, no `deep explain`, no hub, no lifecycle tables, no simulation harness, no runner and no `deep status`. Every fast test fails, and every live test is BLOCKED. None passes on a missing part:

- Criteria 3, 5, 8, 9, 10 and 12 need the adapters' event mapping, which #47's own scope doesn't build. `scripts/corpus.mjs replay` must call each agent's adapter through its public entry. Until the adapters exist, a replay can only fail or be BLOCKED, so these criteria stay open.
- Criterion 11 needs the lifecycle tables and the hub's simulation harness. A run with no simulation harness must be BLOCKED, naming it.
- Criterion 6 needs `deep explain` in the CLI, which the issue's October 9 addition puts in #47.
- Criterion 13 needs the hub, the runner, standing approvals and session rows. Its live tests stay BLOCKED until those exist and the installed Claude Code is a version the facts don't cover. A PR can say `Closes #47` only once the maintainer has run them and kept their output as evidence. Until then it says `Part of #47`.
- Criterion 7's time budget is judged by perf on the reference Mac only. Elsewhere it's a reading, as for every budget.

### Checked against a sample implementation and mutants

To check that the tests can pass and catch what they claim, I wrote a throwaway sample in a scratch copy outside this checkout (not committed, not part of this change). It had a synthetic corpus with one set per agent and every tag, per-version event lists in the facts files, a `scripts/corpus.mjs` with a toy adapter, a comparator, a check and a lifecycle checker with a two-table toy, `deep explain`, the lane and the perf task. All 26 fast tests passed against it in about 2.5 s, and also with a second covered Claude Code version added. These mutants of it each failed the tests named:

| Mutant | Failed |
|---|---|
| Adapter maps continuations to `person` | #47.8ebea6b5 replay, #47.fc65f49c whole replay, #47.fc36112e check, #47.13b96768, #47.59eef887 |
| Adapter reads fields with defaults and checks none | #47.1597fbec, #47.59eef887, #47.e19749bc Stop |
| Comparator ignores `from` | #47.827e6ab1 replay, #47.8ebea6b5 replay |
| Patch parser reads only unindented markers | #47.827e6ab1 replay, #47.fc65f49c whole replay, #47.fc36112e check, #47.13b96768 |
| Lifecycle checker reads only final states | #47.d948ef8c planted log |
| Check ignores replay failures | #47.13b96768 |
| `deep explain` prints the newest covered version (with two covered) | #47.9e03b1e8 |

The live tests weren't run: they spend plan usage and need parts that don't exist.

## Ambiguities and assumptions a redraft may revisit

- **The `/loop` iteration's origin.** The design lists the origins but doesn't say which one a `/loop` iteration gets. I pinned `scheduled`, since `/loop` schedules wake-ups and cron jobs. `continuation` is also a defensible reading.
- **"Opens no ask".** I read it as "stored with a `user.ask` whose `from` isn't `person` or `app`, and with no `ask.*` event", since the design opens an ask only for those two origins.
- **"Marks the session's events unverified".** I assert the drifted payload and its session read unverified, not that every other event in the session does.
- **The planted lifecycle log** assumes `ask.created` then `ask.defaulted` is a legal life (the clean twin), and that the checker reports the `ask.answered` move. A table that needs an `ask.shown` before a default would dispute the twin.
- **Uncovered sets.** The check isn't held to any verdict for a recorded set its facts don't cover yet. Only widening the range over a set is tested.
- **Size.** Apparent bytes, and `200 MB` = 200,000,000 bytes. A merge-base comparison of size isn't tested; only the limit is. The design's perf lane compares timings and memory, not file sizes.
- **Codex hook names.** I took Codex's required list from the design's mentions (SessionStart, UserPromptSubmit, PreToolUse, a permission request, PostToolUse, Stop). If Codex's permission hook has another name, its facts would list that, and a redraft should change the list.
- **Prompt and tool payload fields.** The tests assume Codex's PreToolUse carries a string `tool_input.command` for shell calls and Stop carries `stop_hook_active`, as the criteria imply. The drift criterion requires a recorded Claude Code Stop with `stop_hook_active`. A Codex one is used when the corpus has it.
- **Criterion 13's row fields** (`smokeTest`, `standingApprovals`, `withinReserve`, `job`) are mine. The design names the behaviors, not the fields.

## Not covered here

- The scope's usage-counting fixtures (subagents, a resume, `/compact`, a crash mid-turn) and the October 9 hook edge cases have no acceptance criterion, so nothing here checks them.
- Validating Codex payloads against openai/codex's published hook schemas (the issue's reference) has no criterion, and doing it would need a JSON Schema validator the repo doesn't have.
- `deep explain <session ID>` against the record, which needs #14 and #16.
