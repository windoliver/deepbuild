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

**Two bases.** The suite was drafted at `f8c6cff82`, and the runs recorded so far are there. The branch then merged main
at `b87494f02`, which carries #3221 (admission and turns, section 6); I read main up to that commit, the admission and
turn text, `scripts/throttle.mjs`, `scripts/affected.mjs` and `tests/acceptance/3221/` in it. The runs still to come (AC4,
AC5 and `admitted.test.mjs`) have `b87494f02` as their base. `scripts/lease` is the same in both.

`helpers.mjs` is this suite's own. `hub.test.ts` imports #1015's helpers (its world, scripted sessions and lease
rows), as #1015's redraft does, since AC5 asks for the hub's table "as #1015's seventh criterion has it". No test
imports the code under test: `scripts/lease` and `scripts/throttle.mjs` are run as processes, and the hub as `deep hub
run`. Per AGENTS.md the implementing agent doesn't edit these tests; a dispute goes to a blind redraft.

## Run

```sh
node --test --test-concurrency=1 tests/acceptance/3238/*.test.mjs
node node_modules/vitest/vitest.mjs run --testTimeout=1200000 tests/acceptance/3238/hub.test.ts
```

On a shared Mac, each under the machine's test grant, the files that build nothing too, since `node --test` is the
throttle's `test` class whatever a file costs:
`node scripts/throttle.mjs test --wait 1440 -- nice -n 10 node --test --test-concurrency=1 tests/acceptance/3238/<file>`,
and `hub.test.ts` under the same wrapper around its vitest command.

| File | Criterion | Needs | Takes |
|---|---|---|---|
| `serial.test.mjs` | AC1 | nothing built: a copy of `scripts/` | about 3 s |
| `inherited.test.mjs` | AC2 | nothing built: a copy of `scripts/` | about 2 s |
| `no-grant.test.mjs` | AC3 | nothing built: a copy of `scripts/` | about 2 s |
| `admitted.test.mjs` | AC2, the admission case | nothing built: a copy of `scripts/` | not run yet |
| `cli.test.mjs` | AC4 | the built CLI (`npm ci`, `npm run build --workspaces`); BLOCKED without it | not run yet |
| `hub.test.ts` | AC5 | the built CLI, and deep-hook (`cargo build --locked -p deep-hook --features env-plants`, which #18's helper runs when it is missing) | not run yet |

The times are at a 1-minute load of 100 to 130 on 18 cores; a test whose program leaves a command waiting adds up to
10 s, the time its cleanup gives every process to end before it kills their groups.
| `design.test.mjs` | AC6 | nothing | under 1 s |

The `.mjs` files must run under `node --test` and `hub.test.ts` under vitest: only inside a test run does a request use
a table of a test's own (section 6). `hub.test.ts` starts a hub, which runs deep-hook from this checkout's `target/`,
so the folder runs alone, by its own `lane.json` (docs/parallel-proof.md section 7, #1327), reason `binary`, as #1015's
hub files are. That takes the `.mjs` files with it: the lane file names a folder, not a file.

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

### The admission case (`admitted.test.mjs`)

Since #3221 an `affected.mjs` run's test grant is its admission, so "an ancestor's `test` grant" in the issue's sense is
one. Plants a run admitted with `DEEP_THROTTLE_RUN=0 throttle.mjs test -- node run.mjs`, on a test's own table with
`DEEP_THROTTLE_READINGS` at two cores: a pool of one token. The lint is `<copy>/scripts/lease node stub.mjs
repo-rules-lint`, as `affected.mjs` starts a light lint.

- **A token free.** The lint starts at once (no `build` or `test` request of its own waits in the table); its
  `DEEP_THROTTLE` is the run's grant; the log has a `passed` entry through that grant and no build grant or timeout.
- **Every token held by another job of the run**, which has a turn (the log's `turn`). The lint passes through (`passed`,
  less the other job's own), with no build request; once the token goes back the lint has run exactly once and the run
  ends with 0. Whether it started while the token was held is printed as a diagnostic, not asserted (below).

On the base the script runs the lint directly: it holds the run's `DEEP_THROTTLE`, but the log has no `passed` entry, so
both should fail at that assertion (read from the base's code; not run yet).

### Open question: does a lint wait for a turn?

The issue and main's design disagree here, so the test chooses neither; an owner's ruling is needed before the line
that would be added to it.

- **The issue says it doesn't.** "Under an ancestor's grant it passes through and waits for nothing" (Change); "A lint
  that builds nothing, which `affected.mjs` runs through the script under its run's grant, starts at once, as section 7a
  decided" (Unchanged); AC2, "starts at once". Section 7a on main still says lint scripts that build nothing run under no
  throttle grant, since in the build class they waited behind a neighbour's cargo build and ran nothing.
- **Section 6 says it does.** "Inside an admitted run, each `build` or `test` request from a process under no turn, as each
  job `affected.mjs` starts, passes through on the run's grant as before, then waits for a turn". The decision comment
  has the script always ask `throttle.mjs build`, so a lint's request is such a request: with every token held it waits.

The issue's text is older than #3221 (read on main at `2a5bd60fd`) and says only that the pool is what would let several
builds run, so neither is clearly meant to settle the other. On a ruling that the lint starts at once, the test gains an
assertion that it did while the token was held; on the other, that it waited for a turn (its request in the table and
its turn in the log) and started once the token went back.

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

**`cli.test.mjs` (AC4), `hub.test.ts` (AC5) and `admitted.test.mjs` have not run yet, on the base or anywhere.** The
last needs a test grant and no build. The other two need the packages built, and on the day these were drafted no build grant came on this Mac: a preflight held the machine's exclusive
`timed` grant for over 10 hours. Their expected base failures above are read from the base's code, not seen. The
runs of `serial`, `inherited`, `no-grant` and `design`, of the reference and of the twins were made with no machine
grant, while that preflight held `timed` (`BASE-FAILURE.txt` has the times). They should have had a `test` grant:
section 7a's no-grant rule is for lint scripts, and `node --test` is the `test` class.

## Gaps

- **"At once" (AC2)** is judged by events: the job starts before any request of its own appears in the table, not
  within a time.
- **"Never starts" (AC3)** is judged once the script and every holder of its output have ended: a command left running
  in the background with its output closed would not be seen.
- **The holders on Linux** follow section 6's table (build 2, the Spark's); the tests ran only on the Mac here.
- **The issue's Proof** (the two commands' timeline on the branch and the base) is the implementer's to show; the
  failure messages here print each run's notes, table and log.
