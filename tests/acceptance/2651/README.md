# #2651 acceptance: a tool call's hook reads config.json once, copies no job list, and is parsed once for the packages that see it

Written first, blind, by a job that never saw an implementation of #2651. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## What was read

- Issue #2651 as of 2026-11-20: its body (the three costs, Scope, five checkbox criteria, Proof, Depends on). It has no
  comments.
- `docs/technical-design.md`: Hook protocol (deep-hook and the hub), Numbers version 0 has to hold (Every task carries
  its own budgets, The reference Macs), Criteria to tests, Criteria in a checked shape, Wrong programs, Dogfooding;
  `AGENTS.md`.
- At the base commit `8bfb6a633` (origin/main): `crates/deep-hook/src/main.rs` (`home`, `config`, `setting`,
  `address`, `worktree_hub`, the matcher call's `address()`, `exchange`, `hub_said_hello`);
  `packages/hub/src/session-state.ts` (`whose`, `park`), `packages/hub/src/core.ts` (`whose`'s two callers: the append
  path and `buildReply`), `packages/hub/src/plant.ts` (`Plant`, `PLANTS`, `plantOf`), `packages/hub/src/hub-control.ts`
  (`job.*`, `events.read`); `packages/runner/src/runner.ts` (`list`, `recent`, `fold`, `letGo`, `ENDED_KEPT`,
  `recorded`, `ended`); `packages/extension-host/src/host.ts` (`visible`, `deliver`, `reaches`, `start`, `sandboxed`,
  the `Plant` type and `plant` option), `packages/extension-host/runtime/deep.mjs` (`extensionSide`'s `deliver`,
  `peer`); `packages/record/src/index.ts` (`toJson`, `contentFree`); the schemas of `job.recorded@1`, `job.ended@2`,
  `tool.before@4`, `job.event@1`, `session.reading@1`; `benchmarks/budgets.json` (the four tasks),
  `benchmarks/deep-hook.mjs`, `benchmarks/extension-host.mjs`, `scripts/benchmark.mjs` (`measure`,
  `judgeInstructions`), `scripts/lanes.mjs`, `scripts/proof-runs.mjs` (twins).
- Suites, for their conventions: #2650 (shape, plants), #2646 (hub on a temp home, `rusage.c`, the budgets file), #2655
  (counting the hub's instructions), #1410 (an injected library), #159 (AC10's whose scenario and its stand-in agent).

Main moved since the issue was read at `ccbdefd1f`: #2650 landed, so at this base `whose` reads `runner.recent()`, the
jobs in memory (running ones and the newest 64 ended), not `runner.list()`. The tests were written against the base as
it is; what that means for AC2 is below.

## The criteria

IDs are `#2651.<first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed>`; each test's name
starts with its ID.

- **AC1 `#2651.251a1058`**: "A forwarded PreToolUse opens `~/.deepbuild/config.json` once, and a forwarded PostToolUse
  at most once. On the merge base a PreToolUse opens it twice, and the test fails, naming the count"
- **AC2 `#2651.306dda20`**: "With 10,000 ended jobs in the record and none running, the hub's own instructions retired
  for a PreToolUse are within 2% of the same hook with no job in the record, over 15 alternated rounds. On the merge
  base the count rises with the jobs, and the test fails, naming both counts"
- **AC3 `#2651.1de95500`**: "A hook from a running job's own session is still that job's. One from its folder before
  its session ID is read still waits. One that only resumes a job's session ID, or only works in its folder, still gets
  its reading. A planted hub that looks only at the sessions of running jobs misses the folder case and fails, naming
  the hook"
- **AC4 `#2651.bc5a8e8d`**: "With eight sandboxed packages whose grants reach `tool.before`, one hook's event is
  serialized once, counted by the test. Each package receives a value equal to what it receives on the merge base, and
  a package that changes a field of what it was handed changes nothing another receives. A planted host that hands
  every package one object they can all write fails, naming the field"
- **AC5 `#2651.59066289`**: "`deep-hook-overhead`, `deep-hook-guards`, `hub-round-trip` and `extension-host` in
  `benchmarks/budgets.json` retire no more instructions than on the merge base"

| Criterion | File, test | What it asserts |
|---|---|---|
| AC1 | `opens.test.mjs` (one test) | Three rounds of one forwarded PreToolUse and one forwarded PostToolUse (`deep-hook claude-code <event>`, a Bash `ls`, a hub running, config.json naming its address): each PreToolUse opens config.json exactly once, each PostToolUse at most once; each hook is shown forwarded by the hub recording its `tool.before` / `tool.after`. The failure names the count. |
| AC2 | `instructions.test.mjs` (one test) | Two hubs of the checkout, one whose record holds 10,000 ended jobs (none running, checked through `job.list`), one with no job; 15 rounds alternating which goes first, each round 10 PreToolUses per hub, the hub process's instructions retired read just before each request and as its reply arrives, the round's count the median hook; judged by the perf lane's `judgeInstructions` (2%, sign flips, p < 0.01): only PASS passes. The failure names both counts, per PreToolUse. |
| AC3 | `whose.test.mjs` (one test) | On a hub running read jobs on a stand-in agent: own (a running job's session, ID read) is a `job.event` of the job and never the session's `tool.before`; folder (the job's folder, before its ID is read) is the job's `job.event`, written no earlier than the last moment the test saw the ID unread (it waited), never the session's; resumed (a finished job's session ID, another folder) and visitor (your session in that job's folder) are the session's own with a `session.reading` naming the job. Then the same scenario on `DEEP_HUB_PLANT=whose-running-sessions-only` must make the judgment name the folder hook. |
| AC4 | `delivery.test.mjs`, first test | Eight sandboxed packages, record grant `tool.before`: one hook's `tool.before`, appended and read back, handed to `host.deliver` once, is serialized exactly once (count named on failure), and each package's value equals what the same package receives on the merge base (`DEEP_2651_BASE`). |
| AC4 | `delivery.test.mjs`, second test | The same eight plus a writer and a reader, release packages in the hub: the writer changes `data.call` of what it was handed; no other package received that change, and the writer was handed the value unchanged (failure names the package and the field). Then the same on the host opened with `plant: 'hands-one-writable-event'` must make the judgment name `data.call`. |
| AC5 | `budgets.long.test.mjs` (four tests, by hand) | Each task's command from each checkout's budgets.json, `measure`d as the perf lane does (warm-up, 20 alternated rounds, children counted) and `judgeInstructions`: PASS only. As #2646's AC5 file. |

AC3's and AC4's second tests hold the criterion's wrong program inside the test, so each fails on the merge base at an
assertion (the plant is missing there) and needs no twin.

## How to run

The repo's Node (`.node-version`, 24.22.0), macOS with `cc` (Command Line Tools), `perl` (AC3's stand-in), and the
checkout built:

```sh
npm ci --no-audit --no-fund && npm run build --workspaces
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook
node --test tests/acceptance/2651/opens.test.mjs                                        # AC1, under a minute
node --test tests/acceptance/2651/instructions.test.mjs                                 # AC2, 1 to 3 minutes
node --test tests/acceptance/2651/whose.test.mjs                                        # AC3, about a minute
DEEP_2651_BASE=/path/to/built/merge-base node --test tests/acceptance/2651/delivery.test.mjs      # AC4, 1 to 2 minutes
DEEP_2651_BASE=/path/to/built/merge-base node --test tests/acceptance/2651/budgets.long.test.mjs  # AC5, by hand, an hour or more
```

`DEEP_2651_BASE` is a second checkout of the merge base, built the same way (and, for AC5, with `hyperfine` 1.x on the
PATH and room for the release deep-hook the deep-hook tasks build). Run one file at a time: they start hubs, sandboxed
packages and jobs, and AC2 counts a hub's instructions. Background shells that die at 10 minutes can run every file
but `budgets.long.test.mjs`.

Every home, world and package folder is under `/tmp/dh2651-*`, removed after its test. Hubs are stopped by their PID;
what AC3's jobs leave is stopped by PID, found by the test's own folder in its command line. Nothing is stopped by name
or port. No network and no model: AC3's agent is `fixtures/fake-claude.pl` (#159's, copied), with a made-up sign-in.
Each reading prints the load average and `pmset -g therm`; nothing waits for a quiet machine.

## Planted programs (for the implementation to add)

| Name | How it is selected; where to add it | Criterion | What it does, and how the test fails on it |
|---|---|---|---|
| `whose-running-sessions-only` | `DEEP_HUB_PLANT`: add it to `Plant` and `PLANTS` in `packages/hub/src/plant.ts`, and have the hub's whose act on it | AC3 | The hub answers whose a hook is by looking only at the session IDs of running jobs: no folder, no ended job. The folder hook then isn't held for its job and is recorded as the session's own, so the judgment names it: `the PreToolUse <id> from job <run:…>'s folder <path>, sent before its session ID was read is not that job's: …`. At the base the hub refuses the name (`names no planted program`), and the test fails at that assertion. |
| `hands-one-writable-event` | `openExtensionHost`'s `plant` option: add it to the host's `Plant` type in `packages/extension-host/src/host.ts` | AC4 | The host makes one value of the event per view and hands that same plain object to every package, writable, neither frozen nor copied per package. The hub writer's change of `data.call` then reaches the hub reader, and the judgment names it: `t2651/reader received data.call = "changed-by-t2651/writer": t2651/writer changed field data.call …`. At the base the option is ignored, the judgment passes, and the test fails at that assertion. |
| the merge base | — | AC1, AC2, AC4 (first test) | AC1: 2 opens; AC2: the count rises with the jobs; AC4: 8 serializations (BASE-FAILURE.txt). |

AC5 names no wrong program: against itself the base can only PASS or read INCONCLUSIVE.

## Choices where the issue leaves one

- **Opens (AC1)** are every `open()` and `openat()` of the exact path `$HOME/.deepbuild/config.json`, counted in the
  deep-hook process by `opens.c` injected with `DYLD_INSERT_LIBRARIES` (deep-hook is not a platform binary, so dyld
  honours it; a run that records no open at all is INCONCLUSIVE). The binary is the debug build the repo's build
  command makes. "Forwarded" is shown by the hub recording the call's `tool.before` / `tool.after`. config.json names
  the hub's address (`hub.address`, as the deep-hook benchmark writes it), so the file is there as on a set-up machine.
- **The hook (AC2)** is carried to the hub's socket by the test, as deep-hook writes it, so only the hub's work is
  counted. "The hub's own instructions" are `proc_pid_rusage`'s `ri_instructions` of the hub's process (all its
  threads, no child), from just before the request line is written to the arrival of the reply. Work the hub defers
  past its reply isn't counted.
- **Rounds (AC2):** a round is 10 PreToolUses to each hub and its count the median of the 10. Single hooks read 4 to
  12 million instructions on this loaded Mac, and the first draft, summing a round, read INCONCLUSIVE (pairs from
  0.46x to 2.2x). "Within 2%" is judged by the perf lane's own rule for an instruction count (`judgeInstructions`:
  PASS when "2% or more above" is rejected at p < 0.01 by seeded sign flips); 15 pairs can reach that. A rise read the other way
  (fewer with jobs) isn't a failure.
- **10,000 ended jobs (AC2)** are written to the record before the hub starts, as the runner writes them
  (`job.recorded@1`, `job.ended@2` finished with a session ID, process and run), through the checkout's own
  `@deepbuild/record` (`probe.mjs seed-jobs`), and read back through `job.list` before any hook. Running 10,000 jobs
  through the stand-in would take 15 to 20 minutes (#2650's reading) and isn't what the criterion measures.
- **"Still waits" (AC3)** is read as the base does it: the hook's event is held until the runner reads the job's
  session ID and is then the job's (`core.ts`: "Held, not queued"). The reply to a PreToolUse isn't held at the base
  (it came 3 ms after the request in this job's first run), so the test doesn't time the reply; it checks the
  `job.event` was written no earlier than the last moment the test saw the ID unread, which a hub that decided at once
  from the folder would fail.
- **The resumed case (AC3)** resumes a *finished* job's session ID from another folder, as #159's AC10 does, since a
  hook with a running job's session inside its run is the job's own.
- **Serialized once (AC4)** counts the `JSON.stringify` calls, in the host's process while `deliver` runs, whose value
  is the event itself: an object whose `id` is the event's ULID and `kind` is `tool.before` (the base's `toJson` is
  `JSON.stringify`). The JSON-RPC message that carries it to each sandboxed package is a message, not the event, and
  isn't counted. Exactly 1 is required.
- **Equal values (AC4)** compare each package's received values on the change and on the merge base, with `log_pos`
  read as the event's own position in its run (installs before it may append a different number of events). The
  event is fixed (id, time, seq) so both sides hand the same one.
- **Who can write (AC4):** a sandboxed package gets its own copy over its socket, so only a package in the hub's
  process can write what the host holds. The isolation test adds a writer and a reader as release packages in the hub
  (they see the whole event, as a release package does) beside the eight; the serialization count is taken on the
  eight alone, as the criterion states.
- **AC5** runs as #2646's AC5 file does, by hand, with no reference-Mac gate: instructions retired aren't a timing.

## Open questions for the issue's owner

1. **AC2 on this base.** Since #2650 the base's `whose` copies at most the 64 newest ended jobs, not every job. The
   count still rose on the base, about 35% (BASE-FAILURE.txt), so the test fails there as the criterion says; this job
   didn't look for which code makes the rise, and a change may need to cut more than `whose` for AC2 to hold.
2. **Scope vs AC3's resumed case.** The Scope says the hub answers whose "from the jobs that are running, stopping or in
   the hook's folder"; a finished job resumed from another folder is in none of these, yet AC3 says it "still gets its
   reading". The test follows AC3.
3. **"Serialized" by other means (AC4).** If the change makes the frozen value without `JSON.stringify` (by
   `structuredClone` or by hand), the count reads 0 and the test fails. The issue's word is "serialized once"; a
   redraft can widen what counts if the owner says so.

## Files

- `lib.mjs`: criterion IDs, checkouts, temp folders, the hub as a process, its socket (cli and hook lines), the C
  helpers' builds, the perf judge, AC3's stand-in and sign-in, load readings.
- `probe.mjs`: `seed-jobs` (AC2) and `deliver` (AC4), each in a process of its own on one checkout's packages.
- `opens.test.mjs` (AC1), `instructions.test.mjs` (AC2), `whose.test.mjs` (AC3), `delivery.test.mjs` (AC4),
  `budgets.long.test.mjs` (AC5).
- `opens.c`: the open-recording library; `rusage.c`: a live process's instructions retired (#2646's).
- `fixtures/fake-claude.pl`: #159's stand-in agent; `fixtures/packages/watch`, `fixtures/packages/writer`: AC4's
  packages, their code as `index.ts.fixture` so no type check or runner picks it up.
- `BASE-FAILURE.txt`: each file's run on the base commit.

No `scripts/lanes.mjs` entry is needed: the unit lane runs Vitest files and `tests/*.test.mjs`; acceptance `node --test`
files run by hand, as #2646's and #2655's do.
