# Acceptance tests for #2980: the Mac's test grants read available memory from the kernel and budget 8 GiB a run

Drafted blind from issue #2980, `docs/parallel-proof.md` sections 6 and 13, the Dogfooding part of
`docs/technical-design.md`, AGENTS.md and the base commit `ee05e7257`. For style and sandbox technique I also read the
base's `scripts/throttle.mjs` and `tests/acceptance/2924/`, whose helpers these tests import. Per AGENTS.md the
implementing agent doesn't edit these tests; a dispute goes to a blind redraft.

The issue amends #2924 AC2 by platform, so `tests/acceptance/2924/test-grants.test.mjs`'s two AC2 memory cases were
redrafted in the same job: 48 GiB − 1 byte / 48 GiB on Linux, 16 GiB − 1 byte / 16 GiB on darwin, nothing else changed.

## Run

```sh
node --test 'tests/acceptance/2980/*.test.mjs'
node --test tests/acceptance/2924/test-grants.test.mjs
```

They must run under `node --test`: only inside a test run does a table of a test's own exist (section 6). About
30 s. Run on both machines: AC1's darwin case and AC2 run only on darwin, AC1's Linux case and AC3 only on Linux, and
each skips elsewhere naming the platform.

**The live table at `~/.deepbuild/throttle/` is never read or written.** AC2 and AC3 run `throttle.mjs` as a process
through `../2924/helpers.mjs`: `DEEP_THROTTLE_TABLE` on a fresh folder in the test's sandbox, a temporary `HOME`,
`DEEP_THROTTLE_READINGS` naming the test's readings file, each process in its own group, stopped by that group's PID.
AC1 imports `scripts/throttle.mjs` only to call `machineReadings()`, the surface the issue names for the machine's
readings, since no test may drive the machine's table on a Mac.

## The tests

| File | Criterion | Test |
|---|---|---|
| `readings.test.mjs` | AC1 | darwin: `machineReadings().memory` lies within one percentage point of `hw.memsize` of `kern.memorystatus_level × hw.memsize / 100`, `sysctl` read just before and just after the call (so not `os.freemem()`). |
| `readings.test.mjs` | AC1 | Linux: `memory` is `os.freemem()`, read just before and after (64 MiB slack for `MemAvailable` moving). |
| `readings.test.mjs` | AC1 | Both: `load` is `os.loadavg()[0]` (bracketed the same way) and `cores` is `os.cpus().length`. |
| `run-memory.test.mjs` | AC2 | darwin: one settling test grant held, load 1 on 64 cores: the second waits at 16 GiB − 1 byte. |
| `run-memory.test.mjs` | AC2 | darwin: as above, granted at once at exactly 16 GiB, the holder still running. |
| `run-memory.test.mjs` | AC3 | Linux: as above at 48 GiB − 1 byte (waits) and 48 GiB (granted at once). |
| `design.test.mjs` | AC4 | Sections 6 and 13 each: a sentence naming the Mac (or darwin) with `kern.memorystatus_level`; one naming the Mac with 8 GiB; one naming the Spark (or Linux) with 24 GiB (6 tests). |

"Granted at once" is the command started within 15 s and "waits" is not started 8 s after the request, as in #2924's
suite: on a loaded Mac a node process can take seconds to start.

## Gaps

- AC1's "not `os.freemem()`" is proved by the one-point tolerance only while the kernel's level and `os.freemem()`
  differ by more than a point of `hw.memsize`, which on the Mac they do by far (issue: 0.5 GiB against 16.6 GiB).
- AC2's and #2924's redrafted "waits at 16 GiB − 1 byte" pass on the base, which is stricter (it budgets 24 GiB a
  run everywhere); the granted-at-16-GiB case is what tells the change apart. AC3 is the base's behaviour, unchanged.
- AC4's facts are matched loosely, one sentence each; section 6's base text already pairs the Spark with
  `MemoryMax=24G`.

`BASE-FAILURE.txt` holds both runs on the base and why each test fails or passes there.
