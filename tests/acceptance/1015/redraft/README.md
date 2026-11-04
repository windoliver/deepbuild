# Blind redraft of #1015 AC7: DeepBuild's own preflight and affected.mjs runs lease each block

Written blind, as the redraft of AC7's test (AGENTS.md, Proof; design: Dogfooding), by a job that saw no implementation
of #1015, no other test file's results and no log. The implementing agent doesn't edit these files.

What was read:

- Issue #1015 as of 2026-11-04: Scope (`deep lease`, `heavy.command@1`, DeepBuild's own repo: `scripts/lease` calls
  `deep lease`, the preflight and `scripts/affected.mjs` lease their builds and suites, each parallel block its own
  slot), Fields, the eight criteria, Proof and Depends on.
- `docs/technical-design.md` (Lease, Sessions that know about each other) and AGENTS.md, Proof.
- `tests/acceptance/1015/README.md` and `helpers.ts` (the suite's surfaces and helpers, written blind from the same
  inputs) and `tests/acceptance/907/README.md` for format. Not the suite's other test files.
- At the base (`2ea0fb77`): `scripts/affected.mjs` (`crates` runs `cargo metadata`; `select` links a test to every repo
  path its string literals name, a folder of 400 files or fewer included; `run` opens `<label>.log` in its logs folder
  under `os.tmpdir()` and then spawns the job; the final line names `logs in <folder>`), `scripts/lanes.mjs` (`runLanes`,
  `checks`' lint commands, the unit lane's node globs), `scripts/checks.mjs`, `scripts/preflight.mjs` (a timed grant,
  `warm`, then `scripts/checks.mjs`), `scripts/throttle.mjs` (its table under `$HOME/.deepbuild/throttle`),
  `scripts/proof-runs.mjs` (`childEnv`), `scripts/proof-change.mjs` (`isTestFile`), `packages/leases/src/index.ts` and
  `packages/record/src/index.ts` (event `ts` from the table's clock), `packages/hub/src/core.ts` (git calls on a
  session's folder are reads), and `tests/acceptance/18/mapping/helpers.ts` (`cleanEnv`, `allEvents`).

What the base does: no `scripts/lease`, so `runLanes` and `affected.mjs` run each block through `scripts/throttle.mjs`
only, and no block takes a `cpu.slot` lease: the test fails there at its named assertion.

## Run it

```sh
npm ci                            # once, if node_modules is missing
npm run build --workspaces        # the hub and `deep lease` start from packages/cli/dist
cargo build --locked -p deep-hook # the sessions' hooks (the suite's helper builds it if missing)
node node_modules/vitest/vitest.mjs run tests/acceptance/1015/redraft/own-repo.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/1015/tsconfig.json
```

Use the repo's Node (`.node-version`). The shell that runs vitest must have `cargo`, `git` and `node` on its PATH, as
`affected.mjs` needs them anywhere: the sessions get that PATH unchanged, with only a folder holding `deep` put ahead of
it. The file starts a hub, three sessions and three real runs of this checkout's scripts (two `affected.mjs` runs and
their nine lint jobs each), so it belongs on the one-at-a-time line: `scripts/lanes.mjs` needs
`tests/acceptance/1015/redraft/own-repo.test.ts` (the file, not the folder) in its `alone` list. This README is the
instruction; the implementer makes that edit. Rough time on a loaded Mac: 10 to 40 min; the test allows 50 min and its
plant 40. Nothing needs the network, a model, a sign-in or a real `claude`. Folders are under `/tmp/dh1015-*` (each
session's `TMPDIR` is inside its world, so `affected.mjs`'s logs and `runLanes`' output folders go there) and are
removed after the file; every process is stopped by its PID or process group (the suite's `cleanup`), and the blocks end
on their go files.

## Criteria to tests

| ID | File | Tests |
|---|---|---|
| AC7 `#1015.d86f2d2a` | `own-repo.test.ts` | the preflight's lane runner and two `affected.mjs` runs started together in three sessions: each block ran under a `cpu.slot` lease of its session; its wrong program (`DEEP_HUB_PLANT=lease-script-runs-directly`), naming the block |

### AC7, `own-repo.test.ts`

1. **Precondition.** `node scripts/affected.mjs --list <block>` with the sessions' environment must select the block
   (`block.test.mjs` here) and nothing else, no crate. Otherwise BLOCKED: the runs would run other suites, this file
   among them.
2. **The scenario.** `deep hub run` told 12 cores (`DEEP_HUB_TEST_CORES`). Three scripted Claude Code sessions, in this
   checkout, through the real deep-hook (the suite's `Session` and `claudeCall`), each run one command through its Bash
   tool, all three at once: `node tests/…/redraft/preflight-lanes.mjs` (the preflight's lane runner, below) and twice
   `node scripts/affected.mjs <block>`. Each session's commands carry `DH1015_LABEL` naming its run. Whatever the hook
   decides is run (its rewrite, or the command as typed). When a run's block marks its start, the hub's table is read
   (`lease.acquired`/`lease.released` through `events.read`) and the block is let end. Once the three runs end (40 min
   at most) and their leases have had a minute to end, the table is read again.
3. **The assertion**, one message naming every block that fails it:
   - no call was denied, and every run ended; an `affected.mjs` run printed its `logs in` line;
   - the held block: when it started, its session held a `cpu.slot` lease taken after the block's run began (for the
     lane runner, the time it wrote before calling `runLanes`; for `affected.mjs`, its `node` job's log file's birth)
     and before the block started, and that lease was released only after the block ended, or not yet; else
     "`the block \`node --test <block>\` of <run> … ran with no cpu.slot lease of its session`";
   - every job of each `affected.mjs` run (one `<label>.log` each in its logs folder: the node block and the lint jobs)
     is matched to a `cpu.slot` lease of its session of its own, taken after its log file was made; else
     "`the block "<label>" of <run> took no cpu.slot lease of its own`".
4. **The wrong program.** The same with `DEEP_HUB_PLANT=lease-script-runs-directly`, scaled to the lane runner and one
   `affected.mjs` run: the assertion must fail, naming `node --test <block>` and "ran with no cpu.slot lease of its
   session".

## Surfaces it relies on

- **`scripts/lease`** runs its arguments through `deep lease`, and `runLanes` and `affected.mjs` run each block's
  command through it, with the caller's environment (`DH1015_DIR` and `DH1015_LABEL` reach the block).
- **`deep lease`** finds its session by the process tree (the session's agent process, which deep-hook's calls bind,
  is an ancestor), holds a `cpu.slot` lease with holder `session:<the session's ID>` before the command starts, and
  releases it once the command's process group has ended. `deep` is found on the sessions' PATH.
- **Leases in the record** as the table writes them at the base, `ts` on the hub's clock (the system's).
- **`DEEP_HUB_PLANT=lease-script-runs-directly`** in the environment of the hub and of every command: the hub lists it,
  and `scripts/lease` with it runs its arguments directly.
- **`affected.mjs` as at the base** in what is read: a `<label>.log` per job made before the job's command starts, its
  logs folder under `os.tmpdir()` (so `TMPDIR`), and the `logs in <folder>` line.
- **`DEEP_HUB_TEST_CORES=12`** (at the base). `block.test.mjs` stays out of every lane: the unit lane's node glob is
  `tests/*.test.mjs`, vitest's include is `*.test.ts`, and without `DH1015_DIR` it is skipped.

## Open points

1. **"Three worktrees".** A worktree session may not add worktrees to the shared repo, so the three sessions run in
   this checkout, each its own agent process; the lease finds them apart by process tree, not by folder.
2. **"A preflight", scaled down.** The full preflight takes a timed grant, warms every build and runs every lane (about
   an hour). Its lane runner is run instead (`preflight-lanes.mjs`: `runLanes` of `scripts/lanes.mjs`, as
   `scripts/checks.mjs` calls it), given one lane whose command is the block. Each `affected.mjs` run is real, given
   one change, the block, so it runs the block's node job and its lint jobs. The perf lane, the canvas kit and the gate
   runner's call (#29) aren't run.
3. **"Each of their blocks".** Read as every job `affected.mjs` starts (each with its log), the lint jobs included, and
   the lane's one command. The jobs are matched to leases by count and time, not by process: the held block alone is
   checked to have run inside its lease. At the base the two `scripts/canvas-closures.mjs` lint jobs share one log
   name, so they count as one; the count is a lower bound.
4. **The lint jobs' outcomes, the runs' exit codes, waiting lines, nice 10 and how many run at once are not
   asserted**; the criterion asks only that the blocks run leased.
5. **The sessions' environment** is the suite's (`cleanEnv`: the test's HOME, `CARGO_HOME`/`RUSTUP_HOME` kept, no
   `DEEP_`/agent markers, `LC_ALL=C`) with PATH the machine's (only `deep` ahead) and `TMPDIR` inside the world. A
   machine whose PATH lacks `cargo` is BLOCKED at the precondition.
6. **Not run against an implementation.** This redraft was type-checked only; it was never run, here or at the base.
