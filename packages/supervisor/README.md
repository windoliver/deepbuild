# @deepbuild/supervisor

## What it is for

The hub's supervisor (#236), part of its trusted ring and the local implementation of `host@1`: it starts every process in the platform sandbox with a run token, tracks what each run owns, holds a run's leases until its processes are proven gone, and stops only what it can prove. The hub, runner, extension host, env-local, checks-command and checks-journey start processes through it, and config-eval takes its sandbox backends.

## Where new code goes

- `src/supervisor.ts`: runs, ownership and stops; `src/egress.ts`: a run's credential stand-ins, its CA and egress filter (#1106); `src/procs.ts`: the process table, and the liveness and process-group reads (`alive`, `groupMembers`, `groupCpu`) the runner and the hub use; `src/timer.ts`: long deadlines; `src/types.ts`: the seam and `host@1` shapes.
- A sandbox backend goes behind the seam beside `src/seatbelt.ts` (macOS) and `src/bubblewrap.ts` (Linux, #70) and ships only once it passes `src/suite.ts`. When its grant already permits the host's Node, Seatbelt allows the exact loaded `.dylib` files it needs, never their containing folders; absent an explicit `OPENSSL_CONF`, that runtime uses `/dev/null` instead of reading host-wide OpenSSL configuration.
- Tests sit in `src/*.test.ts`; acceptance tests live in `tests/acceptance/236` and are never edited.

## What it may import

Trusted ring: only `@deepbuild/asks`, `@deepbuild/contracts`, `@deepbuild/leases`, `@deepbuild/record` and `node:` built-ins, through public entries. It never imports an extension, the extension host, the runner, or the hub, CLI or app, which all stand on it.

## Deviations

- `native/helper.c` and `native/helper-linux.c`: a C helper built into `dist/helper` by `build-helper.mjs`, one source per platform. On macOS it finds every process a run's Seatbelt profile holds, with each one's memory, and is the seam suite's probe. On both it sets a run's file limit (`limit`, RLIMIT_FSIZE in bytes, #1409) as it execs the sandbox; on macOS its `watch` follows a run with a file limit through kqueue, forks included, and reports each process's end, so a child killed at the limit stops the run. A program that ignores SIGXFSZ, as Node does, gets EFBIG at the limit instead and ends on its own; that is not recorded as a stop at the limit, and on Linux only the run's own program dying at the limit is. On Linux it is also the sandbox itself past bubblewrap's namespaces: `confine` puts Landlock and a seccomp filter from the grant on the program and stays as its parent to answer the filter (sockets, renames, metadata) and to write the refusals the supervisor records; `scan` finds a run's processes by the marker directory bubblewrap made in its mount namespace. Windows has no backend yet.
- `src/suite.ts`: `plantedBackends` ships broken fakes, each the platform's backend with one rule more, so the suite proves it fails exactly that case.
