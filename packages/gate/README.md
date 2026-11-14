# @deepbuild/gate

## What it is for

The core's gate runner (#29): which stops and calls make a claim, the floor every claim passes before any check runs, head trust, the lanes and queue on a virtual clock, and the real runs under `cpu.slot` leases. The hub drives it from its stops; checks-command reads its masked-exit rule, github its head trust, checks-journey the tree a stack served and config-eval its error shape.

## Where new code goes

- `src/claims.ts`: claim intake; `src/floor.ts`: the validity gate and definition hash; `src/own.ts`: whose checks count; `src/head.ts`: head trust.
- `src/scheduler.ts`: the lanes and queue, a pure function on a virtual clock; `src/exec.ts`: snapshots, checkouts and real runs; `src/stack.ts`: the tree a stack served.
- `src/claim.ts`: a claim's verdict from its checks' command runs (#30), the run records by their fields in, the engine's verdict out.
- `src/price.ts`: a definition's price (#325), its paid checks each priced by the lookup it is handed, and their total; `src/stalls.ts`: the stalled-claim rule (#325), one task's count of send-backs and open items.
- `src/checkouts.ts`: snapshots, temporary checkouts and base-commit runs (#31); `src/open.ts`: what a claim leaves open (#323); `src/size.ts`: a change's size and scope (#324); `src/kinds.ts`: a check kind's admission (#68).
- Regression tests go in `test/`; the acceptance suites are `tests/acceptance/29` and the claim halves of `tests/acceptance/30` (never edited), plus hub tests such as `packages/hub/test/gate-stop.test.ts`.

## What it may import

Core: only `@deepbuild/contracts`, `@deepbuild/leases`, `@deepbuild/verdicts`, `node:` built-ins and `yaml` (`src/size.ts` reads a compose file's services), through public entries, plus types alone from `@deepbuild/conformance` (the check.kind@1 fill `src/checkouts.ts` runs) and `@deepbuild/supervisor` (the `Supervisor` it is handed). The core never imports an extension (checks-command included), nor the hub, CLI or app.

## Deviations

- `src/mask.ts`: the one masked-exit rule the core holds, moved here from `@deepbuild/checks-command` (#30), which now reads it from the core; keep it here.
