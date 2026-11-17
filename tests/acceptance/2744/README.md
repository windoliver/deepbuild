# Acceptance tests for #2744: one throttle table per machine, and a hung grant can't stop the machine

These tests were drafted blind from issue #2744 (its text on 2026-11-16), `docs/parallel-proof.md` section 6 (the
bullets "Tables of a test's own", "A hung holder's bound (#2744)" and "A stuck drain (#2744)"), the Dogfooding part
of `docs/technical-design.md`, AGENTS.md and the base commit `9754e168e`, which has no implementation. At the base I
also read `scripts/throttle.mjs` and `tests/acceptance/1113/` for style. The helpers are written here, never imported
from another suite, and no test imports the code under test: `scripts/throttle.mjs` is run as a process. Per
AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

Run them with:

```sh
node --test 'tests/acceptance/2744/*.test.mjs'
```

They must run under `node --test` (or a runner that is), since section 6 lets a request use `DEEP_THROTTLE_TABLE`
only inside a test run; run as plain `node`, the fixed throttle reads `BLOCKED throttle` and the tests fail, never
touching the live table. All 5 are offline, on real processes: `throttle.mjs` itself and stub commands (a small node
script that notes when it starts and holds until a stop file appears). The suite takes about 45 s on the Spark under
load; the longest test is about 30 s. On the base all 5 fail at their assertions, as `BASE-FAILURE.txt` shows.

**No test reads or writes the live table at `~/.deepbuild/throttle/`.** Every `throttle.mjs` process a test starts
gets `DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's temp sandbox, a temporary `HOME` in that sandbox,
and `DEEP_THROTTLE`, `DEEP_PERF_LOCK`, `NODE_TEST_CONTEXT` and `DEEP_PROOF_VITEST_REPORT` unset. On the base, which
doesn't read `DEEP_THROTTLE_TABLE`, the table falls into each temporary `HOME` instead, which is how the base fails
AC1. Each process starts in its own process group, and after the test only those groups are stopped, by their PIDs.

## The surface (my choice where the design leaves it open)

- **CLI.** `node scripts/throttle.mjs <class> [--wait <min>] [--hold <min>] -- <command ...>`, the options in either
  order before `--`. `--wait` and `--hold` take decimal minutes; the tests use `--hold 0.05` and `0.02`, `--wait`
  from `0.05` to `1`.
- **The table seam.** Inside a test run, a request uses `DEEP_THROTTLE_TABLE`'s folder when it is set, whatever its
  `HOME`. AC1's "one table per machine, whatever HOME" is proven through this seam: the issue's real case, the
  password database's home, can only be shown on the live table, which no test may touch.
- **The log.** `<table folder>/log`, one JSON object per line with an `event` key. The tests read `expired` (a line
  naming the grant's id anywhere in it), `released` (with `id`) and `timeout` (with `class` and `blockers`, a list
  whose JSON contains each blocker grant's id). Other keys and lines are ignored.
- **The grant id** is what the command sees in `DEEP_THROTTLE=<class>:<id>`, as on the base.
- **An expired grant (AC2).** Its `throttle.mjs` prints, on stdout, a line starting
  `INCONCLUSIVE throttle: the test grant <id> was held past its <min> min bound while another request waited; its
  command was stopped`, with `<min>` the `--hold` value as given (`0.05`), and exits 3. Its command, and that
  command's child, are gone (or unreaped zombies) within 5 s of that exit. The test doesn't care whether the
  release comes before or after the 10 s SIGKILL; it allows 45 s from the waiter's request for the grant.
- **A stuck drain (AC3).** The timed request exits non-zero. Its first stdout line starts `INCONCLUSIVE no grant`
  and goes on with `; blocked by test grant <id> held by pid <pid> since <time> (<command>)`. `<pid>` may be the
  holder's `throttle.mjs` process (the grant's holder in the table) or its command's pid; `<command>` must contain
  the holder's command line (the tests look for its stub's name); `<time>` isn't read.
- **Limits.** Section 6's test limit: 2 on macOS, 4 elsewhere.
- **The load gate.** A top-level timed request waits for load below the core count, and the Spark is often far
  above. So no test needs a timed request to be granted: AC3's timed requests are blocked by a holder that never
  finishes, whatever the load. AC2's "the waiting request is granted" is proven with a waiting test request; the
  timed-waiter test accepts either a grant or, when the load kept it out, a timeout that doesn't name the released
  grant as a blocker.

## The tests

| File | Criterion | What it checks |
|---|---|---|
| `machine.test.mjs` | `#2744.e34b52c0` AC1 | The test limit's worth of holders, each with its own `HOME`, all hold; a request from yet another `HOME` hasn't run 3 s later and is still waiting; once one holder finishes, it runs and exits 0, and the other holders run on. |
| `hung.test.mjs` 1 | `#2744.e68bc50e` AC2 | A test grant with `--hold 0.05` whose command ignores SIGTERM and has a child that ignores it too, plus the rest of the test slots held inside their default bound; a waiting test request is granted within 45 s, not before the bound passed; the hung run exits 3 with the expired line naming its grant, no `PASS` line; its command and child are gone; the log has `expired` then `released` for the grant; the other holders still run. |
| `hung.test.mjs` 2 | `#2744.e68bc50e` AC2 | A test grant with `--hold 0.02` and nothing waiting runs on 4 s later, with no `expired` in the log; once a timed request waits, the grant ends within 20 s: exit 3, the expired line, the command gone, `expired` and `released` logged; the timed request is then granted, or (load) its timeout doesn't name the released grant. |
| `drain.test.mjs` 1 | `#2744.303fcdcd` AC3 | A test holder that never finishes; a timed request with `--wait 0.05` never runs its command, exits non-zero, and its first line names the holder's grant id, pid and command; the log's `timeout` lists the grant in `blockers`; a test request that queued behind the drain then runs; the holder runs on. |
| `drain.test.mjs` 2 | `#2744.303fcdcd` AC3 | After one drain gave up on the holder, a second timed request pends behind the same holder; a new top-level test request with `--wait 0.1` still runs while it pends (the marked blocker no longer lets a pending timed request stop new grants). |

## Wrong programs

The base fails every test at an assertion for its criterion's reason (`BASE-FAILURE.txt`): AC1 because each `HOME`
gets a table of its own, so the fifth request runs at once; AC2 because there is no `--hold` (the base answers
`BLOCKED throttle: usage`, so no hung grant is ever held, let alone ended); AC3 because the no-grant line names no
blocker, and a later timed request drains again behind the same holder.

The planted twins need a working implementation minus one rule, so none is shipped and there is no `twins.json`:
the base alone already fails each test. To check that the tests can pass and that they catch plausible wrong
programs, I wrote a throwaway reference `throttle.mjs` in a scratch tree (never committed); it passes all 5. These
twins of it each failed as listed at the end of `BASE-FAILURE.txt`:

- **AC2, releases the grant but never stops the command** (`no-stop`): caught by `gone(pid)` on the command and its
  child, in both hung tests.
- **AC2, SIGTERM only, no SIGKILL of the tree** (`term-only`): caught in hung test 1, whose command and child ignore
  SIGTERM.
- **AC2, stops it but reads as a pass** (`exit0`): caught by `status === 3`; a `PASS` line is refused too.
- **AC2, ends every grant at its bound, waiter or not** (`no-waiter-needed`): caught in hung test 2's quiet 4 s.
- **AC2, ends grants before their bound, or ends all of them**: hung test 1 refuses a waiter granted before the
  bound and requires the other holders to run on (reasoned, not planted).
- **AC3, gives up without naming the holder** (`unnamed`): caught by drain test 1's line match.
- **AC3, names the holder but a later timed request still drains every new grant** (`unmarked`): caught by drain
  test 2.
- **AC3, names some other grant or pid**: drain test 1 compares the id with the holder's `DEEP_THROTTLE` and the pid
  with the holder's (reasoned, not planted).
