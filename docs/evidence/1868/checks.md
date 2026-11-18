# Checks for #1868 at c0fbc0af6

Run on a Mac15,12 (M3, 16 GB, 8 cores), mains power, 2026-11-17. The Mac was never quiet: other sessions
loaded it (one-minute load 10 to 185 at the runs' starts) and its thermal state read "fair". So every timed
result below is a reading, `INCONCLUSIVE` by the timing rule, and none is a `PASS`.

## The acceptance tests, merge base (212f16d09) beside the change

| criterion | merge base | change |
|---|---|---|
| 1 `#1868.f34f3f9c` `canvas.user` `cells`, 200,000 readings and 5,000 asks against an empty record | 1657.3 ms against 541.9 ms, 3.06 times; all five runs over the limit by more than the margin | 366.6 ms against 365.9 ms, 1.00 times (limit 1.20); all five runs within the limit; `INCONCLUSIVE` only for thermal state and load (17 to 33) |
| 2 `#1868.a903f1c6` a later reading and an answered ask show in the next deep_show's world | fails for the planted program only (below) | passes (23.5 s, load 13) |
| 3 `#1868.bf84aa8b` deep_status, 10 claims, 200,000 run events against 1,000 | 2031.1 ms against 7.19 ms, 282.67 times; all five runs over | 1.76 ms against 1.59 ms, 1.10 times (limit 1.20); runs 1.92, 1.76, 1.84, 1.66, 1.55 ms against 2.10, 2.22, 1.59, 1.59, 1.34 ms, so neither all within nor all over; `INCONCLUSIVE` (load 42 to 49). An earlier run of the same code read 3.84 ms against 4.38 ms, 0.88 times |

The merge base's numbers are the blind job's, in `tests/acceptance/1868/BASE-FAILURE.txt`. On the change the
whole files took 96.6 s (`canvas-cells`) and 36.5 s (`status-runs`), so neither goes in the `slow` lane; an earlier
`canvas-cells` run at load 78 took 331 s.

**The planted stale world.** With `tests/acceptance/1868/twins/world-built-once/` laid over
`packages/hub/src/plant.ts` and the hub rebuilt, `world-fresh.test.ts` fails at the reading (load 11):

```
AssertionError: the reading reading:01M7P2THBEEY7NZY6CQMTH0BCZ (1 runs, "runs saved by carrying across sessions ..."),
recorded at log_pos 115 after the world was built, is not in the next deep_show's world: the deep_show that binds a
value to it was refused, ref_unresolved naming reading:01M7P2THBEEY7NZY6CQMTH0BCZ
```

## Query plans on a seeded record, before and after

| read | merge base | change |
|---|---|---|
| deep_status, a claim's runs | `SEARCH events USING INDEX events_kind (kind=?)` twice, temp B-tree | `SEARCH runs USING INDEX runs_0 (claim_id=?)` |
| world, asks | `SELECT` of every ask on every call | changed asks by primary key, only after an ask event |
| world, readings | every `reading.recorded` event on every call | `events_kind (kind=? AND log_pos>?)`, only after a reading |
| late hook | `SEARCH events USING INDEX events_kind (kind=?)` | `events_kind (kind=? AND log_pos>?)` from the event's position, found by ID |
| deep_claim, a task's ended sessions | two `events_kind (kind=?)` list subqueries over every claim and every session end | `claims_0 (subject_ref=?)` and `events_session_bounds (session_id=?)` |

## By hand: a real hub on a long record, and the app with a Terminal tab open

A scratch home under `/private/tmp`, never the real one. The record is seeded with 200,000 `reading.recorded`
events and 5,000 asks (210,250 events). A real `deep hub run` starts on it, a session's terminal is opened with a
hosted program that prints a grid, the debug build of deep-app is started on that hub, and the session's page is
opened with `deep open`, its Terminal tab left open for 30 seconds. The same script ran on the merge base's sources
(the nine changed files swapped back, record, hub and deep-show rebuilt) and on the change.

| | merge base | change |
|---|---|---|
| load at start (1, 5, 15 min) | 8.6, 30.7, 69.3 | 37.4, 78.9, 100.7 |
| `terminal.open` | opened | opened |
| first `canvas.user` call (builds the world, starts the canvas core) | 12,220 ms | 13,898 ms |
| `cells` reply | grid: "grid says hello", "iiiiiiiiii", "WWWWWWWWWW" | the same |
| `canvas.revisions`, `canvas.messages` | `{revisions: []}`, `{messages: [], context: []}` | the same |
| 20 `cells` calls, median (min to max) | 1,091.8 ms (1,015.4 to 1,161.8) | 476.8 ms (353.2 to 687.2) |
| hub CPU over 30 s with the Terminal tab open | 9.14 s | 0.26 s |
| canvas core CPU over the same 30 s (debug build) | 15.98 s | 20.19 s |
| the tab | draws the grid: `terminal-before.png` | draws the same grid: `terminal-after.png` |

The change ran at more than twice the merge base's load, so its numbers are if anything pessimistic. The canvas
core's own CPU did not fall: it replays every earlier call on each call, which this change does not touch (see the
pull request's unrelated findings).

## Review

Three rounds, each a fresh reviewer given the diff and the lists of what was fixed and declined, told to trace every
field read back to a real writer.

- Round 1 fixed: a failed catch-up read lost its marks; the mark was set after the stream's wake; deep_claim's first
  rewrite scanned whole sessions (now the claims table by task, indexed).
- Round 2: no bugs; fixed the revision rising when a reread ask had not changed, and one comment.
- Round 3: no findings.
- Round 4, on the lanes and budget commits: fixed the tasks' commands naming no test file, which left them unreached
  by any later hub or deep-show change once merged; the benchmark now reads PASS only on a passing exit with
  `pass 1` and `fail 0`, and never takes PASS from a failure's message. Disclosed, not changed: the tasks' cost and
  the 300 s run limit, and `targets.ratio` being a record of the limit, not what the verdict reads.
- Round 5: no bugs; fixed a `FORCE_COLOR` in the window's environment making every passing run read BLOCKED (the
  test now runs uncoloured), disclosed the instructions-retired check in both tasks' reasons, and corrected the
  window times above.
- Round 6: no bugs; two wording fixes (this list, and the benchmark's PASS reason naming each test's reference record).
- Declined, with reasons: the kept world's memory and the whole world resent when anything in it changed (the
  issue's scope is the reads; one resend per change replaces one per call); deep_status differs from the merge base
  only on records no writer produces (it follows the projection's rules on purpose); `Hub::record()` and
  `readings()` still copy record objects where a call draws from them.

## Unrun or open

- Criteria 1 and 3 have no counted `PASS`: this Mac was loaded and warm in every run. The budget tasks
  `canvas-cells-long-record` and `deep-status-run-events` now name them; neither has run in a budget window. Each
  runs its acceptance test 22 times a window while main lacks the task (about 35 minutes for `canvas-cells` and 13
  for `status-runs` at the change's speeds here), and about 43 once the merge base runs it too; a run over
  `measureOnce`'s 300 s under load reads BLOCKED, never PASS. Their `targets.ratio` of 1.2 records the issue's
  limit; the test itself holds the number the verdict uses, as other benches' judges do.
- `scripts/lanes.mjs` lists `tests/acceptance/1868/` (`alone`) and the two timed files (`timed`) in a commit of its
  own, 034ca75d5, which the owner approved with `deep/approved/034ca75d528d-sk`. `node scripts/proof.mjs guard`:
  "PASS guard: 9 commits checked: no guarded edit lacks its own approved proposal" (load 335). The before and trace
  lanes are unrun.
- `node scripts/affected.mjs`: see the pull request for its result.
- deep_claim's and the late hook's scope lines have no test of their own: their proof is the plans above and the
  existing suites that exercise them.
