# Acceptance tests for #607: the harness budgets lane counts the second reference Mac

These tests were drafted from issue #607 (its text as of October 20), `docs/technical-design.md` ("The reference Macs", and the budgets paragraph before it) and the base commit `f346706`. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

## The surface

The issue names it: the harness budgets lane, `node scripts/agent-harness.mjs budgets`, and its one JSON line with `status` and `machine: { model, reference, why }`, as `tests/acceptance/48/README.md` describes them. The tests run the lane the way 48's fast tests do, against 48's fake agent and in 48's sealed environment, by importing `fakeAgents`, `scratch`, `startHarness`, `onlyLane` and `BASE` from `tests/acceptance/48/helpers.mjs`. Each lane run passes `--base 1de288c` (48's base, which has no harness, so no base side runs) and `--changed scripts/agent-harness.mjs`, so the change counts as touching the harness.

### How a test puts the lane on another machine

The tests run on a 16-inch MacBook Pro (Mac15,7), and the issue is about the 13-inch MacBook Air (Mac15,12) and Macs that are neither. Each test writes a `sysctl` and a `pmset` into a scratch `bin/` and puts it first on the `PATH` the harness runs with. Why this way:

- The harness finds both by name on `PATH` at the base (`spawnSync('sysctl', ...)`, `spawnSync('pmset', ...)`), and the issue's change keeps that. No option or variable is added to the harness for the tests.
- `pmset` is faked as well, so mains power, Low Power Mode off and a nominal thermal state are fixed by the test, not by whatever state this Mac is in when the test runs.
- The fake `sysctl` answers `hw.model`, `hw.memsize`, `machdep.cpu.brand_string` and every CPU count key (`hw.ncpu`, `hw.physicalcpu`, `hw.logicalcpu`, their `_max` forms and `hw.activecpu`) for one machine, and fails on any other key as the real one does. So no value from this Mac leaks into the judgement. The fake `pmset` answers `-g ps`, `-g batt`, `-g` and `-g therm` with the real tools' output format.
- Each test checks that the lane's `machine.model` is the fake's model. A harness that read the machine some other way would fail there and not pass by accident.

## How to run

`node --test tests/acceptance/607/reference-macs.test.mjs`. It starts no real agent and spends nothing. The seven lane runs go in parallel and take about 25 s together on the Pro.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading `- [ ] ` dropped. They were computed with this command, with the issue's two criterion lines on stdin:

```
node -e 'for (const t of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)) console.log(require("crypto").createHash("sha256").update(t.trim().replace(/\s+/g," ").replace(/^- \[ \] /,"")).digest("hex").slice(0,8))'
```

| ID | Criterion | Tests | Wrong program it must fail on |
|---|---|---|---|
| `#607.845595bb` | On a machine with a covered Claude Code and Codex on PATH (or given with `--claude`/`--codex`), the harness budgets lane on the Air prints `machine.reference: true` and a PASS, INITIAL or FAIL, not INCONCLUSIVE; on a machine that is neither reference Mac it prints `reference: false` with a `why` naming both models. | fast, `reference-macs.test.mjs`, 7 tests. **The Air:** Mac15,12, 8 cores, 16 GB, `Apple M3`, mains, Low Power Mode off, nominal thermal state gives `reference: true` and a status of PASS, INITIAL or FAIL. **Neither:** Mac15,13 (the 15-inch Air, with the 13-inch Air's chip, cores and memory) gives `reference: false`, a `why` that matches both `Mac15,7` and `Mac15,12`, and INCONCLUSIVE. **Guards:** the Pro (Mac15,7, 12 cores, 36 GB, `Apple M3 Pro`) still counts. A Mac15,12 with an `Apple M3 Pro` chip, with 24 GB, with 12 cores, or on battery doesn't count: `reference: false`, a `why`, INCONCLUSIVE. | The base harness, which knows only the Pro: the Air test fails and the neither test fails (see `BASE-FAILURE.txt`). These wrong programs were each planted in a scratch clone of the base, and each fails at least one test: one that checks only the model (the chip, 24 GB and 12-core tests fail); one that matches the Air's chip with `/M3/` (an M3 Pro passes as the Air's M3); one that takes memory, cores and chip from either Mac (the chip and 12-core tests fail); one that skips the mains, Low Power Mode and thermal checks for the Air (the battery test fails); one that matches the Air by the prefix `Mac15,1` (Mac15,13 counts, so the neither test fails); one whose `why` still names only Mac15,7; and one that drops the Pro (the Pro test fails). A twin written from the design, not from the issue's hunk, passes all 7. |
| `#607.3c288099` | `tests/acceptance/48` passes as its README says it does on a reference Mac. | No new test. This criterion is proven by running that suite on a reference Mac after the change: `node --test tests/acceptance/48/harness.test.mjs` (fast, free), and by hand, as 48's README says, `DEEP_HARNESS_LIVE=1 node --test --test-concurrency=1 tests/acceptance/48/harness.live.test.mjs` (spends plan usage). Keep the output as evidence. | A change that breaks the harness's runs, its run log, its cost caps, its cleanup or its lane, all of which 48's suite already covers. |

## What depends on hardware this machine isn't

- Criterion `#607.845595bb` is proven on this Pro by faking the machine through `sysctl` and `pmset`. No test here runs on a real 13-inch MacBook Air or on a real Mac that is neither. The fakes copy the real tools' output format and key names. A real Air could still differ in a way the fakes don't show, for example a `machdep.cpu.brand_string` other than `Apple M3`. The design names the chip only as "an M3", and these tests take `Apple M3` as its string, as the issue's hunk does.
- The criterion's first clause, "a covered Claude Code and Codex on PATH (or given with `--claude`/`--codex`)", is met by 48's fake agent given with `--claude` and `--codex`. The fake reports a version from the repo's `adapter.facts@1` files, so the harness takes it as covered. The real covered binaries aren't on this Mac (the issue says Claude Code 2.1.142 and Codex 0.150.1 are). A real-agent run of the lane on the Air is the live side of `tests/acceptance/48` and isn't drafted here.
- **Criterion `#607.3c288099` can be proven on the Pro only, not on the Air, as 48 stands.** `tests/acceptance/48/helpers.mjs`'s `referenceMachine()` still knows only Mac15,7, 36 GB, 12 cores and an M3 Pro. On an Air, its `assertBudgetStatus` requires `machine.reference: false` and INCONCLUSIVE, which a fixed lane no longer prints. I checked this in the scratch clone: with a twin harness and a fake Air `sysctl` on the test process's `PATH`, 48's "under its budgets ... first measurement" test fails on `this machine isn't the reference Mac on mains power with Low Power Mode off`, with the lane at `reference: true`, INITIAL. Under AGENTS.md, 48's tests can't be edited to fix this. A fix goes to a blind redraft of 48 by its drafting job. Until then, run 48 on the Pro.

## Assumptions a redraft may revisit

- The harness reads the machine through `sysctl` and `pmset` found on `PATH`, as the base does. A harness that called `/usr/sbin/sysctl` by absolute path, or read `system_profiler` or `ioreg`, would see this Pro and fail these tests on the model check.
- The Air's cores are compared through any of the CPU count keys the fake answers, all of which say 8. The design's "8 CPU cores" is the whole CPU, not the performance cores, so `hw.perflevel0.*` isn't faked, and a harness that read it would fail.
- Memory is matched exactly, 16 GiB (17179869184 bytes) for the Air, as the base matches 36 GiB for the Pro. 24 GB is a real Air M3 configuration, and the design says 16 GB, so it must not count.
- The neither machine's `why` must name both models. The test checks only that both strings `Mac15,7` and `Mac15,12` appear, not the wording.
- The lane's status on a counted machine is accepted as any of PASS, INITIAL or FAIL, as the issue says. Against 48's fake and the repo's budgets it is INITIAL, since 48's base has no harness.
