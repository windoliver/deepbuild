# @deepbuild/leases

## What it is for

The kernel's one lease table (#237): every lease on a port, account, screen, GPU, path or document ID is granted or refused here, through `deep.lease(resource, mode)`. env-local, the gate runner, the supervisor, the extension host and the hub all lease through it; its state is a function of the record.

## Where new code goes

- `src/index.ts`: the whole table: resource kinds as `lease.kind@1` data, overlap, grants, releases.
- A new resource kind is declared as data by its owner, never added as code here; the match forms are closed.
- Regression tests go in `test/`; acceptance tests live in `tests/acceptance/237` and are never edited.

## What it may import

Core kernel code: only `@deepbuild/contracts`, `@deepbuild/record` and `node:` built-ins, through their public entries. The supervisor, gate, extension host and hub stand on it, so it never imports them, an extension, or the CLI or app.

## Deviations

- `src/index.ts`: the `plant` option and `plantedOverlap` are planted wrong programs the acceptance tests select (tests only), so each test is shown to fail on a wrong program (AGENTS.md, Proof).
