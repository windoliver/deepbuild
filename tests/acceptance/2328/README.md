# Acceptance tests for #2328: a leased command starts sooner

Written first, blind, by a job that never saw an implementation of #2328; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #2328 as the dispatching job gave it: title, the Nov 11 audit's three findings, Scope, the three acceptance
  criteria, Proof (`tests/acceptance/1015/` unchanged) and Depends on (none); epic #6.
- `docs/technical-design.md` at the base: Lease, Numbers version 0 has to hold (the Hot path row and the perf lane
  paragraph), Sessions that know about each other, and Dogfooding.
- At the base (`9f93f1e7`): `packages/hub/src/heavy.ts` (`leaseCommand`, `jobsFor`, `runGroup`, `HeavyQueue.wait`,
  `started`, `exited`), `packages/hub/src/session-state.ts` (`agentAbove`, the `startOf` cache, `verify`,
  `goneSessions`; the issue's "agentAbove in core.ts" lives here), `children.ts` (and the five lines of
  `children-worker.ts` that run each job with `execFile`, so two jobs can run at once) and `wire.ts` (`startOf`,
  `parents`), `client.ts` (`call`), `server.ts` (the cli hello's `peer`), `paths.ts` (`hubAddress`, `hub.use`),
  `hub-shared.ts` (`reusedPids`), the suites `tests/acceptance/1015/` and `tests/acceptance/1016/`,
  `tests/acceptance/18/mapping/helpers.ts` (which #1015's helpers import), and `packages/hub/test/start-ps.test.ts` (a
  `ps` on PATH that notes each call). Seen through searches only: `hub-control.ts`'s three lines that route
  `lease.wait`, `lease.started` and `lease.exited` to the queue, and `authority.ts`'s `deep hub use` writing
  `hub.use`. For running: `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs` (`alone`, test globs),
  `vitest.config.ts`, `tests/vitest-setup.ts`, `crates/deep-hook/Cargo.toml` (`env-plants`), and `packages/hub`'s
  `package.json` and `native/build.mjs` (for the mutant's rebuild).

What the base does (BASE-FAILURE.txt, at load 388 to 431 on an 18-core M5 Max; the same counts at load 127 to 168):
`deep lease` reads its own start with one `ps`, then runs `deep-hook heavy`, then calls `lease.wait`. The hub's peer
check then waits on three `ps` in turn: the caller's start, the process table, the agent's start. Only after the grant
does the command start; the hub's read of the command's start (`lease.started`) comes after. When the command's group
has ended with it, `deep lease` tells the hub `lease.exited()` twice, at the same moment. A `deep lease` inside the
agent's tree holds its `cpu.slot` as the agent's session, and as `cli` once the hub must treat the agent's PID as
another process's.

## Run it

```sh
npm ci                            # once
npm run build --workspaces        # the hub and `deep lease` run from packages/cli/dist
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook --features env-plants
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run tests/acceptance/2328/lease.test.ts --testTimeout=600000 --silent=false
node node_modules/typescript/bin/tsc -p tests/acceptance/2328/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0) and the pinned toolchain's `cargo` on `PATH`: #1015's world builds
deep-hook with `--features env-plants` before it starts the hub, a no-op after the build above when the same `CARGO_*`
variables are set. `--silent=false` shows the passing test's readings too. The file took 38 to 51 s at load 130 to 430.

It doesn't need `scripts/lanes.mjs`'s `alone` list. It starts one hub, one stand-in agent and two short `deep lease`
runs, every `ps` it counts is its own world's (each world has its own `PATH`), and load can't move a count: two calls
made together overlap by the 5 s hold, against tens to hundreds of ms between two spawns on a loaded Mac, and two made
one after another can't overlap at all.

Nothing needs the network, a model, a sign-in or a real agent. #1015's world (`tests/acceptance/1015/helpers.ts`,
imported, never edited) gives the temp home under `/tmp/dh1015-*`, the hub as a process, the bin folder first on every
`PATH` it hands out, and the stand-in agent; every process it starts is stopped by its PID or process group's ID after
the file, and the folders are removed.

## The scene

- **The hub** runs as #1015's world starts it (`deep hub run`, `DEEP_HUB_TEST_CORES=12`), with the memory pressure
  pinned `normal` (`DEEP_TEST_MEMORY_PRESSURE_FILE`) and `DEEP_HUB_TEST_PID_REUSE` naming a file that holds `[]` until
  AC3's second command.
- **The agent**: one stand-in Claude Code process (#1015's `fixtures/agent.mjs`), the parent of its real
  `deep-hook claude-code SessionStart` and of its shell tool's commands. The hub knows its session from that
  SessionStart alone, so it doesn't watch the process: a process two hooks named is watched, and its start read again
  every 30 s (`goneSessions`), which names the same PID as the peer check's read and could land in the counted window
  by chance. A probe while drafting saw no `ps` of the hub's in the 75 s after such a SessionStart. The agent's PID is
  what its shell prints for `$PPID`.
- **The command**: the agent's shell runs `deep lease -- leased-true` in a folder of its own. `leased-true`
  (`fixtures/leased.pl`) stands for the issue's `/usr/bin/true`: it notes its PID, its parent's (`deep lease`'s, since
  `nice` execs it) and when it started, and exits 0 at once, starting nothing, so its process group ends with it.

## How `ps` waits are counted (AC1)

`fixtures/ps.pl` is installed as `ps` first on the `PATH` of the hub, deep-hook, `deep lease` and the command. Each call
runs the real `/bin/ps` with the same arguments and environment and passes on its output and status; when it ends it
notes its parent's PID, its parent's parent's PID, when it started and ended, and its arguments. While the first
command runs, each call first holds 5 s, so two calls started together are seen running together however loaded the
machine is; two run one after another can't overlap, since the second starts only once the first's result is in.

- **A wait** is a run of calls whose times overlap: calls that ran together are one wait, calls one after another one
  each.
- **`deep lease` itself**: the calls whose parent (or parent's parent) is `deep lease`'s process and that ended before
  the command started.
- **The hub**: the calls whose parent (or parent's parent) is the hub's process, from when `deep lease`'s first
  connection opened to when the hub's `granted` answer came back. The hub can't read anything for this lease before
  that connection, and the command can't start before the grant, so these are the hub's waits ahead of the start.
- The count needs the hub's reads to be seen: a run where the stand-in saw none of the hub's calls in that window fails
  as unreadable, never passes. `deep lease` may make none.
- Precondition: the command's `cpu.slot` is held as the agent's session, so the peer check read all it reads for a
  session. A run the hub didn't bind to the session fails there rather than passing on fewer reads.

## How `lease.exited()` calls are counted (AC2)

A deep command finds the hub through `<HOME>/.deepbuild/config.json` (`paths.ts`, `hubAddress`). The test writes
`hub.use` there, as `deep hub use` does, naming an observer socket for the folder the commands run in, so `deep lease`
alone reaches the hub through it; deep-hook and the test's own reads keep the hub's socket. The observer passes every
byte on both ways and notes each call on each connection: the cli hello's `peer`, the method and its params, and the
hub's answer, each with when it passed. The calls are counted once the agent's shell has ended and every connection
has closed; AC2 counts those whose method is `lease.exited`.

## Criteria to tests

Each test's name starts with its criterion's ID (`#2328.<first 8 hex of the SHA-256 of the criterion's text>`, as
`scripts/proof-change.mjs` computes it from the checkbox line) and then quotes the criterion. All three are in
`lease.test.ts` and read the same first `deep lease` run.

| ID | Criterion | What the test asserts |
|---|---|---|
| `#2328.661c3161` | A leased command with the hub up starts after at most one `ps` wait in `deep lease` itself and two in the hub, counted by a stand-in `ps` on PATH | the command ran; `deep lease` reached the hub through the observer and was granted; its `cpu.slot` is the agent's session's; the stand-in saw the hub's reads; then at most 1 wait of `deep lease`'s before the command started and at most 2 of the hub's before the grant |
| `#2328.a793e073` | The hub hears `lease.exited()` once for a command whose group ended with it | the command ran and `deep lease` exited 0; the observer saw exactly one `lease.exited` call |
| `#2328.7a05df84` | A `deep lease` run from inside an agent's process tree still holds its lease as that session; one whose PID was reused is still refused | the first run's `cpu.slot` is held by `session:<the agent's session>`; then, with the agent's PID in `DEEP_HUB_TEST_PID_REUSE`'s file, a second `deep lease` from the same agent's shell is answered by the hub and holds no lease as that session |

At the base the first two fail at their count assertions (3 hub waits; 2 `lease.exited` calls) and the third passes.

## The mutant run (AC3)

AC3 holds at the base, so it was run once against a wrong program: `agentAbove`'s walk in
`packages/hub/src/session-state.ts` made to ignore a reused PID (`if (reusedPids().includes(pid)) continue;` changed to
`includes(-pid)`, which never matches), the hub rebuilt with `tsc -p packages/hub/tsconfig.json`, and
`-t "#2328.7a05df84"` run (2026-11-15, the files as committed). It failed at the last assertion, as it should; the
first run under the agent was still held as its session, and the hub then bound the second to it too:

```
AssertionError: with the agent's PID 51880 held by another process (DEEP_HUB_TEST_PID_REUSE), a `deep lease` under it is refused as session 32d02726-e8fa-4d21-81b0-6cca1e24ce5d; it held: cpu.slot slow exclusive by session:32d02726e8fa4d2181b06cca1e24ce5d (released): expected [ Array(1) ] to deeply equal []
```

The edit was reverted and the hub rebuilt; nothing of it is committed. A peer check that accepts any start isn't
caught by this test: the reused PID is skipped before its start is compared.

## Open points (choices the issue leaves open; the tests assert the least they can)

1. **"A `ps` wait."** Read as a wait on one or more `ps` running together: calls that overlap in time are one wait. The
   holds make overlap a matter of order, not of timing.
2. **Whose waits, and which.** `deep lease` itself: its own calls, or calls of a process it started. The hub: its
   calls between the lease's first connection and the grant. A read after the command started (the hub's read of the
   command's start at `lease.started`) doesn't delay the start and isn't counted.
3. **"With the hub up"** is read as the issue measured it: a `deep lease` inside an agent's process tree, with the
   agent's session known to the hub, so the peer check reads the caller's start, the process table and the session's
   start.
4. **"`deep lease` reads its own start time while `deep-hook heavy` runs"** (Scope) isn't asserted beyond the count:
   `deep lease` finds deep-hook by its install path, not `PATH`, so it can't be stood in without touching `target/`, and
   the base's one `ps` already meets "at most one".
5. **"One whose PID was reused"** is read as the agent's PID (the session's process) now held by another process,
   which the hub's own test seam `DEEP_HUB_TEST_PID_REUSE` says. "Refused" is read as not held as that session: the
   base grants the lease to `cli`. A refusal of the lease outright passes too; a run the hub never answered doesn't.
   A caller's own PID reused (a stale start in the hello) isn't covered.
6. **The 5 s hold** applies only while the first command runs; AC3's second command runs without it. No time limit is
   asserted anywhere. With the hold, the base's hub gave the first lease back on its tick while the held `lease.started`
   read ran, so both of its `lease.exited` calls were refused; the count is the same either way (BASE-FAILURE.txt).
7. **Not covered**: the latency itself (143 ms at the median in the audit), the hub's `ps` count across many leases,
   and the `lease.exited()` calls of a group that outlives its first process, which #1015's AC4 covers.
