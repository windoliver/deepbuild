# #2332 acceptance: the hub is ready sooner

Written blind from the issue, the design (#arch, #perf, Dogfooding) and base `9f93f1e7b`. No implementation was seen.

## Run

Both checkouts built (`npm ci && npm run build`), macOS (the instruction counter is macOS-only). From the change's checkout:

```
DEEP_2332_MAIN=/path/to/main-checkout node --test tests/acceptance/2332/ready.test.mjs      # about 10 minutes
node tests/acceptance/2332/measure.mjs --main /path/to/main-checkout --out report.json       # same measurements, as a report
```

Sanity run: `DEEP_2332_ROUNDS=2 DEEP_2332_IDLE_ROUNDS=1` (reads INCONCLUSIVE at best, FAIL where it already fails).

## Requirement, check, proof

| Requirement | Check | Passes when |
|---|---|---|
| AC1: hub's own instructions, start to ready, at least 25% under main's, 20 alternated rounds | `AC1` | Each round, per side: fresh isolated home holding `crates/deep-hook/default-rules.json` as `rules.json`, `deep hub run`, and the hub pid's `proc_pid_rusage` instructions (the counter `scripts/count-children.c` reads; own process only, children apart) read when its stdout `ready` line arrives (core started, not socket-ready). Median paired change at most -25% and a seeded one-sided sign-flip test rejects "less than 25% under" at p < 0.01. |
| AC2: first SessionStart, prompt, PreToolUse after ready each no more instructions than main | `AC2 ...` x3 | Same runs. Each request goes at once after the ready reading, as deep-hook sends it; its cost is the hub's instructions from the previous reading to 300 ms after its reply. FAIL when the pairs show it above main at p < 0.01, else PASS (20 pairs can't prove "no more" any other way). |
| AC3: `benchmarks/hub.mjs idle` resident memory no more than main | `AC3` | `rssBytes` of each checkout's own `idle` mode, alternated, 5 rounds after a warm-up; change's median at most main's. |
| Proof: budget task for start to ready with its first reading from main | `Proof` | `budgets.json` has a task whose id has "ready" and whose command runs `benchmarks/hub.mjs`, new vs main, `initialReason` naming #2332, main and instructions; its command runs on the change, exits 0 and prints a JSON key with "instruction" in it and a positive value. |

Missing counter (not macOS, no `cc`, a read of 0 or failure), an unbuilt checkout, a refused request, or fewer than 20 rounds is BLOCKED or INCONCLUSIVE, never PASS. The first four tests in the file check the judging itself on planted numbers (24% fails, 26% passes, a rise fails, a missing count is INCONCLUSIVE).

## On the unchanged base

With `DEEP_2332_MAIN` the base itself, AC1 FAILs (0% change, not -25%) and Proof FAILs (no start-to-ready task in `budgets.json`). AC2 and AC3 pass against an identical program, as they should. With no `DEEP_2332_MAIN` every test fails BLOCKED.

## Not named by the issue, so assumed

The budget task's id, and the name of its mode and reading; the check reads them by pattern. 300 ms settle per request. Idle uses 5 rounds, not 20, since the issue asks 20 only for AC1.
