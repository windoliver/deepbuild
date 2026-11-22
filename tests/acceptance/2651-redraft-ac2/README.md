# #2651 AC2, blind redraft: a PreToolUse costs the hub no more with 10,000 ended jobs in the record

Written blind, as a redraft of the job that writes #2651's acceptance tests (design: Dogfooding), for this criterion
only, from the issue (#2651: title and body), the design (Hook protocol (deep-hook and the hub); Numbers version 0 has
to hold; Criteria to tests, both ways; Criteria in a checked shape; Wrong programs; Dogfooding) and base commit
`8bfb6a6330569c96d01342a4c4af6393d02bdb20`. No implementation, other branch, pull request, issue comment or other
acceptance folder for #2651 was read. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## The criterion

> With 10,000 ended jobs in the record and none running, the hub's own instructions retired for a PreToolUse are within
> 2% of the same hook with no job in the record, over 15 alternated rounds. On the merge base the count rises with the
> jobs, and the test fails, naming both counts

ID `#2651.306dda20`: the first eight hex digits of the SHA-256 of the criterion's text after `- [ ] `, whitespace
collapsed and trimmed, as `scripts/proof-change.mjs` computes it. The one test's name starts with it.

## Files

| File | What it is |
|---|---|
| `ended-jobs.test.mjs` | The one tagged test, `#2651.306dda20 AC2 …` (node:test, no subtests) |
| `lib.mjs` | The hub, its socket, the hook requests and the measurement |
| `rusage.c` | Reads a live process's own instructions retired (`proc_pid_rusage`, `ri_instructions`), as `scripts/count-children.c` reads one |
| `BASE-FAILURE.txt` | The test's run on the base, failing |

## What the test does

1. **The record with 10,000 ended jobs.** It starts this checkout's hub (`deep hub run`) on a home of its own under
   `/tmp/dh2651a2-*` and submits 10,000 jobs through the hub's own `job.submit` (control socket, cli hello with the
   control token): kind `read`, agent `none`. No agent of that name exists, so the runner records each job
   (`job.recorded`) and ends it at once, refused (`job.ended`). The record's rows are the hub's own, not written by the
   test. It stops that hub and starts a fresh one on the same home, so the jobs are in the record, as after a restart,
   and none is running. `job.list` must give 10,000 jobs, all in an ended state (`stopped`, `finished`, `refused`,
   `lost`), or the test is BLOCKED.
2. **The record with no job.** A second hub of the same checkout on a second home, whose `job.list` must be empty.
3. **Warm-up.** Each hub answers one session of 300 PreToolUse/PostToolUse pairs, uncounted.
4. **15 alternated rounds** (README: Measurement), then the perf lane's own judge, `judgeInstructions` from
   `scripts/benchmark.mjs`, on the 15 pairs `{ current: with 10,000 jobs, base: with none }`. It is the design's rule
   for a budget counted in instructions: two seeded one-sided sign-flip tests on the pairs' log ratios less ln 1.02,
   FAIL when the count is above 2% at p under 0.01, PASS when "at least 2%" is rejected at p under 0.01, INCONCLUSIVE
   otherwise. **Only PASS passes.** INCONCLUSIVE fails with the judge's reason, as does a missing count
   (`judgeInstructions` makes it INCONCLUSIVE), and a hub that can't start or seed fails BLOCKED, naming why.

The failure message names both counts: the medians over the 15 rounds of the hub's instructions per PreToolUse with
10,000 jobs and with none, the judge's change and p values, and every round's counts with each reading.

## Measurement

The surfaces are the hub's socket, a hook request exactly as deep-hook sends it (one connection, the hub's hello, the
request, its acknowledgement and reply), and the kernel's count of the hub process's own instructions retired. "The
hub's own": the PID the hub's ready line names, its own threads, none of its children's.

The noise this has to stand, measured here at load averages of 65-200 on this Mac: one reading of 200 PreToolUse hooks
moves about ±8% from the next on the same hub; the count drifts with load (the design: a count from code that waits by
spinning or on a lock moves with the schedule); it rises as one session grows longer (3.6M to 5.8M a hook over 6,000
hooks of one session); and an idle hub's own timers run in bursts of 60-270 million instructions now and then, against
2-6 million in a quiet half-second, which no hook asked for. So:

- **A reading** is the hub's instructions from a settled hub to a settled hub over 100 PreToolUse hooks sent one after
  another, each on its own connection. Settled: `inbox.read`, which waits for every state pass under way or due, is
  called before the first count and before the second, so the work a hook leaves for later is counted with it, the
  same for both sides. After the second count, uncounted, each call gets its PostToolUse, so no reading inherits calls
  left open.
- **A fresh session per reading**: each reading runs in a new Claude Code session of the user's own (no job's),
  started with SessionStart and ten uncounted PreToolUse/PostToolUse pairs, on both hubs alike, so a session's growth
  and its first-call work stay out of the counts.
- **A round** takes 20 readings a side, interleaved one by one (ABBAABBA…, the round's first side swapped each round),
  so load and drift fall on both sides alike. A side's round count is the mean per hook of its 14 lowest readings: the
  6 highest are left out. A timer burst only ever raises the one reading it lands in; a cost a hook carries, such as
  copying or searching every job, is in every reading, so leaving the highest out can't hide it.
- **15 rounds**, the criterion's, judged by `judgeInstructions` with its own seed (1405), floor (2%) and p (0.01).

**Calibration**, run by hand with these same functions on two hubs with no job each (one program on both sides, which
must PASS): with 10 readings of 200 a side and every reading kept, pairs moved ±3.6% and the judge read INCONCLUSIVE
(change +0.24%, p 0.033 under 2%). With the design above, at load averages of 65-120: PASS, change -0.82%, pairs within
-4.7% to +3.3%, p 0.0002 under 2% and 0.9999 above, 10.6 minutes.

## Wrong program

This is a fix, so the merge base is the wrong program: the base itself, built from this checkout.

## Run

On macOS, in a checkout built as the base was here:

```
export NVM_DIR=$HOME/.nvm; . "$NVM_DIR/nvm.sh"; nvm use 24
export PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$HOME/.cargo/bin:/usr/sbin:$PATH
npm ci && npm run build --workspaces --if-present && cargo build --locked -q -p deep-hook
node --test tests/acceptance/2651-redraft-ac2/ended-jobs.test.mjs
```

It takes about 13 minutes here, under load: about a minute to seed the 10,000 jobs, the rest the 15 rounds (60,000
counted PreToolUse hooks, their PostToolUse hooks and the readings' opening pairs). The test's own timeout is an hour. It needs `cc` for
`rusage.c`; off macOS, or with no counter, it fails INCONCLUSIVE, naming why. Each hub gets a home under `/tmp`,
removed after; hubs are stopped by their PIDs only.

## The base

Run here on the base, `8bfb6a6330569c96d01342a4c4af6393d02bdb20`, built from this checkout (Mac15,12, macOS 27.2.1,
Node 24.22.0, load averages 67 at the start and 187 at the end), in 13 minutes: **FAIL, for the expected reason**.
The count rises with the jobs: 4.379M instructions per PreToolUse with 10,000 ended jobs in the record against 3.183M
with none (medians of the 15 rounds), +37.62% (median of the 15 pairs), above 2% at p 0.0001 (p 1.0 under). Every
round rose, by 25.7% to 46.5%. The output, stack lines dropped and home paths redacted, is `BASE-FAILURE.txt`.

In the judge's reason, "over the merge base" is `judgeInstructions`'s own wording: here its base side is the hub with
no job in the record, and its current side the hub with 10,000.

An earlier draft of the measurement (10 readings of 200 a side, every reading kept) failed on the base the same way:
4.528M against 3.303M, +35.88%.

## Readings where the issue leaves a choice

- **"10,000 ended jobs in the record"**: jobs the hub itself recorded and ended, through `job.submit`, refused for an
  agent that doesn't exist, the cheapest way a job ends with no agent run. Their rows (`job.recorded`, `job.ended`) are
  the runner's own. Read through `job.list`, the socket's surface for the runner's jobs.
- **"None running"**: checked by `job.list`: every job is in an ended state.
- **"The same hook with no job in the record"**: the same checkout's hub on an empty home, the same requests, at the
  same points of the run.
- **"Alternated rounds"**: the design's pairing for instruction budgets, which swaps which side goes first each round;
  here each round's 20 readings a side also alternate.
- **"Instructions retired for a PreToolUse"**: a round's instructions over its PreToolUse hooks, per hook, settled to
  settled, the hub's own process only. PostToolUse hooks are sent uncounted, and the readings' sessions are opened
  uncounted.
- **"Within 2%"**: the perf lane's judge, which is the design's rule, not a 2% bar on one ratio.
