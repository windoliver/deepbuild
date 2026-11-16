# Blind redraft of #311 AC12's timing half for #1830: validating an event takes under 20 µs at p95, judged with the loads

AC12 `#311.5a2a5cc9`: "Budgets, on the reference Mac in the local preflight, compared with the merge base: validating an
event against its schema takes under 20 µs at p95, and the generated types add nothing at runtime." `budgets.test.ts` here
replaces `../311/redraft-ac12/budgets.test.ts` (itself a redraft of the timing half). "The generated types add nothing at
runtime" stays with `../311/codegen.test.ts`.

Why: since #1555, `judgeLimit` reads INCONCLUSIVE when a call gives no `loads`, and the earlier draft called it with
`limit`, `runs` and `fingerprint` only, so AC12 read INCONCLUSIVE on every machine, the reference Macs included (#1830).
This draft reads the one-minute load average (`os.loadavg()[0]`) at each run's start and at its end and passes the five
`{ start, end }` to `judgeLimit` in the runs' order. The test's name, its criterion, the events, the runs and the limit are
unchanged.

## What was read

AGENTS.md; issues #1830 and #311 (bodies only); `../311/redraft-ac12/` (the draft this redrafts, its README and tsconfig),
`../311/helpers.ts` (`REPO`) and `../311/README.md`; `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`), called rather
than copied; `docs/technical-design.md`: How we know version 0 works (the timing rule: a loaded run is uncounted and counts
neither way; Load), The reference Macs (Mac15,7, Mac15,12, Mac17,10; mains power, Low Power Mode off, thermal state
nominal) and Dogfooding.

## How to run

On a reference Mac, on mains power, with Low Power Mode off, the thermal state nominal and the machine otherwise idle:

```sh
npm ci   # once, if node_modules is missing
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/311-redraft-1830 --testTimeout=600000 --no-file-parallelism --disable-console-intercept --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/311-redraft-1830/tsconfig.json
```

One test, under a minute. No build, network, model or sign-in. Keep the console output: the five p95 readings and the
five runs' loads printed there are the criterion's proof. With `--root`, Vitest writes `node_modules/.vite/` in this
folder (ignored by git); delete it after a run.

## Expected values

| | Value |
|---|---|
| Limit | under 20 µs at p95 for one `validate(name, value)` of a whole event |
| Events | every valid fixture (`fixtures(schema)`) of the newest catalogued schema of 17 kinds the issue names: `user.ask`, `session.child_started`, `task.created`, `worktree.created`, `worktree.removed`, `doc.patched`, `claim.made`, `tool.before`, `verdict.made`, `verdict.stale`, `definition.locked`, `definition.revised`, `decision.created`, `decision.applied`, `ask.created`, `ask.answered`, `ask.defaulted` |
| Runs | one warm-up run, then five runs of 600 rounds; a round validates the next fixture of each kind, so a run is 10,200 calls and each kind weighs the same |
| Each call | on its own fresh `structuredClone` of the fixture, timed alone with `process.hrtime.bigint()`, and accepted (`ok: true`) |
| A run's reading | the nearest-rank p95 of its 10,200 call times, in µs, printed with its p50 and max |
| A run's load | `os.loadavg()[0]` read just before its first timed call and just after its last; the five `{ start, end }` go to `judgeLimit` as `loads` |
| Judge | `judgeLimit({ limit: 20, runs, fingerprint, loads })`, under the fingerprint read before the runs and the one read after: PASS when all five p95s are at most 20 µs, FAIL when all five are over 20 µs by more than the margin (the larger of 5% and the five runs' spread over 20 µs), else INCONCLUSIVE |
| Where it counts | both fingerprints on a reference Mac, on mains, Low Power Mode off, thermal state nominal, macOS build known, and no run's load above the core count at its start or end |

Outcomes, as the earlier draft has them: PASS (under both fingerprints) passes; FAIL is a failed assertion whose message
starts `FAIL`; INCONCLUSIVE under either fingerprint, off the reference Macs, their conditions or under load, is a skip
whose message starts `INCONCLUSIVE` with `judgeLimit`'s reason and the five readings in it. A kind missing from the
catalogue, a schema without a fixture, or any refused call fails with a message starting `FAIL`, so a validator can't look
fast by refusing. A `BLOCKED` from `judgeLimit` (readings that aren't five finite numbers) is thrown, as in the earlier
draft: it fails, and is never a pass.

## Fails on a wrong program

A validator slower than the limit (one that busy-waits 30 µs per call, as the earlier draft planted) puts every run's p95
over 20 µs by more than the margin, and on a fit reference Mac with an idle machine `judgeLimit` reads FAIL, which this test
fails as `FAIL all five p95s […] µs are over 20 µs by more than the …% margin`. A validator that answers from a cache keyed on
the object fails too, since each call gets a fresh copy; one that refuses events fails on the refused calls. A run under load
can't pass or fail it: it skips as INCONCLUSIVE, naming the load. Not run here: this Mac is loaded (below), so a planted slow
validator would read INCONCLUSIVE too, not FAIL.

## Base run, 3557b348, 2026-11-15

Run once, as above, on a Mac17,10 (Apple M5 Max, 64 GB, macOS 26B8119, 18 cores) on mains power, Low Power Mode off,
thermal state fair, with other sessions loading it to a one-minute load of 642 to 667. Skipped as INCONCLUSIVE:

```text
p95 per run [13.58, 11.00, 13.33, 11.00, 10.38] µs against 20 µs; p50 [2.54, 2.17, 2.58, 2.21, 2.00]
loads (start, end) per run: 641.8/641.8, 656.1/656.1, 656.1/656.1, 666.9/666.9, 666.9/666.9
INCONCLUSIVE a reading, not a budget result: off the reference Macs (…): thermal state is "fair", not "nominal";
load 666.93798828125 at a run's start or end is above the 18 cores
```

That is the expected result on a loaded machine: the reason names the load. The readings are all under 20 µs, but they
count neither way. A PASS or FAIL needs a fit reference Mac with no other work running; it was not chased here.

## Readings and deviations

- **What a run is** for the load: the 10,200 timed calls. Building a run's fresh copies happens before its start reading.
  macOS refreshes the one-minute average every few seconds, so a run of about a second often reads the same value at both
  ends; it is still read twice, as the design asks.
- **Two fingerprints.** The earlier draft judged the readings under the fingerprint read before the runs and the one read
  after; this one does too, with the same loads, and counts a verdict only when both give it.
- **"Compared with the merge base."** The limit is an absolute time, so the merge base's time can't change the verdict and
  the test doesn't time it (unchanged from the earlier draft).
- **BLOCKED** stays thrown, the earlier draft's convention, rather than a skip: it can arise only from broken readings, and a
  failure is the stronger of the two "never a pass" outcomes.
