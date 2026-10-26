# AC2 and AC8 (overhead) blind redraft: under 10 ms at p95 on top of process start, over 1,000 calls

Criteria:

- `#315.9543886e` (AC2): "Overhead under 10 ms at p95 on top of process start, measured over 1,000 calls".
- `#315.515d4e08` (AC8), the "under 10 ms at p95 on top of process start" measurement only: "Budgets, on the reference
  Mac in the local preflight, compared with the merge base: under 10 ms at p95 on top of process start, …". The rest
  of AC8 (fail open, memory, binary size, the perf-lane check against the merge base) stays in `budgets.test.ts` and
  isn't in dispute.

Both are measured as AC9 says, "with hyperfine against a native no-op binary as the floor".

Test: `budgets-overhead-redraft.test.ts`, two `describe`s with one test each:

- "AC2 #315.9543886e overhead under 10 ms at p95 on top of process start, measured over 1,000 calls (redraft)" >
  "AC2 1,000 PreToolUse calls for ls forwarded to a running hub, each matched by a watch-mode entry and allowed, cost
  under 10 ms at p95 over a native no-op binary"
- "AC8 #315.515d4e08 budgets on the reference Mac in the local preflight, compared with the merge base (redraft)" >
  "AC8 on the reference Mac, the forwarded call's p95 overhead on top of process start, measured with hyperfine
  against the no-op floor, is under 10 ms"

The two tests share one measurement (`shared()` from `helpers.ts`), made by whichever runs first, so the number AC2
reports and the number AC8 holds as a budget are the same run; each test checks the proof and judges the number on
its own. It imports the suite's `helpers.ts` unchanged. The owner approved it as AC2's and AC8's overhead proof on
2026-10-26; the first draft's AC2 test and AC8 overhead test were then removed from `budgets.test.ts`. Written from issue #315, the design (Hook protocol; Before
each command; Numbers version 0 has to hold), `guard@1.json`, #316 and the dispute #745, at base `de01900`
(origin/main), without reading the first draft's bench or any implementation.

## The dispute (#745)

The first draft's bench (`budgets.test.ts`, `overhead`) sends `ls` through the release deep-hook to a hub whose
`rules.json` is `RULES` from `helpers.ts`. To show "with the matcher running" it needs an entry `ls` matches, and
`RULES` gives that entry (`listing-noted`, `shell:ls*`) `mode: 'block'` with `fail_closed: false`. At the first
draft's base that meant "the hub's to decide", and the hub allowed it. Since #316 the hub decides a matched block-mode
entry itself: the call is denied, exit 2, with the entry's reason. So hyperfine's first warmup `ls` exits 2 and
hyperfine stops; the two tests report BLOCKED on every machine. The hub is doing what the design says ("each block
says why and what to do instead"); the collision is in the test's fixture.

Reproduced at this base with the release deep-hook and a hub on a temp home, one `ls` per call, the hub stopped by
its PID (`scratchpad/repro-315-modes.sh`, not part of the suite):

```
mode=block call 1: exit 2 stdout= stderr=DeepBuild blocked this: Listing. Nothing to do. (guard listing-x)
mode=block call 2: exit 2 stdout= stderr=DeepBuild blocked this: Listing. Nothing to do. (guard listing-x)
mode=watch call 1: exit 0 stdout= stderr=
mode=watch call 2: exit 0 stdout= stderr=
```

## What changed from the first draft

- **The fixture's entry mode.** The measured `ls` matches `listing-watched` (`shell:ls*`, `scope: all_repos`,
  `mode: 'watch'`, `fail_closed: false`), an entry the test writes itself with `writeRules(home, ENTRIES)`. `guard@1`'s
  `mode` is `watch | warn | block`; #316 has block deny with its reason, and watch and warn not deny. So the matcher
  runs on every call (the entry matches) and the call is still allowed. The suite's fail_closed entry
  `no-kill-by-name` (`shell:pkill *`, block, fail_closed, taken from `RULES`) is kept beside it; `ls` doesn't match it,
  so the request's `matched` must be exactly `['listing-watched']`.
- **The proof names the entry.** Before any number is read, one `ls` goes through a forwarder in front of the hub and
  the request the hub received must carry `matched: ['listing-watched']`, exit 0 and an allow (`decision`).
- **The measured calls are shown to have reached the hub.** After the hyperfine runs the home's spool must hold no
  request: a forwarded call is never spooled, a failed-open or late one is. (The measurement goes straight to the
  hub's socket, not through the forwarder, so the forwarder's own cost is not in the number.)
- **Every call's exit code is read from hyperfine's JSON.** hyperfine runs without `-i`, so one non-zero exit stops
  the run and the test fails naming hyperfine's exit; the JSON's `exit_codes` are checked too: 1,000 per command,
  every deep-hook exit 0.

Kept as the suite has it (README, Budgets): the release build (`buildDeepHook({ release: true })`); the floor
`fn main() {}` built by rustc at `opt-level=3` and run once before timing; one hyperfine run per sample with `-N`,
`--input <the PreToolUse JSON>`, `--warmup 20`, `--runs 1000`, both commands in one run, `--export-json`; overhead
per run is p95 of the 1,000 deep-hook times minus p95 of the 1,000 floor times, in ms; five runs judged by
`judge(ctx, name, runs, 10)`, so PASS needs every run within 10 ms and INCONCLUSIVE covers a spread; the gate
`environmentProblem()` (reference Mac, mains, Low Power Mode off, thermal nominal) and `hyperfinePath()`, each
skipping as INCONCLUSIVE naming why; a fresh temp home, never `~/.deepbuild`; the hub started with `startHub` and
stopped with `stopHub` by PID, every other process through `run` (owned) and `cleanup` in `afterEach`.

## Assertions, per test

| # | Assertion | Source |
|---|---|---|
| 1 | The forwarded `ls` exits 0 | #315 Scope: "forwards it to the hub, prints the reply"; README: an allow is exit 0 with no deny |
| 2 | Its decision is `allow` (no exit 2, no deny in stdout) | guard@1 `mode` enum; #316: block denies with its reason, watch and warn don't; #745: the entry must match without denying |
| 3 | The hub received exactly one PreToolUse request of this session | scenario precondition (one proof call) |
| 4 | That request's `matched` is exactly `['listing-watched']` | design, Hook protocol: `matched` is "the guard entries in rules.json the call matched, by name"; README: "with the hub up, the request's `matched` names every rules.json entry the call matched, whatever its mode"; the first draft's AC2 title, "with the matcher running" |
| 5 | Each hyperfine run timed 1,000 deep-hook calls and 1,000 floor runs | AC2: "measured over 1,000 calls"; AC9: "against a native no-op binary as the floor" |
| 6 | Every deep-hook call in every run exited 0 | AC2 measures a call that was allowed; a denied or failed call isn't the issue's call |
| 7 | The spool holds no request after the runs | #315 Scope: a call is spooled only when the hub is away or late; a forwarded call is never spooled, so a low number from calls that failed open can't pass |
| 8 | `judge`: each run's p95 overhead over the floor is at most 10 ms (FAIL only when every run is over by more than the margin; otherwise INCONCLUSIVE) | AC2 and AC8: "under 10 ms at p95 on top of process start"; design, Numbers: "Hook overhead: under 10 ms at p95 on top of process start, except holds"; AC9: hyperfine against the no-op floor |

The wrong program each catches:

- A deep-hook that doesn't forward `matched`, or forwards an empty or wrong list (4): the request the hub received
  wouldn't name `listing-watched`, so the test fails before any number is read, showing what `matched` held.
- A hub that denies a watch-mode entry (1, 2, and 6 through hyperfine): the proof call would exit 2 with the entry's
  reason, as the block-mode reproduction above shows; the test fails naming the exit and stderr. The first draft's
  fixture at this base fails exactly here.
- A deep-hook over budget (8): each run's p95 minus the floor's p95 above 10 ms by more than the margin on every run
  is FAIL; near the limit or spread across it, INCONCLUSIVE, never PASS.
- A deep-hook that can't reach the hub and fails open, or one that doesn't exit 0 on an allow (5, 6, 7): hyperfine
  stops at the first non-zero exit, and a failed-open call leaves a spooled request.

## Type check (in this worktree)

```
$ node node_modules/typescript/bin/tsc -p tests/acceptance/315/tsconfig.json --noEmit
tsc exit 0
```

## Run at this base (de01900, origin/main, with #316 in)

Mac15,12 (Apple M3, 16 GiB) on mains, Node v24.22.0, hyperfine 1.19.0, `node node_modules/vitest/vitest.mjs run
--no-file-parallelism --reporter=verbose tests/acceptance/315/budgets-overhead-redraft.test.ts`:

```
AC2 p95 overhead over the no-op floor, ms, per hyperfine run: 1.169, 0.679, 0.966, 2.312, 0.511 against 10 (margin 352%)
AC8 p95 overhead over the no-op floor, ms, per hyperfine run: 1.169, 0.679, 0.966, 2.312, 0.511 against 10 (margin 352%)
 ✓ … > AC2 1,000 PreToolUse calls for ls forwarded to a running hub, each matched by a watch-mode entry and allowed, cost under 10 ms at p95 over a native no-op binary 13882ms
 ✓ … > AC8 on the reference Mac, the forwarded call's p95 overhead on top of process start, measured with hyperfine against the no-op floor, is under 10 ms 40ms
 Tests  2 passed (2)
```

An earlier run of the same file, before assertion 7 was added, gave 0.673, 0.425, 0.493, 2.307, 0.842 ms. (The
`margin` the judge prints is the runs' spread; it only matters when a run is over the limit.)

Note on PATH: `environmentProblem()` runs `sysctl`, which lives in `/usr/sbin`. With a PATH that lacks it the two
tests skip as `INCONCLUSIVE: cannot read the machine: spawnSync sysctl ENOENT`, as they should; the run above had
`/usr/sbin` on PATH.

## Not run

- Not run against a merge base where the overhead is over budget, so assertion 8's FAIL arm hasn't been seen to fire;
  `judge` is the suite's and `budgets.test.ts` uses it the same way.
- The hub-denies wrong program was shown outside vitest (the block-mode reproduction above), not by running this file
  on the first draft's `RULES`; the file writes its own entries, so that would need a changed fixture.
