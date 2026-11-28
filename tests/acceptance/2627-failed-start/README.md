# Acceptance test for #2627, AC1: A failed start leaves nothing

A blind job drafted this test before any fix existed, from these sources only:

- issue #2627 and its comments (the comments are about AC2; the issue body describes the hang this criterion names)
- `docs/technical-design.md` and `AGENTS.md`
- the base commit `254bdc87c`, which has no fix; there I read `tests/proof-binaries-lease-loss.test.mjs` (the test
  under scrutiny), `tests/acceptance/1123/helpers.mjs` (its sandbox), `scripts/lease`, the parts of
  `scripts/throttle.mjs` that choose the table and admit a build, `scripts/proof-change.mjs`'s `criterionId`, and
  `tests/acceptance/2627/` (AC2's suite) for conventions

AC2 (`affected.mjs` bounds a file that never exits) is `tests/acceptance/2627/`'s, not this folder's. The helpers are
written here; nothing is imported from the code under test or from another suite. Per AGENTS.md the implementing agent
doesn't edit this test; a dispute goes to a blind redraft by this job.

Run it with:

```sh
node --test tests/acceptance/2627-failed-start/failed-start.test.mjs
```

It needs the built CLI (`packages/cli/dist/main.js`, from `npm run build --workspaces`), as the test under scrutiny
does, and must run under `node --test` (it reads BLOCKED otherwise): the throttle honours `DEEP_THROTTLE_TABLE` only
inside a test run, and outside one the slot holders below would take the machine's slots. It is offline and uses
real processes only: the unmodified test file under a real `node --test`, its real fixture chain, and the real
`scripts/throttle.mjs` command line for the holders.

## Criteria to tests

The ID is `#2627.<first 8 hex digits of the SHA-256 of the criterion's text after "- [ ] ", trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` works it out.

| Criterion | Test (file) | What it requires |
|---|---|---|
| AC1 `#2627.b782c214` **A failed start leaves nothing.** Given the builder's `ready` file doesn't appear within the wait, when the test fails, then no process from its fixture is alive and the test file's process exits. | `failed-start.test.mjs` | Runs `node --test --test-reporter=tap tests/proof-binaries-lease-loss.test.mjs` while its builder can't start, then requires, in one comparison: the file did not pass; the file's process (and the `node --test` runner) exited within 11 min of its start; and 60 s after that exit no process of the run is alive |

"Alive" is read by PID and start time (`ps -o stat= -o lstart= -p <pid>`, in UTC and the C locale); a zombie
doesn't count. The processes of the run are collected every 250 ms while it runs, then through the 60 s after: the
`node --test` runner the test spawned, every process whose parent is one already collected (by PID and start, so a
reused number isn't followed), and every process whose command line names the run's own `TMPDIR` (so a stage
reparented away before a look, such as `build.mjs`, is still found). That covers the owner (`owner.mjs`), `deep lease`
(`scripts/lease`, which execs `throttle.mjs build`, then `deep lease`), `proof-bin-build.mjs` and its `--worker`,
`build.mjs` and its `node -e setInterval` worker, and the test file's own process.

## The surface (my choice where the issue leaves it open)

- **How the `ready` file is kept from appearing:** through a surface that exists at the base. The test under scrutiny
  starts its builder through `scripts/lease`, which waits for a `build` grant of the throttle table. Inside a test run
  that table is `DEEP_THROTTLE_TABLE`'s folder, which the `1123` sandbox passes on. So the test gives the run a table
  of its own and first fills every `build` slot of it (4 on macOS, 6 elsewhere, the base's ceilings) with real
  `node scripts/throttle.mjs build -- node -e <idle>` holders. The lease then waits in line, nothing past it starts,
  and the `ready` file can't appear before the file reports, whatever the length of its wait. The holders are let go
  only after the check. This is the issue's situation (the builder held up past the test's wait, as by load), reached
  without stopping or slowing any process. No new knob is named.
- **"The test fails":** read from the file's TAP as "did not pass": a `not ok` line, a SKIP/TODO (a fix that reads the
  failed start BLOCKED or INCONCLUSIVE that way), or no result. Only an `ok` with a zero exit is a pass.
- **"Exits":** within 11 min of its start. The issue sets no bound; 11 min leaves room for a fix that waits longer for
  the builder on a loaded machine, and keeps the whole test under the 20 min lane cap (the test's own limit is 19 min).
- **"No process alive":** 60 s after the exit, for a fix whose ending of the fixture runs on briefly after the file's
  process exits.
- **A setup check:** if `build.mjs` was seen before the file reported, the test reads INVALID rather than judging a
  start that wasn't held.

## What the test can't see

- **A start held up anywhere else.** Only the lease's grant wait is held; a builder slow inside `proof-bin-build.mjs`
  or `build.mjs` isn't run. A fix that ends the owner's whole tree covers both, but only this one is proven.
- **The builder starting late.** In the issue the `ready` file appeared after the deadline. Here the slots are let go
  only after the check, because at the base the sandbox is removed when the file ends, so a lease let through then
  dies on its own (its CLI path is gone) and would hide the leak.
- **The issue's own hang**, an owner that stayed alive though `t.after` SIGKILLed it. Why it did isn't established, and
  it isn't reproduced; if it recurs, the "exits" and "no process alive" parts catch it.
- **The other `tests/proof-binaries-*.test.mjs` files** (scan, timeout, supervisor, supervisor-safety). The issue's
  scope asks to check them, but the criterion names only "the test", so they aren't run here.
- **A process that escaped both ways of collecting it:** one whose parent ended before a look and whose command line
  doesn't name the run's `TMPDIR`. The `node -e setInterval` worker could be one only if `build.mjs` ran and ended
  between two looks, which the held start rules out.
- **Linux.** Drafted and run on macOS.

## On the base

`BASE-FAILURE.txt` holds the run at `254bdc87c` (about 78 s). It fails at its one comparison for the criterion's
reason: the file did fail (`builder started`, line 20) and its process exited after 15 s, but 60 s later the fixture's
`deep lease` stage (`throttle.mjs build`, waiting for its grant, reparented after `t.after` SIGKILLed the owner) was
still alive. At the base `t.after` kills only the owner and `leasePid`/`built`'s PIDs, which a failure at line 20
leaves unset. No planted wrong program is shipped: the base itself is the wrong program. Not run against any fix.

## Files

- `helpers.mjs`: the process table and the collection of a run's processes, the scratch folder and environment, the
  slot holders, the TAP verdict.
- `failed-start.test.mjs`: the test.
- `BASE-FAILURE.txt`: the run on the base, paths redacted.

No fixture holds a secret or personal data.
