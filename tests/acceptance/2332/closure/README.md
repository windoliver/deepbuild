# Issue #2332 closure acceptance: the hub is ready sooner

Three criteria, at the issue's exact numbers, judged by the perf lane's seeded paired sign-flip test
(`scripts/benchmark.mjs` `judgeInstructions`, design #perf), with the lane's 2% floor replaced by the issue's limits.

| Criterion | Reading | Limit (current / main) |
|---|---|---|
| AC1 start to ready | hub's own instructions, spawn to the stdout `{"ready":true}` line, fresh home, shipped guards | at most 0.75, 20 alternated pairs |
| AC2 first SessionStart, prompt, PreToolUse | hub's own instructions from ready to the reply plus its deferred work | at most 1.00 (0% rise) |
| AC3 idle memory | `benchmarks/hub.mjs idle` `rssBytes`, 20 alternated pairs | at most 1.00 |

Verdicts: FAIL when the flips reach the pairs' sum at p < 0.01 (above the limit shown); PASS only when they fall to it
at p < 0.01 and the median pair is within the limit; everything else INCONCLUSIVE. Not detecting a rise is never PASS.
Fewer than 20 pairs, any missing/zero count, any invalid or interrupted round, an unmet prerequisite: INCONCLUSIVE.
No sample is dropped or repeated; every run is appended to `runs.jsonl`.

## Run (parent, after both checkouts are built)

```
node tests/acceptance/2332/closure/hub-ready.mjs --main <main checkout> --candidate <candidate checkout> --out <evidence dir>
```
Options: `--rounds 20` (fewer is a smoke run and cannot PASS), `--only startup|memory`. Exit 0 only if all PASS, 1 on a
FAIL, 2 otherwise. Output: `result.json` (verdicts: pair counts, median deltas, p values, seed, per-run children,
fingerprints) and `runs.jsonl`. Self-tests: `node --test tests/acceptance/2332/closure/judge.test.mjs`.

## What each round does
- Fresh `mkdtemp` home, `HOME` set, `DEEP_*`/`DYLD_*` env removed, the checkout's `crates/deep-hook/default-rules.json`
  (shipped guards) copied to `.deepbuild/rules.json`. `node packages/cli/dist/main.js hub run`, alternating which
  checkout goes first each round.
- Ready is the hub's own stdout ready line (pid checked against the spawned process), not the socket hello.
  The count is read at that line from the live process by `insn.c`: `proc_pid_rusage` `ri_instructions`, the counter
  `scripts/count-children.c` reads. It is the hub process alone. Children are logged apart by the lane's own
  `count-children.c` library (built from main's source for both sides) and reported under `children`, not included.
- Straight after ready (no settling, so work moved to just after the ready line is charged to SessionStart): a real
  SessionStart, then prompt, then PreToolUse over the hub socket, in the public hook line protocol of
  `benchmarks/hub.mjs`. Each reply must be a reply line with `exit: 0`. After each, the count is taken when the
  hub's own count has risen by under 2M instructions in each of three 250 ms windows, bounded at 20 s (else the round
  is invalid). Positive controls: `pkill -f node` is denied by the shipped guard (exit 2, "DeepBuild blocked"), and
  `ledger.db` is non-empty. A hub that ignores guards, answers nothing or records nothing cannot pass (self-tests).
- Stopped by SIGTERM on its PID, bounded at 15 s.
- Memory rounds run main's copy of `benchmarks/hub.mjs` for both sides (identical tooling), through a temp dir whose
  `packages` and `node_modules` link to each checkout. The fingerprint (`scripts/benchmark.mjs` `fingerprint()`: model,
  chip, memory, AC power, Low Power Mode, thermal state, from the OS) is read before every run and stored; any run off a
  named reference Mac, off AC, with Low Power on or unread, or not thermal nominal makes memory INCONCLUSIVE.

## Unmet or open
- Not run here: no 20-pair measurement (dist did not exist; builds are the parent's). Only judgment mutants, the counter
  on a live process, and two fake-hub negative controls ran.
- The live reading is taken a few ms after the ready line is written, so it can include that lag; both sides share it.
- Counts moved from the hub to children (a new `git` or `deep-hook` start) are in `children`, not AC1/AC2, as the issue states.
- AC1's lane count is at exit; this reads live at ready, which is the issue's "start to the line that says it is ready".
- The issue's Proof item (a `budgets.json` task with main's first reading) is not covered here.
- Needs `cc` and macOS; the Mac must be a named reference Mac for AC3.
