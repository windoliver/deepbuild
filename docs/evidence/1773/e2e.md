# #1773 by hand: a real Claude Code session, its `deepbuild` server and a real hub

Run on 2026-11-13 (PST) on the Linux dev box (the Spark), alongside other work on the machine. Each run used real Claude
Code 2.1.317 (`claude --allowedTools mcp__deepbuild --model haiku` in tmux) and a real `deep hub run`. Each ran in a
throwaway home set up by that tree's own `deep setup`, which wrote `deepbuild` and `deep-actions` into the home's
`~/.claude.json`. The setups didn't all get equally far. The fix turn run's setup finished: it wrote its wiki pages
with a model call, and its record starts with `setup.step` and `hub.stopped` rows. The base turn run's setup and both
listing runs' setups stopped after the hooks step and exited 3, on the systemd links described at the end. Every home
had the hooks, both server entries and `rules.json`. The script is [records/e2e.sh](records/e2e.sh), as it stood for
the listing runs; the turn runs used it without its `forge` lines. Nothing stands in for the hub, deep-hook, `deep mcp`
or Claude Code.

## The two trees

`main` on its own can't show criterion 1 with real calls. Main's `hookmap.ts` stamps only `mcp__deep__*`, so every
Claude Code `deep_*` call ends at once `unbound` (#1632). An earlier run of this branch, without #2092,
ended that way ([screens/main-unbound.txt](screens/main-unbound.txt)). It ran this worktree's own build, and its
deep-actions entry pointed at this worktree's `target/release/deep-hook`, not the binary below. Which build of the
branch it was can't be pinned, and nothing else here rests on it. It ran in `/tmp/e2e1773-Gwub/fix`, which was later
renamed `run1-fix-main`, so its screen shows `/tmp/e2e1773-Gwub/fix/proj` like the fix turn's screens. Its session is
`7789fe46` in that folder's ledger. The screen's input box holds a draft, "retry the deep_ask call", that was never
sent: the ledger has one `user.ask`. So both sides below include #1632's open fix, PR #2092:

- **base:** `1b3990793501`, PR #2092's head at the time of the runs (it has moved on since), which already contains this PR's merge base `e0c90a5a`.
- **fix:** `52494ffcc0b3`, a local merge of `1b3990793501` with this branch at `4ada21d88`. That point holds this
  branch's one merge of main (d7d58862b) and its four commits for #1773: the two acceptance suites (0922d0aea,
  08f0eb8d2) and the two fixes (866422fec, 4ada21d88). It was never
  pushed. The merge was clean.

Both used the same deep-hook binary (sha256 `225b4227bc49aca8…`), built on 2026-11-09. It couldn't be rebuilt: main's
`crates/deep-contracts/src/generated.rs` defines `RULE_340` and `RULE_341` twice. That binary is older than the trees.
It doesn't accept the `no-delete-past-worktree` entry the trees' own `deep setup` writes into `rules.json` (added in
551b365a8 on 2026-11-09). So whenever the hub didn't answer within the hook's 50 ms, deep-hook refused the call, saying
"spooled …, but its sync didn't finish within the hook's 50 ms". In full: "DeepBuild blocked this: ~/.deepbuild/rules.json
has an entry no-delete-past-worktree that isn't a guard@1 entry, so deep-hook can't check its guards while the hub
doesn't answer. Fix that file, then retry.". deep-hook doesn't change in this PR.

Claude Code 2.1.317 is past the shipped facts (they stop at 2.1.308). So the hub ran with `DEEP_HUB_TEST_FACTS` set to
a copy of the facts widened to 2.1.317, made by the script.

## Criteria 2 and 4: tool lists at SessionStart

To give a list something to show, the script also registered a third-party stdio server, `forge`, in the home's
`~/.claude.json`. It is `tests/acceptance/1773/fixtures/server.mjs`, with one tool. Each side then started Claude Code
once, with no prompt, and the hub's record was read 40 s later ([records/listing.sh](records/listing.sh); the panes at that moment:
[records/base-list-pane.txt](records/base-list-pane.txt), [records/fix-list-pane.txt](records/fix-list-pane.txt)). The `forge`
lines in `e2e.sh` were added for these runs, after the turn runs below. In both, the session's start synced:
`session.rules_delivered` is at 2. That is what shows the start was verified and the listing ran.

| Side | `~/.claude.json` servers | `mcp.tools_listed` in the record |
|---|---|---|
| base ([records/base-list-events.txt](records/base-list-events.txt)) | deepbuild, deep-actions, forge | 3 `deepbuild`, 4 `deep-actions`, 5 `forge` |
| fix ([records/fix-list-events.txt](records/fix-list-events.txt)) | deepbuild, deep-actions, forge | 3 `forge` only |

The record notes a list, not a start. That the hub never started `deepbuild` or `deep-actions` itself rests on
`tests/acceptance/1773/lists.test.ts` and `tests/acceptance/1773-ac4/deep-actions.test.ts`, whose fixtures mark every
start.

## Criterion 1: a turn of `deep_*` calls

Each turn was asked to call `deep_ask` once and then `deep_wait` on that ask twice. Nobody answered the ask, so each
call ended after 40 s with the ask's status still `waiting`. `deep_claim`, the tool the criterion names, wasn't called. The
waits check skips by the server's prefix, `/^mcp__(?:deep|deepbuild)__/`, so every `mcp__deepbuild__deep_*` call goes
the same way. The calls' times are from the record (`tool.before` to `tool.after`,
[records/base-durations.txt](records/base-durations.txt), [records/fix-durations.txt](records/fix-durations.txt)).

**Base** ([screens/base-turn.png](screens/base-turn.png), [text](screens/base-turn.txt); every event is in
[records/base-events.txt](records/base-events.txt)):

- 16→21 `deep_ask` 40.2 s, then 22→23 `deep_wait` 40.0 s, with no overrun. `deep_wait` had no history yet, so the
  default of 60 s was expected.
- 24→28, the second `deep_wait`, 40.1 s. At 25 there is a `call.overrun` with `expected_ms` 40043 and `ran_ms` 40043:
  the first wait's time had entered the timing history and became the expectation. The readings follow: 26 "Call
  toolu_01XjVJuY… overran", and 27 "`mcp__deepbuild__deep_wait` ran 40 s, about 40 s was expected". The same line
  reached the chat as the PostToolUse reply on the screen.
- This run's home had no `forge`. Its `mcp.tools_listed` for `deepbuild` and `deep-actions` (3, 4) match the listing run
  above.

**Fix** (turn 1: [screens/fix-turn-1.png](screens/fix-turn-1.png), [text](screens/fix-turn-1.txt); turn 2:
[screens/fix-turn-2.png](screens/fix-turn-2.png), [text](screens/fix-turn-2.txt); every event is in
[records/fix-events.txt](records/fix-events.txt)):

- deep-hook's refusal, described above, hit the first `deep_ask` (13). The base turn's ToolSearch hit the same one.
  Haiku retried once. The retried `deep_ask` (15→20) ran 40.2 s and the one `deep_wait` (21→22) ran 40.0 s.
- So a second turn was sent to call `deep_wait` on the same ask twice more: 31→32 ran 40.0 s and 33→34 ran 40.1 s.
- In all, the fix had four 40 s `deep_*` calls, three of them `deep_wait`. There is no `call.overrun` and no reading
  naming a `deep_*` tool. The margin is thin, and this is the weaker half. History takes the median, and on base the
  overrun came from the second wait running 19 ms longer than the first (40063 vs 40044 ms). On the fix, had the waits
  entered history, the third wait (40055 ms against a median near 40036) was the one clear chance of an overrun, and
  the second (40037 vs 40035) a 2 ms one. The hub's history wasn't dumped, so "never added to the timing history" is
  inferred, not seen. The waits were live for these calls. In the fix
  transcript only SessionStart and the refused `deep_ask` were spooled, and turn 2's UserPromptSubmit got the hub's
  context, so the turn had begun as far as the hub was concerned. The absence is shown directly by
  `tests/acceptance/1773/waits.test.ts`, which announces the next call's
  expected time. The fix's two readings (27, 39) are the stop hold's ("This stop was held 59 s for ask:…").
- This run's SessionStart didn't sync (deep-hook's 50 ms again): the record has no `session.rules_delivered`. So its
  lack of `mcp.tools_listed` proves nothing. Criteria 2 and 4 rest on the listing runs above.

Every `records/*-events.txt` is a full dump of that run's ledger: `sqlite3 -readonly -header -separator ' | '
ledger.db "select log_pos, datetime(ts/1000,'unixepoch') as at_utc, session_id, writer, kind, data from events order by
log_pos"`. `listing.sh` reads the run folder from an `e2e-root` file beside it, holding the `mktemp -d /tmp/e2e1773-XXXX`
path. That file isn't committed, so recreate it to run the script. The script prints only a short summary of the
same rows.

## What this doesn't show

- Criterion 3 (`deep` for Codex and pi) was not run by hand. It rests on `tests/acceptance/1773/same.test.ts`.
- Both trees include PR #2092, which isn't merged. On main without it, Claude Code's `deep_*` calls never get far
  enough to be timed.
- The screens are `tmux capture-pane` text. Trailing blanks and repeated blank lines were trimmed, and the plan's name
  was replaced with `[plan]`. They were rendered to PNG with DejaVu Sans Mono, which has no `⎿` or `⏵` glyph and draws a box
  for each.
- Running `deep setup` with `HOME` pointed at a throwaway home still reached the real user's systemd manager. An attempt
  at 20:47, before the runs above, left two links in the real `~/.config/systemd/user`: `deepbuild-hub.service` and
  `default.target.wants/deepbuild-hub.service`, enabled. They point into `/tmp/e2e1773-Gwub/fix/home`. Their effect
  differed by run:
  - The setups that ran in `/tmp/e2e1773-Gwub/fix` reused them, so the user's systemd manager started that home's hub
    each time: 3016956 and 3081099 for the 20:47 attempt and its retry, 3328783 for the main-unbound run, and 3833452
    for the fix turn run. The first was stopped by hand with `kill -TERM` on its PID. The journal shows only its unit ending at 20:48:00. The script's setup logs record stopping 3328783 and 3833452. 3081099's run
    folder was overwritten and the journal has no stop line for it, so how it ended can't be shown. It was gone before
    the unit started again at 20:54:54.
  - The base turn run's setup exited 3 on "already exists".
  - Both listing runs' setups exited 3 on "deepbuild-hub.service is loaded from … another home's hub".

  The links are still there, and until they are removed, a hub for that throwaway home starts at the user's next
  login. The hub each run used was the one the script started, with the widened facts.
- The script stops setup's hub by searching for `main.js hub run` processes whose `HOME` is the run's throwaway home,
  then by PID. AGENTS.md says to stop only processes you started, by PID, never by name. Each process it stopped
  served only that throwaway home, but the search is by name, and those it stopped were started by systemd.
