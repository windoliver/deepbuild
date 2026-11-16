# Acceptance tests for #2634: 159's process helper and a process table over 1 MiB

Written first, blind, from issue #2634 (its text as of November 15, 2026: AC1 to AC3), `AGENTS.md` and
`docs/technical-design.md` (Dogfooding), at base commit `1e3b798c5`, by a job that never saw a fix. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The surface is `processesNaming` from `tests/acceptance/159/helpers.ts`, which runs `ps` by bare name, so a `PATH`
set in the test reaches it.

| Criterion | Test (`ps.test.ts`) |
| --- | --- |
| AC1. A large process table is read, not refused | `#2634 AC1 ...`: starts one idle `node` naming a unique needle and 16 filler `node`s, about 2 MiB of arguments in all, checks `ps -A -ww -o pid=,pgid=,args=` prints over 1.25 MiB, then asserts `processesNaming(needle)` throws nothing and returns that pid with the needle in `args`. Linux caps one argument at 128 KiB (MAX_ARG_STRLEN) and procps-ng 4 shows at most 128 KiB of one command line, so several processes, not one 2 MiB argument, make the table large. Every child is killed by its PID. |
| AC2. What the helper throws or prints stays small | `#2634 AC2 ...`: puts a fake `ps` first on `PATH` (restored after) that prints 4 MiB of table-shaped rows and exits 1; asserts `processesNaming` throws an `Error` whose message names `ps` and its exit status or error code, whose `util.inspect` (depth and string length unlimited) and `JSON.stringify` of message plus own enumerable properties are each under 64 KiB and hold none of the fake rows, and that under 64 KiB, with none of the rows, reaches stdout or stderr during the call. |
| AC3. No assertion changes | No test: a diff criterion, checked by review of the fix's `git diff` (no `expect(...)` in `tests/acceptance/159/` touched). |

## How to run

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/2634
```

On the Spark it was run inside `systemd-run --user ... -p AppArmorProfile=claude-desktop -p MemoryMax=24G`.
`BASE-FAILURE.txt` is the run at the base: AC1 fails with `spawnSync ps ENOBUFS`, AC2 with a
2,143,462-byte `util.inspect` of the thrown error.
