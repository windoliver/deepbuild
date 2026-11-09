# #1632 by hand: a real Claude Code process, its deep mcp and a real `/clear`

Run 2026-11-08 on the Linux dev box, with real Claude Code 2.1.317 (`claude --allowedTools mcp__deepbuild --model haiku`
in tmux) and a real `deep hub run` from this branch's build, both in a throwaway home (`/tmp/e2e1632-uA59/home`, set up
by this branch's `deep setup`: its hooks in that home's `~/.claude/settings.json`, its `deep mcp` in `~/.claude.json`).
The project was an empty git repo at `/tmp/e2e1632-uA59/proj`. Nothing stands in for the hub, deep-hook, `deep mcp` or
Claude Code. Session IDs are Claude Code's own random ones. The record excerpts below come from the hub's
`ledger.db` (`events`: log position, kind, session, writer, unverified flag, the data fields shown).

## What was not run

**No model turn ran**, so no `deep_ask` or `deep_claim` reached the hub through Claude Code. The account had hit its
weekly limit, which resets Nov 10, 12am PT. Every prompt, Haiku included, was answered "You've hit your weekly limit",
and switching to usage credits asked for a new sign-in that couldn't be finished from this box. The owner chose to skip
the model-turn run. A retry at 21:54 PT with fresh credentials got the same answer, and the switch again asked for a new
login. The calls after `/clear` are proven by the fixture suites
instead (`tests/acceptance/1632/`, `packages/hub/test/mcp-rebind.test.ts`), which run the real deep-hook, hub and
`deep mcp` on Claude Code's payloads.

## Run 1: Claude Code 2.1.317 as shipped (past the adapter's facts)

`adapters/claude-code.facts.json` covers Claude Code up to 2.1.308. On 2.1.317 the hub records the session watch-only.
SessionStart is checked and verified. Every later hook is recorded unverified, and that includes the SessionEnd of
`/clear`, so the old ID never ends in the hub.

```text
1  session.start  27675be9-…  hook  unverified=0  {"thread": "27675be9-…", "agent": "claude-code"}
6  session.reading 27675be9-… core  unverified=0  "This session runs claude-code 2.1.317, past the versions its facts cover: it is recorded unverified, …"
7  user.ask       27675be9-…  hook  unverified=1
15 session.end    27675be9-…  hook  unverified=1  {"reason": "clear"}
17 session.start  42116983-…  hook  unverified=0  {"thread": "27675be9-…", "agent": "claude-code"}
```

On the commit before fc172646, rotation was read from that SessionEnd. Here the deep mcp would have gone on acting for
`27675be9` after the clear, so the new session's calls would have been recorded under the old ID. That is why rotation
is now read from the new ID's start: `42116983` is live, in the same process (PID and start time), on `27675be9`'s
thread. Regression test: `mcp-rebind.test.ts`, "never acts for the old ID once a new one starts on its thread in its
process, though the old one's SessionEnd never came". On this version the hub keeps no PreToolUse stamp (watch-only),
so after the clear a session-bound call is refused. It is never recorded under the old ID.

## Run 2: the same, with 2.1.317 inside the facts' range

The hub was started with `DEEP_HUB_TEST_FACTS=<copy of adapters/*.facts.json with 2.1.317 added>`. That is the
test-only seam for a range the live smoke test has widened, and nothing else changed. The SessionEnd of `/clear` is now
verified:

```text
3  session.start  557dca5e-…  hook  unverified=0  {"thread": "557dca5e-…", "agent": "claude-code", "worktree": "/tmp/e2e1632-uA59/proj"}
6  mcp.tools_listed 557dca5e-… core unverified=0
8  session.end    557dca5e-…  hook  unverified=0  {"reason": "clear"}
9  session.start  f6535c2c-…  hook  unverified=0  {"thread": "557dca5e-…", "agent": "claude-code", "worktree": "/tmp/e2e1632-uA59/proj"}
12 mcp.tools_listed f6535c2c-… core unverified=0
```

Claude Code's processes after the `/clear`: the `deep mcp` it started at launch is still the same process, so it is
still bound by its hello to the first session.

```text
claude pid 686354, started 13:38:06: claude --allowedTools mcp__deepbuild --model haiku
  686471 (ppid 686354), started 13:38:07: node …/packages/cli/dist/main.js mcp
  686472 (ppid 686354), started 13:38:07: …/target/debug/deep-hook mcp actions
```

So the case the fix handles exists in real use: one `deep mcp` process outlives the `/clear`. The hub records the
rotation as `SessionEnd clear` for the old ID, then a start in the same process joined to the old ID's thread.
