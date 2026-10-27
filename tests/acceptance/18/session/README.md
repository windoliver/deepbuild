# Acceptance tests for #18, the session criteria: version range, `deep mcp` binding, skill digests, briefing

Written first, blind, from issue #18 ("Claude Code adapter, watch-only: sessions, tool calls and commits"; its text
as of October 26, 2026: Scope, the 24 checkbox criteria, Proof, References, Depends on, "Added Oct 9" and "Done
when"), the design sections it links (What each agent gives us, Hooks are evidence not a state machine, Before each
command, Socket roles and contract versions, Numbers version 0 has to hold, How we know version 0 works, Ask) and
those around them, the suites of #16, #26, #315, #316 and #349 for the surfaces they define, and base commit
`14561af` (origin/main), by a job that never saw an implementation of #18. The implementing agent does not edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 24 criteria, AC1 to AC24 in the body's order. **This folder covers AC5, AC9, AC10 and AC20.** Three
other blind jobs cover the rest in `tests/acceptance/18/mapping/`, `install/` and `kit/`; nothing here tests theirs.

## How to run

With Node 24.22 (the repo's `.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci && npm run build --workspaces     # once: the tests run the built CLI, packages/cli/dist/main.js
cargo build --locked -q -p deep-hook     # the files also build it in beforeAll; warming it first avoids a timeout under load
npx vitest run --root tests/acceptance/18/session --no-file-parallelism
npx tsc -p tests/acceptance/18/session/tsconfig.json
```

- Each test makes its own folders under `/tmp/dh18s-*` (a socket path must fit in 104 bytes on macOS), runs every
  process with `HOME` there, so the hub's root is `<home>/.deepbuild` and Claude Code's folders are
  `<home>/.claude`, and never touches your real `~/.deepbuild`, `~/.claude` or `~/.codex`. It stops only processes
  it started, by PID (`helpers.ts`, `cleanup`). Each test starts a hub of its own, so the folder belongs on the
  unit lane's one-at-a-time list in `scripts/lanes.mjs` with #16's and #26's suites (the implementer adds it).
- No network, no model, no `claude` binary. There is no live file: see [Not tested here](#not-tested-here).

## The surface under test

Only these, each already public at the base or defined below:

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs a hook entry's command: `deep-hook claude-code
  <event>` with the hook's JSON on stdin and `HOME` the test's. What Claude Code makes of its output is read as #316's
  suite reads it: exit 2, or a `permissionDecision`/`decision` of `deny` or `block`, blocks a tool call; exit 0
  without one lets it run.
- **Hook payloads** shaped like the corpus's Claude Code payloads (`adapters/corpus/claude-code/`, the facts' strict
  payload schema of the newest covered version), with a **transcript** at `<home>/.claude/projects/<cwd with each
  non-alphanumeric character as ->/<session>.jsonl`, entries shaped like the corpus transcripts'.
- **`deep hub run`** and its socket as `tests/acceptance/16/README.md` defines it: `events.read` on a `cli`
  connection (each event's JSON with `session` and `verified`), and the `mcp` hello.
- **`deep mcp`**, spoken to as an MCP client speaks it, with #26's tools (`deep_ask`, `deep_open_item`,
  `deep_search`, `deep_status`, `deep_claim`) and their argument shapes (`packages/hub/src/tools.ts` at the base).
- **Files**: `<home>/.deepbuild/rules.json` (guard@1 entries), `<home>/.deepbuild/wiki/*.md`,
  `<home>/.claude/skills/<name>/SKILL.md`, a worktree's `.deepbuild/done.yaml`, and the shipped
  `adapters/claude-code.facts.json`, read only.

### The session's version

The issue and the design say a session on a version the facts don't cover is recorded unverified, but not where
the hub learns a session's version: Claude Code's hook payloads carry none (the facts list no such field), and
`deep doctor`'s version is the binary on `PATH`, not a running session's (a desktop app session runs its own). The
one per-session record of it is the transcript: **every entry Claude Code writes carries `version`** (the corpus's
transcripts show it). So here **a session's version is the `version` of the newest entry in its transcript at the
time of the hook**, read whether or not the hub judged that entry before. The tests write each session's
transcript before its first hook, already holding an earlier turn (a user entry and an assistant entry), and the
AC5 sessions start with `source: "resume"`, as a resumed session does with such a transcript; each later turn's
entries are appended before its hooks, all stamped with the session's version. The covered version used is the
newest the shipped facts' `versions` list; "past its facts" is one patch after it (`pastFacts()`), so the tests
follow the facts as they grow.

### Seams (test-only settings)

Read from the environment of `deep hub run`; only tests set them.

| Variable | What it does |
|---|---|
| `DEEP_HUB_TEST_FACTS=<folder>` | *Defined here.* The hub's adapters read `<folder>/claude-code.facts.json` and `<folder>/codex.facts.json` in place of the checkout's `adapters/` files. AC5 uses it for "after the smoke test widens the range": the live smoke test, its diff and your approval end in a facts file whose range holds the new version, and the test hands the hub that file. The test's copy is the shipped file with the version added to `versions` and its `events.versions` entry a copy of the newest covered version's. The hub is restarted with it, so a hub that reads facts only at start passes. |
| `DEEP_HUB_PLANT=<name>` | The base's planted-program switch (#16, #26). AC9 uses `unbound-reads-all`, which the base hub already lists. |

## Readings where the issue and design leave a choice

### AC5: "holds turn watch-only", "gated again"

AC4 says every reply of this watch-only adapter carries no decision field, so "gated" can't mean an answered
permission prompt. The gate a hub already enforces at the base is a **guard entry in block mode**: deep-hook
matches the call against `rules.json` and the hub decides (design: Before each command; #316). The issue's Scope
says a session past its facts has "its holds and blocks go watch-only". So the test installs one entry,
`shell:echo <tag>-*`, mode `block`, `fail_closed: false` (a fail-closed entry is deep-hook's own floor, which holds
in every mode, as with `deep off`), and reads:

- **watch-only**: each matched Bash call of the uncovered session runs (deep-hook exit 0, no deny), and its Stop is
  let through at once (exit 0, no `decision`, no `continue: false`, under 20 s, far under the 60 s hold);
- **gated**: the same matched call of a session on a covered version is blocked, on the same hub right after the
  uncovered session (so watch-only is per session, not a hub-wide switch), and of the next session on the same
  version once the range is widened;
- **recorded, events unverified**: the uncovered session's `session.start`, `user.ask`, `tool.before`, `tool.after`
  and `agent.stop` are all in the log with `verified: false`, and the watch-only call is a `tool.before` naming its
  command; the covered sessions' are `verified` (not `false`);
- **health shows one reading**: exactly one `session.reading` of the uncovered session (the kind the base hub's
  readings of a session take, such as "hooks not reaching DeepBuild") whose data names the version, after two
  turns of hooks; none for the covered or widened sessions.

### AC9

The binding is #26's and exists at the base (see [Base](#base)). The #18 part is that it holds for Claude Code
sessions through the real deep-hook. The agent stand-in, `fixtures/agent.mjs`, starts each hook as its direct child
(Claude Code runs a hook entry's command so; a shell that execs the command leaves the same parent) and its one
`deep mcp` as its child. Its `deep_ask` is sent **without** a PreToolUse stamped for it, so only the binding by
parent process can file it under the session. "A process whose parent matches no session" is a `deep mcp` this
test process starts in the session's own worktree. It must: find the wiki page (a `wiki:` hit); find nothing
quoting the session's open item; get `session: null` and nothing naming the session from `deep_status`; have
`deep_ask` refused at once (an ask still waiting after 20 s counts as filed) with no `ask.created`; and have
`deep_claim` refused with no `claim.made`. And a connection presenting the agent's PID with a start time that
isn't its own (`{"hello": "mcp", "parent": {"pid": <agent>, "start": "Thu Jan  1 00:00:00 1970"}}`) is bound to
no session: answered role `mcp`, or refused, never `mcp:<session>`.

### AC10

"The second session's start event" is the one event of the session recorded for its SessionStart that carries the
digests of what it loads (the issue: "At SessionStart, one event with digests of the instruction files, skills,
hooks and MCP servers"); `session.start` itself or a kind of its own, the test doesn't mind, but exactly one event
of the session may carry skill digests. The skills are two user skills, `<home>/.claude/skills/<name>/SKILL.md`,
where Claude Code reads your skills from. A skill's digest is read from the event's data as either an object with a
field naming the skill (its name, or a path ending `skills/<name>` or `skills/<name>/SKILL.md`) and exactly one
digest field, or a key naming the skill whose value is a digest or an object with exactly one digest field. A
digest is 64 lower-case hex, optionally prefixed `sha256:`. Each skill gets one per session (the design: "a skill is
pinned to ... a digest of its files"; one digest of all skills together would not say which changed). The test
changes one skill's SKILL.md between the sessions and keeps the other: the changed one's digest differs and the
kept one's is equal, so a digest of the session or the clock fails.

### AC20

"The agent gets" is read as what deep-hook prints for SessionStart, which Claude Code adds to the session's context
(its hooks reference: `hookSpecificOutput.additionalContext` with `hookEventName: "SessionStart"`, or plain stdout,
on exit 0). "Active checks" are the checks the session's repo's `.deepbuild/done.yaml` names. "How to declare a
claim" is read as naming the `deep_claim` tool. "Short" is at most 2,000 characters (*limit chosen here*: about 500
tokens, far under Claude Code's 10,000-character cap on hook context; a briefing of two checks and one tool needs
far less). Two repos with different check names: each briefing names its own and none of the other's, so a fixed
text fails.

## Disputes

- **Where a session's version comes from** (AC5) is open in the issue and the design; this suite fixes it as the
  transcript's `version`, above. A fresh session's SessionStart (`startup`) can come before its transcript holds an
  entry; what the hub does with a version it can't read yet is not decided here (the AC5 sessions are resumes).
- **"Gated" in a watch-only adapter** (AC5 against AC4): read as the guard engine's blocks, above.
- **AC9 is already met at the base**, by #26. The test stays as the criterion's proof through deep-hook and Claude
  Code payloads, so a #18 change to the Claude Code mapping or the session registry that breaks the binding fails
  it.

## Criteria to tests

| Criterion | File | Test |
|---|---|---|
| AC5 #18.9702095f | `version.test.ts` | `AC5 #18.9702095f a session past its facts is recorded unverified, its blocks go watch-only with one health reading; after the range widens the next session is gated again` |
| AC9 #18.7f5b2ce8 | `binding.test.ts` | `AC9 #18.7f5b2ce8 deep_ask from a session's deep mcp is filed under it; a deep mcp whose parent matches no session reads the wiki only, and can't ask or claim` |
| AC9 #18.7f5b2ce8 | `binding.test.ts` | `AC9 #18.7f5b2ce8 (wrong program) a hub that shows a deep mcp bound to no session another session's open items fails, naming the item` |
| AC10 #18.e314a15a | `digests.test.ts` | `AC10 #18.e314a15a changing a skill between two sessions shows a different digest in the second session's start event` |
| AC20 #18.9a7f6c86 | `briefing.test.ts` | `AC20 #18.9a7f6c86 at session start the agent gets a short briefing of its repo's active checks and how to declare a claim` |

## Wrong programs

- **AC9, "a hub that shows it another session's open items"**: `DEEP_HUB_PLANT=unbound-reads-all`, already in the
  base hub's plant list (#26): an unbound `deep_search` reads every session's open items and verdicts. The
  implementer keeps it. The wrong-program test runs the whole scenario on it, set for the hub and for every `deep
  mcp`, and expects the scenario to fail with a message naming the open item's text and the session's ID.
- Since both AC9 tests pass at the base, the proof's before lane needs a planted twin for `#18.7f5b2ce8` in
  `tests/acceptance/18/twins.json` (outside this folder, so the implementer writes it): a twin folder whose
  `packages/hub/src/core.ts` reads every session's open items for a `deep_search` bound to no session, as the plant
  does, without the switch. The AC9 main test fails on it at the open-item assertion.
- AC5, AC10 and AC20 name no wrong program; the base is one for each (below).

## Base

Run once at `14561af`: see `BASE-FAILURE.txt` for the command, the result and why each test fails.

- AC5 fails at its first assertion: the base hub blocks the uncovered session's matched call (it maps every hook as
  the newest covered version and marks nothing unverified for its version).
- AC10 fails: the base `session.start` carries `agent`, `worktree`, `branch` and `thread`, no digests.
- AC20 fails: the base answers SessionStart with an empty reply, so deep-hook prints nothing.
- AC9: both tests pass at the base (above, Disputes), a control.

## Not tested here

- **A live Claude Code session.** None of these criteria needs the model, and a live session would have to sign in
  through your real `~/.claude`, where #18's hub rechecks and restores its own entries in `settings.json`: a test
  hub there could write your real settings. Whether Claude Code adds SessionStart context to the model's context is
  Claude Code's documented behavior, not tested live here.
- **The live smoke test itself** (running it, its diff, your approval): AC5 tests only its outcome, the widened
  range, through `DEEP_HUB_TEST_FACTS`.
- **"Hashed off the hub's event loop"** (AC10's Scope line): not observable through these surfaces; it belongs to
  the budgets criterion.

## Files

- `helpers.ts`: temp homes, the hub, the socket, deep-hook, sessions, transcripts, facts, `deep mcp` clients.
- `fixtures/agent.mjs`: the Claude Code stand-in for AC9.
- `version.test.ts` (AC5), `binding.test.ts` (AC9), `digests.test.ts` (AC10), `briefing.test.ts` (AC20).
- `BASE-FAILURE.txt`, `tsconfig.json`.
