# @deepbuild/checks-numbers

## What it is for

The numbers check plug-in (#87): check kind `numbers` re-runs the query behind each number a claim states, and its independent recount where one exists, failing with both values shown when they differ; runs each scoring term, filter, input or data source a change adds on a read-only sample of real data, failing one that changes nothing there; and `checkSpeed` re-runs a stated speed through the timing check behind it, on cold caches against a named baseline. Its default export is the plug-in's register function; `tests/acceptance/87/numbers` drives it. The hub holds the kind in its kind table (`packages/hub/src/kinds.ts`, #1537) and runs it on a claim's numbers.

## Where new code goes

- `src/index.ts`: the plug-in entry and its fill; `src/run.ts`: one run, its queries in `runtime/probe.mjs` in a process group of its own so the deadline can end it; `src/speed.ts`: the timing check.
- `src/kit.ts`: the `check.kind@1` kit; `src/types.ts`: the shapes.
- Regression tests go in `test/`; the acceptance suite is `tests/acceptance/87/numbers` (never edited).

## What it may import

A plug-in on the core: only `@deepbuild/conformance`, `@deepbuild/verdicts` (types) and `node:` built-ins, through their public entries. It never imports the record, the hub, CLI or app.

## Deviations

None.
