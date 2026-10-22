# AC3 blind redraft: cut at every durable write point, then restart

Test: `crash-redraft.test.ts`, one `describe` ("AC3 #16.dcb0bc5f cut at every durable write point of a 200-event
scenario, then restart (redraft)") with one `it` holding the whole scenario. The ID is the first 8 hex of the
SHA-256 of the criterion's text (checked: `dcb0bc5f`).

The criterion: "Cut at each durable write point the storage interface numbers in a scripted 200-event scenario,
every restart keeps every FULL commit, no ID twice, no `log_pos` reused and every spooled event once, with
projections equal to their rebuild. A check run in flight records `stopped`, cause hub restarted, and its claim's
checks run again."

## What I read

- Issue #16 with its comment (`gh issue view 16 --repo windoliver/deepbuild --comments`).
- `docs/technical-design.md` at `4f6dec5` (`git show`): "One event log, with tables built from it", "Hook protocol
  (deep-hook and the hub)" (the spool), and in "How we know version 0 works": Fault injection, Wrong programs and
  Dogfooding.
- In this checkout: `packages/record/src/{index,projections,storage}.ts` (the public entry: `openRecord`, `read`,
  `table`, `rebuild`, `close`, `toJson`, `PROJECTIONS`, and what `start()` does on open after a clean or an unclean
  stop); `packages/contracts/schemas/{run.started,run.finished,claim.made,verdict.made,hook.request}@1.json`;
  `tests/acceptance/14/{AC6-REDRAFT.md,helpers.ts}` (the table comparison) and the start of
  `tests/acceptance/311/features.test.ts` (house style).
- The read-only copies of this suite's `README.md`, `helpers.ts`, `tsconfig.json` and `fixtures/` (copied here
  unchanged). Nothing of `packages/hub`, no other worktree, branch or PR, and not the suite's own `crash.test.ts`.

The checkout's HEAD is `c9891b3`, not `4f6dec5`; I read the design at `4f6dec5` as instructed and the record from
the checkout, which is what the test imports.

## The scenario

Every pass runs the same script in a fresh temp home, against `deep hub run` on `$HOME/.deepbuild`:

| Step | What | Scripted events |
|---|---|---|
| before start | spool A: `spool/a1.jsonl`, `spool/a2.jsonl`, 10 hook.request@1 lines each | 20 |
| 1 | the hub replays spool A; wait until all 20 are readable | |
| 2 | an agent stand-in's session (SessionStart, UserPromptSubmit, PreToolUse from its children), its `deep mcp`, `deep_claim` | 3 + 1 |
| 3 | 40 hooks over three sessions, in groups of 10 | 40 |
| 4 | `test.load {verdicts: 3}`: three `verdict.made`, each its own FULL commit | 3 |
| 5 | `run.start` of `fixtures/sleeper.mjs` for the claim (check `acceptance16.ac3.sleeper`): a run that stays in flight 30 s | 1 |
| 6 | `evidence.paste` of a PNG (the evidence store's rename) | |
| 7 | 60 hooks | 60 |
| 8 | spool B: `spool/b1.jsonl`, 10 lines, written while the hub runs (replayed at the next start) | 10 |
| 9 | `test.load {verdicts: 3}` | 3 |
| 10 | 59 hooks | 59 |

200 events in all; the test asserts the sum. Each step waits until its events are readable through `events.read`
before the next, and those reads are the consumer whose positions the `log_pos` clause is checked against.

1. **Reference pass**: the script under `DEEP_HUB_TEST_VFS {points}` with no cut. Once the points file stops
   growing for 1.5 s (at most 10 s) its length is P; the hub is then killed.
2. **For N = 1 … P**: a fresh home, the same script under `{points, cutAfter: N}`. The hub may end before it is
   ready (a cut during start or spool replay) or at any step; the script stops there. A pass whose hub never
   reaches point N (still running 6.5 s after the script's end) is killed and run again, three tries in all.
3. **Restart**: `deep hub run` on the same root with no test VFS, so it reads only what was synced. The test
   polls `events.read` (up to 20 s) until every spooled request is in and, for each run in flight at the cut, a
   `run.finished` and a new `run.started` are in; then checks the clauses below on that log.
4. **Projections**: the restarted hub is stopped with SIGTERM; `ledger.db` and its WAL are copied into a scratch
   folder and opened with `@deepbuild/record`; every table in `PROJECTIONS` is read, `rebuild()` runs, every table
   is read again and compared row by row in primary-key order, values as stored.
5. Each pass's sleepers (by the PIDs they wrote) and every process the pass started are stopped by PID, and its
   temp folders removed.

## Assertions, the sentence each comes from, and the wrong program each catches

| # | Assertion | Source | Wrong program it catches |
|---|---|---|---|
| 1 | The script holds 200 events | "a scripted 200-event scenario" | A test that drifts from the criterion's size |
| 2 | Reference: points numbered 1, 2, 3 … in order; each kind is one the README names; each commit has `mode` `full` or `normal` and an `ids` array | "each durable write point the storage interface numbers"; design: "The storage interface numbers every durable write point: each commit, `log_pos` block, spool read and removal, evidence rename and `rules.json` rewrite" | A storage interface that doesn't number its writes, or numbers some out of order or twice, so a cut "after point N" means nothing |
| 3 | Reference: the script reaches a FULL commit, a NORMAL commit, a `log_pos` block, a spool read, a spool removal and an evidence rename | Same sentence, the design's list | A storage interface that skips a kind of durable write (the cut suite would then never cut there) |
| 4 | Reference: every event `events.read` served was written by a numbered commit point (its ID in some commit's `ids`) | "the storage interface numbers" each durable write | A hub that writes events outside the numbered path, so cuts never reach them and assertion 6 checks nothing |
| 5 | Reference: six `verdict.made` read; 162 hooks acknowledged and 30 spooled | The script's FULL commits and hooks exist | A scenario that silently ran short (the clauses below would hold vacuously) |
| 6 | Each cut: the hub ended right after point N (its points file is exactly 1 … N) | "Cut at each durable write point" | A hub that crashes on its own before N, or a VFS that doesn't cut where asked; a pass that never reaches N after three tries fails, naming N |
| 7 | Every ID in a FULL commit point the cut process made is in the restarted hub's log | "every restart keeps every FULL commit"; design: "every FULL commit is kept" | A hub that commits verdicts (or a spool replay) with NORMAL, or acknowledges a FULL write before its sync |
| 8 | No event ID appears twice in the log | "no ID twice" | A replay that appends an event already in the log (where the store doesn't enforce the key) |
| 9 | `log_pos` strictly grows through the log; a position the consumer read before the cut holds the same event after the restart or nothing; no event sits at a position at or below the last one read before the cut unless it was read there; an event read before the cut keeps its position | "no `log_pos` reused"; design: "a power cut can skip log positions but never hands one out twice … a gap a consumer sees never fills later" | A hub that hands out positions from an unrecorded counter or recounts from max(log_pos) at start, so an event lost in the cut has its position given to another |
| 10 | Each request written to the spool before the hub ended is in the log exactly once by its ID, and no other event of its kind carries its `seq` | "every spooled event once"; design: "a replayed event keeps both [ID and seq], and the hub appends each ID once"; "removes a spool file only once every event it held is in a `synchronous=FULL` commit" | A hub that removes a spool file before its events are FULL (lost: 0 times), or replays a spool under fresh IDs or twice (2 times) |
| 11 | Every listed projection equals its rebuild on the restarted hub's ledger, row by row | "with projections equal to their rebuild"; design: "every projection equals its rebuild" | A hub that keeps a projection apart from the commit that writes its events, or re-applies a replayed spool event to a projection, so live tables and the log disagree after the cut |
| 12 | For each `run.started` of the check committed before the cut with no `run.finished` committed before it: exactly one `run.finished` after the restart, `outcome` `stopped`, a finding matching "hub restarted" | "A check run in flight records `stopped`, cause hub restarted"; design: "a check run that was in flight records `stopped`, cause hub restarted" | A hub that forgets runs in flight at a crash (no finish), records them `failed` or with no cause, or records the stop twice |
| 13 | …and a new `run.started` with a new run ID for the same check and the same claim | "and its claim's checks run again" | A hub that records the stop but never runs the claim's check again |
| 14 | Some cut came while the check run was durably in flight (12–13 ran at least once) | The second sentence must be exercised | A scenario whose cuts never land inside the run, so 12–13 hold vacuously |
| 15 | A cut right after a NORMAL commit: none of that commit's IDs (spooled ones aside, which the spool brings back) is in the restarted log; and at least one cut proved such a loss | Design: "It proves itself by losing a commit made with `synchronous=NORMAL`" | A test VFS that syncs everything (every assertion above would pass on a hub with no durability rules at all) |

Assertions 7–13 and 15 are collected as a list of problems per pass and asserted empty, so a failing pass names
every clause it broke, with the IDs and positions.

## Readings where the issue left a choice

- **Pre-cut events are known from the points file.** An event was committed by the cut process iff its ID is in
  one of that process's commit points' `ids`. That decides which runs were in flight (assertion 12), not the
  `run.start` reply, which a cut can lose after the commit.
- **The `log_pos` clause is checked against a consumer.** Positions are unique in one SQLite log by its own key,
  so "reused" only means something across the cut: what a reader saw before against what the log says after.
  The script's own `events.read` polls are that reader.
- **"Once" for a spooled event** is by its ID and, against a replay that re-mints IDs, by its `seq` among events
  of the same kind. The `seq` check is limited to spooled requests and to their own event's kind, since a hub
  may write other events about the same hook.
- **Spool B** is written mid-script, as deep-hook spools a call it couldn't wait for, so some cuts have spool
  files the first hub never replayed. If a hub replays the spool only at start, B arrives at the restart; if it
  also watches the folder, either way B must be in once.
- **The restart runs without the test VFS**: the files under the root are the durable image the VFS left, and a
  real start reads them. `test.load` is not needed after the restart.
- **Projections are compared on a copy after a clean stop.** The record's public entry compares tables only
  through `openRecord` (`table`, `rebuild`), which can't share the running hub's writer, so the restarted hub is
  stopped with SIGTERM first and the copy is opened. Opening runs the record's `start()`; after a clean stop it
  only writes its meta row. A projection the hub got wrong during recovery stays wrong in the file, so the
  comparison still sees it.
- **`run.start`'s `claim`** is passed as the handle `claim:<deep_claim's event ID>`, the form `run.started@1`'s
  `data.claim` takes; claims and runs are compared with the scheme prefix stripped.
- **Out of scope here**: the design's other crash-suite passes (each write failing in turn, a torn last write),
  evidence files matching their hashes, and lost-event claims read INVALID belong to the design's crash suite,
  not this criterion. `rules_rewrite` is a point kind, but nothing in the socket surface rewrites `rules.json`, so
  the script isn't required to reach it (a cut lands on it if the hub makes one).

## Probes at the base (throwaway, outside the repo)

The block between `// checks begin` and `// checks end` (point and log checks, the projection comparison) was
copied verbatim into a throwaway Vitest file placed beside the suite only for the run (so it imported
`../../../packages/record/src/index.ts` and `./helpers.ts` exactly as the test does), run, and removed:

- A real record (`openRecord`, file storage) with a session start, 12 `tool.before` from a `hook` connection, a
  `claim.made` from `mcp:<session>`, a core `run.started`, and a `verdict.made` (built from the contracts' fixture;
  a hand-made one is refused for missing `key`). Its events read through `read` and `toJson` plus `verified`, the
  shape `events.read` serves: `log_pos` a number, `seq` a decimal string, `data.run`/`data.check`/`data.claim`
  as written. A simulated restart appended `run.finished {outcome: stopped, findings: ["hub restarted"]}` and a new
  `run.started` for the same claim. `restartProblems` returned `{problems: [], inFlight: 1, lostNormal: 2}`.
- On the same log, each wrong case was named: a FULL commit's ID missing; a position read before the cut holding
  another ID; a gap below the last position read being filled; an ID twice (and the position not growing); a
  spooled request missing; a spooled request appended again under a new ID; a NORMAL commit at the cut kept; the
  run finished `failed`; no "hub restarted" finding; no `run.finished`; no new `run.started`.
- `projectionsAgainstRebuild`: undefined on a cleanly closed ledger (only `ledger.db` left); undefined on a
  ledger whose writer process killed itself with SIGKILL (`ledger.db`, `-wal` and `-shm` left; the copy took the
  database and WAL, and opening it ran the record's recovery); and a `claims.commit_sha` row tampered with
  better-sqlite3 was named: `claims: row "01M5G61YR6ASASQACPC90JMP53" column commit_sha: live "tampered", rebuilt
  "4f6dec5…"`.

What no probe could check: anything of a running hub. The pass timing is not measured, since the base has no hub;
the README's estimate is three to four seconds a point, and the test's ceiling is 45 minutes.

## Type check

```
node node_modules/typescript/bin/tsc -p tests/acceptance/16/tsconfig.json
```

No errors (with `helpers.ts` and `fixtures/` copied unchanged).

## Run on the base

Node v24.22.0, `npm ci`, `npm run build --workspaces` (all seven workspaces built on the first run), then
`node node_modules/vitest/vitest.mjs run --root tests/acceptance/16 crash-redraft`, exit 1:

```
 RUN  v5.0.5 ~/dev/claude-worktrees/github-issue-16-acaf52/agent-ac64a95cdc6e3a7a3/tests/acceptance/16

 ❯ crash-redraft.test.ts (1 test | 1 failed) 232ms
   ❯ AC3 #16.dcb0bc5f cut at every durable write point of a 200-event scenario, then restart (redraft) (1)
     × AC3 the reference pass numbers the points; a cut after each, and a restart, keeps FULL commits, IDs and log_pos once, spooled events once, projections equal to their rebuild, and stops and reruns the in-flight check 172ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  crash-redraft.test.ts > AC3 #16.dcb0bc5f cut at every durable write point of a 200-event scenario, then restart (redraft) > AC3 the reference pass numbers the points; a cut after each, and a restart, keeps FULL commits, IDs and log_pos once, spooled events once, projections equal to their rebuild, and stops and reruns the in-flight check
Error: BLOCKED: the hub didn't start (deep hub run): exit {"code":2,"signal":null}; stderr: Unsupported command. Run deep --help for available commands.

 ❯ startHub helpers.ts:249:11

 ❯ crash-redraft.test.ts:376:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  14:33:09
   Duration  648ms (tests 45%, import 34%, transform 21%, worker 1%)
```

It fails at the reference pass's first `deep hub run`: the base CLI has no `hub` command. That is the expected
reason. No `/tmp/dh16-*` folder was left, and the Vitest cache under `tests/acceptance/16/node_modules/` was removed.
