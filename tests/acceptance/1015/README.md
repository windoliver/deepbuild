# Acceptance tests for #1015: heavy commands share the machine, under one lease, at a lower priority, and wait under memory pressure

Written first, blind, by a job that never saw an implementation of #1015; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #1015 as of 2026-11-04T17:52:52Z: Scope, Fields (`heavy.command@1`), the eight acceptance criteria, Proof and
  Depends on (#237, #907, #39, #48).
- `docs/technical-design.md`: Lease, Budget (one append on the log state read), Sessions that know about each other
  (the session map, hard stops, Load), How runs become one of five verdicts, Scale later (every lease names its host,
  fast rules stay in deep-hook, fail-open time declared per route), the Budgets table (fail-open time: under 50 ms from
  the hook's start), the broken-hub row, and Dogfooding.
- At the base (`2ea0fb77`): `crates/deep-hook/src/main.rs` (`forward`, the 48 ms watchdog, `ACK_BUDGET`, the spool,
  `agent_pid`, `DEEP_HUB_PLANT` read by deep-hook), `packages/leases/src/index.ts` (`cpu.slot` as `pool(cores/2)`,
  `SLOW_SLOT`, modes on exact kinds, `release` refusing a session's lease while its run's processes run, plants),
  `packages/gate/src/exec.ts` (`slot`, `runHeavy` and its call of an executable `scripts/lease`),
  `packages/hub/src/core.ts` (`DEEP_HUB_TEST_CORES`, `openLeases`, `launch`'s holder `session:<letters of the ID>`,
  the session's agent process bound from `ppid` (#992), `status.read`, `sessions.read`, `events.read`),
  `packages/hub/src/server.ts` (PreToolUse replies, `updatedInput` from the waits, Codex's deny), `packages/hub/src/plant.ts`,
  `packages/hub/src/mods.ts`, `packages/adapters/src/shipped.ts` (`caps.rewrite`: Claude Code yes, Codex no),
  `packages/env-local/src/index.ts` (the `gpu` session kind, exact), `packages/cli/src/main.ts` (no `lease` command),
  `adapters/claude-code.facts.json` and `adapters/codex.facts.json` (payload fields, hook timeouts),
  `scripts/agent-harness.mjs` (#48), `scripts/affected.mjs`, `scripts/lanes.mjs` (`runLanes`, `alone`),
  `scripts/preflight.mjs`, `scripts/throttle.mjs`, `scripts/proof-change.mjs` (criterion IDs), and the suites
  `tests/acceptance/907`, `237`, `29`, `48`, `18/mapping`, `18/binding`, `39` and `1097` for format and helpers.

What the base does: no `deep lease` command and no `heavy.command@1` entries. deep-hook forwards a Bash call's
PreToolUse to the hub and prints its reply; nothing matches `cargo test --workspace`, so eight sessions' commands run at
once, unrewritten and unleased, in Claude Code and Codex alike. `scripts/lease` doesn't exist; `runHeavy` would call it
if it did, and `runLanes` and `affected.mjs` run each block through `scripts/throttle.mjs` only. The lease table
already has `cpu.slot` with the slot #907 keeps, and exact kinds such as `gpu` with shared and exclusive modes, but
nothing outside the gate runner takes them. No lease reads memory pressure. The hub refuses a `DEEP_HUB_PLANT` it
doesn't list.

## Run them

```sh
npm ci                            # once, if node_modules is missing
npm run build --workspaces        # every file starts `deep hub run` and `deep lease` from packages/cli/dist
cargo build --locked -p deep-hook --features env-plants # the sessions' hooks, with the plants (#1408); the helper builds it
node node_modules/vitest/vitest.mjs run tests/acceptance/1015/<file>.test.ts   # one file at a time
node node_modules/typescript/bin/tsc -p tests/acceptance/1015/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0). Every file starts hubs, many deep-hook and `deep` processes and
stand-in commands, and most hold commands while they watch the lease table, so all eight belong on the one-at-a-time
line: `scripts/lanes.mjs` needs `tests/acceptance/1015/claude.test.ts`, `codex.test.ts`, `focused.test.ts`,
`waiter.test.ts`, `memory.test.ts`, `gpu.test.ts`, `own-repo.test.ts` and `budgets.test.ts` (each with its folder,
`tests/acceptance/1015/`) added to its `alone` list, file by file, not the folder, so `fixtures/probe.test.mjs` stays
in affected.mjs's parallel node block (AC7). This README is the instruction; the implementer makes that edit. Rough
times on the reference Mac at load 50: `claude.test.ts` and `codex.test.ts` 2 to 6 min each, `own-repo.test.ts` 10
to 30 min (two real affected.mjs runs), the others 1 to 5 min. Timeouts inside the tests are set for a loaded machine.

Nothing needs the network, a model, a sign-in, a real `claude`, `codex`, `cargo test` or `npx`. Folders are under
`/tmp/dh1015-*` (and `/tmp/dh18m-*` for #18's helpers) and are removed after each file. Every process a test starts
(the hub, each session's stand-in agent, each shell command's process group, the bystander) is stopped by its PID or
its process group's ID after the file, never by name or port; every go file is written first so the stand-ins end on
their own. AC8's comparison builds the merge base's deep-hook under `target/base-1015/` and keeps it.

### How sessions are scripted

As #907's and #18's suites drive them: each session is its own stand-in agent process (`fixtures/agent.mjs`), the
parent of its real `deep-hook claude-code <event>` or `deep-hook codex <event>` calls and of its shell commands, each
`/bin/sh -c <command>` in a process group of its own, as an agent's Bash tool runs one. A Claude Code session sends
SessionStart, your prompt (its transcript entry, Claude Code 2.1.304's shape) and UserPromptSubmit, then for each
shell call its tool_use entry and PreToolUse; it runs the command the reply's `updatedInput.command` gives, or the one
typed, then sends PostToolUse with the command's output as its tool result. A Codex session (0.160.0's payloads and
rollout) does the same with no rewrite: a denied call isn't run, and its next call is the command the deny gave.
Claude Code sessions run in `bypassPermissions` mode, as an unattended scripted session does. Every hook and command
gets `HOME` set to the test's home, the bin folder first on `PATH`, `DEEP_HUB_TEST_CORES=12`, and the plant when
there is one.

### How commands are stood in for

`fixtures/standin.pl` is installed in the bin folder as `cargo`, `npx`, `kit-run`, `gpu-export`, `build-block` and
`spawner`. It marks `S` (start) and `E` (end) in the world's log with its label (`DH1015_LABEL`, else its folder's
name), PID and time, prints a line as a test runner does, and runs until its go file exists. `deep` is the built CLI on
`PATH`. `claude` is a stub that lists no plugins, so the hub can read each session's Claude Code home.

## Criteria to tests

Each test's name starts with its criterion's ID and tag (`#1015.<first 8 hex of the SHA-256 of the criterion's text>`,
as `scripts/proof-change.mjs` computes it from the checkbox line). Each criterion's wrong program runs through the same
assertions and must fail them, naming what the criterion says.

| ID | File | Tests |
|---|---|---|
| AC1 `#1015.081f8373` | `claude.test.ts` | eight Claude Code sessions' `cargo test --workspace`: at most 5 at once, the rest wait and run, waiters' lines, each running command's slot under its session; its wrong program (`DEEP_HUB_PLANT=runs-matched-as-written`), naming the sixth command |
| AC2 `#1015.b593e460` | `codex.test.ts` | eight Codex sessions: each call denied once with its `deep lease` form, the retry allowed and run leased, at most 5 at once; its wrong program (`DEEP_HUB_PLANT=denies-every-retry`), naming the call |
| AC3 `#1015.0ceaf8cf` | `focused.test.ts` | `npx vitest run src/cart.test.ts` and `cargo test -p cart` run as written and at once, unleased; with a done.yaml entry naming `npx vitest run`, the first runs leased; its wrong program (`DEEP_HUB_PLANT=leases-every-cargo`), naming the focused call |
| AC4 `#1015.b67ee1cc` | `waiter.test.ts` | a waiter killed with SIGTERM: no lease after 2 s, the slot freed next goes to the waiter behind it; a process group outliving its parent keeps its slot until it ends; its wrong program (`DEEP_HUB_PLANT=releases-on-parent-exit`), naming the group |
| AC5 `#1015.1ce5e240` | `memory.test.ts` | under critical pressure the command waits, its line naming memory, starts within 5 s of easing, nothing killed; its wrong program (`DEEP_HUB_PLANT=ignores-memory-pressure`) |
| AC6 `#1015.289f0347` | `gpu.test.ts` | two kit runs hold `gpu` shared at once, the exclusive export waits for both, a third kit run waits while it runs; its wrong program (`DEEP_HUB_PLANT=exclusive-beside-shared`), naming the kit run |
| AC7 `#1015.d86f2d2a` | `own-repo.test.ts` | the preflight's lane runner and two affected.mjs runs started together: each block runs under a `cpu.slot` of its session; its wrong program (`DEEP_HUB_PLANT=lease-script-runs-directly`), naming the block |
| AC8 `#1015.6118ebcf` | `budgets.test.ts` | hub stopped: `cargo test --workspace` runs as written within 50 ms and the row reads "ran unleased"; the perf lane task naming #1015; matching adds under 1 ms at p95 against the merge base's deep-hook |

### AC1, `claude.test.ts`

The hub is told 12 cores, so `cpu.slot` is a pool of 6 and slow work holds at most 5. A sample repo (a git repo made in
the test) with eight worktrees `wt-1` to `wt-8`; one Claude Code session in each. All eight call `cargo test
--workspace` at once. The test lets the commands run in waves: it holds each running stand-in until no stand-in has
started for 4 s and every command not yet started has printed a waiting line (or 150 s pass), reads the record's
leases, then lets those running end. It asserts, in order: no call was denied (Claude Code can rewrite); no command
started while 5 others ran, else the failure names the sixth command, its worktree and session; all eight ran to exit
0; in every wave each running command's session held a `cpu.slot` lease (`session:<its ID>`); at least 3 sessions
waited, and each waiter's tool result shows a line containing "wait" that names the slot and a holding session (by
its ID, the ID's first 8 characters, or its worktree's folder name). The wrong program must fail naming "the sixth
command" and the sixth stand-in to start.

### AC2, `codex.test.ts`

The same eight worktrees with Codex sessions. Each session's `cargo test --workspace` PreToolUse must be a deny whose
reason gives, in backticks, a command containing `deep lease` and `cargo test --workspace`; the session's next
PreToolUse is that command, which must not be denied; it runs. The waves and assertions of AC1 follow (at most 5 at
once, each to exit 0, each running command's slot under its session); waiting lines are AC1's. The wrong program
must fail naming the first session's retried call by its ID and "denied again".

### AC3, `focused.test.ts`

One Claude Code session in `wt-1` calls both focused commands at once: each PreToolUse must leave it as written (no
deny, no rewrite to anything else); both stand-ins must start, each before the other ended; and the session holds no
`cpu.slot` lease while they run. Then `wt-2/.deepbuild/done.yaml` gets the repo entry (README, Surfaces) before a new
session there starts; its `npx vitest run src/cart.test.ts` must be rewritten into a `deep lease` form, run, and hold a
`cpu.slot` lease under its session while it runs. The wrong program runs the first half; it must fail naming
`` `cargo test -p cart` ``.

### AC4, `waiter.test.ts`

1. One session holds the 5 slots slow work may hold with five `deep lease -- cargo test --workspace` commands. A second
   session's same command waits (it prints a waiting line), then a third's waits behind it. SIGTERM goes to the second's
   process group, as an agent's tool timeout sends it. 2 s later the record must hold no lease of the killed session;
   then one holder ends, and the third session's command must start (within 120 s); no lease may be granted to the
   killed session after the SIGTERM, and its command never runs.
2. `deep lease -- spawner`: the stand-in's parent exits at once, its child in the same process group runs on. Sampled
   every 500 ms for 6 s after the parent's exit, the child must still run and the session's `cpu.slot` lease must be
   held; once the child ends (its go file), the lease must be released within 30 s. The wrong program must fail
   naming "process group".

### AC5, `memory.test.ts`

The pressure file reads `critical` from the start; a bystander `/bin/sleep 600` runs. A Claude Code session's `cargo
test --workspace` is rewritten and run; the test waits until its output has a waiting line naming memory (up to 90 s),
3 s more, then writes `normal`. Asserted in order: not denied; not started before the pressure eased (the wrong
program fails here, its message naming "memory pressure held critical"); a waiting line names memory; the bystander
still runs; the command started and ran to exit 0; it started within 5 s of the pressure easing. Past 5 s on a
machine loaded past its cores, that last reading is INCONCLUSIVE (skipped with the reading), never PASS or FAIL.

### AC6, `gpu.test.ts`

Four Claude Code sessions in folders `kit-1`, `kit-2`, `export`, `kit-3`. Kit runs 1 and 2 (`deep lease gpu:shared --
kit-run`) start; the record's leases are read while both run. The export (`deep lease gpu:exclusive -- gpu-export`) is
called and waits; kit run 1 ends, 3 s pass, kit run 2 ends; the export runs and the leases are read; kit run 3 is
called and waits; the export ends; kit run 3 runs. Asserted: both kit runs ran at the same time, each holding a `gpu`
lease `shared` under its session; the export started only after both ended (the wrong program fails here, naming the
kit run and "still held the GPU shared"); it held `gpu` `exclusive` while it ran; kit run 3 started only after the
export ended.

### AC7, `own-repo.test.ts`

Three Claude Code sessions in this checkout (README, Open points 9) start together: the preflight's lane runner,
`node --input-type=module -e '…runLanes([{ name: "probe", commands: [["build-block"]] }])…'`, and two runs of `node
scripts/affected.mjs tests/acceptance/1015/fixtures/probe.test.mjs`, each session with `DH1015_LABEL` naming its run.
When each block's process (the stand-in `build-block`, the probe test) starts, the record's leases are read and the
block is let end. Each block must have run, and its session must have held a `cpu.slot` lease then. The wrong program
runs the lane runner and one affected.mjs run; it must fail naming the block ("ran with no cpu.slot lease").

### AC8, `budgets.test.ts`

1. A Claude Code session starts with the hub up; the hub is stopped; its `cargo test --workspace` PreToolUse must leave
   the call as written and the command runs to its end; the hub starts again, and within 90 s a row of the session in
   `status.read` or `sessions.read` must contain "ran unleased". Last, the PreToolUse's wall time as its parent saw it
   must be under 50 ms; over it on a machine that isn't a fit reference Mac (`environmentProblem()` of #1097's suite:
   model, mains power, Low Power Mode, thermal state, load within the cores), INCONCLUSIVE.
2. `benchmarks/budgets.json` has a task naming `#1015`, valid by `validateBudgets` against the merge base's file, and
   its command exits 0.
3. On a fit reference Mac only (elsewhere INCONCLUSIVE, and nothing is built): the release deep-hook and the pinned
   merge base's (`2ea0fb77`), each timed on the same `cargo test --workspace` PreToolUse with the hub stopped, 200 calls
   interleaved, five runs; p95 of this build less p95 of the base's, judged against 1 ms by #1097's `judge`.

## Surfaces and plants the implementation must provide

None exists at the base except where said; each is the smallest the criteria need.

- **`deep lease [kind...] -- <command>`** (the `deep` CLI): runs `<command>` (the words after `--`, found on the
  caller's `PATH`) in the caller's folder with the caller's environment, its output the caller's, and exits with its
  status. The calling session is found from the process tree: the session whose agent process (the `ppid` deep-hook
  sends, which the hub binds a session to, #992) is an ancestor of `deep lease`. Before the command starts, it holds a
  `cpu.slot` lease of the hub's table under the `slow` key (`SLOW_SLOT`), holder `session:<the session's ID>` (its
  letters and digits, as the hub writes holders), plus a lease on each kind named; it releases them once the command's
  whole process group has ended. While it waits it prints, on stdout or stderr, a line within its first minute of
  waiting and one a minute after, each containing "wait", naming what it waits for (`slot` for a `cpu.slot`, `memory`
  for memory pressure) and who holds it (a holding session's ID, its first 8 characters, or its worktree's folder
  name). Killed by SIGTERM to its process group while it waits, it leaves no lease and no place in the queue within
  2 s.
- **`gpu:shared` and `gpu:exclusive`** as kinds of `deep lease`: the `gpu` lease kind in that mode, every `gpu` lease
  on one key, so a shared and an exclusive lease never overlap in time.
- **Leases in the record** as the table writes them at the base: `lease.acquired` (subject the lease's ID;
  `data.resource.kind`, `data.mode`, `data.holder`) and `lease.released` (subject the same ID), read with `events.read`.
- **Shipped `heavy.command@1` entries**, in effect in a home where only `deep hub run` has run (no `deep setup`):
  `cargo test --workspace` matches one; `cargo test -p cart` and `npx vitest run src/cart.test.ts` match none.
- **Claude Code's rewrite**: a matched Bash call's PreToolUse reply carries `hookSpecificOutput.updatedInput.command`,
  a command that contains `deep lease` and the command as typed; the agent runs it with `/bin/sh -c` in the session's
  folder. It isn't denied.
- **Codex's deny once**: a matched Bash call's PreToolUse reply denies it (exit 2 with the reason on stderr,
  `hookSpecificOutput.permissionDecision: "deny"` with `permissionDecisionReason`, or `decision: "block"` with
  `reason`), the reason holding the command to run instead in backticks: the first backtick span containing
  `deep lease`, which also contains the command as typed. That command, as the session's next call, isn't denied.
- **A repo's own entries**: `.deepbuild/done.yaml` in the session's worktree, key `heavy_commands`, a list of
  `heavy.command@1` entries; the tests write `{name: vitest run, argv_prefix: [npx, vitest, run], kinds: [], jobs:
  none}` before the session's SessionStart, and it is in effect from that session's first tool call.
- **The hub stopped**: a matched call's PreToolUse leaves it as written (exit 0, no rewrite) within 50 ms; once the hub
  is back and has replayed what deep-hook spooled, a row of the session in `status.read` or `sessions.read` (a row
  with a field equal to the session's ID) contains the text `ran unleased`.
- **`DEEP_TEST_MEMORY_PRESSURE_FILE=<path>`**, a test seam set for the hub, deep-hook and every `deep`: the file holds
  one word, `normal`, `warn` or `critical`, and stands for the system's memory-pressure level (macOS's level, Linux's
  pressure stall information) wherever the lease reads it, read again while a command waits. While it reads
  `critical` a leased command waits; once it reads anything else, the command starts within 5 s.
- **`DEEP_HUB_TEST_CORES=12`** (at the base): the hub's `cpu.slot` pool is 6, whatever the machine.
- **`scripts/lease`**: executable, runs its arguments through `deep lease`. `runLanes` of `scripts/lanes.mjs` (the
  preflight's lane runner) and `scripts/affected.mjs` run each block's command through it, so each block's process,
  each parallel block its own, runs under a `cpu.slot` lease of the calling session, with the caller's environment
  (`DH1015_DIR` and `DH1015_LABEL` reach the stand-in and the probe).
- **Plants**, `DEEP_HUB_PLANT=<name>` in the environment of the hub, deep-hook and every `deep` the tests start; the
  hub lists each, so it starts with it, and whichever program implements a plant acts on it:
  - `runs-matched-as-written` (AC1): matched commands are left as written, so they run unleased.
  - `denies-every-retry` (AC2): a Codex call already in its `deep lease` form is denied again.
  - `leases-every-cargo` (AC3): every command starting `cargo` matches, so `cargo test -p cart` is rewritten.
  - `releases-on-parent-exit` (AC4): `deep lease` releases its leases when the command's first process exits.
  - `ignores-memory-pressure` (AC5): a leased command starts whatever the pressure reads.
  - `exclusive-beside-shared` (AC6): an exclusive `gpu` lease is granted beside shared ones.
  - `lease-script-runs-directly` (AC7): `scripts/lease` runs its arguments directly, without `deep lease`.
- **The perf lane**: a `benchmarks/budgets.json` task whose `initialReason` or `changeReason` names `#1015`, valid by
  `validateBudgets` (`scripts/benchmark.mjs`) against the merge base's file, whose command exits 0.
- **`fixtures/probe.test.mjs`** stays out of every lane but AC7's: vitest's include is `*.test.ts`, the unit lane's
  node --test globs leave `tests/acceptance/` out, and run without `DH1015_DIR` it is skipped.

## Open points (choices the issue leaves open; the tests assert the least they can)

1. **"Scripted Claude Code sessions (#48)".** #48's harness drives a real or a fake agent binary through its own
   scenarios and has none that runs a given command through Bash, so the sessions are scripted as #907's and #18's
   suites script them (How sessions are scripted): no model, network or sign-in, the real deep-hook and hub.
2. **"With 12 cores".** The hub is told 12 cores through the base's `DEEP_HUB_TEST_CORES`, so the pool is 6 and the
   eight sessions are eight on any machine; the machine's own cores count only for the timing readings.
3. **The commands are stand-ins.** A real `cargo test` in eight worktrees would load this shared machine for what the
   lease decides alone; the stand-in runs until the test lets it end, so waves are read, not raced.
4. **"One line a minute".** Read as a line within the first minute of waiting and one each minute after; the waves wait
   for each waiter's line (up to 150 s), so a line printed at once and one printed at 60 s both pass.
5. **"Who holds it".** A holding session by its ID, the ID's first 8 characters, or its worktree's folder name; the
   word "wait" and `slot` or `memory` for what.
6. **Permission mode.** The Claude Code sessions run in `bypassPermissions`; whether a session in `default` mode is
   rewritten, or denied once as Codex is, is left open.
7. **GPU modes.** `gpu:shared` and `gpu:exclusive` as `deep lease` kinds are this suite's choice; which mode a bare
   `gpu` takes, and which entries name `gpu`, are open. The kit runs and the export are stand-ins: that
   `scripts/canvas-kit.mjs` or an export takes the lease in its mode isn't asserted.
8. **Memory pressure.** A test seam, not a real allocator: holding the system's pressure critical would press every
   other session on this shared machine. macOS's and Linux's readers aren't exercised by this suite. "Within 5 s" past
   5 s under load reads INCONCLUSIVE.
9. **"Three worktrees" of DeepBuild's own repo.** A worktree session may not add worktrees to the shared repo, so the
   three sessions run in this checkout. A full preflight takes an hour and waits up to 60 min for a timed grant, so
   "a preflight" is its lane runner, `runLanes`, given one stand-in lane; each affected.mjs run is given one change,
   the probe. Only the probe's and the lane's blocks are asserted, not affected.mjs's lint jobs; the perf lane, the
   canvas kit and the gate runner's call (#29) aren't run.
10. **"No place in the queue".** Observed as behaviour: the slot freed 2 s after the kill goes to the waiter behind the
    killed one, and no lease is ever granted to the killed session. No queue event is asserted.
11. **done.yaml.** The key `heavy_commands` is this suite's choice; the entry takes effect from the first tool call of a
    session started after it was written.
12. **"Its session's row".** A row of `status.read` or of `sessions.read`; the text "ran unleased" anywhere in it.
13. **Budgets.** The merge base is pinned (`2ea0fb77`), so the comparison stays the pre-#1015 deep-hook after main
    moves. The 1 ms is measured with the hub stopped (deep-hook alone, release builds), and isn't built or measured on
    an unfit machine, to spare the shared one. The 50 ms fail-open time is the hook's wall time as its parent sees it.
14. **Not covered**: nice 10 and the gate runner's own priority, the readings (per command and per machine), the pool
    sizes drafted at setup, a plug-in's entries, `jobs`, the disk floor, the shipped entries beyond `cargo test
    --workspace` (`cargo build`, `clippy`, `nextest`, npm/pnpm/bun, playwright, pytest, go test, make, `tsc -b`), and
    "never stops a process" beyond the bystander and the commands under test. The criteria don't ask for them.
