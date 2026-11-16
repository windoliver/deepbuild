# #1632 by hand: a real Claude Code process, its deep mcp and a real `/clear`

Runs 1–3 on 2026-11-08, run 4 from 2026-11-08 21:57 to 2026-11-09 01:00 PST, and run 5 on 2026-11-09, on the Linux dev box, with real Claude Code 2.1.317 (`claude --allowedTools mcp__deepbuild --model haiku`
in tmux) and a real `deep hub run` from this branch's build, both in a throwaway home (`/tmp/e2e1632-uA59/home`, set up
by this branch's `deep setup`: its hooks in that home's `~/.claude/settings.json`, its `deep mcp` in `~/.claude.json`).
The project was an empty git repo at `/tmp/e2e1632-uA59/proj`. Nothing stands in for the hub, deep-hook, `deep mcp` or
Claude Code. Session IDs are Claude Code's own random ones. The record excerpts below come from the hub's
`ledger.db` (`events`: log position, kind, session, writer, unverified flag, the data fields shown).

## Model turns (runs 4 and 5, 2026-11-08/09)

After the owner's usage-credits login on 2026-11-09 (the code pasted by the owner, nothing typed for them; stated here, not in the record), real Haiku
turns ran on Claude Code 2.1.317, the `claude` on the dev box's own PATH, started by [records/e2e.sh](records/e2e.sh)
with `DISABLE_AUTOUPDATER=1`; every session transcript in the throwaway home records `"version":"2.1.317"`
([records/run5-procs.txt](records/run5-procs.txt) lists them). The same script started the hub with
`DEEP_HUB_TEST_FACTS`, the widened facts of run 2 below. Each run: turn A calls `deep_status`, `deep_ask`, `deep_claim`; then `/clear`; then turn B calls the same three
and `deep_wait` on A's ask. The record has six `agent.stop` events: four in run 4 and two in run 5. Five were Haiku turns (run
4's Stop-hook follow-up, turn A and turn B; run 5's turns A and B). The sixth, a "Reply with OK" probe on 2026-11-08 at
21:58 PST before the login, never reached the model: it stopped `rate_limited` (positions 17–18). That the follow-up was a Haiku
turn (the record has no `turn.usage` for it, unlike turns A and B at 39 and 67) and that the probe got only a synthetic "weekly limit" message come from
Claude Code's transcript of A (`/tmp/e2e1632-uA59/home/.claude/projects/…/c1e59276-….jsonl`), which is not in the
repo.

Every event of each run's ledger, in log order, is in [records/run4-events.txt](records/run4-events.txt) and
[records/run5-events.txt](records/run5-events.txt) (read with `sqlite3 -readonly` from the run's saved `ledger.db`; all
rows, with the columns the header names; nothing redacted, as the ledgers hold no home paths). The excerpts below cite their log positions.

**Run 4, the branch as reviewed (e74660c3 plus the evidence-only commit 3a247671; the built bytes were not hashed, so
that the build matched that commit is not proven): after `/clear`, every session-bound call was refused.** Turn A worked: its `deep_ask` and `deep_claim` were recorded under A, `c1e59276` (positions 31–37:
`ask.created` with id `01M6ZRJW09G64JX7Z5S8SAZ338`, the ask ID B's prompt cites, and `claim.made`, both written by
`mcp:c1e59276…`). No pane capture of turn A was kept (the only run 4 capture, taken after turn B, starts at the banner and `/clear`). In turn B (`05f51489`,
started at 45 on A's thread), `deep_status` said `"session":null`, and `deep_ask`, `deep_claim` and `deep_wait` were each
refused `unbound`, "no PreToolUse stamped for it is unspent"
([screens/run4-turn-b-before-fix.txt](screens/run4-turn-b-before-fix.txt); the untrimmed capture, with the banner and the
`❯ /clear` line before B's prompt, is [records/run4-pane-full.txt](records/run4-pane-full.txt), the plan name redacted). The record shows B's PreToolUse hooks
verified (`tool.before`, `unverified=0`, at 53, 55, 57 and 64, each naming `"server":"deepbuild"`), each call's
`tool.after` `failed` (56, 58, 65), and no `ask.created` or `claim.made` by the mcp after 37. The stamp itself lives in
the hub's memory, not the record; the refusal is what shows none was kept. The cause: `deep setup` registers Claude
Code's server as `deepbuild`, so Claude Code names the tools `mcp__deepbuild__deep_*`, while the hook map has stamped
only `mcp__deep__*` (the name Codex and pi use) since #16. The fixture suites all send `mcp__deep__*`, which is why they
passed. Fixed in `packages/hub/src/hookmap.ts`. Regression test: `mcp-rebind.test.ts`, "binds a call after /clear by the
stamp of its tool as Claude Code names it from the server deep setup registers, deepbuild", which failed before the fix
with the same refusal (run at 01:01:54, before run 5: [records/regression-before-fix.txt](records/regression-before-fix.txt)).

**Run 5, with the fix: the new session's calls act for it, and nothing goes to the old ID.** The tree was run 4's with
the hook-map fix and its regression test uncommitted. They were committed at 01:38 as 447d7035, later squashed into
84e67aa8 on the new branch (whose `hookmap.ts` also gains main's `adapterOf`; the stamp line is the same). The built
bytes were not hashed at run time, so that the committed fix is exactly what ran is not proven. The `deep mcp` process
outlived `/clear`: at 01:03:50, after the clear (36, 09:03:45Z) and before B's prompt (43, 09:03:51Z), Claude Code
(PID 3311182) still had the node child it started at 01:03:06 (PID 3311397). `ps` cuts that child's command line; the
`deepbuild` entry in the throwaway home's `.claude.json` is the only node server Claude Code starts, `node
~/deepbuild/…/packages/cli/dist/main.js mcp` ([records/run5-procs.txt](records/run5-procs.txt)). Turn A: [screens/run5-turn-a.png](screens/run5-turn-a.png)
([text](screens/run5-turn-a.txt)). Turn B: [screens/run5-turn-b.png](screens/run5-turn-b.png)
([text](screens/run5-turn-b.txt)). In the record (full IDs):

- 9: `session.start a861b175-deb7-4f7f-84e7-f97f0bd152b8` (A). 25: A's `ask.created`, id `01M6ZRRQWAMDCCDVQH7DHZ5703`,
  writer `mcp:a861b175…`. 29: A's `claim.made`, task `…J11`. 36: `session.end` A, reason `clear`.
- 38: `session.start ca074ffe-2364-4a19-a4ca-f8a7b789be15` (B), thread `a861b175…`.
- 49: B's `ask.created`, id `01M6ZRSHE6439686CQRDQY1W14` (the ask ID turn B's screen shows), writer `mcp:ca074ffe…`.
  53: B's `claim.made`, task `…J12`, writer `mcp:ca074ffe…`. 55–56: B's `deep_wait` on A's ask, `tool.after` `failed`
  (`tool_error`); the screen shows the refusal `not_found`, "Wait on an ask this session raised".
- After 36, no event has session `a861b175…` or an `mcp:a861b175…` writer. The only later events naming it are 37
  (the archive extension's `transcript.archived` of A's transcript) and 38 (B's start, which names it as the thread).

So B's `deep_status`, `deep_ask` and `deep_claim` act for B, and B cannot wait on A's ask. A's ask was not answered in
this run (it stayed open, provisional), so the run shows B refused the wait, not an answer withheld from B; the answer
case is covered by `tests/acceptance/1632/redraft-ac2`.

How the screens were made: the `.txt` files are `tmux capture-pane -p` of the Claude Code pane after each turn, trimmed:
blank lines, the startup banner, the `❯ /clear` line, the input box's rules and the status line were removed, and the
lines kept are unaltered. Only run 4's untrimmed capture was kept (above); run 5's originals were not, so their trimming cannot be
checked, and turn A's text also lacks the empty `❯` input line the others keep and has two plain spaces where the
others have a space and a no-break space after `⎿`. The `.png` files
are the trimmed texts rendered with PIL in a monospace font (no window screenshot was possible in the headless tmux).
The rendering colours prompts blue, JSON green and errors orange; the font lacks U+23BF, so the mark before "Stop says:"
renders as a box, and draws "✻" as "*".

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
