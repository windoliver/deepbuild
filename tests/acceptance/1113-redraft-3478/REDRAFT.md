# Blind redraft of #1113's test of an affected.mjs job's wait, which #3478's stall contradicts

#3478 has an `affected.mjs` run ask for its grant with a stall of 720 minutes in place of section 6's fixed 30-minute wait. `tests/acceptance/1113/waits.test.mjs` › `#1113.a0183037 an affected.mjs job waits up to 30 minutes for its grant, its node --test block as test` reads `wait: 30` from every top-level entry of the run's throttle log. On the change the run's entry carries `stall: 720` and no `wait`, so the original fails (`NaN !== 30`). This folder redrafts that one test from #1113's criterion (as `tests/acceptance/1113/README.md` quotes it), #3478's text, the design (Dogfooding; `docs/parallel-proof.md` section 6) and the base `1b4929ae7`, drafted by a blind job.

The original is not edited or deleted; a person approves the swap (#3478's Scope records the owner's approval, 2026-11-25, on PR #3483). Run with:

```
node --test tests/acceptance/1113-redraft-3478/waits.test.mjs
```

`waits.test.mjs` imports `tests/acceptance/1113/helpers.mjs`, unchanged, and runs the probe `tests/acceptance/1113/fixtures/probe.test.mjs` where it is. There is no helper file here.

## What each redraft replaces

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `1113/waits.test.mjs` › #1113.a0183037 an affected.mjs job waits up to 30 minutes for its grant, its node --test block as test | #1113.a0183037 | #3478: with `DEEP_TEST_GRANT_WAIT` unset the run's grant is asked for with a stall of 720 minutes, so its log entries carry `stall: 720` and no `wait` | `waits.test.mjs` › #1113.a0183037 an affected.mjs job waits on a stall of 720 minutes for its grant, with no fixed wait, its node --test block as test |

What the redraft keeps: the same run (`scripts/affected.mjs` in this checkout on the probe, with only `HOME` the sandbox's, its selection read first), the probe's `node --test` job running under a `test:` grant, and a top-level `test` entry in the log. What it changes: every top-level entry's `stall` is 720 and none has a `wait`, where the original read `wait` 30.

## Kept as they are

- `1113/waits.test.mjs` › #1113.a0183037 a lane command waits up to 30 minutes for its grant, as build for an unlisted command, and › #1113.a0183037 a measured run's top-level timed waits up to 60 minutes: preflight, and perf started by hand: carried here with their names, criterion IDs and assertions unchanged, so that this file stands in for the original, which runs by hand only once the redraft is listed. Lane commands and measured runs are out of #3478's scope.
- Every other file of `tests/acceptance/1113/`, its helpers, fixtures, twins and `twins.json` (the redraft keeps the criterion ID).

## On the base and on the change

Run on the Spark (Linux, 20 cores, 1-minute load about 30 to 45), the file once per program, each in a memory-capped transient unit (`systemd-run --user -p AppArmorProfile=claude-desktop -p MemoryMax=24G -p MemorySwapMax=2G`, `CARGO_BUILD_JOBS=2`), one at a time. The tests point `HOME` at a sandbox, as the original does, so the machine's own throttle table wasn't touched.

On the base `1b4929ae7` the redrafted test fails for the expected reason, the base's grant being a 30-minute wait:

```
$ node --test tests/acceptance/1113-redraft-3478/waits.test.mjs
✔ #1113.a0183037 a lane command waits up to 30 minutes for its grant, as build for an unlisted command (1300.386539ms)
✖ #1113.a0183037 a measured run's top-level timed waits up to 60 minutes: preflight, and perf started by hand (1564.09633ms)
    scripts/preflight.mjs made one top-level timed grant
✖ #1113.a0183037 an affected.mjs job waits on a stall of 720 minutes for its grant, with no fixed wait, its node --test block as test (209336.080237ms)
    an affected.mjs job's grant stall: {"at":"2026-11-25T07:05:36.075Z","event":"granted","class":"test","grant":"top-level","id":"55e1de8bb6853cda","pid":717980,"index":1,"load":31.31,"cores":20,"wait":30,"run":true,"readings":null}
    NaN !== 720
ℹ pass 1
ℹ fail 2
```

On the change (`bb9a70a22`) it passes:

```
$ node --test tests/acceptance/1113-redraft-3478/waits.test.mjs
✔ #1113.a0183037 a lane command waits up to 30 minutes for its grant, as build for an unlisted command (1279.662557ms)
✖ #1113.a0183037 a measured run's top-level timed waits up to 60 minutes: preflight, and perf started by hand (1866.853775ms)
    scripts/preflight.mjs made one top-level timed grant
✔ #1113.a0183037 an affected.mjs job waits on a stall of 720 minutes for its grant, with no fixed wait, its node --test block as test (356496.422955ms)
ℹ pass 2
ℹ fail 1
```

The carried tests read as the original's do on each side. The lane command's passes on both. The measured run's fails on both, on the same line as the original on the base: the scratch repository's preflight ends before its timed grant (`Cannot find package 'typescript' imported from …/repo/scripts/proof-binaries.mjs`). That failure is the base's, not #3478's, and the carried test is not bent to it.

The wrong program for the redrafted test is the merge base itself (a fixed 30-minute wait).
