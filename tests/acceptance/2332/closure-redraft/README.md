# #2332 blind redraft: the hub is ready sooner

Redrafted from `issue.json` (issue #2332), `AGENTS.md`, `docs/technical-design.md` (Hook protocol, Numbers version 0 has to hold, Dogfooding) and base `d8c46f0d5`. Not read: the existing `tests/acceptance/2332/closure/`, other worktrees, reports, diffs or the dispute.

## Run

```
# fast, no builds of the hub needed (macOS, cc)
node --test tests/acceptance/2332/closure-redraft/selftest.test.mjs
# the proof: main built in DEEP_2332_BASE, this checkout built (npm run build)
DEEP_2332_BASE=<built main checkout> node --test tests/acceptance/2332/closure-redraft/acceptance.test.mjs
```

Optional: `DEEP_2332_CHANGE` (default: this checkout), `DEEP_2332_EVIDENCE` (where `hub-rounds.json` and `idle-rounds.json` go), `DEEP_2332_QUIET` (instructions per 200 ms window that still count as quiet, default 1,000,000).

## What each test reads, and from what

| Requirement (issue text) | Test | Measure and rule |
|---|---|---|
| Own instructions, start to ready, on a fresh home, at least 25% under main, 20 alternated rounds | AC1 | Each round: a new `HOME` holding that side's `crates/deep-hook/default-rules.json` as `~/.deepbuild/rules.json` (the shipped guards), then `node packages/cli/dist/main.js hub run`. At the stdout line `{"ready":true,…}`, not the socket hello, the hub is stopped (SIGSTOP), its count read, and it is continued. Count = `proc_pid_rusage` `ri_instructions` of the hub's pid alone (`read-instructions.c`, the field `scripts/count-children.c` reads), so `sandbox-exec`, `log`, `git` and `deep-hook` children are apart. Rule: change/main median ratio, PASS only if "at least 0.75" is rejected at p < 0.01. |
| First SessionStart, prompt and PreToolUse after ready, each no more than main | AC2 ×3 | After ready, wait for quiescence (below), send one request of each kind in that order over the socket in the design's hook protocol (hello, request line, acknowledgement carrying the id, reply), wait for quiescence, read the growth. Threshold 1.0 (0% margin), same test. |
| Deferred work | `deferred work is accounted` | The count at quiescence after ready, per round, judged at 1.0. A change that only moves work to just after the ready line shows ratio ~1 and is INCONCLUSIVE, not PASS. This is my reading of "account for deferred work"; the issue's criteria do not require it. |
| Idle RSS no greater than main | AC3 | `node benchmarks/hub.mjs idle` of each side from its own root, `rssBytes`, 20 alternated pairs, threshold 1.0. The OS fingerprint is read before and after every run with `scripts/benchmark.mjs`'s `fingerprint()` and judged by its `judgeLimit` (reference Mac, mains, Low Power Mode off, thermal nominal); any run off that is INCONCLUSIVE. |
| Stats | all | The design's two seeded one-sided sign-flip tests, seed 2332, reusing `judgeInstructions` with main scaled by threshold/1.02 so its line sits at the threshold. Median ratio and both p values are in each result. FAIL: above the threshold at p < 0.01. PASS: below it at p < 0.01. Otherwise INCONCLUSIVE, so failing to detect a rise is never a pass. A missing, zero or non-20 pair count is INCONCLUSIVE. |
| Quiescence | all hook steps | The hub's count grows by at most `DEEP_2332_QUIET` over three 200 ms windows in a row, within 20 s. A hub that never settles cannot PASS a hook or the total. |
| Preserve record behavior | every round | Each request's reply must acknowledge its id and have `exit` and `stdout`, and `events.read` (as the app, with the control token) must return an event with each request's id. A hub that does not will make the round throw `INVALID`; the run is not retried or dropped. |
| Required budget task in `benchmarks/budgets.json` | not covered here | Left to the original proof. |

## Controls (selftest.test.mjs)

- The no-op hub (`noop-hub.mjs`) prints a ready line at once and acknowledges every hook. The round refuses it as `INVALID`, so its tiny count never reaches a verdict.
- Synthetic pairs: a hub 40% lower at ready passes; 90% fails; 76% with noise is INCONCLUSIVE. A hook 1% above main fails at 0%; equal to main is not a pass. Missing, zero and short pair counts are INCONCLUSIVE.
- The counter reads a live process, with a spinning child apart from its parent, and null for a missing pid.
- Idle memory off a reference Mac is INCONCLUSIVE whatever the bytes.

## Not covered

- QoS: a count at another QoS does not compare (count-children.c); the rounds do not pin it.
- `deep-hook` is not run: the design's wire protocol is sent as `benchmarks/hub.mjs` does, and the client's own instructions are not the hub's.
- The ready-time count is a hub stopped at the line; the hub's own SIGSTOP and SIGCONT add nothing to its count.
