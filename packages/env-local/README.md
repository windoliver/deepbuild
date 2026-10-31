# @deepbuild/env-local

## What it is for

The first-party environment (#331), an environment@1 fill. It starts the repo's own dev script as the `environment:` block of `.deepbuild/done.yaml` names it, on ports the supervisor leases per worktree, and reports it ready only once its health route answers 200; a compose stack runs as its own compose project named from its run. The hub calls it for `deep env up` and `down`.

## Where new code goes

- `src/index.ts`: the whole environment (`upStack`, compose handling, port and resource kinds).
- Every process start, signal and wait goes through host@1; never spawn, signal or wait for one here. `docker compose up` and `down` go through the host too.
- Tests: `src/index.test.ts`, beside the source; the acceptance suites are `tests/acceptance/331/` and the environment@1 kit in `@deepbuild/conformance`.

## What it may import

Extension layer. It reaches `@deepbuild/supervisor` (host@1 and leases) and `@deepbuild/conformance` (the `SlotFill` type only) through their package entries, plus `yaml` and `node:` built-ins. It never imports the hub, the CLI or the app.

## Deviations

None.
