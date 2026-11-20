# Acceptance tests for #2924: test grants past the first are sized by memory and load, under a ceiling

Drafted blind from issue #2924 (as edited on 2026-11-20: `DEEP_THROTTLE_READINGS` names a file, read again at each
look while a request waits), `docs/parallel-proof.md` sections 6 and 13, the Dogfooding part of
`docs/technical-design.md`, AGENTS.md and the base commit `58d3e19ee`. For style and sandbox technique I also read the
base's `scripts/throttle.mjs` and `tests/acceptance/2833/`. The helpers are this suite's own; no test imports the code
under test: `scripts/throttle.mjs` is run as a process. Per AGENTS.md the implementing agent doesn't edit these
tests; a dispute goes to a blind redraft.

## Run

```sh
node --test 'tests/acceptance/2924/*.test.mjs'
```

On the Spark, in a capped unit, started detached:

```sh
systemd-run --user --collect -p AppArmorProfile=claude-desktop -p MemoryMax=24G -p MemorySwapMax=2G \
  --setenv=PATH="$PATH" --working-directory="$PWD" --unit=blind-2924-$$ \
  sh -c "node --test 'tests/acceptance/2924/*.test.mjs' > out.txt 2>&1"
```

They must run under `node --test`: only inside a test run does a table of a test's own exist (section 6). About 40 s.

**The live table at `~/.deepbuild/throttle/` is never read or written.** Every `throttle.mjs` process gets
`DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's temp sandbox and a temporary `HOME` there, with
`DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_PROOF_VITEST_REPORT` and `DEEP_THROTTLE_READINGS`
unset unless a test sets one. The two AC5 cases that need the machine's table run `throttle.mjs` under `bwrap` with
a fresh tmpfs over the user's `~/.deepbuild` (the home from the password database), which a guard checks from inside
(`mountpoint` and empty) before `throttle.mjs` starts; whatever the program does, the real folder is out of its
reach. Where bwrap can't do that, those cases are skipped `INCONCLUSIVE`, never run on the live table. Each process
starts in its own process group and is stopped after its test by that group's PID.

## The surface

- `node scripts/throttle.mjs <class> --wait 1 -- node stub.mjs <name> [exit]`. The stub notes its start and the
  `DEEP_THROTTLE` it sees (`<class>:<id>`), then holds until a stop file appears, or exits at once.
- `DEEP_THROTTLE_READINGS=<file>`, the file holding `{"memory", "load", "cores"}`, rewritten whole (by rename) to
  change the readings during a wait.
- `<table folder>/log`: the `granted` entry with `class: "test"` and the request's `pid`.
- `docs/parallel-proof.md` sections 6 and 13.
- "Granted at once": its command starts within 15 s. "Waits": its command hasn't started 8 s after the request and
  its `throttle.mjs` is still running. The spans are wide because the Spark ran at a 1-minute load of 130-190 on 20
  cores while these were drafted, and a node process took seconds to start (README: Gaps).

## The tests

| File | Criterion | Test |
|---|---|---|
| `test-grants.test.mjs` | AC1 | No test grant held: granted at once under readings of load 50 on 4 cores and 0 bytes. |
| `test-grants.test.mjs` | AC2 | One held: the second waits under load 8 on 8 cores (load = cores). |
| `test-grants.test.mjs` | AC2 | One held, under 5 min old: the second waits under 48 GiB - 1 byte, load 1 on 64. |
| `test-grants.test.mjs` | AC2 | One held: the second is granted at once under exactly 48 GiB, load 1 on 64, the holder still running. |
| `test-grants.test.mjs` | AC3 | Waiting on load 100 on 8; the file is rewritten to load 1; granted without a restart, the holder still running. |
| `test-grants.test.mjs` | AC3 | Waiting on 10 GiB; the file is rewritten to 64 GiB; granted without a restart, the holder still running. |
| `ceiling.test.mjs` | AC4 | Readings with room for far more (1024 GiB, load 0 on 1024): 6 grants on Linux (2 on darwin) hold, the next waits 8 s, and runs once one holder finishes. |
| `ceiling.test.mjs` | AC5 | The same without `DEEP_THROTTLE_READINGS`: up to the ceiling, as before. |
| `blocked.test.mjs` | AC5 | One held; a second request whose file is missing / not JSON / missing `cores` / non-numeric `memory` / `cores` 0: `BLOCKED throttle` naming `DEEP_THROTTLE_READINGS`, exit 2, command not started (5 tests). |
| `blocked.test.mjs` | AC5 | A waiting request whose file is rewritten to not-JSON: BLOCKED as above ("whenever it is read"). |
| `blocked.test.mjs` | AC5 | Inside a test run, on the machine's table (`HOME` the user's own, `DEEP_THROTTLE_TABLE` unset), under the bwrap tmpfs: BLOCKED as above. |
| `blocked.test.mjs` | AC5 | Outside a test run (bwrap's new PID namespace, so no `node --test` in the process table), under the tmpfs: BLOCKED as above. |
| `log.test.mjs` | AC6 | The first grant's entry carries its readings; a second that waited carries the rewritten readings it was granted on. |
| `log.test.mjs` | AC6 | Without `DEEP_THROTTLE_READINGS` on a test's own table: `readings` present and `null`. |
| `other-classes.test.mjs` | AC7 | build: 2 (darwin 1) granted at once under crowded readings (load 1000 on 1, 0 bytes); the next waits for a slot. |
| `other-classes.test.mjs` | AC7 | bay-pair: the same with 3 (darwin 1). |
| `other-classes.test.mjs` | AC7 | timed follows the machine's load, not the readings: see Gaps. |
| `design.test.mjs` | AC8 | Sections 6 and 13 each mention the first grant, memory, load, the ceiling (or cap), 24 GiB (or GB/G) and 5-minute settling, matched loosely. |
| `design.test.mjs` | AC8 | Their tables keep 6 (Spark) and 2 (Mac) for test. |

## Gaps and assumptions

- **AC7's timed case depends on the machine's load**, which a test can't set. When the 1-minute load is under 0.75 x
  the cores, it checks that crowded readings don't make timed wait; over 1.25 x, that idle readings don't let it
  through (waits 8 s); in between it is skipped `INCONCLUSIVE`. Each run proves one side only.
- **darwin**: AC4, AC5's ceiling case and AC7 use 2 / 1 / 1 on darwin; they ran only on Linux here.
- **The malformed-file cases hold one test grant first**, so the file must be read to decide. Whether a malformed
  file with no grant held is BLOCKED depends on whether it is read then ("whenever it is read"), so that isn't tested.
- **Settling past 5 minutes** (a held grant older than 5 minutes stops reserving 24 GiB) isn't tested: it needs a
  5-minute hold, past the suite's time budget, or a grant time set in the table, which no named surface allows.
- **AC8** is matched by words, not meaning: each of sections 6 and 13 must name every fact. A design that states
  them in section 6 only and refers to it from 13 fails.
- **Timing under load.** "Waits" is 8 s: a program that grants at once but takes over 8 s to start the command
  would pass a waits check. On the base under load 130-190 every waits check failed as expected; in a first draft
  with a 3 s span, one AC3 test passed on the base because the base took over 3 s to start the second command.

## On the base

`BASE-FAILURE.txt` (base `58d3e19ee`, Linux, the capped unit above): 16 fail, 9 pass. Every failure is for the
expected reason: the base grants a second test grant regardless of readings (AC2, AC3, AC6's first test, and the
malformed-file cases, whose command starts), takes a grant on the machine's table (hidden under the tmpfs) despite a
set `DEEP_THROTTLE_READINGS`, logs no `readings`, and its design states no rule. Those passing on the base are the
unchanged behaviour: AC1 (a first grant was always at once), AC2's granted-at-once case, AC4 and AC5's ceiling (6 on
Linux), AC7, and AC8's tables.

A throwaway planted twin (a copy of the base's `throttle.mjs` with the rule, the file readings, the BLOCKED cases
and the log field, and the two design paragraphs; never committed) passed all 25. Two mutants of it failed as the
criteria name: readings read once and cached (both AC3 tests fail), and memory `> 24 GiB` instead of `>=` (AC2's
exactly-48-GiB case fails).
