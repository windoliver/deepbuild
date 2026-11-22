# Acceptance tests for #3067: the load, by who made it

Drafted blind from issue #3067, `docs/parallel-proof.md` sections 6 and 13 (section 6's bullet "The load, by who made
it (#3067)" and "Tables of a test's own"), the Dogfooding part of `docs/technical-design.md`, AGENTS.md and the base
commit `08f944cec`. For style and sandbox technique I also read the base's `scripts/throttle.mjs` and
`tests/acceptance/2924/`. The helpers are this suite's own; no test imports the code under test:
`scripts/throttle.mjs` is run as a process. Per AGENTS.md the implementing agent doesn't edit these tests; a dispute
goes to a blind redraft.

## Run

```sh
node --test 'tests/acceptance/3067/*.test.mjs'
```

On the Mac (the issue's "Runs on"). They must run under `node --test`: only inside a test run does a table of a
test's own exist (section 6). The whole command takes a little over 10 minutes, all of it `cost.test.mjs`:

| File | Takes | Load it makes |
|---|---|---|
| `report.test.mjs` | under 1 s | none |
| `sample.test.mjs` | about 15 s | 4 cores of spinning for a few seconds, three times, one after another |
| `ps-failure.test.mjs` | about 65 s (the sampler's second sample comes a minute after its first) | none |
| `cost.test.mjs` | 10 min 10 s (the criterion's 10 minutes), in a file of its own to be scheduled apart | none |

**The live table at `~/.deepbuild/throttle/` is never read or written.** Every `throttle.mjs` process gets
`DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's temp sandbox and a temporary `HOME` there, with
`DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT`, `DEEP_PROOF_VITEST_REPORT` and `DEEP_THROTTLE_READINGS` unset.
Each process starts in its own process group and is stopped after its test by that group's PID; `load` is stopped by
its own PID (SIGTERM). Nothing is stopped by name or port, and every spinner dies with its group.

## The surface

- `node scripts/throttle.mjs load`, stopped by its PID, and `load.log` in the table's folder: one JSON line a sample,
  the first at its start, with the fields section 6 states (`at`, `load`, `cores`, `grants` of `id`, `class`, `pid`,
  `cpu`, `compile`, `node`, `other`; `outside` of the same four numbers; `top` of `pid`, `command`, `cpu` and `grant`;
  or `failed` in place of the last three).
- `node scripts/throttle.mjs load --report`, over a fixture copied to `load.log` in the table's folder; its standard
  output, by the lines section 6 states.
- `node scripts/throttle.mjs <class> --wait 1 -- node spin.mjs <name> <cores>` holds a stub grant. The stub notes its
  pid and the `DEEP_THROTTLE` it sees (`<class>:<id>`, the grant's ID). For two nested grants the command is itself
  `throttle.mjs timed --wait 1 -- node spin.mjs ...` under a `test` grant: timed never passes through (section 6), so
  it is a second grant, nested in the first; the outer grant's ID is read from the table's `log` (`granted`, by the
  holder's pid).
- **The reference is the test's own `ps`**, the listing section 6 names (`/bin/ps -A -o pid=,ppid=,%cpu=,ucomm=`,
  `%cpu` over 100), read four times a second from 2 s before `load` starts until its first sample is in the log. "Within
  0.5 of a core" is: no more than 0.5 below the least and no more than 0.5 above the most that the stub's tree read
  in those listings.
- **A stub that "spins 2 cores" uses 2 cores, whatever the machine's load.** While these were drafted the Mac's
  1-minute load was 50 to 125 on 12 cores, and two spinning threads got 0.6 of a core between them. The stub is one
  process named `node` with 24 threads that spin only while the CPU the process has used is behind 2 seconds a second;
  `ps` read it at 1.97 to 2.01 cores. When the machine still can't give a stub 1 core in every listing, nothing would
  tell a right attribution from none at 0.5 of a core, so the test reads `INCONCLUSIVE` by a skip that says so, after
  its first assertion (that a sample was written), never a pass.
- **A `ps` failure** is arranged by PATH: `load` runs with a stub `ps` first on its PATH that hands every call to
  `/bin/ps` until a flag file appears, then prints an error and exits 1.

## The tests

| File | Criterion | Test |
|---|---|---|
| `sample.test.mjs` | #3067.d6d9116e | One `test` stub grant whose child (named `node`, asserted) uses 2 cores, and one ungranted `node` process using 2. The sample isn't failed, has `at`, `load` and `cores` (12). `grants` is exactly the one grant, by its ID, with class `test` and the holder's pid; its `cpu` and its `node` are within 0.5 of the tree's reading; `compile + node + other` is `cpu`. `outside.cpu` and `outside.node` hold at least the ungranted process's reading less 0.5, and the grant and `outside` don't sum above every process's reading (plus 1). `top` has five entries; the grant's child, when listed, names the grant's ID, command `node` and its CPU within 0.5; the ungranted process, when listed, names no grant; either must be listed when it led all but four processes by 0.5 of a core in every listing. |
| `sample.test.mjs` | #3067.a665617d | A spinner under a `timed` grant nested in a `test` grant. `grants` is exactly the two, with their classes and holders' pids; the outer's `cpu` is within 0.5 of the tree's reading, and the two `cpu` together are too (counted under both, they are twice it); the grants and `outside` don't sum above every process's reading (plus 1); `top`'s entry for the spinner, when listed, names the outer grant. |
| `sample.test.mjs` | #3067.4ec1293f | A granted and an ungranted stub, each started with a marked argument, a marked environment value (the sampler has it too) and a script under the sandbox's `HOME`; `throttle.mjs` itself runs from the checkout, under the user's home. `load.log`'s text holds none of: the argument, the environment value, the sandbox's `HOME`, the sandbox, the user's home, `.mjs`. Every text in the sample is `at`, a `class` of the four, an `id` or `grant` that is this table's grant, or a `command` with no `/` that equals what the test's own `ps` printed as that pid's `ucomm`; everything else is a number. |
| `ps-failure.test.mjs` | #3067.4573b740 | With the stub `ps` handing on, the first sample is a reading that lists the held grant. Once the stub fails, the next sample (50 to 100 s after the first) has a non-empty `failed`, `at`, `load` and `cores`, and no `grants`, `outside` or `top`; the log holds no path under a home; `load` is still running. |
| `cost.test.mjs` | #3067.4573b740 | `load` runs 10 minutes and 5 s beside one idle stub grant, as the child of a shell that then prints `times`. It is still running then, ends on a SIGTERM to its PID, wrote 10 or 11 samples, none failed, and its user and system CPU with the `ps` listings it waited for is under 1% of the elapsed time. |
| `report.test.mjs` | #3067.eebd7d07 | `above.log`: 8 samples on 12 cores, 6 over the cores (3 of them failed), one at a load of exactly 12 and one below. Prints `75% of minutes above the cores (6 of 8)` (or `75.0%`); exactly the lines `test 25.0%`, `build 12.5%` and `outside 62.5%...`, which add up to 100.0 (two test grants in one minute are one line; the two minutes not above would make test 42.1%); `outside`'s line goes on with `compile`, `node` and `other` and their three shares; a line with "fail" names 3. |
| `report.test.mjs` | #3067.eebd7d07 | `thirds.log`: one minute above, test, build and outside a third each. Each line is 33.3% or 33.4% and they add up to 100.0, not 99.9. |
| `report.test.mjs` | #3067.eebd7d07 | `calm.log`: 3 samples, none above (one at exactly 12). Prints `0% of minutes above the cores (0 of 3)` and no line for a class or `outside`. |

**#3067.eebd7d07's second sentence** ("The 24-hour table from the reference Mac is on this issue, with the follow-up
it names filed") is a step by hand: no test here covers it.

## Gaps and assumptions

- **A starved machine reads INCONCLUSIVE.** The two CPU tests skip, with the reason, when a stub's tree read under 1
  core in any listing. On the base they fail before that, at their first assertion.
- **`outside` is the whole machine**, so the ungranted process's 2 cores can't be read off it within 0.5: the test
  holds `outside` to at least that process's reading, and reads the process itself in `top` when it is there (it was,
  in every run here). A two-sided check of grants plus `outside` against every process's CPU failed a right program 1
  time in 16: the machine's sum moved by more than a core between two listings a quarter second apart. So the sum is
  held only from above, a core wide; a sampler that leaves a process out of both sums is caught only through `top`.
- **"The shares sum above the machine"** (#3067.a665617d) is that one-sided bound, which a double count of 2 cores
  can slip under on a machine whose sum is moving. The check that carries the criterion is the direct one: the two
  nested grants' `cpu` together within 0.5 of their tree's reading.
- **`ps` by PATH.** I assumed `load` runs `ps` by name, as the base's `throttle.mjs` does. A sampler that runs
  `/bin/ps` by its path never meets the stub; the test then fails at "doesn't say so in failed", and its message
  counts the stub's failed calls (0). The stub fails every call after the flag, the table folder's own lookups too;
  only a failure that begins after `load` has started is tested, since at its start a `ps` failure leaves it unable to
  tell which table is its own. A `ps` that can't be started at all (no such file) isn't tested.
- **"The table can't be read"** as a failed sample isn't tested: the table's file isn't a surface the issue or the
  design names. Every test holds a stub grant first, so whether a folder with no table yet reads as no grants or as
  failed isn't tested either.
- **Not asserted, since no criterion names them:** that `load` takes no grant, never takes the table's lock and
  writes nothing but its log; the machine's own `~/.deepbuild/throttle/load.log` (never touched here); `top`'s order;
  the form of `failed` beyond a non-empty text; the rounding of a sample's numbers (`compile + node + other` is held
  to `cpu` within 0.2).
- **"Each minute"** is held loosely: the second sample 50 to 100 s after the first, and 10 or 11 samples in 10
  minutes and 5 s.
- **Nesting** is tested for `timed` under `test`, the one nesting section 6 states for the CLI. The inner grant must
  have an entry of its own ("one entry for each grant in the table whose holder is running").
- **The report's open forms.** The first line's percentage is accepted as `75%` or `75.0%`. `outside`'s "own three
  shares" are accepted as shares of all (12.5, 30.0, 20.0) or of `outside` (20.0, 48.0, 32.0), in any order and form,
  so long as the line names `compile`, `node` and `other` and carries those three numbers and no other. The count of
  failed samples is any line with "fail" and the number; all 3 failed samples are above the cores, so "failed" and
  "failed among those above" are the same number. Only standard output is read; the exit status isn't asserted. Not
  tested: a class that held a grant only in minutes not above, the names `bay-pair` and `timed` as lines, a missing or
  empty log, a line that isn't a sample.
- **Cost.** The CPU is the shell's `times` for its children: the sampler and the processes it started and waited
  for. One idle grant is held; the cost with many grants or a longer process table isn't measured. The stop is
  SIGTERM.
- **Paths under a home folder** are the user's home (from the password database) and the sandbox's `HOME`; another
  user's home isn't planted.
- **darwin only**: `/bin/ps`, `ucomm` and `/bin/sh`'s `times` as macOS has them; nothing ran on Linux, whose units
  the issue leaves out.

## On the base

`BASE-FAILURE.txt` (base `08f944cec`, macOS, 12 cores, 1-minute load about 93): 8 fail, 0 pass, in 13 s. Every
failure is at an assertion and for the expected reason: the base has no `load` command, so `load` and `load --report`
print the usage line (`BLOCKED throttle: usage: ...`) and exit 2. The five sampling tests fail at "load wrote no
sample to load.log in the table's folder", the three report tests at "the share of minutes above the cores".

A throwaway planted sampler (a copy of the base's `throttle.mjs` with `load` and `load --report` added, kept outside
the checkout with a copy of this folder beside it, never committed; `scripts/` here is the base's, byte for byte)
passed all 8 in one run of the command above, at a 1-minute load of 80 to 110: the two CPU tests read the grant at
1.96 to 2.00 cores against the test's 1.7 to 2.0, and the cost test read 0.35 s of CPU in 606 s, 0.06% of one core,
over 11 samples. `sample.test.mjs` then passed 6 more times running.

The three wrong programs the criteria name, as switches of that copy, each fail their criterion's test:

| Wrong program | Fails | At |
|---|---|---|
| Attributes by process name (a process named `node`, `rustc` or `cargo` is never a grant's) | #3067.d6d9116e (and #3067.a665617d) | "the grant's cpu is 0; the test's own ps read 1.84 to 2.04 cores around the sample" |
| Counts a process under each of its nested grants | #3067.a665617d | "the two grants' cpu together ... is 3.956; the test's own ps read 1.87 to 1.99" |
| Writes zeros (`grants: []`, `outside` of zeros, `top: []`) when `ps` fails | #3067.4573b740 (`ps-failure.test.mjs`) | "the sample taken while ps failed doesn't say so in failed" |

Three more, for the criteria that name none: a sampler that lists `ps`'s `args` in place of `ucomm` fails
#3067.4ec1293f ("load.log holds a stub's argument"); a report over every minute, not those above, fails
#3067.eebd7d07's first test; and one that rounds each share down fails its thirds test (99.9).
