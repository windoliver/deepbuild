# Acceptance tests for #1409: memory and file limits on supervised runs, with a named limit stop

Written first, blind, by a job that saw only the issue, the design and the base commit, never an implementation of
#1409. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

## What was read, at which base

- Issue #1409, its body as read on 2026-11-10 at 23:18 UTC: the problem, Scope, Fields, the five checkbox criteria
  (AC1 to AC5 in the body's order), Proof and Not in scope.
- `AGENTS.md`, and in `docs/technical-design.md`: How runs become one of five verdicts (the run outcomes, and "a run
  the supervisor stops at a limit its start set ... is stopped too, and records the limit and the reading"),
  Dogfooding, and One host contract (`host@1`).
- The base commit `de304b9` (main), for surfaces and conventions only: `packages/supervisor` (`types.ts`,
  `supervisor.ts` and its `SCAN_MS` scan, `seatbelt.ts`, `procs.ts`, `native/helper.c`); `packages/contracts`
  (`schemas/process.ended@1.json`, `fixtures/process.ended@1/`, `src/catalogue.ts`) and the record's append check in
  `packages/record/src/index.ts`; `packages/checks-command/src/index.ts` and `shell.ts`; `packages/conformance/src/families.ts`;
  and the suites `tests/acceptance/236`, `30` and `1014`.

## The surface under test

The issue names `limits?: { memory_mb, file_mb }` on `StartSpec`, the supervisor's scan, `ulimit -f` inside the
sandbox, a recorded event that joins the catalogue, and an INCONCLUSIVE verdict. It doesn't name the event's kind or
fields, or how a check learns its run hit a limit. These are the choices, each the smallest that reaches its criterion:

1. **`StartSpec.limits?: { memory_mb: number; file_mb: number }`**, as the issue's Fields give it, both members
   required. Sizes are MiB: the issue sets 512 MiB against `memory_mb: 128` and 32 MiB against `file_mb: 8`. Every
   test that sets limits passes both; the member a criterion doesn't name is set far from the workload (AC1 and AC3
   `file_mb: 64`, AC2 `memory_mb: 1024`).
2. **The supervisor as `host@1`**: `openSupervisor` from `packages/supervisor/src/index.ts`, opened on a real record
   (`openRecord`) and asks core (`openAsks`), as #236's tests open it; `start`, `wait` and `cleanup`.
3. **The event kind `run.stopped_at_limit`**, appended by the core about the run. Its `data`:
   - `run`: the run's handle;
   - `limit`: which member of `StartSpec.limits` the run passed, `"memory_mb"` or `"file_mb"`;
   - `max`: that member's value, as the start set it;
   - `reading`: what the supervisor read when it stopped the run, in the limit's unit (MiB). AC1 asserts it for
     memory; AC2 asserts only `limit` and `max`, as its criterion asks only that the event name the limit.

   The tests read it back from the record the supervisor writes to: `record.read({ kinds: ['run.stopped_at_limit'] })`,
   matched by `data.run`, waiting up to 3 s after the run ends. The record refuses to append a kind with no published
   schema, or an event its schema refuses, so an event found there is a valid one of a catalogued kind; AC1 also
   asserts the kind is in `catalogue()` from `packages/contracts` (which lists a schema only with its `x-feeds`).
   Its version isn't fixed by these tests.
4. **AC3 through the command check kind, with no new field on `CommandCheck`.** `runCommandCheck` from
   `packages/checks-command/src/index.ts` runs `node alloc.mjs`; its `host` is the supervisor behind a Proxy whose
   `start` adds `limits` to every StartSpec and which forwards every other member, bound to the supervisor. Why: the
   check kind reaches its run only through `host@1` and never learns where it ran, and only the supervisor knows it
   stopped a run at a limit (a SIGKILL or a non-zero exit alone can't tell a limit stop from a crash of the product).
   So whatever the supervisor gives the check through `host@1` (a field of `Exit`, or another member) reaches it, and
   where the owner's limits get set stays open, as the issue leaves it. The run must end with the closed outcome
   `stopped`, the one the design gives a run the supervisor stops at a limit; its verdict is read with
   `judge('run', outcome)` from `packages/conformance`, the run family's one mapping to a verdict.
5. **Not chosen here, and free for the work:** any field of `Exit`, how the scan measures memory (resident size or
   footprint), how a file-limit stop is noticed, the event's version, and its other fields.

## How the issue was read

- **The planted programs, each with a parent that does nothing itself** (`fixtures/planted.c`, built with `cc` once
  per test process). `planted parent <mode> ...` forks the same program as its child, waits for it and ends with its
  status as a shell would (its code, or 128 plus the signal); it allocates and writes nothing. The two share a
  process group. Only memory summed over the run's tree passes AC1's limit, and only a limit that reaches the run's
  children cuts AC2's file. The child writes what it saw to files in its folder, never to its output.
- **The allocator** writes every page of each 1 MiB block with pseudo-random words, so its memory is resident and
  can't be compressed. It holds what it allocated for 10 s in AC1, so only a stop ends it within 1 s.
- **"Stopped within 1 s of passing it"** is read from the child's own record: the moment its own count passed
  128 MiB (`passed`), and its last heartbeat, written after each block and every 20 ms while it holds. The test
  requires the last heartbeat at most 1000 ms after `passed`. The run's memory passes 128 MiB slightly before the
  child's own count does (the parent's and the child's runtime count too), so a stop in between leaves no `passed`
  stamp; that reads as 0 ms lived past the limit.
- **The reading** must be past 128 and under 1024: no more than the child's 512 MiB and the two processes' own.
  A reading of virtual size, or one in bytes or KiB, falls outside.
- **AC2's "is stopped"**: the writer's file never grows past 8 MiB, the run ends, and its stop names `file_mb` with
  `max: 8`. The planted writer leaves SIGXFSZ at its default.
- **AC3 uses the memory limit only.** The command check refuses a program its tracers can't see into, so its run is
  Node, and Node ignores SIGXFSZ: past a file limit its write fails with EFBIG and it exits on its own (measured with
  Node 24.22.2 under `ulimit -f`). Whether that counts as a run stopped at a limit is not this suite's to settle.
- **AC4, no `limits`**: the 512 MiB allocator (holding 2 s, so a wrong scan has twenty chances to stop it) and the
  32 MiB writer each end on their own with exit 0, print what they did, the file is whole, and no limit stop is on
  the record (waiting 500 ms for a late one). It catches a program that bounds a run whose start set no limits.
- **AC5, under its limits**: the allocator (96 MiB, exit 3) and the writer (6 MiB, exit 4) each run once with no
  `limits` and once under `{ memory_mb: 128, file_mb: 8 }`; exit code, signal, stdout, stderr and the exit's output
  digests must be equal. 96 and 6 MiB sit above half of each limit, so a doubled reading or a halved limit stops them
  (the 96 MiB run peaked at 99.9 MiB of resident memory summed over its group here). The run under limits must show
  them in force: its child reads its own `RLIMIT_FSIZE`, which must be 8 MiB (8 MB, 8 000 000 bytes, is also taken,
  as the field's name says MB). Without that the comparison would pass on a program that ignores `limits`.
- **Not tested**, as the issue puts them out of scope: default values, bytes across many files, allocation faster
  than a scan. The suite runs on macOS, as the Proof says; nothing here runs on Linux.

## Base run

At the base, `de304b9`, four tests fail at a named assertion and AC4 passes, by design: its criterion is that a run
with no limits behaves as it does there (`BASE-FAILURE.txt`). The typecheck fails at the base only on `limits`.

A throwaway check, not part of the suite, showed the AC1 measure can be met: a 100 ms scan summing resident memory
over the planted run's group and killing it past 128 MiB, five times, left the child 7 to 34 ms past 128 MiB, with
readings of 131 to 160 MiB.

## How to run

On macOS, with Node 24.22 and `cc` (the Xcode command line tools):

```sh
npm ci --no-audit --no-fund
npm run build -w @deepbuild/contracts -w @deepbuild/record -w @deepbuild/asks -w @deepbuild/leases -w @deepbuild/supervisor
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1409 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1409/tsconfig.json
```

- The supervisor's build compiles its native helper into `packages/supervisor/dist/helper`, which its scan runs.
- `--no-file-parallelism`: AC1 times a stop, and the files allocate up to 512 MiB each.
- About a minute at the base. No network, no model call.
- Every folder is under `/tmp/dh1409-*` and removed after its file; HOME is a temp folder, and the agent's own
  `CLAUDE_*` and `DEEP_*` variables are removed first. Each run is stopped by the supervisor's own cleanup when its
  world closes; the planted program also ends itself after two minutes. Nothing is stopped by name or port.
- With `--root` here, Vitest writes its cache to `tests/acceptance/1409/node_modules/.vite/`; delete that folder
  before committing.

## Files

- `memory.test.ts` AC1, `file.test.ts` AC2, `check.test.ts` AC3, `none.test.ts` AC4, `under.test.ts` AC5.
- `helpers.ts`: temp folders, the build of the planted program, the world, a planted run, the record's limit stops.
- `fixtures/planted.c`: the planted parent, allocator and writer. `fixtures/check/alloc.mjs`: AC3's check command.
