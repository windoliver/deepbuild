# @deepbuild/gate

## What it is for

The core's gate runner (#29): which stops and calls make a claim, the floor every claim passes before any check runs, head trust, the lanes and queue on a virtual clock, and the real runs under `cpu.slot` leases. The hub drives it from its stops; checks-command reads its masked-exit rule.

## Where new code goes

- `src/claims.ts`: claim intake; `src/floor.ts`: the validity gate and definition hash; `src/own.ts`: whose checks count; `src/head.ts`: head trust.
- `src/scheduler.ts`: the lanes and queue, a pure function on a virtual clock; `src/exec.ts`: snapshots, checkouts and real runs; `src/stack.ts`: the tree a stack served.
- There is no `test/` folder: its tests are the acceptance suite in `tests/acceptance/29` (never edited) and hub tests such as `packages/hub/test/gate-stop.test.ts`.

## What it may import

Core: only `@deepbuild/contracts`, `@deepbuild/leases`, `@deepbuild/verdicts` and `node:` built-ins, through public entries. The core never imports an extension (checks-command included), nor the hub, CLI or app.

## Deviations

- `src/mask.ts`: the one masked-exit rule the core holds, moved here from `@deepbuild/checks-command` (#30), which now reads it from the core; keep it here.
