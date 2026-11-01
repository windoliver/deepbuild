# @deepbuild/supervisor

## What it is for

The hub's supervisor (#236), part of its trusted ring and the local implementation of `host@1`: it starts every process in the platform sandbox with a run token, tracks what each run owns, holds a run's leases until its processes are proven gone, and stops only what it can prove. The hub, runner, extension host, env-local and checks-command start processes through it.

## Where new code goes

- `src/supervisor.ts`: runs, ownership and stops; `src/procs.ts`: the process table; `src/timer.ts`: long deadlines; `src/types.ts`: the seam and `host@1` shapes.
- A sandbox backend goes behind the seam beside `src/seatbelt.ts` (macOS) and `src/bubblewrap.ts` (Linux, #70) and ships only once it passes `src/suite.ts`.
- Tests sit in `src/*.test.ts`; acceptance tests live in `tests/acceptance/236` and are never edited.

## What it may import

Trusted ring: only `@deepbuild/asks`, `@deepbuild/contracts`, `@deepbuild/leases`, `@deepbuild/record` and `node:` built-ins, through public entries. It never imports an extension, the extension host, the runner, or the hub, CLI or app, which all stand on it.

## Deviations

- `native/helper.c` and `native/helper-linux.c`: a C helper built into `dist/helper` by `build-helper.mjs`, one source per platform. On macOS it finds every process a run's Seatbelt profile holds and is the seam suite's probe. On Linux it is also the sandbox itself past bubblewrap's namespaces: `confine` puts Landlock and a seccomp filter from the grant on the program and stays as its parent to answer the filter (sockets, renames, metadata) and to write the refusals the supervisor records; `scan` finds a run's processes by the marker directory bubblewrap made in its mount namespace. Windows has no backend yet.
- `src/suite.ts`: `plantedBackends` ships broken fakes, each the platform's backend with one rule more, so the suite proves it fails exactly that case.
