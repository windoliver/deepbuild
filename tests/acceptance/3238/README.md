# Acceptance tests for #3238: `scripts/lease` never runs a command bare

## Sources

Drafted blind from issue #3238 (its text on 2026-11-23) and its comment "Decision taken" (option (a): the script
always runs its command under `scripts/throttle.mjs build`, passing through on an ancestor's grant, else waiting for a
top-level build grant; the wait in minutes from `DEEP_LEASE_WAIT`, AC3's wait of 0 being `DEEP_LEASE_WAIT=0`;
`DEEP_HUB_PLANT=lease-script-runs-directly` kept), `docs/parallel-proof.md` sections 6, 7a and 13, the Lease and
Dogfooding parts of `docs/technical-design.md`, AGENTS.md and the base commit `f8c6cff82`, which has no
implementation. For surfaces only I read, at the base, `scripts/lease`, `scripts/throttle.mjs` (the CLI, `acquire`,
the log's `granted`, `passed` and `timeout` entries, tables of a test's own), `packages/hub/src/heavy.ts`
(`leaseCommand`, `unleased`), `packages/hub/src/paths.ts` (`hubAddress`: the hub is found under `HOME`),
`scripts/affected.mjs` (`LIGHT`, `run`), `scripts/proof-change.mjs` (`criterionId`) and, by searching for a few words,
`packages/cli/src/main.ts` and `packages/hub/src/plant.ts`; for the house format, `tests/acceptance/2869/` (README,
helpers), parts of `3067/` and `2924/`, `1113/twins/README.md`, and `1015/` with `1015/redraft/`. `2744/` and `2902/`
I only listed. Beyond the brief's list I also read, at the base, `packages/hub/src/paths.ts` (named above), parts of
`tests/acceptance/18/mapping/helpers.ts` (which #1015's helpers import), of `scripts/proof-runs.mjs` (how it runs
twins), and the headers of the lints a new suite must pass.

`helpers.mjs` is this suite's own. `hub.test.ts` imports #1015's helpers (its world, scripted sessions and lease
rows), as #1015's redraft does, since AC5 asks for the hub's table "as #1015's seventh criterion has it". No test
imports the code under test: `scripts/lease` and `scripts/throttle.mjs` are run as processes, and the hub as `deep hub
run`. Per AGENTS.md the implementing agent doesn't edit these tests; a dispute goes to a blind redraft.

## Run

```sh
node --test --test-concurrency=1 tests/acceptance/3238/*.test.mjs
node node_modules/vitest/vitest.mjs run --testTimeout=1200000 tests/acceptance/3238/hub.test.ts
```

On a shared Mac, each under the machine's test grant:
`node scripts/throttle.mjs test --wait 600 -- nice -n 10 node --test --test-concurrency=1 tests/acceptance/3238/<file>`.

| File | Criterion | Needs | Takes |
|---|---|---|---|
| `serial.test.mjs` | AC1 | nothing built: a copy of `scripts/` | about 3 s |
| `inherited.test.mjs` | AC2 | nothing built: a copy of `scripts/` | about 2 s |
| `no-grant.test.mjs` | AC3 | nothing built: a copy of `scripts/` | about 2 s |
| `cli.test.mjs` | AC4 | the built CLI (`npm ci`, `npm run build --workspaces`); BLOCKED without it | not run yet |
| `hub.test.ts` | AC5 | the built CLI, and deep-hook (`cargo build --locked -p deep-hook --features env-plants`, which #18's helper runs when it is missing) | not run yet |

The times are at a 1-minute load of 100 to 130 on 18 cores; a test whose program leaves a command waiting adds up to
10 s, the time its cleanup gives every process to end before it kills their groups.
| `design.test.mjs` | AC6 | nothing | under 1 s |

The `.mjs` files must run under `node --test` and `hub.test.ts` under vitest: only inside a test run does a request use
a table of a test's own (section 6). `hub.test.ts` starts a hub, which runs deep-hook from this checkout's `target/`,
so it belongs on `scripts/lanes-lists.mjs`'s `alone` list as `tests/acceptance/3238/hub.test.ts`, reason `binary`, as
#1015's hub files are; this README is the instruction and the implementer makes that edit. The `.mjs` files need no
list: each runs a few small node processes on a table of its own.

**The machine's table at `~/.deepbuild/throttle/` is never read or written.** Every process a `.mjs` test starts gets a
temporary `HOME`, `DEEP_THROTTLE_TABLE` pointed at a folder of the test's own sandbox, a `PATH` of a folder holding
only `node` and then `/usr/bin:/bin:/usr/sbin:/sbin` (so no `deep`; a test whose `PATH` finds one is BLOCKED), and no
`DEEP_` setting of the test's own (`DEEP_THROTTLE`, `DEEP_LEASED`, `DEEP_HUB_PLANT` and the rest are dropped), nor
`NODE_TEST_CONTEXT` or `NODE_OPTIONS`. `hub.test.ts`'s world is #1015's: a temp home under `/tmp/dh1015-*` with its
hub, and `DEEP_THROTTLE_TABLE` pointed at a folder of that world. Each process starts in a process group of its own and
is stopped after its test by that group's ID; a stub in a group of its own (`deep lease` starts its command so) is told
to stop by a file and then stopped by its PID. Nothing is stopped by name or port.

## The surface

- **`scripts/lease <command>`**, its exit status and its output, run from a copy of the checkout's whole `scripts/`
  folder with no `packages/` beside it (AC1 to AC3: no built CLI), or in place (AC4 and AC5, which want the CLI).
- **The stub command**, `node stub.mjs <name> [exit]`, which notes its start, its PID and the `DEEP_THROTTLE` it sees
  (`<class>:<id>`, section 6's "A held grant is exported as `DEEP_THROTTLE`"), then holds until a stop file appears
  (or ends at once with `exit`), noting its end. A command "starts" when its stub notes its start.
- **The throttle's table and log** in the test's table folder: `table.json`'s `requests` (a request waiting for a
  grant) and `grants`; the log's `granted` entries (`class`, `grant: "top-level"`, `id`), `passed` (`through`, the
  inherited grant) and `timeout`.
- **`DEEP_LEASE_WAIT`** in minutes; **`DEEP_THROTTLE_READINGS`** to make a test's own table read a loaded machine
  (AC2).
- **The hub's lease table**, as #1015's helpers read it: `lease.acquired` and `lease.released` through `events.read`,
  a `cpu.slot` lease whose holder is `session:<the session's ID>`.
- **"Started together", "at once", "never"** are read on events, not on time: the stubs' notes, the table's file
  changing (a waiting request rewrites it at each look) and the processes' output and exit, each wait bounded by one
  deadline (3 min for a start, 5 for AC3's script to end) that only turns a hang into a failure.

## AC1 `#3238.52168c75`: two commands, one after the other (`serial.test.mjs`)

Plants a test's own table with `build` at 1: on the Mac it is 1; on Linux, where it is 2, a holder (`throttle.mjs
build -- node stub.mjs holder-1`) takes the other slot first. No hub (a fresh `HOME`), no `deep` on the `PATH`, no
built CLI (the copy has no `packages/`). Starts two `scripts/lease node stub.mjs build-one` / `build-two` back to back.

- Waits until both stubs have started, or one has while a build request waits in the table. Both started is the
  failure: "the second command, `node stub.mjs <name>`, started while the first, `<name>`, still ran".
- Lets the first end; the second must start, and not before the first's end.
- Each stub's `DEEP_THROTTLE` is `build:<id>`, and the log has a `granted` entry of that ID with `class: "build"` and
  `grant: "top-level"`; the two IDs differ.

On the base both run at once, with no grant: it fails at that assertion, naming the second command. The twin
`runs-directly` fails the same way.

## AC2 `#3238.664c776d`: under an ancestor's test grant (`inherited.test.mjs`)

Plants every build slot held by holders outside the run, and `DEEP_THROTTLE_READINGS` reading load 1000 on 1 core, so
no test grant past the first starts: a request of the job's own of either class can only wait. The run is
`throttle.mjs test -- <copy>/scripts/lease node stub.mjs repo-rules-lint`, as `affected.mjs` runs a lint under its
run's grant.

- Waits until the job starts, a request appears in the table, or the run ends. Anything but the start fails, naming
  the job and why ("a request of its own waits in the table").
- The job's `DEEP_THROTTLE` is the run's grant (`test:<the id the log's granted test entry names>`); the log has a
  `passed` entry through that grant; and it has no `granted` or `timeout` entry of class build but the holders'.

On the base the job starts at once with the run's `DEEP_THROTTLE` in its environment, but nothing asked the throttle:
it fails at the `passed` assertion ("the log shows no passed entry through the run's grant ... for the job"). Two twins
drop the inherited grant and fail at the start assertion, naming the job. `own-test-grant` asks for a `test` grant: the
readings leave no room for a second, so what it waits behind is its own run's grant, as the criterion has it.
`own-grant` asks for a `build` grant, the class the decision names, and waits behind the holders outside the run: a
`test` grant doesn't block a `build` request, so that one doesn't wait behind its own run.

## AC3 `#3238.4febe21a`: no grant, no run (`no-grant.test.mjs`)

Plants every build slot held, and runs `scripts/lease node stub.mjs cargo-build exit` with `DEEP_LEASE_WAIT=0` and no
inherited grant. Once it ends (5 min at most): the stub never started; a line of its output starts `INCONCLUSIVE no
grant`; its exit status is non-zero; and the log has a build `timeout`. On the base the command starts at once: it
fails at the assertion that it never started. The twin `runs-after-wait` prints the throttle's line and then runs the command: it fails
there too.

## AC4 `#3238.f2323033`: with the CLI built and no hub (`cli.test.mjs`)

Runs the checkout's own `scripts/lease node stub.mjs npm-run-build` in place, so it finds the built CLI, with a fresh
`HOME` (no hub there: `deep lease` reads the hub's address and token under `HOME`) and no `deep` on the `PATH`. Without
a built CLI it is BLOCKED, never a pass. While the stub holds, its `DEEP_THROTTLE` is `build:<id>` and the table holds
that grant; once it ends, it started exactly once and the log has a top-level `granted` of class build with that ID.
On the base `deep lease` finds no hub and runs the command with no grant, so it should fail at the grant assertion
(read from the base's code; not run yet, see Wrong programs).

## AC5 `#3238.8320a246`: with a hub answering (`hub.test.ts`)

#1015's world (`World`, `Session`, `claudeCall`, `leaseRows`): a temp home with `deep hub run` answering on it, `deep`
(the built CLI) on the `PATH`, and one scripted Claude Code session in this checkout, whose shell call `scripts/lease
node <world>/lease-3238/stub.mjs hub-job` goes through the real deep-hook and runs whatever the hook decides. When the
stub starts, the hub's lease rows are read; then the stub is let end and the rows read again once the session's slots
are released (a minute at most).

- As #1015's seventh criterion has it: a `cpu.slot` lease held by `session:<the session's ID>` when the command
  started, taken after the call began and before the command started, released only after it ended, or not yet.
- The stub's `DEEP_THROTTLE` is `build:<id>`, and the throttle's log has a top-level `granted` of class build with
  that ID.

On the base the command runs through `deep lease` and holds a slot, but no grant, so it should fail at the grant
assertion (read from the base's code; not run yet, see Wrong programs).

## AC6 `#3238.b9ec371a`: the design (`design.test.mjs`)

Section 6 of `docs/parallel-proof.md` must hold a bullet or paragraph naming `scripts/lease` that states, matched
loosely since the wording is the writer's: it never runs a command bare (`never ... bare`, `never ... without/outside
a grant`, or `always ... grant`); it holds a throttle grant (`throttle ... grant` or a `build` grant); and it passes
through on an ancestor's (`pass(es) through` with `ancestor`, `inherited`, `caller` or `parent`). On the base section 6
never names `scripts/lease`.

## Wrong programs

The tests of AC1, AC2, AC3 and AC6 fail on the base at their own assertions (`BASE-FAILURE.txt`). The three planted
scripts the criteria name, and `own-grant` beside AC2's, are twins (`twins.json`, `twins/README.md`), each run once
against its test, failing as recorded at the end of `BASE-FAILURE.txt`. A throwaway reference script, the twins' source without their planted line,
passed the tests of AC1, AC2 and AC3 here and was never committed.

**`cli.test.mjs` (AC4) and `hub.test.ts` (AC5) have not run yet, on the base or anywhere.** Both need the packages
built, and on the day these were drafted no build grant came on this Mac: a preflight held the machine's exclusive
`timed` grant for over 10 hours. Their expected base failures above are read from the base's code, not seen. The four
files that build nothing were run once each with no machine grant, as section 7a lets a lint that builds nothing run,
each on a table of its own inside `node --test`.

## Gaps

- **"At once" (AC2)** is judged by events: the job starts before any request of its own appears in the table, not
  within a time.
- **"Never starts" (AC3)** is judged once the script and every holder of its output have ended: a command left running
  in the background with its output closed would not be seen.
- **The holders on Linux** follow section 6's table (build 2, the Spark's); the tests ran only on the Mac here.
- **The issue's Proof** (the two commands' timeline on the branch and the base) is the implementer's to show; the
  failure messages here print each run's notes, table and log.
