# Acceptance tests for #2980: the Mac's memory reading and a run's memory by platform (blind redraft naming criterion IDs)

Drafted blind from issue #2980, the base commit `ee05e7257`, AGENTS.md, the Dogfooding and Criteria to tests parts of
`docs/technical-design.md`, and `docs/parallel-proof.md` sections 6 and 13. For surfaces and house style only I also
read the base's `scripts/throttle.mjs`, `tests/acceptance/2924/` (README, `helpers.mjs`, `test-grants.test.mjs`,
`design.test.mjs`), `tests/throttle-readings.test.mjs` and `tests/acceptance/1113-redraft-2833/REDRAFT.md`. No
implementation of #2980 was seen. Per AGENTS.md the implementing agent doesn't edit these tests; a dispute goes to a
blind redraft.

Every test names its criterion by ID, `#2980.` and the first 8 hex of the SHA-256 of the criterion's text (the
`- [ ] ` dropped, trimmed, white space collapsed), checked against the issue file with node's crypto:

| ID | Criterion |
|---|---|
| `#2980.a3bd16e8` | 1. darwin `machineReadings().memory` = `kern.memorystatus_level` x `hw.memsize` / 100 (not `os.freemem()`); `load` = `os.loadavg()[0]`, `cores` = `os.cpus().length`; Linux `memory` = `os.freemem()` |
| `#2980.a86df9c6` | 2. darwin, one settling grant held: the second test request waits at 16 GiB - 1 byte, is granted at once at exactly 16 GiB |
| `#2980.bc75bb06` | 3. Linux: #2924 AC2's 48 GiB - 1 byte waits, 48 GiB granted at once, unchanged |
| `#2980.4c98823b` | 4. `docs/parallel-proof.md` sections 6 and 13 each state the Mac reads `kern.memorystatus_level` and budgets 8 GiB a run, the Spark 24 GiB a run |

## Run

```sh
node --test tests/acceptance/2980-redraft-ids/*.test.mjs
```

Under `node --test` only: a table of a test's own exists only inside a test run (section 6). About 40 s on the Mac.

## The surfaces

- `machineReadings()`, exported by `scripts/throttle.mjs` (the issue's Surface for the reading), imported and called
  in the test process. Importing the script runs nothing; its CLI runs only as node's main script. A missing export
  fails at `assert.equal(typeof machineReadings, 'function')`, never as an import error. Each value is bracketed by
  `sysctl -n kern.memorystatus_level` (darwin), `os.freemem()` (Linux) or `os.loadavg()[0]`, read just before and just
  after the call; `hw.memsize` is read once.
- `node scripts/throttle.mjs test --wait 1 -- node stub.mjs <name> [exit]`, run as a process through
  `tests/acceptance/2924/helpers.mjs` (imported, not copied): `DEEP_THROTTLE_TABLE` in the test's sandbox, a temporary
  `HOME`, `DEEP_THROTTLE_READINGS` naming a file of `{"memory", "load", "cores"}`. **The live table at
  `~/.deepbuild/throttle/` is never read or written**, and every process is stopped by its own process group's PID.
  `grants.mjs` holds the scene criteria 2 and 3 share.
- `docs/parallel-proof.md` sections 6 and 13.

"Granted at once": the second's command starts within 30 s (the Mac ran at a 1-minute load of 65-90 on 12 cores while
these were drafted). "Waits": its command hasn't started, and its `throttle.mjs` still runs, 8 s after the request, or
twice the time the holder's command took to start when that is longer, so a program that grants at once on a loaded
machine has had time to start the command. The held grant has just started, so it is settling (under 5 minutes old).

## The tests and their wrong programs

Each test must fail on the wrong program in its row, from which a twin can be planted (a copy of the change with that
one edit).

| File | Test | Fails on (planted wrong program) |
|---|---|---|
| `readings.test.mjs` | `#2980.a3bd16e8` on darwin, `machineReadings().memory` is `kern.memorystatus_level` x `hw.memsize` / 100 as sysctl reads them, not `os.freemem()` (darwin only) | darwin memory read as `os.freemem()`; also no `machineReadings` export (the base) |
| `readings.test.mjs` | `#2980.a3bd16e8` on Linux, `machineReadings().memory` is `os.freemem()` (Linux only) | Linux memory read as `os.totalmem()` (or `MemFree`); also no export (the base) |
| `readings.test.mjs` | `#2980.a3bd16e8` `machineReadings().load` is `os.loadavg()[0]` and `cores` is `os.cpus().length` (everywhere) | load read as `os.loadavg()[1]` (5-minute); cores as a fixed number; no export (the base) |
| `darwin-grants.test.mjs` | `#2980.a86df9c6` ... a second request waits at memory 16 GiB - 1 byte, load 1 on 64 cores (darwin only) | darwin settling grant reserving nothing (`memory >= RUN_MEMORY`), or darwin run memory 4 GiB |
| `darwin-grants.test.mjs` | `#2980.a86df9c6` ... a second request is granted at once at exactly 16 GiB, load 1 on 64 cores (darwin only) | darwin run memory 24 GiB (the base); memory compared with `>` instead of `>=` |
| `linux-grants.test.mjs` | `#2980.bc75bb06` ... a second request waits at memory 48 GiB - 1 byte, load 1 on 64 cores (Linux only) | Linux run memory 8 GiB (the Mac's budget applied on every platform) |
| `linux-grants.test.mjs` | `#2980.bc75bb06` ... a second request is granted at once at exactly 48 GiB, load 1 on 64 cores (Linux only) | Linux run memory 32 GiB; memory compared with `>` instead of `>=` |
| `design.test.mjs` | `#2980.4c98823b` section 6 states the Mac reads `kern.memorystatus_level` and budgets 8 GiB a run, and the Spark 24 GiB a run | section 6 without the Mac's `kern.memorystatus_level` or its 8 GiB (the base) |
| `design.test.mjs` | `#2980.4c98823b` section 13 states the same | section 13 without the Mac's 8 GiB; the base |

## Gaps and assumptions

- **One platform per run.** Criterion 1's darwin case and criterion 2 run only on darwin; criterion 1's Linux case and
  criterion 3 only on Linux. Each skip names the platform. Here (a Mac) the Linux tests were never run; on a Linux base
  criterion 3's two tests are expected to pass (they are #2924 AC2's numbers) and fail only on their twins.
- **Criterion 2's waits test passes on the base**: the base reserves 24 GiB and needs 24 GiB, so it waits at
  16 GiB - 1 byte too. Its proof is its twins above, not the base.
- **"Within one percentage point"** is read as: memory between (the lower of the two `kern.memorystatus_level`
  readings - 1) and (the higher + 1) percent of `hw.memsize`. A reading such as `vm_stat` free + inactive + purgeable
  (about 9.6 GiB against 16.6 GiB in the issue) falls far outside that window, but one that happens to land within a
  point of the kernel's level would pass.
- **Linux memory** is allowed 64 MiB of slack beyond the two `os.freemem()` reads, since `MemAvailable` moves while
  anything runs.
- **load** is checked between two `os.loadavg()[0]` reads, without slack. The 5-minute mutant failed here only
  because the two averages differed; on a machine whose 1- and 5-minute loads are equal to the last bit it would pass.
- **`BLOCKED throttle` when the reading can't be taken** isn't a criterion and isn't tested: no surface lets a test
  break `sysctl` for the machine's table, which no test may drive on a Mac.
- **Criterion 4** is matched by words, not meaning: `kern.memorystatus_level` anywhere in the section, and a sentence
  or table row naming the Mac (or darwin, macOS) beside 8 GiB (GB, G), and one naming the Spark (or Linux) beside
  24 GiB. A section that only refers to the other section fails.
- **Timing under load.** A program that grants at once but takes longer than the waits span to start the command
  would pass a waits check; the span scales with the holder's start time to make that unlikely.

## On the base

`BASE-FAILURE.txt`: on `ee05e7257`, darwin, one run: 5 fail, 1 pass, 3 skipped (Linux only), each for the expected
reason (no `machineReadings` export, 16 GiB not enough under the base's 24 GiB, sections without the Mac's reading
and budget). A throwaway planted twin (never committed) passed all 6 darwin-run tests, and five of its mutants failed
as the table names.
