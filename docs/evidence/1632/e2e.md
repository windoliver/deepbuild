# #1632 by hand: a real Claude Code process, its deep mcp and a real `/clear`

Runs 1–3 on 2026-11-08 and 4–5 on 2026-11-09, on the Linux dev box, with real Claude Code 2.1.317 (`claude --allowedTools mcp__deepbuild --model haiku`
in tmux) and a real `deep hub run` from this branch's build, both in a throwaway home (`/tmp/e2e1632-uA59/home`, set up
by this branch's `deep setup`: its hooks in that home's `~/.claude/settings.json`, its `deep mcp` in `~/.claude.json`).
The project was an empty git repo at `/tmp/e2e1632-uA59/proj`. Nothing stands in for the hub, deep-hook, `deep mcp` or
Claude Code. Session IDs are Claude Code's own random ones. The record excerpts below come from the hub's
`ledger.db` (`events`: log position, kind, session, writer, unverified flag, the data fields shown).

## Model turns (runs 4 and 5, 2026-11-09)

After the owner's usage-credits login on 2026-11-09 (the code pasted by the owner; nothing typed for them), real Haiku
turns ran. The hub ran with the widened facts of run 2 below. Each run: turn A calls `deep_status`, `deep_ask`,
`deep_claim`; then `/clear`; then turn B calls the same three and `deep_wait` on A's ask. About six credit turns were
used in all, three of them in run 4.

**Run 4, the branch as reviewed (e74660c3): after `/clear`, every session-bound call was refused.** Turn A worked
(bound by the deep mcp's hello). In turn B, `deep_status` said `"session":null`, and `deep_ask`, `deep_claim` and
`deep_wait` were each refused `unbound`, "no PreToolUse stamped for it is unspent"
([screens/run4-turn-b-before-fix.txt](screens/run4-turn-b-before-fix.txt)). The hub recorded B's PreToolUse hooks
verified, but kept no stamp: `deep setup` registers Claude Code's server as `deepbuild`, so Claude Code names the tools
`mcp__deepbuild__deep_*`, while the hook map has stamped only `mcp__deep__*` (the name Codex and pi use) since #16. The
fixture suites all send `mcp__deep__*`, which is why they passed. Fixed in `packages/hub/src/hookmap.ts`. Regression test:
`mcp-rebind.test.ts`, "binds a call after /clear by the stamp of its tool as Claude Code names it from the server deep
setup registers, deepbuild", which failed before the fix with the same refusal.

**Run 5, with the fix: the new session's calls act for it, and nothing goes to the old ID.** The `deep mcp` process
(started with Claude Code at 01:03:06) outlived `/clear`. Turn A: [screens/run5-turn-a.png](screens/run5-turn-a.png)
([text](screens/run5-turn-a.txt)). Turn B: [screens/run5-turn-b.png](screens/run5-turn-b.png)
([text](screens/run5-turn-b.txt)). B's `deep_status`, `deep_ask` and `deep_claim` act for B. B's `deep_wait` on A's ask
is refused `not_found` ("Wait on an ask this session raised"), so A's answer never reaches B. The record:

```text
9   session.start  a861b175…  hook  unverified=0  {"thread": "a861b175…"}
24  tool.before    a861b175…  hook  unverified=0  {"tool": "deep_ask", "kind": "mcp"}
25  ask.created    a861b175…  mcp:a861b175…  unverified=0  {"question": "E2E1632 run 5 turn A: which header color?"}
29  claim.made     a861b175…  mcp:a861b175…  unverified=0  {"task_ref": "task:01K74G0A1B2C3D4E5F6G7H8J11"}
36  session.end    a861b175…  hook  unverified=0  {"reason": "clear"}
38  session.start  ca074ffe…  hook  unverified=0  {"thread": "a861b175…"}
48  tool.before    ca074ffe…  hook  unverified=0  {"tool": "deep_ask", "kind": "mcp"}
49  ask.created    ca074ffe…  mcp:ca074ffe…  unverified=0  {"question": "E2E1632 run 5 turn B: which footer color?"}
52  tool.before    ca074ffe…  hook  unverified=0  {"tool": "deep_claim", "kind": "mcp"}
53  claim.made     ca074ffe…  mcp:ca074ffe…  unverified=0  {"task_ref": "task:01K74G0A1B2C3D4E5F6G7H8J12"}
55  tool.before    ca074ffe…  hook  unverified=0  {"tool": "deep_wait", "kind": "mcp"}
```

Not covered by this run: Claude Code 2.1.317 as shipped is past the facts (run 1), so without the widened facts its
PreToolUse is unverified, no stamp is kept, and the calls after `/clear` are refused rather than misfiled. That waits on the
live smoke test widening the facts.

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
